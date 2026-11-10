use opensekai_contracts::{validate_value, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene() -> Value {
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":[{"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}}],"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn grading() -> Value {
    json!({"toneMapping":"aces","exposure":0.5,"brightness":0.1,"contrast":-0.2,"vibrance":0.3,"tint":"#ffeedd","bloom":{"intensity":0.98,"threshold":0.76,"radius":0.4}})
}
#[test]
fn camera_grading_is_optional_and_round_trips() {
    let plain = validate_value::<SceneView>(&scene()).unwrap();
    assert!(!serde_json::to_string(&plain).unwrap().contains("grading"));
    let mut graded = scene();
    graded["entities"][0]["grading"] = grading();
    let parsed = validate_value::<SceneView>(&graded).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["entities"][0]["grading"],
        grading()
    );
}
#[test]
fn camera_grading_checks_each_range_and_field() {
    let cases: [(&str, Value); 12] = [
        ("exposure", json!(4.01)),
        ("exposure", json!(-4.01)),
        ("brightness", json!(1.01)),
        ("contrast", json!(-1.01)),
        ("vibrance", json!(1.01)),
        ("tint", json!("#FFEEDD")),
        ("tint", json!("#fff")),
        ("toneMapping", json!("agx")),
        (
            "bloom",
            json!({"intensity":4.01,"threshold":0.8,"radius":0.4}),
        ),
        (
            "bloom",
            json!({"intensity":1,"threshold":-0.1,"radius":0.4}),
        ),
        (
            "bloom",
            json!({"intensity":1,"threshold":0.8,"radius":1.01}),
        ),
        ("bloom", json!({"intensity":1,"threshold":0.8})),
    ];
    for (field, value) in cases {
        let mut bad = scene();
        bad["entities"][0]["grading"] = grading();
        bad["entities"][0]["grading"][field] = value.clone();
        assert!(
            validate_value::<SceneView>(&bad).is_err(),
            "{field} {value}"
        );
    }
    let mut unknown = scene();
    unknown["entities"][0]["grading"] = grading();
    unknown["entities"][0]["grading"]["lut"] = json!("x");
    assert!(validate_value::<SceneView>(&unknown).is_err());
}
#[test]
fn grading_operation_sets_removes_and_checks_the_group() {
    let patch = |grading: Value| json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[{"kind":"setCameraGrading","entityId":"camera_main","grading":grading}]});
    assert!(validate_value::<ScenePatch>(&patch(grading())).is_ok());
    assert!(validate_value::<ScenePatch>(&patch(Value::Null)).is_ok());
    let mut bad = grading();
    bad["contrast"] = json!(1.5);
    assert!(validate_value::<ScenePatch>(&patch(bad)).is_err());
}
