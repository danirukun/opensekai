use opensekai_contracts::{
    parse_wire, validate_value, AppStatus, AvatarPose, SceneEntity, ScenePatch, TrackingStatus,
};
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

fn smoothing() -> serde_json::Value {
    json!({"enabled":true,"minCutoff":5.,"beta":0.5,"derivativeCutoff":1.})
}
fn smoothing_patch(settings: serde_json::Value) -> serde_json::Value {
    json!({"sceneId":"s","expectedRevision":1,"operations":[{"kind":"setTrackingSmoothing","entityId":"s","smoothing":settings}]})
}
#[test]
fn smoothing_round_trips_on_entity_and_patch_and_preserves_legacy() {
    let legacy = validate_value::<SceneEntity>(&source()).unwrap();
    assert!(serde_json::to_value(legacy)
        .unwrap()
        .get("smoothing")
        .is_none());
    let mut entity = source();
    entity["smoothing"] = smoothing();
    let parsed = validate_value::<SceneEntity>(&entity).unwrap();
    let serialized = serde_json::to_value(parsed).unwrap();
    assert_eq!(serialized["smoothing"], entity["smoothing"]);
    assert_eq!(serialized["config"], entity["config"]);
    assert_eq!(serialized["generation"], entity["generation"]);
    let patch = smoothing_patch(smoothing());
    let parsed = validate_value::<ScenePatch>(&patch).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), patch);
}
#[test]
fn smoothing_bounds_and_unknown_fields_are_checked_on_entity_and_patch() {
    for (field, values) in [
        ("minCutoff", vec![0.01, 120.]),
        ("beta", vec![0., 100.]),
        ("derivativeCutoff", vec![0.01, 120.]),
    ] {
        for value in values {
            let mut settings = smoothing();
            settings[field] = json!(value);
            let mut entity = source();
            entity["smoothing"] = settings.clone();
            assert!(validate_value::<SceneEntity>(&entity).is_ok());
            assert!(validate_value::<ScenePatch>(&smoothing_patch(settings)).is_ok());
        }
    }
    for (field, values) in [
        ("minCutoff", vec![0., 120.01]),
        ("beta", vec![-0.01, 100.01]),
        ("derivativeCutoff", vec![0., 120.01]),
    ] {
        for value in values {
            let mut settings = smoothing();
            settings[field] = json!(value);
            let mut entity = source();
            entity["smoothing"] = settings.clone();
            assert!(validate_value::<SceneEntity>(&entity).is_err());
            assert!(validate_value::<ScenePatch>(&smoothing_patch(settings)).is_err());
        }
    }
    let mut settings = smoothing();
    settings["extra"] = json!(true);
    let mut entity = source();
    entity["smoothing"] = settings.clone();
    assert!(validate_value::<SceneEntity>(&entity).is_err());
    assert!(validate_value::<ScenePatch>(&smoothing_patch(settings)).is_err());
}

#[test]
fn smoothing_rejects_nonfinite_native_values() {
    use opensekai_contracts::{TrackingSmoothing, Validate};
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for field in 0..3 {
            let mut settings = TrackingSmoothing {
                enabled: false,
                min_cutoff: 5.,
                beta: 0.5,
                derivative_cutoff: 1.,
            };
            match field {
                0 => settings.min_cutoff = value,
                1 => settings.beta = value,
                _ => settings.derivative_cutoff = value,
            }
            assert!(settings.validate().is_err());
        }
    }
}
#[test]
fn b5_optional_fields_match_typescript() {
    let mut app = json!({"schemaVersion":1,"sessionId":"s","ready":true,"revision":0,"capabilities":[],"warnings":[],"outputs":[],"localAddresses":["192.168.1.20"]});
    assert!(validate_value::<AppStatus>(&app).is_ok());
    app["localAddresses"] = json!(["fe80::1"]);
    assert!(validate_value::<AppStatus>(&app).is_err());
    app["localAddresses"] = json!((0..9).map(|i| format!("10.0.0.{i}")).collect::<Vec<_>>());
    assert!(validate_value::<AppStatus>(&app).is_err());
    let status = json!({"sourceId":"s","generation":1,"state":"waiting","packets":0,"invalidPackets":0,"lastReceivedAtMs":null,"error":null,"unmatchedPackets":3});
    assert!(validate_value::<TrackingStatus>(&status).is_ok());
    let mut pose = json!({"avatarId":"a","bones":{},"expressions":{},"boneOffsets":{"chest":[0,0.1045,0,0.9945]}});
    assert!(validate_value::<AvatarPose>(&pose).is_ok());
    pose["boneOffsets"] = json!({"tail":[0,0,0,1]});
    assert!(validate_value::<AvatarPose>(&pose).is_err());
    pose["boneOffsets"] = json!({"chest":[0,1,0,1]});
    assert!(validate_value::<AvatarPose>(&pose).is_err());
}
