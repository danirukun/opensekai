use opensekai_contracts::{
    validate_value, AssetKind, AssetRecord, AssetSummary, RuntimeFrame, ScenePatch, SceneView,
    Validate, MAX_SCREENS, MAX_VIDEO_SCREENS,
};
use serde_json::{json, Value};
fn scene(extra: Vec<Value>) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let mut entities = vec![camera];
    entities.extend(extra);
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":entities,"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn placed(id: &str, content: Value) -> Value {
    json!({"id":id,"name":"Screen","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"screen","content":content})
}
fn video(id: &str) -> Value {
    placed(
        id,
        json!({"kind":"video","assetId":"video_a","autoPlay":false,"loop":true,"volume":0.5}),
    )
}
fn vectors() -> Value {
    serde_json::from_str(include_str!(
        "../../../fixtures/protocol/video-records.json"
    ))
    .unwrap()
}
// B29 R1: the same vectors as packages/contracts/test/video-screen.test.ts.
#[test]
fn video_records_match_the_shared_vectors() {
    let vectors = vectors();
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
fn video_summary_has_the_video_kind() {
    let record: AssetRecord =
        serde_json::from_value(vectors()["valid"][0]["record"].clone()).unwrap();
    assert_eq!(AssetSummary::of(&record).kind, AssetKind::Video);
}
#[test]
fn video_screens_round_trip_within_the_limit() {
    let value = scene(vec![video("clip")]);
    let parsed = validate_value::<SceneView>(&value).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["entities"][1]["content"],
        value["entities"][1]["content"]
    );
    let mut full: Vec<_> = (0..MAX_VIDEO_SCREENS)
        .map(|i| video(&format!("v{i}")))
        .collect();
    full.extend(
        (MAX_VIDEO_SCREENS..MAX_SCREENS)
            .map(|i| placed(&format!("i{i}"), json!({"kind":"image","assetId":null}))),
    );
    assert!(validate_value::<SceneView>(&scene(full)).is_ok());
    let over: Vec<_> = (0..=MAX_VIDEO_SCREENS)
        .map(|i| video(&format!("v{i}")))
        .collect();
    assert!(validate_value::<SceneView>(&scene(over)).is_err());
    let mut loud = video("loud");
    loud["content"]["volume"] = json!(1.5);
    assert!(validate_value::<SceneView>(&scene(vec![loud])).is_err());
}
#[test]
fn video_operations_parse() {
    let settings = json!({"assetId":"video_a","autoPlay":true,"loop":false,"volume":0.5});
    let patch = json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[
        {"kind":"setScreenVideo","entityId":"clip","video":settings},
        {"kind":"controlScreenVideo","entityId":"clip","action":"play"},
        {"kind":"controlScreenVideo","entityId":"clip","action":"pause"},
        {"kind":"controlScreenVideo","entityId":"clip","action":"restart"}]});
    assert!(validate_value::<ScenePatch>(&patch).is_ok());
    let written = serde_json::to_value(validate_value::<ScenePatch>(&patch).unwrap()).unwrap();
    assert_eq!(written, patch);
    for bad in [
        json!({"kind":"setScreenVideo","entityId":"clip","video":{"assetId":null,"autoPlay":true,"loop":false,"volume":2}}),
        json!({"kind":"setScreenVideo","entityId":"clip","video":{"assetId":null}}),
        json!({"kind":"controlScreenVideo","entityId":"clip","action":"seek"}),
    ] {
        let patch = json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[bad]});
        assert!(validate_value::<ScenePatch>(&patch).is_err(), "{patch}");
    }
}
#[test]
fn frames_carry_screen_playback() {
    let frame = |playback: Value| json!({"schemaVersion":1,"sessionId":"s","sequence":1,"tick":1,"elapsedMs":16,"scene":scene(vec![]),"screenPlayback":playback});
    assert!(validate_value::<RuntimeFrame>(&frame(
        json!([{"entityId":"a","playing":true,"positionMs":1250}])
    ))
    .is_ok());
    for bad in [
        json!([{"entityId":"a","playing":true,"positionMs":1},{"entityId":"a","playing":false,"positionMs":2}]),
        json!([{"entityId":"a","playing":true,"positionMs":1.5}]),
        json!([{"entityId":"a","playing":true,"positionMs":-1}]),
        json!((0..=MAX_VIDEO_SCREENS)
            .map(|i| json!({"entityId":format!("v{i}"),"playing":true,"positionMs":0}))
            .collect::<Vec<_>>()),
    ] {
        assert!(
            validate_value::<RuntimeFrame>(&frame(bad.clone())).is_err(),
            "{bad}"
        );
    }
}
