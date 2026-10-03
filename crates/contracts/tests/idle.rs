use opensekai_contracts::{validate_value, AvatarPose, ScenePatch};
use serde_json::json;
#[test]
fn idle_patch_accepts_only_builtin_setting() {
    let mut v = json!({"sceneId":"s","expectedRevision":0,"operations":[{"kind":"setAvatarIdle","entityId":"avatar","idleAnimation":{"kind":"builtin","enabled":true}}]});
    assert!(validate_value::<ScenePatch>(&v).is_ok());
    v["operations"][0]["idleAnimation"]["kind"] = json!("mixamo");
    assert!(validate_value::<ScenePatch>(&v).is_err());
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
}
