use opensekai_contracts::{validate_value, ScenePatch};
use serde_json::json;

#[test]
fn animation_patch_accepts_builtin_overlays() {
    let v = json!({
        "sceneId": "s",
        "expectedRevision": 0,
        "operations": [{
            "kind": "setAvatarAnimation",
            "entityId": "avatar",
            "animation": {
                "overlayingPoses": [{
                    "id": "o1",
                    "pose": "selfie",
                    "maskedBodyParts": ["leftArm", "rightArm"],
                    "weight": 1
                }],
                "overlayTransitionSeconds": 1,
                "overrideHandPoses": {
                    "left": {"enabled": true, "pose": "peace", "weight": 1, "highPriority": false}
                },
                "handPin": {"left": {"enabled": true, "mode": "preset"}}
            }
        }]
    });
    assert!(validate_value::<ScenePatch>(&v).is_ok());
}

#[test]
fn animation_patch_rejects_unknown_pose() {
    let mut v = json!({
        "sceneId": "s",
        "expectedRevision": 0,
        "operations": [{
            "kind": "setAvatarAnimation",
            "entityId": "avatar",
            "animation": {
                "overlayingPoses": [{
                    "id": "o1",
                    "pose": "dance",
                    "maskedBodyParts": ["leftArm"],
                    "weight": 1
                }],
                "overlayTransitionSeconds": 1,
                "overrideHandPoses": {},
                "handPin": {}
            }
        }]
    });
    assert!(validate_value::<ScenePatch>(&v).is_err());
    v["operations"][0]["animation"]["overlayingPoses"][0]["pose"] = json!("wave");
    assert!(validate_value::<ScenePatch>(&v).is_ok());
}
