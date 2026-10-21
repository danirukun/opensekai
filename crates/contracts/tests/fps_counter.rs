use opensekai_contracts::{validate_value, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene(extra: Vec<Value>) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let mut entities = vec![camera];
    entities.extend(extra);
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":entities,"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn settings() -> Value {
    json!({"corner":"topRight","size":32,"color":"#ffffff"})
}
fn counter(id: &str) -> Value {
    json!({"id":id,"name":"FPS Counter","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"fpsCounter","fpsCounter":settings()})
}
fn accepts(entity: Value) -> bool {
    validate_value::<SceneView>(&scene(vec![entity])).is_ok()
}
fn patch(op: Value) -> Value {
    json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[op]})
}
#[test]
fn fps_counter_fields_use_the_zod_ranges() {
    assert!(accepts(counter("fps")));
    for corner in ["topLeft", "topRight", "bottomLeft", "bottomRight"] {
        let mut entity = counter("fps");
        entity["fpsCounter"]["corner"] = json!(corner);
        assert!(accepts(entity), "{corner}");
    }
    for size in [8, 128] {
        let mut entity = counter("fps");
        entity["fpsCounter"]["size"] = json!(size);
        assert!(accepts(entity), "{size}");
    }
    for (name, key, value) in [
        ("size below 8", "size", json!(7)),
        ("size above 128", "size", json!(129)),
        ("size not an integer", "size", json!(32.5)),
        ("bad corner", "corner", json!("center")),
        ("upper case color", "color", json!("#FFFFFF")),
        ("short color", "color", json!("#fff")),
    ] {
        let mut entity = counter("fps");
        entity["fpsCounter"][key] = value;
        assert!(!accepts(entity), "{name}");
    }
    let mut extra = counter("fps");
    extra["fpsCounter"]["position"] = json!("top");
    assert!(!accepts(extra));
    let mut missing = counter("fps");
    missing["fpsCounter"]
        .as_object_mut()
        .unwrap()
        .remove("color");
    assert!(!accepts(missing));
}
#[test]
fn fps_counter_budget_allows_one() {
    let mut hidden = counter("fps_b");
    hidden["visible"] = json!(false);
    assert!(validate_value::<SceneView>(&scene(vec![counter("fps_a"), hidden])).is_err());
}
#[test]
fn fps_counter_round_trips() {
    let value = scene(vec![counter("fps")]);
    let parsed = validate_value::<SceneView>(&value).unwrap();
    let written = serde_json::to_value(&parsed).unwrap();
    assert_eq!(validate_value::<SceneView>(&written).unwrap(), parsed);
    assert_eq!(written["entities"][1]["kind"], "fpsCounter");
    assert_eq!(written["entities"][1]["fpsCounter"], settings());
}
#[test]
fn set_fps_counter_parses_and_validates() {
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setFpsCounter","entityId":"fps","fpsCounter":settings()})
    ))
    .is_ok());
    let mut bad = settings();
    bad["size"] = json!(200);
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setFpsCounter","entityId":"fps","fpsCounter":bad})
    ))
    .is_err());
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setFpsCounter","entityId":"fps","fpsCounter":settings(),"extra":true})
    ))
    .is_err());
    let mut created = counter("fps");
    created["fpsCounter"]["color"] = json!("white");
    assert!(
        validate_value::<ScenePatch>(&patch(json!({"kind":"createEntity","entity":created})))
            .is_err()
    );
}
