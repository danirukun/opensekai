use std::future::Future;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::broadcast;

pub mod auto_upgrade;
pub mod codec;
#[cfg(feature = "livekit")]
pub mod livekit_transport;
pub mod signaling;
pub mod stats;
pub mod str0m_transport;
pub mod websocket;

pub use auto_upgrade::{AutoUpgradeConfig, AutoUpgradeTransport, BackoffSchedule, LinkHealth};
pub use codec::{CodecError, PoseFrame, RoomCipher};
#[cfg(feature = "livekit")]
pub use livekit_transport::{LiveKitMode, LiveKitTransport};
pub use signaling::{SignalingClient, SignalingError};
pub use stats::{ImpairmentConfig, ImpairmentFilter, StreamMetrics, StreamSummary};
pub use str0m_transport::Str0mTransport;
pub use websocket::WebSocketTransport;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TransportKind {
    #[serde(rename = "websocket")]
    WebSocket,
    #[serde(rename = "ex_webrtc")]
    ExWebRtc,
    #[serde(rename = "livekit")]
    LiveKit,
}

impl TransportKind {
    pub fn as_relay_str(self) -> &'static str {
        match self {
            Self::WebSocket => "websocket",
            Self::ExWebRtc => "ex_webrtc",
            Self::LiveKit => "livekit",
        }
    }
}

impl FromStr for TransportKind {
    type Err = TransportError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "websocket" => Ok(Self::WebSocket),
            "ex_webrtc" => Ok(Self::ExWebRtc),
            "livekit" => Ok(Self::LiveKit),
            other => Err(TransportError::UnknownKind(other.to_owned())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomRef {
    pub room_id: String,
    pub hz: u32,
}

/// Transport credentials as the relay returns them in the `create`, `reclaim` and `approved` payloads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum TransportCreds {
    #[serde(rename = "websocket")]
    WebSocket { slot: u8 },
    #[serde(rename = "ex_webrtc")]
    ExWebRtc {
        slot: u8,
        #[serde(default)]
        ice_servers: Vec<serde_json::Value>,
    },
    #[serde(rename = "livekit")]
    LiveKit {
        slot: u8,
        url: String,
        token: String,
        room: String,
    },
}

impl TransportCreds {
    pub fn kind(&self) -> TransportKind {
        match self {
            Self::WebSocket { .. } => TransportKind::WebSocket,
            Self::ExWebRtc { .. } => TransportKind::ExWebRtc,
            Self::LiveKit { .. } => TransportKind::LiveKit,
        }
    }

    pub fn slot(&self) -> u8 {
        match self {
            Self::WebSocket { slot } | Self::ExWebRtc { slot, .. } | Self::LiveKit { slot, .. } => {
                *slot
            }
        }
    }

    pub fn from_relay_value(value: &serde_json::Value) -> Result<Self, TransportError> {
        serde_json::from_value(value.clone())
            .map_err(|err| TransportError::BadCreds(err.to_string()))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendOutcome {
    Sent,
    DroppedBackpressure,
    Disconnected,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceivedPose {
    pub slot: u8,
    pub ciphertext: Vec<u8>,
    /// Microseconds since the Unix epoch on the receiving host.
    pub received_at_us: u64,
}

/// `None` means the transport cannot measure the value.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TransportStats {
    pub kind: TransportKind,
    pub rtt_ms: Option<f64>,
    pub loss_pct: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub hz: u32,
    pub sent: u64,
    pub dropped_backpressure: u64,
    pub received: u64,
}

#[derive(Debug, Error)]
pub enum TransportError {
    #[error(transparent)]
    Signaling(#[from] SignalingError),
    #[error(transparent)]
    Codec(#[from] CodecError),
    #[error("transport expects {expected:?} credentials, got {actual:?}")]
    WrongCreds {
        expected: TransportKind,
        actual: TransportKind,
    },
    #[error("invalid transport credentials: {0}")]
    BadCreds(String),
    #[error("unknown transport kind {0:?}")]
    UnknownKind(String),
    #[error("transport is already connected")]
    AlreadyConnected,
    #[error("transport connection failed: {0}")]
    Connect(String),
}

pub trait MocapTransport: Send {
    fn connect(
        &mut self,
        room: RoomRef,
        creds: TransportCreds,
    ) -> impl Future<Output = Result<(), TransportError>> + Send;

    /// Never blocks and never queues behind an unsent frame.
    fn send_pose(&self, ciphertext: &[u8]) -> SendOutcome;

    fn subscribe(&self) -> broadcast::Receiver<ReceivedPose>;

    fn stats(&self) -> TransportStats;

    fn close(&mut self) -> impl Future<Output = ()> + Send;
}

pub fn now_us() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_micros() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn relay_creds_parse_per_kind() {
        let ws =
            TransportCreds::from_relay_value(&json!({"kind": "websocket", "slot": 2})).unwrap();
        assert_eq!(ws, TransportCreds::WebSocket { slot: 2 });

        let rtc = TransportCreds::from_relay_value(
            &json!({"kind": "ex_webrtc", "slot": 1, "ice_servers": []}),
        )
        .unwrap();
        assert_eq!(rtc.kind(), TransportKind::ExWebRtc);

        let lk = TransportCreds::from_relay_value(
            &json!({"kind": "livekit", "slot": 3, "url": "wss://lk", "token": "t", "room": "r"}),
        )
        .unwrap();
        assert_eq!(lk.slot(), 3);
        assert!(
            TransportCreds::from_relay_value(&json!({"kind": "carrier-pigeon", "slot": 1}))
                .is_err()
        );
    }

    #[test]
    fn transport_kind_round_trips_relay_strings() {
        for kind in [
            TransportKind::WebSocket,
            TransportKind::ExWebRtc,
            TransportKind::LiveKit,
        ] {
            assert_eq!(kind.as_relay_str().parse::<TransportKind>().unwrap(), kind);
        }
    }
}
