// Integration test: the publisher reply, the host's learned device kinds, the adapters, the
// clock message, and the status call cross the real WebSocket boundary of the service. The
// adapters are fakes, because no gamepad or MIDI hardware is present.
use futures_util::{SinkExt, StreamExt};
use opensekai_contracts::*;
use opensekai_desktop_lib::input::devices::{
    DeviceAdapter, DeviceHub, DeviceState, DeviceStatus, SharedQueue,
};
use opensekai_desktop_lib::service::{start_service, ServiceConfig, ServiceHandle};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
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
async fn edit_reply_with_devices(o: &mut Socket, p: &mut Socket, revision: u64, devices: Value) {
    send(o, json!({"kind":"call","requestId":"edit","method":"blueprintEdit","params":{"clientId":"c","batchId":format!("b{revision}"),"ops":[{"kind":"removeGraph","graphId":"g"}]}})).await;
    let relayed = recv_non_clock(p).await;
    send(p, json!({"kind":"reply","requestId":relayed["requestId"],"result":{"ok":true,"data":{"revision":revision,"keystrokes":[],"devices":devices}}})).await;
    assert_eq!(recv_non_clock(o).await["requestId"], "edit");
}

/// Answers clocks with frames until a clock carries device input that `wanted` accepts.
async fn device_clock(
    p: &mut Socket,
    session: &str,
    sequence: &mut u64,
    wanted: impl Fn(&Value) -> bool,
) -> Value {
    *sequence += 1;
    send(p, frame(session, *sequence)).await;
    for _ in 0..100 {
        let clock = recv(p).await;
        if clock["kind"] != "clock" {
            continue;
        }
        let devices = &clock["input"]["devices"];
        if !devices.is_null() && wanted(devices) {
            return devices.clone();
        }
        *sequence += 1;
        send(p, frame(session, *sequence)).await;
    }
    panic!("no clock with the expected device input");
}

/// A MIDI adapter that queues one note on start, and a pointer adapter with a fixed position.
struct Fake {
    kind: DeviceKind,
    queue: SharedQueue,
    active: Mutex<Vec<bool>>,
}
impl DeviceAdapter for Fake {
    fn kind(&self) -> DeviceKind {
        self.kind
    }
    fn set_active(&self, active: bool) {
        let mut log = self.active.lock().unwrap();
        if active && log.last() != Some(&true) && self.kind == DeviceKind::Midi {
            self.queue.lock().unwrap().push(DeviceEvent::MidiNote {
                channel: 10,
                note: 36,
                velocity: 90,
                on: true,
            });
        }
        log.push(active);
    }
    fn poll(&self, state: &mut DeviceState) {
        if self.kind == DeviceKind::Pointer {
            state.pointer = Some(PointerSnapshot {
                x: 0.25,
                y: 0.75,
                buttons: Some(vec![PointerButton::Left]),
            });
        }
    }
    fn status(&self) -> DeviceStatus {
        DeviceStatus::Idle
    }
}

#[tokio::test]
async fn used_device_kinds_start_their_adapters_and_device_input_rides_the_clock() {
    let (_d, s) = service().await;
    let queue = SharedQueue::default();
    let fake = |kind| {
        Arc::new(Fake {
            kind,
            queue: queue.clone(),
            active: Mutex::default(),
        })
    };
    let (midi, pointer) = (fake(DeviceKind::Midi), fake(DeviceKind::Pointer));
    s.ports().set_device_hub(Arc::new(DeviceHub::new(
        queue.clone(),
        vec![midi.clone(), pointer.clone()],
    )));
    let pd = s.publisher_descriptor();
    let mut p = auth(&pd).await;
    let mut o = auth(&s.operator_descriptor()).await;
    edit_reply_with_devices(&mut o, &mut p, 1, json!(["midi"])).await;
    assert_eq!(midi.active.lock().unwrap().last(), Some(&true));
    assert_eq!(pointer.active.lock().unwrap().last(), Some(&false));
    // The edit exchange skipped the pending clock; a frame earns the next one.
    let mut sequence = 0;
    let devices = device_clock(&mut p, &pd.session_id, &mut sequence, |_| true).await;
    assert_eq!(
        devices,
        json!({"events":[{"kind":"midiNote","channel":10,"note":36,"velocity":90,"on":true}]})
    );
    edit_reply_with_devices(&mut o, &mut p, 2, json!(["midi", "pointer"])).await;
    let devices = device_clock(&mut p, &pd.session_id, &mut sequence, |d| {
        !d["pointer"].is_null()
    })
    .await;
    assert_eq!(
        devices,
        json!({"pointer":{"x":0.25,"y":0.75,"buttons":["left"]}})
    );
    drop(p);
    // The disconnect stops each adapter; poll for it with a deadline.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    while midi.active.lock().unwrap().last() != Some(&false) {
        assert!(
            tokio::time::Instant::now() < deadline,
            "MIDI adapter still active: {:?}",
            midi.active.lock().unwrap()
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(pointer.active.lock().unwrap().last(), Some(&false));
    s.shutdown().await.unwrap();
}

#[tokio::test]
async fn status_warns_while_a_used_device_kind_has_no_adapter() {
    let (_d, s) = service().await;
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    edit_reply_with_devices(&mut o, &mut p, 1, json!(["gamepad"])).await;
    send(
        &mut o,
        json!({"kind":"call","requestId":"s1","method":"appStatus","params":{}}),
    )
    .await;
    assert_eq!(
        recv_non_clock(&mut o).await["result"]["data"]["warnings"],
        json!([{"code":"UNSUPPORTED","message":"Gamepad input is unavailable","ids":["device-gamepad"]}])
    );
    s.shutdown().await.unwrap();
}
