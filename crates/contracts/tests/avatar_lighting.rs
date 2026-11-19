use opensekai_contracts::{validate_value, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene() -> Value {
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":[{"id":"performer","name":"Performer","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"avatar","assetId":null}],"outputs":[]})
}
fn lighting() -> Value {
    json!({"rimStrength":1.5,"rimWidth":0.5,"rimTint":"#ffeedd","shadowStrength":0.6,"environmentFill":0.8})
}
#[test]
fn avatar_lighting_is_optional_and_round_trips() {
    let plain = validate_value::<SceneView>(&scene()).unwrap();
    assert!(!serde_json::to_string(&plain).unwrap().contains("lighting"));
    let mut lit = scene();
    lit["entities"][0]["lighting"] = lighting();
    let parsed = validate_value::<SceneView>(&lit).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["entities"][0]["lighting"],
        lighting()
    );
}
#[test]
fn avatar_lighting_accepts_each_range_edge() {
    for (field, value) in [
        ("rimStrength", json!(0)),
        ("rimStrength", json!(2)),
        ("rimWidth", json!(0)),
        ("rimWidth", json!(1)),
        ("shadowStrength", json!(0)),
        ("shadowStrength", json!(1)),
        ("environmentFill", json!(0)),
        ("environmentFill", json!(2)),
    ] {
        let mut edge = scene();
        edge["entities"][0]["lighting"] = lighting();
        edge["entities"][0]["lighting"][field] = value.clone();
        assert!(
            validate_value::<SceneView>(&edge).is_ok(),
            "{field} {value}"
        );
    }
}
#[test]
fn avatar_lighting_checks_each_range_and_field() {
    let cases: [(&str, Value); 10] = [
        ("rimStrength", json!(2.01)),
        ("rimStrength", json!(-0.01)),
        ("rimWidth", json!(-0.01)),
        ("rimWidth", json!(1.01)),
        ("shadowStrength", json!(1.01)),
        ("shadowStrength", json!(-0.01)),
        ("environmentFill", json!(2.01)),
        ("environmentFill", json!(-0.01)),
        ("rimTint", json!("red")),
        ("rimTint", json!("#FFEEDD")),
    ];
    for (field, value) in cases {
        let mut bad = scene();
        bad["entities"][0]["lighting"] = lighting();
        bad["entities"][0]["lighting"][field] = value.clone();
        assert!(
            validate_value::<SceneView>(&bad).is_err(),
            "{field} {value}"
        );
    }
    let mut missing = scene();
    missing["entities"][0]["lighting"] = lighting();
    missing["entities"][0]["lighting"]
        .as_object_mut()
        .unwrap()
        .remove("rimTint");
    assert!(validate_value::<SceneView>(&missing).is_err());
    let mut unknown = scene();
    unknown["entities"][0]["lighting"] = lighting();
    unknown["entities"][0]["lighting"]["extra"] = json!(1);
    assert!(validate_value::<SceneView>(&unknown).is_err());
}
#[test]
fn lighting_operation_sets_removes_and_checks_the_group() {
    let patch = |lighting: Value| json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[{"kind":"setAvatarLighting","entityId":"performer","lighting":lighting}]});
    assert!(validate_value::<ScenePatch>(&patch(lighting())).is_ok());
    assert!(validate_value::<ScenePatch>(&patch(Value::Null)).is_ok());
    let mut bad = lighting();
    bad["rimStrength"] = json!(2.01);
    assert!(validate_value::<ScenePatch>(&patch(bad)).is_err());
    let mut extra = lighting();
    extra["extra"] = json!(1);
    assert!(validate_value::<ScenePatch>(&patch(extra)).is_err());
}
