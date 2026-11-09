use opensekai_contracts::{
    is_web_screen_url, validate_value, ScenePatch, SceneView, MAX_SCREENS, MAX_WEB_SCREENS,
};
use serde_json::{json, Value};
fn scene(extra: Vec<Value>) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let mut entities = vec![camera];
    entities.extend(extra);
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":entities,"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn web(id: &str, url: Value, width: u32, height: u32) -> Value {
    json!({"id":id,"name":"Screen","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"screen","content":{"kind":"web","url":url,"width":width,"height":height,"onTop":false}})
}
fn image(id: &str) -> Value {
    json!({"id":id,"name":"Screen","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"screen","content":{"kind":"image","assetId":null}})
}
// B30 R2: the same vectors as packages/contracts/test/web-screen.test.ts.
#[test]
fn web_urls_match_the_shared_vectors() {
    let vectors: Value =
        serde_json::from_str(include_str!("../../../fixtures/protocol/web-urls.json")).unwrap();
    for vector in vectors["valid"].as_array().unwrap() {
        assert!(
            is_web_screen_url(vector["url"].as_str().unwrap()),
            "{} failed",
            vector["name"]
        );
    }
    for vector in vectors["invalid"].as_array().unwrap() {
        assert!(
            !is_web_screen_url(vector["url"].as_str().unwrap()),
            "{} passed",
            vector["name"]
        );
    }
}
#[test]
fn web_screens_round_trip_within_the_web_limit() {
    let mut entities: Vec<_> = (0..MAX_WEB_SCREENS)
        .map(|i| {
            web(
                &format!("w{i}"),
                json!("https://example.com/a?b#c"),
                1280,
                720,
            )
        })
        .collect();
    entities[0]["content"]["url"] = Value::Null;
    entities[1]["content"]["onTop"] = json!(true);
    let value = scene(entities.clone());
    let parsed = validate_value::<SceneView>(&value).unwrap();
    let written = serde_json::to_value(&parsed).unwrap();
    for i in 1..=MAX_WEB_SCREENS {
        assert_eq!(
            written["entities"][i]["content"],
            value["entities"][i]["content"]
        );
    }
    assert_eq!(validate_value::<SceneView>(&written).unwrap(), parsed);
    let mut over = entities.clone();
    over.push(web("w_over", Value::Null, 1280, 720));
    assert!(validate_value::<SceneView>(&scene(over)).is_err());
    let mut images = entities;
    images.extend((MAX_WEB_SCREENS..MAX_SCREENS).map(|i| image(&format!("s{i}"))));
    assert!(validate_value::<SceneView>(&scene(images)).is_ok());
}
#[test]
fn web_screen_size_and_url_follow_the_rule() {
    for (url, width, height, ok) in [
        (json!("https://example.com/"), 64, 64, true),
        (json!("https://example.com/"), 3840, 2160, true),
        (json!("https://example.com/"), 63, 720, false),
        (json!("https://example.com/"), 3841, 720, false),
        (json!("https://example.com/"), 1280, 63, false),
        (json!("https://example.com/"), 1280, 2161, false),
        (json!("http://example.com/"), 1280, 720, false),
        (json!("https://127.0.0.1/"), 1280, 720, false),
    ] {
        assert_eq!(
            validate_value::<SceneView>(&scene(vec![web("w", url.clone(), width, height)])).is_ok(),
            ok,
            "{url} {width} {height}"
        );
    }
    let mut extra = web("w", Value::Null, 1280, 720);
    extra["content"]["css"] = json!("body{}");
    assert!(validate_value::<SceneView>(&scene(vec![extra])).is_err());
}
#[test]
fn set_screen_web_parses_and_checks_the_url() {
    let ok = json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[
        {"kind":"setScreenWeb","entityId":"w","web":{"url":"https://example.com/","width":1280,"height":720,"onTop":true}},
        {"kind":"setScreenWeb","entityId":"w","web":{"url":null,"width":1280,"height":720,"onTop":false}}]});
    assert!(validate_value::<ScenePatch>(&ok).is_ok());
    let local = json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[
        {"kind":"setScreenWeb","entityId":"w","web":{"url":"https://localhost/","width":1280,"height":720,"onTop":true}}]});
    assert!(validate_value::<ScenePatch>(&local).is_err());
    let missing = json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[
        {"kind":"setScreenWeb","entityId":"w","web":{"url":null,"width":1280,"height":720}}]});
    assert!(validate_value::<ScenePatch>(&missing).is_err());
}
