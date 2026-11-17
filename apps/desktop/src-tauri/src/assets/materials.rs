//! The material list of a glTF document with the model value of each parameter (B38 R13, R15).
//! Keep in step with `materialEntries` in `packages/contracts/src/materials.ts`; `fixtures/protocol/material-names.json` pins both.
use super::vrm::unique_name;
use opensekai_contracts::{
    AssetMaterial, MaterialModel, MaterialProfile, MAX_MATERIALS, MAX_MATERIAL_NAME,
};
use serde_json::Value;
use std::collections::HashSet;

type Rgb = [f64; 3];
const BLACK: Rgb = [0.0, 0.0, 0.0];
const WHITE: Rgb = [1.0, 1.0, 1.0];

/// The first three items of a factor when each is a finite number, else the fallback.
fn factor(value: &Value, fallback: Rgb) -> Rgb {
    let Some(items) = value.as_array().filter(|a| a.len() >= 3) else {
        return fallback;
    };
    let mut rgb = [0.0; 3];
    for (slot, item) in rgb.iter_mut().zip(items) {
        match item.as_f64().filter(|n| n.is_finite()) {
            Some(n) => *slot = n,
            None => return fallback,
        }
    }
    rgb
}
fn number_or(value: &Value, fallback: f64) -> f64 {
    value.as_f64().filter(|n| n.is_finite()).unwrap_or(fallback)
}
/// The fourth item of a color factor, else 1.
fn alpha(value: &Value) -> f64 {
    number_or(&value[3], 1.0)
}
/// JavaScript truthiness of a JSON value.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}
/// The three.js linear-sRGB to sRGB transfer and the `Color.getHex` rounding (three 0.187.0).
fn channel(linear: f64) -> u8 {
    let srgb = if linear < 0.0031308 {
        linear * 12.92
    } else {
        1.055 * linear.powf(0.41666) - 0.055
    };
    let byte = (srgb * 255.0).clamp(0.0, 255.0).round();
    if byte.is_finite() {
        byte as u8
    } else {
        0
    }
}
/// The lowercase `#rrggbb` of a linear color factor.
pub(super) fn linear_hex(rgb: Rgb) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        channel(rgb[0]),
        channel(rgb[1]),
        channel(rgb[2])
    )
}
/// three-vrm v0compat `gammaEOTF`.
fn gamma(v: f64) -> f64 {
    v.powf(2.2)
}

struct Values {
    base: Rgb,
    opacity: f64,
    blend: bool,
    emission: Rgb,
    strength: f64,
    shade: Rgb,
    rim: Rgb,
    /// `None` when three-vrm reads no string mode.
    outline_mode: Option<String>,
    outline_width: f64,
    outline_color: Rgb,
}
/// three-vrm v0compat `_parseV0MToonProperties` and `_parseV0UnlitProperties`.
fn v0_values(props: &Value, shader: &str) -> Values {
    let vectors = &props["vectorProperties"];
    let floats = &props["floatProperties"];
    let color = |key: &str, fallback: Rgb| factor(&vectors[key], fallback).map(gamma);
    if shader != "VRM/MToon" {
        // The Unlit form applies the gamma to the alpha too.
        return Values {
            base: color("_Color", WHITE),
            opacity: gamma(alpha(&vectors["_Color"])),
            blend: shader == "VRM/UnlitTransparent" || shader == "VRM/UnlitTransparentZWrite",
            emission: BLACK,
            strength: 1.0,
            shade: BLACK,
            rim: BLACK,
            outline_mode: Some("none".into()),
            outline_width: 0.0,
            outline_color: BLACK,
        };
    }
    let mode = match &floats["_OutlineWidthMode"] {
        Value::Null => Some(0.0),
        value => value.as_f64(),
    };
    let outline_mode = match mode {
        Some(n) if n == 0.0 => Some("none"),
        Some(n) if n == 1.0 => Some("worldCoordinates"),
        Some(n) if n == 2.0 => Some("screenCoordinates"),
        _ => None,
    };
    Values {
        base: color("_Color", WHITE),
        // The MToon form keeps the alpha linear.
        opacity: alpha(&vectors["_Color"]),
        blend: truthy(&props["keywordMap"]["_ALPHABLEND_ON"]),
        emission: color("_EmissionColor", BLACK),
        strength: 1.0,
        shade: color("_ShadeColor", [0.97, 0.81, 0.86]),
        rim: color("_RimColor", BLACK),
        outline_mode: outline_mode.map(String::from),
        outline_width: 0.01 * number_or(&floats["_OutlineWidth"], 0.0),
        outline_color: color("_OutlineColor", BLACK),
    }
}
/// A glTF or VRM 1 material, with the GLTFLoader and three-vrm MToon defaults.
fn gltf_values(material: &Value) -> Values {
    let base = &material["pbrMetallicRoughness"]["baseColorFactor"];
    let extensions = &material["extensions"];
    let mtoon = &extensions["VRMC_materials_mtoon"];
    let strength = number_or(
        &extensions["KHR_materials_emissive_strength"]["emissiveStrength"],
        1.0,
    );
    Values {
        base: factor(base, WHITE),
        opacity: alpha(base),
        blend: material["alphaMode"] == "BLEND",
        emission: factor(&material["emissiveFactor"], BLACK),
        // The three-vrm multiplier plugin runs after the GLTFLoader strength plugin, so the multiplier wins.
        strength: number_or(
            &extensions["VRMC_materials_hdr_emissiveMultiplier"]["emissiveMultiplier"],
            strength,
        ),
        shade: factor(&mtoon["shadeColorFactor"], BLACK),
        rim: factor(&mtoon["parametricRimColorFactor"], BLACK),
        outline_mode: match &mtoon["outlineWidthMode"] {
            Value::Null => Some("none".into()),
            value => value.as_str().map(String::from),
        },
        outline_width: number_or(&mtoon["outlineWidthFactor"], 0.0),
        outline_color: factor(&mtoon["outlineColorFactor"], BLACK),
    }
}
/// The `materialReport` profile rule.
fn profile(material: &Value, v0_shader: Option<&str>) -> MaterialProfile {
    let has = |name: &str| {
        material["extensions"]
            .as_object()
            .is_some_and(|e| e.contains_key(name))
    };
    if has("VRMC_materials_mtoon") || v0_shader == Some("VRM/MToon") {
        MaterialProfile::Mtoon
    } else if has("KHR_materials_unlit") || v0_shader.is_some_and(|s| s.starts_with("VRM/Unlit")) {
        MaterialProfile::Unlit
    } else {
        MaterialProfile::Pbr
    }
}

