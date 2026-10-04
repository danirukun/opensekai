use opensekai_contracts::{validate_call, validate_result};
use serde_json::json;

#[test]
fn blueprint_run_requires_a_bounded_versioned_document() {
    let valid = json!({
        "graph": {"schemaVersion": 1, "id": "graph", "name": "Show", "nodes": [], "connections": []},
        "triggerNodeId": "start"
    });
    assert!(validate_call("blueprintRun", &valid).is_ok());
    let mut wrong = valid.clone();
    wrong["graph"]["schemaVersion"] = json!(2);
    assert!(validate_call("blueprintRun", &wrong).is_err());
    wrong = valid.clone();
    wrong["extra"] = json!(true);
    assert!(validate_call("blueprintRun", &wrong).is_err());
    assert!(validate_result("blueprintRun", &json!({"ok":true,"data":{"revision":1}})).is_ok());
}
