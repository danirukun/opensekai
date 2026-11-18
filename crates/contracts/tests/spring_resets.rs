use opensekai_contracts::{RuntimeFrame, Validate};
use serde_json::Value;
fn json(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}
fn frame(resets: &Value) -> Value {
    let mut frame = json(include_str!("../../../fixtures/protocol/valid-frame.json"));
    frame["springResets"] = resets.clone();
    frame
}
// B43 R1: the same vectors as packages/contracts/test/spring-resets.test.ts.
#[test]
fn spring_resets_match_the_shared_vectors() {
    let vectors = json(include_str!("../../../fixtures/protocol/spring-resets.json"));
    for vector in vectors["valid"].as_array().unwrap() {
        let value = frame(&vector["springResets"]);
        let parsed: RuntimeFrame = serde_json::from_value(value.clone())
            .unwrap_or_else(|e| panic!("{}: {e}", vector["name"]));
        assert!(parsed.validate().is_ok(), "{}", vector["name"]);
        assert_eq!(
            serde_json::to_value(&parsed).unwrap()["springResets"],
            value["springResets"]
        );
    }
    for vector in vectors["invalid"].as_array().unwrap() {
        let ok = serde_json::from_value::<RuntimeFrame>(frame(&vector["springResets"]))
            .is_ok_and(|parsed| parsed.validate().is_ok());
        assert!(!ok, "{} passed", vector["name"]);
    }
}
// B43 R2: a frame without reset counts has no field.
#[test]
fn frames_without_resets_omit_the_field() {
    let parsed: RuntimeFrame =
        serde_json::from_str(include_str!("../../../fixtures/protocol/valid-frame.json")).unwrap();
    assert!(serde_json::to_value(&parsed).unwrap().get("springResets").is_none());
}
