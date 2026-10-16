use opensekai_contracts::{validate_value, FrameApplied, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene() -> Value {
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":[{"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}}],"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn applied() -> Value {
    serde_json::from_str(include_str!(
        "../../../fixtures/protocol/valid-applied.json"
    ))
    .unwrap()
}
#[test]
fn camera_anti_aliasing_is_optional_and_round_trips() {
    let plain = validate_value::<SceneView>(&scene()).unwrap();
    assert!(!serde_json::to_string(&plain)
        .unwrap()
        .contains("antiAliasing"));
    for mode in ["none", "fxaa"] {
        let mut flagged = scene();
        flagged["entities"][0]["antiAliasing"] = json!(mode);
        let parsed = validate_value::<SceneView>(&flagged).unwrap();
        assert!(serde_json::to_string(&parsed)
            .unwrap()
            .contains(&format!("\"antiAliasing\":\"{mode}\"")));
    }
    for mode in ["smaa", "taa"] {
        let mut unknown = scene();
        unknown["entities"][0]["antiAliasing"] = json!(mode);
        assert!(validate_value::<SceneView>(&unknown).is_err(), "{mode}");
    }
}
#[test]
fn anti_aliasing_operation_parses_and_rejects_unknown_modes() {
    let patch = |mode: &str| json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[{"kind":"setCameraAntiAliasing","entityId":"camera_main","antiAliasing":mode}]});
    assert!(validate_value::<ScenePatch>(&patch("fxaa")).is_ok());
    assert!(validate_value::<ScenePatch>(&patch("smaa")).is_err());
}
#[test]
fn acknowledgment_quality_profile_is_optional_and_known() {
    let plain = validate_value::<FrameApplied>(&applied()).unwrap();
    assert_eq!(plain.quality_profile, None);
    assert!(!serde_json::to_string(&plain)
        .unwrap()
        .contains("qualityProfile"));
    for id in ["preview_v1", "production_v1", "performance_v1"] {
        let mut value = applied();
        value["qualityProfile"] = json!(id);
        assert!(validate_value::<FrameApplied>(&value).is_ok(), "{id}");
    }
    let mut unknown = applied();
    unknown["qualityProfile"] = json!("ultra_v1");
    assert!(validate_value::<FrameApplied>(&unknown).is_err());
}
