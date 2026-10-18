//! Gamepads: player slots, dead zones, and the `gilrs` adapter (macOS and Windows).
use opensekai_contracts::{DeviceEvent, GamepadAxes, GamepadButton, GamepadSnapshot, MAX_GAMEPADS};
use std::collections::BTreeSet;

pub const STICK_DEAD_ZONE: f64 = 0.15;
pub const TRIGGER_DEAD_ZONE: f64 = 0.05;

/// Radial dead zone: a stick inside the zone reads 0,0; outside it the distance is rescaled
/// from the zone edge to 1, so the value starts at 0 and the direction does not change.
pub fn stick(x: f64, y: f64) -> (f64, f64) {
    let (x, y) = (finite(x), finite(y));
    let length = x.hypot(y);
    if length <= STICK_DEAD_ZONE {
        return (0.0, 0.0);
    }
    let scale = ((length - STICK_DEAD_ZONE) / (1.0 - STICK_DEAD_ZONE)).min(1.0) / length;
    (round(x * scale), round(y * scale))
}

pub fn trigger(value: f64) -> f64 {
    let value = finite(value).clamp(0.0, 1.0);
    if value <= TRIGGER_DEAD_ZONE {
        0.0
    } else {
        round((value - TRIGGER_DEAD_ZONE) / (1.0 - TRIGGER_DEAD_ZONE))
    }
}

fn finite(value: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}
/// Four decimals keep the clock small and still give smooth motion.
fn round(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

/// Player slots 1 to 4. A pad keeps its slot until it disconnects; a new pad takes the
/// lowest free slot. A fifth pad gets none.
#[derive(Debug, Default)]
pub struct PadSlots([Option<usize>; MAX_GAMEPADS as usize]);
impl PadSlots {
    pub fn assign(&mut self, id: usize) -> Option<u8> {
        if let Some(slot) = self.slot(id) {
            return Some(slot);
        }
        let free = self.0.iter().position(Option::is_none)?;
        self.0[free] = Some(id);
        Some(free as u8 + 1)
    }
    pub fn release(&mut self, id: usize) -> Option<u8> {
        let slot = self.slot(id)?;
        self.0[slot as usize - 1] = None;
        Some(slot)
    }
    pub fn slot(&self, id: usize) -> Option<u8> {
        self.0
            .iter()
            .position(|held| *held == Some(id))
            .map(|i| i as u8 + 1)
    }
}

/// One pad change that the adapter reads from the platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PadInput {
    Connected,
    Disconnected,
    Button(GamepadButton, bool),
}

/// Slots plus the buttons each slot reported down, so a disconnect can release them.
#[derive(Debug, Default)]
pub struct PadTracker {
    slots: PadSlots,
    held: [BTreeSet<GamepadButton>; MAX_GAMEPADS as usize],
}
impl PadTracker {
    pub fn slot(&self, id: usize) -> Option<u8> {
        self.slots.slot(id)
    }
    /// Applies one change of the pad with platform `id` and returns its wire events. A
    /// disconnect releases each held button before the slot is freed.
    pub fn apply(&mut self, id: usize, input: PadInput) -> Vec<DeviceEvent> {
        match input {
            PadInput::Connected => {
                self.slots.assign(id);
                vec![]
            }
            PadInput::Disconnected => {
                let Some(pad) = self.slots.release(id) else {
                    return vec![];
                };
                std::mem::take(&mut self.held[pad as usize - 1])
                    .into_iter()
                    .map(|button| DeviceEvent::GamepadButton {
                        pad,
                        button,
                        pressed: false,
                    })
                    .collect()
            }
            PadInput::Button(button, pressed) => {
                let Some(pad) = self.slots.slot(id) else {
                    return vec![];
                };
                let held = &mut self.held[pad as usize - 1];
                if pressed {
                    held.insert(button);
                } else {
                    held.remove(&button);
                }
                vec![DeviceEvent::GamepadButton {
                    pad,
                    button,
                    pressed,
                }]
            }
        }
    }
}

/// Raw pad values before the dead zones.
#[derive(Debug, Default, Clone, Copy)]
pub struct RawAxes {
    pub left: (f64, f64),
    pub right: (f64, f64),
    pub left_trigger: f64,
    pub right_trigger: f64,
}

