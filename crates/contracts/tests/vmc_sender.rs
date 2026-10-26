use opensekai_contracts::{
    humanoid_bone, validate_result, validate_value, vmc_send_address_ok, AssetRecord, SceneView,
    HUMANOID_BONES,
};
use serde_json::{json, Value};
#[test]
fn humanoid_bone_order_lists_each_bone_once() {
    let unique: std::collections::HashSet<_> = HUMANOID_BONES.iter().collect();
    assert_eq!(unique.len(), 55);
    assert!(HUMANOID_BONES.iter().all(|name| humanoid_bone(name)));
}
#[test]
fn send_address_rejects_unspecified_multicast_and_broadcast() {
    for ok in [
        "127.0.0.1",
        "192.168.1.40",
        "::1",
        "fe80::1",
        "::ffff:10.0.0.2",
    ] {
        assert!(vmc_send_address_ok(ok), "{ok}");
    }
    for bad in [
        "0.0.0.0",
        "::",
        "224.0.0.1",
        "239.255.255.255",
        "ff02::1",
        "255.255.255.255",
        "::ffff:224.0.0.1",
        "::ffff:0.0.0.0",
        "localhost",
        "",
    ] {
        assert!(!vmc_send_address_ok(bad), "{bad}");
    }
}
fn sender() -> Value {
    json!({"id":"vmc","name":"VMC Sender","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"vmcSender","vmcSender":{"enabled":true,"address":"10.0.0.2","port":39539,"avatarId":"performer"}})
}
#[test]
fn sender_scene_round_trips() {
    let avatar = json!({"id":"performer","name":"performer","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"avatar","assetId":null});
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let scene = json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":[avatar,camera,sender()],"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]});
    let parsed = validate_value::<SceneView>(&scene).unwrap();
    let written = serde_json::to_value(&parsed).unwrap();
    assert_eq!(validate_value::<SceneView>(&written).unwrap(), parsed);
    assert_eq!(written["entities"][2]["kind"], "vmcSender");
    assert_eq!(written["entities"][2]["vmcSender"], sender()["vmcSender"]);
}
#[test]
fn record_rig_round_trips_and_stays_optional() {
    let mut record = json!({"id":"avatar_a","format":"vrm","sha256":"a".repeat(64),"bytes":1,"sourceUrl":null,"licenseLabel":"","importerVersion":1,"name":"Avatar","expressions":[]});
    assert!(validate_value::<AssetRecord>(&record)
        .unwrap()
        .rig
        .is_none());
    record["rig"] = json!({"metaVersion":"0","restPositions":{"hips":[0,1,0],"leftThumbMetacarpal":[0.01,0,0]},"identityRest":false});
    let parsed = validate_value::<AssetRecord>(&record).unwrap();
    let written = serde_json::to_value(&parsed).unwrap();
    assert_eq!(validate_value::<AssetRecord>(&written).unwrap(), parsed);
    assert_eq!(written["rig"]["metaVersion"], "0");
    assert_eq!(written["rig"]["identityRest"], false);
}
#[test]
fn app_status_lists_at_most_four_unique_senders() {
    let status = |senders: Value| json!({"ok":true,"data":{"schemaVersion":1,"sessionId":"s","ready":true,"revision":1,"capabilities":["read"],"warnings":[],"outputs":[],"vmcSenders":senders}});
    let one = |id: &str, state: &str, error: Value| json!({"entityId":id,"state":state,"datagrams":3,"errors":0,"error":error});
    assert!(validate_result(
        "appStatus",
        &status(json!([
            one("a", "sending", Value::Null),
            one("b", "error", json!("Endpoint used by VMC Receiver"))
        ]))
    )
    .is_ok());
    assert!(validate_result(
        "appStatus",
        &status(json!([
            one("a", "sending", Value::Null),
            one("a", "waiting", Value::Null)
        ]))
    )
    .is_err());
    let five: Vec<Value> = (0..5)
        .map(|i| one(&format!("s{i}"), "stopped", Value::Null))
        .collect();
    assert!(validate_result("appStatus", &status(json!(five))).is_err());
    assert!(validate_result(
        "appStatus",
        &status(json!([one("a", "paused", Value::Null)]))
    )
    .is_err());
}
