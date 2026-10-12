use futures_util::{SinkExt, StreamExt};
use opensekai_contracts::*;
use opensekai_desktop_lib::service::{start_service, ServiceConfig, ServiceHandle};
use serde_json::{json, Value};
use std::time::Duration;
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
async fn recv_non_clock(s: &mut Socket) -> Value {
    loop {
        let v = recv(s).await;
        if v["kind"] != "clock" {
            return v;
        }
    }
}
// Integration test: the publisher reply, the host's learned watched set, the clock message, and
// the status call cross the real WebSocket boundary of the service.
use opensekai_desktop_lib::input::monitor::{KeyMonitor, MonitorStatus};
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

struct FakeMonitor {
    watched: Mutex<Vec<BTreeSet<String>>>,
    status: MonitorStatus,
}
impl KeyMonitor for FakeMonitor {
    fn set_watched(&self, codes: &BTreeSet<String>) {
        self.watched.lock().unwrap().push(codes.clone());
    }
    fn held(&self) -> Vec<String> {
        let last = self
            .watched
            .lock()
            .unwrap()
            .last()
            .cloned()
            .unwrap_or_default();
        if last.contains("KeyW") {
            vec!["KeyW".into()]
        } else {
            vec![]
        }
    }
    fn status(&self) -> MonitorStatus {
        self.status
    }
}

async fn edit_reply_with_held(o: &mut Socket, p: &mut Socket, held: Value) {
    send(o, json!({"kind":"call","requestId":"edit","method":"blueprintEdit","params":{"clientId":"c","batchId":"b","ops":[{"kind":"removeGraph","graphId":"g"}]}})).await;
    let relayed = recv_non_clock(p).await;
    send(p, json!({"kind":"reply","requestId":relayed["requestId"],"result":{"ok":true,"data":{"revision":1,"keystrokes":[],"heldKeys":held}}})).await;
    assert_eq!(recv_non_clock(o).await["requestId"], "edit");
}

#[tokio::test]
async fn watched_keys_from_an_edit_reply_reach_the_monitor_and_held_keys_ride_the_clock() {
    let (_d, s) = service().await;
    let monitor = Arc::new(FakeMonitor {
        watched: Mutex::default(),
        status: MonitorStatus::Observing,
    });
    s.ports().set_key_monitor(monitor.clone());
    let pd = s.publisher_descriptor();
    let mut p = auth(&pd).await;
    let mut o = auth(&s.operator_descriptor()).await;
    edit_reply_with_held(&mut o, &mut p, json!(["KeyS", "KeyW"])).await;
    let expected: BTreeSet<String> = ["KeyS", "KeyW"].iter().map(|s| s.to_string()).collect();
    assert_eq!(monitor.watched.lock().unwrap().last(), Some(&expected));
    // The edit exchange skipped the pending clock; a frame earns the next one.
    send(&mut p, frame(&pd.session_id, 1)).await;
    let mut sequence = 2;
    let held = loop {
        let clock = recv(&mut p).await;
        if clock["kind"] == "clock" {
            if !clock["input"]["held"].is_null() {
                break clock["input"]["held"].clone();
            }
            send(&mut p, frame(&pd.session_id, sequence)).await;
            sequence += 1;
        }
    };
    assert_eq!(held, json!(["KeyW"]));
    drop(p);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(monitor.watched.lock().unwrap().last().unwrap().is_empty());
    s.shutdown().await.unwrap();
}

#[tokio::test]
async fn status_warns_while_watched_keys_cannot_be_observed() {
    let (_d, s) = service().await;
    s.ports().set_key_monitor(Arc::new(FakeMonitor {
        watched: Mutex::default(),
        status: MonitorStatus::NoAccess,
    }));
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    send(
        &mut o,
        json!({"kind":"call","requestId":"s0","method":"appStatus","params":{}}),
    )
    .await;
    assert_eq!(
        recv_non_clock(&mut o).await["result"]["data"]["warnings"],
        json!([])
    );
    edit_reply_with_held(&mut o, &mut p, json!(["KeyW"])).await;
    send(
        &mut o,
        json!({"kind":"call","requestId":"s1","method":"appStatus","params":{}}),
    )
    .await;
    let warnings = recv_non_clock(&mut o).await["result"]["data"]["warnings"].clone();
    assert_eq!(
        warnings,
        json!([{"code":"FORBIDDEN","message":"Input Monitoring is off","ids":["input-monitoring"]}])
    );
    s.shutdown().await.unwrap();
}
