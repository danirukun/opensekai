use opensekai_contracts::{validate_call, validate_result};
use serde_json::{json, Value};

fn scene() -> Value {
    json!({
        "schemaVersion": 1,
        "sceneId": "scene_loaded",
        "revision": 7,
        "entities": [
            {
                "kind": "camera", "id": "camera_a", "name": "Camera", "visible": true,
                "transform": {"position": [0, 1, 3], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1]},
                "lens": {"fovDegrees": 50, "near": 0.1, "far": 100}
            },
            {
                "kind": "avatar", "id": "avatar_a", "name": "Missing avatar", "visible": true,
                "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1]},
                "assetId": "asset_not_installed"
            }
        ],
        "outputs": [
            {"id": "output_main", "cameraId": "camera_a", "width": 1920, "height": 1080, "fps": 60},
            {"id": "preview_main", "cameraId": "camera_a", "width": 1920, "height": 1080, "fps": 60}
        ]
    })
}

#[test]
fn replace_accepts_valid_show_scene_with_missing_asset_reference() {
    let params = json!({"scene": scene(), "expectedRevision": 3});
    assert!(validate_call("sceneReplace", &params).is_ok());
    assert!(validate_result("sceneReplace", &json!({"ok": true, "data": scene()})).is_ok());
}

#[test]
fn replace_requires_both_outputs_and_valid_references() {
    let mut without_preview = scene();
    without_preview["outputs"].as_array_mut().unwrap().pop();
    assert!(validate_call(
        "sceneReplace",
        &json!({"scene": without_preview, "expectedRevision": 3})
    )
    .is_err());

    let mut invalid_camera = scene();
    invalid_camera["outputs"][0]["cameraId"] = json!("missing_camera");
    assert!(validate_call(
        "sceneReplace",
        &json!({"scene": invalid_camera, "expectedRevision": 3})
    )
    .is_err());
    assert!(validate_result("sceneReplace", &json!({"ok": true, "data": invalid_camera})).is_err());
}

#[test]
fn replace_rejects_unknown_fields_and_invalid_revision() {
    assert!(validate_call(
        "sceneReplace",
        &json!({"scene": scene(), "expectedRevision": -1})
    )
    .is_err());
    assert!(validate_call(
        "sceneReplace",
        &json!({"scene": scene(), "expectedRevision": 1, "extra": true})
    )
    .is_err());
    assert!(validate_call(
        "sceneReplace",
        &json!({"scene": scene(), "expectedRevision": 9_007_199_254_740_992_u64})
    )
    .is_err());
}
