use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use livekit::prelude::{
    DataPacket, DataTrackFrame, LocalDataTrack, LocalParticipant, PushFrameErrorReason,
    RemoteDataTrack, Room, RoomEvent, RoomOptions,
};
use tokio::sync::{broadcast, mpsc};
use tokio::task::{JoinHandle, JoinSet};

use crate::codec::{parse_livekit_slot, POSE_WIRE_LEN};
use crate::stats::{ImpairmentConfig, ImpairmentFilter};
use crate::{
    now_us, MocapTransport, ReceivedPose, RoomRef, SendOutcome, TransportCreds, TransportError,
    TransportKind, TransportStats,
};

const POSE_TOPIC: &str = "pose";
const RECEIVED_CAPACITY: usize = 1024;

/// How pose frames cross the LiveKit SFU. ADR 0001 compares both for head-of-line blocking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LiveKitMode {
    /// `publish_data` with `reliable: false` on topic `pose`.
    LossyPacket,
    /// A published data track named `pose`, subscribed per remote participant.
    DataTrack,
}

impl LiveKitMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LossyPacket => "lossy",
            Self::DataTrack => "data_track",
        }
    }
}

impl FromStr for LiveKitMode {
    type Err = TransportError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "lossy" => Ok(Self::LossyPacket),
            "data_track" => Ok(Self::DataTrack),
            other => Err(TransportError::UnknownKind(other.to_owned())),
        }
    }
}

#[derive(Default)]
struct Link {
    connected: AtomicBool,
    sent: AtomicU64,
    dropped_backpressure: AtomicU64,
    received: AtomicU64,
}

impl Link {
    fn drop_frame(&self) -> SendOutcome {
        self.dropped_backpressure.fetch_add(1, Ordering::Relaxed);
        SendOutcome::DroppedBackpressure
    }
}

/// Latest-only hand-off from `send_pose` to the publish worker: one frame waits at most.
struct Outbox {
    tx: mpsc::Sender<Vec<u8>>,
    link: Arc<Link>,
}

impl Outbox {
    fn offer(&self, ciphertext: &[u8]) -> SendOutcome {
        if !self.link.connected.load(Ordering::Acquire) {
            return SendOutcome::Disconnected;
        }
        match self.tx.try_send(ciphertext.to_vec()) {
            Ok(()) => SendOutcome::Sent,
            Err(mpsc::error::TrySendError::Full(_)) => self.link.drop_frame(),
            Err(mpsc::error::TrySendError::Closed(_)) => SendOutcome::Disconnected,
        }
    }
}

/// Delivers `(slot, ciphertext)` as `ReceivedPose`, after optional impairment.
#[derive(Clone)]
struct Inbound {
    tx: broadcast::Sender<ReceivedPose>,
    link: Arc<Link>,
    impairment: Option<Arc<Mutex<ImpairmentFilter>>>,
}

