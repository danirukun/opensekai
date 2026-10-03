use futures_util::{SinkExt, StreamExt};
use opensekai_contracts::*;
use opensekai_desktop_lib::service::{start_service, ServiceConfig, ServiceHandle};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
async fn service() -> (tempfile::TempDir, ServiceHandle) {
    let dir = tempfile::tempdir().unwrap();
    let manifest = dir.path().join("manifest.json");
    std::fs::write(
        &manifest,
        r#"{"schemaVersion":1,"fixtureId":"smoke_v1","assets":[]}"#,
    )
    .unwrap();
    let s = start_service(ServiceConfig {
        output_root: dir.path().into(),
        asset_manifest: manifest,
        evidence_root: dir.path().into(),
        evaluation_enabled: false,
    })
    .await
    .unwrap();
    (dir, s)
}
async fn send(s: &mut Socket, v: Value) {
    s.send(Message::Text(v.to_string().into())).await.unwrap();
}
async fn recv(s: &mut Socket) -> Value {
    let m = tokio::time::timeout(Duration::from_secs(3), s.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    serde_json::from_str(&m.into_text().unwrap()).unwrap()
}
async fn auth(d: &ConnectionDescriptor) -> Socket {
    let (mut s, _) = connect_async(&d.ws_url).await.unwrap();
    send(&mut s,json!({"kind":"auth","role":d.role,"token":d.token,"schemaVersion":1,"outputId":d.output_id})).await;
    assert_eq!(recv(&mut s).await["kind"], "authReply");
    s
}
fn frame(session: &str, sequence: u64) -> Value {
    json!({"kind":"frame","frame":{"schemaVersion":1,"sessionId":session,"sequence":sequence,"tick":sequence,"elapsedMs":sequence as f64,"scene":{"schemaVersion":1,"sceneId":"scene_main","revision":0,"entities":[],"outputs":[]}}})
}
async fn closed(s: &mut Socket) {
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(3), s.next())
            .await
            .unwrap(),
        None | Some(Err(_)) | Some(Ok(Message::Close(_)))
    ));
}
#[tokio::test]
async fn clock_has_one_outstanding_credit_and_native_timeout() {
    let (_d, s) = service().await;
    let pd = s.publisher_descriptor();
    let mut p = auth(&pd).await;
    let first = recv(&mut p).await;
    assert_eq!(first["kind"], "clock");
    assert_eq!(first["sessionId"], pd.session_id);
    assert!(tokio::time::timeout(Duration::from_millis(100), p.next())
        .await
        .is_err());
    send(&mut p, frame(&pd.session_id, 1)).await;
    let next = recv(&mut p).await;
    assert!(next["elapsedMs"].as_u64().unwrap() > first["elapsedMs"].as_u64().unwrap());
    let started = Instant::now();
    closed(&mut p).await;
    assert!(started.elapsed() >= Duration::from_millis(1800));
    assert!(s.last_applied("output_main").is_none());
    s.shutdown().await.unwrap();
}
#[tokio::test]
async fn clock_is_publisher_only_injected_clock_is_rejected_and_shutdown_interrupts() {
    let (_d, s) = service().await;
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut r = auth(&s.renderer_descriptor("output_main").unwrap()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    assert_eq!(recv(&mut p).await["kind"], "clock");
    assert!(tokio::time::timeout(Duration::from_millis(60), r.next())
        .await
        .is_err());
    assert!(tokio::time::timeout(Duration::from_millis(60), o.next())
        .await
        .is_err());
    for socket in [&mut p, &mut r, &mut o] {
        send(
            socket,
            json!({"kind":"clock","sessionId":s.publisher_descriptor().session_id,"elapsedMs":0}),
        )
        .await;
        closed(socket).await;
    }
    let mut p = auth(&s.publisher_descriptor()).await;
    let clock = recv(&mut p).await;
    assert_eq!(clock["kind"], "clock");
    let started = Instant::now();
    s.shutdown().await.unwrap();
    closed(&mut p).await;
    assert!(started.elapsed() < Duration::from_millis(500));
}
#[tokio::test]
async fn due_clocks_progress_under_sustained_control_without_credit_accumulation() {
    let (_d, s) = service().await;
    let pd = s.publisher_descriptor();
    let mut p = auth(&pd).await;
    let started = Instant::now();
    let mut clocks = 0;
    let mut last = 0;
    while started.elapsed() < Duration::from_millis(300) {
        send(&mut p, json!({"kind":"ping","requestId":"control"})).await;
        let message = recv(&mut p).await;
        if message["kind"] == "clock" {
            let elapsed = message["elapsedMs"].as_u64().unwrap();
            assert!(clocks == 0 || elapsed > last);
            last = elapsed;
            clocks += 1;
            send(&mut p, frame(&pd.session_id, clocks)).await;
        } else {
            assert_eq!(message["kind"], "pong");
        }
    }
    assert!(clocks >= 8, "clock starved: {clocks}");
    send(&mut p, frame(&pd.session_id, clocks + 1)).await;
    send(&mut p, frame(&pd.session_id, clocks + 2)).await;
    let deadline = Instant::now() + Duration::from_millis(100);
    let mut fresh = 0;
    while Instant::now() < deadline {
        let Ok(Some(Ok(message))) = tokio::time::timeout(Duration::from_millis(20), p.next()).await
        else {
            continue;
        };
        let v: Value = serde_json::from_str(&message.into_text().unwrap()).unwrap();
        if v["kind"] == "clock" {
            fresh += 1;
        }
    }
    assert!(
        fresh <= 1,
        "unsolicited frames accumulated credits: {fresh}"
    );
    s.shutdown().await.unwrap();
}
#[tokio::test]
async fn invalid_frame_cannot_release_clock_credit() {
    for mode in ["session", "sequence"] {
        let (_d, s) = service().await;
        let pd = s.publisher_descriptor();
        let mut p = auth(&pd).await;
        recv(&mut p).await;
        send(&mut p, frame(&pd.session_id, 1)).await;
        recv(&mut p).await;
        let bad = if mode == "session" {
            frame("other", 2)
        } else {
            frame(&pd.session_id, 1)
        };
        send(&mut p, bad).await;
        closed(&mut p).await;
        s.shutdown().await.unwrap();
    }
}
