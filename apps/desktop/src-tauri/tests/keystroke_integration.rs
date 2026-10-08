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
struct Fake(std::sync::Mutex<Vec<std::collections::BTreeSet<String>>>);
impl opensekai_desktop_lib::input::KeystrokeRegistrar for Fake {
    fn reconcile(&self, wanted: &std::collections::BTreeSet<String>) -> Vec<String> {
        self.0.lock().unwrap().push(wanted.clone());
        wanted
            .iter()
            .filter(|a| a.as_str() == "Control+Alt+KeyJ")
            .cloned()
            .collect()
    }
}

#[tokio::test]
async fn queued_keystrokes_ride_the_next_clock_in_order() {
    let (_d, s) = service().await;
    let pd = s.publisher_descriptor();
    let mut p = auth(&pd).await;
    assert_eq!(recv(&mut p).await["kind"], "clock");
    s.ports().push_keystroke("Control+Alt+KeyH".into());
    s.ports().push_keystroke("Control+Alt+KeyJ".into());
    send(&mut p, frame(&pd.session_id, 1)).await;
    let clock = recv(&mut p).await;
    assert_eq!(
        clock["input"]["events"],
        json!([
            {"kind":"keystroke","accelerator":"Control+Alt+KeyH"},
            {"kind":"keystroke","accelerator":"Control+Alt+KeyJ"}
        ])
    );
    send(&mut p, frame(&pd.session_id, 2)).await;
    assert!(recv(&mut p).await.get("input").is_none());
    s.shutdown().await.unwrap();
}

#[tokio::test]
async fn blueprint_edit_reply_drives_registration_warnings_and_publisher_loss_clears_it() {
    let (_d, s) = service().await;
    let fake = std::sync::Arc::new(Fake(Default::default()));
    s.ports().set_keystroke_registrar(fake.clone());
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    send(
        &mut o,
        json!({"kind":"call","requestId":"edit","method":"blueprintEdit","params":{"clientId":"c","batchId":"b","ops":[{"kind":"removeGraph","graphId":"g"}]}}),
    )
    .await;
    let relayed = recv_non_clock(&mut p).await;
    assert_eq!(relayed["kind"], "call");
    send(
        &mut p,
        json!({"kind":"reply","requestId":relayed["requestId"],"result":{"ok":true,"data":{"revision":1,"keystrokes":["Control+Alt+KeyH","Control+Alt+KeyJ"]}}}),
    )
    .await;
    assert_eq!(recv_non_clock(&mut o).await["requestId"], "edit");
    assert_eq!(
        fake.0
            .lock()
            .unwrap()
            .last()
            .unwrap()
            .iter()
            .cloned()
            .collect::<Vec<_>>(),
        vec![
            "Control+Alt+KeyH".to_string(),
            "Control+Alt+KeyJ".to_string()
        ]
    );
    send(
        &mut o,
        json!({"kind":"call","requestId":"status","method":"appStatus","params":{}}),
    )
    .await;
    let status = recv_non_clock(&mut o).await;
    assert_eq!(status["requestId"], "status");
    assert_eq!(
        status["result"]["data"]["warnings"][0]["ids"],
        json!(["Control+Alt+KeyJ"])
    );
    drop(p);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(fake.0.lock().unwrap().last().unwrap().is_empty());
    s.shutdown().await.unwrap();
}

