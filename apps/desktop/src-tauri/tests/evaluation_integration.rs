use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use opensekai_contracts::*;
use opensekai_desktop_lib::evaluation::{EvaluationIdentity, NativeEvaluation};
use opensekai_desktop_lib::service::{start_service, ServiceConfig, ServiceHandle};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{sync::Arc, time::Duration};
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
fn call(id: &str, method: &str, params: Value) -> Value {
    json!({"kind":"call","requestId":id,"method":method,"params":params})
}

fn install(dir: &tempfile::TempDir, service: &ServiceHandle) -> Arc<NativeEvaluation> {
    NativeEvaluation::install(
        service,
        EvaluationIdentity {
            session_id: service.operator_descriptor().session_id,
            app_commit: "test-commit".into(),
            fixture_id: "smoke_v1".into(),
            evidence_root: dir.path().join("evidence"),
        },
    )
    .unwrap()
}
fn png() -> Vec<u8> {
    let mut bytes = vec![];
    {
        let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[0, 0, 0, 255])
            .unwrap();
    }
    bytes
}
fn capture_params() -> Value {
    json!({"outputId":"output_main","expectedRevision":0,"preset":"diagnostic_v1","maxAgeMs":500})
}
fn run_params(id: &str) -> Value {
    json!({"requestId":id,"fixtureId":"smoke_v1","profileId":"webgl2_smoke_v1"})
}
async fn fresh(
    service: &ServiceHandle,
    publisher: &mut Socket,
    renderer: &mut Socket,
    sequence: u64,
) {
    let session = service.publisher_descriptor().session_id;
    send(publisher, frame(&session, sequence)).await;
    recv(renderer).await;
    send(renderer, applied(&session, sequence)).await;
    for _ in 0..100 {
        if service
            .ports()
            .last_applied("output_main")
            .is_some_and(|(f, _)| f.sequence == sequence)
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    panic!("ACK not received");
}
async fn rpc(operator: &mut Socket, method: &str, params: Value) -> Value {
    send(operator, call("request", method, params)).await;
    recv(operator).await["result"].clone()
}
async fn capture_reply(service: &ServiceHandle, renderer: &mut Socket, sequence: u64, width: u32) {
    let request = recv(renderer).await;
    assert_eq!(request["kind"], "captureRequest");
    send(renderer,json!({"kind":"captureReply","requestId":request["requestId"],"result":{"ok":true,"data":{"metadata":{"frame":applied(&service.publisher_descriptor().session_id,sequence)["frame"],"width":width,"height":1},"pngBase64":STANDARD.encode(png())}}})).await;
}
#[tokio::test]
async fn native_capture_produces_registered_evidence_and_http_role_cors_policy() {
    let (dir, service) = service(true).await;
    let evaluation = install(&dir, &service);
    let pd = service.publisher_descriptor();
    let od = service.operator_descriptor();
    let rd = service.renderer_descriptor("output_main").unwrap();
    let mut publisher = auth(&pd).await;
    let mut renderer = auth(&rd).await;
    let mut operator = auth(&od).await;
    fresh(&service, &mut publisher, &mut renderer, 1).await;
    send(
        &mut operator,
        call("capture", "captureFrame", capture_params()),
    )
    .await;
    capture_reply(&service, &mut renderer, 1, 1).await;
    let reply = recv(&mut operator).await;
    assert_eq!(reply["result"]["ok"], true, "{reply}");
    let record = &reply["result"]["data"];
    let id = record["id"].as_str().unwrap();
    assert_eq!(
        record["sha256"],
        Sha256::digest(png())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let manifest = rpc(&mut operator, "evidenceRead", json!({"evidenceId":id})).await;
    assert_eq!(manifest["data"]["resources"][0]["sha256"], record["sha256"]);
    let url = format!("{}/evidence/{id}/capture.png", od.http_origin);
    let http = reqwest::Client::new();
    assert_eq!(http.get(&url).send().await.unwrap().status(), 401);
    assert_eq!(
        http.get(&url)
            .bearer_auth(&rd.token)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let response = http
        .get(&url)
        .bearer_auth(&od.token)
        .header("Origin", &od.http_origin)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        response.headers()["access-control-allow-origin"],
        od.http_origin
    );
    assert_eq!(response.bytes().await.unwrap().as_ref(), png());
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
        http.get(format!("{url}?secret=1"))
            .bearer_auth(&od.token)
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        http.get(format!("{}/evidence/{id}/private.txt", od.http_origin))
            .bearer_auth(&od.token)
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        http.get(format!(
            "{}/evidence/%{:02x}{}/capture.png",
            od.http_origin,
            id.as_bytes()[0],
            &id[1..]
        ))
        .bearer_auth(&od.token)
        .send()
        .await
        .unwrap()
        .status(),
        400
    );
    let preflight = http
        .request(reqwest::Method::OPTIONS, &url)
        .header("Origin", &od.http_origin)
        .header("Access-Control-Request-Method", "GET")
        .header("Access-Control-Request-Headers", "Authorization")
        .send()
        .await
        .unwrap();
    assert_eq!(preflight.status(), 204);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(dir.path().join(format!("evidence/{id}-capture.png")))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    evaluation.shutdown();
    let weak = Arc::downgrade(&evaluation);
    drop(evaluation);
    tokio::time::sleep(Duration::from_millis(120)).await;
    assert!(weak.upgrade().is_none());
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn capture_budgets_metadata_rollback_timeout_and_stale_output() {
    let (dir, service) = service(true).await;
    let evaluation = install(&dir, &service);
    let mut publisher = auth(&service.publisher_descriptor()).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    let mut operator = auth(&service.operator_descriptor()).await;
    fresh(&service, &mut publisher, &mut renderer, 1).await;
    let mut bad = capture_params();
    bad["expectedRevision"] = json!(1);
    assert_eq!(
        rpc(&mut operator, "captureFrame", bad).await["error"]["code"],
        "CONFLICT"
    );
    assert_eq!(
        rpc(&mut operator, "captureFrame", capture_params()).await["error"]["code"],
        "RATE_LIMITED"
    );
    let mut other = auth(&service.operator_descriptor()).await;
    send(
        &mut other,
        call("mismatch", "captureFrame", capture_params()),
    )
    .await;
    capture_reply(&service, &mut renderer, 1, 2).await;
    assert_eq!(
        recv(&mut other).await["result"]["error"]["code"],
        "INVALID_INPUT"
    );
    assert_eq!(
        std::fs::read_dir(dir.path().join("evidence"))
            .unwrap()
            .count(),
        0
    );
    let mut wrong = capture_params();
    wrong["outputId"] = json!("preview_main");
    assert_eq!(
        rpc(&mut operator, "captureFrame", wrong).await["error"]["code"],
        "FORBIDDEN"
    );
    let mut timeout = auth(&service.operator_descriptor()).await;
    send(
        &mut timeout,
        call("timeout", "captureFrame", capture_params()),
    )
    .await;
    let request = recv(&mut renderer).await;
    assert_eq!(request["kind"], "captureRequest");
    let mut busy = auth(&service.operator_descriptor()).await;
    assert_eq!(
        rpc(&mut busy, "captureFrame", capture_params()).await["error"]["code"],
        "BUSY"
    );
    assert_eq!(
        rpc(&mut busy, "benchmarkStart", run_params("busy")).await["error"]["code"],
        "BUSY"
    );
    assert_eq!(
        recv(&mut timeout).await["result"]["error"]["code"],
        "TIMEOUT"
    );
    let mut stale = auth(&service.operator_descriptor()).await;
    assert_eq!(
        rpc(&mut stale, "captureFrame", capture_params()).await["error"]["code"],
        "STALE_FRAME"
    );
    evaluation.shutdown();
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn ninth_capture_evicts_http_metadata_and_exported_bytes() {
    let (dir, service) = service(true).await;
    let evaluation = install(&dir, &service);
    let od = service.operator_descriptor();
    let mut publisher = auth(&service.publisher_descriptor()).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    let mut first = String::new();
    for sequence in 1..=10 {
        let mut operator = auth(&od).await;
        fresh(&service, &mut publisher, &mut renderer, sequence).await;
        send(
            &mut operator,
            call("capture", "captureFrame", capture_params()),
        )
        .await;
        if sequence == 9 {
            capture_reply(&service, &mut renderer, sequence, 2).await;
            assert_eq!(
                recv(&mut operator).await["result"]["error"]["code"],
                "INVALID_INPUT"
            );
            assert_eq!(
                reqwest::Client::new()
                    .get(format!("{}/evidence/{first}/capture.png", od.http_origin))
                    .bearer_auth(&od.token)
                    .send()
                    .await
                    .unwrap()
                    .status(),
                200
            );
            continue;
        }
        capture_reply(&service, &mut renderer, sequence, 1).await;
        let result = recv(&mut operator).await;
        assert_eq!(result["result"]["ok"], true, "{result}");
        if sequence == 1 {
            first = result["result"]["data"]["id"].as_str().unwrap().into();
        }
    }
    let response = reqwest::Client::new()
        .get(format!("{}/evidence/{first}/capture.png", od.http_origin))
        .bearer_auth(&od.token)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 404);
    let mut operator = auth(&od).await;
    assert_eq!(
        rpc(&mut operator, "evidenceRead", json!({"evidenceId":first})).await["error"]["code"],
        "NOT_FOUND"
    );
    assert_eq!(
        std::fs::read_dir(dir.path().join("evidence"))
            .unwrap()
            .count(),
        8
    );
    evaluation.shutdown();
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn benchmark_refuses_unregistered_smoke_fixture_and_read_only_evaluation() {
    let (dir, service) = service(true).await;
    let evaluation = install(&dir, &service);
    let mut operator = auth(&service.operator_descriptor()).await;
    assert_eq!(
        rpc(&mut operator, "benchmarkStart", run_params("fixture")).await["error"]["code"],
        "CONFLICT"
    );
    evaluation.shutdown();
    service.shutdown().await.unwrap();
    let (dir, service) = self::service(false).await;
    let evaluation = install(&dir, &service);
    let mut operator = auth(&service.operator_descriptor()).await;
    assert_eq!(
        rpc(&mut operator, "captureFrame", capture_params()).await["error"]["code"],
        "FORBIDDEN"
    );
    assert_eq!(
        rpc(&mut operator, "benchmarkStart", run_params("readonly")).await["error"]["code"],
        "FORBIDDEN"
    );
    evaluation.shutdown();
    service.shutdown().await.unwrap();
}
#[tokio::test]
#[ignore = "Requires explicit local pinned smoke fixtures"]
async fn pinned_fixture_benchmark_cancel_replay_stale_timer_summary_and_history() {
    let local = std::path::PathBuf::from(
        std::env::var_os("OPENSEKAI_TEST_FIXTURE_MANIFEST")
            .expect("explicit fixture manifest required"),
    );
    let mut manifest: Value = serde_json::from_slice(&std::fs::read(local).unwrap()).unwrap();
    let dir = tempfile::tempdir().unwrap();
    for (index, asset) in manifest["assets"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .enumerate()
    {
        let source = asset["path"].as_str().unwrap();
        let target = dir.path().join(format!("asset-{index}.glb"));
        std::fs::copy(source, &target).unwrap();
        asset["path"] = json!(target);
    }
    let manifest_path = dir.path().join("manifest.json");
    std::fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let service = start_service(ServiceConfig {
        output_root: dir.path().into(),
        asset_manifest: manifest_path,
        evidence_root: dir.path().join("evidence"),
        evaluation_enabled: true,
    })
    .await
    .unwrap();
    let evaluation = install(&dir, &service);
    let od = service.operator_descriptor();
    let mut publisher = auth(&service.publisher_descriptor()).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    let mut operator = auth(&od).await;
    fresh(&service, &mut publisher, &mut renderer, 1).await;
    let start = rpc(&mut operator, "benchmarkStart", run_params("first")).await;
    assert_eq!(start["ok"], true, "{start}");
    let id = start["data"]["id"].as_str().unwrap();
    assert_eq!(
        rpc(&mut operator, "captureFrame", capture_params()).await["error"]["code"],
        "BUSY"
    );
    let cancel = rpc(&mut operator, "benchmarkCancel", json!({"runId":id})).await;
    assert_eq!(cancel["data"]["state"], "cancelled");
    let manifest = rpc(&mut operator, "evidenceRead", json!({"evidenceId":id})).await;
    let summary = reqwest::Client::new()
        .get(format!("{}/evidence/{id}/summary.json", od.http_origin))
        .bearer_auth(&od.token)
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(
        manifest["data"]["resources"][0]["sha256"],
        Sha256::digest(&summary)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    assert_eq!(manifest["data"]["resources"][0]["bytes"], summary.len());
    tokio::time::sleep(Duration::from_millis(650)).await;
    assert_eq!(
        rpc(&mut operator, "benchmarkStart", run_params("first")).await["data"]["id"],
        id
    );
    let mut changed = run_params("first");
    changed["profileId"] = json!("webgpu_smoke_v1");
    assert_eq!(
        rpc(&mut operator, "benchmarkStart", changed).await["error"]["code"],
        "CONFLICT"
    );
    fresh(&service, &mut publisher, &mut renderer, 2).await;
    let second = rpc(&mut operator, "benchmarkStart", run_params("second")).await;
    assert_eq!(second["ok"], true, "{second}");
    let second_id = second["data"]["id"].as_str().unwrap();
    tokio::time::sleep(Duration::from_millis(700)).await;
    let timed_summary = reqwest::Client::new()
        .get(format!(
            "{}/evidence/{second_id}/summary.json",
            od.http_origin
        ))
        .bearer_auth(&od.token)
        .send()
        .await
        .unwrap();
    assert_eq!(timed_summary.status(), 200);
    assert_eq!(
        timed_summary.json::<Value>().await.unwrap()["run"]["state"],
        "failed"
    );

    assert_eq!(
        rpc(&mut operator, "benchmarkStatus", json!({"runId":second_id})).await["data"]["state"],
        "failed"
    );
    for sequence in 3..=10 {
        fresh(&service, &mut publisher, &mut renderer, sequence).await;
        let started = rpc(
            &mut operator,
            "benchmarkStart",
            run_params(&format!("run-{sequence}")),
        )
        .await;
        assert_eq!(started["ok"], true, "{started}");
        rpc(
            &mut operator,
            "benchmarkCancel",
            json!({"runId":started["data"]["id"]}),
        )
        .await;
    }
    assert_eq!(
        reqwest::Client::new()
            .get(format!("{}/evidence/{id}/summary.json", od.http_origin))
            .bearer_auth(&od.token)
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        std::fs::read_dir(dir.path().join("evidence"))
            .unwrap()
            .count(),
        8
    );
    evaluation.shutdown();
    service.shutdown().await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn capture_export_failure_preserves_registered_records_and_cannot_escape_root() {
    let (dir, service) = service(true).await;
    let evaluation = install(&dir, &service);
    let od = service.operator_descriptor();
    let mut publisher = auth(&service.publisher_descriptor()).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    let mut operator = auth(&od).await;
    fresh(&service, &mut publisher, &mut renderer, 1).await;
    send(
        &mut operator,
        call("first", "captureFrame", capture_params()),
    )
    .await;
    capture_reply(&service, &mut renderer, 1, 1).await;
    let first = recv(&mut operator).await["result"]["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("sentinel"), "keep").unwrap();
    std::fs::rename(dir.path().join("evidence"), dir.path().join("archived")).unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("evidence")).unwrap();
    let mut operator = auth(&od).await;
    fresh(&service, &mut publisher, &mut renderer, 2).await;
    send(
        &mut operator,
        call("second", "captureFrame", capture_params()),
    )
    .await;
    capture_reply(&service, &mut renderer, 2, 1).await;
    assert_eq!(
        recv(&mut operator).await["result"]["error"]["code"],
        "INVALID_INPUT"
    );
    assert_eq!(
        reqwest::Client::new()
            .get(format!("{}/evidence/{first}/capture.png", od.http_origin))
            .bearer_auth(&od.token)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 1);
    assert_eq!(
        std::fs::read_to_string(outside.path().join("sentinel")).unwrap(),
        "keep"
    );
    evaluation.shutdown();
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_ports_retain_all_native_ack_times_and_reject_disconnected_output() {
    let (_dir, service) = service(true).await;
    let ports = service.ports();
    let mut publisher = auth(&service.publisher_descriptor()).await;
    let descriptor = service.renderer_descriptor("output_main").unwrap();
    let mut renderer = auth(&descriptor).await;
    for sequence in 1..=6 {
        fresh(&service, &mut publisher, &mut renderer, sequence).await;
    }
    let acknowledgements = ports.applied_since("output_main", 2);
    assert_eq!(
        acknowledgements
            .iter()
            .map(|(f, _)| f.sequence)
            .collect::<Vec<_>>(),
        vec![3, 4, 5, 6]
    );
    assert!(acknowledgements.iter().all(|(_, at)| *at <= ports.now_ms()));
    assert!(acknowledgements
        .windows(2)
        .all(|pair| pair[0].1 <= pair[1].1));
    renderer.close(None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(
        ports.current_output("output_main").unwrap_err().code,
        ErrorCode::Unavailable
    );
    service.shutdown().await.unwrap();
    assert_eq!(
        ports.current_output("output_main").unwrap_err().code,
        ErrorCode::Unavailable
    );
}
