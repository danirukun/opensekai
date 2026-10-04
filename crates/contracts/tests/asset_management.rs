use opensekai_contracts::{validate_value, ScenePatch};
use serde_json::{json, Value};

fn patch(operation: Value) -> Value {
    json!({"sceneId":"scene","expectedRevision":1,"operations":[operation]})
}

#[test]
fn rename_accepts_trimmed_nonempty_names_and_utf16_boundary() {
    for name in [
        "Avatar".to_owned(),
        " Avatar ".to_owned(),
        "a".repeat(128),
        format!(" {} ", "a".repeat(128)),
        "😀".repeat(64),
    ] {
        let value = patch(json!({"kind":"renameEntity","entityId":"avatar","name":name}));
        let parsed = validate_value::<ScenePatch>(&value).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    }
}

#[test]
fn rename_rejects_blank_and_names_over_utf16_boundary() {
    for name in [
        "".to_owned(),
        " \t\n ".to_owned(),
        "a".repeat(129),
        format!("{}a", "😀".repeat(64)),
    ] {
        let value = patch(json!({"kind":"renameEntity","entityId":"avatar","name":name}));
        assert!(validate_value::<ScenePatch>(&value).is_err());
    }
}

#[test]
fn remove_round_trips_and_both_operations_reject_unknown_fields() {
    let value = patch(json!({"kind":"removeEntity","entityId":"avatar"}));
    let parsed = validate_value::<ScenePatch>(&value).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    for mut operation in [
        json!({"kind":"removeEntity","entityId":"avatar"}),
        json!({"kind":"renameEntity","entityId":"avatar","name":"Avatar"}),
    ] {
        operation["extra"] = json!(true);
        assert!(validate_value::<ScenePatch>(&patch(operation)).is_err());
    }
}
