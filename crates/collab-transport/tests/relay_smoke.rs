use std::time::Duration;

use collab_transport::signaling::{ServerEvent, SignalingClient};
use collab_transport::{
    now_us, MocapTransport, PoseFrame, RoomCipher, RoomRef, SendOutcome, Str0mTransport,
    TransportCreds, TransportKind, WebSocketTransport,
};
use tokio::sync::broadcast;
use tokio::time::timeout;

const WAIT: Duration = Duration::from_secs(5);

async fn next_event(events: &mut broadcast::Receiver<ServerEvent>, name: &str) -> ServerEvent {
    timeout(WAIT, async {
        loop {
            let event = events.recv().await.expect("events open");
            if event.event == name {
                return event;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("no {name} event"))
}

struct Member {
    signaling: SignalingClient,
    creds: TransportCreds,
}

/// Creates a room of `kind` with a host in slot 0 and an approved guest in slot 1.
async fn host_and_guest(kind: TransportKind) -> (RoomRef, Member, Member) {
    let url = std::env::var("RELAY_URL").expect("RELAY_URL");
    let room_id = format!("smoke-{}-{}", kind.as_relay_str(), now_us());
    let room = RoomRef {
        room_id: room_id.clone(),
        hz: 60,
    };

    let host_signaling = SignalingClient::connect(&url, &room_id).await.unwrap();
    let mut host_events = host_signaling.subscribe_events();
    let created = host_signaling
        .create("host-secret", kind.as_relay_str(), 60)
        .await
        .unwrap();
    let host_creds = TransportCreds::from_relay_value(&created["creds"]).unwrap();
    assert_eq!((host_creds.slot(), host_creds.kind()), (0, kind));

    let guest_signaling = SignalingClient::connect(&url, &room_id).await.unwrap();
    let mut guest_events = guest_signaling.subscribe_events();
    guest_signaling.knock("Mio").await.unwrap();
    let knock = next_event(&mut host_events, "knock_received").await;
    host_signaling
        .approve(knock.payload["knock_id"].as_str().unwrap())
        .await
        .unwrap();
    let approved = next_event(&mut guest_events, "approved").await;
    let guest_creds = TransportCreds::from_relay_value(&approved.payload["creds"]).unwrap();
    assert_eq!((guest_creds.slot(), guest_creds.kind()), (1, kind));

    let host = Member {
        signaling: host_signaling,
        creds: host_creds,
    };
    let guest = Member {
        signaling: guest_signaling,
        creds: guest_creds,
    };
    (room, host, guest)
}

/// Sends `frame` until the peer receives it, because the relay can register the far
/// DataChannel a moment after the near side reports it open.
async fn deliver(
    sender: &impl MocapTransport,
    receiver: &mut broadcast::Receiver<collab_transport::ReceivedPose>,
    cipher: &RoomCipher,
    frame: &PoseFrame,
) {
    let wire = cipher.encrypt(frame).unwrap();
    let received = timeout(WAIT, async {
        loop {
            assert_ne!(sender.send_pose(&wire), SendOutcome::Disconnected);
            if let Ok(Ok(pose)) = timeout(Duration::from_millis(100), receiver.recv()).await {
                return pose;
            }
        }
    })
    .await
    .expect("frame delivered");
    assert_eq!(received.slot, frame.slot);
    assert_eq!(
        cipher.decrypt(received.slot, &received.ciphertext).unwrap(),
        *frame
    );
}

/// Run with `RELAY_URL=ws://127.0.0.1:4017 cargo test -p collab-transport --test relay_smoke -- --ignored`.
#[tokio::test]
#[ignore = "needs a running apps/relay and RELAY_URL"]
async fn encrypted_pose_round_trips_through_the_relay() {
    let (room, host_member, guest_member) = host_and_guest(TransportKind::WebSocket).await;
    let mut host = WebSocketTransport::new(host_member.signaling, None);
    host.connect(room.clone(), host_member.creds).await.unwrap();
    let mut guest = WebSocketTransport::new(guest_member.signaling, None);
    guest.connect(room, guest_member.creds).await.unwrap();

    let cipher = RoomCipher::new([9u8; 32], [1, 2, 3, 4]);
    let mut host_rx = host.subscribe();
    let mut guest_rx = guest.subscribe();
    deliver(
        &guest,
        &mut host_rx,
        &cipher,
        &PoseFrame::new(1, 11, now_us()),
    )
    .await;
    deliver(
        &host,
        &mut guest_rx,
        &cipher,
        &PoseFrame::new(0, 12, now_us()),
    )
    .await;

    assert_eq!(host.stats().received, 1);
    assert_eq!(guest.stats().sent, 1);

    guest.close().await;
    host.close().await;
}

/// The relay must bind a non-loopback `RELAY_UDP_BIND_IP`, because `ex_ice` rejects loopback.
#[tokio::test]
#[ignore = "needs a running apps/relay and RELAY_URL"]
async fn encrypted_pose_round_trips_over_str0m_datachannels() {
    let (room, host_member, guest_member) = host_and_guest(TransportKind::ExWebRtc).await;
    let mut host = Str0mTransport::new(host_member.signaling, None);
    host.connect(room.clone(), host_member.creds).await.unwrap();
    let mut guest = Str0mTransport::new(guest_member.signaling, None);
    guest.connect(room, guest_member.creds).await.unwrap();

    let cipher = RoomCipher::new([9u8; 32], [1, 2, 3, 4]);
    let mut host_rx = host.subscribe();
    let mut guest_rx = guest.subscribe();
    deliver(
        &guest,
        &mut host_rx,
        &cipher,
        &PoseFrame::new(1, 21, now_us()),
    )
    .await;
    deliver(
        &host,
        &mut guest_rx,
        &cipher,
        &PoseFrame::new(0, 22, now_us()),
    )
    .await;

    let stats = host.stats();
    assert_eq!(stats.kind, TransportKind::ExWebRtc);
    assert!(stats.sent >= 1 && stats.received >= 1, "{stats:?}");

    guest.close().await;
    host.close().await;
}
