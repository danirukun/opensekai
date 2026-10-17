use opensekai_contracts::{validate_value, AssetRecord, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene(avatar: Value) -> Value {
    let transform = json!({"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]});
    let mut character = json!({"id":"char","name":"Character","visible":true,"transform":transform,"kind":"avatar"});
    for (k, v) in avatar.as_object().unwrap() {
        character[k] = v.clone();
    }
    json!({"schemaVersion":1,"sceneId":"s","revision":0,
        "outputs":[{"id":"output_main","cameraId":"cam","width":1920,"height":1080,"fps":60}],
        "entities":[{"id":"cam","name":"Camera","visible":true,"transform":transform,"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}}, character]})
}
#[test]
fn character_without_model_keeps_asset_key_required() {
    assert!(validate_value::<SceneView>(&scene(json!({"assetId":null}))).is_ok());
    assert!(validate_value::<SceneView>(&scene(json!({"assetId":"avatar_x"}))).is_ok());
    assert!(validate_value::<SceneView>(&scene(json!({}))).is_err());
}
#[test]
fn set_avatar_model_accepts_asset_or_null() {
    let patch = |op: Value| json!({"sceneId":"s","expectedRevision":0,"operations":[op]});
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setAvatarModel","entityId":"char","assetId":"avatar_x"})
    ))
    .is_ok());
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setAvatarModel","entityId":"char","assetId":null})
    ))
    .is_ok());
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setAvatarModel","entityId":"char"})
    ))
    .is_err());
}
#[test]
fn asset_record_requires_bounded_name() {
    let record = json!({"id":"avatar_x","format":"vrm","sha256":"a".repeat(64),"bytes":1,"sourceUrl":null,"licenseLabel":"User supplied","importerVersion":1,"name":"Rem","expressions":[]});
    assert!(validate_value::<AssetRecord>(&record).is_ok());
    let mut unnamed = record.clone();
    unnamed.as_object_mut().unwrap().remove("name");
    assert!(validate_value::<AssetRecord>(&unnamed).is_err());
    for bad in [json!(""), json!("   "), json!("a".repeat(129))] {
        let mut v = record.clone();
        v["name"] = bad;
        assert!(validate_value::<AssetRecord>(&v).is_err());
    }
}
#[test]
fn expression_contracts_validate_calls_results_settings_and_records() {
    use opensekai_contracts::{validate_call, validate_result};
    let view = |weight: f64, layer: u32, fade: f64| json!({"ok":true,"data":{"avatarId":"performer","expressions":[{"name":"happy","preset":true,"layer":layer,"fadeSeconds":fade,"suppress":{"blink":false,"mouth":true,"brow":false},"active":true,"weight":weight}]}});
    assert!(validate_result("expressionGet", &view(0.5, 0, 0.4)).is_ok());
    assert!(validate_result("expressionSet", &view(1., 15, 5.)).is_ok());
    for bad in [view(1.5, 0, 0.4), view(0.5, 16, 0.4), view(0.5, 0, 5.5)] {
        assert!(validate_result("expressionGet", &bad).is_err());
    }
    assert!(validate_call(
        "expressionSet",
        &json!({"avatarId":"a","name":"x".repeat(128),"active":false})
    )
    .is_ok());
    assert!(validate_call(
        "expressionSet",
        &json!({"avatarId":"a","name":"x".repeat(129),"active":false})
    )
    .is_err());
    assert!(validate_call("expressionGet", &json!({"avatarId":"a","extra":1})).is_err());
    let patch = |settings: serde_json::Value| json!({"sceneId":"s","expectedRevision":0,"operations":[{"kind":"setAvatarExpression","entityId":"a","name":"happy","settings":settings}]});
    let settings =
        json!({"layer":2,"fadeSeconds":0,"suppress":{"blink":true,"mouth":false,"brow":false}});
    assert!(validate_value::<ScenePatch>(&patch(settings.clone())).is_ok());
    assert!(validate_value::<ScenePatch>(&patch(serde_json::Value::Null)).is_ok());
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"layer":2,"fadeSeconds":-1,"suppress":{"blink":true,"mouth":false,"brow":false}})
    ))
    .is_err());
    let record = |expressions: serde_json::Value| json!({"id":"avatar_x","format":"vrm","sha256":"a".repeat(64),"bytes":1,"sourceUrl":null,"licenseLabel":"","importerVersion":1,"name":"Rem","expressions":expressions});
    assert!(
        validate_value::<AssetRecord>(&record(json!([{"name":"happy","preset":true}]))).is_ok()
    );
    assert!(validate_value::<AssetRecord>(&record(
        json!([{"name":"happy","preset":true},{"name":"happy","preset":false}])
    ))
    .is_err());
    assert!(validate_value::<AssetRecord>(&record(json!([{"name":"","preset":true}]))).is_err());
    let many: Vec<_> = (0..65)
        .map(|i| json!({"name":format!("e{i}"),"preset":false}))
        .collect();
    assert!(validate_value::<AssetRecord>(&record(json!(many))).is_err());
    let mut missing = record(json!([]));
    missing.as_object_mut().unwrap().remove("expressions");
    assert!(validate_value::<AssetRecord>(&missing).is_err());
}
#[test]
fn tracked_expression_names_match_the_typescript_list() {
    let names: Value = serde_json::from_str(include_str!(
        "../../../fixtures/protocol/tracked-expressions.json"
    ))
    .unwrap();
    for (key, tracked) in [("tracked", true), ("triggerable", false)] {
        for name in names[key].as_array().unwrap() {
            let name = name.as_str().unwrap();
            assert_eq!(
                opensekai_contracts::is_tracked_expression(name),
                tracked,
                "{name}"
            );
        }
    }
}
