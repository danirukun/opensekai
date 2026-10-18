// Real UDP boundary: the endpoint socket bind, the route by sender IP, and the handshake
// datagrams are what these tests check (B5 R6, R8-R10, Operation 3).
use futures_util::{SinkExt, StreamExt};
use opensekai_contracts::*;
use opensekai_desktop_lib::service::{start_service, ServiceConfig};
use opensekai_desktop_lib::tracking::{TrackingManager, IFACIAL_HANDSHAKE};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
async fn send(s: &mut Socket, v: Value) {
    s.send(Message::Text(v.to_string().into())).await.unwrap();
}
async fn next(s: &mut Socket) -> Value {
    let m = tokio::time::timeout(Duration::from_secs(3), s.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    serde_json::from_str(&m.into_text().unwrap()).unwrap()
}

// Tests that bind or send to the fixed phone port run one at a time.
static PHONE_PORT: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn free_port() -> u16 {
    std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}
fn source(id: &str, generation: u64, config: TrackingConfig) -> SceneEntity {
    SceneEntity::Tracking {
        smoothing: None,
        id: id.into(),
        name: format!("Source {id}"),
        visible: true,
        transform: Transform {
            position: [0.; 3],
            rotation: [0., 0., 0., 1.],
            scale: [1.; 3],
        },
        generation,
        config,
    }
}
fn phone(port: u16, phone_address: Option<&str>) -> TrackingConfig {
    TrackingConfig::IFacialMocap {
        enabled: true,
        bind_address: "127.0.0.1".into(),
        port,
        phone_address: phone_address.map(Into::into),
    }
}
fn scene(revision: u64, entities: Vec<SceneEntity>) -> SceneView {
    SceneView {
        schema_version: 1,
        scene_id: "s".into(),
        revision,
        outputs: vec![],
        entities,
    }
}
fn status<'a>(update: &'a TrackingUpdate, id: &str) -> &'a TrackingStatus {
    update.statuses.iter().find(|s| s.source_id == id).unwrap()
}
fn sample<'a>(update: &'a TrackingUpdate, id: &str) -> Option<&'a TrackingSample> {
    update.samples.iter().find(|s| s.source_id == id)
}
async fn until(manager: &TrackingManager, ok: impl Fn(&TrackingUpdate) -> bool) -> TrackingUpdate {
    for _ in 0..200 {
        let update = manager.snapshot();
        if ok(&update) {
            return update;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("condition not reached: {:?}", manager.snapshot());
}
async fn handshake(phone: &UdpSocket, wait: Duration) -> Option<(Instant, u16)> {
    let mut buffer = [0u8; 256];
    let (size, from) = tokio::time::timeout(wait, phone.recv_from(&mut buffer))
        .await
        .ok()?
        .unwrap();
    assert_eq!(&buffer[..size], IFACIAL_HANDSHAKE);
    Some((Instant::now(), from.port()))
}
fn osc_string(b: &mut Vec<u8>, s: &str) {
    b.extend(s.as_bytes());
    b.push(0);
    while !b.len().is_multiple_of(4) {
        b.push(0);
    }
}
fn pose(address: &str, name: &str, values: [f32; 7]) -> Vec<u8> {
    let mut b = vec![];
    osc_string(&mut b, address);
    osc_string(&mut b, ",sfffffff");
    osc_string(&mut b, name);
    for v in values {
        b.extend(v.to_be_bytes());
    }
    b
}
fn bundle(messages: &[Vec<u8>]) -> Vec<u8> {
    let mut b = b"#bundle\0".to_vec();
    b.extend([0; 8]);
    for m in messages {
        b.extend((m.len() as u32).to_be_bytes());
        b.extend(m);
    }
    b
}

// (a) VMC bytes over UDP reach the credited publisher clock as one sample.
#[tokio::test]
async fn vmc_bundle_reaches_credited_clock_as_one_sample() {
    let dir = tempfile::tempdir().unwrap();
    let manifest = dir.path().join("manifest.json");
    std::fs::write(
        &manifest,
        r#"{"schemaVersion":1,"fixtureId":"smoke_v1","assets":[]}"#,
    )
    .unwrap();
    let service = start_service(ServiceConfig {
        output_root: dir.path().into(),
        asset_manifest: manifest,
        evidence_root: dir.path().into(),
        evaluation_enabled: false,
    })
    .await
    .unwrap();
    let pd = service.publisher_descriptor();
    let (mut publisher, _) = connect_async(&pd.ws_url).await.unwrap();
    send(
        &mut publisher,
        json!({"kind":"auth","role":pd.role,"token":pd.token,"schemaVersion":1,"outputId":pd.output_id}),
    )
    .await;
    assert_eq!(next(&mut publisher).await["kind"], "authReply");
    next(&mut publisher).await;
    let port = free_port();
    let frame = |sequence: u64| json!({"kind":"frame","frame":{"schemaVersion":1,"sessionId":pd.session_id,"sequence":sequence,"tick":sequence,"elapsedMs":sequence,"scene":{"schemaVersion":1,"sceneId":"scene_main","revision":1,"outputs":[],"entities":[{"kind":"tracking","id":"body","name":"VMC","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"generation":1,"config":{"kind":"vmc","enabled":true,"bindAddress":"127.0.0.1","port":port,"senderAddress":null}}]}}});
    send(&mut publisher, frame(1)).await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    let sender = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let packet = bundle(&[
        pose("/VMC/Ext/Root/Pos", "root", [1., 0., 2., 0., 0., 0., 1.]),
        pose("/VMC/Ext/Bone/Pos", "Head", [0., 1.5, 0., 0., 0., 0., 1.]),
    ]);
    sender.send_to(&packet, ("127.0.0.1", port)).await.unwrap();
    let mut found = None;
    for sequence in 2..30 {
        let clock = next(&mut publisher).await;
        assert_eq!(clock["kind"], "clock");
        if clock["tracking"]["samples"]
            .as_array()
            .is_some_and(|s| !s.is_empty())
        {
            found = Some(clock);
            break;
        }
        send(&mut publisher, frame(sequence)).await;
    }
    let clock = found.expect("no tracking sample on the clock");
    let samples = clock["tracking"]["samples"].as_array().unwrap();
    assert_eq!(samples.len(), 1);
    assert_eq!(samples[0]["sourceId"], "body");
    assert_eq!(samples[0]["root"]["position"], json!([1.0, 0.0, -2.0]));
    assert_eq!(
        samples[0]["bones"]["head"]["position"],
        json!([0.0, 1.5, 0.0])
    );
    assert_eq!(samples[0]["bones"]["head"]["space"], "raw");
    service.shutdown().await.unwrap();
}

// (b) The handshake goes from the endpoint port after bind, again after 2000 ms with no data,
// and not while packets arrive; it stops when the source stops.
#[tokio::test]
async fn ifacial_handshake_retries_from_endpoint_socket() {
    let _guard = PHONE_PORT.lock().await;
    let phone_socket = UdpSocket::bind(("127.0.0.1", 49983)).await.unwrap();
    let port = free_port();
    let manager = TrackingManager::new(Instant::now());
    manager
        .reconcile(&scene(
            1,
            vec![source("face", 1, phone(port, Some("127.0.0.1")))],
        ))
        .await;
    let (first, from) = handshake(&phone_socket, Duration::from_secs(1))
        .await
        .expect("handshake after bind");
    assert_eq!(from, port);
    let (second, from) = handshake(&phone_socket, Duration::from_secs(3))
        .await
        .expect("handshake retry");
    assert_eq!(from, port);
    assert!(
        second - first >= Duration::from_millis(2000),
        "{:?}",
        second - first
    );
    let streaming = Instant::now();
    let mut last_packet = streaming;
    while streaming.elapsed() < Duration::from_millis(2600) {
        phone_socket
            .send_to(b"jawOpen&50|", ("127.0.0.1", port))
            .await
            .unwrap();
        last_packet = Instant::now();
        assert!(
            handshake(&phone_socket, Duration::from_millis(100))
                .await
                .is_none(),
            "handshake while packets arrive"
        );
    }
    assert_eq!(
        status(&manager.snapshot(), "face").state,
        TrackingState::Receiving
    );
    let (resumed, _) = handshake(&phone_socket, Duration::from_secs(2))
        .await
        .expect("handshake after packets stop");
    assert!(resumed - last_packet >= Duration::from_millis(450));
    let mut stopped = phone(port, Some("127.0.0.1"));
    if let TrackingConfig::IFacialMocap { enabled, .. } = &mut stopped {
        *enabled = false;
    }
    manager
        .reconcile(&scene(2, vec![source("face", 2, stopped)]))
        .await;
    assert!(handshake(&phone_socket, Duration::from_millis(2300))
        .await
        .is_none());
    manager.shutdown().await;
}

// (c) Two phones on one port route by sender IP; a third IP counts as unmatched on both.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn shared_endpoint_routes_two_phones_by_sender_ip() {
    let _guard = PHONE_PORT.lock().await;
    let port = free_port();
    let manager = TrackingManager::new(Instant::now());
    manager
        .reconcile(&scene(
            1,
            vec![
                source("one", 1, phone(port, Some("127.0.0.1"))),
                source("two", 1, phone(port, Some("127.0.0.2"))),
            ],
        ))
        .await;
    let update = manager.snapshot();
    assert_eq!(status(&update, "one").state, TrackingState::Waiting);
    assert_eq!(status(&update, "two").state, TrackingState::Waiting);
    let one = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let two = UdpSocket::bind("127.0.0.2:0").await.unwrap();
    let other = UdpSocket::bind("127.0.0.3:0").await.unwrap();
    one.send_to(b"jawOpen&10|", ("127.0.0.1", port))
        .await
        .unwrap();
    two.send_to(b"jawOpen&90|", ("127.0.0.1", port))
        .await
        .unwrap();
    other
        .send_to(b"jawOpen&50|", ("127.0.0.1", port))
        .await
        .unwrap();
    let update = until(&manager, |u| {
        u.samples.len() == 2 && u.statuses.iter().all(|s| s.unmatched_packets == Some(1))
    })
    .await;
    assert_eq!(sample(&update, "one").unwrap().expressions["jawOpen"], 0.1);
    assert_eq!(sample(&update, "two").unwrap().expressions["jawOpen"], 0.9);
    assert_eq!(status(&update, "one").packets, 1);
    assert_eq!(status(&update, "two").packets, 1);
    manager.shutdown().await;
}

// (d) A second source that joins and leaves the shared endpoint does not reset the first.
#[tokio::test]
async fn joining_and_leaving_keeps_first_source_state_and_retry() {
    let _guard = PHONE_PORT.lock().await;
    let phone_socket = UdpSocket::bind(("127.0.0.1", 49983)).await.unwrap();
    let port = free_port();
    let manager = TrackingManager::new(Instant::now());
    let first = source("one", 1, phone(port, Some("127.0.0.1")));
    manager.reconcile(&scene(1, vec![first.clone()])).await;
    let (sent, _) = handshake(&phone_socket, Duration::from_secs(1))
        .await
        .expect("handshake after bind");
    phone_socket
        .send_to(b"jawOpen&50|", ("127.0.0.1", port))
        .await
        .unwrap();
    let before = until(&manager, |u| u.samples.len() == 1).await;
    let second = source("two", 1, phone(port, Some("127.0.0.2")));
    manager
        .reconcile(&scene(2, vec![first.clone(), second]))
        .await;
    let joined = manager.snapshot();
    assert_eq!(status(&joined, "two").state, TrackingState::Waiting);
    assert_eq!(status(&joined, "one"), status(&before, "one"));
    assert_eq!(sample(&joined, "one"), sample(&before, "one"));
    assert!(handshake(&phone_socket, Duration::from_millis(300))
        .await
        .is_none());
    manager.reconcile(&scene(3, vec![first])).await;
    let left = manager.snapshot();
    assert_eq!(left.statuses.len(), 1);
    assert_eq!(status(&left, "one"), status(&before, "one"));
    assert_eq!(sample(&left, "one"), sample(&before, "one"));
    let (retry, from) = handshake(&phone_socket, Duration::from_secs(3))
        .await
        .expect("retry continues");
    assert_eq!(from, port);
    assert!(retry - sent >= Duration::from_millis(2000));
    manager.shutdown().await;
}

// (e) A source that failed to bind binds on the next revision after the port is free.
#[tokio::test]
async fn failed_bind_retries_on_next_revision() {
    let occupied = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
    let port = occupied.local_addr().unwrap().port();
    let manager = TrackingManager::new(Instant::now());
    let body = source(
        "body",
        1,
        TrackingConfig::Vmc {
            enabled: true,
            bind_address: "127.0.0.1".into(),
            port,
            sender_address: None,
        },
    );
    manager.reconcile(&scene(1, vec![body.clone()])).await;
    let failed = manager.snapshot();
    assert_eq!(status(&failed, "body").state, TrackingState::Error);
    assert_eq!(
        status(&failed, "body").error.as_deref(),
        Some("Cannot bind receiver endpoint")
    );
    drop(occupied);
    manager.reconcile(&scene(2, vec![body])).await;
    assert_eq!(
        status(&manager.snapshot(), "body").state,
        TrackingState::Waiting
    );
    let sender = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    sender
        .send_to(
            &pose("/VMC/Ext/Bone/Pos", "Head", [0., 0., 0., 0., 0., 0., 1.]),
            ("127.0.0.1", port),
        )
        .await
        .unwrap();
    until(&manager, |u| u.samples.len() == 1).await;
    manager.shutdown().await;
}

// R9 and R10: a conflict names the winner, and the loser gets the endpoint when it is free.
#[tokio::test]
async fn endpoint_conflict_names_winner_and_retries_when_holder_leaves() {
    let port = free_port();
    let manager = TrackingManager::new(Instant::now());
    let first = source("first", 1, phone(port, None));
    let second = source("second", 1, phone(port, None));
    manager
        .reconcile(&scene(1, vec![first.clone(), second.clone()]))
        .await;
    let update = manager.snapshot();
    assert_eq!(status(&update, "first").state, TrackingState::Waiting);
    assert_eq!(status(&update, "second").state, TrackingState::Error);
    assert_eq!(
        status(&update, "second").error.as_deref(),
        Some("Endpoint used by Source first")
    );
    manager.reconcile(&scene(2, vec![second])).await;
    let update = manager.snapshot();
    assert_eq!(status(&update, "second").state, TrackingState::Waiting);
    assert_eq!(status(&update, "second").error, None);
    let sender = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    sender
        .send_to(b"jawOpen&50|", ("127.0.0.1", port))
        .await
        .unwrap();
    until(&manager, |u| sample(u, "second").is_some()).await;
    manager.shutdown().await;
}
