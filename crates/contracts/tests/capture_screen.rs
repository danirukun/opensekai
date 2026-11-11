use opensekai_contracts::{
    normalize_capture_text, parse_wire, validate_value, AppStatus, CaptureSource, ScenePatch,
    SceneView, Validate, MAX_CAPTURE_SCREENS,
};
use serde_json::{json, Value};
fn scene(extra: Vec<Value>) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let mut entities = vec![camera];
    entities.extend(extra);
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":entities,"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn capture(id: &str, target: &str, source: Value) -> Value {
    json!({"id":id,"name":"Screen","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"screen","content":{"kind":"capture","target":target,"source":source,"cursor":true}})
}
fn display() -> Value {
    json!({"kind":"display","name":"Built-in Retina Display","ordinal":0})
}
fn vectors() -> Value {
    serde_json::from_str(include_str!(
        "../../../fixtures/protocol/capture-sources.json"
    ))
    .unwrap()
}
// B31 R2: the same vectors as packages/contracts/test/capture-screen.test.ts.
#[test]
fn capture_text_matches_the_shared_vectors() {
    for v in vectors()["normalize"].as_array().unwrap() {
        assert_eq!(
            normalize_capture_text(
                v["input"].as_str().unwrap(),
                v["max"].as_u64().unwrap() as usize
            ),
            v["output"].as_str().unwrap(),
            "{}",
            v["name"]
        );
    }
}
#[test]
fn capture_sources_match_the_shared_vectors() {
    let check = |source: &Value| {
        serde_json::from_value::<CaptureSource>(source.clone())
            .ok()
            .is_some_and(|s| s.validate().is_ok())
    };
    for v in vectors()["valid"].as_array().unwrap() {
        assert!(check(&v["source"]), "{} failed", v["name"]);
    }
    for v in vectors()["invalid"].as_array().unwrap() {
        assert!(!check(&v["source"]), "{} passed", v["name"]);
    }
}
#[test]
fn capture_screens_round_trip_within_the_capture_limit() {
    let entities = vec![
        capture("c0", "display", display()),
        capture("c1", "window", Value::Null),
    ];
    let value = scene(entities.clone());
    let parsed = validate_value::<SceneView>(&value).unwrap();
    let written = serde_json::to_value(&parsed).unwrap();
    assert_eq!(
        written["entities"][1]["content"],
        value["entities"][1]["content"]
    );
    assert_eq!(
        written["entities"][2]["content"],
        value["entities"][2]["content"]
    );
    assert_eq!(MAX_CAPTURE_SCREENS, 2);
    let mut over = entities;
    over.push(capture("c2", "display", Value::Null));
    assert!(validate_value::<SceneView>(&scene(over)).is_err());
}
#[test]
fn a_source_kind_must_match_the_target() {
    assert!(validate_value::<SceneView>(&scene(vec![capture("c", "window", display())])).is_err());
    let patch = |capture: Value| json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[{"kind":"setScreenCapture","entityId":"c","capture":capture}]});
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"target":"display","source":display(),"cursor":false})
    ))
    .is_ok());
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"target":"window","source":display(),"cursor":false})
    ))
    .is_err());
    assert!(
        validate_value::<ScenePatch>(&patch(json!({"target":"window","source":null}))).is_err()
    );
    assert!(validate_value::<ScenePatch>(&patch(
        json!({"target":"window","source":null,"cursor":true,"audio":true})
    ))
    .is_err());
}
#[test]
fn capture_status_wire_message_checks_its_limits() {
    let entry = |id: &str, stream: Value, state: &str| json!({"entityId":id,"streamId":stream,"state":state,"width":1920,"height":1080});
    let message = |screens: Vec<Value>| {
        json!({"kind":"captureStatus","revision":3,"screens":screens})
            .to_string()
            .into_bytes()
    };
    let stream = json!("a".repeat(32));
    assert!(parse_wire(&message(vec![])).is_ok());
    assert!(parse_wire(&message(vec![
        entry("a", stream.clone(), "live"),
        entry("b", stream.clone(), "live")
    ]))
    .is_ok());
    assert!(parse_wire(&message(vec![
        entry("a", stream.clone(), "live"),
        entry("b", stream.clone(), "live"),
        entry("c", stream.clone(), "live")
    ]))
    .is_err());
    assert!(parse_wire(&message(vec![
        entry("a", Value::Null, "notAllowed"),
        entry("a", Value::Null, "notAllowed")
    ]))
    .is_err());
    assert!(parse_wire(&message(vec![entry("a", json!("A".repeat(32)), "live")])).is_err());
    assert!(parse_wire(&message(vec![entry("a", Value::Null, "stopped")])).is_err());
}
#[test]
fn app_status_captures_have_no_names() {
    let base = json!({"schemaVersion":1,"sessionId":"s","ready":true,"revision":1,"capabilities":[],"warnings":[],"outputs":[{"outputId":"output_main","connected":true,"lastFrame":null,"videoDecoder":"missing"}],"captures":[{"entityId":"c","state":"notAllowed"}]});
    assert!(validate_value::<AppStatus>(&base).is_ok());
    let mut titled = base.clone();
    titled["captures"][0]["title"] = json!("Chat");
    assert!(validate_value::<AppStatus>(&titled).is_err());
}
