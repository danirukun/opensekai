//! Gamepads: player slots, dead zones, and the `gilrs` adapter (macOS and Windows).
use opensekai_contracts::{GamepadAxes, GamepadButton, GamepadSnapshot, MAX_GAMEPADS};
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
    use super::{snapshot, PadSlots, RawAxes};
    use crate::input::devices::{locked, DeviceAdapter, DeviceState, DeviceStatus, SharedQueue};
    use gilrs::{Axis, Button, EventType, Gilrs};
    use opensekai_contracts::{DeviceEvent, DeviceKind, GamepadButton, GamepadSnapshot};
    use std::collections::BTreeSet;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    /// The event wait of the adapter thread.
    const WAIT: Duration = Duration::from_millis(100);
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

    fn read_pads(gilrs: &Gilrs, slots: &PadSlots) -> Vec<GamepadSnapshot> {
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

    fn run(state: Arc<Mutex<State>>, queue: SharedQueue) {
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
        let mut slots = PadSlots::default();
        let ids: Vec<usize> = gilrs.gamepads().map(|(id, _)| id.into()).collect();
        for id in ids {
            slots.assign(id);
        }
        loop {
            let event = gilrs.next_event_blocking(Some(WAIT));
            let active = locked(&state).active;
            let mut pressed = None;
            if let Some(event) = event {
                let id: usize = event.id.into();
                match event.event {
                    EventType::Connected => {
                        slots.assign(id);
                    }
                    EventType::Disconnected => {
                        slots.release(id);
                    }
                    EventType::ButtonPressed(b, _) => pressed = Some((id, b, true)),
                    EventType::ButtonReleased(b, _) => pressed = Some((id, b, false)),
                    _ => {}
                }
            }
            if !active {
                continue;
            }
            if let Some((id, b, down)) = pressed {
                if let (Some(pad), Some(b)) = (slots.slot(id), button(b)) {
                    locked(&queue).push(DeviceEvent::GamepadButton {
                        pad,
                        button: b,
                        pressed: down,
                    });
                }
            }
            let pads = read_pads(&gilrs, &slots);
            let mut state = locked(&state);
            // A stop that came during the read keeps the state empty.
            if state.active {
                state.pads = pads;
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
            if std::mem::replace(&mut state.started, true) {
                return;
            }
            let (shared, queue) = (self.state.clone(), self.queue.clone());
            let spawned = std::thread::Builder::new()
                .name("opensekai-gamepad".into())
                .spawn(move || run(shared, queue));
            if spawned.is_err() {
                state.started = false;
                state.status = Some(DeviceStatus::Unavailable);
            }
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
