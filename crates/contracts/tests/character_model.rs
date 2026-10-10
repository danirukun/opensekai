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
    assert!(validate_value::<ScenePatch>(&patch(json!({"kind":"setAvatarModel","entityId":"char","assetId":"avatar_x"}))).is_ok());
    assert!(validate_value::<ScenePatch>(&patch(json!({"kind":"setAvatarModel","entityId":"char","assetId":null}))).is_ok());
    assert!(validate_value::<ScenePatch>(&patch(json!({"kind":"setAvatarModel","entityId":"char"}))).is_err());
}
#[test]
fn asset_record_requires_bounded_name() {
    let record = json!({"id":"avatar_x","format":"vrm","sha256":"a".repeat(64),"bytes":1,"sourceUrl":null,"licenseLabel":"User supplied","importerVersion":1,"name":"Rem"});
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
