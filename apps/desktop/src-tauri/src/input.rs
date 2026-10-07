use opensekai_contracts::{InputEvent, InputUpdate};
use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::Mutex;

pub const QUEUE_CAPACITY: usize = 64;
pub const EVENTS_PER_CLOCK: usize = 16;

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
pub struct KeyLatch(HashSet<u32>);
impl KeyLatch {
    pub fn press(&mut self, id: u32) -> bool {
        self.0.insert(id)
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
        })
    }
}

fn locked<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub struct GlobalKeystrokes<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
    registered: Mutex<HashMap<u32, String>>,
    latch: Mutex<KeyLatch>,
}
impl<R: tauri::Runtime> GlobalKeystrokes<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self {
        Self {
            app,
            registered: Mutex::default(),
            latch: Mutex::default(),
        }
    }
    /// The accelerator for a new physical press; None for a repeat or a release.
    pub fn event(&self, id: u32, pressed: bool) -> Option<String> {
        let mut latch = locked(&self.latch);
        if !pressed {
            latch.release(id);
            return None;
        }
        if !latch.press(id) {
            return None;
        }
        locked(&self.registered).get(&id).cloned()
    }
}
impl<R: tauri::Runtime> KeystrokeRegistrar for GlobalKeystrokes<R> {
    fn reconcile(&self, wanted: &BTreeSet<String>) -> Vec<String> {
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
        let shortcuts = self.app.global_shortcut();
        let mut registered = locked(&self.registered);
        registered.retain(|_, accelerator| {
            let keep = wanted.contains(accelerator);
            if !keep {
                if let Ok(s) = accelerator.parse::<Shortcut>() {
                    let _ = shortcuts.unregister(s);
                }
            }
            keep
        });
        let mut failed = vec![];
        for accelerator in wanted {
            if registered.values().any(|a| a == accelerator) {
                continue;
            }
            match accelerator.parse::<Shortcut>() {
                Ok(s) => {
                    let id = s.id();
                    if shortcuts.register(s).is_ok() {
                        registered.insert(id, accelerator.clone());
                    } else {
                        failed.push(accelerator.clone());
                    }
                }
                Err(_) => failed.push(accelerator.clone()),
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
        let mut latch = KeyLatch::default();
        assert!(latch.press(7));
        assert!(!latch.press(7));
        latch.release(7);
        assert!(latch.press(7));
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
}
