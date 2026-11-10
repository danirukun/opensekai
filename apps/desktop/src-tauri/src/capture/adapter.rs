// The platform capture boundary (B31 R10). Only an adapter calls a platform capture or encode API.
use std::sync::Arc;
use tokio::sync::mpsc;

/// One display that the adapter can capture. The adapter lists displays in the R6 order: by the
/// frame origin (x, then y).
#[derive(Debug, Clone, PartialEq)]
pub struct DisplayInfo {
    pub id: u64,
    pub name: String,
    pub width: u32,
    pub height: u32,
}
/// One window that the adapter can capture, in front-to-back order. The adapter keeps only
/// windows that are on screen, at layer 0, and not of the OpenSekai process.
#[derive(Debug, Clone, PartialEq)]
pub struct WindowInfo {
    pub id: u64,
    /// The application ID (the bundle ID on macOS).
    pub app: String,
    pub app_name: String,
    pub title: String,
    pub width: u32,
    pub height: u32,
}
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Inventory {
    pub displays: Vec<DisplayInfo>,
    pub windows: Vec<WindowInfo>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PlatformTarget {
    Display(u64),
    Window(u64),
}
pub const MAX_STREAM_WIDTH: u32 = 1920;
pub const MAX_STREAM_HEIGHT: u32 = 1080;
pub const STREAM_FPS: u32 = 30;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamConfig {
    pub max_width: u32,
    pub max_height: u32,
    pub fps: u32,
    pub cursor: bool,
}
impl StreamConfig {
    pub fn new(cursor: bool) -> Self {
        Self {
            max_width: MAX_STREAM_WIDTH,
            max_height: MAX_STREAM_HEIGHT,
            fps: STREAM_FPS,
            cursor,
        }
    }
    /// The encoded size for a source size: scaled down to fit, aspect kept, even sides.
    pub fn scaled(&self, width: u32, height: u32) -> (u32, u32) {
        let (w, h) = (width.max(2) as f64, height.max(2) as f64);
        let scale = (self.max_width as f64 / w)
            .min(self.max_height as f64 / h)
            .min(1.);
        let even = |v: f64| (((v * scale) as u32) & !1).max(2);
        (even(w), even(h))
    }
}
#[derive(Debug, Clone, PartialEq)]
pub struct EncodedChunk {
    pub key: bool,
    pub timestamp_us: u64,
    /// AVCC: each NAL unit has a 4-byte big-endian length.
    pub data: Vec<u8>,
}
#[derive(Debug, Clone, PartialEq)]
pub struct DecoderConfig {
    pub codec: String,
    /// The `avcC` record.
    pub description: Vec<u8>,
    pub coded_width: u32,
    pub coded_height: u32,
}
#[derive(Debug, Clone, PartialEq)]
pub enum StreamEvent {
    Config(DecoderConfig),
    Chunk(EncodedChunk),
    Paused,
    Resumed,
    Ended,
    Failed(String),
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureError {
    PermissionNeeded,
    NotFound,
    Unsupported,
    Failed(String),
}
/// The control side of a running capture. Dropping the handle does not stop it; `stop` does.
pub trait StreamControl: Send + Sync {
    /// Encode the last captured image again as a key frame at once.
    fn request_key(&self);
    fn stop(&self);
}
pub struct StreamHandle {
    pub events: mpsc::Receiver<StreamEvent>,
    pub control: Arc<dyn StreamControl>,
}
/// The capacity of the event channel of one stream. An adapter that finds it full drops the
/// chunk and makes its next chunk a key frame.
pub const EVENT_CAPACITY: usize = 32;
pub trait CaptureAdapter: Send + Sync {
    fn inventory(&self) -> Result<Inventory, CaptureError>;
    /// Starts a capture and encode. A `DecoderConfig` comes before the first chunk and after each
    /// size change; after a size change the first chunk is a key frame. Timestamps increase strictly.
    fn start(&self, target: PlatformTarget, config: StreamConfig)
        -> Result<StreamHandle, CaptureError>;
    /// Asks the OS for capture access. The manager calls it at most once in an app run, from the
    /// first source list.
    fn request_access(&self) {}
}
