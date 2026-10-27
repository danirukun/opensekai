use opensekai_contracts::{validate_value, OutputSpec, ScenePatch, SceneView, Validate};
use serde_json::{json, Value};
fn output(id: &str, format: Value) -> Value {
    let mut value = json!({"id":id,"cameraId":"camera_main","width":1920,"height":1080,"fps":60});
    value
        .as_object_mut()
        .unwrap()
        .extend(format.as_object().unwrap().clone());
    value
}
fn scene(main: Value, preview: Value) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":[camera],"outputs":[output("output_main", main),output("preview_main", preview)]})
}
fn accepts(main: Value) -> bool {
    validate_value::<SceneView>(&scene(main, json!({}))).is_ok()
}
fn patch(op: Value) -> Value {
    json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[op]})
}
#[test]
fn output_main_accepts_each_preset_frame_limit_and_render_scale() {
    for (width, height) in [(1920, 1080), (1600, 900), (1280, 720), (960, 540)] {
        for fps in [30, 60] {
            for scale in [0.5, 0.75, 1.0] {
                assert!(
                    accepts(json!({"width":width,"height":height,"fps":fps,"renderScale":scale})),
                    "{width}x{height} {fps} {scale}"
                );
            }
        }
    }
    assert!(accepts(json!({})));
}
#[test]
fn output_main_rejects_other_sizes_rates_scales_and_null() {
    for format in [
        json!({"width":1920,"height":720}),
        json!({"width":3840,"height":2160}),
        json!({"width":1080,"height":1920}),
        json!({"fps":24}),
        json!({"fps":120}),
        json!({"renderScale":2}),
        json!({"renderScale":0}),
        json!({"renderScale":null}),
    ] {
        assert!(!accepts(format.clone()), "{format}");
    }
}
#[test]
fn preview_main_keeps_the_default_format() {
    for format in [
        json!({"width":1280,"height":720}),
        json!({"fps":30}),
        json!({"renderScale":0.5}),
    ] {
        assert!(validate_value::<SceneView>(&scene(json!({}), format.clone())).is_err());
    }
    assert!(validate_value::<SceneView>(&scene(json!({}), json!({"renderScale":1}))).is_ok());
}
#[test]
fn a_missing_render_scale_stays_missing() {
    let spec: OutputSpec = serde_json::from_value(output("output_main", json!({}))).unwrap();
    assert_eq!(spec.render_scale, None);
    assert!(spec.is_default_format());
    assert!(spec.validate().is_ok());
    assert!(serde_json::to_value(&spec)
        .unwrap()
        .get("renderScale")
        .is_none());
    let scaled: OutputSpec =
        serde_json::from_value(output("output_main", json!({"renderScale":0.75}))).unwrap();
    assert!(!scaled.is_default_format());
    assert_eq!(serde_json::to_value(&scaled).unwrap()["renderScale"], 0.75);
}
#[test]
fn set_output_format_validates_the_values() {
    let op = |format: Value| {
        let mut value = json!({"kind":"setOutputFormat","outputId":"output_main","width":1280,"height":720,"fps":30,"renderScale":0.75});
        value
            .as_object_mut()
            .unwrap()
            .extend(format.as_object().unwrap().clone());
        validate_value::<ScenePatch>(&patch(value))
    };
    assert!(op(json!({})).is_ok());
    assert!(op(json!({"width":3840,"height":2160})).is_err());
    assert!(op(json!({"fps":24})).is_err());
    assert!(op(json!({"renderScale":2})).is_err());
    assert!(op(json!({"renderScale":null})).is_err());
    let mut missing = json!({"kind":"setOutputFormat","outputId":"output_main","width":1280,"height":720,"fps":30});
    assert!(validate_value::<ScenePatch>(&patch(missing.take())).is_err());
}
