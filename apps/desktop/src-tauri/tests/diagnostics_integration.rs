use futures_util::{SinkExt, StreamExt};
use opensekai_contracts::*;
use opensekai_desktop_lib::service::{start_service, ServiceConfig, ServiceHandle};
use serde_json::{json, Value};
use std::time::Duration;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
async fn service(evaluation: bool) -> (tempfile::TempDir, ServiceHandle) {
    let dir = tempfile::tempdir().unwrap();
    let manifest = dir.path().join("manifest.json");
    std::fs::write(
        &manifest,
        r#"{"schemaVersion":1,"fixtureId":"smoke_v1","assets":[]}"#,
    )
    .unwrap();
    std::fs::write(dir.path().join("index.html"), "shell").unwrap();
    let service = start_service(ServiceConfig {
        output_root: dir.path().into(),
        asset_manifest: manifest,
        evidence_root: dir.path().into(),
        evaluation_enabled: evaluation,
    })
    .await
    .unwrap();
    (dir, service)
}
async fn send(socket: &mut Socket, value: Value) {
    socket
        .send(Message::Text(value.to_string().into()))
        .await
        .unwrap();
}
async fn recv(socket: &mut Socket) -> Value {
    let text = tokio::time::timeout(Duration::from_secs(3), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
        .into_text()
        .unwrap();
    serde_json::from_str(&text).unwrap()
}
async fn auth(descriptor: &ConnectionDescriptor) -> Socket {
    let (mut socket, _) = connect_async(&descriptor.ws_url).await.unwrap();
    send(&mut socket,json!({"kind":"auth","role":descriptor.role,"token":descriptor.token,"schemaVersion":1,"outputId":descriptor.output_id})).await;
    assert_eq!(recv(&mut socket).await["kind"], "authReply");
    socket
}
fn frame(session: &str, sequence: u64) -> Value {
    json!({"kind":"frame","frame":{"schemaVersion":1,"sessionId":session,"sequence":sequence,"tick":sequence,"elapsedMs":sequence as f64,"scene":{"schemaVersion":1,"sceneId":"scene_main","revision":0,"entities":[{"kind":"camera","id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,0,5],"rotation":[0,0,0,1],"scale":[1,1,1]},"lens":{"fovDegrees":45,"near":0.1,"far":100}}],"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]}}})
}
fn applied(session: &str, sequence: u64) -> Value {
    json!({"kind":"applied","frame":{"sessionId":session,"outputId":"output_main","sequence":sequence,"tick":sequence,"revision":0,"cameraId":"camera_main","backend":"webgl2","cpuMs":1,"gpuMs":null,"warnings":[]}})
}
fn diagnostics(session: &str, sequence: u64) -> Value {
    json!({"kind":"diagnostics","diagnostics":{"sessionId":session,"outputId":"output_main","rendererEpoch":"epoch_1","sequence":sequence,"revision":0,"backend":"webgl2","geometries":3,"textures":4,"liveMaterials":2,"assetCacheEntries":2,"activeRenderJob":false,"queuedFrames":0,"queuedCaptures":0}})
}
#[tokio::test]
async fn renderer_diagnostics_snapshot_uses_real_ack_and_operator_http() {
    let (_dir, service) = service(true).await;
    let pd = service.publisher_descriptor();
    let mut publisher = auth(&pd).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    send(&mut publisher, frame(&pd.session_id, 1)).await;
    recv(&mut renderer).await;
    send(&mut renderer, applied(&pd.session_id, 1)).await;
    send(&mut renderer, diagnostics(&pd.session_id, 1)).await;
    let value = wait_snapshot(&service, "geometries 3", |status, body| {
        status == 200 && body["renderer"]["geometries"] == 3
    })
    .await;
    assert_eq!(value["renderer"]["geometries"], 3);
    service.shutdown().await.unwrap();
}
async fn publish(
    service: &ServiceHandle,
    publisher: &mut Socket,
    renderer: &mut Socket,
    sequence: u64,
) {
    let session = service.publisher_descriptor().session_id;
    send(publisher, frame(&session, sequence)).await;
    recv(renderer).await;
    send(renderer, applied(&session, sequence)).await;
}
async fn snapshot(service: &ServiceHandle) -> reqwest::Response {
    let od = service.operator_descriptor();
    reqwest::Client::new()
        .get(format!("{}/diagnostics/output_main", od.http_origin))
        .bearer_auth(od.token)
        .send()
        .await
        .unwrap()
}
// The host stores diagnostics in the renderer connection task, so poll the snapshot
// instead of a fixed sleep. Keep the deadline under the 2 s clock credit: after it, the
// host drops the silent test publisher.
async fn wait_snapshot(
    service: &ServiceHandle,
    what: &str,
    expected: impl Fn(u16, &Value) -> bool,
) -> Value {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(1);
    loop {
        let response = snapshot(service).await;
        let status = response.status().as_u16();
        let text = response.text().await.unwrap();
        let body = serde_json::from_str(&text).unwrap_or(Value::Null);
        if expected(status, &body) {
            return body;
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("diagnostics snapshot not {what} after 1 s: status {status}, body {text:?}");
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}
// The host handles renderer messages in order, so its pong proves that each earlier
// message on this socket was handled. A poll cannot prove that a value stays the same.
async fn barrier(socket: &mut Socket) {
    send(socket, json!({"kind":"ping","requestId":"barrier"})).await;
    while recv(socket).await["kind"] != "pong" {}
}
#[tokio::test]
async fn diagnostics_rate_provenance_disconnect_epoch_and_http_policy() {
    let (_dir, service) = service(true).await;
    let pd = service.publisher_descriptor();
    let od = service.operator_descriptor();
    let rd = service.renderer_descriptor("output_main").unwrap();
    let mut publisher = auth(&pd).await;
    let mut renderer = auth(&rd).await;
    publish(&service, &mut publisher, &mut renderer, 1).await;
    send(&mut renderer, diagnostics(&pd.session_id, 1)).await;
    let initial = wait_snapshot(&service, "sequence 1", |status, body| {
        status == 200 && body["renderer"]["sequence"] == 1
    })
    .await;
    assert!(initial["receivedAgeMs"].as_u64().unwrap() < 500);
    for (name, limit) in [
        ("stateFrames", 2),
        ("deliveredFrames", 2),
        ("controls", 64),
        ("pendingCallsPerOwner", 32),
        ("ackHistory", 32),
    ] {
        assert!(initial["native"][name].as_u64().unwrap() <= limit);
    }
    let http = reqwest::Client::new();
    let url = format!("{}/diagnostics/output_main", od.http_origin);
    assert_eq!(http.get(&url).send().await.unwrap().status(), 401);
    assert_eq!(
        http.get(&url)
            .bearer_auth(&rd.token)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        http.get(&url)
            .bearer_auth(&od.token)
            .header("Origin", "https://example.test")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        http.get(format!("{url}?x=1"))
            .bearer_auth(&od.token)
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        http.get(format!("{}/diagnostics/%6futput_main", od.http_origin))
            .bearer_auth(&od.token)
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    let response = http
        .get(&url)
        .bearer_auth(&od.token)
        .header("Origin", &od.http_origin)
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.headers()["access-control-allow-origin"],
        od.http_origin
    );
    publish(&service, &mut publisher, &mut renderer, 2).await;
    let mut next = diagnostics(&pd.session_id, 2);
    next["diagnostics"]["geometries"] = json!(5);
    send(&mut renderer, next.clone()).await;
    barrier(&mut renderer).await;
    let response = snapshot(&service).await;
    let status = response.status();
    let text = response.text().await.unwrap();
    assert_eq!(status, 200, "rate-limited snapshot body {text:?}");
    let value: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        value["renderer"]["sequence"], 1,
        "rate-limited snapshot {value}"
    );
    tokio::time::sleep(Duration::from_millis(1000)).await;
    publish(&service, &mut publisher, &mut renderer, 3).await;
    next["diagnostics"]["sequence"] = json!(3);
    send(&mut renderer, next).await;
    wait_snapshot(&service, "geometries 5", |status, body| {
        status == 200 && body["renderer"]["geometries"] == 5
    })
    .await;
    renderer.close(None).await.unwrap();
    wait_snapshot(&service, "removed after close", |status, _| status == 404).await;
    let mut renderer = auth(&rd).await;
    recv(&mut renderer).await;
    send(&mut renderer, applied(&pd.session_id, 3)).await;
    let mut new_epoch = diagnostics(&pd.session_id, 3);
    new_epoch["diagnostics"]["rendererEpoch"] = json!("epoch_2");
    send(&mut renderer, new_epoch).await;
    wait_snapshot(&service, "epoch_2", |status, body| {
        status == 200 && body["renderer"]["rendererEpoch"] == "epoch_2"
    })
    .await;
    let mut invalid = diagnostics(&pd.session_id, 4);
    invalid["diagnostics"]["rendererEpoch"] = json!("epoch_2");
    send(&mut renderer, invalid).await;
    wait_snapshot(&service, "removed after invalid", |status, _| status == 404).await;
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn diagnostics_refuses_nonrenderer_and_scope_mismatch_but_keeps_disabled_output_alive() {
    for role in [Role::Publisher, Role::Operator] {
        let (_dir, service) = service(true).await;
        let descriptor = if role == Role::Publisher {
            service.publisher_descriptor()
        } else {
            service.operator_descriptor()
        };
        let mut socket = auth(&descriptor).await;
        if role == Role::Publisher {
            assert_eq!(recv(&mut socket).await["kind"], "clock");
        }
        send(&mut socket, diagnostics(&descriptor.session_id, 1)).await;
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(1), socket.next())
                .await
                .unwrap(),
            None | Some(Err(_)) | Some(Ok(Message::Close(_)))
        ));
        service.shutdown().await.unwrap();
    }
    for field in ["sessionId", "outputId", "revision", "backend"] {
        let (_dir, service) = service(true).await;
        let pd = service.publisher_descriptor();
        let mut publisher = auth(&pd).await;
        let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
        publish(&service, &mut publisher, &mut renderer, 1).await;
        let mut bad = diagnostics(&pd.session_id, 1);
        bad["diagnostics"][field] = if field == "revision" {
            json!(1)
        } else if field == "backend" {
            json!("webgpu")
        } else {
            json!("other")
        };
        send(&mut renderer, bad).await;
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(1), renderer.next())
                .await
                .unwrap(),
            None | Some(Err(_)) | Some(Ok(Message::Close(_)))
        ));
        service.shutdown().await.unwrap();
    }
    let (_dir, service) = service(false).await;
    let pd = service.publisher_descriptor();
    let mut publisher = auth(&pd).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    publish(&service, &mut publisher, &mut renderer, 1).await;
    send(&mut renderer, diagnostics(&pd.session_id, 1)).await;
    publish(&service, &mut publisher, &mut renderer, 2).await;
    assert_eq!(snapshot(&service).await.status(), 404);
    service.shutdown().await.unwrap();
}
