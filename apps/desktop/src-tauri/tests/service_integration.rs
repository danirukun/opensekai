use futures_util::{SinkExt, StreamExt};
use opensekai_contracts::*;
use opensekai_desktop_lib::service::{start_service, ServiceConfig, ServiceHandle};
use serde_json::{json, Value};
use std::time::Duration;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
    MaybeTlsStream, WebSocketStream,
};
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
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let text = socket.next().await.unwrap().unwrap().into_text().unwrap();
            let value: Value = serde_json::from_str(&text).unwrap();
            if value["kind"] != "clock" {
                return value;
            }
        }
    })
    .await
    .unwrap()
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
async fn closed(socket: &mut Socket) {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let next = socket.next().await;
            if let Some(Ok(Message::Text(text))) = &next {
                let value: Value = serde_json::from_str(text).unwrap();
                if value["kind"] == "clock" {
                    continue;
                }
            }
            assert!(matches!(
                next,
                None | Some(Err(_)) | Some(Ok(Message::Close(_)))
            ));
            return;
        }
    })
    .await
    .unwrap();
}
#[tokio::test]
async fn service_real_loopback_relays_inspection_and_recovers_latest_frame() {
    let (_dir, service) = service(false).await;
    let publisher_descriptor = service.publisher_descriptor();
    let renderer_descriptor = service.renderer_descriptor("output_main").unwrap();
    let mut publisher = auth(&publisher_descriptor).await;
    let mut renderer = auth(&renderer_descriptor).await;
    let mut operator = auth(&service.operator_descriptor()).await;
    send(&mut publisher, frame(&publisher_descriptor.session_id, 1)).await;
    let delivered = recv(&mut renderer).await;
    assert_eq!(delivered["frame"]["sequence"], 1);
    send(&mut renderer, applied(&publisher_descriptor.session_id, 1)).await;
    send(
        &mut operator,
        call("inspect", "sceneInspect", json!({"sceneId":"scene_main"})),
    )
    .await;
    let relayed = recv(&mut publisher).await;
    assert_ne!(relayed["requestId"], "inspect");
    send(&mut publisher,json!({"kind":"reply","requestId":relayed["requestId"],"result":{"ok":true,"data":delivered["frame"]["scene"]}})).await;
    assert_eq!(recv(&mut operator).await["requestId"], "inspect");
    send(&mut operator, call("status", "appStatus", json!({}))).await;
    assert_eq!(recv(&mut operator).await["result"]["data"]["ready"], true);
    assert!(service.last_applied("output_main").is_some());
    assert!(service.now_ms() >= service.last_applied("output_main").unwrap().1);
    renderer.close(None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(30)).await;
    send(&mut publisher, frame(&publisher_descriptor.session_id, 2)).await;
    tokio::time::sleep(Duration::from_millis(30)).await;
    let mut renderer = auth(&renderer_descriptor).await;
    assert_eq!(recv(&mut renderer).await["frame"]["sequence"], 2);
    assert!(service.last_applied("output_main").is_none());
    tokio::time::timeout(Duration::from_secs(3), service.shutdown())
        .await
        .unwrap()
        .unwrap();
    closed(&mut publisher).await;
    closed(&mut operator).await;
    closed(&mut renderer).await;
}

