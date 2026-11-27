//! Shared 4-peer conformance matrix for every `MocapTransport` against a running `apps/relay`.
//!
//! Each test runs only when `RELAY_TEST_URL` is set (an empty value means
//! `ws://127.0.0.1:4002/socket/websocket`). `ex_webrtc` needs the relay on a non-loopback
//! `RELAY_UDP_BIND_IP`, because `ex_ice` rejects loopback. The LiveKit tests also need
//! `--features livekit`, `LIVEKIT_TEST_ENABLED=1` and the SFU from `apps/relay/deploy/livekit`.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use collab_transport::codec::POSE_WIRE_LEN;
use collab_transport::signaling::{ServerEvent, SignalingClient, SignalingError};
use collab_transport::{
    now_us, MocapTransport, PoseFrame, ReceivedPose, RoomCipher, RoomRef, SendOutcome,
    Str0mTransport, TransportCreds, TransportKind, WebSocketTransport,
};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tokio::time::timeout;

const DEFAULT_RELAY_URL: &str = "ws://127.0.0.1:4002/socket/websocket";
const KEY: [u8; 32] = [0x5E; 32];
const SALT: [u8; 4] = [9, 8, 7, 6];
const SLOTS: [u8; 4] = [0, 1, 2, 3];
const KICKED_SLOT: u8 = 3;
const KICK_DEADLINE: Duration = Duration::from_millis(200);
const EVENT_WAIT: Duration = Duration::from_secs(5);
const WARMUP_LIMIT: Duration = Duration::from_secs(10);
const DRAIN: Duration = Duration::from_millis(300);
/// Share of the frames a sender sent that each receiver must decrypt on a local relay.
const MIN_DELIVERY: f64 = 0.8;

fn relay_url() -> Option<String> {
    let url = std::env::var("RELAY_TEST_URL").ok()?;
    Some(if url.is_empty() {
        DEFAULT_RELAY_URL.to_owned()
    } else {
        url
    })
}

