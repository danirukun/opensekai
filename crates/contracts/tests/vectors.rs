use opensekai_contracts::{parse_call, parse_wire, validate_result};
use serde_json::json;
#[test]
fn validates_call_pairing_and_limits() {
    let call = json!({"kind":"call","requestId":"r","method":"scenePatch","params":{"sceneId":"s","expectedRevision":0,"operations":[{"kind":"setTransform","entityId":"e","transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]}}]}});
    assert!(parse_call(&serde_json::to_vec(&call).unwrap()).is_ok());
    let mut bad = call.clone();
    bad["params"]["operations"][0]["transform"]["rotation"] = json!([0, 0, 0, 0]);
    assert!(parse_call(&serde_json::to_vec(&bad).unwrap()).is_err());
    bad = call.clone();
    bad["method"] = json!("cameraSelect");
    assert!(parse_call(&serde_json::to_vec(&bad).unwrap()).is_err());
    bad = call.clone();
    bad["extra"] = json!(true);
    assert!(parse_call(&serde_json::to_vec(&bad).unwrap()).is_err());
    assert!(parse_call(&vec![b' '; 262145]).is_err());
}
#[test]
fn validates_wire_versions_and_method_results() {
    assert!(parse_wire(
        br#"{"kind":"authReply","sessionId":"s","schemaVersion":1,"capabilities":["read"]}"#
    )
    .is_ok());
    assert!(parse_wire(
        br#"{"kind":"authReply","sessionId":"s","schemaVersion":2,"capabilities":["read"]}"#
    )
    .is_err());
    assert!(validate_result("scenePatch", &json!({"ok":true,"data":{"revision":1}})).is_ok());
    assert!(validate_result("scenePatch", &json!({"ok":true,"data":{"revision":-1}})).is_err());
}
#[test]
fn shared_protocol_fixtures() {
    use opensekai_contracts::{
        ConnectionDescriptor, FrameApplied, RuntimeFrame, SceneView, Validate,
    };
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/protocol");
    let load = |name: &str| std::fs::read(root.join(name)).unwrap();
    serde_json::from_slice::<SceneView>(&load("valid-scene.json"))
        .unwrap()
        .validate()
        .unwrap();
    serde_json::from_slice::<RuntimeFrame>(&load("valid-frame.json"))
        .unwrap()
        .validate()
        .unwrap();
    serde_json::from_slice::<FrameApplied>(&load("valid-applied.json"))
        .unwrap()
        .validate()
        .unwrap();
    assert!(
        serde_json::from_slice::<ConnectionDescriptor>(&load("invalid-role.json"))
            .unwrap()
            .validate()
            .is_err()
    );
}
#[test]
fn checks_scene_semantics() {
    use opensekai_contracts::{SceneView, Validate};
    let bytes = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/protocol/valid-scene.json"),
    )
    .unwrap();
    let scene: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    for change in ["camera", "duplicate", "lens", "scale", "version"] {
        let mut bad = scene.clone();
        match change {
            "camera" => bad["outputs"][0]["cameraId"] = json!("absent"),
            "duplicate" => bad["entities"][1]["id"] = bad["entities"][0]["id"].clone(),
            "lens" => bad["entities"][3]["lens"]["near"] = json!(0),
            "scale" => bad["entities"][0]["transform"]["scale"] = json!([1, 0, 1]),
            _ => bad["schemaVersion"] = json!(2),
        }
        assert!(
            serde_json::from_value::<SceneView>(bad)
                .unwrap()
                .validate()
                .is_err(),
            "{change}"
        );
    }
}
#[test]
fn rejects_missing_nullable_fields_and_unsafe_integers() {
    assert!(parse_wire(br#"{"kind":"applied","frame":{"outputId":"o","sessionId":"s","sequence":0,"tick":0,"revision":0,"cameraId":"c","backend":"webgpu","cpuMs":0,"warnings":[]}}"#).is_err());
    assert!(parse_call(
        br#"{"kind":"call","requestId":"","method":"sceneInspect","params":{"sceneId":"s"}}"#
    )
    .is_err());
    assert!(validate_result(
        "scenePatch",
        &json!({"ok":true,"data":{"revision":9007199254740992u64}})
    )
    .is_err());
    assert!(parse_wire(br#"{"kind":"captureReply","requestId":"r","result":{"ok":true,"data":{"metadata":{"frame":{"outputId":"o","sessionId":"s","sequence":0,"tick":0,"revision":0,"cameraId":"c","backend":"webgpu","cpuMs":0,"gpuMs":null,"warnings":[]},"width":1,"height":1},"pngBase64":"!!!!"}}}"#).is_err());
}
#[test]
fn bounds_capture_and_descriptor() {
    use opensekai_contracts::{validate_value, CaptureRecord, ConnectionDescriptor};
    let descriptor = json!({"schemaVersion":1,"sessionId":"s","httpOrigin":"http://127.0.0.1:1234","wsUrl":"ws://127.0.0.1:1234/ws","role":"operator","token":"t","capabilities":["read"],"outputId":null});
    assert!(validate_value::<ConnectionDescriptor>(&descriptor).is_ok());
    let mut bad = descriptor.clone();
    bad["wsUrl"] = json!("ws://127.0.0.1:1235/ws");
    assert!(validate_value::<ConnectionDescriptor>(&bad).is_err());
    let capture = json!({"id":"c","outputId":"o","revision":0,"tick":0,"sequence":0,"backend":"webgpu","cameraId":"cam","width":1921,"height":1080,"mimeType":"image/png","bytes":1,"sha256":"a".repeat(64),"resourceUri":"evidence:c","createdAtUtc":"2026-10-03T10:00:00Z"});
    assert!(validate_value::<CaptureRecord>(&capture).is_err());
}
#[test]
fn expanded_shared_vectors() {
    use opensekai_contracts::{
        validate_value, CaptureReplyData, ConnectionDescriptor, DiagnosticMarker, ErrorCode,
        SceneView,
    };
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/protocol/validation-vectors.json");
    let vectors: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    for vector in vectors {
        let p = &vector["payload"];
        let result = match vector["target"].as_str().unwrap() {
            "scene" => validate_value::<SceneView>(p).map(|_| ()),
            "asset" => validate_value::<opensekai_contracts::AssetRecord>(p).map(|_| ()),
            "captureRecord" => validate_value::<opensekai_contracts::CaptureRecord>(p).map(|_| ()),
            "descriptor" => validate_value::<ConnectionDescriptor>(p).map(|_| ()),
            "marker" => validate_value::<DiagnosticMarker>(p).map(|_| ()),
            "captureReplyData" => validate_value::<CaptureReplyData>(p).map(|_| ()),
            "wire" => parse_wire(&serde_json::to_vec(p).unwrap()).map(|_| ()),
            "call" => opensekai_contracts::validate_call(vector["method"].as_str().unwrap(), p),
            "wireText" => parse_wire(p.as_str().unwrap().as_bytes()).map(|_| ()),
            target => panic!("unknown target {target}"),
        };
        assert_eq!(
            result.is_ok(),
            vector["valid"].as_bool().unwrap(),
            "{}: {result:?}",
            vector["name"]
        );
        if let Err(error) = result {
            assert_eq!(error.code, ErrorCode::InvalidInput, "{}", vector["name"]);
        }
    }
}
#[test]
fn review_regressions() {
    use opensekai_contracts::{validate_value, AssetRecord, CaptureRecord, ConnectionDescriptor};
    let asset = json!({"id":"a","format":"glb","sha256":"a".repeat(64),"bytes":1,"sourceUrl":"not a url","licenseLabel":"test","importerVersion":1,"name":"Test"});
    assert!(validate_value::<AssetRecord>(&asset).is_err());
    let capture = json!({"id":"c","outputId":"o","revision":0,"tick":0,"sequence":0,"backend":"webgpu","cameraId":"cam","width":1,"height":1,"mimeType":"image/png","bytes":1,"sha256":"a".repeat(64),"resourceUri":"evidence:c","createdAtUtc":"2026-10-03T10:00:00.Z"});
    assert!(validate_value::<CaptureRecord>(&capture).is_err());
    assert!(validate_result(
        "scenePatch",
        &serde_json::from_str(r#"{"ok":true,"data":{"revision":1e0}}"#).unwrap()
    )
    .is_ok());
    assert!(parse_wire(
        br#"{"kind":"authReply","sessionId":"s","schemaVersion":1,"capabilities":["read","read"]}"#
    )
    .is_err());
    let descriptor = json!({"schemaVersion":1,"sessionId":"s","httpOrigin":"http://127.0.0.1:80","wsUrl":"ws://127.0.0.1/ws","role":"operator","token":"t","capabilities":["read"],"outputId":null});
    assert!(validate_value::<ConnectionDescriptor>(&descriptor).is_ok());
}
