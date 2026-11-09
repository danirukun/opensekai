use opensekai_contracts::{
    validate_value, AssetKind, AssetRecord, AssetSummary, ScenePatch, SceneView, Validate,
    MAX_SCREENS,
};
use serde_json::{json, Value};
fn scene(extra: Vec<Value>) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let mut entities = vec![camera];
    entities.extend(extra);
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":entities,"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn screen(id: &str, asset_id: Value) -> Value {
    json!({"id":id,"name":"Screen","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"screen","content":{"kind":"image","assetId":asset_id}})
}
// B28 R1: the same vectors as packages/contracts/test/screen.test.ts.
#[test]
fn image_records_match_the_shared_vectors() {
    let vectors: Value = serde_json::from_str(include_str!(
        "../../../fixtures/protocol/image-records.json"
    ))
    .unwrap();
    for vector in vectors["valid"].as_array().unwrap() {
        let record: AssetRecord = serde_json::from_value(vector["record"].clone())
            .unwrap_or_else(|e| panic!("{}: {e}", vector["name"]));
        assert!(record.validate().is_ok(), "{}", vector["name"]);
        assert_eq!(serde_json::to_value(&record).unwrap(), vector["record"]);
    }
    for vector in vectors["invalid"].as_array().unwrap() {
        let ok = serde_json::from_value::<AssetRecord>(vector["record"].clone())
            .is_ok_and(|record| record.validate().is_ok());
        assert!(!ok, "{} passed", vector["name"]);
    }
}
#[test]
fn image_summary_has_the_image_kind() {
    let vectors: Value = serde_json::from_str(include_str!(
        "../../../fixtures/protocol/image-records.json"
    ))
    .unwrap();
    let record: AssetRecord =
        serde_json::from_value(vectors["valid"][0]["record"].clone()).unwrap();
    assert_eq!(AssetSummary::of(&record).kind, AssetKind::Image);
}
#[test]
fn screens_round_trip_within_the_limit() {
    let value = scene(vec![
        screen("logo", json!("image_a")),
        screen("empty", Value::Null),
    ]);
    let parsed = validate_value::<SceneView>(&value).unwrap();
    let written = serde_json::to_value(&parsed).unwrap();
    assert_eq!(
        written["entities"][1]["content"],
        value["entities"][1]["content"]
    );
    assert_eq!(
        written["entities"][2]["content"],
        value["entities"][2]["content"]
    );
    assert_eq!(validate_value::<SceneView>(&written).unwrap(), parsed);
    let full: Vec<_> = (0..MAX_SCREENS)
        .map(|i| screen(&format!("s{i}"), Value::Null))
        .collect();
    assert!(validate_value::<SceneView>(&scene(full.clone())).is_ok());
    let mut over = full;
    over.push(screen("s_over", Value::Null));
    assert!(validate_value::<SceneView>(&scene(over)).is_err());
    let mut video = screen("v", Value::Null);
    video["content"]["kind"] = json!("web");
    assert!(validate_value::<SceneView>(&scene(vec![video])).is_err());
}
#[test]
fn set_screen_image_parses() {
    let patch = json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[
        {"kind":"setScreenImage","entityId":"logo","assetId":null},
        {"kind":"setScreenImage","entityId":"logo","assetId":"image_a"}]});
    assert!(validate_value::<ScenePatch>(&patch).is_ok());
    let missing = json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[{"kind":"setScreenImage","entityId":"logo"}]});
    assert!(validate_value::<ScenePatch>(&missing).is_err());
}