async fn next_event(events: &mut broadcast::Receiver<ServerEvent>, name: &str) -> ServerEvent {
    timeout(EVENT_WAIT, async {
        loop {
            match events.recv().await {
                Ok(event) if event.event == name => return event,
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => panic!("events closed before {name}"),
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("no {name} event"))
}

struct Member {
    signaling: SignalingClient,
    events: broadcast::Receiver<ServerEvent>,
    creds: TransportCreds,
}

/// Every frame one receiver decrypted, per sender slot, in arrival order.
#[derive(Default)]
struct Inbox {
    frames: HashMap<u8, Vec<(u32, u64)>>,
    tamper_errors: u64,
    own_frames: u64,
    lagged: u64,
}

impl Inbox {
    fn seqs_from(&self, sender: u8) -> Vec<u32> {
        self.frames.get(&sender).map_or_else(Vec::new, |frames| {
            frames.iter().map(|(seq, _)| *seq).collect()
        })
    }

    fn received_after(&self, sender: u8, cutoff_us: u64) -> usize {
        self.frames.get(&sender).map_or(0, |frames| {
            frames.iter().filter(|(_, at)| *at > cutoff_us).count()
        })
    }
}

fn collect(
    slot: u8,
    mut rx: broadcast::Receiver<ReceivedPose>,
    inbox: Arc<Mutex<Inbox>>,
) -> JoinHandle<()> {
    let cipher = RoomCipher::new(KEY, SALT);
    tokio::spawn(async move {
        loop {
            let pose = match rx.recv().await {
                Ok(pose) => pose,
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    inbox.lock().unwrap().lagged += n;
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            };
            let mut inbox = inbox.lock().unwrap();
            if pose.slot == slot {
                inbox.own_frames += 1;
            }
            match cipher.decrypt(pose.slot, &pose.ciphertext) {
                Ok(frame) => inbox
                    .frames
                    .entry(pose.slot)
                    .or_default()
                    .push((frame.seq, pose.received_at_us)),
                Err(_) => inbox.tamper_errors += 1,
            }
        }
    })
}

/// One peer of the matrix: its transport, signalling, outgoing sequence and inbox.
struct Peer<T> {
    slot: u8,
    transport: T,
    signaling: SignalingClient,
    events: broadcast::Receiver<ServerEvent>,
    next_seq: u32,
    sent: HashSet<u32>,
    inbox: Arc<Mutex<Inbox>>,
    collector: JoinHandle<()>,
}

impl<T: MocapTransport> Peer<T> {
    fn send(&mut self, cipher: &RoomCipher) -> SendOutcome {
        let seq = self.next_seq;
        self.next_seq += 1;
        let wire = cipher
            .encrypt(&PoseFrame::new(self.slot, seq, now_us()))
            .expect("encrypt");
        let outcome = self.transport.send_pose(&wire);
        if outcome == SendOutcome::Sent {
            self.sent.insert(seq);
        }
        outcome
    }
}

/// Fills slots 0..=3 and checks that a fifth peer cannot be approved. Returns the members and
/// the signalling client of the rejected peer.
async fn join_room(
    url: &str,
    room_id: &str,
    kind: TransportKind,
) -> (Vec<Member>, SignalingClient) {
    let host_signaling = SignalingClient::connect(url, room_id)
        .await
        .expect("host connects");
    let mut host_events = host_signaling.subscribe_events();
    let created = host_signaling
        .create("conformance-secret", kind.as_relay_str(), 60)
        .await
        .expect("create");
    let host_creds = TransportCreds::from_relay_value(&created["creds"]).expect("host creds");
    assert_eq!((host_creds.slot(), host_creds.kind()), (0, kind));

    let mut members = Vec::new();
    for (index, expected_slot) in [1u8, 2, 3].into_iter().enumerate() {
        let signaling = SignalingClient::connect(url, room_id)
            .await
            .expect("guest connects");
        let mut events = signaling.subscribe_events();
        signaling
            .knock(&format!("Guest {index}"))
            .await
            .expect("knock");
        let knock = next_event(&mut host_events, "knock_received").await;
        host_signaling
            .approve(knock.payload["knock_id"].as_str().expect("knock_id"))
            .await
            .expect("approve");
        let approved = next_event(&mut events, "approved").await;
        let creds = TransportCreds::from_relay_value(&approved.payload["creds"]).expect("creds");
        assert_eq!((creds.slot(), creds.kind()), (expected_slot, kind));
        members.push(Member {
            signaling,
            events,
            creds,
        });
    }

    let extra = SignalingClient::connect(url, room_id)
        .await
        .expect("fifth connects");
    extra.knock("Guest 4").await.expect("knock");
    let knock = next_event(&mut host_events, "knock_received").await;
    let rejected = host_signaling
        .approve(knock.payload["knock_id"].as_str().expect("knock_id"))
        .await;
    assert!(
        matches!(&rejected, Err(SignalingError::Rejected(reason)) if reason == "room_full"),
        "{rejected:?}"
    );

    members.insert(
        0,
        Member {
            signaling: host_signaling,
            events: host_events,
            creds: host_creds,
        },
    );
    (members, extra)
}

async fn send_for<T: MocapTransport>(
    peers: &mut [Peer<T>],
    cipher: &RoomCipher,
    hz: u32,
    duration: Duration,
) {
    let mut tick = tokio::time::interval(Duration::from_secs(1) / hz);
    let frames = (duration.as_secs_f64() * f64::from(hz)).round() as usize;
    for _ in 0..frames {
        tick.tick().await;
        peers.iter_mut().for_each(|peer| {
            peer.send(cipher);
        });
    }
}

/// Sends until every peer has decrypted a frame from each other peer, so the measured windows
/// start with every path open.
async fn warm_up<T: MocapTransport>(peers: &mut [Peer<T>], cipher: &RoomCipher, hz: u32) {
    let all_heard = |peers: &[Peer<T>]| {
        peers.iter().all(|receiver| {
            let inbox = receiver.inbox.lock().unwrap();
            peers
                .iter()
                .filter(|sender| sender.slot != receiver.slot)
                .all(|sender| inbox.frames.contains_key(&sender.slot))
        })
    };
    let warmed = timeout(WARMUP_LIMIT, async {
        while !all_heard(peers) {
            send_for(peers, cipher, hz, Duration::from_millis(100)).await;
        }
    })
    .await;
    assert!(warmed.is_ok(), "not every pair of peers exchanged a frame");
}

/// Every receiver decrypted at least `MIN_DELIVERY` of what each other peer sent from `start_seq`.
fn assert_window<T>(peers: &[Peer<T>], start_seq: &HashMap<u8, u32>, label: &str) {
    for receiver in peers {
        let inbox = receiver.inbox.lock().unwrap();
        for sender in peers.iter().filter(|sender| sender.slot != receiver.slot) {
            let start = start_seq[&sender.slot];
            let sent = sender.sent.iter().filter(|seq| **seq >= start).count();
            let received = inbox
                .seqs_from(sender.slot)
                .into_iter()
                .filter(|seq| *seq >= start)
                .count();
            assert!(sent > 0, "{label}: slot {} sent nothing", sender.slot);
            assert!(
                received as f64 >= sent as f64 * MIN_DELIVERY,
                "{label}: slot {} got {received} of {sent} frames from slot {}",
                receiver.slot,
                sender.slot
            );
        }
    }
}

/// No tamper errors, no echo of a peer's own frames, and each sender's sequence numbers only
/// rise and were all sent.
fn assert_integrity<T>(peers: &[Peer<T>]) {
    for receiver in peers {
        let inbox = receiver.inbox.lock().unwrap();
        assert_eq!(
            inbox.tamper_errors, 0,
            "slot {} tamper errors",
            receiver.slot
        );
        assert_eq!(
            inbox.own_frames, 0,
            "slot {} received its own frames",
            receiver.slot
        );
        assert_eq!(inbox.lagged, 0, "slot {} lagged", receiver.slot);
        for sender in peers.iter().filter(|sender| sender.slot != receiver.slot) {
            let seqs = inbox.seqs_from(sender.slot);
            assert!(
                seqs.windows(2).all(|pair| pair[0] < pair[1]),
                "slot {} saw non-monotonic seqs from slot {}",
                receiver.slot,
                sender.slot
            );
            assert!(
                seqs.iter().all(|seq| sender.sent.contains(seq)),
                "slot {} decrypted a seq slot {} never sent",
                receiver.slot,
                sender.slot
            );
        }
    }
}

/// The other peers still exchange frames, and nothing reaches or leaves the kicked slot after `cutoff_us`.
fn assert_kicked<T>(peers: &[Peer<T>], start_seq: &HashMap<u8, u32>, cutoff_us: u64, label: &str) {
    let (stayers, kicked) = peers.split_at(usize::from(KICKED_SLOT));
    assert_window(stayers, start_seq, "after kick");
    for receiver in stayers {
        let inbox = receiver.inbox.lock().unwrap();
        assert_eq!(
            inbox.received_after(KICKED_SLOT, cutoff_us),
            0,
            "{label}: slot {} still receives slot {KICKED_SLOT} 200 ms after the kick",
            receiver.slot
        );
    }
    let kicked_inbox = kicked[0].inbox.lock().unwrap();
    for sender in stayers {
        assert_eq!(
            kicked_inbox.received_after(sender.slot, cutoff_us),
            0,
            "{label}: kicked slot {KICKED_SLOT} still receives slot {} 200 ms after the kick",
            sender.slot
        );
    }
}

fn next_seqs<T>(peers: &[Peer<T>]) -> HashMap<u8, u32> {
    peers
        .iter()
        .map(|peer| (peer.slot, peer.next_seq))
        .collect()
}

async fn run_conformance_matrix<T, F>(kind: TransportKind, relay_url: &str, label: &str, make: F)
where
    T: MocapTransport,
    F: Fn(SignalingClient) -> T,
{
    let room_id = format!("conformance-{label}-{}", now_us());
    let room = RoomRef {
        room_id: room_id.clone(),
        hz: 60,
    };
    let cipher = RoomCipher::new(KEY, SALT);

    let (members, extra) = join_room(relay_url, &room_id, kind).await;
    let mut peers = Vec::new();
    for (member, slot) in members.into_iter().zip(SLOTS) {
        let mut transport = make(member.signaling.clone());
        transport
            .connect(room.clone(), member.creds)
            .await
            .unwrap_or_else(|err| panic!("{label}: slot {slot} connect: {err}"));
        let inbox = Arc::default();
        let collector = collect(slot, transport.subscribe(), Arc::clone(&inbox));
        peers.push(Peer {
            slot,
            transport,
            signaling: member.signaling,
            events: member.events,
            next_seq: 0,
            sent: HashSet::new(),
            inbox,
            collector,
        });
    }
    let host = peers[0].signaling.clone();

    warm_up(&mut peers, &cipher, 60).await;
    let start = next_seqs(&peers);
    send_for(&mut peers, &cipher, 60, Duration::from_secs(1)).await;
    tokio::time::sleep(DRAIN).await;
    assert_window(&peers, &start, "60 Hz");
    assert!(peers.iter().all(|peer| peer.transport.stats().hz == 60));

    assert_eq!(host.set_hz(30).await.expect("set_hz")["hz"], 30);
    for peer in &mut peers[1..] {
        assert_eq!(next_event(&mut peer.events, "hz").await.payload["hz"], 30);
    }
    let start = next_seqs(&peers);
    send_for(&mut peers, &cipher, 30, Duration::from_millis(500)).await;
    tokio::time::sleep(DRAIN).await;
    assert_window(&peers, &start, "30 Hz");

    host.kick(KICKED_SLOT).await.expect("kick");
    let kicked_at = now_us();
    next_event(&mut peers[usize::from(KICKED_SLOT)].events, "kicked").await;
    tokio::time::sleep(KICK_DEADLINE).await;
    let cutoff_us = kicked_at + KICK_DEADLINE.as_micros() as u64;
    let start = next_seqs(&peers);
    send_for(&mut peers, &cipher, 30, Duration::from_millis(500)).await;
    tokio::time::sleep(DRAIN).await;

    assert_kicked(&peers, &start, cutoff_us, label);
    assert_integrity(&peers);

    for mut peer in peers {
        peer.transport.close().await;
        peer.signaling.close().await;
        peer.collector.abort();
        assert_eq!(
            peer.transport.send_pose(&[0; POSE_WIRE_LEN]),
            SendOutcome::Disconnected,
            "{label}: slot {} sends after close",
            peer.slot
        );
    }
    extra.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn conformance_websocket() {
    let Some(url) = relay_url() else {
        eprintln!("skipped: set RELAY_TEST_URL");
        return;
    };
    run_conformance_matrix(TransportKind::WebSocket, &url, "websocket", |signaling| {
        WebSocketTransport::new(signaling, None)
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn conformance_ex_webrtc() {
    let Some(url) = relay_url() else {
        eprintln!("skipped: set RELAY_TEST_URL");
        return;
    };
    run_conformance_matrix(TransportKind::ExWebRtc, &url, "ex_webrtc", |signaling| {
        Str0mTransport::new(signaling, None)
    })
    .await;
}

#[cfg(feature = "livekit")]
mod livekit {
    use super::*;
    use collab_transport::{LiveKitMode, LiveKitTransport};

    fn livekit_relay_url() -> Option<String> {
        let enabled = std::env::var("LIVEKIT_TEST_ENABLED").is_ok_and(|value| value == "1");
        enabled.then(relay_url).flatten()
    }

    async fn run(mode: LiveKitMode) {
        let Some(url) = livekit_relay_url() else {
            eprintln!("skipped: set LIVEKIT_TEST_ENABLED=1 and RELAY_TEST_URL");
            return;
        };
        let label = format!("livekit-{}", mode.as_str());
        run_conformance_matrix(TransportKind::LiveKit, &url, &label, |_signaling| {
            LiveKitTransport::new(mode, None)
        })
        .await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn conformance_livekit_lossy() {
        run(LiveKitMode::LossyPacket).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn conformance_livekit_track() {
        run(LiveKitMode::DataTrack).await;
    }
}
