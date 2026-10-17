use opensekai_contracts::{validate_value, AssetRecord, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene(extra: Vec<Value>) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let mut entities = vec![camera];
    entities.extend(extra);
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":entities,"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn environment(id: &str) -> Value {
    json!({"id":id,"name":"Environment","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"environment","assetId":null})
}
fn record() -> Value {
    json!({"id":format!("scene_{}", "a".repeat(64)),"format":"glb","sha256":"a".repeat(64),"bytes":1,"sourceUrl":null,"licenseLabel":"","importerVersion":1,"name":"Room","expressions":[]})
}
#[test]
fn one_environment_is_valid_and_two_are_not() {
    assert!(validate_value::<SceneView>(&scene(vec![environment("stage")])).is_ok());
    assert!(validate_value::<SceneView>(&scene(vec![
        environment("stage"),
        environment("stage_2")
    ]))
    .is_err());
}
#[test]
fn environment_requires_the_asset_key() {
    let mut entity = environment("stage");
    entity.as_object_mut().unwrap().remove("assetId");
    assert!(validate_value::<SceneView>(&scene(vec![entity])).is_err());
}
#[test]
fn camera_flag_is_optional_and_round_trips() {
    let plain = validate_value::<SceneView>(&scene(vec![])).unwrap();
    assert!(!serde_json::to_string(&plain)
        .unwrap()
        .contains("renderEnvironment"));
    let mut flagged = scene(vec![]);
    flagged["entities"][0]["renderEnvironment"] = json!(false);
    let parsed = validate_value::<SceneView>(&flagged).unwrap();
    assert!(serde_json::to_string(&parsed)
        .unwrap()
        .contains("\"renderEnvironment\":false"));
}
#[test]
fn environment_operations_parse() {
    let patch = json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[
        {"kind":"setEnvironmentModel","entityId":"stage","assetId":null},
        {"kind":"setEnvironmentModel","entityId":"stage","assetId":"scene_a"},
        {"kind":"setCameraRenderEnvironment","entityId":"camera_main","renderEnvironment":false}]});
    assert!(validate_value::<ScenePatch>(&patch).is_ok());
}
#[test]
fn credits_are_optional_and_never_null() {
    assert!(validate_value::<AssetRecord>(&record()).is_ok());
    let mut with = record();
    with["credits"] = json!({"title":"Room","author":null,"license":"CC-BY-4.0","sourceUrl":"https://sketchfab.com/3d-models/room"});
    assert!(validate_value::<AssetRecord>(&with).is_ok());
    let mut null = record();
    null["credits"] = Value::Null;
    assert!(validate_value::<AssetRecord>(&null).is_err());
    let mut ftp = record();
    ftp["credits"] =
        json!({"title":null,"author":null,"license":null,"sourceUrl":"ftp://example.com/room"});
    assert!(validate_value::<AssetRecord>(&ftp).is_err());
}
