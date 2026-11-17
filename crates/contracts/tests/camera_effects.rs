use opensekai_contracts::{validate_value, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene() -> Value {
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":[{"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}}],"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn defaults() -> Value {
    json!({
        "lensDirt":{"assetId":null,"intensity":0.9,"threshold":0.5},
        "vignetting":{"enabled":false,"color":"#4c4c4c","alpha":0.051,"fadeOut":0.0,"blink":0.0},
        "nightVision":{"enabled":false,"color":"#80ff80","alpha":0.502},
        "blur":{"enabled":false,"intensity":1.0},
        "pixelate":{"enabled":false,"intensity":16}
    })
}
fn with_effects(effects: Value) -> Value {
    let mut s = scene();
    s["entities"][0]["effects"] = effects;
    s
}
fn with_field(group: &str, field: &str, value: Value) -> Value {
    let mut effects = defaults();
    effects[group][field] = value;
    with_effects(effects)
}
#[test]
fn camera_without_effects_saves_without_the_key() {
    let plain = validate_value::<SceneView>(&scene()).unwrap();
    assert!(!serde_json::to_string(&plain).unwrap().contains("effects"));
}
#[test]
fn camera_effects_round_trip_and_omit_missing_groups() {
    let parsed = validate_value::<SceneView>(&with_effects(defaults())).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["entities"][0]["effects"],
        defaults()
    );
    let parsed = validate_value::<SceneView>(&with_effects(json!({}))).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["entities"][0]["effects"],
        json!({})
    );
}
#[test]
fn camera_effects_accept_the_range_ends() {
    for (group, field, value) in [
        ("pixelate", "intensity", json!(1)),
        ("pixelate", "intensity", json!(256)),
        ("lensDirt", "assetId", json!("image_dirt")),
        ("lensDirt", "intensity", json!(0)),
        ("lensDirt", "threshold", json!(1)),
        ("vignetting", "alpha", json!(1)),
        ("vignetting", "blink", json!(1)),
        ("blur", "intensity", json!(4)),
    ] {
        assert!(
            validate_value::<SceneView>(&with_field(group, field, value.clone())).is_ok(),
            "{group}.{field} {value}"
        );
    }
}
#[test]
fn camera_effects_reject_each_bad_shape() {
    let cases: [(&str, &str, Value); 13] = [
        ("vignetting", "alpha", json!(1.01)),
        ("vignetting", "fadeOut", json!(-0.01)),
        ("vignetting", "blink", json!(1.01)),
        ("nightVision", "alpha", json!(-0.01)),
        ("lensDirt", "intensity", json!(1.01)),
        ("lensDirt", "threshold", json!(-0.01)),
        ("lensDirt", "assetId", json!("")),
        ("blur", "intensity", json!(4.01)),
        ("pixelate", "intensity", json!(0)),
        ("pixelate", "intensity", json!(257)),
        ("pixelate", "intensity", json!(16.5)),
        ("vignetting", "color", json!("#4C4C4C")),
        ("nightVision", "color", json!("#4c4c4c80")),
    ];
    for (group, field, value) in cases {
        assert!(
            validate_value::<SceneView>(&with_field(group, field, value.clone())).is_err(),
            "{group}.{field} {value}"
        );
    }
    assert!(validate_value::<SceneView>(&with_effects(json!({"chromaticAberration":{}}))).is_err());
    assert!(validate_value::<SceneView>(&with_field("blur", "radius", json!(1))).is_err());
    let mut missing = defaults();
    missing["vignetting"]
        .as_object_mut()
        .unwrap()
        .remove("blink");
    assert!(validate_value::<SceneView>(&with_effects(missing)).is_err());
    let mut no_asset = defaults();
    no_asset["lensDirt"]
        .as_object_mut()
        .unwrap()
        .remove("assetId");
    assert!(validate_value::<SceneView>(&with_effects(no_asset)).is_err());
}
#[test]
fn effects_operation_sets_removes_and_checks_the_group() {
    let patch = |effects: Value| json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[{"kind":"setCameraEffects","entityId":"camera_main","effects":effects}]});
    assert!(validate_value::<ScenePatch>(&patch(defaults())).is_ok());
    assert!(validate_value::<ScenePatch>(&patch(Value::Null)).is_ok());
    assert!(
        validate_value::<ScenePatch>(&patch(json!({"blur":{"enabled":true,"intensity":5}})))
            .is_err()
    );
    let mut missing = patch(Value::Null);
    missing["operations"][0]
        .as_object_mut()
        .unwrap()
        .remove("effects");
    assert!(validate_value::<ScenePatch>(&missing).is_err());
}
