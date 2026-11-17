use opensekai_contracts::{validate_value, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene(light_settings: Value) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let light = json!({"id":"key","name":"Light","visible":true,"transform":{"position":[0,3,2],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"light","light":light_settings});
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":[camera,light],"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn spot(change: impl Fn(&mut Value)) -> Value {
    let mut light = json!({"type":"spot","color":"#ffffff","intensity":60,"range":15,"affectCharacters":true,"affectProps":true,"affectEnvironment":true,"shadow":{"enabled":false,"intensity":1,"soft":true,"bias":-0.0005,"normalBias":0.02},"cone":{"angleDegrees":40,"penumbra":0.3}});
    change(&mut light);
    light
}
fn beam() -> Value {
    json!({"enabled":true,"intensity":1,"softness":0.5})
}
fn point(enabled: bool) -> Value {
    spot(|l| {
        l.as_object_mut().unwrap().remove("cone");
        l["type"] = json!("point");
        l["beam"] = beam();
        l["beam"]["enabled"] = json!(enabled);
    })
}
fn accepts(light_settings: Value) -> bool {
    validate_value::<SceneView>(&scene(light_settings)).is_ok()
}
#[test]
fn beam_group_uses_the_zod_rules() {
    assert!(accepts(spot(|l| l["beam"] = beam())));
    assert!(accepts(spot(|l| {
        l["beam"] = beam();
        l["beam"]["enabled"] = json!(false);
    })));
    assert!(accepts(spot(
        |l| l["beam"] = json!({"enabled":true,"intensity":4,"softness":1})
    )));
    assert!(accepts(spot(
        |l| l["beam"] = json!({"enabled":true,"intensity":0,"softness":0})
    )));
    assert!(accepts(spot(|_| {})));
    assert!(accepts(point(false)));
    assert!(!accepts(point(true)));
    for (name, group) in [
        (
            "intensity above 4",
            json!({"enabled":true,"intensity":4.01,"softness":0.5}),
        ),
        (
            "negative intensity",
            json!({"enabled":true,"intensity":-0.01,"softness":0.5}),
        ),
        (
            "negative softness",
            json!({"enabled":true,"intensity":1,"softness":-0.01}),
        ),
        (
            "softness above 1",
            json!({"enabled":true,"intensity":1,"softness":1.01}),
        ),
        ("missing field", json!({"enabled":true,"intensity":1})),
        (
            "unknown field",
            json!({"enabled":true,"intensity":1,"softness":0.5,"color":"#ffffff"}),
        ),
        ("null group", Value::Null),
    ] {
        assert!(!accepts(spot(|l| l["beam"] = group.clone())), "{name}");
    }
}
#[test]
fn a_light_without_a_beam_writes_no_beam_key() {
    let keys = |v: &Value| v.as_object().unwrap().keys().cloned().collect::<Vec<_>>();
    let plain = scene(spot(|_| {}));
    let written = serde_json::to_value(validate_value::<SceneView>(&plain).unwrap()).unwrap();
    assert_eq!(
        keys(&written["entities"][1]["light"]),
        keys(&plain["entities"][1]["light"])
    );
    assert!(written["entities"][1]["light"].get("beam").is_none());
    let lit = scene(spot(|l| l["beam"] = beam()));
    let written = serde_json::to_value(validate_value::<SceneView>(&lit).unwrap()).unwrap();
    let written = &written["entities"][1]["light"]["beam"];
    assert_eq!(keys(written), ["enabled", "intensity", "softness"]);
    assert_eq!(written["enabled"], json!(true));
    assert_eq!(written["intensity"].as_f64(), Some(1.));
    assert_eq!(written["softness"].as_f64(), Some(0.5));
}
#[test]
fn set_light_rejects_a_point_light_beam() {
    let patch = |light: Value| {
        validate_value::<ScenePatch>(
            &json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[{"kind":"setLight","entityId":"key","light":light}]}),
        )
    };
    assert!(patch(spot(|l| l["beam"] = beam())).is_ok());
    assert!(patch(point(true)).is_err());
}
