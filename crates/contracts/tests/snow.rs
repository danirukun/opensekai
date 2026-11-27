use opensekai_contracts::{validate_value, SceneView, SnowSettings, Validate};
use serde_json::{json, Value};

fn snow_settings() -> Value {
    json!({"rate":0.5,"fallSpeed":1,"flakeSize":1,"flutter":1,"windDirection":0,"windSpeed":0,"buildUpSeconds":45,"meltSeconds":20,"thickness":0.015,"settleOnCharacters":true,"settleOnProps":true,"settleOnEnvironment":true})
}
fn snow(id: &str) -> Value {
    json!({"id":id,"name":"Snow","visible":true,"transform":{"position":[0,2,0],"rotation":[0,0,0,1],"scale":[6,4,6]},"kind":"snow","snow":snow_settings()})
}
fn scene(extra: Vec<Value>) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let mut entities = vec![camera];
    entities.extend(extra);
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":entities,"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}

#[test]
fn snow_settings_round_trip_with_camel_case_names() {
    let parsed: SnowSettings = serde_json::from_value(snow_settings()).unwrap();
    let written = serde_json::to_value(&parsed).unwrap();
    let (written, expected) = (written.as_object().unwrap(), snow_settings());
    let expected = expected.as_object().unwrap();
    assert_eq!(written.len(), expected.len());
    for (key, value) in expected {
        match value.as_f64() {
            Some(number) => assert_eq!(written[key].as_f64(), Some(number), "{key}"),
            None => assert_eq!(&written[key], value, "{key}"),
        }
    }
    assert!(parsed.validate().is_ok());
}

#[test]
fn snow_settings_reject_each_range() {
    for (key, value) in [
        ("rate", json!(-0.1)),
        ("rate", json!(1.1)),
        ("fallSpeed", json!(0.1)),
        ("fallSpeed", json!(3.1)),
        ("flakeSize", json!(0.4)),
        ("flakeSize", json!(2.1)),
        ("flutter", json!(2.1)),
        ("windDirection", json!(361)),
        ("windSpeed", json!(5.1)),
        ("buildUpSeconds", json!(4)),
        ("buildUpSeconds", json!(601)),
        ("meltSeconds", json!(4)),
        ("meltSeconds", json!(601)),
        ("thickness", json!(0.06)),
    ] {
        let mut entity = snow("snow_1");
        entity["snow"][key] = value.clone();
        assert!(
            validate_value::<SceneView>(&scene(vec![entity])).is_err(),
            "{key} = {value}"
        );
    }
    let mut not_bool = snow_settings();
    not_bool["settleOnProps"] = json!(1);
    assert!(serde_json::from_value::<SnowSettings>(not_bool).is_err());
    let mut extra = snow_settings();
    extra["color"] = json!("#fff");
    assert!(serde_json::from_value::<SnowSettings>(extra).is_err());
}

#[test]
fn scene_rejects_two_snows() {
    assert!(validate_value::<SceneView>(&scene(vec![snow("snow_1")])).is_ok());
    assert!(validate_value::<SceneView>(&scene(vec![snow("snow_1"), snow("snow_2")])).is_err());
}
