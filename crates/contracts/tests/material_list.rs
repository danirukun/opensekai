use opensekai_contracts::{validate_value, AssetRecord};
use serde_json::{json, Value};

fn record(materials: Value) -> Value {
    json!({"id":"avatar_x","format":"vrm","sha256":"a".repeat(64),"bytes":1,"sourceUrl":null,
        "licenseLabel":"User supplied","importerVersion":1,"name":"Avatar","expressions":[],"materials":materials})
}
fn material(extra: Value) -> Value {
    let mut m = json!({"index":0,"name":"Body","profile":"pbr","blend":false,"outline":false,"model":{"baseColor":"#ffffff"}});
    for (k, v) in extra.as_object().unwrap() {
        m[k] = v.clone();
    }
    m
}
fn ok(materials: Value) -> bool {
    validate_value::<AssetRecord>(&record(materials)).is_ok()
}

#[test]
fn a_record_takes_a_valid_material_list() {
    assert!(ok(json!([])));
    assert!(ok(json!([
        material(json!({})),
        material(json!({"index":1,"name":"Face"}))
    ])));
    assert!(ok(json!([material(
        json!({"profile":"mtoon","blend":true,"outline":true,"model":{
        "baseColor":"#000000","opacity":0,"emissionColor":"#ffffff","emissionStrength":100,
        "shadeColor":"#010203","rimColor":"#000000","outlineColor":"#000000","outlineWidth":0.05}})
    )])));
    let many: Vec<Value> = (0..256)
        .map(|i| material(json!({"index":i,"name":format!("M{i}")})))
        .collect();
    assert!(ok(json!(many)));
}

#[test]
fn names_are_unique_and_1_to_64_units() {
    assert!(!ok(json!([
        material(json!({})),
        material(json!({"index":1}))
    ])));
    assert!(!ok(json!([material(json!({"name":""}))])));
    assert!(ok(json!([material(
        json!({"name":"\u{1F600}".repeat(32)})
    )])));
    assert!(!ok(json!([material(json!({"name":"x".repeat(65)}))])));
    let many: Vec<Value> = (0..257)
        .map(|i| material(json!({"index":i,"name":format!("M{i}")})))
        .collect();
    assert!(!ok(json!(many)));
}

#[test]
fn model_values_apply_and_are_in_range() {
    let model = |m: Value| ok(json!([material(json!({"model":m}))]));
    assert!(!model(json!({"baseColor":"#FFFFFF"})));
    assert!(!model(json!({"baseColor":"#fff"})));
    assert!(!model(json!({"opacity":0.5})));
    assert!(!model(json!({"shadeColor":"#000000"})));
    assert!(!model(json!({"outlineWidth":0.01})));
    assert!(!model(json!({"emissionStrength":101})));
    assert!(!model(json!({"emissionStrength":"#000000"})));
    assert!(!model(json!({"gloss":1})));
    assert!(!ok(json!([material(
        json!({"blend":true,"model":{"opacity":1.5}})
    )])));
    assert!(!ok(json!([material(
        json!({"profile":"unlit","model":{"emissionColor":"#000000"}})
    )])));
    assert!(!ok(json!([material(json!({"outline":true}))])));
    assert!(!ok(json!([material(json!({"profile":"toon"}))])));
}

#[test]
fn image_and_video_records_have_no_material_list() {
    let mut image = record(json!([]));
    image["id"] = json!("image_x");
    image["format"] = json!("png");
    image["image"] = json!({"width":1,"height":1,"frames":1});
    assert!(validate_value::<AssetRecord>(&image).is_err());
    image.as_object_mut().unwrap().remove("materials");
    assert!(validate_value::<AssetRecord>(&image).is_ok());
}
