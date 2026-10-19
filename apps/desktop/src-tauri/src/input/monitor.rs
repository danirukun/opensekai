//! Observes held keys in all apps without consuming them. Only watched keys are kept.
use std::collections::BTreeSet;
use std::sync::Arc;

pub const MAX_HELD: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MonitorStatus {
    Observing,
    NoAccess,
    Unsupported,
}

pub trait KeyMonitor: Send + Sync {
    /// Starts observation for a non-empty set and stops it for an empty one.
    fn set_watched(&self, codes: &BTreeSet<String>);
    fn held(&self) -> Vec<String>;
    fn status(&self) -> MonitorStatus;
}

#[derive(Default)]
pub struct HeldKeys {
    watched: BTreeSet<String>,
    down: BTreeSet<String>,
}
impl HeldKeys {
    pub fn set_watched(&mut self, codes: &BTreeSet<String>) {
        self.watched = codes.clone();
        self.down.retain(|code| codes.contains(code));
    }
    pub fn key(&mut self, code: &str, down: bool) {
        if !self.watched.contains(code) {
            return;
        }
        if down {
            self.down.insert(code.to_string());
        } else {
            self.down.remove(code);
        }
    }
    pub fn clear(&mut self) {
        self.down.clear();
    }
    /// Drops held keys that the system reports up, for key ups the tap did not see.
    pub fn retain_pressed(&mut self, pressed: impl Fn(&str) -> bool) {
        self.down.retain(|code| pressed(code));
    }
    pub fn snapshot(&self) -> Vec<String> {
        self.down.iter().take(MAX_HELD).cloned().collect()
    }
}

/// macOS virtual key codes (Events.h, kVK_*) for the codes in fixtures/protocol/keystroke-codes.json.
pub fn dom_code(keycode: u16) -> Option<&'static str> {
    Some(match keycode {
        0x00 => "KeyA",
        0x0B => "KeyB",
        0x08 => "KeyC",
        0x02 => "KeyD",
        0x0E => "KeyE",
        0x03 => "KeyF",
        0x05 => "KeyG",
        0x04 => "KeyH",
        0x22 => "KeyI",
        0x26 => "KeyJ",
        0x28 => "KeyK",
        0x25 => "KeyL",
        0x2E => "KeyM",
        0x2D => "KeyN",
        0x1F => "KeyO",
        0x23 => "KeyP",
        0x0C => "KeyQ",
        0x0F => "KeyR",
        0x01 => "KeyS",
        0x11 => "KeyT",
        0x20 => "KeyU",
        0x09 => "KeyV",
        0x0D => "KeyW",
        0x07 => "KeyX",
        0x10 => "KeyY",
        0x06 => "KeyZ",
        0x1D => "Digit0",
        0x12 => "Digit1",
        0x13 => "Digit2",
        0x14 => "Digit3",
        0x15 => "Digit4",
        0x17 => "Digit5",
        0x16 => "Digit6",
        0x1A => "Digit7",
        0x1C => "Digit8",
        0x19 => "Digit9",
        0x52 => "Numpad0",
        0x53 => "Numpad1",
        0x54 => "Numpad2",
        0x55 => "Numpad3",
        0x56 => "Numpad4",
        0x57 => "Numpad5",
        0x58 => "Numpad6",
        0x59 => "Numpad7",
        0x5B => "Numpad8",
        0x5C => "Numpad9",
        0x7A => "F1",
        0x78 => "F2",
        0x63 => "F3",
        0x76 => "F4",
        0x60 => "F5",
        0x61 => "F6",
        0x62 => "F7",
        0x64 => "F8",
        0x65 => "F9",
        0x6D => "F10",
        0x67 => "F11",
        0x6F => "F12",
        0x69 => "F13",
        0x6B => "F14",
        0x71 => "F15",
        0x6A => "F16",
        0x40 => "F17",
        0x4F => "F18",
        0x50 => "F19",
        0x5A => "F20",
        0x31 => "Space",
        0x24 => "Enter",
        0x33 => "Backspace",
        0x30 => "Tab",
        0x7E => "ArrowUp",
        0x7D => "ArrowDown",
        0x7B => "ArrowLeft",
        0x7C => "ArrowRight",
        _ => return None,
    })
}