#[tokio::test]
async fn blueprint_run_reaches_the_session_publisher_and_returns_revision() {
    let (_dir, service) = service(false).await;
    let mut publisher = auth(&service.publisher_descriptor()).await;
    let mut operator = auth(&service.operator_descriptor()).await;
    send(
        &mut operator,
        call(
            "run",
            "blueprintRun",
            json!({"graphId":"draft","triggerNodeId":"start"}),
        ),
    )
    .await;
    let relayed = recv(&mut publisher).await;
    assert_eq!(relayed["method"], "blueprintRun");
    assert_eq!(relayed["params"]["triggerNodeId"], "start");
    send(&mut publisher, json!({"kind":"reply","requestId":relayed["requestId"],"result":{"ok":true,"data":{"revision":1}}})).await;
    let response = recv(&mut operator).await;
    assert_eq!(response["requestId"], "run");
    assert_eq!(response["result"]["data"]["revision"], 1);
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn expression_calls_reach_the_session_publisher() {
    let (_dir, service) = service(false).await;
    let mut publisher = auth(&service.publisher_descriptor()).await;
    let mut operator = auth(&service.operator_descriptor()).await;
    let view = |weight: f64| json!({"avatarId":"performer","expressions":[{"name":"happy","preset":true,"layer":0,"fadeSeconds":0.4,"suppress":{"blink":false,"mouth":false,"brow":false},"active":true,"weight":weight}]});
    for (id, method, params, weight, ok) in [
        (
            "get",
            "expressionGet",
            json!({"avatarId":"performer"}),
            0.5,
            true,
        ),
        (
            "set",
            "expressionSet",
            json!({"avatarId":"performer","name":"happy","active":true}),
            0.,
            true,
        ),
    ] {
        send(&mut operator, call(id, method, params.clone())).await;
        let relayed = recv(&mut publisher).await;
        assert_eq!(relayed["method"], method);
        assert_eq!(relayed["params"], params);
        send(&mut publisher, json!({"kind":"reply","requestId":relayed["requestId"],"result":{"ok":true,"data":view(weight)}})).await;
        let response = recv(&mut operator).await;
        assert_eq!(response["requestId"], id);
        assert_eq!(response["result"]["ok"], ok, "{response}");
    }
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_auth_denies_stale_token_second_publisher_and_wrong_output() {
    let (_dir, service) = service(false).await;
    let descriptor = service.publisher_descriptor();
    let mut publisher = auth(&descriptor).await;
    for (role, token, output) in [
        ("publisher", descriptor.token.clone(), None),
        ("operator", "stale-session-token".into(), None),
        (
            "renderer",
            service.renderer_descriptor("output_main").unwrap().token,
            Some("wrong_output"),
        ),
    ] {
        let (mut socket, _) = connect_async(&descriptor.ws_url).await.unwrap();
        send(
            &mut socket,
            json!({"kind":"auth","role":role,"token":token,"schemaVersion":1,"outputId":output}),
        )
        .await;
        closed(&mut socket).await;
    }
    service.shutdown().await.unwrap();
    closed(&mut publisher).await;
}
#[tokio::test]
async fn service_auth_denies_http_host_origin_and_null() {
    let (_dir, service) = service(false).await;
    let descriptor = service.operator_descriptor();
    for origin in ["null", "https://example.test", "http://localhost:41000"] {
        let mut request = descriptor.ws_url.clone().into_client_request().unwrap();
        request
            .headers_mut()
            .insert("origin", origin.parse().unwrap());
        assert!(connect_async(request).await.is_err());
    }
    let mut request = descriptor.ws_url.clone().into_client_request().unwrap();
    request
        .headers_mut()
        .insert("host", "example.test".parse().unwrap());
    assert!(connect_async(request).await.is_err());
    let client = reqwest::Client::new();
    assert_eq!(
        client
            .get(format!("{}/renderer/", descriptor.http_origin))
            .header("Host", "example.test")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .get(format!("{}/renderer/", descriptor.http_origin))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "shell"
    );
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_roles_reject_renderer_edits_and_route_default_operator_edits() {
    let (_dir, service) = service(false).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    let mut operator = auth(&service.operator_descriptor()).await;
    for (socket, expected) in [(&mut renderer, "FORBIDDEN"), (&mut operator, "UNAVAILABLE")] {
        send(
            socket,
            call(
                "edit",
                "cameraSelect",
                json!({"outputId":"output_main","cameraId":"camera_main","expectedRevision":0}),
            ),
        )
        .await;
        assert_eq!(recv(socket).await["result"]["error"]["code"], expected);
    }
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_renderer_cannot_call_blueprint_edit() {
    let (_dir, service) = service(false).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    send(
        &mut renderer,
        call(
            "edit",
            "blueprintEdit",
            json!({"clientId":"c","batchId":"b","ops":[{"kind":"removeGraph","graphId":"g"}]}),
        ),
    )
    .await;
    assert_eq!(
        recv(&mut renderer).await["result"]["error"]["code"],
        "FORBIDDEN"
    );
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_distinct_relay_ids_isolate_equal_caller_ids() {
    let (_dir, service) = service(false).await;
    let mut publisher = auth(&service.publisher_descriptor()).await;
    let mut first = auth(&service.operator_descriptor()).await;
    let mut second = auth(&service.operator_descriptor()).await;
    send(
        &mut first,
        call("same", "sceneInspect", json!({"sceneId":"first"})),
    )
    .await;
    let one = recv(&mut publisher).await;
    send(
        &mut second,
        call("same", "sceneInspect", json!({"sceneId":"second"})),
    )
    .await;
    let two = recv(&mut publisher).await;
    assert_ne!(one["requestId"], two["requestId"]);
    for (request, label) in [(two, "second"), (one, "first")] {
        send(&mut publisher,json!({"kind":"reply","requestId":request["requestId"],"result":{"ok":false,"error":{"code":"NOT_FOUND","message":label,"ids":[]}}})).await;
    }
    assert_eq!(
        recv(&mut first).await["result"]["error"]["message"],
        "first"
    );
    assert_eq!(
        recv(&mut second).await["result"]["error"]["message"],
        "second"
    );
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_pending_disconnect_and_rpc_timeout_are_explicit() {
    let (_dir, service) = service(false).await;
    let mut publisher = auth(&service.publisher_descriptor()).await;
    let mut operator = auth(&service.operator_descriptor()).await;
    send(
        &mut operator,
        call("lost", "sceneInspect", json!({"sceneId":"scene_main"})),
    )
    .await;
    recv(&mut publisher).await;
    publisher.close(None).await.unwrap();
    assert_eq!(
        recv(&mut operator).await["result"]["error"]["code"],
        "UNAVAILABLE"
    );
    tokio::time::sleep(Duration::from_millis(30)).await;
    let mut publisher = auth(&service.publisher_descriptor()).await;
    send(
        &mut operator,
        call("timeout", "sceneInspect", json!({"sceneId":"scene_main"})),
    )
    .await;
    recv(&mut publisher).await;
    assert_eq!(
        recv(&mut operator).await["result"]["error"]["code"],
        "TIMEOUT"
    );
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_evaluation_is_unsupported_and_context_is_native_owned() {
    let (_dir, service) = service(true).await;
    let mut operator = auth(&service.operator_descriptor()).await;
    send(&mut operator,call("eval","captureFrame",json!({"outputId":"output_main","expectedRevision":0,"preset":"diagnostic_v1","maxAgeMs":500}))).await;
    assert_eq!(
        recv(&mut operator).await["result"]["error"]["code"],
        "UNSUPPORTED"
    );
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    service.install_evaluation_handler(std::sync::Arc::new(move |_call, context| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(context.client_id).await.unwrap();
            Reply::failure(AppError {
                code: ErrorCode::Unsupported,
                message: "gate".into(),
                ids: vec![],
            })
        })
    }));
    send(&mut operator,call("eval2","captureFrame",json!({"outputId":"output_main","expectedRevision":0,"preset":"diagnostic_v1","maxAgeMs":500}))).await;
    recv(&mut operator).await;
    let id = rx.recv().await.unwrap();
    assert!(uuid::Uuid::parse_str(&id).is_ok());
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_descriptor_files_are_owner_only() {
    let (dir, service) = service(false).await;
    let (operator, renderer) = service
        .write_descriptors(dir.path(), "output_main")
        .unwrap();
    for path in [operator, renderer] {
        let descriptor: ConnectionDescriptor =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        descriptor.validate().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_rejects_unauthenticated_timeout_and_oversize() {
    let (_dir, service) = service(false).await;
    let (mut socket, _) = connect_async(service.operator_descriptor().ws_url)
        .await
        .unwrap();
    closed(&mut socket).await;
    let mut operator = auth(&service.operator_descriptor()).await;
    send(
        &mut operator,
        call(
            "huge",
            "sceneInspect",
            json!({"sceneId":"x".repeat(MAX_MESSAGE_BYTES)}),
        ),
    )
    .await;
    closed(&mut operator).await;
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_exact_pending_limit_does_not_discard_commands() {
    let (_dir, service) = service(false).await;
    let mut publisher = auth(&service.publisher_descriptor()).await;
    let mut operator = auth(&service.operator_descriptor()).await;
    for n in 0..32 {
        send(
            &mut operator,
            call(
                &format!("call_{n}"),
                "sceneInspect",
                json!({"sceneId":"scene_main"}),
            ),
        )
        .await;
        recv(&mut publisher).await;
    }
    send(
        &mut operator,
        call("overflow", "sceneInspect", json!({"sceneId":"scene_main"})),
    )
    .await;
    let result = recv(&mut operator).await;
    assert_eq!(result["requestId"], "overflow");
    assert_eq!(result["result"]["error"]["code"], "RATE_LIMITED");
    publisher.close(None).await.unwrap();
    for _ in 0..32 {
        assert_eq!(
            recv(&mut operator).await["result"]["error"]["code"],
            "UNAVAILABLE"
        );
    }
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_native_capture_pairs_authenticated_renderer_reply() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let (_dir, service) = service(true).await;
    let descriptor = service.publisher_descriptor();
    let mut publisher = auth(&descriptor).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    send(&mut publisher, frame(&descriptor.session_id, 1)).await;
    recv(&mut renderer).await;
    let acknowledgement = applied(&descriptor.session_id, 1);
    send(&mut renderer, acknowledgement.clone()).await;
    tokio::time::timeout(Duration::from_secs(1), async {
        while service.last_applied("output_main").is_none() {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[0, 0, 0, 0]).unwrap();
    }
    let params = CaptureParams {
        output_id: "output_main".into(),
        expected_revision: 0,
        preset: CapturePreset::DiagnosticV1,
        max_age_ms: 500,
    };
    let respond = async {
        let request = recv(&mut renderer).await;
        assert_eq!(request["kind"], "captureRequest");
        send(&mut renderer,json!({"kind":"captureReply","requestId":request["requestId"],"result":{"ok":true,"data":{"metadata":{"frame":acknowledgement["frame"],"width":1,"height":1},"pngBase64":STANDARD.encode(&png)}}})).await;
    };
    let (capture, ()) = tokio::join!(service.request_capture(params), respond);
    assert_eq!(capture.unwrap().png, png);
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_ack_history_is_exactly_32_and_clears_with_publisher() {
    let (_dir, service) = service(false).await;
    let descriptor = service.publisher_descriptor();
    let mut publisher = auth(&descriptor).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    for sequence in 1..=40 {
        send(&mut publisher, frame(&descriptor.session_id, sequence)).await;
        recv(&mut renderer).await;
        send(&mut renderer, applied(&descriptor.session_id, sequence)).await;
        tokio::time::timeout(Duration::from_secs(1), async {
            while service.applied_at("output_main", sequence).is_none() {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await
        .unwrap();
    }
    assert!(service.applied_at("output_main", 8).is_none());
    assert!(service.applied_at("output_main", 9).is_some());
    assert_eq!(service.last_applied("output_main").unwrap().0.sequence, 40);
    publisher.close(None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(1), async {
        while service.last_applied("output_main").is_some() {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_asset_cors_preflight_is_exact() {
    let (_dir, service) = service(false).await;
    let descriptor = service.operator_descriptor();
    let client = reqwest::Client::new();
    let uri = format!("{}/assets/missing", descriptor.http_origin);
    assert_eq!(client.get(&uri).send().await.unwrap().status(), 401);
    let response = client
        .get(&uri)
        .header("Authorization", format!("Bearer {}", descriptor.token))
        .header("Origin", &descriptor.http_origin)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 404);
    assert_eq!(
        response.headers()["access-control-allow-origin"],
        descriptor.http_origin
    );
    for (origin, expected) in [
        (descriptor.http_origin.as_str(), 204),
        ("null", 403),
        ("https://example.test", 403),
    ] {
        assert_eq!(
            client
                .request(reqwest::Method::OPTIONS, &uri)
                .header("Origin", origin)
                .header("Access-Control-Request-Method", "GET")
                .header("Access-Control-Request-Headers", "authorization")
                .send()
                .await
                .unwrap()
                .status(),
            expected
        );
    }
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_cancelled_native_calls_release_pending_slots() {
    let (_dir, service) = service(true).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    for _ in 0..40 {
        let params = CaptureParams {
            output_id: "output_main".into(),
            expected_revision: 0,
            preset: CapturePreset::DiagnosticV1,
            max_age_ms: 500,
        };
        let request =
            tokio::time::timeout(Duration::from_millis(10), service.request_capture(params));
        let receive = async {
            assert_eq!(recv(&mut renderer).await["kind"], "captureRequest");
        };
        let (result, ()) = tokio::join!(request, receive);
        assert!(result.is_err());
    }
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_shutdown_releases_installed_handler() {
    let (_dir, service) = service(true).await;
    let owner = std::sync::Arc::new(());
    let weak = std::sync::Arc::downgrade(&owner);
    service.install_evaluation_handler(std::sync::Arc::new(move |_, _| {
        let _ = &owner;
        Box::pin(async {
            Reply::failure(AppError {
                code: ErrorCode::Unsupported,
                message: "gate".into(),
                ids: vec![],
            })
        })
    }));
    assert!(weak.upgrade().is_some());
    service.shutdown().await.unwrap();
    assert!(weak.upgrade().is_none());
}
#[tokio::test]
async fn service_obsolete_ack_preserves_renderer_for_fresh_state() {
    let (_dir, service) = service(false).await;
    let descriptor = service.publisher_descriptor();
    let mut publisher = auth(&descriptor).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    for sequence in 1..=40 {
        send(&mut publisher, frame(&descriptor.session_id, sequence)).await;
        assert_eq!(recv(&mut renderer).await["frame"]["sequence"], sequence);
        send(&mut renderer, applied(&descriptor.session_id, sequence)).await;
    }
    send(&mut renderer, applied(&descriptor.session_id, 0)).await;
    send(
        &mut renderer,
        json!({"kind":"ping","requestId":"after_obsolete"}),
    )
    .await;
    assert_eq!(recv(&mut renderer).await["kind"], "pong");
    assert!(service.applied_at("output_main", 0).is_none());
    send(&mut publisher, frame(&descriptor.session_id, 41)).await;
    assert_eq!(recv(&mut renderer).await["frame"]["sequence"], 41);
    send(&mut renderer, applied(&descriptor.session_id, 41)).await;
    tokio::time::timeout(Duration::from_secs(1), async {
        while service.applied_at("output_main", 41).is_none() {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
    assert!(service.applied_at("output_main", 1).is_none());
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_ack_rejects_scope_future_and_retained_metadata_mismatch() {
    for (field, value, obsolete) in [
        ("sessionId", json!("wrong_session"), true),
        ("outputId", json!("wrong_output"), true),
        ("sequence", json!(2), false),
        ("tick", json!(2), false),
        ("revision", json!(1), false),
        ("cameraId", json!("wrong_camera"), false),
    ] {
        let (_dir, service) = service(false).await;
        let descriptor = service.publisher_descriptor();
        let mut publisher = auth(&descriptor).await;
        let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
        send(&mut publisher, frame(&descriptor.session_id, 1)).await;
        recv(&mut renderer).await;
        let mut invalid = applied(&descriptor.session_id, 1);
        if obsolete {
            invalid["frame"]["sequence"] = json!(0);
        }
        invalid["frame"][field] = value;
        send(&mut renderer, invalid).await;
        closed(&mut renderer).await;
        assert!(service.last_applied("output_main").is_none());
        service.shutdown().await.unwrap();
    }
}
#[tokio::test]
async fn service_readiness_expires_stale_ack_without_losing_diagnostics() {
    let (_dir, service) = service(false).await;
    let descriptor = service.publisher_descriptor();
    let mut publisher = auth(&descriptor).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    let mut operator = auth(&service.operator_descriptor()).await;
    send(&mut publisher, frame(&descriptor.session_id, 1)).await;
    recv(&mut renderer).await;
    send(&mut renderer, applied(&descriptor.session_id, 1)).await;
    tokio::time::timeout(Duration::from_secs(1), async {
        while service.applied_at("output_main", 1).is_none() {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
    send(&mut operator, call("fresh", "appStatus", json!({}))).await;
    assert_eq!(recv(&mut operator).await["result"]["data"]["ready"], true);
    tokio::time::sleep(Duration::from_millis(550)).await;
    send(&mut publisher, frame(&descriptor.session_id, 2)).await;
    recv(&mut renderer).await;
    send(&mut operator, call("stale", "appStatus", json!({}))).await;
    let status = recv(&mut operator).await;
    assert_eq!(status["result"]["data"]["ready"], false);
    assert_eq!(status["result"]["data"]["outputs"][0]["connected"], true);
    assert_eq!(
        status["result"]["data"]["outputs"][0]["lastFrame"]["sequence"],
        1
    );
    send(
        &mut publisher,
        json!({"kind":"ping","requestId":"publisher_connected"}),
    )
    .await;
    assert_eq!(recv(&mut publisher).await["kind"], "pong");
    service.shutdown().await.unwrap();
}
#[tokio::test]
async fn service_slow_renderer_bounds_inflight_and_coalesces_at_60hz() {
    let (_dir, service) = service(false).await;
    let descriptor = service.publisher_descriptor();
    let mut publisher = auth(&descriptor).await;
    let mut renderer = auth(&service.renderer_descriptor("output_main").unwrap()).await;
    let mut operator = auth(&service.operator_descriptor()).await;
    let mut delivered = Vec::new();
    let mut pong = false;
    let publish = async {
        let mut interval = tokio::time::interval(Duration::from_secs_f64(1.0 / 60.0));
        for sequence in 1..=180 {
            interval.tick().await;
            send(&mut publisher, frame(&descriptor.session_id, sequence)).await;
            if let Ok(Some(Ok(message))) =
                tokio::time::timeout(Duration::from_millis(1), publisher.next()).await
            {
                let value: Value = serde_json::from_str(&message.into_text().unwrap()).unwrap();
                if value["kind"] == "call" {
                    send(&mut publisher, json!({"kind":"reply","requestId":value["requestId"],"result":{"ok":false,"error":{"code":"NOT_FOUND","message":"synthetic scene","ids":[]}}})).await;
                }
            }
        }
    };
    let controls = async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        send(
            &mut renderer,
            json!({"kind":"ping","requestId":"slow_ping"}),
        )
        .await;
        send(&mut operator, call("slow_status", "appStatus", json!({}))).await;
        send(
            &mut operator,
            call(
                "slow_inspect",
                "sceneInspect",
                json!({"sceneId":"scene_main"}),
            ),
        )
        .await;
        let requests = tokio::time::timeout(Duration::from_millis(500), async {
            let one = recv(&mut operator).await;
            let two = recv(&mut operator).await;
            [
                one["requestId"].as_str().unwrap().to_owned(),
                two["requestId"].as_str().unwrap().to_owned(),
            ]
        })
        .await
        .unwrap();
        assert!(requests.contains(&"slow_status".into()));
        assert!(requests.contains(&"slow_inspect".into()));
        let params = CaptureParams {
            output_id: "output_main".into(),
            expected_revision: 0,
            preset: CapturePreset::DiagnosticV1,
            max_age_ms: 500,
        };
        let capture = service.request_capture(params);
        let respond = async {
            let mut answered = false;
            while !pong || !answered {
                let value = recv(&mut renderer).await;
                match value["kind"].as_str() {
                    Some("frame") => delivered.push(value["frame"]["sequence"].as_u64().unwrap()),
                    Some("pong") => pong = true,
                    Some("captureRequest") => {
                        send(&mut renderer, json!({"kind":"captureReply","requestId":value["requestId"],"result":{"ok":false,"error":{"code":"UNSUPPORTED","message":"synthetic capture","ids":[]}}})).await;
                        answered = true;
                    }
                    _ => panic!("Unexpected control envelope"),
                }
            }
        };
        let (result, ()) = tokio::time::timeout(Duration::from_millis(500), async {
            tokio::join!(capture, respond)
        })
        .await
        .unwrap();
        assert_eq!(result.unwrap_err().code, ErrorCode::Unsupported);
    };
    tokio::join!(publish, controls);
    while let Ok(Some(Ok(message))) =
        tokio::time::timeout(Duration::from_millis(100), renderer.next()).await
    {
        let value: Value = serde_json::from_str(&message.into_text().unwrap()).unwrap();
        if value["kind"] == "frame" {
            delivered.push(value["frame"]["sequence"].as_u64().unwrap());
        }
        if value["kind"] == "pong" {
            pong = true;
        }
    }
    assert_eq!(
        delivered.len(),
        2,
        "State frames were buffered past the delivery window"
    );
    assert!(pong, "ACK-window stall blocked renderer ping");
    let acknowledged = *delivered.last().unwrap();
    send(&mut renderer, applied(&descriptor.session_id, acknowledged)).await;
    let fresh = recv(&mut renderer).await["frame"]["sequence"]
        .as_u64()
        .unwrap();
    assert!(
        fresh >= 179,
        "Pending frames failed to coalesce to recent state"
    );
    tokio::time::timeout(Duration::from_secs(1), async {
        while service.applied_at("output_main", acknowledged).is_none() {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
    service.shutdown().await.unwrap();
}

// Camera screenshots (CAM-05). Boundary: a real loopback WebSocket with a fake `preview_main`
// renderer client, and the real screenshot folder below a temporary app data folder.
mod screenshots {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use chrono::TimeZone;
    use std::{path::PathBuf, sync::Arc, time::Instant};
    const NAME: &str = "20261017-090507-042-camera_main";
    struct Shot {
        _dir: tempfile::TempDir,
        folder: PathBuf,
        service: ServiceHandle,
        session: String,
        operator: Socket,
        renderer: Socket,
        publisher: tokio::task::JoinHandle<()>,
    }
    fn scene_frame(session: &str, sequence: u64) -> Value {
        let camera = |id: &str| json!({"kind":"camera","id":id,"name":id,"visible":true,"transform":{"position":[0,1,5],"rotation":[0,0,0,1],"scale":[1,1,1]},"lens":{"fovDegrees":45,"near":0.1,"far":100}});
        json!({"kind":"frame","frame":{"schemaVersion":1,"sessionId":session,"sequence":sequence,"tick":sequence,"elapsedMs":sequence as f64,"scene":{"schemaVersion":1,"sceneId":"scene_main","revision":3,"entities":[camera("camera_main"),camera("camera_side")],"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60},{"id":"preview_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]}}})
    }
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        pixels[..4].copy_from_slice(&[255, 0, 0, 128]);
        writer.write_image_data(&pixels).unwrap();
        drop(writer);
        out
    }
    fn shot_call(id: &str, camera: &str, revision: u64) -> Value {
        call(
            id,
            "cameraScreenshot",
            json!({"cameraId":camera,"expectedRevision":revision}),
        )
    }
    fn reply_data(session: &str, revision: u64, camera: &str, png: &[u8]) -> Value {
        json!({"ok":true,"data":{"sessionId":session,"revision":revision,"cameraId":camera,"width":1920,"height":1080,"pngBase64":STANDARD.encode(png)}})
    }
    /// Answers each clock with a frame, so the publisher keeps its clock credit and the
    /// latest scene stays known for the whole test.
    fn keep_publishing(mut publisher: Socket, session: String) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut sequence = 1;
            send(&mut publisher, scene_frame(&session, sequence)).await;
            while let Some(Ok(message)) = publisher.next().await {
                let Ok(text) = message.into_text() else {
                    continue;
                };
                let value: Value = serde_json::from_str(&text).unwrap_or_default();
                if value["kind"] == "clock" {
                    sequence += 1;
                    send(&mut publisher, scene_frame(&session, sequence)).await;
                }
            }
        })
    }
    /// The next message of `kind`. Frames and other state messages are skipped.
    async fn recv_kind(socket: &mut Socket, kind: &str) -> Value {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let value = recv(socket).await;
                if value["kind"] == kind {
                    return value;
                }
                assert_eq!(value["kind"], "frame", "unexpected message {value}");
            }
        })
        .await
        .unwrap_or_else(|_| panic!("no {kind} message"))
    }
    async fn no_request(socket: &mut Socket, within: Duration) {
        let deadline = tokio::time::Instant::now() + within;
        while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
            let value: Value = serde_json::from_str(&message.into_text().unwrap()).unwrap();
            assert_ne!(
                value["kind"], "screenshotRequest",
                "the host relayed a request"
            );
        }
    }
    async fn wait_for_scene(operator: &mut Socket) {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            send(operator, call("status", "appStatus", json!({}))).await;
            let status = recv(operator).await;
            if status["result"]["data"]["revision"] == 3 {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "scene revision not known: {status}"
            );
            tokio::task::yield_now().await;
        }
    }
    async fn start() -> Shot {
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("manifest.json");
        std::fs::write(
            &manifest,
            r#"{"schemaVersion":1,"fixtureId":"smoke_v1","assets":[]}"#,
        )
        .unwrap();
        std::fs::write(dir.path().join("index.html"), "shell").unwrap();
        // As in the product: `<app local data>/evidence`, so the folder is `<app local data>/screenshots`.
        let service = start_service(ServiceConfig {
            output_root: dir.path().into(),
            asset_manifest: manifest,
            evidence_root: dir.path().join("evidence"),
            evaluation_enabled: false,
        })
        .await
        .unwrap();
        let fixed = chrono::Utc.with_ymd_and_hms(2026, 10, 17, 9, 5, 7).unwrap()
            + chrono::Duration::milliseconds(42);
        service.set_screenshot_clock(Arc::new(move || fixed));
        let folder = dir.path().join("screenshots");
        assert_eq!(service.screenshot_folder(), folder);
        let descriptor = service.publisher_descriptor();
        let publisher = keep_publishing(auth(&descriptor).await, descriptor.session_id.clone());
        let renderer = auth(&service.renderer_descriptor("preview_main").unwrap()).await;
        let mut operator = auth(&service.operator_descriptor()).await;
        wait_for_scene(&mut operator).await;
        Shot {
            _dir: dir,
            folder,
            service,
            session: descriptor.session_id,
            operator,
            renderer,
            publisher,
        }
    }
    impl Shot {
        /// Calls `cameraScreenshot` and lets the fake renderer answer with `reply`.
        async fn take(&mut self, id: &str, reply: impl FnOnce(&Value) -> Value) -> Value {
            send(&mut self.operator, shot_call(id, "camera_main", 3)).await;
            let request = recv_kind(&mut self.renderer, "screenshotRequest").await;
            assert_ne!(request["requestId"], id);
            assert_eq!(
                request["params"],
                json!({"cameraId":"camera_main","expectedRevision":3})
            );
            send(
                &mut self.renderer,
                json!({"kind":"screenshotReply","requestId":request["requestId"],"result":reply(&request)}),
            )
            .await;
            let response = recv(&mut self.operator).await;
            assert_eq!(response["requestId"], id);
            response["result"].clone()
        }
        async fn stop(self) {
            self.publisher.abort();
            self.service.shutdown().await.unwrap();
        }
    }
    /// The host-wide limit is 1 s. The test measures that interval itself.
    async fn after_rate_limit(since: Instant) {
        tokio::time::sleep_until((since + Duration::from_millis(1010)).into()).await;
    }

    #[tokio::test]
    async fn screenshot_relay_writes_a_new_file_and_never_overwrites() {
        let mut shot = start().await;
        let image = png(1920, 1080);
        let session = shot.session.clone();
        let first = Instant::now();
        let result = shot
            .take("one", |_| reply_data(&session, 3, "camera_main", &image))
            .await;
        assert_eq!(result["ok"], true, "{result}");
        let data = &result["data"];
        assert_eq!(data["fileName"], format!("{NAME}.png"));
        assert_eq!(
            (data["width"].clone(), data["height"].clone()),
            (json!(1920), json!(1080))
        );
        assert_eq!(data["bytes"], image.len());
        assert_eq!(data["cameraId"], "camera_main");
        assert_eq!(data["revision"], 3);
        let written = std::fs::read(shot.folder.join(format!("{NAME}.png"))).unwrap();
        assert_eq!(written, image);
        use sha2::Digest;
        let digest: String = sha2::Sha256::digest(&written)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(data["sha256"], digest);
        // The same UTC millisecond gives the same name: the host adds a suffix.
        after_rate_limit(first).await;
        let second = Instant::now();
        let mut other_png = image.clone();
        other_png.extend_from_slice(b"different bytes");
        let result = shot
            .take("two", |_| {
                reply_data(&session, 3, "camera_main", &other_png)
            })
            .await;
        assert_eq!(result["data"]["fileName"], format!("{NAME}-1.png"));
        assert_eq!(
            std::fs::read(shot.folder.join(format!("{NAME}.png"))).unwrap(),
            image
        );
        assert_eq!(
            std::fs::read(shot.folder.join(format!("{NAME}-1.png"))).unwrap(),
            other_png
        );
        for n in 2..=9 {
            std::fs::write(shot.folder.join(format!("{NAME}-{n}.png")), b"kept").unwrap();
        }
        after_rate_limit(second).await;
        let result = shot
            .take("three", |_| reply_data(&session, 3, "camera_main", &image))
            .await;
        assert_eq!(result["error"]["code"], "BUSY", "{result}");
        assert_eq!(std::fs::read_dir(&shot.folder).unwrap().count(), 10);
        assert_eq!(
            std::fs::read(shot.folder.join(format!("{NAME}-9.png"))).unwrap(),
            b"kept"
        );
        shot.stop().await;
    }

    #[tokio::test]
    async fn screenshot_rate_limit_is_host_wide() {
        let mut shot = start().await;
        let image = png(1920, 1080);
        let session = shot.session.clone();
        let first = Instant::now();
        let result = shot
            .take("one", |_| reply_data(&session, 3, "camera_main", &image))
            .await;
        assert_eq!(result["ok"], true, "{result}");
        let mut second_client = auth(&shot.service.operator_descriptor()).await;
        send(&mut second_client, shot_call("two", "camera_main", 3)).await;
        let limited = recv(&mut second_client).await;
        assert!(first.elapsed() < Duration::from_secs(1));
        assert_eq!(limited["result"]["error"]["code"], "RATE_LIMITED");
        no_request(&mut shot.renderer, Duration::from_millis(50)).await;
        after_rate_limit(first).await;
        send(&mut second_client, shot_call("three", "camera_main", 3)).await;
        let request = recv_kind(&mut shot.renderer, "screenshotRequest").await;
        send(&mut shot.renderer, json!({"kind":"screenshotReply","requestId":request["requestId"],"result":reply_data(&session, 3, "camera_main", &image)})).await;
        let response = recv(&mut second_client).await;
        assert_eq!(
            response["result"]["data"]["fileName"],
            format!("{NAME}-1.png")
        );
        shot.stop().await;
    }

    #[tokio::test]
    async fn screenshot_checks_renderer_scene_revision_and_camera_before_relay() {
        let mut shot = start().await;
        for (id, camera, revision, code) in [
            ("stale", "camera_main", 2, "CONFLICT"),
            ("missing", "camera_missing", 3, "NOT_FOUND"),
        ] {
            send(&mut shot.operator, shot_call(id, camera, revision)).await;
            let response = recv(&mut shot.operator).await;
            assert_eq!(response["result"]["error"]["code"], code, "{response}");
        }
        no_request(&mut shot.renderer, Duration::from_millis(50)).await;
        // A failed check does not take the rate slot; the renderer answers for camera_side.
        send(&mut shot.operator, shot_call("side", "camera_side", 3)).await;
        let request = recv_kind(&mut shot.renderer, "screenshotRequest").await;
        assert_eq!(request["params"]["cameraId"], "camera_side");
        send(&mut shot.renderer, json!({"kind":"screenshotReply","requestId":request["requestId"],"result":{"ok":false,"error":{"code":"NOT_FOUND","message":"Camera not found","ids":["camera_side"]}}})).await;
        assert_eq!(
            recv(&mut shot.operator).await["result"]["error"]["code"],
            "NOT_FOUND"
        );
        // Without a preview_main renderer the call is unavailable.
        shot.renderer.close(None).await.unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            send(&mut shot.operator, shot_call("gone", "camera_main", 3)).await;
            let response = recv(&mut shot.operator).await;
            if response["result"]["error"]["code"] == "UNAVAILABLE" {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "renderer still registered: {response}"
            );
            tokio::task::yield_now().await;
        }
        shot.stop().await;
    }

    #[tokio::test]
    async fn screenshot_rejects_stale_invalid_and_oversize_replies() {
        let image = png(1920, 1080);
        let small = png(16, 9);
        let oversize = vec![0u8; MAX_SCREENSHOT_PNG_BYTES + 1];
        type Reply<'a> = Box<dyn Fn(&str) -> Value + 'a>;
        let cases: Vec<(&str, Reply)> = vec![
            (
                "STALE_FRAME",
                Box::new(|_| reply_data("other_session", 3, "camera_main", &image)),
            ),
            (
                "STALE_FRAME",
                Box::new(|s| reply_data(s, 4, "camera_main", &image)),
            ),
            (
                "STALE_FRAME",
                Box::new(|s| reply_data(s, 3, "camera_side", &image)),
            ),
            (
                "INVALID_INPUT",
                Box::new(|s| reply_data(s, 3, "camera_main", b"not a png")),
            ),
            (
                "INVALID_INPUT",
                Box::new(|s| {
                    let mut data = reply_data(s, 3, "camera_main", &image);
                    data["data"]["pngBase64"] = json!(STANDARD.encode(&small));
                    data
                }),
            ),
            (
                "INVALID_INPUT",
                Box::new(|s| reply_data(s, 3, "camera_main", &oversize)),
            ),
        ];
        // A fresh host for each case, so the 1 s limit does not apply between cases.
        for (code, reply) in cases {
            let mut shot = start().await;
            let session = shot.session.clone();
            let result = shot.take("shot", |_| reply(&session)).await;
            assert_eq!(result["error"]["code"], code, "{result}");
            assert!(!shot.folder.exists() || std::fs::read_dir(&shot.folder).unwrap().count() == 0);
            // The preview renderer stays connected after a bad reply.
            send(
                &mut shot.renderer,
                json!({"kind":"ping","requestId":"alive"}),
            )
            .await;
            assert_eq!(
                recv_kind(&mut shot.renderer, "pong").await["requestId"],
                "alive"
            );
            shot.stop().await;
        }
    }

    #[tokio::test]
    async fn screenshot_times_out_and_ignores_a_late_reply() {
        let mut shot = start().await;
        let timeout = Duration::from_millis(300);
        shot.service.set_screenshot_timeout(timeout);
        let started = Instant::now();
        send(&mut shot.operator, shot_call("slow", "camera_main", 3)).await;
        let request = recv_kind(&mut shot.renderer, "screenshotRequest").await;
        let response = recv(&mut shot.operator).await;
        assert_eq!(response["result"]["error"]["code"], "TIMEOUT");
        assert!(started.elapsed() >= timeout);
        let session = shot.session.clone();
        send(&mut shot.renderer, json!({"kind":"screenshotReply","requestId":request["requestId"],"result":reply_data(&session, 3, "camera_main", &png(1920, 1080))})).await;
        send(
            &mut shot.renderer,
            json!({"kind":"ping","requestId":"alive"}),
        )
        .await;
        assert_eq!(
            recv_kind(&mut shot.renderer, "pong").await["requestId"],
            "alive"
        );
        assert!(!shot.folder.exists());
        shot.stop().await;
    }

    #[tokio::test]
    async fn screenshot_default_timeout_is_the_contract_limit() {
        assert_eq!(SCREENSHOT_TIMEOUT_MS, 5000);
        assert_eq!(MAX_SCREENSHOT_MESSAGE_BYTES, 12 * 1024 * 1024);
    }

    #[tokio::test]
    async fn screenshot_reply_is_accepted_only_from_a_renderer_and_large_messages_only_there() {
        let mut shot = start().await;
        // An operator that sends a screenshot reply loses its connection.
        let mut intruder = auth(&shot.service.operator_descriptor()).await;
        send(&mut intruder, json!({"kind":"screenshotReply","requestId":"x","result":{"ok":false,"error":{"code":"UNAVAILABLE","message":"x","ids":[]}}})).await;
        closed(&mut intruder).await;
        // An operator message above the capture envelope closes the connection, as before.
        let mut large = auth(&shot.service.operator_descriptor()).await;
        send(
            &mut large,
            json!({"kind":"ping","requestId":"x".repeat(MAX_CAPTURE_MESSAGE_BYTES)}),
        )
        .await;
        closed(&mut large).await;
        // A renderer reply without a pending request closes the renderer.
        send(&mut shot.renderer, json!({"kind":"screenshotReply","requestId":"unknown","result":{"ok":true,"data":{"sessionId":"x","revision":3,"cameraId":"c","width":1920,"height":1080,"pngBase64":STANDARD.encode(vec![0u8; MAX_SCREENSHOT_PNG_BYTES + 3])}}})).await;
        tokio::time::timeout(Duration::from_secs(3), async {
            while let Some(Ok(message)) = shot.renderer.next().await {
                if let Message::Text(text) = message {
                    let value: Value = serde_json::from_str(&text).unwrap();
                    assert_eq!(value["kind"], "frame", "unexpected message {value}");
                }
            }
        })
        .await
        .expect("renderer still connected");
        shot.stop().await;
    }
}
