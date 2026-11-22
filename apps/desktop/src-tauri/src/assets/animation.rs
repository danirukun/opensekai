//! Prepare a `AssetAnimation` from a VRMA (GLB + `VRMC_vrm_animation`).
//! Slice 1 stores humanoid rotation tracks mapped by bone name from the glTF
//! samplers. Rest-pose world-matrix retarget (ThreeVRM) remains a later quality step.
use opensekai_contracts::{
    invalid, AppError, AssetAnimation, AssetAnimationTrack, ErrorCode, HUMANOID_BONES,
    MAX_ANIMATION_BONES, MAX_ANIMATION_DURATION_MS, MAX_ANIMATION_KEYS,
};
use serde_json::Value;
use std::collections::BTreeMap;

const COMPONENT_FLOAT: u32 = 5126;

/// Returns the BIN chunk of a validated GLB, or an empty slice when the file has none.
pub fn glb_bin_chunk(bytes: &[u8]) -> Result<&[u8], AppError> {
    if bytes.len() < 20 {
        return Err(invalid("Invalid GLB"));
    }
    let mut offset = 12usize;
    let mut bin: &[u8] = &[];
    while offset + 8 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let kind = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap());
        offset += 8;
        let end = offset
            .checked_add(size)
            .ok_or_else(|| invalid("Invalid GLB chunk"))?;
        if end > bytes.len() {
            return Err(invalid("Invalid GLB chunk"));
        }
        if kind == 0x004e4942 {
            bin = &bytes[offset..end];
        }
        offset = end;
    }
    Ok(bin)
}

