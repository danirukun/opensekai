//! Prepare `AssetAnimation` from a Mixamo-format FBX (CHR-04 slice 4 / #268).
//! Maps Mixamo bone names, retargets local rotations into VRM normalized space, and
//! emits the same prepared package as VRMA import.
use opensekai_contracts::{
    invalid, AppError, AssetAnimation, AssetAnimationTrack, ErrorCode, HUMANOID_BONES,
    MAX_ANIMATION_BONES, MAX_ANIMATION_DURATION_MS, MAX_ANIMATION_KEYS,
};
use std::collections::BTreeMap;
use ufbx::{self, Quat};

const IDENTITY: Quat = Quat {
    x: 0.0,
    y: 0.0,
    z: 0.0,
    w: 1.0,
};

/// Strip Mixamo prefixes (`mixamorig:`, `mixamorig`, `mixamorig1`, …) and return the bone tip.
pub fn normalize_mixamo_bone_name(name: &str) -> &str {
    let name = name.rsplit('|').next().unwrap_or(name);
    let lower = name.as_bytes();
    if lower.len() >= 9 {
        let head = &name[..9];
        if head.eq_ignore_ascii_case("mixamorig") {
            let rest = &name[9..];
            let rest = rest.strip_prefix(':').unwrap_or(rest);
            let rest = rest.trim_start_matches(|c: char| c.is_ascii_digit());
            return rest;
        }
    }
    name
}

/// Map a Mixamo (or stripped) bone name to a VRM humanoid bone, if known.
pub fn mixamo_to_humanoid(name: &str) -> Option<&'static str> {
    let tip = normalize_mixamo_bone_name(name);
    let mapped = match tip {
        "Hips" => "hips",
        "Spine" => "spine",
        "Spine1" => "chest",
        "Spine2" => "upperChest",
        "Neck" => "neck",
        "Head" => "head",
        "LeftShoulder" => "leftShoulder",
        "LeftArm" => "leftUpperArm",
        "LeftForeArm" => "leftLowerArm",
        "LeftHand" => "leftHand",
        "RightShoulder" => "rightShoulder",
        "RightArm" => "rightUpperArm",
        "RightForeArm" => "rightLowerArm",
        "RightHand" => "rightHand",
        "LeftUpLeg" => "leftUpperLeg",
        "LeftLeg" => "leftLowerLeg",
        "LeftFoot" => "leftFoot",
        "LeftToeBase" => "leftToes",
        "RightUpLeg" => "rightUpperLeg",
        "RightLeg" => "rightLowerLeg",
        "RightFoot" => "rightFoot",
        "RightToeBase" => "rightToes",
        "LeftHandThumb1" => "leftThumbMetacarpal",
        "LeftHandThumb2" => "leftThumbProximal",
        "LeftHandThumb3" => "leftThumbDistal",
        "LeftHandIndex1" => "leftIndexProximal",
        "LeftHandIndex2" => "leftIndexIntermediate",
        "LeftHandIndex3" => "leftIndexDistal",
        "LeftHandMiddle1" => "leftMiddleProximal",
        "LeftHandMiddle2" => "leftMiddleIntermediate",
        "LeftHandMiddle3" => "leftMiddleDistal",
        "LeftHandRing1" => "leftRingProximal",
        "LeftHandRing2" => "leftRingIntermediate",
        "LeftHandRing3" => "leftRingDistal",
        "LeftHandPinky1" => "leftLittleProximal",
        "LeftHandPinky2" => "leftLittleIntermediate",
        "LeftHandPinky3" => "leftLittleDistal",
        "RightHandThumb1" => "rightThumbMetacarpal",
        "RightHandThumb2" => "rightThumbProximal",
        "RightHandThumb3" => "rightThumbDistal",
        "RightHandIndex1" => "rightIndexProximal",
        "RightHandIndex2" => "rightIndexIntermediate",
        "RightHandIndex3" => "rightIndexDistal",
        "RightHandMiddle1" => "rightMiddleProximal",
        "RightHandMiddle2" => "rightMiddleIntermediate",
        "RightHandMiddle3" => "rightMiddleDistal",
        "RightHandRing1" => "rightRingProximal",
        "RightHandRing2" => "rightRingIntermediate",
        "RightHandRing3" => "rightRingDistal",
        "RightHandPinky1" => "rightLittleProximal",
        "RightHandPinky2" => "rightLittleIntermediate",
        "RightHandPinky3" => "rightLittleDistal",
        _ => return None,
    };
    HUMANOID_BONES.contains(&mapped).then_some(mapped)
}

