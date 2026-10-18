//! Gamepad, MIDI, and pointer input for Blueprints. Each device kind has one adapter behind
//! `DeviceAdapter`. The hub activates an adapter only while an enabled graph uses its kind.
pub mod gamepad;
pub mod midi;
pub mod pointer;

use opensekai_contracts::{
    DeviceEvent, DeviceKind, DeviceUpdate, GamepadSnapshot, PointerSnapshot, MAX_DEVICE_EVENTS,
};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};

/// Queued button and note events; the oldest goes when the queue is full.
pub const QUEUE_CAPACITY: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceStatus {
    Idle,
    Active,
    /// No adapter on this platform.
    Unsupported,
    /// The adapter could not start.
    Unavailable,
}

/// State that an active adapter adds to the next clock.
#[derive(Debug, Default, PartialEq)]
pub struct DeviceState {
    pub gamepads: Vec<GamepadSnapshot>,
    pub pointer: Option<PointerSnapshot>,
}

pub trait DeviceAdapter: Send + Sync {
    fn kind(&self) -> DeviceKind;
    /// Starts the adapter for true and stops it for false. Never blocks on the device.
    fn set_active(&self, active: bool);
    /// Called on each clock while active. Adds the current state; may queue events.
    fn poll(&self, state: &mut DeviceState);
    fn status(&self) -> DeviceStatus;
}

pub(crate) fn locked<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub fn kind_of(event: &DeviceEvent) -> DeviceKind {
    match event {
        DeviceEvent::GamepadButton { .. } => DeviceKind::Gamepad,
        DeviceEvent::MidiNote { .. } | DeviceEvent::MidiControl { .. } => DeviceKind::Midi,
        DeviceEvent::PointerButton { .. } => DeviceKind::Pointer,
    }
}

/// Events in arrival order, plus the last Control Change value of each channel and
/// controller since the previous clock, so a fast knob gives one value for each clock.
#[derive(Default)]
pub struct DeviceQueue {
    events: VecDeque<DeviceEvent>,
    controls: BTreeMap<(u8, u8), u8>,
}
impl DeviceQueue {
    pub fn push(&mut self, event: DeviceEvent) {
        if let DeviceEvent::MidiControl {
            channel,
            controller,
            value,
        } = event
        {
            self.controls.insert((channel, controller), value);
            return;
        }
        if self.events.len() == QUEUE_CAPACITY {
            self.events.pop_front();
        }
        self.events.push_back(event);
    }
    /// At most 32 events: queued events first, then Control Change values. The rest waits.
    pub fn drain(&mut self) -> Vec<DeviceEvent> {
        let n = self.events.len().min(MAX_DEVICE_EVENTS);
        let mut out: Vec<DeviceEvent> = self.events.drain(..n).collect();
        while out.len() < MAX_DEVICE_EVENTS {
            let Some(((channel, controller), value)) = self.controls.pop_first() else {
                break;
            };
            out.push(DeviceEvent::MidiControl {
                channel,
                controller,
                value,
            });
        }
        out
    }
    /// Drops queued events of kinds that are no longer watched.
    pub fn retain(&mut self, kinds: &BTreeSet<DeviceKind>) {
        self.events.retain(|event| kinds.contains(&kind_of(event)));
        if !kinds.contains(&DeviceKind::Midi) {
            self.controls.clear();
        }
    }
}

pub type SharedQueue = Arc<Mutex<DeviceQueue>>;

pub struct DeviceHub {
    queue: SharedQueue,
    adapters: Vec<Arc<dyn DeviceAdapter>>,
    watched: Mutex<BTreeSet<DeviceKind>>,
}
impl DeviceHub {
    pub fn new(queue: SharedQueue, adapters: Vec<Arc<dyn DeviceAdapter>>) -> Self {
        Self {
            queue,
            adapters,
            watched: Mutex::default(),
        }
    }
    /// A hub without adapters: every used kind is unsupported.
    pub fn empty() -> Self {
        Self::new(SharedQueue::default(), vec![])
    }
    pub fn set_watched(&self, kinds: &BTreeSet<DeviceKind>) {
        *locked(&self.watched) = kinds.clone();
        for adapter in &self.adapters {
            adapter.set_active(kinds.contains(&adapter.kind()));
        }
        locked(&self.queue).retain(kinds);
    }
    /// The device part of the next clock, or None when there is nothing to send.
    pub fn collect(&self) -> Option<DeviceUpdate> {
        let watched = locked(&self.watched).clone();
        if watched.is_empty() {
            return None;
        }
        let mut state = DeviceState::default();
        // Polls run before the drain, so pointer edges of this clock go with it.
        for adapter in self.adapters.iter().filter(|a| watched.contains(&a.kind())) {
            adapter.poll(&mut state);
        }
        state.gamepads.sort_by_key(|pad| pad.pad);
        state
            .gamepads
            .truncate(opensekai_contracts::MAX_GAMEPADS as usize);
        let events = {
            let mut queue = locked(&self.queue);
            // An adapter thread can queue one event after its stop.
            queue.retain(&watched);
            queue.drain()
        };
        let update = DeviceUpdate {
            events: (!events.is_empty()).then_some(events),
            gamepads: (!state.gamepads.is_empty()).then_some(state.gamepads),
            pointer: state.pointer,
        };
        (update.events.is_some() || update.gamepads.is_some() || update.pointer.is_some())
            .then_some(update)
    }
    /// Used kinds that cannot give input on this computer.
    pub fn problems(&self) -> Vec<(DeviceKind, DeviceStatus)> {
        locked(&self.watched)
            .iter()
            .filter_map(|kind| {
                let status = self
                    .adapters
                    .iter()
                    .find(|a| a.kind() == *kind)
                    .map_or(DeviceStatus::Unsupported, |a| a.status());
                matches!(
                    status,
                    DeviceStatus::Unsupported | DeviceStatus::Unavailable
                )
                .then_some((*kind, status))
            })
            .collect()
    }
}

