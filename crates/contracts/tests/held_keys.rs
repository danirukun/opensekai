use opensekai_contracts::*;
use serde_json::json;

#[test]
fn input_update_carries_held_keys_and_omits_empty_lists() {
    let held: InputUpdate = serde_json::from_value(json!({"held":["KeyW"]})).unwrap();
    assert!(held.validate().is_ok());
    assert_eq!(
        serde_json::to_value(&held).unwrap(),
        json!({"held":["KeyW"]})
    );
    let events: InputUpdate = serde_json::from_value(
        json!({"events":[{"kind":"keystroke","accelerator":"Control+Alt+KeyH"}]}),
    )
    .unwrap();
    assert!(events.validate().is_ok());
    assert_eq!(
        serde_json::to_value(&events).unwrap()["held"],
        serde_json::Value::Null
    );
    let empty: InputUpdate = serde_json::from_value(json!({})).unwrap();
    assert!(empty.validate().is_err());
    let many: InputUpdate = serde_json::from_value(json!({"held": vec!["KeyW"; 17]})).unwrap();
    assert!(many.validate().is_err());
}

#[test]
fn blueprint_edit_result_reads_held_keys_with_an_empty_default() {
    let old: BlueprintEditResult =
        serde_json::from_value(json!({"revision":1,"keystrokes":[]})).unwrap();
    assert!(old.held_keys.is_empty());
    let new: BlueprintEditResult =
        serde_json::from_value(json!({"revision":1,"keystrokes":[],"heldKeys":["KeyW"]})).unwrap();
    assert_eq!(new.held_keys, vec!["KeyW".to_string()]);
}

#[test]
fn blueprint_inspect_results_accept_held_keys_within_limits() {
    let reply = |held: serde_json::Value| json!({"ok":true,"data":{"kind":"snapshot","revision":1,"blueprints":[],"errors":[],"keystrokes":[],"heldKeys":held}});
    assert!(validate_result("blueprintInspect", &reply(json!(["KeyW", "KeyS"]))).is_ok());
    let delta = json!({"ok":true,"data":{"kind":"delta","revision":1,"batches":[],"errors":[],"keystrokes":[],"heldKeys":["KeyW"]}});
    assert!(validate_result("blueprintInspect", &delta).is_ok());
    assert!(validate_result("blueprintInspect", &reply(json!(vec!["KeyW"; 17]))).is_err());
    assert!(validate_result("blueprintInspect", &reply(json!([""]))).is_err());
}
