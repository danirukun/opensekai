use opensekai_contracts::validate_result;
use serde_json::{json, Value};
#[test]
fn app_status_accepts_an_optional_scene_id() {
    let status = |extra: Value| {
        let mut data = json!({"schemaVersion":1,"sessionId":"s","ready":true,"revision":1,"capabilities":["read"],"warnings":[],"outputs":[]});
        data.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        json!({"ok":true,"data":data})
    };
    assert!(validate_result("appStatus", &status(json!({"sceneId":"scene_b"}))).is_ok());
    assert!(validate_result("appStatus", &status(json!({}))).is_ok());
    assert!(validate_result("appStatus", &status(json!({"sceneId":""}))).is_err());
    assert!(validate_result("appStatus", &status(json!({"sceneId":"x".repeat(257)}))).is_err());
}
