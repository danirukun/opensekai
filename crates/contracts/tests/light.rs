use opensekai_contracts::{validate_value, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene(extra: Vec<Value>) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let mut entities = vec![camera];
    entities.extend(extra);
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":entities,"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn settings() -> Value {
    json!({"type":"directional","color":"#ffffff","intensity":3,"range":0,"affectCharacters":true,"affectProps":true,"affectEnvironment":true,"shadow":{"enabled":false,"intensity":1,"soft":true,"bias":-0.0005,"normalBias":0.02}})
}
fn light(id: &str, shadow: bool) -> Value {
    let mut light = settings();
    light["shadow"]["enabled"] = json!(shadow);
    json!({"id":id,"name":"Light","visible":true,"transform":{"position":[2,4,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"light","light":light})
}
fn with(change: impl Fn(&mut Value)) -> Value {
    let mut entity = light("key", false);
    change(&mut entity["light"]);
    scene(vec![entity])
}
#[test]
fn light_round_trips_with_the_same_shape() {
    let value = scene(vec![light("key", true)]);
    let parsed = validate_value::<SceneView>(&value).unwrap();
    let written = serde_json::to_value(&parsed).unwrap();
    let keys = |v: &Value| v.as_object().unwrap().keys().cloned().collect::<Vec<_>>();
    assert_eq!(keys(&written["entities"][1]), keys(&value["entities"][1]));
    assert_eq!(
        keys(&written["entities"][1]["light"]),
        keys(&value["entities"][1]["light"])
    );
    assert_eq!(
        keys(&written["entities"][1]["light"]["shadow"]),
        keys(&value["entities"][1]["light"]["shadow"])
    );
    assert_eq!(validate_value::<SceneView>(&written).unwrap(), parsed);
    let point = with(|l| {
        l["type"] = json!("point");
        l["range"] = json!(10);
    });
    assert!(validate_value::<SceneView>(&point).is_ok());
}
#[test]
fn light_fields_use_the_zod_ranges() {
    for (name, change) in [
        ("uppercase color", json!({"color":"#FFFFFF"})),
        ("short color", json!({"color":"#fff"})),
        ("named color", json!({"color":"red"})),
        ("intensity", json!({"intensity":1000.5})),
        ("negative intensity", json!({"intensity":-1})),
        ("range", json!({"range":1001})),
        ("type", json!({"type":"spot"})),
    ] {
        let value = with(|l| {
            for (key, field) in change.as_object().unwrap() {
                l[key] = field.clone();
            }
        });
        assert!(validate_value::<SceneView>(&value).is_err(), "{name}");
    }
    for (key, field) in [
        ("bias", json!(0.02)),
        ("intensity", json!(1.5)),
        ("normalBias", json!(-0.1)),
    ] {
        let value = with(|l| l["shadow"][key] = field.clone());
        assert!(validate_value::<SceneView>(&value).is_err(), "shadow {key}");
    }
    let extra = with(|l| l["cookie"] = json!(true));
    assert!(validate_value::<SceneView>(&extra).is_err());
}
#[test]
fn light_budget_counts_hidden_lights() {
    let eight: Vec<_> = (0..8).map(|i| light(&format!("l{i}"), i < 2)).collect();
    assert!(validate_value::<SceneView>(&scene(eight)).is_ok());
    let nine: Vec<_> = (0..9).map(|i| light(&format!("l{i}"), false)).collect();
    assert!(validate_value::<SceneView>(&scene(nine)).is_err());
    let mut three: Vec<_> = (0..3).map(|i| light(&format!("l{i}"), true)).collect();
    three[2]["visible"] = json!(false);
    assert!(validate_value::<SceneView>(&scene(three)).is_err());
}
#[test]
fn environment_reflections_are_optional_and_bounded() {
    let environment = |extra: Value| {
        let mut e = json!({"id":"stage","name":"Environment","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"environment","assetId":null});
        for (k, v) in extra.as_object().unwrap() {
            e[k] = v.clone();
        }
        scene(vec![e])
    };
    let plain = validate_value::<SceneView>(&environment(json!({}))).unwrap();
    assert!(!serde_json::to_string(&plain)
        .unwrap()
        .contains("reflectionsIntensity"));
    assert!(validate_value::<SceneView>(&environment(json!({"reflectionsIntensity":1.5}))).is_ok());
    assert!(
        validate_value::<SceneView>(&environment(json!({"reflectionsIntensity":2.5}))).is_err()
    );
}
#[test]
fn light_operations_parse_and_validate() {
    let patch = |op: Value| json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[op]});
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setLight","entityId":"key","light":settings()})
    ))
    .is_ok());
    let mut bad = settings();
    bad["color"] = json!("#GGGGGG");
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setLight","entityId":"key","light":bad})
    ))
    .is_err());
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setEnvironmentReflections","entityId":"stage","reflectionsIntensity":0.5})
    ))
    .is_ok());
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setEnvironmentReflections","entityId":"stage","reflectionsIntensity":-0.5})
    ))
    .is_err());
    let mut created = light("key", false);
    created["light"]["intensity"] = json!(2000);
    assert!(
        validate_value::<ScenePatch>(&patch(json!({"kind":"createEntity","entity":created})))
            .is_err()
    );
}
