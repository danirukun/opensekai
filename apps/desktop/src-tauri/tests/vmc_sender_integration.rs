// Real UDP boundary (B21 Operation 6): the sender sockets, the datagrams that another socket
// receives, and the OpenSekai VMC receiver that decodes them are what these tests check. The
// manager tests use a mock clock with real sockets; the service test uses the real clock.
use futures_util::{SinkExt, StreamExt};
use opensekai_contracts::*;
use opensekai_desktop_lib::service::{start_service, ServiceConfig};
use opensekai_desktop_lib::tracking::TrackingManager;
use opensekai_desktop_lib::vmc_sender::{
    VmcSenderManager, MIN_POSE_INTERVAL, REST_POSE_UNKNOWN, RIG_NOT_SUPPORTED,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

fn free_port() -> u16 {
    std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}
fn transform() -> Transform {
    Transform {
        position: [0.; 3],
        rotation: [0., 0., 0., 1.],
        scale: [1.; 3],
    }
}
fn avatar(asset: &str) -> SceneEntity {
    SceneEntity::Avatar {
        id: "performer".into(),
        name: "Performer".into(),
        visible: true,
        transform: transform(),
        asset_id: Some(asset.into()),
        tracking: None,
        idle_animation: None,
        expressions: None,
    }
}
fn sender(id: &str, enabled: bool, port: u16) -> SceneEntity {
    SceneEntity::VmcSender {
        id: id.into(),
        name: format!("Sender {id}"),
        visible: true,
        transform: transform(),
        vmc_sender: VmcSenderSettings {
            enabled,
            address: "127.0.0.1".into(),
            port,
            avatar_id: Some("performer".into()),
        },
    }
}
fn receiver(port: u16) -> SceneEntity {
    SceneEntity::Tracking {
        id: "body".into(),
        name: "VMC Receiver".into(),
        visible: true,
        transform: transform(),
        generation: 1,
        smoothing: None,
        calibration: None,
        mapping: None,
        config: TrackingConfig::Vmc {
            enabled: true,
            bind_address: "127.0.0.1".into(),
            port,
            sender_address: None,
        },
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
fn rig(identity_rest: bool) -> AvatarRig {
    AvatarRig {
        meta_version: RigMetaVersion::V1,
        rest_positions: BTreeMap::from([
            ("hips".into(), [0., 1., 0.]),
            ("head".into(), [0., 0.5, 0.]),
        ]),
        identity_rest,
    }
}
fn record(id: &str, rig: Option<AvatarRig>) -> AssetRecord {
    AssetRecord {
        id: id.into(),
        format: AssetFormat::Vrm,
        sha256: "a".repeat(64),
        bytes: 1,
        source_url: None,
        license_label: String::new(),
        importer_version: 1,
        name: "Avatar".into(),
        credits: None,
        expressions: vec![],
        rig,
    }
}
fn pose(id: &str) -> VmcSendPose {
    let turn = std::f64::consts::FRAC_1_SQRT_2;
    VmcSendPose {
        sender_id: id.into(),
        root: VmcTransform {
            position: [1., 0., 2.],
            rotation: [0., turn, 0., turn],
        },
        bones: BTreeMap::from([
            (
                "hips".into(),
                VmcTransform {
                    position: [0.1, 0.9, -0.2],
                    rotation: [0., 0., 0., 1.],
                },
            ),
            (
                "head".into(),
                VmcTransform {
                    position: [0., 0.5, 0.],
                    rotation: [turn, 0., 0., turn],
                },
            ),
        ]),
        blends: BTreeMap::from([("Joy".into(), 0.5)]),
    }
}
fn no_locals() -> Vec<std::net::IpAddr> {
    vec![]
}
fn state(manager: &VmcSenderManager, id: &str, now: Instant) -> VmcSenderStatus {
    manager
        .statuses_at(now)
        .into_iter()
        .find(|s| s.entity_id == id)
        .unwrap()
}
async fn datagrams(socket: &UdpSocket, wait: Duration) -> Vec<Vec<u8>> {
    let mut out = vec![];
    let mut buffer = [0u8; 2048];
    while let Ok(Ok((size, _))) = tokio::time::timeout(wait, socket.recv_from(&mut buffer)).await {
        out.push(buffer[..size].to_vec());
    }
    out
}

// The OpenSekai VMC receiver decodes what the sender sends: the round trip over a real socket.
#[tokio::test]
async fn opensekai_receiver_decodes_the_sent_pose() {
    let port = free_port();
    let receive = TrackingManager::new(Instant::now());
    receive.reconcile(&scene(1, vec![receiver(port)])).await;
    let manager = VmcSenderManager::new();
    let records = [record("avatar_a", Some(rig(true)))];
    let now = Instant::now();
    manager.reconcile_at(
        &scene(1, vec![avatar("avatar_a"), sender("out", true, port)]),
        &records,
        no_locals,
        now,
    );
    assert_eq!(state(&manager, "out", now).state, VmcSenderState::Waiting);
    let mut found = None;
    for attempt in 0..100u64 {
        manager.submit_at(
            &[pose("out")],
            now + MIN_POSE_INTERVAL * (attempt as u32 + 1),
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
        let update = receive.snapshot();
        if let Some(sample) = update
            .samples
            .iter()
            .find(|s| s.source_id == "body" && !s.expressions.is_empty())
        {
            found = Some(sample.clone());
            break;
        }
    }
    let sample = found.expect("no sample at the receiver");
    let close = |a: f64, b: f64| (a - b).abs() <= 1e-6;
    let sent = pose("out");
    let root = sample.root.unwrap();
    assert!((0..3).all(|i| close(root.position[i], sent.root.position[i])));
    assert!((0..4).all(|i| close(root.rotation[i], sent.root.rotation[i])));
    for (name, bone) in &sent.bones {
        let got = &sample.bones[name];
        assert_eq!(got.space, BoneSpace::Raw);
        let position = got.position.unwrap();
        assert!(
            (0..3).all(|i| close(position[i], bone.position[i])),
            "{name}"
        );
        assert!(
            (0..4).all(|i| close(got.rotation[i], bone.rotation[i])),
            "{name}"
        );
    }
    assert_eq!(sample.expressions["Joy"], 0.5);
    let status = state(&manager, "out", now + MIN_POSE_INTERVAL);
    assert_eq!(status.state, VmcSenderState::Sending);
    assert!(status.datagrams >= 1);
    assert_eq!(status.errors, 0);
    receive.shutdown().await;
}

// A burst of 10 poses in 10 ms sends one; the next pose after 15 ms sends again (R13).
#[tokio::test]
async fn rate_cap_holds_under_a_burst() {
    let target = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let port = target.local_addr().unwrap().port();
    let manager = VmcSenderManager::new();
    let records = [record("avatar_a", Some(rig(true)))];
    let now = Instant::now();
    manager.reconcile_at(
        &scene(1, vec![avatar("avatar_a"), sender("out", true, port)]),
        &records,
        no_locals,
        now,
    );
    for ms in 0..10 {
        manager.submit_at(&[pose("out")], now + Duration::from_millis(ms));
    }
    let first = datagrams(&target, Duration::from_millis(200)).await;
    assert_eq!(first.len(), 1, "one pose fits one datagram");
    assert_eq!(state(&manager, "out", now).datagrams, 1);
    manager.submit_at(&[pose("out")], now + Duration::from_millis(14));
    manager.submit_at(&[pose("out")], now + Duration::from_millis(15));
    assert_eq!(
        datagrams(&target, Duration::from_millis(200)).await.len(),
        1
    );
    assert_eq!(state(&manager, "out", now).datagrams, 2);
    // No pose for 1 s: the sender waits.
    assert_eq!(
        state(&manager, "out", now + Duration::from_millis(1015)).state,
        VmcSenderState::Waiting
    );
}

// A disabled sender, a sender for an unknown pose, and a loop target send nothing (R9-R11).
#[tokio::test]
async fn disabled_unknown_and_loop_targets_send_nothing() {
    let target = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let port = target.local_addr().unwrap().port();
    let manager = VmcSenderManager::new();
    let records = [record("avatar_a", Some(rig(true)))];
    let now = Instant::now();
    manager.reconcile_at(
        &scene(1, vec![avatar("avatar_a"), sender("off", false, port)]),
        &records,
        no_locals,
        now,
    );
    manager.submit_at(&[pose("off"), pose("ghost")], now);
    assert_eq!(state(&manager, "off", now).state, VmcSenderState::Stopped);
    assert!(datagrams(&target, Duration::from_millis(150))
        .await
        .is_empty());
    // An enabled receiver of the same scene on the target port: the guard names it.
    manager.reconcile_at(
        &scene(
            2,
            vec![
                avatar("avatar_a"),
                receiver(port),
                sender("loop", true, port),
            ],
        ),
        &records,
        no_locals,
        now,
    );
    manager.submit_at(&[pose("loop")], now);
    let status = state(&manager, "loop", now);
    assert_eq!(status.state, VmcSenderState::Error);
    assert_eq!(
        status.error.as_deref(),
        Some("Endpoint used by VMC Receiver")
    );
    assert!(datagrams(&target, Duration::from_millis(150))
        .await
        .is_empty());
    // An older revision does not change the senders.
    manager.reconcile_at(&scene(1, vec![]), &records, no_locals, now);
    assert_eq!(manager.statuses_at(now).len(), 1);
}

// A character without rest data or with a rig that is not supported gets its error (R14).
#[tokio::test]
async fn character_errors_come_from_the_record() {
    let port = free_port();
    let manager = VmcSenderManager::new();
    let now = Instant::now();
    for (revision, rig, error) in [
        (1, None, Some(REST_POSE_UNKNOWN)),
        (2, Some(rig(false)), Some(RIG_NOT_SUPPORTED)),
        (3, Some(rig(true)), None),
    ] {
        manager.reconcile_at(
            &scene(
                revision,
                vec![avatar("avatar_a"), sender("out", true, port)],
            ),
            &[record("avatar_a", rig)],
            no_locals,
            now,
        );
        let status = state(&manager, "out", now);
        assert_eq!(status.error.as_deref(), error, "revision {revision}");
        assert_eq!(
            status.state,
            if error.is_some() {
                VmcSenderState::Error
            } else {
                VmcSenderState::Waiting
            }
        );
    }
}

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
async fn send(s: &mut Socket, v: Value) {
    s.send(Message::Text(v.to_string().into())).await.unwrap();
}
async fn next_non_clock(s: &mut Socket) -> Value {
    loop {
        let m = tokio::time::timeout(Duration::from_secs(3), s.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let v: Value = serde_json::from_str(&m.into_text().unwrap()).unwrap();
        if v["kind"] != "clock" {
            return v;
        }
    }
}

// The service routes `vmcPoses` from the publisher to the sockets, never to a renderer, and
// `appStatus` lists the sender (R9, R14).
#[tokio::test]
async fn service_sends_publisher_poses_and_reports_status() {
    let dir = tempfile::tempdir().unwrap();
    let manifest = dir.path().join("manifest.json");
    let fixture = json!({"path": dir.path().join("missing.vrm"), "record": record("fixture_vrm_1", Some(rig(true)))});
    std::fs::write(
        &manifest,
        json!({"schemaVersion":1,"fixtureId":"smoke_v1","assets":[fixture]}).to_string(),
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
    let target = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let port = target.local_addr().unwrap().port();
    let pd = service.publisher_descriptor();
    let (mut publisher, _) = connect_async(&pd.ws_url).await.unwrap();
    send(
        &mut publisher,
        json!({"kind":"auth","role":pd.role,"token":pd.token,"schemaVersion":1,"outputId":pd.output_id}),
    )
    .await;
    assert_eq!(next_non_clock(&mut publisher).await["kind"], "authReply");
    let rd = service.renderer_descriptor("output_main").unwrap();
    let (mut renderer, _) = connect_async(&rd.ws_url).await.unwrap();
    send(
        &mut renderer,
        json!({"kind":"auth","role":rd.role,"token":rd.token,"schemaVersion":1,"outputId":rd.output_id}),
    )
    .await;
    assert_eq!(next_non_clock(&mut renderer).await["kind"], "authReply");
    let scene = scene(1, vec![avatar("fixture_vrm_1"), sender("out", true, port)]);
    send(
        &mut publisher,
        json!({"kind":"frame","frame":{"schemaVersion":1,"sessionId":pd.session_id,"sequence":1,"tick":1,"elapsedMs":16,"scene":scene}}),
    )
    .await;
    assert_eq!(next_non_clock(&mut renderer).await["kind"], "frame");
    tokio::time::sleep(Duration::from_millis(50)).await;
    send(
        &mut publisher,
        json!({"kind":"vmcPoses","sessionId":pd.session_id,"tick":1,"poses":[pose("out")]}),
    )
    .await;
    let received = datagrams(&target, Duration::from_millis(500)).await;
    assert_eq!(received.len(), 1);
    assert!(received[0].starts_with(b"#bundle\0"));
    // The renderer gets no VMC poses.
    let relayed = tokio::time::timeout(Duration::from_millis(200), renderer.next()).await;
    if let Ok(Some(Ok(message))) = relayed {
        assert!(!message.into_text().unwrap().contains("vmcPoses"));
    }
    let od = service.operator_descriptor();
    let (mut operator, _) = connect_async(&od.ws_url).await.unwrap();
    send(
        &mut operator,
        json!({"kind":"auth","role":od.role,"token":od.token,"schemaVersion":1,"outputId":od.output_id}),
    )
    .await;
    assert_eq!(next_non_clock(&mut operator).await["kind"], "authReply");
    send(
        &mut operator,
        json!({"kind":"call","requestId":"status","method":"appStatus","params":{}}),
    )
    .await;
    let status = next_non_clock(&mut operator).await;
    assert_eq!(
        status["result"]["data"]["vmcSenders"],
        json!([{"entityId":"out","state":"sending","datagrams":1,"errors":0,"error":null}])
    );
    // A renderer cannot send poses: the service closes its connection.
    send(
        &mut renderer,
        json!({"kind":"vmcPoses","sessionId":pd.session_id,"tick":2,"poses":[pose("out")]}),
    )
    .await;
    assert!(datagrams(&target, Duration::from_millis(200))
        .await
        .is_empty());
    service.shutdown().await.unwrap();
}
