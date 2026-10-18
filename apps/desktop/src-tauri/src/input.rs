pub mod monitor;
use opensekai_contracts::{InputEvent, InputUpdate};
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const QUEUE_CAPACITY: usize = 64;
pub const EVENTS_PER_CLOCK: usize = 16;
/// A key latched longer than this has lost its release; the next press counts as new.
pub const LATCH_TIMEOUT: Duration = Duration::from_secs(10);

pub trait KeystrokeRegistrar: Send + Sync {
    fn reconcile(&self, wanted: &BTreeSet<String>) -> Vec<String>;
}
pub struct NoKeystrokes;
impl KeystrokeRegistrar for NoKeystrokes {
    fn reconcile(&self, _: &BTreeSet<String>) -> Vec<String> {
        vec![]
    }
}

#[derive(Default)]
pub struct KeyLatch(HashMap<u32, Instant>);
impl KeyLatch {
    pub fn press(&mut self, id: u32, now: Instant) -> bool {
        match self.0.get(&id) {
            Some(since) if now.saturating_duration_since(*since) <= LATCH_TIMEOUT => false,
            _ => {
                self.0.insert(id, now);
                true
            }
        }
    }
    pub fn release(&mut self, id: u32) {
        self.0.remove(&id);
    }
}

#[derive(Default)]
pub struct InputQueue(VecDeque<String>);
impl InputQueue {
    pub fn push(&mut self, accelerator: String) {
        if self.0.len() == QUEUE_CAPACITY {
            self.0.pop_front();
        }
        self.0.push_back(accelerator);
    }
    pub fn drain(&mut self) -> Option<InputUpdate> {
        let n = self.0.len().min(EVENTS_PER_CLOCK);
        (n > 0).then(|| InputUpdate {
            events: self
                .0
                .drain(..n)
                .map(|accelerator| InputEvent::Keystroke { accelerator })
                .collect(),
            held: vec![],
            devices: None,
        })
    }
}

fn locked<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Accelerator bookkeeping that never touches the plugin, so no lock is held across it.
#[derive(Default)]
pub struct Bookkeeping {
    registered: HashMap<u32, String>,
    latch: KeyLatch,
}
impl Bookkeeping {
    /// The accelerator for a new physical press; None for a repeat or a release.
    pub fn event(&mut self, id: u32, pressed: bool, now: Instant) -> Option<String> {
        if !pressed {
            self.latch.release(id);
            return None;
        }
        if !self.latch.press(id, now) {
            return None;
        }
        self.registered.get(&id).cloned()
    }
    /// Accelerators to unregister. Their ids leave the map and the latch, because a key
    /// held while unregistered never reports its release.
    pub fn take_stale(&mut self, wanted: &BTreeSet<String>) -> Vec<(u32, String)> {
        let stale: Vec<_> = self
            .registered
            .iter()
            .filter(|(_, a)| !wanted.contains(*a))
            .map(|(id, a)| (*id, a.clone()))
            .collect();
        for (id, _) in &stale {
            self.registered.remove(id);
            self.latch.release(*id);
        }
        stale
    }
    pub fn missing(&self, wanted: &BTreeSet<String>) -> Vec<String> {
        wanted
            .iter()
            .filter(|a| !self.registered.values().any(|r| r == *a))
            .cloned()
            .collect()
    }
    pub fn insert(&mut self, id: u32, accelerator: String) {
        self.registered.insert(id, accelerator);
    }
}

