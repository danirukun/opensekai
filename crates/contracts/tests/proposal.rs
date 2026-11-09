use opensekai_contracts::{validate_call, validate_result};
use serde_json::{json, Value};

fn ok() -> Value {
    json!({"sceneId":"s","expect":{"entities":[{"id":"a","fingerprint":"0123456789abcdef"}],"blueprints":[]},"sceneOps":[],"blueprint":null,"output":{"outputId":"o","cameraId":"c"}})
}

#[test]
fn proposal_apply_matches_the_typescript_rules() {
    assert!(validate_call("proposalApply", &ok()).is_ok());
    let mut empty = ok();
    empty["output"] = Value::Null;
    assert!(validate_call("proposalApply", &empty).is_err());
    let rm = json!({"kind":"removeEntity","entityId":"x"});
    let mut p = ok();
    p["sceneOps"] = Value::Array(vec![rm.clone(); 64]);
    assert!(validate_call("proposalApply", &p).is_ok());
    p["sceneOps"] = Value::Array(vec![rm; 65]);
    assert!(validate_call("proposalApply", &p).is_err());
    let mut p = ok();
    p["expect"]["entities"][0]["fingerprint"] = json!("ABC");
    assert!(validate_call("proposalApply", &p).is_err());
    let mut p = ok();
    p["expect"]["blueprints"] = Value::Array(vec![json!({"id":"g","fingerprint":null}); 17]);
    assert!(validate_call("proposalApply", &p).is_err());
}

#[test]
fn proposal_apply_result_carries_an_optional_blueprint_result() {
    let reply = |data: Value| json!({"ok": true, "data": data});
    assert!(validate_result(
        "proposalApply",
        &reply(json!({"revision":3,"blueprint":null}))
    )
    .is_ok());
    assert!(validate_result(
        "proposalApply",
        &reply(json!({"revision":3,"blueprint":{"revision":1,"keystrokes":["KeyA"]}}))
    )
    .is_ok());
    assert!(validate_result("proposalApply", &reply(json!({"revision":3}))).is_err());
}