pub fn mac_keycode(code: &str) -> Option<u16> {
    (0u16..128).find(|keycode| dom_code(*keycode) == Some(code))
}

/// When the tap thread must start, keep running, or exit. A start that arrives while the
/// thread shuts down keeps that thread running instead of being lost.
#[derive(Default)]
pub struct Lifecycle {
    desired: bool,
    running: bool,
}
impl Lifecycle {
    /// Returns true when the caller must spawn a tap thread.
    pub fn request_start(&mut self) -> bool {
        self.desired = true;
        !std::mem::replace(&mut self.running, true)
    }
    pub fn request_stop(&mut self) {
        self.desired = false;
    }
    /// Called by the tap thread between run loop slices; false means it must exit now.
    pub fn keep_running(&mut self) -> bool {
        self.running = self.desired;
        self.running
    }
    /// The thread could not create its tap.
    pub fn abandon(&mut self) {
        self.running = false;
    }
    pub fn running(&self) -> bool {
        self.running
    }
}

pub struct NoKeyMonitor;
impl KeyMonitor for NoKeyMonitor {
    fn set_watched(&self, _: &BTreeSet<String>) {}
    fn held(&self) -> Vec<String> {
        vec![]
    }
    fn status(&self) -> MonitorStatus {
        MonitorStatus::Unsupported
    }
}

