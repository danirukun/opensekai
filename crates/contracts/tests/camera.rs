use opensekai_contracts::{
    screenshot_file_name_ok, validate_call, validate_result, validate_value, SceneView,
};
use serde_json::{json, Value};

fn scene_with(navigation: Value) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/protocol/valid-scene.json");
    let mut scene: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let camera = scene["entities"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|e| e["kind"] == "camera")
        .unwrap();
    camera["navigation"] = navigation;
    scene
}

#[test]
fn camera_navigation_matches_the_typescript_rules() {
    let orbit = json!({"mode":"orbitCharacter","sensitivity":1,"targetId":"performer","pivotOffset":[0,1.3,0]});
    for ok in [
        json!({"mode":"none"}),
        json!({"mode":"freeLook","sensitivity":0.1}),
        orbit.clone(),
        json!({"mode":"orbitCharacter","sensitivity":10,"targetId":null,"pivotOffset":[0,0,0]}),
    ] {
        assert!(
            validate_value::<SceneView>(&scene_with(ok.clone())).is_ok(),
            "{ok}"
        );
    }
    for bad in [
        json!({"mode":"freeLook","sensitivity":0.09}),
        json!({"mode":"none","sensitivity":1}),
        json!({"mode":"orbitCharacter","sensitivity":1,"targetId":"missing","pivotOffset":[0,0,0]}),
        json!({"mode":"orbitCharacter","sensitivity":1,"targetId":"marker","pivotOffset":[0,0,0]}),
        json!({"mode":"orbitCharacter","sensitivity":1,"targetId":null,"pivotOffset":[0,1001,0]}),
    ] {
        assert!(
            validate_value::<SceneView>(&scene_with(bad.clone())).is_err(),
            "{bad}"
        );
    }
    let patch = json!({"sceneId":"s","expectedRevision":0,"operations":[{"kind":"setCameraNavigation","entityId":"c","navigation":orbit}]});
    assert!(validate_call("scenePatch", &patch).is_ok());
}

#[test]
fn camera_screenshot_call_and_result() {
    assert!(validate_call(
        "cameraScreenshot",
        &json!({"cameraId":"c","expectedRevision":0})
    )
    .is_ok());
    assert!(validate_call(
        "cameraScreenshot",
        &json!({"cameraId":"c","expectedRevision":0,"path":"/tmp/x.png"})
    )
    .is_err());
    let result = json!({"ok":true,"data":{"fileName":"20261017-120000-000-camera_wide.png","width":1920,"height":1080,"bytes":1,"sha256":"a".repeat(64),"cameraId":"camera_wide","revision":0}});
    assert!(validate_result("cameraScreenshot", &result).is_ok());
    for name in [
        "20261017-120000-000-camera_wide-9.png",
        "20261017-120000-000-a.png",
    ] {
        assert!(screenshot_file_name_ok(name), "{name}");
    }
    for name in [
        "../20261017-120000-000-a.png",
        "20261017-120000-000-.png",
        "20261017-120000-000-a/b.png",
        "20261017-120000-000-a.jpg",
        "2026101x-120000-000-a.png",
    ] {
        assert!(!screenshot_file_name_ok(name), "{name}");
    }
}