pub fn prepare_animation(json: &Value, bin: &[u8]) -> Result<AssetAnimation, AppError> {
    let used = json
        .get("extensionsUsed")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("VRMA needs extensionsUsed"))?;
    if !used.iter().any(|v| v.as_str() == Some("VRMC_vrm_animation")) {
        return Err(invalid("VRMA needs VRMC_vrm_animation"));
    }
    let human_bones = json
        .pointer("/extensions/VRMC_vrm_animation/humanoid/humanBones")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("VRMA needs humanoid bones"))?;
    let mut node_to_bone = BTreeMap::<usize, String>::new();
    for (name, bone) in human_bones {
        if !HUMANOID_BONES.contains(&name.as_str()) {
            continue;
        }
        let Some(node) = bone.get("node").and_then(Value::as_u64) else {
            continue;
        };
        node_to_bone.insert(node as usize, name.clone());
    }
    if node_to_bone.is_empty() {
        return Err(invalid("VRMA has no mapped humanoid bones"));
    }
    let animations = json
        .get("animations")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("VRMA has no animations"))?;
    let animation = animations
        .first()
        .ok_or_else(|| invalid("VRMA has no animations"))?;
    let channels = animation
        .get("channels")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("VRMA animation has no channels"))?;
    let samplers = animation
        .get("samplers")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("VRMA animation has no samplers"))?;
    let mut bones = BTreeMap::new();
    let mut duration_sec = 0.0_f64;
    for channel in channels {
        let path = channel
            .pointer("/target/path")
            .and_then(Value::as_str)
            .unwrap_or("");
        if path != "rotation" {
            continue;
        }
        let Some(node) = channel
            .pointer("/target/node")
            .and_then(Value::as_u64)
            .map(|n| n as usize)
        else {
            continue;
        };
        let Some(bone_name) = node_to_bone.get(&node) else {
            continue;
        };
        let Some(sampler_index) = channel.get("sampler").and_then(Value::as_u64) else {
            continue;
        };
        let Some(sampler) = samplers.get(sampler_index as usize) else {
            return Err(invalid("VRMA sampler is missing"));
        };
        let Some(input) = sampler.get("input").and_then(Value::as_u64) else {
            return Err(invalid("VRMA sampler input is missing"));
        };
        let Some(output) = sampler.get("output").and_then(Value::as_u64) else {
            return Err(invalid("VRMA sampler output is missing"));
        };
        let times = read_floats(json, bin, input as usize, 1)?;
        let rotations = read_floats(json, bin, output as usize, 4)?;
        if times.is_empty() || rotations.len() != times.len() * 4 {
            return Err(invalid("VRMA rotation track length mismatch"));
        }
        if times.len() > MAX_ANIMATION_KEYS {
            return Err(invalid("VRMA track has too many keys"));
        }
        for window in times.windows(2) {
            if !(window[0].is_finite() && window[1].is_finite() && window[1] >= window[0] && window[0] >= 0.0)
            {
                return Err(invalid("VRMA track times must be nondecreasing"));
            }
        }
        if times[0] < 0.0 || !times[0].is_finite() {
            return Err(invalid("VRMA track times must be nondecreasing"));
        }
        for i in 0..times.len() {
            let o = i * 4;
            let (x, y, z, w) = (
                rotations[o],
                rotations[o + 1],
                rotations[o + 2],
                rotations[o + 3],
            );
            if !(x.is_finite() && y.is_finite() && z.is_finite() && w.is_finite()) {
                return Err(invalid("VRMA rotation is not finite"));
            }
            let len = (x * x + y * y + z * z + w * w).sqrt();
            if (len - 1.0).abs() > 0.01 {
                return Err(invalid("VRMA rotation is not a unit quaternion"));
            }
        }
        duration_sec = duration_sec.max(*times.last().unwrap_or(&0.0));
        bones.insert(
            bone_name.clone(),
            AssetAnimationTrack { times, rotations },
        );
        if bones.len() > MAX_ANIMATION_BONES {
            return Err(invalid("VRMA has too many humanoid bones"));
        }
    }
    if bones.is_empty() {
        return Err(invalid("VRMA has no humanoid rotation tracks"));
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

fn read_floats(json: &Value, bin: &[u8], accessor_index: usize, components: usize) -> Result<Vec<f64>, AppError> {
    let accessors = json
        .get("accessors")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("VRMA missing accessors"))?;
    let accessor = accessors
        .get(accessor_index)
        .ok_or_else(|| invalid("VRMA accessor is missing"))?;
    let component_type = accessor
        .get("componentType")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("VRMA accessor componentType"))? as u32;
    if component_type != COMPONENT_FLOAT {
        return Err(invalid("VRMA accessor must be FLOAT"));
    }
    let count = accessor
        .get("count")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("VRMA accessor count"))? as usize;
    let view_index = accessor
        .get("bufferView")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("VRMA accessor bufferView"))? as usize;
    let views = json
        .get("bufferViews")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("VRMA missing bufferViews"))?;
    let view = views
        .get(view_index)
        .ok_or_else(|| invalid("VRMA bufferView is missing"))?;
    let byte_offset = view
        .get("byteOffset")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize
        + accessor
            .get("byteOffset")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize;
    let stride = view
        .get("byteStride")
        .and_then(Value::as_u64)
        .map(|v| v as usize)
        .unwrap_or(components * 4);
    let needed = byte_offset
        .checked_add(count.saturating_sub(1).saturating_mul(stride).saturating_add(components * 4))
        .ok_or_else(|| invalid("VRMA buffer overflow"))?;
    if needed > bin.len() {
        return Err(invalid("VRMA buffer overflow"));
    }
    let mut out = Vec::with_capacity(count * components);
    for i in 0..count {
        let start = byte_offset + i * stride;
        for c in 0..components {
            let o = start + c * 4;
            let raw: [u8; 4] = bin[o..o + 4]
                .try_into()
                .map_err(|_| invalid("VRMA buffer overflow"))?;
            out.push(f32::from_le_bytes(raw) as f64);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::registry::validate_glb;

    fn glb_with_json(json: &[u8], bin: &[u8]) -> Vec<u8> {
        let mut json = json.to_vec();
        while !json.len().is_multiple_of(4) {
            json.push(b' ');
        }
        let mut bin = bin.to_vec();
        while !bin.len().is_multiple_of(4) {
            bin.push(0);
        }
        let mut bytes = b"glTF".to_vec();
        let total = 12 + 8 + json.len() + 8 + bin.len();
        bytes.extend(2u32.to_le_bytes());
        bytes.extend((total as u32).to_le_bytes());
        bytes.extend((json.len() as u32).to_le_bytes());
        bytes.extend(0x4e4f534au32.to_le_bytes());
        bytes.extend(&json);
        bytes.extend((bin.len() as u32).to_le_bytes());
        bytes.extend(0x004e4942u32.to_le_bytes());
        bytes.extend(&bin);
        bytes
    }

    #[test]
    fn prepares_chest_rotation_track() {
        // times: 0, 1 ; quats: identity, 90° about Z
        let mut bin = Vec::new();
        for v in [0.0f32, 1.0] {
            bin.extend(v.to_le_bytes());
        }
        for v in [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, std::f32::consts::FRAC_1_SQRT_2, std::f32::consts::FRAC_1_SQRT_2] {
            bin.extend(v.to_le_bytes());
        }
        let json = br#"{
            "asset":{"version":"2.0"},
            "extensionsUsed":["VRMC_vrm_animation"],
            "extensions":{"VRMC_vrm_animation":{"specVersion":"1.0","humanoid":{"humanBones":{"chest":{"node":0}}}}},
            "nodes":[{"name":"chest"}],
            "animations":[{"channels":[{"sampler":0,"target":{"node":0,"path":"rotation"}}],"samplers":[{"input":0,"output":1,"interpolation":"LINEAR"}]}],
            "accessors":[
                {"bufferView":0,"componentType":5126,"count":2,"type":"SCALAR"},
                {"bufferView":1,"componentType":5126,"count":2,"type":"VEC4"}
            ],
            "bufferViews":[
                {"buffer":0,"byteOffset":0,"byteLength":8},
                {"buffer":0,"byteOffset":8,"byteLength":32}
            ],
            "buffers":[{"byteLength":40}]
        }"#;
        let bytes = glb_with_json(json, &bin);
        let parsed = validate_glb(&bytes).unwrap();
        let bin_chunk = &bytes[12 + 8 + {
            let mut j = json.to_vec();
            while !j.len().is_multiple_of(4) {
                j.push(b' ');
            }
            j.len()
        } + 8..];
        let animation = prepare_animation(&parsed, bin_chunk).unwrap();
        assert_eq!(animation.duration_ms, 1000);
        assert!(animation.bones.contains_key("chest"));
        assert_eq!(animation.bones["chest"].times, vec![0.0, 1.0]);
    }

    #[test]
    fn rejects_missing_extension() {
        let json = br#"{"asset":{"version":"2.0"},"extensionsUsed":[],"nodes":[],"animations":[]}"#;
        let bytes = glb_with_json(json, &[]);
        let parsed = validate_glb(&bytes).unwrap();
        assert!(prepare_animation(&parsed, &[]).is_err());
    }
}
