// Pure capture planning (B31 R7, R8). No platform call happens here.
use super::adapter::{Inventory, PlatformTarget, WindowInfo};
use super::allow::AllowedSources;
use opensekai_contracts::{
    normalize_capture_text, CaptureSource, Id, SceneEntity, SceneView, ScreenContent,
    MAX_CAPTURE_APP, MAX_CAPTURE_NAME, MAX_CAPTURE_SCREENS, MAX_CAPTURE_TITLE,
};

/// Screens with one source and one cursor value share one stream.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct StreamKey {
    pub source: CaptureSource,
    pub cursor: bool,
}
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedStream {
    pub key: StreamKey,
    pub screens: Vec<Id>,
}
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CapturePlan {
    /// At most `MAX_CAPTURE_SCREENS` streams, in scene order.
    pub streams: Vec<PlannedStream>,
    /// Visible screens whose source the operator did not allow in this run.
    pub not_allowed: Vec<Id>,
}
impl CapturePlan {
    pub fn is_empty(&self) -> bool {
        self.streams.is_empty() && self.not_allowed.is_empty()
    }
}
/// R8: each visible screen with capture content and a source. A screen without a source, or a
/// hidden screen, gets no entry.
pub fn capture_plan(scene: &SceneView, allowed: &AllowedSources) -> CapturePlan {
    let mut plan = CapturePlan::default();
    for entity in &scene.entities {
        let SceneEntity::Screen {
            id,
            visible: true,
            content:
                ScreenContent::Capture {
                    source: Some(source),
                    cursor,
                    ..
                },
            ..
        } = entity
        else {
            continue;
        };
        if !allowed.contains(source) {
            plan.not_allowed.push(id.clone());
            continue;
        }
        let key = StreamKey {
            source: source.clone(),
            cursor: *cursor,
        };
        if let Some(stream) = plan.streams.iter_mut().find(|s| s.key == key) {
            stream.screens.push(id.clone());
        } else if plan.streams.len() < MAX_CAPTURE_SCREENS {
            plan.streams.push(PlannedStream {
                key,
                screens: vec![id.clone()],
            });
        }
    }
    plan
}
pub fn normalize_name(value: &str) -> String {
    normalize_capture_text(value, MAX_CAPTURE_NAME)
}
pub fn normalize_app(value: &str) -> String {
    normalize_capture_text(value, MAX_CAPTURE_APP)
}
pub fn normalize_title(value: &str) -> String {
    normalize_capture_text(value, MAX_CAPTURE_TITLE)
}
/// The ordinal of each display: its index among the displays with the same normalized name, in
/// the inventory order.
pub fn display_ordinals(inventory: &Inventory) -> Vec<(String, u8)> {
    let mut seen: Vec<(String, u8)> = Vec::new();
    inventory
        .displays
        .iter()
        .map(|display| {
            let name = normalize_name(&display.name);
            let ordinal = seen.iter().filter(|(n, _)| *n == name).count() as u8;
            seen.push((name.clone(), ordinal));
            (name, ordinal)
        })
        .collect()
}
/// R6: a window the operator can choose: a non-empty title or app name and at least 32 × 32.
pub fn capturable(window: &WindowInfo) -> bool {
    (!normalize_title(&window.title).is_empty() || !normalize_name(&window.app_name).is_empty())
        && !normalize_app(&window.app).is_empty()
        && window.width >= 32
        && window.height >= 32
}
/// R7: a display matches the display with the same name at the same ordinal. A window matches
/// the first window (front to back) with the same app and title; else the only window of the app.
pub fn match_source(source: &CaptureSource, inventory: &Inventory) -> Option<PlatformTarget> {
    match source {
        CaptureSource::Display { name, ordinal } => display_ordinals(inventory)
            .iter()
            .position(|(n, o)| n == name && o == ordinal)
            .map(|index| PlatformTarget::Display(inventory.displays[index].id)),
        CaptureSource::Window { app, title } => {
            let windows: Vec<_> = inventory
                .windows
                .iter()
                .filter(|w| capturable(w) && normalize_app(&w.app) == *app)
                .collect();
            windows
                .iter()
                .find(|w| normalize_title(&w.title) == *title)
                .or(if windows.len() == 1 {
                    windows.first()
                } else {
                    None
                })
                .map(|w| PlatformTarget::Window(w.id))
        }
    }
}
#[cfg(test)]
mod tests {
    use super::super::adapter::DisplayInfo;
    use super::*;
    use opensekai_contracts::{CaptureTarget, Transform};
    fn display(id: u64, name: &str) -> DisplayInfo {
        DisplayInfo {
            id,
            name: name.into(),
            width: 1920,
            height: 1080,
        }
    }
    fn window(id: u64, app: &str, title: &str) -> WindowInfo {
        WindowInfo {
            id,
            app: app.into(),
            app_name: "App".into(),
            title: title.into(),
            width: 800,
            height: 600,
        }
    }
    fn inventory() -> Inventory {
        Inventory {
            displays: vec![
                display(1, "Built-in Retina Display"),
                display(2, "DELL U2720Q"),
                display(3, "DELL U2720Q"),
            ],
            windows: vec![
                window(10, "com.example.chat", "Chat — Stream"),
                window(11, "com.example.chat", "Chat — Settings"),
                window(12, "com.example.timer", "Stopwatch"),
                window(13, "com.example.chat", "Chat\t— Stream"),
            ],
        }
    }
    fn d(name: &str, ordinal: u8) -> CaptureSource {
        CaptureSource::Display {
            name: name.into(),
            ordinal,
        }
    }
    fn w(app: &str, title: &str) -> CaptureSource {
        CaptureSource::Window {
            app: app.into(),
            title: title.into(),
        }
    }
    #[test]
    fn a_display_matches_its_name_and_ordinal() {
        let inv = inventory();
        assert_eq!(
            match_source(&d("Built-in Retina Display", 0), &inv),
            Some(PlatformTarget::Display(1))
        );
        assert_eq!(match_source(&d("DELL U2720Q", 0), &inv), Some(PlatformTarget::Display(2)));
        assert_eq!(match_source(&d("DELL U2720Q", 1), &inv), Some(PlatformTarget::Display(3)));
        assert_eq!(match_source(&d("DELL U2720Q", 2), &inv), None);
        assert_eq!(match_source(&d("LG UltraFine", 0), &inv), None);
    }
    #[test]
    fn a_window_matches_the_first_exact_title_front_to_back() {
        let inv = inventory();
        assert_eq!(
            match_source(&w("com.example.chat", "Chat — Settings"), &inv),
            Some(PlatformTarget::Window(11))
        );
        // Window 13 normalizes to the same title, but window 10 is in front.
        assert_eq!(
            match_source(&w("com.example.chat", "Chat — Stream"), &inv),
            Some(PlatformTarget::Window(10))
        );
    }
    #[test]
    fn the_only_window_of_an_app_matches_without_its_title() {
        let inv = inventory();
        assert_eq!(
            match_source(&w("com.example.timer", "Old title"), &inv),
            Some(PlatformTarget::Window(12))
        );
    }
    #[test]
    fn two_windows_of_one_app_without_the_title_do_not_match() {
        assert_eq!(match_source(&w("com.example.chat", "Old title"), &inventory()), None);
    }
    #[test]
    fn no_match_for_an_unknown_app_or_a_small_window() {
        let mut inv = inventory();
        assert_eq!(match_source(&w("com.example.other", "Stopwatch"), &inv), None);
        inv.windows[2].width = 31;
        assert_eq!(match_source(&w("com.example.timer", "Stopwatch"), &inv), None);
    }
    fn transform() -> Transform {
        Transform {
            position: [0.; 3],
            rotation: [0., 0., 0., 1.],
            scale: [1.; 3],
        }
    }
    fn screen(id: &str, visible: bool, source: Option<CaptureSource>, cursor: bool) -> SceneEntity {
        SceneEntity::Screen {
            id: id.into(),
            name: "Screen".into(),
            visible,
            transform: transform(),
            content: ScreenContent::Capture {
                target: CaptureTarget::Display,
                source,
                cursor,
            },
        }
    }
    fn scene(entities: Vec<SceneEntity>) -> SceneView {
        SceneView {
            schema_version: 1,
            scene_id: "s".into(),
            revision: 1,
            outputs: vec![],
            entities,
        }
    }
    fn allowed(sources: &[CaptureSource]) -> AllowedSources {
        let mut a = AllowedSources::default();
        for s in sources {
            a.allow(s.clone());
        }
        a
    }
    #[test]
    fn screens_with_one_source_and_cursor_share_a_stream() {
        let main = d("Built-in Retina Display", 0);
        let plan = capture_plan(
            &scene(vec![
                screen("a", true, Some(main.clone()), true),
                screen("b", true, Some(main.clone()), true),
            ]),
            &allowed(std::slice::from_ref(&main)),
        );
        assert_eq!(plan.streams.len(), 1);
        assert_eq!(plan.streams[0].screens, vec!["a".to_string(), "b".to_string()]);
    }
    #[test]
    fn two_cursor_values_make_two_streams() {
        let main = d("Built-in Retina Display", 0);
        let plan = capture_plan(
            &scene(vec![
                screen("a", true, Some(main.clone()), true),
                screen("b", true, Some(main.clone()), false),
            ]),
            &allowed(std::slice::from_ref(&main)),
        );
        assert_eq!(plan.streams.len(), 2);
        assert!(plan.streams[0].key.cursor && !plan.streams[1].key.cursor);
    }
    #[test]
    fn a_source_that_is_not_allowed_gets_no_stream() {
        let plan = capture_plan(
            &scene(vec![screen("a", true, Some(d("Built-in Retina Display", 0)), true)]),
            &AllowedSources::default(),
        );
        assert!(plan.streams.is_empty());
        assert_eq!(plan.not_allowed, vec!["a".to_string()]);
    }
    #[test]
    fn hidden_screens_and_screens_without_a_source_are_not_planned() {
        let main = d("Built-in Retina Display", 0);
        let plan = capture_plan(
            &scene(vec![
                screen("hidden", false, Some(main.clone()), true),
                screen("empty", true, None, true),
            ]),
            &allowed(std::slice::from_ref(&main)),
        );
        assert!(plan.is_empty());
    }
    #[test]
    fn at_most_two_streams() {
        let sources: Vec<_> = (0..3).map(|n| d("DELL U2720Q", n)).collect();
        let plan = capture_plan(
            &scene(
                sources
                    .iter()
                    .enumerate()
                    .map(|(n, s)| screen(&format!("s{n}"), true, Some(s.clone()), true))
                    .collect(),
            ),
            &allowed(&sources),
        );
        assert_eq!(plan.streams.len(), 2);
    }
    // R2: the shared vectors, applied to the inventory values before the match.
    #[test]
    fn inventory_values_are_normalized_with_the_shared_rule() {
        let vectors: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../fixtures/protocol/capture-sources.json"
        ))
        .unwrap();
        for v in vectors["normalize"].as_array().unwrap() {
            let max = v["max"].as_u64().unwrap() as usize;
            assert_eq!(
                normalize_capture_text(v["input"].as_str().unwrap(), max),
                v["output"].as_str().unwrap()
            );
        }
        let inv = Inventory {
            displays: vec![],
            windows: vec![window(1, " com.example.chat ", "Chat\n\nOverlay  ")],
        };
        let other = Inventory {
            windows: vec![window(1, "com.example.chat", "Chat Overlay"), window(2, "com.example.chat", "Other")],
            ..inv.clone()
        };
        assert_eq!(
            match_source(&w("com.example.chat", "Chat Overlay"), &inv),
            Some(PlatformTarget::Window(1))
        );
        assert_eq!(
            match_source(&w("com.example.chat", "Chat Overlay"), &other),
            Some(PlatformTarget::Window(1))
        );
    }
}