impl Inbound {
    fn accept(&self, slot: u8, ciphertext: &[u8]) {
        if ciphertext.len() != POSE_WIRE_LEN {
            return;
        }
        let delay = match self
            .impairment
            .as_ref()
            .map(|filter| filter.lock().unwrap_or_else(|e| e.into_inner()).apply())
        {
            Some(None) => return,
            Some(Some(delay)) => delay,
            None => Duration::ZERO,
        };
        let deliver = {
            let tx = self.tx.clone();
            let link = Arc::clone(&self.link);
            let ciphertext = ciphertext.to_vec();
            move || {
                link.received.fetch_add(1, Ordering::Relaxed);
                let _ = tx.send(ReceivedPose {
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

/// The sender slot of a lossy packet, or `None` when it is not a pose packet from a `slot-N` peer.
fn packet_slot(topic: Option<&str>, identity: Option<&str>) -> Option<u8> {
    if topic != Some(POSE_TOPIC) {
        return None;
    }
    identity.and_then(|identity| parse_livekit_slot(identity).ok())
}

/// The sender slot of a remote data track, or `None` when it is not a `pose` track from a `slot-N` peer.
fn track_slot(name: &str, publisher: &str) -> Option<u8> {
    (name == POSE_TOPIC)
        .then(|| parse_livekit_slot(publisher).ok())
        .flatten()
}

#[derive(Debug, PartialEq, Eq)]
enum Published {
    Sent,
    Dropped,
    TrackGone,
}

fn push_failure(reason: PushFrameErrorReason) -> Published {
    match reason {
        PushFrameErrorReason::QueueFull => Published::Dropped,
        PushFrameErrorReason::TrackUnpublished => Published::TrackGone,
    }
}

enum Publisher {
    Lossy(LocalParticipant),
    Track(LocalDataTrack),
}

impl Publisher {
    async fn publish(&self, payload: Vec<u8>) -> Published {
        match self {
            Self::Lossy(participant) => {
                let packet = DataPacket {
                    payload,
                    topic: Some(POSE_TOPIC.to_owned()),
                    reliable: false,
                    destination_identities: vec![],
                };
                match participant.publish_data(packet).await {
                    Ok(()) => Published::Sent,
                    Err(_) => Published::Dropped,
                }
            }
            Self::Track(track) => match track.try_push(DataTrackFrame::from(payload)) {
                Ok(()) => Published::Sent,
                Err(err) => push_failure(err.reason()),
            },
        }
    }
}

async fn publish_frames(
    publisher: Publisher,
    mut frames: mpsc::Receiver<Vec<u8>>,
    link: Arc<Link>,
) {
    while let Some(payload) = frames.recv().await {
        match publisher.publish(payload).await {
            Published::Sent => {
                link.sent.fetch_add(1, Ordering::Relaxed);
            }
            Published::Dropped => {
                link.drop_frame();
            }
            Published::TrackGone => break,
        }
    }
    link.connected.store(false, Ordering::Release);
}

async fn receive_track(track: RemoteDataTrack, slot: u8, inbound: Inbound) {
    let Ok(mut frames) = track.subscribe().await else {
        return;
    };
    while let Some(frame) = frames.next().await {
        inbound.accept(slot, &frame.payload());
    }
}

async fn handle_events(
    mode: LiveKitMode,
    mut events: mpsc::UnboundedReceiver<RoomEvent>,
    inbound: Inbound,
) {
    let mut track_tasks = JoinSet::new();
    while let Some(event) = events.recv().await {
        match (mode, event) {
            (
                LiveKitMode::LossyPacket,
                RoomEvent::DataReceived {
                    payload,
                    topic,
                    participant,
                    ..
                },
            ) => {
                let identity = participant.map(|p| p.identity());
                if let Some(slot) =
                    packet_slot(topic.as_deref(), identity.as_ref().map(|id| id.as_str()))
                {
                    inbound.accept(slot, &payload);
                }
            }
            (LiveKitMode::DataTrack, RoomEvent::DataTrackPublished(track)) => {
                if let Some(slot) = track_slot(track.info().name(), track.publisher_identity()) {
                    track_tasks.spawn(receive_track(track, slot, inbound.clone()));
                }
            }
            (_, RoomEvent::Disconnected { .. }) => break,
            _ => {}
        }
    }
    inbound.link.connected.store(false, Ordering::Release);
}

/// Pose frames through a LiveKit SFU, as lossy data packets or as a data track.
pub struct LiveKitTransport {
    mode: LiveKitMode,
    impairment: Option<ImpairmentConfig>,
    received_tx: broadcast::Sender<ReceivedPose>,
    link: Arc<Link>,
    room: Option<Room>,
    outbox: Option<Outbox>,
    tasks: Vec<JoinHandle<()>>,
    hz: u32,
}

impl LiveKitTransport {
    pub fn new(mode: LiveKitMode, impairment: Option<ImpairmentConfig>) -> Self {
        let (received_tx, _) = broadcast::channel(RECEIVED_CAPACITY);
        Self {
            mode,
            impairment,
            received_tx,
            link: Arc::default(),
            room: None,
            outbox: None,
            tasks: Vec::new(),
            hz: 0,
        }
    }

    pub fn mode(&self) -> LiveKitMode {
        self.mode
    }
}

fn connect_err(err: impl std::fmt::Display) -> TransportError {
    TransportError::Connect(err.to_string())
}

impl MocapTransport for LiveKitTransport {
    async fn connect(
        &mut self,
        room: RoomRef,
        creds: TransportCreds,
    ) -> Result<(), TransportError> {
        let TransportCreds::LiveKit { url, token, .. } = creds else {
            return Err(TransportError::WrongCreds {
                expected: TransportKind::LiveKit,
                actual: creds.kind(),
            });
        };
        if self.room.is_some() {
            return Err(TransportError::AlreadyConnected);
        }
        let (lk_room, events) = Room::connect(&url, &token, RoomOptions::default())
            .await
            .map_err(connect_err)?;
        let publisher = match self.mode {
            LiveKitMode::LossyPacket => Publisher::Lossy(lk_room.local_participant()),
            LiveKitMode::DataTrack => {
                let track = lk_room
                    .local_participant()
                    .publish_data_track(POSE_TOPIC)
                    .await;
                match track {
                    Ok(track) => Publisher::Track(track),
                    Err(err) => {
                        let _ = lk_room.close().await;
                        return Err(connect_err(err));
                    }
                }
            }
        };

        let inbound = Inbound {
            tx: self.received_tx.clone(),
            link: Arc::clone(&self.link),
            impairment: self
                .impairment
                .map(|config| Arc::new(Mutex::new(ImpairmentFilter::new(config)))),
        };
        let (frames_tx, frames) = mpsc::channel(1);
        self.link.connected.store(true, Ordering::Release);
        self.tasks = vec![
            tokio::spawn(handle_events(self.mode, events, inbound)),
            tokio::spawn(publish_frames(publisher, frames, Arc::clone(&self.link))),
        ];
        self.outbox = Some(Outbox {
            tx: frames_tx,
            link: Arc::clone(&self.link),
        });
        self.room = Some(lk_room);
        self.hz = room.hz;
        Ok(())
    }

    fn send_pose(&self, ciphertext: &[u8]) -> SendOutcome {
        self.outbox
            .as_ref()
            .map_or(SendOutcome::Disconnected, |outbox| outbox.offer(ciphertext))
    }

    fn subscribe(&self) -> broadcast::Receiver<ReceivedPose> {
        self.received_tx.subscribe()
    }

    fn stats(&self) -> TransportStats {
        TransportStats {
            kind: TransportKind::LiveKit,
            rtt_ms: None,
            loss_pct: None,
            jitter_ms: None,
            hz: self.hz,
            sent: self.link.sent.load(Ordering::Relaxed),
            dropped_backpressure: self.link.dropped_backpressure.load(Ordering::Relaxed),
            received: self.link.received.load(Ordering::Relaxed),
        }
    }

    async fn close(&mut self) {
        self.outbox = None;
        self.link.connected.store(false, Ordering::Release);
        self.tasks.drain(..).for_each(|task| task.abort());
        if let Some(room) = self.room.take() {
            let _ = room.close().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connected_link() -> Arc<Link> {
        let link = Arc::new(Link::default());
        link.connected.store(true, Ordering::Release);
        link
    }

    #[test]
    fn mode_round_trips_its_bench_name() {
        for mode in [LiveKitMode::LossyPacket, LiveKitMode::DataTrack] {
            assert_eq!(mode.as_str().parse::<LiveKitMode>().unwrap(), mode);
        }
        assert!("reliable".parse::<LiveKitMode>().is_err());
        assert_eq!(
            LiveKitTransport::new(LiveKitMode::DataTrack, None).mode(),
            LiveKitMode::DataTrack
        );
    }

    #[test]
    fn lossy_packets_map_pose_topic_and_identity_to_a_slot() {
        assert_eq!(packet_slot(Some("pose"), Some("slot-2")), Some(2));
        assert_eq!(packet_slot(Some("pose"), Some("slot-0")), Some(0));
        assert_eq!(packet_slot(Some("chat"), Some("slot-2")), None);
        assert_eq!(packet_slot(None, Some("slot-2")), None);
        assert_eq!(packet_slot(Some("pose"), Some("slot-4")), None);
        assert_eq!(packet_slot(Some("pose"), Some("relay")), None);
        assert_eq!(packet_slot(Some("pose"), None), None);
    }

    #[test]
    fn data_tracks_map_pose_name_and_publisher_to_a_slot() {
        assert_eq!(track_slot("pose", "slot-3"), Some(3));
        assert_eq!(track_slot("audio", "slot-3"), None);
        assert_eq!(track_slot("pose", "guest"), None);
    }

    #[test]
    fn outbox_keeps_only_one_waiting_frame() {
        let link = connected_link();
        let (tx, mut rx) = mpsc::channel(1);
        let outbox = Outbox {
            tx,
            link: Arc::clone(&link),
        };
        assert_eq!(outbox.offer(&[1]), SendOutcome::Sent);
        assert_eq!(outbox.offer(&[2]), SendOutcome::DroppedBackpressure);
        assert_eq!(link.dropped_backpressure.load(Ordering::Relaxed), 1);
        assert_eq!(rx.try_recv().unwrap(), vec![1]);
        assert_eq!(outbox.offer(&[3]), SendOutcome::Sent);

        link.connected.store(false, Ordering::Release);
        assert_eq!(outbox.offer(&[4]), SendOutcome::Disconnected);
        link.connected.store(true, Ordering::Release);
        drop(rx);
        assert_eq!(outbox.offer(&[5]), SendOutcome::Disconnected);
        assert_eq!(link.dropped_backpressure.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn a_full_track_queue_drops_and_an_unpublished_track_disconnects() {
        assert_eq!(
            push_failure(PushFrameErrorReason::QueueFull),
            Published::Dropped
        );
        assert_eq!(
            push_failure(PushFrameErrorReason::TrackUnpublished),
            Published::TrackGone
        );
    }

    #[test]
    fn send_before_connect_is_disconnected() {
        let transport = LiveKitTransport::new(LiveKitMode::LossyPacket, None);
        assert_eq!(
            transport.send_pose(&[0; POSE_WIRE_LEN]),
            SendOutcome::Disconnected
        );
        assert_eq!(transport.stats().kind, TransportKind::LiveKit);
    }

    #[tokio::test]
    async fn connect_rejects_other_credentials() {
        let mut transport = LiveKitTransport::new(LiveKitMode::LossyPacket, None);
        let room = RoomRef {
            room_id: "r".into(),
            hz: 60,
        };
        let err = transport
            .connect(room, TransportCreds::WebSocket { slot: 1 })
            .await
            .unwrap_err();
        assert!(matches!(
            err,
            TransportError::WrongCreds {
                expected: TransportKind::LiveKit,
                actual: TransportKind::WebSocket
            }
        ));
    }

    #[tokio::test]
    async fn inbound_without_impairment_delivers_pose_sized_frames_only() {
        let (tx, mut rx) = broadcast::channel(4);
        let inbound = Inbound {
            tx,
            link: connected_link(),
            impairment: None,
        };
        inbound.accept(1, &[7; POSE_WIRE_LEN - 1]);
        inbound.accept(2, &[7; POSE_WIRE_LEN]);
        let pose = rx.try_recv().unwrap();
        assert_eq!((pose.slot, pose.ciphertext.len()), (2, POSE_WIRE_LEN));
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn inbound_impairment_drops_about_ten_percent_within_30ms() {
        const FRAMES: usize = 2000;
        let (tx, mut rx) = broadcast::channel(FRAMES * 2);
        let link = connected_link();
        let inbound = Inbound {
            tx,
            link: Arc::clone(&link),
            impairment: Some(Arc::new(Mutex::new(ImpairmentFilter::new(
                ImpairmentConfig {
                    loss_pct: 10.0,
                    jitter_ms: 30.0,
                    seed: 5,
                },
            )))),
        };
        (0..FRAMES).for_each(|_| inbound.accept(1, &[0; POSE_WIRE_LEN]));

        let delivered = |rx: &mut broadcast::Receiver<ReceivedPose>| {
            std::iter::from_fn(|| rx.try_recv().ok()).count()
        };
        tokio::time::sleep(Duration::from_millis(31)).await;
        let by_31ms = delivered(&mut rx);
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(delivered(&mut rx), 0, "a frame arrived after 30 ms");

        let drop_pct = (FRAMES - by_31ms) as f64 / FRAMES as f64 * 100.0;
        assert!((drop_pct - 10.0).abs() < 1.5, "drop {drop_pct}");
        assert_eq!(link.received.load(Ordering::Relaxed), by_31ms as u64);
    }
}
