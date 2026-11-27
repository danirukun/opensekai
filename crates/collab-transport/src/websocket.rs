use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::broadcast;
use tokio::task::JoinHandle;

use crate::codec::parse_relay_envelope;
use crate::signaling::{BinaryEvent, SignalingClient};
use crate::stats::{ImpairmentConfig, ImpairmentFilter};
use crate::{
    now_us, MocapTransport, ReceivedPose, RoomRef, SendOutcome, TransportCreds, TransportError,
    TransportKind, TransportStats,
};

const POSE_EVENT: &str = "pose";
const RECEIVED_CAPACITY: usize = 1024;

#[derive(Default)]
struct Counters {
    sent: AtomicU64,
    dropped_backpressure: AtomicU64,
    received: AtomicU64,
}

/// Pose frames over the relay's Phoenix channel. Receive-side impairment is applied before delivery.
pub struct WebSocketTransport {
    signaling: SignalingClient,
    impairment: Option<ImpairmentConfig>,
    poses_rx: Option<broadcast::Receiver<BinaryEvent>>,
    received_tx: broadcast::Sender<ReceivedPose>,
    counters: Arc<Counters>,
    hz: u32,
    connected: bool,
    forwarder: Option<JoinHandle<()>>,
}

impl WebSocketTransport {
    /// `signaling` must have joined the room. Poses that arrive before `connect` are buffered.
    pub fn new(signaling: SignalingClient, impairment: Option<ImpairmentConfig>) -> Self {
        let poses_rx = Some(signaling.subscribe_binary());
        let (received_tx, _) = broadcast::channel(RECEIVED_CAPACITY);
        Self {
            signaling,
            impairment,
            poses_rx,
            received_tx,
            counters: Arc::default(),
            hz: 0,
            connected: false,
            forwarder: None,
        }
    }

    pub fn signaling(&self) -> &SignalingClient {
        &self.signaling
    }
}

impl MocapTransport for WebSocketTransport {
    async fn connect(
        &mut self,
        room: RoomRef,
        creds: TransportCreds,
    ) -> Result<(), TransportError> {
        if !matches!(creds, TransportCreds::WebSocket { .. }) {
            return Err(TransportError::WrongCreds {
                expected: TransportKind::WebSocket,
                actual: creds.kind(),
            });
        }
        let Some(poses_rx) = self.poses_rx.take() else {
            return Err(TransportError::AlreadyConnected);
        };
        self.hz = room.hz;
        self.connected = true;
        self.forwarder = Some(tokio::spawn(forward_poses(
            poses_rx,
            self.received_tx.clone(),
            Arc::clone(&self.counters),
            self.impairment.map(ImpairmentFilter::new),
        )));
        Ok(())
    }

    fn send_pose(&self, ciphertext: &[u8]) -> SendOutcome {
        if !self.connected || self.signaling.is_closed() {
            return SendOutcome::Disconnected;
        }
        let outcome = self.signaling.push_binary(POSE_EVENT, ciphertext);
        let counter = match outcome {
            SendOutcome::Sent => &self.counters.sent,
            SendOutcome::DroppedBackpressure => &self.counters.dropped_backpressure,
            SendOutcome::Disconnected => return outcome,
        };
        counter.fetch_add(1, Ordering::Relaxed);
        outcome
    }

    fn subscribe(&self) -> broadcast::Receiver<ReceivedPose> {
        self.received_tx.subscribe()
    }

    fn stats(&self) -> TransportStats {
        TransportStats {
            kind: TransportKind::WebSocket,
            rtt_ms: None,
            loss_pct: None,
            jitter_ms: None,
            hz: self.hz,
            sent: self.counters.sent.load(Ordering::Relaxed),
            dropped_backpressure: self.counters.dropped_backpressure.load(Ordering::Relaxed),
            received: self.counters.received.load(Ordering::Relaxed),
        }
    }

    async fn close(&mut self) {
        self.connected = false;
        if let Some(forwarder) = self.forwarder.take() {
            forwarder.abort();
        }
        self.signaling.close().await;
    }
}

async fn forward_poses(
    mut poses_rx: broadcast::Receiver<BinaryEvent>,
    received_tx: broadcast::Sender<ReceivedPose>,
    counters: Arc<Counters>,
    mut impairment: Option<ImpairmentFilter>,
) {
    loop {
        let event = match poses_rx.recv().await {
            Ok(event) => event,
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => break,
        };
        if event.event != POSE_EVENT {
            continue;
        }
        let Ok((slot, wire)) = parse_relay_envelope(&event.payload) else {
            continue;
        };
        let ciphertext = wire.to_vec();
        let delay = match impairment.as_mut().map(ImpairmentFilter::apply) {
            Some(None) => continue,
            Some(Some(delay)) => delay,
            None => std::time::Duration::ZERO,
        };
        let deliver = {
            let received_tx = received_tx.clone();
            let counters = Arc::clone(&counters);
            move || {
                counters.received.fetch_add(1, Ordering::Relaxed);
                let _ = received_tx.send(ReceivedPose {
                    slot,
                    ciphertext,
                    received_at_us: now_us(),
                });
            }
        };
        if delay.is_zero() {
            deliver();
        } else {
            tokio::spawn(async move {
                tokio::time::sleep(delay).await;
                deliver();
            });
        }
    }
}
