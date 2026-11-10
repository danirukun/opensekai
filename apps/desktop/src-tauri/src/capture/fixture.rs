// The test adapter (B31 R12), behind the cargo feature `capture-fixture`. It has one display,
// `Fixture display`, and replays fixtures/capture/h264-main.{json,bin} at 30 frames a second in a
// loop, with timestamps that keep increasing across loops.
use super::adapter::*;
use base64::Engine;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::sync::{mpsc, Notify};

pub const FIXTURE_DISPLAY: &str = "Fixture display";
#[derive(Clone)]
struct Chunk {
    key: bool,
    data: Vec<u8>,
}
#[derive(Clone)]
pub struct FixtureAdapter {
    config: DecoderConfig,
    chunks: Arc<Vec<Chunk>>,
    /// Counts each start, so a test can see that an idle stream starts again.
    pub starts: Arc<AtomicUsize>,
}
impl FixtureAdapter {
    pub fn load() -> Self {
        let index: serde_json::Value =
            serde_json::from_str(include_str!("../../../../../fixtures/capture/h264-main.json"))
                .expect("capture fixture index");
        let bytes: &[u8] = include_bytes!("../../../../../fixtures/capture/h264-main.bin");
        let chunks = index["chunks"]
            .as_array()
            .expect("chunks")
            .iter()
            .map(|c| {
                let offset = c["offset"].as_u64().unwrap() as usize;
                let length = c["length"].as_u64().unwrap() as usize;
                Chunk {
                    key: c["key"].as_bool().unwrap(),
                    data: bytes[offset..offset + length].to_vec(),
                }
            })
            .collect();
        Self {
            config: DecoderConfig {
                codec: index["codec"].as_str().unwrap().into(),
                description: base64::engine::general_purpose::STANDARD
                    .decode(index["description"].as_str().unwrap())
                    .unwrap(),
                coded_width: index["codedWidth"].as_u64().unwrap() as u32,
                coded_height: index["codedHeight"].as_u64().unwrap() as u32,
            },
            chunks: Arc::new(chunks),
            starts: Arc::new(AtomicUsize::new(0)),
        }
    }
}
struct Control {
    key: Notify,
    stopped: AtomicBool,
    stop: Notify,
}
impl StreamControl for Control {
    fn request_key(&self) {
        self.key.notify_one();
    }
    fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.stop.notify_one();
    }
}
impl CaptureAdapter for FixtureAdapter {
    fn inventory(&self) -> Result<Inventory, CaptureError> {
        Ok(Inventory {
            displays: vec![DisplayInfo {
                id: 1,
                name: FIXTURE_DISPLAY.into(),
                width: self.config.coded_width,
                height: self.config.coded_height,
            }],
            windows: vec![],
        })
    }
    fn start(
        &self,
        target: PlatformTarget,
        _config: StreamConfig,
    ) -> Result<StreamHandle, CaptureError> {
        if target != PlatformTarget::Display(1) {
            return Err(CaptureError::NotFound);
        }
        self.starts.fetch_add(1, Ordering::SeqCst);
        let (events, receiver) = mpsc::channel(EVENT_CAPACITY);
        let control = Arc::new(Control {
            key: Notify::new(),
            stopped: AtomicBool::new(false),
            stop: Notify::new(),
        });
        let config = self.config.clone();
        let chunks = self.chunks.clone();
        let task = control.clone();
        tokio::spawn(async move {
            if events.send(StreamEvent::Config(config)).await.is_err() {
                return;
            }
            let frame = Duration::from_micros(1_000_000 / 30);
            let mut interval = tokio::time::interval(frame);
            let (mut index, mut count, mut skip_to_key) = (0usize, 0u64, false);
            loop {
                let jump = tokio::select! {
                    _ = interval.tick() => false,
                    _ = task.key.notified() => true,
                    _ = task.stop.notified() => return,
                };
                if task.stopped.load(Ordering::SeqCst) {
                    return;
                }
                // A key request sends the next key frame of the file at once.
                if jump || skip_to_key {
                    while !chunks[index % chunks.len()].key {
                        index += 1;
                    }
                }
                let chunk = &chunks[index % chunks.len()];
                let event = StreamEvent::Chunk(EncodedChunk {
                    key: chunk.key,
                    timestamp_us: count * 1_000_000 / 30,
                    data: chunk.data.clone(),
                });
                skip_to_key = match events.try_send(event) {
                    Ok(()) => false,
                    Err(mpsc::error::TrySendError::Full(_)) => true,
                    Err(mpsc::error::TrySendError::Closed(_)) => return,
                };
                index += 1;
                count += 1;
            }
        });
        Ok(StreamHandle {
            events: receiver,
            control,
        })
    }
}
