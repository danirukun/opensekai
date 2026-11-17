use opensekai_contracts::{
    light_budget_error, validate_call, validate_value, ErrorCode, LightSettings, SceneView,
    LIGHT_BUDGET_LIGHTS_MESSAGE, LIGHT_BUDGET_LIT_MESSAGE, LIGHT_BUDGET_SHADOW_MESSAGE, MAX_LIGHTS,
    MAX_LIT_LIGHTS,
};
use serde_json::{json, Value};

fn settings(lit: bool, shadow: bool) -> Value {
    json!({"type":"point","color":"#ffffff","intensity":3,"range":10,"affectCharacters":lit,"affectProps":lit,"affectEnvironment":lit,"shadow":{"enabled":shadow,"intensity":1,"soft":true,"bias":-0.0005,"normalBias":0.02}})
}
fn light(id: String, lit: bool, shadow: bool, visible: bool) -> Value {
    json!({"id":id,"name":"Light","visible":visible,"transform":{"position":[0,3,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"light","light":settings(lit,shadow)})
}
fn lights(prefix: &str, count: usize, lit: bool) -> Vec<Value> {
    (0..count)
        .map(|i| light(format!("{prefix}_{i}"), lit, false, true))
        .collect()
}
fn scene(lights: Vec<Value>) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let mut entities = vec![camera];
    entities.extend(lights);
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":entities,"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60},{"id":"preview_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn message(lights: Vec<Value>) -> Option<String> {
    validate_value::<SceneView>(&scene(lights))
        .err()
        .map(|error| {
            assert_eq!(error.code, ErrorCode::InvalidInput);
            error.message
        })
}

#[test]
fn a_light_is_lit_when_one_affect_flag_is_on() {
    let unlit: LightSettings = serde_json::from_value(settings(false, true)).unwrap();
    assert!(!unlit.is_lit());
    for flag in ["affectCharacters", "affectProps", "affectEnvironment"] {
        let mut value = settings(false, false);
        value[flag] = json!(true);
        let light: LightSettings = serde_json::from_value(value).unwrap();
        assert!(light.is_lit(), "{flag}");
    }
    assert_eq!((MAX_LIGHTS, MAX_LIT_LIGHTS), (32, 8));
}

#[test]
fn scene_validation_uses_the_light_budget_messages_in_order() {
    let mut valid = [lights("lit", 8, true), lights("unlit", 24, false)].concat();
    valid[0] = light("lit_0".into(), true, true, true);
    valid[8] = light("unlit_0".into(), false, true, true);
    valid[1] = light("lit_1".into(), true, false, false);
    valid[9] = light("unlit_1".into(), false, false, false);
    assert_eq!(message(valid), None);

    let mut nine = [lights("lit", 8, true), lights("unlit", 23, false)].concat();
    nine.push(light("hidden".into(), true, false, false));
    assert_eq!(message(nine).as_deref(), Some(LIGHT_BUDGET_LIT_MESSAGE));
    assert_eq!(
        message([lights("lit", 8, true), lights("unlit", 25, false)].concat()).as_deref(),
        Some(LIGHT_BUDGET_LIGHTS_MESSAGE)
    );
    let shadows = (0..3)
        .map(|i| light(format!("s{i}"), false, true, true))
        .collect::<Vec<_>>();
    assert_eq!(
        message(shadows.clone()).as_deref(),
        Some(LIGHT_BUDGET_SHADOW_MESSAGE)
    );

    let lit_shadows = (0..3)
        .map(|i| light(format!("s{i}"), true, true, true))
        .collect::<Vec<_>>();
    let all = [
        lit_shadows.clone(),
        lights("lit", 6, true),
        lights("unlit", 24, false),
    ]
    .concat();
    assert_eq!(message(all).as_deref(), Some(LIGHT_BUDGET_LIGHTS_MESSAGE));
    let nine_lit = [lit_shadows, lights("lit", 6, true)].concat();
    assert_eq!(message(nine_lit).as_deref(), Some(LIGHT_BUDGET_LIT_MESSAGE));

    let parsed: Vec<LightSettings> = shadows
        .iter()
        .map(|e| serde_json::from_value(e["light"].clone()).unwrap())
        .collect();
    assert_eq!(
        light_budget_error(parsed.iter()),
        Some(LIGHT_BUDGET_SHADOW_MESSAGE)
    );
    assert_eq!(
        LIGHT_BUDGET_LIT_MESSAGE,
        "Scene has the maximum of 8 lit lights"
    );
    assert_eq!(
        LIGHT_BUDGET_LIGHTS_MESSAGE,
        "Scene has the maximum of 32 lights"
    );
    assert_eq!(
        LIGHT_BUDGET_SHADOW_MESSAGE,
        "Scene has the maximum of 2 shadow lights"
    );
}

#[test]
fn scene_replace_gives_the_lit_light_message() {
    let params = json!({"scene": scene(lights("lit", 9, true)), "expectedRevision": 0});
    let error = validate_call("sceneReplace", &params).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidInput);
    assert_eq!(error.message, LIGHT_BUDGET_LIT_MESSAGE);
    let valid = json!({"scene": scene([lights("lit", 8, true), lights("unlit", 24, false)].concat()), "expectedRevision": 0});
    assert!(validate_call("sceneReplace", &valid).is_ok());
}
