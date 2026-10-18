use opensekai_contracts::{validate_value, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene(extra: Vec<Value>) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let mut entities = vec![camera];
    entities.extend(extra);
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":entities,"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn settings(change: impl Fn(&mut Value)) -> Value {
    let mut light = json!({"type":"spot","color":"#ffffff","intensity":60,"range":15,"affectCharacters":true,"affectProps":true,"affectEnvironment":true,"shadow":{"enabled":false,"intensity":1,"soft":true,"bias":-0.0005,"normalBias":0.02},"cone":{"angleDegrees":40,"penumbra":0.3},"volumetric":true});
    change(&mut light);
    light
}
fn light(id: &str, light: Value) -> Value {
    json!({"id":id,"name":"Light","visible":true,"transform":{"position":[0,3,2],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"light","light":light})
}
fn haze_settings() -> Value {
    json!({"density":1,"smoke":1,"intensity":1,"drift":0.2})
}
fn haze(id: &str) -> Value {
    json!({"id":id,"name":"Haze","visible":true,"transform":{"position":[0,4,0],"rotation":[0,0,0,1],"scale":[20,8,20]},"kind":"haze","haze":haze_settings()})
}
fn accepts(light_settings: Value) -> bool {
    validate_value::<SceneView>(&scene(vec![light("key", light_settings)])).is_ok()
}
fn patch(op: Value) -> Value {
    json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[op]})
}
#[test]
fn spot_light_needs_a_cone_within_the_zod_ranges() {
    assert!(accepts(settings(|_| {})));
    assert!(!accepts(settings(|l| {
        l.as_object_mut().unwrap().remove("cone");
    })));
    for (name, cone) in [
        ("angle below 1", json!({"angleDegrees":0.5,"penumbra":0.3})),
        (
            "angle above 170",
            json!({"angleDegrees":171,"penumbra":0.3}),
        ),
        (
            "negative penumbra",
            json!({"angleDegrees":40,"penumbra":-0.1}),
        ),
        (
            "penumbra above 1",
            json!({"angleDegrees":40,"penumbra":1.1}),
        ),
        ("missing penumbra", json!({"angleDegrees":40})),
        (
            "extra field",
            json!({"angleDegrees":40,"penumbra":0.3,"cookie":true}),
        ),
        ("null cone", Value::Null),
    ] {
        assert!(!accepts(settings(|l| l["cone"] = cone.clone())), "{name}");
    }
    // A cone on another type is ignored, but its ranges still apply.
    assert!(accepts(settings(|l| l["type"] = json!("point"))));
    assert!(!accepts(settings(|l| {
        l["type"] = json!("point");
        l["cone"]["angleDegrees"] = json!(171);
    })));
}
#[test]
fn ambient_light_has_no_shadow() {
    let ambient = |shadow: bool| {
        settings(|l| {
            let o = l.as_object_mut().unwrap();
            o.remove("cone");
            o.remove("volumetric");
            l["type"] = json!("ambient");
            l["shadow"]["enabled"] = json!(shadow);
        })
    };
    assert!(accepts(ambient(false)));
    assert!(!accepts(ambient(true)));
}
#[test]
fn only_point_and_spot_lights_are_volumetric() {
    let typed = |kind: &str, volumetric: bool| {
        settings(|l| {
            l.as_object_mut().unwrap().remove("cone");
            l["type"] = json!(kind);
            l["volumetric"] = json!(volumetric);
        })
    };
    assert!(accepts(typed("point", true)));
    assert!(!accepts(typed("directional", true)));
    assert!(!accepts(typed("ambient", true)));
    // False is the same as a missing field, for every type.
    assert!(accepts(typed("directional", false)));
    assert!(accepts(typed("ambient", false)));
}
fn keys(v: &Value) -> Vec<String> {
    v.as_object().unwrap().keys().cloned().collect()
}
// Serialize, then parse again: the keys and the values stay the same.
fn round_trip(value: &Value) -> Value {
    let parsed = validate_value::<SceneView>(value).unwrap();
    let written = serde_json::to_value(&parsed).unwrap();
    assert_eq!(validate_value::<SceneView>(&written).unwrap(), parsed);
    assert_eq!(keys(&written["entities"][1]), keys(&value["entities"][1]));
    written
}
#[test]
fn stage_lights_round_trip_and_omit_absent_fields() {
    let spot = scene(vec![light("key", settings(|_| {}))]);
    let written = round_trip(&spot);
    let light_keys = keys(&written["entities"][1]["light"]);
    assert_eq!(light_keys, keys(&spot["entities"][1]["light"]));
    assert!(light_keys.contains(&"cone".into()) && light_keys.contains(&"volumetric".into()));
    assert_eq!(
        keys(&written["entities"][1]["light"]["cone"]),
        ["angleDegrees", "penumbra"]
    );
    let plain = scene(vec![light(
        "key",
        settings(|l| {
            let o = l.as_object_mut().unwrap();
            o.remove("cone");
            o.remove("volumetric");
            l["type"] = json!("directional");
        }),
    )]);
    let written = round_trip(&plain);
    let light_keys = keys(&written["entities"][1]["light"]);
    assert_eq!(light_keys, keys(&plain["entities"][1]["light"]));
    assert!(!light_keys.contains(&"cone".into()) && !light_keys.contains(&"volumetric".into()));
    let with_haze = scene(vec![haze("fog")]);
    let written = round_trip(&with_haze);
    assert_eq!(
        keys(&written["entities"][1]["haze"]),
        keys(&with_haze["entities"][1]["haze"])
    );
}
#[test]
fn haze_fields_use_the_zod_ranges() {
    assert!(validate_value::<SceneView>(&scene(vec![haze("fog")])).is_ok());
    for (key, value) in [
        ("density", json!(2.1)),
        ("density", json!(-0.1)),
        ("smoke", json!(3.1)),
        ("intensity", json!(4.1)),
        ("drift", json!(2.1)),
    ] {
        let mut entity = haze("fog");
        entity["haze"][key] = value;
        assert!(
            validate_value::<SceneView>(&scene(vec![entity])).is_err(),
            "{key}"
        );
    }
    let mut extra = haze("fog");
    extra["haze"]["color"] = json!("#ffffff");
    assert!(validate_value::<SceneView>(&scene(vec![extra])).is_err());
    let mut missing = haze("fog");
    missing["haze"].as_object_mut().unwrap().remove("drift");
    assert!(validate_value::<SceneView>(&scene(vec![missing])).is_err());
    let mut flat = haze("fog");
    flat["transform"]["scale"] = json!([20, 0, 20]);
    assert!(validate_value::<SceneView>(&scene(vec![flat])).is_err());
}
#[test]
fn haze_budget_allows_one_and_does_not_count_as_a_light() {
    let mut hidden = haze("fog_b");
    hidden["visible"] = json!(false);
    assert!(validate_value::<SceneView>(&scene(vec![haze("fog_a"), hidden])).is_err());
    let mut entities: Vec<_> = (0..8)
        .map(|i| light(&format!("l{i}"), settings(|_| {})))
        .collect();
    entities.push(haze("fog"));
    assert!(validate_value::<SceneView>(&scene(entities)).is_ok());
}
#[test]
fn set_haze_parses_and_validates() {
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setHaze","entityId":"fog","haze":haze_settings()})
    ))
    .is_ok());
    let mut bad = haze_settings();
    bad["intensity"] = json!(5);
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setHaze","entityId":"fog","haze":bad})
    ))
    .is_err());
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setHaze","entityId":"fog","haze":haze_settings(),"extra":true})
    ))
    .is_err());
    let mut created = haze("fog");
    created["haze"]["smoke"] = json!(4);
    assert!(
        validate_value::<ScenePatch>(&patch(json!({"kind":"createEntity","entity":created})))
            .is_err()
    );
    let spot_without_cone = settings(|l| {
        l.as_object_mut().unwrap().remove("cone");
    });
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"kind":"setLight","entityId":"key","light":spot_without_cone})
    ))
    .is_err());
}
