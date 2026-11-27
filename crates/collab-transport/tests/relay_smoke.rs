use std::time::Duration;

use collab_transport::signaling::{ServerEvent, SignalingClient};
use collab_transport::{
    now_us, MocapTransport, PoseFrame, RoomCipher, RoomRef, SendOutcome, TransportCreds,
    WebSocketTransport,
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

/// Run with `RELAY_URL=ws://127.0.0.1:4017 cargo test -p collab-transport --test relay_smoke -- --ignored`.
#[tokio::test]
#[ignore = "needs a running apps/relay and RELAY_URL"]
async fn encrypted_pose_round_trips_through_the_relay() {
    let url = std::env::var("RELAY_URL").expect("RELAY_URL");
    let room_id = format!("smoke-{}", now_us());
    let room = RoomRef {
        room_id: room_id.clone(),
        hz: 60,
    };

    let host_signaling = SignalingClient::connect(&url, &room_id).await.unwrap();
    let mut host_events = host_signaling.subscribe_events();
    let created = host_signaling
        .create("host-secret", "websocket", 60)
        .await
        .unwrap();
    let host_creds = TransportCreds::from_relay_value(&created["creds"]).unwrap();
    assert_eq!(host_creds.slot(), 0);
    let mut host = WebSocketTransport::new(host_signaling.clone(), None);
    host.connect(room.clone(), host_creds).await.unwrap();

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
    assert_eq!(guest_creds.slot(), 1);
    let mut guest = WebSocketTransport::new(guest_signaling.clone(), None);
    guest.connect(room, guest_creds).await.unwrap();

    let cipher = RoomCipher::new([9u8; 32], [1, 2, 3, 4]);
    let mut host_rx = host.subscribe();
    let mut guest_rx = guest.subscribe();

    let guest_frame = PoseFrame::new(1, 11, now_us());
    assert_eq!(
        guest.send_pose(&cipher.encrypt(&guest_frame).unwrap()),
        SendOutcome::Sent
    );
    let received = timeout(WAIT, host_rx.recv()).await.unwrap().unwrap();
    assert_eq!(received.slot, 1);
    assert_eq!(
        cipher.decrypt(received.slot, &received.ciphertext).unwrap(),
        guest_frame
    );

    let host_frame = PoseFrame::new(0, 12, now_us());
    assert_eq!(
        host.send_pose(&cipher.encrypt(&host_frame).unwrap()),
        SendOutcome::Sent
    );
    let received = timeout(WAIT, guest_rx.recv()).await.unwrap().unwrap();
    assert_eq!(received.slot, 0);
    assert_eq!(
        cipher.decrypt(received.slot, &received.ciphertext).unwrap(),
        host_frame
    );

    assert_eq!(host.stats().received, 1);
    assert_eq!(guest.stats().sent, 1);

    guest.close().await;
    host.close().await;
}