/// `q_out = normalize(parentRestWorld * qAnim * inverse(restWorld))` (ThreeVRM Mixamo formula).
pub fn retarget_mixamo_rotation(parent_rest_world: Quat, q_anim: Quat, rest_world: Quat) -> Quat {
    ufbx::quat_normalize(ufbx::quat_mul(
        ufbx::quat_mul(parent_rest_world, q_anim),
        quat_inverse(rest_world),
    ))
}

fn quat_inverse(q: Quat) -> Quat {
    Quat {
        x: -q.x,
        y: -q.y,
        z: -q.z,
        w: q.w,
    }
}

fn quat_to_xyzw(q: Quat) -> [f64; 4] {
    [q.x, q.y, q.z, q.w]
}

fn is_unit(q: Quat) -> bool {
    let len = (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w).sqrt();
    len.is_finite() && (len - 1.0).abs() <= 0.01
}

/// Parse a Mixamo-format FBX and prepare humanoid rotation tracks.
pub fn prepare_mixamo_fbx(bytes: &[u8]) -> Result<AssetAnimation, AppError> {
    let root = ufbx::load_memory(bytes, ufbx::LoadOpts::default())
        .map_err(|_| invalid("Invalid FBX"))?;
    let scene: &ufbx::Scene = &root;
    let stack = scene
        .anim_stacks
        .iter()
        .find(|s| s.time_end > s.time_begin + 1e-6)
        .or_else(|| scene.anim_stacks.iter().next())
        .ok_or_else(|| invalid("FBX has no animations"))?;
    let anim = stack.anim.as_ref();
    let time_begin = stack.time_begin;
    let time_end = stack.time_end.max(time_begin + 1e-3);
    let duration_sec = time_end - time_begin;

    let mut mapped: Vec<(&ufbx::Node, &'static str)> = Vec::new();
    for node in &scene.nodes {
        if let Some(humanoid) = mixamo_to_humanoid(node.element.name.as_ref()) {
            if mapped.iter().any(|(_, h)| *h == humanoid) {
                continue;
            }
            mapped.push((node, humanoid));
        }
    }
    if mapped.is_empty() {
        return Err(invalid("FBX has no Mixamo humanoid bones"));
    }

    let mut bones = BTreeMap::new();
    for (node, humanoid) in mapped {
        let mut times = rotation_key_times(stack, node);
        if times.is_empty() {
            times = sample_times(time_begin, time_end, 30);
        }
        if times.len() > MAX_ANIMATION_KEYS {
            return Err(invalid("FBX track has too many keys"));
        }
        let rest_world = ufbx::matrix_to_transform(&node.node_to_world).rotation;
        let parent_rest = node
            .parent
            .as_ref()
            .map(|p| ufbx::matrix_to_transform(&p.node_to_world).rotation)
            .unwrap_or(IDENTITY);

        let mut out_times = Vec::with_capacity(times.len());
        let mut rotations = Vec::with_capacity(times.len() * 4);
        for &t in &times {
            let q_anim = ufbx::evaluate_transform(anim, node, t).rotation;
            let q_out = retarget_mixamo_rotation(parent_rest, q_anim, rest_world);
            if !is_unit(q_out) {
                return Err(invalid("FBX rotation is not a unit quaternion"));
            }
            let local_t = (t - time_begin).max(0.0);
            if let Some(last) = out_times.last() {
                if local_t + 1e-9 < *last {
                    return Err(invalid("FBX track times must be nondecreasing"));
                }
            }
            out_times.push(local_t);
            rotations.extend(quat_to_xyzw(q_out));
        }
        if out_times.is_empty() {
            continue;
        }
        bones.insert(
            humanoid.to_string(),
            AssetAnimationTrack {
                times: out_times,
                rotations,
            },
        );
        if bones.len() > MAX_ANIMATION_BONES {
            return Err(invalid("FBX has too many humanoid bones"));
        }
    }
    if bones.is_empty() {
        return Err(invalid("FBX has no humanoid rotation tracks"));
    }
    let duration_ms = ((duration_sec * 1000.0).ceil() as u64).clamp(1, MAX_ANIMATION_DURATION_MS);
    let animation = AssetAnimation {
        duration_ms,
        bones,
    };
    if !animation.is_valid() {
        return Err(AppError {
            code: ErrorCode::InvalidInput,
            message: "Invalid prepared animation".into(),
            ids: vec![],
        });
    }
    Ok(animation)
}

fn rotation_key_times(stack: &ufbx::AnimStack, node: &ufbx::Node) -> Vec<f64> {
    let mut times = Vec::new();
    for layer in &stack.layers {
        for prop in &layer.anim_props {
            if prop.prop_name.as_ref() != "Lcl Rotation" {
                continue;
            }
            if prop.element.element_id != node.element.element_id {
                continue;
            }
            for curve in prop.anim_value.curves.iter().flatten() {
                for key in &curve.keyframes {
                    if key.time.is_finite() {
                        times.push(key.time);
                    }
                }
            }
        }
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    times.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
    times
}

fn sample_times(begin: f64, end: f64, count: usize) -> Vec<f64> {
    if count <= 1 {
        return vec![begin];
    }
    let span = (end - begin).max(1e-6);
    (0..count)
        .map(|i| begin + span * (i as f64) / (count as f64 - 1.0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_mixamo_prefixes() {
        assert_eq!(normalize_mixamo_bone_name("mixamorigHips"), "Hips");
        assert_eq!(normalize_mixamo_bone_name("mixamorig:Hips"), "Hips");
        assert_eq!(normalize_mixamo_bone_name("mixamorig1Hips"), "Hips");
        assert_eq!(normalize_mixamo_bone_name("Armature|mixamorigHips"), "Hips");
        assert_eq!(normalize_mixamo_bone_name("Hips"), "Hips");
    }

    #[test]
    fn maps_core_and_finger_bones() {
        assert_eq!(mixamo_to_humanoid("mixamorigSpine1"), Some("chest"));
        assert_eq!(mixamo_to_humanoid("mixamorig:LeftArm"), Some("leftUpperArm"));
        assert_eq!(
            mixamo_to_humanoid("mixamorigLeftHandThumb1"),
            Some("leftThumbMetacarpal")
        );
        assert_eq!(mixamo_to_humanoid("Root"), None);
    }

    #[test]
    fn retarget_identity_rest_keeps_anim() {
        let anim = Quat {
            x: 0.0,
            y: 0.0,
            z: std::f64::consts::FRAC_1_SQRT_2,
            w: std::f64::consts::FRAC_1_SQRT_2,
        };
        let out = retarget_mixamo_rotation(IDENTITY, anim, IDENTITY);
        assert!((out.z - anim.z).abs() < 1e-9);
        assert!((out.w - anim.w).abs() < 1e-9);
    }

    #[test]
    fn prepares_synthetic_mixamo_fixture() {
        let bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../fixtures/animation/mixamo-chest-sway.fbx"
        ))
        .expect("fixture");
        let animation = prepare_mixamo_fbx(&bytes).expect("prepare");
        assert!(animation.duration_ms >= 1);
        assert!(animation.bones.contains_key("chest") || animation.bones.contains_key("spine"));
        assert!(animation.bones.len() >= 3);
        assert!(animation.is_valid());
    }

    #[test]
    fn rejects_non_fbx_bytes() {
        assert!(prepare_mixamo_fbx(b"not fbx").is_err());
    }

    #[test]
    fn stages_synthetic_mixamo_fixture() {
        let dir = tempfile::tempdir().unwrap();
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../fixtures/animation/mixamo-chest-sway.fbx"
        );
        let staged = crate::assets::stage_animation(dir.path(), std::path::Path::new(path)).unwrap();
        assert!(staged.id().starts_with("animation_"));
    }
}
