// The sources that the operator allowed in this app run (B31 R5). It is never saved.
use opensekai_contracts::CaptureSource;
use std::collections::VecDeque;
pub const MAX_ALLOWED_SOURCES: usize = 16;
#[derive(Debug, Default, Clone)]
pub struct AllowedSources(VecDeque<CaptureSource>);
impl AllowedSources {
    /// Only the editor-only `capture_source_allow` command calls this. A source that is allowed
    /// again becomes the newest; the oldest goes out over the limit.
    pub fn allow(&mut self, source: CaptureSource) {
        self.0.retain(|known| *known != source);
        if self.0.len() == MAX_ALLOWED_SOURCES {
            self.0.pop_front();
        }
        self.0.push_back(source);
    }
    pub fn contains(&self, source: &CaptureSource) -> bool {
        self.0.contains(source)
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn display(ordinal: u8) -> CaptureSource {
        CaptureSource::Display {
            name: "Display".into(),
            ordinal: ordinal % 8,
        }
    }
    fn window(n: usize) -> CaptureSource {
        CaptureSource::Window {
            app: "com.example.app".into(),
            title: format!("Window {n}"),
        }
    }
    #[test]
    fn a_source_compares_by_its_full_value() {
        let mut allowed = AllowedSources::default();
        allowed.allow(window(1));
        assert!(allowed.contains(&window(1)));
        assert!(!allowed.contains(&window(2)));
        assert!(!allowed.contains(&display(0)));
        allowed.allow(display(0));
        assert!(!allowed.contains(&display(1)));
    }
    #[test]
    fn the_oldest_source_goes_out_over_16() {
        let mut allowed = AllowedSources::default();
        for n in 0..MAX_ALLOWED_SOURCES {
            allowed.allow(window(n));
        }
        // Allowing a known source again makes it the newest, so it stays.
        allowed.allow(window(0));
        allowed.allow(window(100));
        assert_eq!(allowed.len(), MAX_ALLOWED_SOURCES);
        assert!(allowed.contains(&window(0)));
        assert!(!allowed.contains(&window(1)));
        assert!(allowed.contains(&window(100)));
    }
}
