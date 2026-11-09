use opensekai_contracts::{validate_value, AssetList, AssetRecord, AssetSummary};
use serde_json::{json, Value};

fn record(catalog: Value) -> Value {
    json!({"id":"scene_a","format":"glb","sha256":"a".repeat(64),"bytes":1,"sourceUrl":null,"licenseLabel":"","importerVersion":1,"name":"Room","catalog":catalog,"expressions":[]})
}

fn valid(catalog: Value) -> bool {
    validate_value::<AssetRecord>(&record(catalog)).is_ok()
}

#[test]
fn catalog_counts_utf16_units_and_rejects_loose_shapes() {
    assert!(valid(json!({"description":null,"tags":[]})));
    assert!(valid(
        json!({"description":"😀".repeat(140),"tags":["ステージ","x".repeat(32)]})
    ));
    assert!(!valid(json!({"description":"😀".repeat(141),"tags":[]})));
    assert!(!valid(json!({"description":"","tags":[]})));
    assert!(!valid(json!({"description":null,"tags":vec!["a"; 9]})));
    assert!(!valid(json!({"description":null,"tags":["Palm"]})));
    assert!(!valid(json!({"description":null,"tags":[""]})));
    assert!(!valid(json!({"description":null,"tags":["x".repeat(33)]})));
    assert!(!valid(json!({"description":null,"tags":[],"extra":1})));
    assert!(!valid(json!(null)));
}

#[test]
fn summary_carries_the_catalog_and_old_records_stay_valid() {
    let mut value = record(json!({"description":"Palm","tags":["palm"]}));
    let parsed = validate_value::<AssetRecord>(&value).unwrap();
    let summary = AssetSummary::of(&parsed);
    assert_eq!(
        serde_json::to_value(&summary).unwrap()["catalog"],
        json!({"description":"Palm","tags":["palm"]})
    );
    value.as_object_mut().unwrap().remove("catalog");
    let old = validate_value::<AssetRecord>(&value).unwrap();
    let page = AssetList::page(&[old], None);
    assert!(serde_json::to_value(&page).unwrap()["assets"][0]
        .get("catalog")
        .is_none());
}
