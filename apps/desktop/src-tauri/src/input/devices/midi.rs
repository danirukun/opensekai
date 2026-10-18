//! MIDI input: the message decoder and the `midir` adapter (CoreMIDI on macOS, WinMM on Windows).
use opensekai_contracts::DeviceEvent;

/// One complete channel message as a device event. Note On with velocity 0 is a Note Off.
/// System messages, other channel messages, short messages, and bad data bytes give None.
pub fn decode(bytes: &[u8]) -> Option<DeviceEvent> {
    let (&status, data) = bytes.split_first()?;
    if status & 0x80 == 0 || data.len() < 2 || data[0] > 127 || data[1] > 127 {
        return None;
    }
    let channel = (status & 0x0F) + 1;
    let (first, second) = (data[0], data[1]);
    match status & 0xF0 {
        0x80 => Some(DeviceEvent::MidiNote {
            channel,
            note: first,
            velocity: second,
            on: false,
        }),
        0x90 => Some(DeviceEvent::MidiNote {
            channel,
            note: first,
            velocity: second,
            on: second > 0,
        }),
        0xB0 => Some(DeviceEvent::MidiControl {
            channel,
            controller: first,
            value: second,
        }),
        _ => None,
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub use adapter::MidirAdapter;

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod adapter {
    use super::decode;
    use crate::input::devices::{locked, DeviceAdapter, DeviceState, DeviceStatus, SharedQueue};
    use midir::{Ignore, MidiInput, MidiInputConnection};
    use opensekai_contracts::DeviceKind;
    use std::collections::HashMap;
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};

    const CLIENT: &str = "OpenSekai";
    const SCAN: Duration = Duration::from_secs(2);
    const SLICE_SECONDS: f64 = 0.25;

    #[derive(Default)]
    struct State {
        active: bool,
        started: bool,
        failed: bool,
    }
    #[derive(Default)]
    struct Shared {
        state: Mutex<State>,
        wake: Condvar,
    }

    /// Connects to every MIDI input port while active. The thread lives after the first start:
    /// CoreMIDI updates its port list on the run loop of the thread that made the first client.
    pub struct MidirAdapter {
        shared: Arc<Shared>,
        queue: SharedQueue,
    }
    impl MidirAdapter {
        pub fn new(queue: SharedQueue) -> Self {
            Self {
                shared: Arc::default(),
                queue,
            }
        }
    }

    #[cfg(target_os = "macos")]
    fn run_loop_slice() {
        #[link(name = "CoreFoundation", kind = "framework")]
        extern "C" {
            static kCFRunLoopDefaultMode: *const std::ffi::c_void;
            fn CFRunLoopRunInMode(
                mode: *const std::ffi::c_void,
                seconds: f64,
                return_after_source: u8,
            ) -> i32;
        }
        // An empty run loop returns at once, so wait the rest of the slice.
        let start = Instant::now();
        unsafe { CFRunLoopRunInMode(kCFRunLoopDefaultMode, SLICE_SECONDS, 0) };
        let rest = Duration::from_secs_f64(SLICE_SECONDS).saturating_sub(start.elapsed());
        std::thread::sleep(rest);
    }
    #[cfg(not(target_os = "macos"))]
    fn run_loop_slice() {
        std::thread::sleep(Duration::from_secs_f64(SLICE_SECONDS));
    }

    /// Connects new ports and drops the connections of ports that are gone. Returns false
    /// when no MIDI client can be made. The lister client stays for the life of the thread.
    fn scan(
        lister: &mut Option<MidiInput>,
        connections: &mut HashMap<String, MidiInputConnection<()>>,
        queue: &SharedQueue,
    ) -> bool {
        if lister.is_none() {
            *lister = MidiInput::new(CLIENT).ok();
        }
        let Some(input) = lister.as_ref() else {
            return false;
        };
        let ports = input.ports();
        let present: Vec<String> = ports.iter().map(|p| p.id()).collect();
        connections.retain(|id, _| present.contains(id));
        for (port, id) in ports.iter().zip(present) {
            if connections.contains_key(&id) {
                continue;
            }
            let Ok(mut client) = MidiInput::new(CLIENT) else {
                return false;
            };
            client.ignore(Ignore::All);
            let queue = queue.clone();
            // A failed connect (for example a port that just went away) is tried at the next scan.
            if let Ok(connection) = client.connect(
                port,
                "opensekai-input",
                move |_, bytes, _| {
                    if let Some(event) = decode(bytes) {
                        locked(&queue).push(event);
                    }
                },
                (),
            ) {
                connections.insert(id, connection);
            }
        }
        true
    }

    fn run(shared: Arc<Shared>, queue: SharedQueue) {
        let mut lister = None;
        let mut connections = HashMap::new();
        let mut next_scan = Instant::now();
        loop {
            {
                let mut state = locked(&shared.state);
                if !state.active {
                    drop(state);
                    // Closing waits for a callback in flight, which takes only the queue lock.
                    connections.clear();
                    state = locked(&shared.state);
                    while !state.active {
                        state = shared
                            .wake
                            .wait(state)
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                    }
                    next_scan = Instant::now();
                }
            }
            if Instant::now() >= next_scan {
                let ok = scan(&mut lister, &mut connections, &queue);
                locked(&shared.state).failed = !ok;
                next_scan = Instant::now() + SCAN;
            }
            run_loop_slice();
        }
    }

    impl DeviceAdapter for MidirAdapter {
        fn kind(&self) -> DeviceKind {
            DeviceKind::Midi
        }
        fn set_active(&self, active: bool) {
            let mut state = locked(&self.shared.state);
            state.active = active;
            self.shared.wake.notify_all();
            if !active || std::mem::replace(&mut state.started, true) {
                return;
            }
            let (shared, queue) = (self.shared.clone(), self.queue.clone());
            let spawned = std::thread::Builder::new()
                .name("opensekai-midi".into())
                .spawn(move || run(shared, queue));
            if spawned.is_err() {
                state.started = false;
                state.failed = true;
            }
        }
        fn poll(&self, _: &mut DeviceState) {}
        fn status(&self) -> DeviceStatus {
            let state = locked(&self.shared.state);
            match (state.failed, state.active) {
                (true, _) => DeviceStatus::Unavailable,
                (false, true) => DeviceStatus::Active,
                (false, false) => DeviceStatus::Idle,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_notes_with_one_based_channels() {
        assert_eq!(
            decode(&[0x90, 60, 100]),
            Some(DeviceEvent::MidiNote {
                channel: 1,
                note: 60,
                velocity: 100,
                on: true
            })
        );
        assert_eq!(
            decode(&[0x8F, 61, 64]),
            Some(DeviceEvent::MidiNote {
                channel: 16,
                note: 61,
                velocity: 64,
                on: false
            })
        );
    }

    #[test]
    fn a_note_on_with_velocity_zero_is_a_note_off() {
        assert_eq!(
            decode(&[0x93, 36, 0]),
            Some(DeviceEvent::MidiNote {
                channel: 4,
                note: 36,
                velocity: 0,
                on: false
            })
        );
    }

    #[test]
    fn decodes_control_change() {
        assert_eq!(
            decode(&[0xB1, 7, 127]),
            Some(DeviceEvent::MidiControl {
                channel: 2,
                controller: 7,
                value: 127
            })
        );
    }

    #[test]
    fn ignores_other_short_and_malformed_messages() {
        for bytes in [
            &[][..],
            &[0x90, 60],
            &[0x3C, 60, 100],
            &[0x90, 0x80, 100],
            &[0xB0, 7, 0xFF],
            &[0xE0, 0, 64],
            &[0xC0, 5, 0],
            &[0xF8, 0, 0],
            &[0xF0, 0x7E, 0x7F, 0xF7],
        ] {
            assert_eq!(decode(bytes), None, "{bytes:?}");
        }
    }
}
