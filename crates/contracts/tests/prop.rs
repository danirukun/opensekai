use opensekai_contracts::{validate_value, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene(extra: Vec<Value>) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let mut entities = vec![camera];
    entities.extend(extra);
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":entities,"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn prop(id: &str, asset_id: Value) -> Value {
    json!({"id":id,"name":"Prop","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"mesh","source":{"kind":"asset","assetId":asset_id}})
}
#[test]
fn props_with_and_without_a_model_round_trip() {
    let value = scene(vec![prop("walls", json!("scene_a")), prop("walls_2", json!("scene_a")), prop("empty", Value::Null)]);
    let parsed = validate_value::<SceneView>(&value).unwrap();
    assert_eq!(serde_json::to_value(&parsed).unwrap()["entities"][3]["source"], json!({"kind":"asset","assetId":null}));
    assert!(validate_value::<SceneView>(&scene(vec![json!({"id":"x","name":"Prop","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"mesh","source":{"kind":"asset"}})])).is_err());
}
#[test]
fn set_mesh_model_parses() {
    let patch = json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[
        {"kind":"setMeshModel","entityId":"walls","assetId":null},
        {"kind":"setMeshModel","entityId":"walls","assetId":"scene_a"}]});
    assert!(validate_value::<ScenePatch>(&patch).is_ok());
}