/// The adapters this platform has. Linux has none in this slice.
pub fn platform_hub() -> Arc<DeviceHub> {
    let queue = SharedQueue::default();
    #[allow(unused_mut)]
    let mut adapters: Vec<Arc<dyn DeviceAdapter>> = vec![];
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        adapters.push(Arc::new(gamepad::GilrsAdapter::new(queue.clone())));
        adapters.push(Arc::new(midi::MidirAdapter::new(queue.clone())));
    }
    #[cfg(target_os = "macos")]
    adapters.push(Arc::new(pointer::MacPointer::new(queue.clone())));
    Arc::new(DeviceHub::new(queue, adapters))
}

#[cfg(test)]
mod tests {
    use super::*;
    use opensekai_contracts::{GamepadButton, PointerButton};

    struct Fake {
        kind: DeviceKind,
        active: Mutex<Vec<bool>>,
        status: DeviceStatus,
    }
    impl Fake {
        fn new(kind: DeviceKind) -> Arc<Self> {
            Arc::new(Self {
                kind,
                active: Mutex::default(),
                status: DeviceStatus::Idle,
            })
        }
    }
    impl DeviceAdapter for Fake {
        fn kind(&self) -> DeviceKind {
            self.kind
        }
        fn set_active(&self, active: bool) {
            locked(&self.active).push(active);
        }
        fn poll(&self, state: &mut DeviceState) {
            if self.kind == DeviceKind::Pointer {
                state.pointer = Some(PointerSnapshot {
                    x: 0.5,
                    y: 0.5,
                    buttons: None,
                });
            }
        }
        fn status(&self) -> DeviceStatus {
            self.status
        }
    }
    fn note(note: u8) -> DeviceEvent {
        DeviceEvent::MidiNote {
            channel: 1,
            note,
            velocity: 100,
            on: true,
        }
    }
    fn kinds(list: &[DeviceKind]) -> BTreeSet<DeviceKind> {
        list.iter().copied().collect()
    }

    #[test]
    fn queue_drops_oldest_and_drains_thirty_two_per_clock() {
        let mut queue = DeviceQueue::default();
        for n in 0..130 {
            queue.push(note((n % 128) as u8));
        }
        let first = queue.drain();
        assert_eq!(first.len(), 32);
        assert_eq!(first[0], note(2));
        let mut total = 32;
        loop {
            let batch = queue.drain();
            if batch.is_empty() {
                break;
            }
            total += batch.len();
        }
        assert_eq!(total, QUEUE_CAPACITY);
    }

    #[test]
    fn control_changes_keep_the_last_value_and_wait_for_room() {
        let mut queue = DeviceQueue::default();
        for value in 0..100 {
            queue.push(DeviceEvent::MidiControl {
                channel: 1,
                controller: 7,
                value,
            });
        }
        for n in 0..31 {
            queue.push(note(n));
        }
        queue.push(DeviceEvent::MidiControl {
            channel: 2,
            controller: 1,
            value: 5,
        });
        let first = queue.drain();
        assert_eq!(first.len(), 32);
        assert_eq!(
            first[31],
            DeviceEvent::MidiControl {
                channel: 1,
                controller: 7,
                value: 99
            }
        );
        assert_eq!(
            queue.drain(),
            vec![DeviceEvent::MidiControl {
                channel: 2,
                controller: 1,
                value: 5
            }]
        );
        assert!(queue.drain().is_empty());
    }

    #[test]
    fn the_hub_starts_only_used_kinds_and_drops_events_of_stopped_kinds() {
        let (pad, midi, pointer) = (
            Fake::new(DeviceKind::Gamepad),
            Fake::new(DeviceKind::Midi),
            Fake::new(DeviceKind::Pointer),
        );
        let queue = SharedQueue::default();
        let hub = DeviceHub::new(
            queue.clone(),
            vec![pad.clone(), midi.clone(), pointer.clone()],
        );
        assert_eq!(hub.collect(), None);
        hub.set_watched(&kinds(&[DeviceKind::Gamepad, DeviceKind::Pointer]));
        assert_eq!(*locked(&pad.active), vec![true]);
        assert_eq!(*locked(&midi.active), vec![false]);
        locked(&queue).push(DeviceEvent::GamepadButton {
            pad: 1,
            button: GamepadButton::South,
            pressed: true,
        });
        locked(&queue).push(DeviceEvent::PointerButton {
            button: PointerButton::Left,
            pressed: true,
        });
        hub.set_watched(&kinds(&[DeviceKind::Pointer]));
        assert_eq!(*locked(&pad.active), vec![true, false]);
        let update = hub.collect().unwrap();
        assert_eq!(
            update.events,
            Some(vec![DeviceEvent::PointerButton {
                button: PointerButton::Left,
                pressed: true
            }])
        );
        assert!(update.pointer.is_some());
        hub.set_watched(&BTreeSet::new());
        assert_eq!(*locked(&pointer.active), vec![true, true, false]);
        assert_eq!(hub.collect(), None);
    }

    #[test]
    fn a_used_kind_without_a_working_adapter_is_a_problem() {
        let hub = DeviceHub::new(SharedQueue::default(), vec![Fake::new(DeviceKind::Midi)]);
        hub.set_watched(&kinds(&[DeviceKind::Midi, DeviceKind::Gamepad]));
        assert_eq!(
            hub.problems(),
            vec![(DeviceKind::Gamepad, DeviceStatus::Unsupported)]
        );
        hub.set_watched(&BTreeSet::new());
        assert!(hub.problems().is_empty());
    }
}
