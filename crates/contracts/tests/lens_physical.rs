// CAM-16 Task 2: physical Lens shape, defaults, and legacy migrate (D12).
use opensekai_contracts::{validate_call, Lens, SensorPreset, Validate};
use serde_json::{json, Value};

fn full_lens(overrides: Value) -> Value {
    let mut lens = json!({
        "focalLengthMm": 50.0,
        "fStop": 4.0,
        "focusDistance": 3.0,
        "autofocus": false,
        "sensorPreset": "fullFrame",
        "fovDegrees": 1.0,
        "near": 0.01,
        "far": 100.0
    });
    for (k, v) in overrides.as_object().unwrap() {
        lens[k] = v.clone();
    }
    lens
}

#[test]
fn legacy_three_field_lens_migrates_to_full_frame_physical() {
    let lens: Lens =
        serde_json::from_value(json!({"fovDegrees": 45.0, "near": 0.01, "far": 100.0})).unwrap();
    assert_eq!(lens.sensor_preset, SensorPreset::FullFrame);
    assert!(!lens.autofocus);
    assert_eq!(lens.f_stop, 4.0);
    assert_eq!(lens.focus_distance, 3.0);
    assert_eq!(lens.near, 0.01);
    assert_eq!(lens.far, 100.0);
    assert!(lens.focal_length_mm > 0.0);
    assert!((lens.fov_degrees - 45.0).abs() < 1e-6);
    lens.validate().unwrap();
}

#[test]
fn full_lens_recomputes_a_stale_fov_from_the_physical_fields() {
    // fovDegrees disagrees with focalLengthMm on input; the real value always wins (D12).
    let lens: Lens = serde_json::from_value(full_lens(json!({}))).unwrap();
    assert!((lens.fov_degrees - 1.0).abs() > 1.0);
    lens.validate().unwrap();
}

#[test]
fn out_of_range_f_stop_or_focal_length_fails_validation() {
    let bad_f_stop: Lens = serde_json::from_value(full_lens(json!({"fStop": 64.0}))).unwrap();
    assert!(bad_f_stop.validate().is_err());
    let bad_focal: Lens =
        serde_json::from_value(full_lens(json!({"focalLengthMm": 500.0}))).unwrap();
    assert!(bad_focal.validate().is_err());
}

#[test]
fn far_not_greater_than_near_fails_validation_for_either_shape() {
    let legacy: Lens =
        serde_json::from_value(json!({"fovDegrees": 45.0, "near": 100.0, "far": 1.0})).unwrap();
    assert!(legacy.validate().is_err());
    let full: Lens =
        serde_json::from_value(full_lens(json!({"near": 100.0, "far": 1.0}))).unwrap();
    assert!(full.validate().is_err());
}

#[test]
fn unknown_sensor_preset_or_extra_field_fails_to_deserialize() {
    assert!(serde_json::from_value::<Lens>(full_lens(json!({"sensorPreset": "medium"}))).is_err());
    let mut extra = full_lens(json!({}));
    extra["extra"] = json!(true);
    assert!(serde_json::from_value::<Lens>(extra).is_err());
}

#[test]
fn scene_replace_accepts_a_legacy_camera_lens_through_the_protocol_layer() {
    // D12: the protocol layer validates lens shape on entity parse, so a legacy lens must keep working.
    let scene = json!({
        "schemaVersion": 1,
        "sceneId": "scene_legacy_lens",
        "revision": 0,
        "entities": [{
            "kind": "camera", "id": "camera_a", "name": "Camera", "visible": true,
            "transform": {"position": [0, 1, 3], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1]},
            "lens": {"fovDegrees": 45, "near": 0.1, "far": 100}
        }],
        "outputs": [
            {"id": "output_main", "cameraId": "camera_a", "width": 1920, "height": 1080, "fps": 60},
            {"id": "preview_main", "cameraId": "camera_a", "width": 1920, "height": 1080, "fps": 60}
        ]
    });
    assert!(validate_call("sceneReplace", &json!({"scene": scene, "expectedRevision": 0})).is_ok());
}
