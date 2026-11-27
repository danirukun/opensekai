use opensekai_contracts::{RuntimeFrame, Validate};
use serde_json::Value;
fn json(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}
fn frame(snow: &Value) -> Value {
    let mut frame = json(include_str!("../../../fixtures/protocol/valid-frame.json"));
    frame["snow"] = snow.clone();
    frame
}
// Snow cover R5: the same vectors as packages/contracts/test/snow-cover.test.ts.
#[test]
fn snow_cover_matches_the_shared_vectors() {
    let vectors = json(include_str!("../../../fixtures/protocol/snow-cover.json"));
    for vector in vectors["valid"].as_array().unwrap() {
        let value = frame(&vector["snow"]);
        let parsed: RuntimeFrame = serde_json::from_value(value.clone())
            .unwrap_or_else(|e| panic!("{}: {e}", vector["name"]));
        assert!(parsed.validate().is_ok(), "{}", vector["name"]);
        let snow = parsed.snow.expect("snow");
        assert_eq!(snow.entity_id, value["snow"]["entityId"].as_str().unwrap());
        assert_eq!(snow.cover, value["snow"]["cover"].as_f64().unwrap());
    }
    for vector in vectors["invalid"].as_array().unwrap() {
        let ok = serde_json::from_value::<RuntimeFrame>(frame(&vector["snow"]))
            .is_ok_and(|parsed| parsed.validate().is_ok());
        assert!(!ok, "{} passed", vector["name"]);
    }
}
// Snow cover R4: a frame without a snow entity has no field.
#[test]
fn frames_without_snow_omit_the_field() {
    let parsed: RuntimeFrame =
        serde_json::from_str(include_str!("../../../fixtures/protocol/valid-frame.json")).unwrap();
    assert!(serde_json::to_value(&parsed).unwrap().get("snow").is_none());
}
