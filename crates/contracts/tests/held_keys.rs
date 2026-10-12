use opensekai_contracts::*;
use serde_json::json;

#[test]
fn input_update_carries_held_keys_and_omits_empty_lists() {
    let held: InputUpdate = serde_json::from_value(json!({"held":["KeyW"]})).unwrap();
    assert!(held.validate().is_ok());
    assert_eq!(serde_json::to_value(&held).unwrap(), json!({"held":["KeyW"]}));
    let events: InputUpdate = serde_json::from_value(json!({"events":[{"kind":"keystroke","accelerator":"Control+Alt+KeyH"}]})).unwrap();
    assert!(events.validate().is_ok());
    assert_eq!(serde_json::to_value(&events).unwrap()["held"], serde_json::Value::Null);
    let empty: InputUpdate = serde_json::from_value(json!({})).unwrap();
    assert!(empty.validate().is_err());
    let many: InputUpdate = serde_json::from_value(json!({"held": vec!["KeyW"; 17]})).unwrap();
    assert!(many.validate().is_err());
}

#[test]
fn blueprint_edit_result_reads_held_keys_with_an_empty_default() {
    let old: BlueprintEditResult = serde_json::from_value(json!({"revision":1,"keystrokes":[]})).unwrap();
    assert!(old.held_keys.is_empty());
    let new: BlueprintEditResult = serde_json::from_value(json!({"revision":1,"keystrokes":[],"heldKeys":["KeyW"]})).unwrap();
    assert_eq!(new.held_keys, vec!["KeyW".to_string()]);
}
