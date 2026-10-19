//! Device input on the clock (gamepad, MIDI, pointer). Mirrors `packages/contracts/src/devices.ts`.
use super::*;

pub const MAX_DEVICE_EVENTS: usize = 32;
pub const MAX_GAMEPADS: u8 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceKind {
    Gamepad,
    Midi,
    Pointer,
}
impl DeviceKind {
    pub const ALL: [DeviceKind; 3] = [DeviceKind::Gamepad, DeviceKind::Midi, DeviceKind::Pointer];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GamepadButton {
    South,
    East,
    West,
    North,
    LeftBumper,
    RightBumper,
    LeftTrigger,
    RightTrigger,
    Select,
    Start,
    Mode,
    LeftStick,
    RightStick,
    DpadUp,
    DpadDown,
    DpadLeft,
    DpadRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PointerButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum DeviceEvent {
    GamepadButton {
        pad: u8,
        button: GamepadButton,
        pressed: bool,
    },
    MidiNote {
        channel: u8,
        note: u8,
        velocity: u8,
        on: bool,
    },
    MidiControl {
        channel: u8,
        controller: u8,
        value: u8,
    },
    PointerButton {
        button: PointerButton,
        pressed: bool,
    },
}

/// Non-zero axis values after the dead zone. Sticks are -1..1 (Y up), triggers 0..1.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GamepadAxes {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left_x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left_y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right_x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right_y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left_trigger: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right_trigger: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GamepadSnapshot {
    pub pad: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buttons: Option<Vec<GamepadButton>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axes: Option<GamepadAxes>,
}

/// Normalized to the main display: 0,0 at the top left, 1,1 at the bottom right.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PointerSnapshot {
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buttons: Option<Vec<PointerButton>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceUpdate {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<DeviceEvent>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gamepads: Option<Vec<GamepadSnapshot>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pointer: Option<PointerSnapshot>,
}

fn unique<T: Ord>(items: &[T]) -> bool {
    items
        .iter()
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        == items.len()
}
fn in_range(value: f64, low: f64, high: f64) -> bool {
    value.is_finite() && (low..=high).contains(&value)
}
fn pad_ok(pad: u8) -> bool {
    (1..=MAX_GAMEPADS).contains(&pad)
}

impl DeviceEvent {
    pub fn validate(&self) -> Result<(), AppError> {
        let ok = match *self {
            DeviceEvent::GamepadButton { pad, .. } => pad_ok(pad),
            DeviceEvent::MidiNote {
                channel,
                note,
                velocity,
                ..
            } => (1..=16).contains(&channel) && note <= 127 && velocity <= 127,
            DeviceEvent::MidiControl {
                channel,
                controller,
                value,
            } => (1..=16).contains(&channel) && controller <= 127 && value <= 127,
            DeviceEvent::PointerButton { .. } => true,
        };
        require(ok, "invalid device event")
    }
}

impl DeviceUpdate {
    pub fn validate(&self) -> Result<(), AppError> {
        require(
            self.events.is_some() || self.gamepads.is_some() || self.pointer.is_some(),
            "empty device update",
        )?;
        if let Some(events) = &self.events {
            require(
                (1..=MAX_DEVICE_EVENTS).contains(&events.len()),
                "invalid device event count",
            )?;
            for event in events {
                event.validate()?;
            }
        }
        if let Some(pads) = &self.gamepads {
            let ids: Vec<u8> = pads.iter().map(|p| p.pad).collect();
            require(
                (1..=MAX_GAMEPADS as usize).contains(&pads.len()) && unique(&ids),
                "invalid gamepads",
            )?;
            for pad in pads {
                let stick = |v: Option<f64>| v.is_none_or(|v| in_range(v, -1.0, 1.0));
                let trigger = |v: Option<f64>| v.is_none_or(|v| in_range(v, 0.0, 1.0));
                require(
                    pad_ok(pad.pad)
                        && pad
                            .buttons
                            .as_ref()
                            .is_none_or(|b| !b.is_empty() && unique(b))
                        && pad.axes.as_ref().is_none_or(|a| {
                            stick(a.left_x)
                                && stick(a.left_y)
                                && stick(a.right_x)
                                && stick(a.right_y)
                                && trigger(a.left_trigger)
                                && trigger(a.right_trigger)
                        }),
                    "invalid gamepad",
                )?;
            }
        }
        if let Some(pointer) = &self.pointer {
            require(
                in_range(pointer.x, -16.0, 16.0)
                    && in_range(pointer.y, -16.0, 16.0)
                    && pointer
                        .buttons
                        .as_ref()
                        .is_none_or(|b| !b.is_empty() && unique(b)),
                "invalid pointer",
            )?;
        }
        Ok(())
    }
}

/// The device kinds that enabled graphs read: 1 to 3 unique kinds when present.
pub fn validate_device_kinds(kinds: &Option<Vec<DeviceKind>>) -> Result<(), AppError> {
    require(
        kinds
            .as_ref()
            .is_none_or(|k| !k.is_empty() && k.len() <= DeviceKind::ALL.len() && unique(k)),
        "invalid device kinds",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn update(value: Value) -> Result<(), AppError> {
        serde_json::from_value::<DeviceUpdate>(value)
            .map_err(|e| invalid(e.to_string()))?
            .validate()
    }

    #[test]
    fn accepts_events_and_state_in_wire_names() {
        let value = json!({
            "events": [
                {"kind": "gamepadButton", "pad": 1, "button": "dpadUp", "pressed": true},
                {"kind": "midiNote", "channel": 16, "note": 127, "velocity": 0, "on": false},
                {"kind": "midiControl", "channel": 1, "controller": 7, "value": 64},
                {"kind": "pointerButton", "button": "middle", "pressed": false}
            ],
            "gamepads": [{"pad": 4, "buttons": ["leftBumper"], "axes": {"leftX": -1.0, "rightTrigger": 1.0}}],
            "pointer": {"x": 0.5, "y": -0.25, "buttons": ["left"]}
        });
        assert!(update(value.clone()).is_ok());
        let parsed: DeviceUpdate = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    }

    #[test]
    fn rejects_values_out_of_range_and_empty_lists() {
        for bad in [
            json!({}),
            json!({"events": []}),
            json!({"events": [{"kind": "midiNote", "channel": 0, "note": 1, "velocity": 1, "on": true}]}),
            json!({"events": [{"kind": "midiControl", "channel": 1, "controller": 128, "value": 1}]}),
            json!({"events": [{"kind": "gamepadButton", "pad": 5, "button": "south", "pressed": true}]}),
            json!({"gamepads": [{"pad": 1}, {"pad": 1}]}),
            json!({"gamepads": [{"pad": 1, "buttons": []}]}),
            json!({"gamepads": [{"pad": 1, "axes": {"leftTrigger": -0.1}}]}),
            json!({"pointer": {"x": 16.5, "y": 0}}),
            json!({"pointer": {"x": 0, "y": 0, "buttons": ["left", "left"]}}),
        ] {
            assert!(update(bad.clone()).is_err(), "{bad}");
        }
        let many: Vec<Value> = (0..33)
            .map(|_| json!({"kind": "pointerButton", "button": "left", "pressed": true}))
            .collect();
        assert!(update(json!({ "events": many })).is_err());
    }

    #[test]
    fn the_largest_device_clock_fits_the_tracking_clock_limit() {
        let all_buttons: Vec<GamepadButton> = serde_json::from_value(json!([
            "south",
            "east",
            "west",
            "north",
            "leftBumper",
            "rightBumper",
            "leftTrigger",
            "rightTrigger",
            "select",
            "start",
            "mode",
            "leftStick",
            "rightStick",
            "dpadUp",
            "dpadDown",
            "dpadLeft",
            "dpadRight"
        ]))
        .unwrap();
        let axes = GamepadAxes {
            left_x: Some(-0.1234),
            left_y: Some(-0.1234),
            right_x: Some(-0.1234),
            right_y: Some(-0.1234),
            left_trigger: Some(0.1234),
            right_trigger: Some(0.1234),
        };
        let devices = DeviceUpdate {
            events: Some(vec![
                DeviceEvent::MidiNote {
                    channel: 16,
                    note: 127,
                    velocity: 127,
                    on: false
                };
                MAX_DEVICE_EVENTS
            ]),
            gamepads: Some(
                (1..=MAX_GAMEPADS)
                    .map(|pad| GamepadSnapshot {
                        pad,
                        buttons: Some(all_buttons.clone()),
                        axes: Some(axes.clone()),
                    })
                    .collect(),
            ),
            pointer: Some(PointerSnapshot {
                x: -15.1234,
                y: -15.1234,
                buttons: Some(vec![
                    PointerButton::Left,
                    PointerButton::Right,
                    PointerButton::Middle,
                ]),
            }),
        };
        let input = InputUpdate {
            events: vec![
                InputEvent::Keystroke {
                    accelerator: "Control+Alt+Shift+Super+ArrowRight".into()
                };
                16
            ],
            held: vec!["ArrowRight".into(); 16],
            devices: Some(devices),
        };
        let clock = json!({"kind": "clock", "sessionId": "s".repeat(256), "elapsedMs": 9_007_199_254_740_991u64, "input": input});
        let bytes = clock.to_string().into_bytes();
        assert!(
            bytes.len() > MAX_CLOCK_BYTES && bytes.len() < MAX_TRACKING_CLOCK_BYTES / 4,
            "{}",
            bytes.len()
        );
        assert!(parse_wire(&bytes).is_ok());
    }

    #[test]
    fn device_kind_lists_are_unique_and_not_empty() {
        assert!(validate_device_kinds(&None).is_ok());
        assert!(validate_device_kinds(&Some(vec![DeviceKind::Midi])).is_ok());
        assert!(validate_device_kinds(&Some(vec![])).is_err());
        assert!(validate_device_kinds(&Some(vec![DeviceKind::Midi, DeviceKind::Midi])).is_err());
    }
}