struct Blocking(
    std::sync::Mutex<std::sync::mpsc::Receiver<()>>,
    std::sync::mpsc::Sender<()>,
);
impl opensekai_desktop_lib::input::KeystrokeRegistrar for Blocking {
    fn reconcile(&self, _: &std::collections::BTreeSet<String>) -> Vec<String> {
        let _ = self.1.send(());
        let _ = self.0.lock().unwrap().recv();
        vec![]
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn shutdown_completes_while_a_reconcile_is_blocked() {
    let (_d, s) = service().await;
    let (release, gate) = std::sync::mpsc::channel();
    let (started, entered) = std::sync::mpsc::channel();
    s.ports()
        .set_keystroke_registrar(std::sync::Arc::new(Blocking(
            std::sync::Mutex::new(gate),
            started,
        )));
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    send(
        &mut o,
        json!({"kind":"call","requestId":"edit","method":"blueprintEdit","params":{"clientId":"c","batchId":"b","ops":[{"kind":"removeGraph","graphId":"g"}]}}),
    )
    .await;
    let relayed = recv_non_clock(&mut p).await;
    send(
        &mut p,
        json!({"kind":"reply","requestId":relayed["requestId"],"result":{"ok":true,"data":{"revision":1,"keystrokes":["Control+Alt+KeyH"]}}}),
    )
    .await;
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    let done = tokio::time::timeout(Duration::from_secs(2), s.shutdown()).await;
    let _ = release.send(());
    done.expect("shutdown hung behind a blocked reconcile")
        .unwrap();
}

type Sets = std::sync::Arc<Fake>;
fn last_set(fake: &Sets) -> Vec<String> {
    fake.0
        .lock()
        .unwrap()
        .last()
        .map(|s| s.iter().cloned().collect())
        .unwrap_or_default()
}
async fn edit_reply(o: &mut Socket, p: &mut Socket, keystrokes: Value) {
    edit_reply_at(o, p, 1, keystrokes).await;
}
async fn edit_reply_at(o: &mut Socket, p: &mut Socket, revision: u64, keystrokes: Value) {
    send(
        o,
        json!({"kind":"call","requestId":"edit","method":"blueprintEdit","params":{"clientId":"c","batchId":"b","ops":[{"kind":"removeGraph","graphId":"g"}]}}),
    )
    .await;
    let relayed = recv_non_clock(p).await;
    send(
        p,
        json!({"kind":"reply","requestId":relayed["requestId"],"result":{"ok":true,"data":{"revision":revision,"keystrokes":keystrokes}}}),
    )
    .await;
    assert_eq!(recv_non_clock(o).await["requestId"], "edit");
}
/// A publisher that is running after the host learned a set gets asked for its own set.
async fn reconnected_publisher(s: &ServiceHandle, keystrokes: Value) -> Socket {
    reconnected_publisher_at(s, 1, keystrokes).await
}
async fn reconnected_publisher_at(s: &ServiceHandle, revision: u64, keystrokes: Value) -> Socket {
    let descriptor = s.publisher_descriptor();
    let mut p = auth(&descriptor).await;
    // The host asks only after the publisher has answered a clock with a frame.
    assert_eq!(recv(&mut p).await["kind"], "clock");
    send(&mut p, frame(&descriptor.session_id, 1)).await;
    answer_inspect(&mut p, revision, keystrokes).await;
    p
}
async fn answer_inspect(p: &mut Socket, revision: u64, keystrokes: Value) {
    let relayed = recv_non_clock(p).await;
    assert_eq!(relayed["method"], "blueprintInspect");
    send(
        p,
        json!({"kind":"reply","requestId":relayed["requestId"],"result":{"ok":true,"data":{"kind":"snapshot","revision":revision,"blueprints":[],"errors":[],"keystrokes":keystrokes}}}),
    )
    .await;
}

#[tokio::test]
async fn attaching_the_registrar_after_an_edit_reply_registers_the_reported_set() {
    let (_d, s) = service().await;
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    edit_reply(&mut o, &mut p, json!(["Control+Alt+KeyH"])).await;
    let fake: Sets = std::sync::Arc::new(Fake(Default::default()));
    s.ports().set_keystroke_registrar(fake.clone());
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(last_set(&fake), vec!["Control+Alt+KeyH".to_string()]);
    s.shutdown().await.unwrap();
}

#[tokio::test]
async fn a_publisher_that_reconnects_with_its_graphs_gets_its_hotkeys_back() {
    let (_d, s) = service().await;
    let fake: Sets = std::sync::Arc::new(Fake(Default::default()));
    s.ports().set_keystroke_registrar(fake.clone());
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    edit_reply(&mut o, &mut p, json!(["Control+Alt+KeyH"])).await;
    assert_eq!(last_set(&fake), vec!["Control+Alt+KeyH".to_string()]);
    drop(p);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(last_set(&fake).is_empty());
    let _p2 = reconnected_publisher(&s, json!(["Control+Alt+KeyH"])).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(last_set(&fake), vec!["Control+Alt+KeyH".to_string()]);
    s.shutdown().await.unwrap();
}

#[tokio::test]
async fn a_publisher_that_starts_with_an_empty_session_keeps_hotkeys_cleared() {
    let (_d, s) = service().await;
    let fake: Sets = std::sync::Arc::new(Fake(Default::default()));
    s.ports().set_keystroke_registrar(fake.clone());
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    edit_reply(&mut o, &mut p, json!(["Control+Alt+KeyH"])).await;
    drop(p);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let _p2 = reconnected_publisher(&s, json!([])).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(last_set(&fake).is_empty());
    s.shutdown().await.unwrap();
}

async fn lost_set_then_unhelpful_publisher(reply: Option<Value>) {
    let (_d, s) = service().await;
    let fake: Sets = std::sync::Arc::new(Fake(Default::default()));
    s.ports().set_keystroke_registrar(fake.clone());
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    edit_reply(&mut o, &mut p, json!(["Control+Alt+KeyH"])).await;
    drop(p);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let descriptor = s.publisher_descriptor();
    let mut p2 = auth(&descriptor).await;
    assert_eq!(recv(&mut p2).await["kind"], "clock");
    send(&mut p2, frame(&descriptor.session_id, 1)).await;
    let mut sequence = 1;
    let ask = loop {
        let message = recv(&mut p2).await;
        if message["kind"] == "clock" {
            sequence += 1;
            send(&mut p2, frame(&descriptor.session_id, sequence)).await;
        } else {
            break message;
        }
    };
    assert_eq!(ask["method"], "blueprintInspect");
    // The remembered set is restored while the question is open.
    assert_eq!(last_set(&fake), vec!["Control+Alt+KeyH".to_string()]);
    if let Some(result) = reply {
        send(
            &mut p2,
            json!({"kind":"reply","requestId":ask["requestId"],"result":result}),
        )
        .await;
    }
    // The publisher stays alive: it answers clocks but not the question.
    let end = tokio::time::Instant::now() + Duration::from_millis(2800);
    while tokio::time::Instant::now() < end {
        if let Ok(Some(Ok(Message::Text(text)))) =
            tokio::time::timeout(Duration::from_millis(100), p2.next()).await
        {
            if serde_json::from_str::<Value>(&text).unwrap()["kind"] == "clock" {
                sequence += 1;
                send(&mut p2, frame(&descriptor.session_id, sequence)).await;
            }
        }
    }
    assert!(last_set(&fake).is_empty());
    s.shutdown().await.unwrap();
}

#[tokio::test]
async fn a_new_publisher_that_never_answers_leaves_no_stale_hotkeys() {
    lost_set_then_unhelpful_publisher(None).await;
}

#[tokio::test]
async fn a_new_publisher_that_answers_with_an_error_leaves_no_stale_hotkeys() {
    lost_set_then_unhelpful_publisher(Some(
        json!({"ok":false,"error":{"code":"UNAVAILABLE","message":"x","ids":[]}}),
    ))
    .await;
}

#[tokio::test]
async fn edit_replies_that_arrive_newest_first_leave_the_newest_set_registered() {
    let (_d, s) = service().await;
    let fake: Sets = std::sync::Arc::new(Fake(Default::default()));
    s.ports().set_keystroke_registrar(fake.clone());
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    for id in ["older", "newer"] {
        send(
            &mut o,
            json!({"kind":"call","requestId":id,"method":"blueprintEdit","params":{"clientId":"c","batchId":id,"ops":[{"kind":"removeGraph","graphId":"g"}]}}),
        )
        .await;
    }
    let first = recv_non_clock(&mut p).await;
    let second = recv_non_clock(&mut p).await;
    send(
        &mut p,
        json!({"kind":"reply","requestId":second["requestId"],"result":{"ok":true,"data":{"revision":6,"keystrokes":["Control+Alt+KeyH"]}}}),
    )
    .await;
    assert_eq!(recv_non_clock(&mut o).await["requestId"], "newer");
    send(
        &mut p,
        json!({"kind":"reply","requestId":first["requestId"],"result":{"ok":true,"data":{"revision":5,"keystrokes":["Control+Alt+KeyK"]}}}),
    )
    .await;
    assert_eq!(recv_non_clock(&mut o).await["requestId"], "older");
    assert_eq!(last_set(&fake), vec!["Control+Alt+KeyH".to_string()]);
    s.shutdown().await.unwrap();
}

#[tokio::test]
async fn a_new_publisher_may_report_a_lower_revision_than_the_one_before_it() {
    let (_d, s) = service().await;
    let fake: Sets = std::sync::Arc::new(Fake(Default::default()));
    s.ports().set_keystroke_registrar(fake.clone());
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    edit_reply_at(&mut o, &mut p, 6, json!(["Control+Alt+KeyH"])).await;
    drop(p);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let mut p2 = reconnected_publisher_at(&s, 1, json!(["Control+Alt+KeyK"])).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(last_set(&fake), vec!["Control+Alt+KeyK".to_string()]);
    edit_reply_at(&mut o, &mut p2, 2, json!(["Control+Alt+KeyL"])).await;
    assert_eq!(last_set(&fake), vec!["Control+Alt+KeyL".to_string()]);
    s.shutdown().await.unwrap();
}

async fn registered(s: &ServiceHandle) -> (Sets, Socket, Socket) {
    let fake: Sets = std::sync::Arc::new(Fake(Default::default()));
    s.ports().set_keystroke_registrar(fake.clone());
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    edit_reply(&mut o, &mut p, json!(["Control+Alt+KeyH"])).await;
    assert_eq!(last_set(&fake), vec!["Control+Alt+KeyH".to_string()]);
    (fake, p, o)
}

#[tokio::test]
async fn an_armed_capture_field_suspends_registration_until_it_ends() {
    let (_d, s) = service().await;
    let (fake, _p, _o) = registered(&s).await;
    s.ports().set_keystroke_capture(true).await;
    assert!(last_set(&fake).is_empty());
    s.ports().set_keystroke_capture(false).await;
    assert_eq!(last_set(&fake), vec!["Control+Alt+KeyH".to_string()]);
    s.shutdown().await.unwrap();
}

#[tokio::test]
async fn a_capture_that_never_ends_expires_and_restores_registration() {
    let (_d, s) = service().await;
    let (fake, _p, _o) = registered(&s).await;
    s.ports()
        .set_keystroke_capture_timeout(Duration::from_millis(200));
    s.ports().set_keystroke_capture(true).await;
    assert!(last_set(&fake).is_empty());
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(last_set(&fake), vec!["Control+Alt+KeyH".to_string()]);
    s.shutdown().await.unwrap();
}

#[tokio::test]
async fn an_edit_during_capture_stays_unregistered_until_the_capture_ends() {
    let (_d, s) = service().await;
    let (fake, mut p, mut o) = registered(&s).await;
    s.ports().set_keystroke_capture(true).await;
    edit_reply_at(&mut o, &mut p, 2, json!(["Control+Alt+KeyK"])).await;
    assert!(last_set(&fake).is_empty());
    s.ports().set_keystroke_capture(false).await;
    assert_eq!(last_set(&fake), vec!["Control+Alt+KeyK".to_string()]);
    s.shutdown().await.unwrap();
}

#[tokio::test]
async fn ending_a_capture_that_is_not_active_does_not_reconcile() {
    let (_d, s) = service().await;
    let (fake, _p, _o) = registered(&s).await;
    let before = fake.0.lock().unwrap().len();
    assert!(!s.ports().end_keystroke_capture().await);
    assert_eq!(fake.0.lock().unwrap().len(), before);
    s.ports().set_keystroke_capture(true).await;
    assert!(last_set(&fake).is_empty());
    assert!(s.ports().end_keystroke_capture().await);
    assert_eq!(last_set(&fake), vec!["Control+Alt+KeyH".to_string()]);
    s.shutdown().await.unwrap();
}
