// Socket boundary of capture screens (B31 Operation 3). The `/capture` route, its auth, and its
// binary framing are a protocol boundary, so these tests connect real WebSockets to the service
// with the fixture adapter. Run with:
// cargo test -p opensekai-desktop --features capture-fixture --test capture_integration
use futures_util::{SinkExt, StreamExt};
use opensekai_contracts::*;
use opensekai_desktop_lib::capture::fixture::{FixtureAdapter, FIXTURE_DISPLAY};
use opensekai_desktop_lib::service::{start_service, ServiceConfig, ServiceHandle};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
fn transform() -> Transform {
    Transform {
        position: [0.; 3],
        rotation: [0., 0., 0., 1.],
        scale: [1.; 3],
    }
}
fn display() -> CaptureSource {
    CaptureSource::Display {
        name: FIXTURE_DISPLAY.into(),
        ordinal: 0,
    }
}
fn screen(id: &str, source: CaptureSource) -> SceneEntity {
    SceneEntity::Screen {
        id: id.into(),
        name: "Screen".into(),
        visible: true,
        transform: transform(),
        content: ScreenContent::Capture {
            target: source.target(),
            source: Some(source),
            cursor: true,
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
/// The next `captureStatus` that passes `check`.
async fn status_where(s: &mut Socket, check: impl Fn(&Value) -> bool) -> Value {
    loop {
        let v = next_non_clock(s).await;
        if v["kind"] == "captureStatus" {
            // Each status passes the shared wire checks.
            parse_wire(v.to_string().as_bytes()).unwrap();
            if check(&v) {
                return v;
            }
        }
    }
}
async fn auth(service: &ServiceHandle, d: &ConnectionDescriptor) -> Socket {
    let _ = service;
    let (mut socket, _) = connect_async(&d.ws_url).await.unwrap();
    send(
        &mut socket,
        json!({"kind":"auth","role":d.role,"token":d.token,"schemaVersion":1,"outputId":d.output_id}),
    )
    .await;
    assert_eq!(next_non_clock(&mut socket).await["kind"], "authReply");
    socket
}
fn capture_url(d: &ConnectionDescriptor) -> String {
    d.ws_url.replace("/ws", "/capture")
}
async fn subscribe(d: &ConnectionDescriptor, token: &str, output: &str, stream: &str) -> Socket {
    let (mut socket, _) = connect_async(capture_url(d)).await.unwrap();
    send(
        &mut socket,
        json!({"kind":"captureAuth","token":token,"outputId":output,"streamId":stream}),
    )
    .await;
    socket
}
/// The close code of a socket that the host closes, or `None` for another message.
async fn close_code(s: &mut Socket) -> Option<u16> {
    loop {
        match tokio::time::timeout(Duration::from_secs(3), s.next()).await {
            Ok(Some(Ok(Message::Close(Some(frame))))) => return Some(u16::from(frame.code)),
            Ok(Some(Ok(Message::Close(None)))) | Ok(None) | Ok(Some(Err(_))) => return Some(0),
            Ok(Some(Ok(Message::Text(_) | Message::Binary(_)))) => return None,
            Ok(Some(Ok(_))) => continue,
            Err(_) => panic!("socket stayed open"),
        }
    }
}
/// A text or binary capture message.
async fn capture_message(s: &mut Socket) -> Message {
    loop {
        let m = tokio::time::timeout(Duration::from_secs(3), s.next())
            .await
            .expect("capture message")
            .expect("open")
            .expect("message");
        if matches!(m, Message::Text(_) | Message::Binary(_) | Message::Close(_)) {
            return m;
        }
    }
}
struct Setup {
    _dir: tempfile::TempDir,
    service: ServiceHandle,
    publisher: Socket,
    renderer: Socket,
    pd: ConnectionDescriptor,
    rd: ConnectionDescriptor,
}
async fn setup() -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let service = start_service(ServiceConfig {
        output_root: dir.path().into(),
        asset_manifest: Default::default(),
        evidence_root: dir.path().join("evidence"),
        evaluation_enabled: false,
    })
    .await
    .unwrap();
    service
        .ports()
        .set_capture_adapter(Arc::new(FixtureAdapter::load()));
    let pd = service.publisher_descriptor();
    let publisher = auth(&service, &pd).await;
    let rd = service.renderer_descriptor("output_main").unwrap();
    let renderer = auth(&service, &rd).await;
    Setup {
        _dir: dir,
        service,
        publisher,
        renderer,
        pd,
        rd,
    }
}
async fn publish(s: &mut Setup, sequence: u64, scene: SceneView) {
    let session = s.pd.session_id.clone();
    send(
        &mut s.publisher,
        json!({"kind":"frame","frame":{"schemaVersion":1,"sessionId":session,"sequence":sequence,"tick":sequence,"elapsedMs":16,"scene":scene}}),
    )
    .await;
}
async fn app_status(s: &Setup) -> Value {
    let od = s.service.operator_descriptor();
    let mut operator = auth(&s.service, &od).await;
    send(
        &mut operator,
        json!({"kind":"call","requestId":"status","method":"appStatus","params":{}}),
    )
    .await;
    next_non_clock(&mut operator).await["result"]["data"].clone()
}
fn live_stream(v: &Value) -> Option<String> {
    let entry = &v["screens"][0];
    (entry["state"] == "live").then(|| entry["streamId"].as_str().unwrap().to_owned())
}

#[tokio::test]
async fn a_source_that_is_not_allowed_shows_not_allowed_and_starts_no_capture() {
    let mut s = setup().await;
    // An opened show and a scene patch reach the host only as a frame; neither allows a source.
    publish(&mut s, 1, scene(1, vec![screen("desk", display())])).await;
    let status = status_where(&mut s.renderer, |_| true).await;
    assert_eq!(
        status["screens"],
        json!([{"entityId":"desk","streamId":null,"state":"notAllowed","width":0,"height":0}])
    );
    let app = app_status(&s).await;
    assert_eq!(app["captures"], json!([{"entityId":"desk","state":"notAllowed"}]));
    // The status names no source.
    assert!(!app.to_string().contains(FIXTURE_DISPLAY));
    assert!(!status.to_string().contains(FIXTURE_DISPLAY));
    // The operator allows the source in the editor: the capture starts.
    s.service.ports().capture_source_allow(display()).unwrap();
    let live = status_where(&mut s.renderer, |v| live_stream(v).is_some()).await;
    assert_eq!(live["screens"][0]["width"], 320);
    assert_eq!(live["screens"][0]["height"], 180);
    assert_eq!(
        app_status(&s).await["captures"],
        json!([{"entityId":"desk","state":"live"}])
    );
    s.service.shutdown().await.unwrap();
}

#[tokio::test]
async fn a_scene_without_capture_screens_sends_one_empty_status_and_the_source_list_works() {
    let mut s = setup().await;
    // R9: one empty list, then nothing for later revisions without a capture screen.
    publish(&mut s, 1, scene(1, vec![])).await;
    let mut kinds = vec![];
    for _ in 0..2 {
        let message = next_non_clock(&mut s.renderer).await;
        if message["kind"] == "captureStatus" {
            assert_eq!(message["screens"], json!([]));
        }
        kinds.push(message["kind"].as_str().unwrap().to_owned());
    }
    kinds.sort();
    assert_eq!(kinds, ["captureStatus", "frame"]);
    publish(&mut s, 2, scene(2, vec![])).await;
    assert_eq!(next_non_clock(&mut s.renderer).await["kind"], "frame");
    assert!(
        tokio::time::timeout(Duration::from_millis(300), next_non_clock(&mut s.renderer))
            .await
            .is_err()
    );
    // A renderer that connects later gets the current (empty) status one time after its auth.
    let late = s.service.renderer_descriptor("output_late").unwrap();
    let mut late = auth(&s.service, &late).await;
    let first = status_where(&mut late, |_| true).await;
    assert_eq!(first["screens"], json!([]));
    assert!(app_status(&s).await.get("captures").is_none());
    let list = s.service.ports().capture_source_list().await;
    assert_eq!(list.error, None);
    assert_eq!(list.sources.len(), 1);
    assert_eq!(list.sources[0].source, display());
    assert_eq!(list.sources[0].label, FIXTURE_DISPLAY);
    s.service.shutdown().await.unwrap();
}

#[tokio::test]
async fn capture_route_streams_auth_limits_and_closes() {
    let mut s = setup().await;
    s.service.ports().capture_source_allow(display()).unwrap();
    publish(&mut s, 1, scene(1, vec![screen("desk", display())])).await;
    let status = status_where(&mut s.renderer, |v| live_stream(v).is_some()).await;
    let stream = live_stream(&status).unwrap();
    let (rd, token) = (s.rd.clone(), s.rd.token.clone());

    // Config, then a key frame, then chunks in order with increasing timestamps across a loop.
    let mut reader = subscribe(&rd, &token, "output_main", &stream).await;
    let Message::Text(config) = capture_message(&mut reader).await else {
        panic!("config first");
    };
    let config: Value = serde_json::from_str(&config).unwrap();
    assert_eq!(config["kind"], "captureConfig");
    assert_eq!(config["codec"], "avc1.4d400d");
    assert_eq!((config["codedWidth"].clone(), config["codedHeight"].clone()), (json!(320), json!(180)));
    let mut timestamps = Vec::new();
    let mut keys = Vec::new();
    while timestamps.len() < 75 {
        let Message::Binary(bytes) = capture_message(&mut reader).await else {
            panic!("binary chunk");
        };
        assert!(bytes.len() > 9 && bytes[0] <= 1);
        keys.push(bytes[0] == 1);
        timestamps.push(u64::from_be_bytes(bytes[1..9].try_into().unwrap()));
        // Each chunk is AVCC: the first NAL unit length fits the chunk.
        let first = u32::from_be_bytes(bytes[9..13].try_into().unwrap()) as usize;
        assert!(first + 4 <= bytes.len() - 9);
    }
    assert!(keys[0], "the first chunk is a key frame");
    assert!(timestamps.windows(2).all(|w| w[1] > w[0]));
    // After the start, a key frame comes each 30 chunks of the 60-chunk loop.
    let later: Vec<_> = keys.iter().enumerate().skip(1).filter(|(_, k)| **k).map(|(i, _)| i).collect();
    assert!(later.len() >= 2 && later.windows(2).all(|w| w[1] - w[0] == 30), "{later:?}");
    assert!(timestamps.last().unwrap() - timestamps[later[0]] >= 2_000_000 - 2 * 33_334);

    // A bad Origin is refused at the upgrade.
    let mut request = capture_url(&rd).into_client_request().unwrap();
    request
        .headers_mut()
        .insert("origin", "https://example.com".parse().unwrap());
    assert!(connect_async(request).await.is_err());
    // A bad token, an operator token, and a renderer token without a /ws connection close with 4401.
    let od = s.service.operator_descriptor();
    let other = s.service.renderer_descriptor("output_other").unwrap();
    for (token, output) in [
        ("bad", "output_main"),
        (od.token.as_str(), "output_main"),
        (other.token.as_str(), "output_other"),
    ] {
        let mut socket = subscribe(&rd, token, output, &stream).await;
        assert_eq!(close_code(&mut socket).await, Some(4401));
    }
    // An unknown stream closes with 4404.
    let mut unknown = subscribe(&rd, &token, "output_main", &"0".repeat(32)).await;
    assert_eq!(close_code(&mut unknown).await, Some(4404));
    // An oversized first message closes.
    let (mut oversized, _) = connect_async(capture_url(&rd)).await.unwrap();
    send(
        &mut oversized,
        json!({"kind":"captureAuth","token":token,"outputId":"output_main","streamId":stream,"pad":"x".repeat(600)}),
    )
    .await;
    assert!(close_code(&mut oversized).await.is_some_and(|code| code != 4429));

    // Four subscribers on one stream; a fifth closes with 4429. Each needs its own renderer connection.
    let mut renderers = Vec::new();
    let mut readers = Vec::new();
    for n in 1..=4 {
        let output = format!("output_{n}");
        let d = s.service.renderer_descriptor(&output).unwrap();
        renderers.push(auth(&s.service, &d).await);
        let socket = subscribe(&d, &d.token, &output, &stream).await;
        readers.push((d, socket));
    }
    // Subscribers 1 to 3 are accepted (with `reader`, 4 in all); the fourth is the fifth.
    for (_, socket) in readers.iter_mut().take(3) {
        assert!(matches!(capture_message(socket).await, Message::Text(_)));
    }
    let (_, fifth) = readers.last_mut().unwrap();
    assert_eq!(close_code(fifth).await, Some(4429));

    // A blocked reader (readers[0] reads nothing more) does not stop another reader.
    let start = tokio::time::Instant::now();
    let mut received = 0;
    while start.elapsed() < Duration::from_secs(1) {
        if let Message::Binary(_) = capture_message(&mut reader).await {
            received += 1;
        }
    }
    assert!(received >= 20, "{received}");
    // A second subscription of one renderer connection replaces the first.
    let mut again = subscribe(&rd, &token, "output_main", &stream).await;
    assert!(matches!(capture_message(&mut again).await, Message::Text(_)));
    loop {
        match capture_message(&mut reader).await {
            Message::Close(_) => break,
            Message::Binary(_) => continue,
            other => panic!("{other:?}"),
        }
    }
    // The capture socket closes when the /ws connection of its renderer closes.
    let mut first_renderer = renderers.remove(0);
    first_renderer.close(None).await.unwrap();
    let (_, socket) = &mut readers[0];
    loop {
        match capture_message(socket).await {
            Message::Close(_) => break,
            _ => continue,
        }
    }
    // The socket closes when the screen is deleted, and the status lists nothing.
    publish(&mut s, 2, scene(2, vec![])).await;
    loop {
        match capture_message(&mut again).await {
            Message::Close(_) => break,
            _ => continue,
        }
    }
    let empty = status_where(&mut s.renderer, |_| true).await;
    assert_eq!(empty["screens"], json!([]));
    s.service.shutdown().await.unwrap();
}

#[tokio::test]
async fn an_idle_stream_starts_again_for_a_new_subscriber() {
    let mut s = setup().await;
    let adapter = FixtureAdapter::load();
    let starts = adapter.starts.clone();
    s.service.ports().set_capture_adapter(Arc::new(adapter));
    s.service.ports().capture_source_allow(display()).unwrap();
    publish(&mut s, 1, scene(1, vec![screen("desk", display())])).await;
    let status = status_where(&mut s.renderer, |v| live_stream(v).is_some()).await;
    let stream = live_stream(&status).unwrap();
    // Nobody subscribes for 5 s: the capture stops and the stream stays as idle.
    let idle = status_where(&mut s.renderer, |v| v["screens"][0]["state"] == "idle").await;
    assert_eq!(idle["screens"][0]["streamId"], stream.as_str());
    let rd = s.rd.clone();
    let mut reader = subscribe(&rd, &rd.token, "output_main", &stream).await;
    status_where(&mut s.renderer, |v| v["screens"][0]["state"] == "live").await;
    let mut key = None;
    while key.is_none() {
        if let Message::Binary(bytes) = capture_message(&mut reader).await {
            key = Some(bytes[0] == 1);
        }
    }
    assert_eq!(key, Some(true));
    assert_eq!(starts.load(std::sync::atomic::Ordering::SeqCst), 2);
    s.service.shutdown().await.unwrap();
}