/// The wire state of one pad, or None when no button is held and every axis is 0.
pub fn snapshot(pad: u8, held: &BTreeSet<GamepadButton>, raw: RawAxes) -> Option<GamepadSnapshot> {
    let nonzero = |v: f64| (v != 0.0).then_some(v);
    let (lx, ly) = stick(raw.left.0, raw.left.1);
    let (rx, ry) = stick(raw.right.0, raw.right.1);
    let axes = GamepadAxes {
        left_x: nonzero(lx),
        left_y: nonzero(ly),
        right_x: nonzero(rx),
        right_y: nonzero(ry),
        left_trigger: nonzero(trigger(raw.left_trigger)),
        right_trigger: nonzero(trigger(raw.right_trigger)),
    };
    let axes = (axes != GamepadAxes::default()).then_some(axes);
    let buttons = (!held.is_empty()).then(|| held.iter().copied().collect());
    (axes.is_some() || buttons.is_some()).then_some(GamepadSnapshot { pad, buttons, axes })
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub use adapter::{button, GilrsAdapter};

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod adapter {
    use super::{snapshot, PadInput, PadTracker, RawAxes};
    use crate::input::devices::{DeviceAdapter, DeviceState, DeviceStatus, SharedQueue};
    use crate::input::locked;
    use gilrs::{Axis, Button, EventType, Gilrs};
    use opensekai_contracts::{DeviceEvent, DeviceKind, GamepadButton, GamepadSnapshot};
    use std::collections::BTreeSet;
    use std::io;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    /// The event wait of the adapter thread.
    const WAIT: Duration = Duration::from_millis(100);
    /// The most events read in one wake; the rest waits for the next.
    const BATCH: usize = 1024;
    const BUTTONS: [Button; 17] = [
        Button::South,
        Button::East,
        Button::West,
        Button::North,
        Button::LeftTrigger,
        Button::RightTrigger,
        Button::LeftTrigger2,
        Button::RightTrigger2,
        Button::Select,
        Button::Start,
        Button::Mode,
        Button::LeftThumb,
        Button::RightThumb,
        Button::DPadUp,
        Button::DPadDown,
        Button::DPadLeft,
        Button::DPadRight,
    ];

    /// `gilrs` calls the bumpers LeftTrigger and RightTrigger, and the triggers LeftTrigger2
    /// and RightTrigger2.
    pub fn button(button: Button) -> Option<GamepadButton> {
        Some(match button {
            Button::South => GamepadButton::South,
            Button::East => GamepadButton::East,
            Button::West => GamepadButton::West,
            Button::North => GamepadButton::North,
            Button::LeftTrigger => GamepadButton::LeftBumper,
            Button::RightTrigger => GamepadButton::RightBumper,
            Button::LeftTrigger2 => GamepadButton::LeftTrigger,
            Button::RightTrigger2 => GamepadButton::RightTrigger,
            Button::Select => GamepadButton::Select,
            Button::Start => GamepadButton::Start,
            Button::Mode => GamepadButton::Mode,
            Button::LeftThumb => GamepadButton::LeftStick,
            Button::RightThumb => GamepadButton::RightStick,
            Button::DPadUp => GamepadButton::DpadUp,
            Button::DPadDown => GamepadButton::DpadDown,
            Button::DPadLeft => GamepadButton::DpadLeft,
            Button::DPadRight => GamepadButton::DpadRight,
            _ => return None,
        })
    }

    #[derive(Default)]
    struct State {
        active: bool,
        started: bool,
        status: Option<DeviceStatus>,
        pads: Vec<GamepadSnapshot>,
    }

    /// The macOS `gilrs` backend never stops its HID thread, so the adapter makes one `Gilrs`
    /// value at the first start and keeps it. While not active, it discards events.
    pub struct GilrsAdapter {
        state: Arc<Mutex<State>>,
        queue: SharedQueue,
    }
    impl GilrsAdapter {
        pub fn new(queue: SharedQueue) -> Self {
            Self {
                state: Arc::default(),
                queue,
            }
        }
    }

    fn read_pads(gilrs: &Gilrs, slots: &PadTracker) -> Vec<GamepadSnapshot> {
        gilrs
            .gamepads()
            .filter_map(|(id, pad)| {
                let slot = slots.slot(id.into())?;
                let held: BTreeSet<GamepadButton> = BUTTONS
                    .iter()
                    .filter(|b| pad.is_pressed(**b))
                    .filter_map(|b| button(*b))
                    .collect();
                let value = |b: Button| pad.button_data(b).map_or(0.0, |d| d.value() as f64);
                let raw = RawAxes {
                    left: (
                        pad.value(Axis::LeftStickX) as f64,
                        pad.value(Axis::LeftStickY) as f64,
                    ),
                    right: (
                        pad.value(Axis::RightStickX) as f64,
                        pad.value(Axis::RightStickY) as f64,
                    ),
                    left_trigger: value(Button::LeftTrigger2),
                    right_trigger: value(Button::RightTrigger2),
                };
                snapshot(slot, &held, raw)
            })
            .collect()
    }

    /// Marks the adapter Unavailable when its thread panics, so status never says Active
    /// for a thread that is gone. It does not restart: a new `Gilrs` would leak another HID thread.
    struct PanicGuard(Arc<Mutex<State>>);
    impl Drop for PanicGuard {
        fn drop(&mut self) {
            if std::thread::panicking() {
                let mut state = locked(&self.0);
                state.status = Some(DeviceStatus::Unavailable);
                state.pads.clear();
            }
        }
    }

    fn input(event: EventType) -> Option<PadInput> {
        Some(match event {
            EventType::Connected => PadInput::Connected,
            EventType::Disconnected => PadInput::Disconnected,
            EventType::ButtonPressed(b, _) => PadInput::Button(button(b)?, true),
            EventType::ButtonReleased(b, _) => PadInput::Button(button(b)?, false),
            _ => return None,
        })
    }

    fn run(state: Arc<Mutex<State>>, queue: SharedQueue) {
        let _guard = PanicGuard(state.clone());
        let mut gilrs = match Gilrs::new() {
            Ok(gilrs) => gilrs,
            Err(gilrs::Error::NotImplemented(_)) => {
                locked(&state).status = Some(DeviceStatus::Unsupported);
                return;
            }
            Err(_) => {
                locked(&state).status = Some(DeviceStatus::Unavailable);
                return;
            }
        };
        let mut tracker = PadTracker::default();
        let ids: Vec<usize> = gilrs.gamepads().map(|(id, _)| id.into()).collect();
        for id in ids {
            tracker.apply(id, PadInput::Connected);
        }
        loop {
            // Wait for one event, then take every pending one, so a burst costs one read.
            let mut batch: Vec<gilrs::Event> =
                gilrs.next_event_blocking(Some(WAIT)).into_iter().collect();
            while batch.len() < BATCH {
                let Some(event) = gilrs.next_event() else {
                    break;
                };
                batch.push(event);
            }
            // The tracker follows slots and held buttons also while not active.
            let events: Vec<DeviceEvent> = batch
                .into_iter()
                .filter_map(|event| Some((event.id.into(), input(event.event)?)))
                .flat_map(|(id, input)| tracker.apply(id, input))
                .collect();
            let active = {
                let mut state = locked(&state);
                if state.active {
                    state.pads = read_pads(&gilrs, &tracker);
                }
                state.active
            };
            if active && !events.is_empty() {
                let mut queue = locked(&queue);
                for event in events {
                    queue.push(event);
                }
            }
        }
    }

    /// Spawns the thread at the first start, or again after a failed spawn. A spawn that
    /// succeeds clears a stale Unavailable status from an earlier failed spawn.
    fn begin(state: &mut State, spawn: impl FnOnce() -> io::Result<()>) {
        if std::mem::replace(&mut state.started, true) {
            return;
        }
        match spawn() {
            Ok(()) => state.status = None,
            Err(_) => {
                state.started = false;
                state.status = Some(DeviceStatus::Unavailable);
            }
        }
    }

    impl DeviceAdapter for GilrsAdapter {
        fn kind(&self) -> DeviceKind {
            DeviceKind::Gamepad
        }
        fn set_active(&self, active: bool) {
            let mut state = locked(&self.state);
            state.active = active;
            if !active {
                state.pads.clear();
                return;
            }
            let (shared, queue) = (self.state.clone(), self.queue.clone());
            // The thread waits for this lock before it can set a status, so the clear comes first.
            begin(&mut state, move || {
                std::thread::Builder::new()
                    .name("opensekai-gamepad".into())
                    .spawn(move || run(shared, queue))
                    .map(drop)
            });
        }
        fn poll(&self, out: &mut DeviceState) {
            let state = locked(&self.state);
            if state.active {
                out.gamepads.extend(state.pads.iter().cloned());
            }
        }
        fn status(&self) -> DeviceStatus {
            let state = locked(&self.state);
            state.status.unwrap_or(if state.active {
                DeviceStatus::Active
            } else {
                DeviceStatus::Idle
            })
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn adapter(state: State) -> GilrsAdapter {
            GilrsAdapter {
                state: Arc::new(Mutex::new(state)),
                queue: SharedQueue::default(),
            }
        }

        #[test]
        fn a_spawn_that_succeeds_clears_a_stale_unavailable_status() {
            let mut state = State::default();
            begin(&mut state, || Err(io::Error::other("no thread")));
            assert_eq!(
                (state.started, state.status),
                (false, Some(DeviceStatus::Unavailable))
            );
            begin(&mut state, || Ok(()));
            assert_eq!((state.started, state.status), (true, None));
            let mut spawned = false;
            begin(&mut state, || {
                spawned = true;
                Ok(())
            });
            assert!(!spawned, "one thread only");
        }

        #[test]
        fn a_panicked_thread_reports_unavailable_while_active() {
            let pad = adapter(State {
                active: true,
                started: true,
                ..State::default()
            });
            assert_eq!(pad.status(), DeviceStatus::Active);
            let shared = pad.state.clone();
            let joined = std::thread::spawn(move || {
                let _guard = PanicGuard(shared);
                panic!("gamepad thread failed");
            })
            .join();
            assert!(joined.is_err());
            assert_eq!(pad.status(), DeviceStatus::Unavailable);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sticks_inside_the_dead_zone_read_zero_and_outside_start_at_zero() {
        assert_eq!(stick(0.1, -0.1), (0.0, 0.0));
        assert_eq!(stick(0.0, 1.0), (0.0, 1.0));
        let (x, y) = stick(0.16, 0.0);
        assert!(x > 0.0 && x < 0.02 && y == 0.0, "{x}");
        let (x, y) = stick(0.6, 0.6);
        assert!((x - y).abs() < 1e-9, "the direction is kept");
        assert_eq!(stick(2.0, 0.0), (1.0, 0.0));
        assert_eq!(stick(f64::NAN, 0.5), (0.0, 0.4118));
    }

    #[test]
    fn triggers_use_their_own_dead_zone_and_clamp() {
        assert_eq!(trigger(0.04), 0.0);
        assert_eq!(trigger(1.0), 1.0);
        assert_eq!(trigger(1.5), 1.0);
        assert_eq!(trigger(-0.5), 0.0);
        assert_eq!(trigger(0.525), 0.5);
    }

    #[test]
    fn slots_go_to_the_lowest_free_number_and_stay_while_connected() {
        let mut slots = PadSlots::default();
        assert_eq!(slots.assign(10), Some(1));
        assert_eq!(slots.assign(11), Some(2));
        assert_eq!(slots.assign(10), Some(1));
        assert_eq!(slots.release(10), Some(1));
        assert_eq!(slots.slot(11), Some(2));
        assert_eq!(slots.assign(12), Some(1));
        assert_eq!(slots.assign(13), Some(3));
        assert_eq!(slots.assign(14), Some(4));
        assert_eq!(slots.assign(15), None);
        assert_eq!(slots.release(99), None);
        assert_eq!(
            [12, 11, 13, 14].map(|id| slots.slot(id)),
            [Some(1), Some(2), Some(3), Some(4)]
        );
    }

    #[test]
    fn a_disconnect_releases_held_buttons_before_the_slot_is_freed() {
        let mut pads = PadTracker::default();
        pads.apply(10, PadInput::Connected);
        pads.apply(11, PadInput::Connected);
        let press = |b| PadInput::Button(b, true);
        assert_eq!(
            pads.apply(11, press(GamepadButton::South)),
            vec![DeviceEvent::GamepadButton {
                pad: 2,
                button: GamepadButton::South,
                pressed: true
            }]
        );
        pads.apply(11, press(GamepadButton::DpadUp));
        pads.apply(11, PadInput::Button(GamepadButton::South, false));
        pads.apply(11, press(GamepadButton::North));
        assert_eq!(
            pads.apply(11, PadInput::Disconnected),
            vec![
                DeviceEvent::GamepadButton {
                    pad: 2,
                    button: GamepadButton::North,
                    pressed: false
                },
                DeviceEvent::GamepadButton {
                    pad: 2,
                    button: GamepadButton::DpadUp,
                    pressed: false
                },
            ]
        );
        assert_eq!(pads.slot(11), None);
        // The next pad in slot 2 starts with no held button.
        pads.apply(12, PadInput::Connected);
        assert_eq!(pads.slot(12), Some(2));
        assert!(pads.apply(12, PadInput::Disconnected).is_empty());
        // A pad without a slot gives nothing.
        assert!(pads.apply(99, press(GamepadButton::South)).is_empty());
        assert!(pads.apply(99, PadInput::Disconnected).is_empty());
    }

    #[test]
    fn a_pad_at_rest_sends_nothing() {
        let rest = RawAxes {
            left: (0.05, -0.05),
            ..RawAxes::default()
        };
        assert_eq!(snapshot(1, &BTreeSet::new(), rest), None);
        let held: BTreeSet<_> = [GamepadButton::North].into();
        let moved = RawAxes {
            right: (0.0, -1.0),
            right_trigger: 1.0,
            ..rest
        };
        assert_eq!(
            snapshot(2, &held, moved),
            Some(GamepadSnapshot {
                pad: 2,
                buttons: Some(vec![GamepadButton::North]),
                axes: Some(GamepadAxes {
                    right_y: Some(-1.0),
                    right_trigger: Some(1.0),
                    ..GamepadAxes::default()
                }),
            })
        );
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn maps_gilrs_bumpers_and_triggers_to_wire_names() {
        assert_eq!(
            button(gilrs::Button::LeftTrigger),
            Some(GamepadButton::LeftBumper)
        );
        assert_eq!(
            button(gilrs::Button::RightTrigger2),
            Some(GamepadButton::RightTrigger)
        );
        assert_eq!(button(gilrs::Button::C), None);
    }
}