/// R13: the materials of a glTF document in material order (the first 256), each with a unique name and its model values.
pub(super) fn model_materials(json: &Value) -> Vec<AssetMaterial> {
    let materials = json["materials"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let v0 = json["extensions"]["VRM"]["materialProperties"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut taken = HashSet::new();
    let mut entries = Vec::new();
    for (index, value) in materials.iter().enumerate().take(MAX_MATERIALS) {
        let Ok(index) = u32::try_from(index) else {
            break;
        };
        // The report reads a material that is not an object as an empty one.
        let empty = Value::Object(Default::default());
        let material = if value.is_object() { value } else { &empty };
        let props = v0.get(index as usize).filter(|p| p.is_object());
        let shader = props.and_then(|p| p["shader"].as_str());
        let profile = profile(material, shader);
        let values = match (props, shader) {
            (Some(props), Some(shader))
                if shader == "VRM/MToon" || shader.starts_with("VRM/Unlit") =>
            {
                v0_values(props, shader)
            }
            _ => gltf_values(material),
        };
        // three-vrm `_shouldGenerateOutline`.
        let outline = profile == MaterialProfile::Mtoon
            && values.outline_mode.as_deref().is_some_and(|m| m != "none")
            && values.outline_width > 0.0;
        let mut entry = AssetMaterial {
            index,
            name: unique_name(
                &material["name"],
                &format!("Material {index}"),
                MAX_MATERIAL_NAME,
                &mut taken,
            ),
            profile,
            blend: values.blend,
            outline,
            model: MaterialModel::default(),
        };
        let applies = |key: &str| entry.applies(key);
        let model = MaterialModel {
            base_color: Some(linear_hex(values.base)),
            opacity: applies("opacity").then(|| values.opacity.clamp(0.0, 1.0)),
            emission_color: applies("emissionColor").then(|| linear_hex(values.emission)),
            emission_strength: applies("emissionStrength")
                .then(|| values.strength.clamp(0.0, 100.0)),
            shade_color: applies("shadeColor").then(|| linear_hex(values.shade)),
            rim_color: applies("rimColor").then(|| linear_hex(values.rim)),
            outline_color: applies("outlineColor").then(|| linear_hex(values.outline_color)),
            outline_width: applies("outlineWidth").then(|| values.outline_width.clamp(0.0, 0.05)),
        };
        entry.model = model;
        entries.push(entry);
    }
    if materials.len() > MAX_MATERIALS {
        eprintln!(
            "OpenSekai keeps the first {MAX_MATERIALS} of {} materials",
            materials.len()
        );
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Each number as an f64, so the integer `1` of the vectors equals the `1.0` of an f64 field.
    fn floats(value: Value) -> Value {
        match value {
            Value::Number(n) => serde_json::json!(n.as_f64().unwrap()),
            Value::Array(items) => Value::Array(items.into_iter().map(floats).collect()),
            Value::Object(map) => {
                Value::Object(map.into_iter().map(|(k, v)| (k, floats(v))).collect())
            }
            other => other,
        }
    }
    #[test]
    fn material_lists_match_the_shared_vectors() {
        let vectors: Value = serde_json::from_str(include_str!(
            "../../../../../fixtures/protocol/material-names.json"
        ))
        .unwrap();
        for case in vectors["cases"].as_array().unwrap() {
            let entries = model_materials(&case["json"]);
            assert!(
                opensekai_contracts::asset_materials_ok(&entries),
                "{}",
                case["name"]
            );
            assert_eq!(
                floats(serde_json::to_value(entries).unwrap()),
                floats(case["expected"].clone()),
                "{}",
                case["name"]
            );
        }
    }
    #[test]
    fn hex_uses_the_three_js_transfer_and_rounding() {
        assert_eq!(linear_hex([0.0, 1.0, 0.5]), "#00ffbc");
        assert_eq!(linear_hex([-1.0, 2.0, f64::NAN]), "#00ff00");
        assert_eq!(linear_hex([0.002, 0.0031308, 0.214]), "#070a7f");
    }
    #[test]
    fn a_document_without_materials_has_an_empty_list() {
        assert!(model_materials(&serde_json::json!({})).is_empty());
        assert!(model_materials(&serde_json::json!({ "materials": "x" })).is_empty());
    }
}
