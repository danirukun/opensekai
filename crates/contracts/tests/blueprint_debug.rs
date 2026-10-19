use opensekai_contracts::{validate_call, validate_result};
use serde_json::{json, Value};

fn fixture() -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/protocol/blueprint-debug.json");
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}
// The same mutations as packages/contracts/test/blueprint-debug-fixture.test.ts.
fn mutate(valid: &Value, case: &Value) -> Value {
    let mut data = valid.clone();
    if let Some(list) = case["fill"].as_str() {
        let item = data[list][0].clone();
        data[list] = Value::Array(vec![item; if list == "entries" { 51 } else { 65 }]);
        return data;
    }
    let key = case["change"][0].as_str().unwrap();
    let value = match case["change"][1].as_str() {
        Some("LONG_TEXT") => json!("x".repeat(257)),
        Some("LONG_STRING") => json!("x".repeat(1025)),
        _ => case["change"][1].clone(),
    };
    let target = if let Some(i) = case["entry"].as_u64() {
        &mut data["entries"][i as usize]
    } else if let Some(i) = case["value"].as_u64() {
        &mut data["values"][i as usize]
    } else {
        &mut data
    };
    target[key] = value;
    data
}

#[test]
fn checks_the_blueprint_debug_call() {
    assert!(validate_call("blueprintDebug", &json!({})).is_ok());
    assert!(validate_call("blueprintDebug", &json!({"since": 3})).is_ok());
    assert!(validate_call("blueprintDebug", &json!({"since": -1})).is_err());
    assert!(validate_call("blueprintDebug", &json!({"since": 1, "graphId": "g"})).is_err());
}

#[test]
fn checks_the_shared_blueprint_debug_replies() {
    let fixture = fixture();
    let valid = &fixture["valid"];
    assert!(validate_result("blueprintDebug", &json!({"ok": true, "data": valid})).is_ok());
    for case in fixture["invalid"].as_array().unwrap() {
        let data = mutate(valid, case);
        assert!(
            validate_result("blueprintDebug", &json!({"ok": true, "data": data})).is_err(),
            "{}",
            case["name"]
        );
    }
}
