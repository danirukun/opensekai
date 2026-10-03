use opensekai_contracts::{parse_wire, validate_value, SceneEntity, ScenePatch};
use serde_json::json;
fn source() -> serde_json::Value {
    json!({"kind":"tracking","id":"s","name":"VMC","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"generation":2,"config":{"kind":"vmc","enabled":true,"bindAddress":"127.0.0.1","port":39539,"senderAddress":null}})
}
#[test]
fn tracking_entity_and_authoring_patch_are_accepted() {
    assert!(validate_value::<SceneEntity>(&source()).is_ok());
    assert!(validate_value::<ScenePatch>(&json!({"sceneId":"s","expectedRevision":1,"operations":[{"kind":"createEntity","entity":source()}]})).is_ok());
}
#[test]
fn clock_carries_bounded_valid_tracking() {
    let v = json!({"kind":"clock","sessionId":"s","elapsedMs":2,"tracking":{"samples":[{"sourceId":"s","generation":2,"receivedAtMs":1,"bones":{"head":{"rotation":[0,0,0,1],"space":"raw"}},"expressions":{"jawOpen":0.5}}],"statuses":[]}});
    assert!(parse_wire(&serde_json::to_vec(&v).unwrap()).is_ok());
}
#[test]
fn tracking_config_rejects_hostname() {
    let mut v = source();
    v["config"]["bindAddress"] = json!("localhost");
    assert!(validate_value::<SceneEntity>(&v).is_err());
}
#[test]
fn expression_names_are_not_reserved_contract_fields() {
    let v = json!({"kind":"clock","sessionId":"s","elapsedMs":2,"tracking":{"samples":[{"sourceId":"s","generation":2,"receivedAtMs":1,"bones":{},"expressions":{"generation":0.5,"sourceId":0.5,"avatarId":0.5,"packets":0.5}}],"statuses":[]}});
    assert!(parse_wire(&serde_json::to_vec(&v).unwrap()).is_ok());
}

#[test]
fn optional_inference_duration_is_bounded_and_legacy_compatible() {
    let base = serde_json::json!({"sourceId":"source","generation":1,"state":"receiving","packets":1,"invalidPackets":0,"lastReceivedAtMs":100,"error":null});
    let legacy: opensekai_contracts::TrackingStatus = serde_json::from_value(base.clone()).unwrap();
    assert!(opensekai_contracts::Validate::validate(&legacy).is_ok());
    assert!(serde_json::to_value(&legacy)
        .unwrap()
        .get("inferenceMs")
        .is_none());
    for inference_ms in [0., 12.5, 60000.] {
        let mut value = base.clone();
        value["inferenceMs"] = serde_json::json!(inference_ms);
        let parsed: opensekai_contracts::TrackingStatus = serde_json::from_value(value).unwrap();
        assert!(opensekai_contracts::Validate::validate(&parsed).is_ok());
    }
    for inference_ms in [-1., 60001.] {
        let mut value = base.clone();
        value["inferenceMs"] = serde_json::json!(inference_ms);
        let parsed: opensekai_contracts::TrackingStatus = serde_json::from_value(value).unwrap();
        assert!(opensekai_contracts::Validate::validate(&parsed).is_err());
    }
}
