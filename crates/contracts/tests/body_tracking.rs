use opensekai_contracts::{validate_value, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene(tracking: Value) -> Value {
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":[
        {"id":"performer","name":"performer","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"avatar","assetId":null,"tracking":tracking},
        {"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}}
    ],"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn tracking(body: Value) -> Value {
    json!({"bodySourceId":null,"faceSourceId":null,"body":body})
}
#[test]
fn body_tracking_is_optional_and_round_trips() {
    let plain = scene(json!({"bodySourceId":null,"faceSourceId":null}));
    let parsed = validate_value::<SceneView>(&plain).unwrap();
    assert!(!serde_json::to_string(&parsed)
        .unwrap()
        .contains("movementIntensity"));
    let body = json!({"movementIntensity":1.5,"trackedParts":["head","body","leftArm","rightArm","leftFingers","rightFingers","leftLeg","rightLeg"]});
    let parsed = validate_value::<SceneView>(&scene(tracking(body.clone()))).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["entities"][0]["tracking"]["body"],
        body
    );
}
#[test]
fn body_tracking_checks_the_intensity_and_the_parts() {
    for body in [
        json!({"movementIntensity":2.01,"trackedParts":["head"]}),
        json!({"movementIntensity":-0.1,"trackedParts":["head"]}),
        json!({"movementIntensity":1,"trackedParts":["head","head"]}),
        json!({"movementIntensity":1,"trackedParts":["tail"]}),
        json!({"movementIntensity":1}),
        json!({"movementIntensity":1,"trackedParts":[],"fade":1}),
    ] {
        assert!(
            validate_value::<SceneView>(&scene(tracking(body.clone()))).is_err(),
            "{body}"
        );
    }
    assert!(validate_value::<SceneView>(&scene(tracking(
        json!({"movementIntensity":0,"trackedParts":[]})
    )))
    .is_ok());
}
#[test]
fn set_avatar_tracking_checks_the_body_group() {
    let patch = |body: Value| json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[{"kind":"setAvatarTracking","entityId":"performer","tracking":tracking(body)}]});
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"movementIntensity":2,"trackedParts":["body"]})
    ))
    .is_ok());
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"movementIntensity":3,"trackedParts":["body"]})
    ))
    .is_err());
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"movementIntensity":1,"trackedParts":["body","body"]})
    ))
    .is_err());
}