pub struct GlobalKeystrokes<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
    state: Mutex<Bookkeeping>,
}
impl<R: tauri::Runtime> GlobalKeystrokes<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self {
        Self {
            app,
            state: Mutex::default(),
        }
    }
    /// Called from the main-thread shortcut handler; the lock is never held across plugin calls.
    pub fn event(&self, id: u32, pressed: bool) -> Option<String> {
        locked(&self.state).event(id, pressed, Instant::now())
    }
}
impl<R: tauri::Runtime> KeystrokeRegistrar for GlobalKeystrokes<R> {
    fn reconcile(&self, wanted: &BTreeSet<String>) -> Vec<String> {
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
        let shortcuts = self.app.global_shortcut();
        let (stale, missing) = {
            let mut state = locked(&self.state);
            (state.take_stale(wanted), state.missing(wanted))
        };
        for (_, accelerator) in stale {
            if let Ok(s) = accelerator.parse::<Shortcut>() {
                let _ = shortcuts.unregister(s);
            }
        }
        let mut failed = vec![];
        for accelerator in missing {
            match accelerator.parse::<Shortcut>() {
                Ok(s) => {
                    let id = s.id();
                    if shortcuts.register(s).is_ok() {
                        locked(&self.state).insert(id, accelerator);
                    } else {
                        failed.push(accelerator);
                    }
                }
                Err(_) => failed.push(accelerator),
            }
        }
        failed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn latch_fires_once_per_physical_press() {
        let now = Instant::now();
        let mut latch = KeyLatch::default();
        assert!(latch.press(7, now));
        assert!(!latch.press(7, now));
        latch.release(7);
        assert!(latch.press(7, now));
    }
    #[test]
    fn latch_treats_a_press_after_ten_seconds_as_new_because_the_release_was_lost() {
        let start = Instant::now();
        let mut latch = KeyLatch::default();
        assert!(latch.press(7, start));
        assert!(!latch.press(7, start + LATCH_TIMEOUT));
        assert!(latch.press(7, start + LATCH_TIMEOUT + Duration::from_millis(1)));
        assert!(!latch.press(7, start + LATCH_TIMEOUT + Duration::from_secs(5)));
    }
    #[test]
    fn queue_drops_oldest_and_drains_sixteen_per_clock() {
        let mut q = InputQueue::default();
        for i in 0..70 {
            q.push(format!("Control+F{}", i % 24 + 1));
        }
        let first = q.drain().unwrap();
        assert_eq!(first.events.len(), 16);
        assert_eq!(
            first.events[0],
            InputEvent::Keystroke {
                accelerator: "Control+F7".into()
            }
        );
        let mut total = 16;
        while let Some(u) = q.drain() {
            total += u.events.len();
        }
        assert_eq!(total, 64);
    }
    #[test]
    fn every_allowed_code_parses_as_a_global_shortcut() {
        let codes: Vec<String> = serde_json::from_str(include_str!(
            "../../../../fixtures/protocol/keystroke-codes.json"
        ))
        .unwrap();
        for code in codes {
            let accelerator = format!("Control+Alt+Shift+Super+{code}");
            assert!(
                accelerator
                    .parse::<tauri_plugin_global_shortcut::Shortcut>()
                    .is_ok(),
                "{accelerator}"
            );
        }
    }
    #[test]
    fn unregistering_releases_a_held_key_so_the_next_press_fires() {
        let now = Instant::now();
        let mut b = Bookkeeping::default();
        b.insert(7, "Control+Alt+KeyH".into());
        assert_eq!(b.event(7, true, now).as_deref(), Some("Control+Alt+KeyH"));
        assert!(b.event(7, true, now).is_none());
        let stale = b.take_stale(&BTreeSet::new());
        assert_eq!(stale, vec![(7, "Control+Alt+KeyH".to_string())]);
        b.insert(7, "Control+Alt+KeyH".into());
        assert_eq!(b.event(7, true, now).as_deref(), Some("Control+Alt+KeyH"));
    }
    #[test]
    fn diff_lists_only_missing_accelerators() {
        let mut b = Bookkeeping::default();
        b.insert(1, "A".into());
        let wanted: BTreeSet<String> = ["A".to_string(), "B".to_string()].into();
        assert_eq!(b.missing(&wanted), vec!["B".to_string()]);
        assert!(b.take_stale(&wanted).is_empty());
    }
}
