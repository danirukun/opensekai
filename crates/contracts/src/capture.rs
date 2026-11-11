use super::*;
// The capture screen slice (B31, MED-04 slice 1). Mirrors `packages/contracts/src/capture.ts`
// and the capture members of `packages/contracts/src/schema.ts`.
/// B31 R2. Keep in step with `LIMITS.captureScreens`.
pub const MAX_CAPTURE_SCREENS: usize = 2;
pub const MAX_CAPTURE_NAME: usize = 128;
pub const MAX_CAPTURE_APP: usize = 255;
pub const MAX_CAPTURE_TITLE: usize = 512;
/// One text rule for both sides (R2): a control character becomes a space, a run of spaces
/// becomes one space, the result is trimmed and cut to `max` code points.
pub fn normalize_capture_text(value: &str, max: usize) -> String {
    let spaced: String = value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let mut collapsed = String::with_capacity(spaced.len());
    for c in spaced.chars() {
        if !(c == ' ' && collapsed.ends_with(' ')) {
            collapsed.push(c);
        }
    }
    let cut: String = collapsed.trim_matches(' ').chars().take(max).collect();
    cut.trim_end_matches(' ').to_string()
}
fn capture_text_ok(value: &str, min: usize, max: usize) -> bool {
    let count = value.chars().count();
    (min..=max).contains(&count) && normalize_capture_text(value, max) == value
}
strings!(CaptureTarget { Display=>"display", Window=>"window" });
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum CaptureSource {
    Display { name: String, ordinal: u8 },
    Window { app: String, title: String },
}
impl CaptureSource {
    pub fn target(&self) -> CaptureTarget {
        match self {
            Self::Display { .. } => CaptureTarget::Display,
            Self::Window { .. } => CaptureTarget::Window,
        }
    }
}
impl Validate for CaptureSource {
    fn validate(&self) -> Result<(), AppError> {
        require(
            match self {
                Self::Display { name, ordinal } => {
                    capture_text_ok(name, 1, MAX_CAPTURE_NAME) && *ordinal <= 7
                }
                Self::Window { app, title } => {
                    capture_text_ok(app, 1, MAX_CAPTURE_APP)
                        && capture_text_ok(title, 0, MAX_CAPTURE_TITLE)
                }
            },
            "invalid capture source",
        )
    }
}
// The settings of `setScreenCapture` (R3).
object!(ScreenCapture {
    target: CaptureTarget,
    source: Option<CaptureSource>,
    cursor: bool
});
pub(crate) fn capture_ok(
    target: &CaptureTarget,
    source: Option<&CaptureSource>,
) -> Result<(), AppError> {
    if let Some(source) = source {
        source.validate()?;
        require(
            source.target() == *target,
            "capture source kind must match the target",
        )?;
    }
    Ok(())
}
impl Validate for ScreenCapture {
    fn validate(&self) -> Result<(), AppError> {
        capture_ok(&self.target, self.source.as_ref())
    }
}
strings!(CaptureState {
    Starting=>"starting", Idle=>"idle", Live=>"live", Paused=>"paused", Ended=>"ended",
    NotAllowed=>"notAllowed", NotFound=>"notFound", PermissionNeeded=>"permissionNeeded",
    Unsupported=>"unsupported", Failed=>"failed"
});
strings!(VideoDecoderSupport { Supported=>"supported", Unsupported=>"unsupported", Missing=>"missing" });
object!(CaptureScreenStatus {
    entity_id: Id,
    stream_id: Option<String>,
    state: CaptureState,
    width: u32,
    height: u32
});
object!(CaptureStatusEntry {
    entity_id: Id,
    state: CaptureState
});
pub fn is_capture_stream_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
/// R9: at most 16 entries, unique entity IDs, at most 2 entries with a stream.
pub fn validate_capture_screens(screens: &[CaptureScreenStatus]) -> Result<(), AppError> {
    let ids: HashSet<_> = screens.iter().map(|s| &s.entity_id).collect();
    require(
        screens.len() <= MAX_SCREENS
            && ids.len() == screens.len()
            && screens.iter().filter(|s| s.stream_id.is_some()).count() <= MAX_CAPTURE_SCREENS
            && screens.iter().all(|s| {
                !s.entity_id.is_empty()
                    && s.entity_id.len() <= 256
                    && s.stream_id.as_deref().is_none_or(is_capture_stream_id)
                    && s.width <= 1920
                    && s.height <= 1920
            }),
        "invalid capture status",
    )
}
pub fn validate_capture_entries(entries: &[CaptureStatusEntry]) -> Result<(), AppError> {
    let ids: HashSet<_> = entries.iter().map(|s| &s.entity_id).collect();
    require(
        entries.len() <= MAX_SCREENS && ids.len() == entries.len(),
        "invalid capture status",
    )
}
