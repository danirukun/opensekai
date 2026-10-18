//! Pointer: position normalized to the main display and button edges between two reads.
use opensekai_contracts::{DeviceEvent, PointerButton};

pub const BUTTONS: [PointerButton; 3] = [
    PointerButton::Left,
    PointerButton::Right,
    PointerButton::Middle,
];
const LIMIT: f64 = 16.0;

/// Display rectangle in global points, origin at the top left of the main display.
#[derive(Debug, Clone, Copy)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// 0,0 at the top left and 1,1 at the bottom right of the main display. Another display
/// gives values out of 0..1, clamped to -16..16.
pub fn normalize(x: f64, y: f64, bounds: Bounds) -> (f64, f64) {
    let axis = |value: f64, origin: f64, size: f64| {
        let n = (value - origin) / size;
        if size > 0.0 && n.is_finite() {
            ((n * 10_000.0).round() / 10_000.0).clamp(-LIMIT, LIMIT)
        } else {
            0.0
        }
    };
    (
        axis(x, bounds.x, bounds.width),
        axis(y, bounds.y, bounds.height),
    )
}

/// Pressed and released events for the buttons that changed since the previous read.
/// The first read after a start has no previous state and gives no events.
pub fn edges(previous: Option<[bool; 3]>, now: [bool; 3]) -> Vec<DeviceEvent> {
    let Some(previous) = previous else {
        return vec![];
    };
    BUTTONS
        .iter()
        .zip(previous.iter().zip(now))
        .filter(|(_, (was, is))| **was != *is)
        .map(|(button, (_, is))| DeviceEvent::PointerButton {
            button: *button,
            pressed: is,
        })
        .collect()
}

pub fn held(now: [bool; 3]) -> Option<Vec<PointerButton>> {
    let held: Vec<_> = BUTTONS
        .iter()
        .zip(now)
        .filter_map(|(button, down)| down.then_some(*button))
        .collect();
    (!held.is_empty()).then_some(held)
}

#[cfg(target_os = "macos")]
pub use macos::MacPointer;

#[cfg(target_os = "macos")]
mod macos {
    use super::{edges, held, normalize, Bounds};
    use crate::input::devices::{locked, DeviceAdapter, DeviceState, DeviceStatus, SharedQueue};
    use opensekai_contracts::{DeviceKind, PointerSnapshot};
    use std::ffi::c_void;
    use std::sync::Mutex;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *const c_void) -> *mut c_void;
        fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
        fn CGMainDisplayID() -> u32;
        fn CGDisplayBounds(display: u32) -> CGRect;
        fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(object: *const c_void);
    }
    const COMBINED_SESSION_STATE: i32 = 0; // kCGEventSourceStateCombinedSessionState

    /// Reads the pointer once for each clock. These calls need no permission.
    fn read() -> Option<(f64, f64, [bool; 3])> {
        // SAFETY: a NULL source gives a new event that holds the current location; it is
        // released here. The other calls only read state.
        unsafe {
            let event = CGEventCreate(std::ptr::null());
            if event.is_null() {
                return None;
            }
            let location = CGEventGetLocation(event);
            CFRelease(event);
            let rect = CGDisplayBounds(CGMainDisplayID());
            let (x, y) = normalize(
                location.x,
                location.y,
                Bounds {
                    x: rect.origin.x,
                    y: rect.origin.y,
                    width: rect.size.width,
                    height: rect.size.height,
                },
            );
            // CGMouseButton: 0 left, 1 right, 2 center.
            let buttons = [0, 1, 2].map(|b| CGEventSourceButtonState(COMBINED_SESSION_STATE, b));
            Some((x, y, buttons))
        }
    }

    #[derive(Default)]
    struct State {
        active: bool,
        previous: Option<[bool; 3]>,
    }
    pub struct MacPointer {
        state: Mutex<State>,
        queue: SharedQueue,
    }
    impl MacPointer {
        pub fn new(queue: SharedQueue) -> Self {
            Self {
                state: Mutex::default(),
                queue,
            }
        }
    }
    impl DeviceAdapter for MacPointer {
        fn kind(&self) -> DeviceKind {
            DeviceKind::Pointer
        }
        fn set_active(&self, active: bool) {
            let mut state = locked(&self.state);
            if !active {
                state.previous = None;
            }
            state.active = active;
        }
        fn poll(&self, out: &mut DeviceState) {
            let mut state = locked(&self.state);
            if !state.active {
                return;
            }
            let Some((x, y, buttons)) = read() else {
                return;
            };
            let events = edges(state.previous.replace(buttons), buttons);
            drop(state);
            let mut queue = locked(&self.queue);
            for event in events {
                queue.push(event);
            }
            out.pointer = Some(PointerSnapshot {
                x,
                y,
                buttons: held(buttons),
            });
        }
        fn status(&self) -> DeviceStatus {
            if locked(&self.state).active {
                DeviceStatus::Active
            } else {
                DeviceStatus::Idle
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const MAIN: Bounds = Bounds {
        x: 0.0,
        y: 0.0,
        width: 1512.0,
        height: 982.0,
    };

    #[test]
    fn normalizes_to_the_main_display_with_the_origin_at_the_top_left() {
        assert_eq!(normalize(0.0, 0.0, MAIN), (0.0, 0.0));
        assert_eq!(normalize(756.0, 491.0, MAIN), (0.5, 0.5));
        assert_eq!(normalize(1512.0, 982.0, MAIN), (1.0, 1.0));
        // A display to the left of the main display.
        assert_eq!(normalize(-756.0, 100.0, MAIN), (-0.5, 0.1018));
        assert_eq!(normalize(1e9, 0.0, MAIN), (16.0, 0.0));
        let empty = Bounds { width: 0.0, ..MAIN };
        assert_eq!(normalize(10.0, 491.0, empty), (0.0, 0.5));
    }

    #[test]
    fn gives_events_only_for_buttons_that_changed() {
        assert!(edges(None, [true, false, false]).is_empty());
        assert!(edges(Some([true, false, false]), [true, false, false]).is_empty());
        assert_eq!(
            edges(Some([true, false, false]), [false, false, true]),
            vec![
                DeviceEvent::PointerButton {
                    button: PointerButton::Left,
                    pressed: false
                },
                DeviceEvent::PointerButton {
                    button: PointerButton::Middle,
                    pressed: true
                },
            ]
        );
    }

    #[test]
    fn lists_held_buttons_only_when_one_is_down() {
        assert_eq!(held([false; 3]), None);
        assert_eq!(
            held([false, true, true]),
            Some(vec![PointerButton::Right, PointerButton::Middle])
        );
    }
}
