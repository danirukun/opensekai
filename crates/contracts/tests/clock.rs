use opensekai_contracts::parse_wire;
use serde_json::json;
#[test]
fn clock_is_strict_safe_integer_wire() {
    for value in [json!(0), json!(1.0), json!(9007199254740991u64)] {
        assert!(parse_wire(
            json!({"kind":"clock","sessionId":"session","elapsedMs":value})
                .to_string()
                .as_bytes()
        )
        .is_ok());
    }
    for value in [
        json!(-1),
        json!(0.5),
        json!(9007199254740992u64),
        json!("1"),
    ] {
        assert!(parse_wire(
            json!({"kind":"clock","sessionId":"session","elapsedMs":value})
                .to_string()
                .as_bytes()
        )
        .is_err());
    }
    assert!(
        parse_wire(br#"{"kind":"clock","sessionId":"session","elapsedMs":0,"extra":1}"#).is_err()
    );
}
