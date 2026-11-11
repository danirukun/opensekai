// The `/capture` message format and the subscriber queue (B31 R13).
use super::adapter::{DecoderConfig, EncodedChunk};
use base64::Engine;
use serde_json::json;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

pub const MAX_SUBSCRIBER_CHUNKS: usize = 8;
pub const MAX_CHUNK_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
pub const KEY_REQUEST_INTERVAL: Duration = Duration::from_millis(250);
pub const MAX_AUTH_BYTES: usize = 512;
pub const CLOSE_UNAUTHORIZED: u16 = 4401;
pub const CLOSE_UNKNOWN_STREAM: u16 = 4404;
pub const CLOSE_LIMIT: u16 = 4429;

/// Byte 0 is the flags (bit 0: key frame), bytes 1 to 8 the timestamp in µs (u64, big-endian),
/// and the rest the AVCC chunk. `None` when the message would be over 4 MiB.
pub fn chunk_message(chunk: &EncodedChunk) -> Option<Vec<u8>> {
    if chunk.data.len() + 9 > MAX_CHUNK_MESSAGE_BYTES {
        return None;
    }
    let mut message = Vec::with_capacity(chunk.data.len() + 9);
    message.push(u8::from(chunk.key));
    message.extend_from_slice(&chunk.timestamp_us.to_be_bytes());
    message.extend_from_slice(&chunk.data);
    Some(message)
}
pub fn parse_chunk_message(message: &[u8]) -> Option<EncodedChunk> {
    let (&flags, rest) = message.split_first()?;
    if rest.len() < 8 {
        return None;
    }
    Some(EncodedChunk {
        key: flags & 1 == 1,
        timestamp_us: u64::from_be_bytes(rest[..8].try_into().ok()?),
        data: rest[8..].to_vec(),
    })
}
pub fn config_message(config: &DecoderConfig) -> String {
    json!({
        "kind": "captureConfig",
        "codec": config.codec,
        "description": base64::engine::general_purpose::STANDARD.encode(&config.description),
        "codedWidth": config.coded_width,
        "codedHeight": config.coded_height,
    })
    .to_string()
}
#[derive(Debug, Clone, PartialEq)]
pub enum Outgoing {
    Config(String),
    Chunk(std::sync::Arc<Vec<u8>>),
}
#[derive(Debug, PartialEq, Eq)]
pub enum Pushed {
    Queued,
    /// Dropped while the subscriber waits for a key frame.
    Skipped,
    /// The queue was full: it was cleared, and the subscriber waits for the next key frame.
    Overflow,
}
/// One subscriber's queue: at most 8 chunks. A config is never dropped.
#[derive(Debug, Default)]
pub struct SubscriberQueue {
    items: VecDeque<Outgoing>,
    waiting_key: bool,
}
impl SubscriberQueue {
    /// A new subscriber starts from the latest config and the cached key frame. When the stream has
    /// sent a chunk after that key frame, it then waits for the next key frame.
    pub fn starting(
        config: Option<&DecoderConfig>,
        key: Option<&std::sync::Arc<Vec<u8>>>,
        key_is_latest: bool,
    ) -> Self {
        let mut queue = Self::default();
        if let Some(config) = config {
            queue
                .items
                .push_back(Outgoing::Config(config_message(config)));
        }
        match key {
            Some(key) => {
                queue.items.push_back(Outgoing::Chunk(key.clone()));
                queue.waiting_key = !key_is_latest;
            }
            None => queue.waiting_key = true,
        }
        queue
    }
    fn chunks(&self) -> usize {
        self.items
            .iter()
            .filter(|i| matches!(i, Outgoing::Chunk(_)))
            .count()
    }
    pub fn push_config(&mut self, config: &DecoderConfig) {
        self.items
            .push_back(Outgoing::Config(config_message(config)));
        // The first chunk after a size change is a key frame.
        self.waiting_key = true;
    }
    pub fn push_chunk(&mut self, key: bool, message: std::sync::Arc<Vec<u8>>) -> Pushed {
        if self.waiting_key && !key {
            return Pushed::Skipped;
        }
        if self.chunks() >= MAX_SUBSCRIBER_CHUNKS {
            self.items.retain(|i| matches!(i, Outgoing::Config(_)));
            self.waiting_key = true;
            if !key {
                return Pushed::Overflow;
            }
        }
        self.waiting_key = false;
        self.items.push_back(Outgoing::Chunk(message));
        Pushed::Queued
    }
    /// A chunk was too large to send: wait for the next key frame.
    pub fn skip_to_key(&mut self) {
        self.waiting_key = true;
    }
    pub fn pop(&mut self) -> Option<Outgoing> {
        self.items.pop_front()
    }
    pub fn len(&self) -> usize {
        self.items.len()
    }
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}
/// At most one key frame request each 250 ms for one stream.
#[derive(Debug, Default)]
pub struct KeyThrottle(Option<Instant>);
impl KeyThrottle {
    pub fn try_request(&mut self, now: Instant) -> bool {
        if self
            .0
            .is_some_and(|last| now.saturating_duration_since(last) < KEY_REQUEST_INTERVAL)
        {
            return false;
        }
        self.0 = Some(now);
        true
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    fn chunk(n: u8) -> Arc<Vec<u8>> {
        Arc::new(vec![n])
    }
    fn config() -> DecoderConfig {
        DecoderConfig {
            codec: "avc1.4d0029".into(),
            description: vec![1, 2, 3],
            coded_width: 1920,
            coded_height: 1080,
        }
    }
    #[test]
    fn the_binary_message_round_trips() {
        let c = EncodedChunk {
            key: true,
            timestamp_us: 0x0102_0304_0506_0708,
            data: vec![0, 0, 0, 1, 0x65],
        };
        let message = chunk_message(&c).unwrap();
        assert_eq!(&message[..9], &[1, 1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(parse_chunk_message(&message).unwrap(), c);
        let big = EncodedChunk {
            data: vec![0; MAX_CHUNK_MESSAGE_BYTES - 8],
            ..c
        };
        assert!(chunk_message(&big).is_none());
    }
    #[test]
    fn the_config_message_has_base64_description() {
        let text = config_message(&config());
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            value,
            json!({"kind":"captureConfig","codec":"avc1.4d0029","description":"AQID","codedWidth":1920,"codedHeight":1080})
        );
    }
    #[test]
    fn a_full_queue_drops_to_the_next_key_frame() {
        let mut q = SubscriberQueue::starting(Some(&config()), Some(&chunk(0)), true);
        for n in 1..=7 {
            assert_eq!(q.push_chunk(false, chunk(n)), Pushed::Queued);
        }
        // Config and 8 chunks are queued; the next delta overflows.
        assert_eq!(q.push_chunk(false, chunk(8)), Pushed::Overflow);
        assert_eq!(q.len(), 1);
        assert_eq!(q.push_chunk(false, chunk(9)), Pushed::Skipped);
        assert_eq!(q.push_chunk(true, chunk(10)), Pushed::Queued);
        assert_eq!(q.push_chunk(false, chunk(11)), Pushed::Queued);
        assert!(matches!(q.pop(), Some(Outgoing::Config(_))));
        assert_eq!(q.pop(), Some(Outgoing::Chunk(chunk(10))));
        assert_eq!(q.pop(), Some(Outgoing::Chunk(chunk(11))));
    }
    #[test]
    fn a_key_frame_into_a_full_queue_replaces_it() {
        let mut q = SubscriberQueue::starting(None, Some(&chunk(0)), true);
        for n in 1..8 {
            q.push_chunk(false, chunk(n));
        }
        assert_eq!(q.push_chunk(true, chunk(30)), Pushed::Queued);
        assert_eq!(q.pop(), Some(Outgoing::Chunk(chunk(30))));
        assert!(q.is_empty());
    }
    #[test]
    fn a_new_subscriber_gets_the_config_then_the_cached_key_frame() {
        let mut q = SubscriberQueue::starting(Some(&config()), Some(&chunk(0)), false);
        assert!(matches!(q.pop(), Some(Outgoing::Config(_))));
        assert_eq!(q.pop(), Some(Outgoing::Chunk(chunk(0))));
        // A delta after the cached key frame cannot decode without the frames between them.
        assert_eq!(q.push_chunk(false, chunk(5)), Pushed::Skipped);
        assert_eq!(q.push_chunk(true, chunk(6)), Pushed::Queued);
        let mut fresh = SubscriberQueue::starting(Some(&config()), Some(&chunk(0)), true);
        fresh.pop();
        fresh.pop();
        assert_eq!(fresh.push_chunk(false, chunk(1)), Pushed::Queued);
        let mut empty = SubscriberQueue::starting(None, None, false);
        assert!(empty.pop().is_none());
        assert_eq!(empty.push_chunk(false, chunk(1)), Pushed::Skipped);
    }
    #[test]
    fn a_size_change_waits_for_a_key_frame() {
        let mut q = SubscriberQueue::starting(None, Some(&chunk(0)), true);
        q.pop();
        q.push_config(&config());
        assert_eq!(q.push_chunk(false, chunk(1)), Pushed::Skipped);
        assert_eq!(q.push_chunk(true, chunk(2)), Pushed::Queued);
    }
    #[test]
    fn key_requests_wait_250_ms() {
        let mut throttle = KeyThrottle::default();
        let start = Instant::now();
        assert!(throttle.try_request(start));
        assert!(!throttle.try_request(start + Duration::from_millis(249)));
        assert!(throttle.try_request(start + Duration::from_millis(250)));
        assert!(!throttle.try_request(start + Duration::from_millis(300)));
    }
}
