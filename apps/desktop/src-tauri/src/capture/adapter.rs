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
    fn start(
        &self,
        target: PlatformTarget,
        config: StreamConfig,
    ) -> Result<StreamHandle, CaptureError>;
    /// Asks the OS for capture access. The manager calls it at most once in an app run, from the
    /// first source list.
    fn request_access(&self) {}
}

/// Builds an `avcC` record (ISO/IEC 14496-15) with 4-byte NAL lengths from SPS and PPS units.
pub fn avcc_record(sets: &[Vec<u8>]) -> Option<(Vec<u8>, String)> {
    let sps: Vec<_> = sets
        .iter()
        .filter(|s| s.first().is_some_and(|b| b & 0x1f == 7))
        .collect();
    let pps: Vec<_> = sets
        .iter()
        .filter(|s| s.first().is_some_and(|b| b & 0x1f == 8))
        .collect();
    let first = sps.first().filter(|s| s.len() >= 4)?;
    if pps.is_empty() || sps.len() > 31 || pps.len() > 255 {
        return None;
    }
    let mut record = vec![
        1,
        first[1],
        first[2],
        first[3],
        0xff,
        0xe0 | sps.len() as u8,
    ];
    for set in &sps {
        record.extend_from_slice(&(set.len() as u16).to_be_bytes());
        record.extend_from_slice(set);
    }
    record.push(pps.len() as u8);
    for set in &pps {
        record.extend_from_slice(&(set.len() as u16).to_be_bytes());
        record.extend_from_slice(set);
    }
    let codec = format!("avc1.{:02x}{:02x}{:02x}", first[1], first[2], first[3]);
    Some((record, codec))
}
#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    #[test]
    fn the_avcc_record_matches_the_fixture_description() {
        let index: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../fixtures/capture/h264-main.json"
        ))
        .unwrap();
        let description = base64::engine::general_purpose::STANDARD
            .decode(index["description"].as_str().unwrap())
            .unwrap();
        // The fixture avcC has one SPS and one PPS.
        let sps_len = u16::from_be_bytes([description[6], description[7]]) as usize;
        let sps = description[8..8 + sps_len].to_vec();
        let at = 8 + sps_len + 1;
        let pps_len = u16::from_be_bytes([description[at], description[at + 1]]) as usize;
        let pps = description[at + 2..at + 2 + pps_len].to_vec();
        let (record, codec) = avcc_record(&[sps.clone(), pps.clone()]).unwrap();
        assert_eq!(record, description);
        assert_eq!(codec, index["codec"].as_str().unwrap());
        assert!(avcc_record(&[sps]).is_none());
        assert!(avcc_record(&[pps]).is_none());
    }
}
