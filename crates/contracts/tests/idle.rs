use opensekai_contracts::{validate_value, AssetRecord, AssetSummary, AvatarPose, ScenePatch};
use serde_json::json;
#[test]
fn idle_patch_accepts_builtin_and_clip_settings() {
    let mut v = json!({"sceneId":"s","expectedRevision":0,"operations":[{"kind":"setAvatarIdle","entityId":"avatar","idleAnimation":{"kind":"builtin","enabled":true}}]});
    assert!(validate_value::<ScenePatch>(&v).is_ok());
    v["operations"][0]["idleAnimation"] =
        json!({"kind":"clip","enabled":true,"assetId":"animation_abc"});
    assert!(validate_value::<ScenePatch>(&v).is_ok());
    v["operations"][0]["idleAnimation"]["kind"] = json!("mixamo");
    assert!(validate_value::<ScenePatch>(&v).is_err());
}
#[test]
fn animation_asset_summary_and_record() {
    let sha = "a".repeat(64);
    let record = json!({
        "id": format!("animation_{sha}"),
        "format": "vrma",
        "sha256": sha,
        "bytes": 128,
        "sourceUrl": null,
        "licenseLabel": "User supplied",
        "importerVersion": 1,
        "name": "Idle",
        "expressions": [],
        "animation": {"durationMs": 1000, "bones": {"chest": {"times": [0.0, 1.0], "rotations": [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]}}}
    });
    let parsed = validate_value::<AssetRecord>(&record).expect("animation record");
    assert_eq!(AssetSummary::of(&parsed).kind, opensekai_contracts::AssetKind::Animation);
}
#[test]
fn baseline_is_normalized_and_unweighted() {
    let mut v = json!({"avatarId":"a","bones":{},"expressions":{},"baseBones":{"chest":{"space":"normalized","rotation":[0,0,0,1]}}});
    assert!(validate_value::<AvatarPose>(&v).is_ok());
    v["baseBones"]["chest"]["space"] = json!("raw");
    assert!(validate_value::<AvatarPose>(&v).is_err());
    v["baseBones"]["chest"]["space"] = json!("normalized");
    v["baseBones"]["chest"]["weight"] = json!(0.5);
    assert!(validate_value::<AvatarPose>(&v).is_err());
    v["baseBones"]["chest"]["weight"] = json!(null);
    assert!(validate_value::<AvatarPose>(&v).is_err());
}