pub fn platform_monitor() -> Arc<dyn KeyMonitor> {
    #[cfg(target_os = "macos")]
    {
        Arc::new(macos::MacKeyMonitor::default())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Arc::new(NoKeyMonitor)
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{dom_code, mac_keycode, HeldKeys, KeyMonitor, Lifecycle, MonitorStatus};
    use crate::input::locked;
    use std::collections::BTreeSet;
    use std::ffi::c_void;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    type Ref = *mut c_void;
    type Callback = extern "C" fn(Ref, u32, Ref, *mut c_void) -> Ref;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventTapCreate(
            tap: u32,
            place: u32,
            options: u32,
            mask: u64,
            callback: Callback,
            refcon: *mut c_void,
        ) -> Ref;
        fn CGEventTapEnable(tap: Ref, enable: bool);
        fn CGEventGetIntegerValueField(event: Ref, field: u32) -> i64;
        fn CGPreflightListenEventAccess() -> bool;
        fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
        fn CGRequestListenEventAccess() -> bool;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFRunLoopCommonModes: *const c_void;
        static kCFRunLoopDefaultMode: *const c_void;
        fn CFRunLoopRunInMode(mode: *const c_void, seconds: f64, return_after_source: u8) -> i32;
        fn CFMachPortCreateRunLoopSource(allocator: *const c_void, port: Ref, order: isize) -> Ref;
        fn CFMachPortInvalidate(port: Ref);
        fn CFRunLoopGetCurrent() -> Ref;
        fn CFRunLoopAddSource(run_loop: Ref, source: Ref, mode: *const c_void);
        fn CFRelease(object: *const c_void);
    }
    const SESSION_TAP: u32 = 1; // kCGSessionEventTap
    const HEAD_INSERT: u32 = 0; // kCGHeadInsertEventTap
    const LISTEN_ONLY: u32 = 1; // kCGEventTapOptionListenOnly
    const KEY_DOWN: u32 = 10;
    const KEY_UP: u32 = 11;
    const DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
    const DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;
    const KEYCODE_FIELD: u32 = 9; // kCGKeyboardEventKeycode
    const HID_STATE: i32 = 1; // kCGEventSourceStateHIDSystemState
    /// The tap thread checks the lifecycle at this interval.
    const SLICE_SECONDS: f64 = 0.25;

    /// A CoreFoundation pointer that the owning thread shares only to stop or re-enable the tap.
    #[derive(Clone, Copy)]
    struct Shared(Ref);
    unsafe impl Send for Shared {}

    struct Tap {
        keys: Arc<Mutex<HeldKeys>>,
        port: Mutex<Option<Shared>>,
    }

    extern "C" fn callback(_: Ref, kind: u32, event: Ref, refcon: *mut c_void) -> Ref {
        // SAFETY: refcon is the Tap that the tap thread keeps alive until its run loop exits.
        let tap = unsafe { &*(refcon as *const Tap) };
        match kind {
            KEY_DOWN | KEY_UP => {
                let keycode = unsafe { CGEventGetIntegerValueField(event, KEYCODE_FIELD) } as u16;
                if let Some(code) = dom_code(keycode) {
                    locked(&tap.keys).key(code, kind == KEY_DOWN);
                }
            }
            DISABLED_BY_TIMEOUT | DISABLED_BY_USER_INPUT => {
                // A key up can be lost while the tap is off.
                locked(&tap.keys).clear();
                if let Some(Shared(port)) = *locked(&tap.port) {
                    unsafe { CGEventTapEnable(port, true) };
                }
            }
            _ => {}
        }
        // A listen-only tap ignores the return value; the event passes unchanged.
        event
    }

    #[derive(Default)]
    struct State {
        life: Lifecycle,
        requested: bool,
        no_access: bool,
        last_check: Option<Instant>,
    }

    #[derive(Default)]
    pub struct MacKeyMonitor {
        keys: Arc<Mutex<HeldKeys>>,
        state: Arc<Mutex<State>>,
        watched: Mutex<BTreeSet<String>>,
    }

    impl MacKeyMonitor {
        fn start(&self) {
            let mut state = locked(&self.state);
            if !unsafe { CGPreflightListenEventAccess() } {
                if !state.requested {
                    state.requested = true;
                    unsafe { CGRequestListenEventAccess() };
                }
                state.no_access = true;
                return;
            }
            state.no_access = false;
            if !state.life.request_start() {
                return;
            }
            let (keys, shared_state) = (self.keys.clone(), self.state.clone());
            let spawned = std::thread::Builder::new()
                .name("opensekai-key-monitor".into())
                .spawn(move || run_tap(keys, shared_state));
            if spawned.is_err() {
                state.life.abandon();
            }
        }
    }

    fn run_tap(keys: Arc<Mutex<HeldKeys>>, state: Arc<Mutex<State>>) {
        let tap = Box::new(Tap {
            keys,
            port: Mutex::new(None),
        });
        let refcon = &*tap as *const Tap as *mut c_void;
        let mask = (1u64 << KEY_DOWN) | (1u64 << KEY_UP);
        let port = unsafe {
            CGEventTapCreate(
                SESSION_TAP,
                HEAD_INSERT,
                LISTEN_ONLY,
                mask,
                callback,
                refcon,
            )
        };
        if port.is_null() {
            let mut state = locked(&state);
            state.life.abandon();
            state.no_access = true;
            return;
        }
        *locked(&tap.port) = Some(Shared(port));
        unsafe {
            let source = CFMachPortCreateRunLoopSource(std::ptr::null(), port, 0);
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
            CGEventTapEnable(port, true);
            // Short slices instead of CFRunLoopStop: the lifecycle decides under one lock.
            while locked(&state).life.keep_running() {
                CFRunLoopRunInMode(kCFRunLoopDefaultMode, SLICE_SECONDS, 0);
            }
            CGEventTapEnable(port, false);
            CFMachPortInvalidate(port);
            CFRelease(source);
            CFRelease(port);
        }
        // The callback cannot run after the tap is invalidated, so the refcon can go.
        drop(tap);
    }

    impl KeyMonitor for MacKeyMonitor {
        fn set_watched(&self, codes: &BTreeSet<String>) {
            *locked(&self.watched) = codes.clone();
            locked(&self.keys).set_watched(codes);
            if codes.is_empty() {
                locked(&self.state).life.request_stop();
            } else {
                self.start();
            }
        }
        fn held(&self) -> Vec<String> {
            // After the operator grants access, a clock tick (at most once a second) starts the tap.
            let (retry, running) = {
                let mut state = locked(&self.state);
                let due = state.no_access
                    && !state.life.running()
                    && state
                        .last_check
                        .is_none_or(|t| t.elapsed() >= Duration::from_secs(1));
                if due {
                    state.last_check = Some(Instant::now());
                }
                (due, state.life.running())
            };
            if retry && !locked(&self.watched).is_empty() {
                self.start();
            }
            let mut keys = locked(&self.keys);
            if running {
                // Secure input can hide a key up from the tap without disabling it.
                keys.retain_pressed(|code| {
                    mac_keycode(code)
                        .is_some_and(|keycode| unsafe { CGEventSourceKeyState(HID_STATE, keycode) })
                });
            }
            keys.snapshot()
        }
        fn status(&self) -> MonitorStatus {
            if locked(&self.state).no_access {
                MonitorStatus::NoAccess
            } else {
                MonitorStatus::Observing
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    fn set(codes: &[&str]) -> BTreeSet<String> {
        codes.iter().map(|c| c.to_string()).collect()
    }

    #[test]
    fn reports_only_watched_keys_that_are_down() {
        let mut keys = HeldKeys::default();
        keys.set_watched(&set(&["KeyW", "KeyS"]));
        keys.key("KeyW", true);
        keys.key("KeyQ", true);
        assert_eq!(keys.snapshot(), vec!["KeyW".to_string()]);
        keys.key("KeyW", false);
        assert!(keys.snapshot().is_empty());
    }

    #[test]
    fn clears_held_keys_on_disable_and_when_unwatched() {
        let mut keys = HeldKeys::default();
        keys.set_watched(&set(&["KeyW", "KeyS"]));
        keys.key("KeyW", true);
        keys.key("KeyS", true);
        keys.set_watched(&set(&["KeyS"]));
        assert_eq!(keys.snapshot(), vec!["KeyS".to_string()]);
        keys.clear();
        assert!(keys.snapshot().is_empty());
    }

    #[test]
    fn maps_mac_keycodes_to_dom_codes() {
        assert_eq!(dom_code(0x0D), Some("KeyW"));
        assert_eq!(dom_code(0x00), Some("KeyA"));
        assert_eq!(dom_code(0x01), Some("KeyS"));
        assert_eq!(dom_code(0x02), Some("KeyD"));
        assert_eq!(dom_code(0x31), Some("Space"));
        assert_eq!(dom_code(0x7E), Some("ArrowUp"));
        assert_eq!(dom_code(0x38), None); // Shift is not in the code list
    }

    #[test]
    fn a_start_during_shutdown_keeps_the_tap_running() {
        let mut life = Lifecycle::default();
        assert!(life.request_start()); // spawn the tap thread
        assert!(!life.request_start()); // already running
        life.request_stop();
        assert!(!life.request_start()); // the thread has not exited yet
        assert!(life.keep_running()); // so it keeps running instead of exiting
        life.request_stop();
        assert!(!life.keep_running()); // now it exits
        assert!(life.request_start()); // and a later start spawns a new thread
    }

    #[test]
    fn a_stop_before_the_thread_runs_ends_it() {
        let mut life = Lifecycle::default();
        assert!(life.request_start());
        life.request_stop();
        assert!(!life.keep_running());
    }

    #[test]
    fn drops_keys_that_the_system_reports_up() {
        let mut keys = HeldKeys::default();
        keys.set_watched(&set(&["KeyW", "KeyS"]));
        keys.key("KeyW", true);
        keys.key("KeyS", true);
        keys.retain_pressed(|code| code == "KeyS");
        assert_eq!(keys.snapshot(), vec!["KeyS".to_string()]);
    }

    #[test]
    fn maps_dom_codes_back_to_mac_keycodes() {
        assert_eq!(mac_keycode("KeyW"), Some(0x0D));
        assert_eq!(mac_keycode("F21"), None);
    }

    #[test]
    fn the_stub_reports_unsupported_and_no_keys() {
        let monitor = NoKeyMonitor;
        monitor.set_watched(&set(&["KeyW"]));
        assert!(monitor.held().is_empty());
        assert!(matches!(monitor.status(), MonitorStatus::Unsupported));
    }
}
