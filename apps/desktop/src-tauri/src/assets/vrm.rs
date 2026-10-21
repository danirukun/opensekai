//! VRM document checks that read the glTF JSON: humanoid rig diagnostics and expression names.
use opensekai_contracts::{
    is_tracked_expression, AppError, AssetExpression, ErrorCode, MAX_EXPRESSIONS,
};
use serde::de::{Deserializer, IgnoredAny, MapAccess, Visitor};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;

const REQUIRED_BONES: [&str; 15] = [
    "hips",
    "spine",
    "head",
    "leftUpperLeg",
    "leftLowerLeg",
    "leftFoot",
    "rightUpperLeg",
    "rightLowerLeg",
    "rightFoot",
    "leftUpperArm",
    "leftLowerArm",
    "leftHand",
    "rightUpperArm",
    "rightLowerArm",
    "rightHand",
];
/// The most bone names that one diagnostic message lists. `ids` carries all of them.
const LISTED: usize = 8;

fn rig_error(message: &str, mut names: Vec<String>) -> AppError {
    names.sort();
    names.dedup();
    let shown = names
        .iter()
        .take(LISTED)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    let more = names.len().saturating_sub(LISTED);
    AppError {
        code: ErrorCode::InvalidInput,
        message: if more > 0 {
            format!("{message}: {shown} and {more} more")
        } else {
            format!("{message}: {shown}")
        },
        ids: names,
    }
}

/// Checks the humanoid of a VRM 1.0 or 0.x document. Each error names the bones that fail.
pub(super) fn validate_humanoid(json: &Value, vrm0: bool) -> Result<(), AppError> {
    let invalid = |message: &str| AppError {
        code: ErrorCode::InvalidInput,
        message: message.into(),
        ids: vec![],
    };
    let nodes = json
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Missing VRM nodes"))?;
    let bones: Vec<(String, Option<&Value>)> = if vrm0 {
        json.pointer("/extensions/VRM/humanoid/humanBones")
            .and_then(Value::as_array)
            .map(|b| {
                b.iter()
                    .map(|v| {
                        (
                            v.get("bone")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            v.get("node"),
                        )
                    })
                    .collect()
            })
    } else {
        json.pointer("/extensions/VRMC_vrm/humanoid/humanBones")
            .and_then(Value::as_object)
            .map(|b| {
                b.iter()
                    .map(|(name, v)| (name.clone(), v.get("node")))
                    .collect()
            })
    }
    .filter(|bones: &Vec<_>| !bones.is_empty())
    .ok_or_else(|| invalid("Missing VRM humanoid"))?;
    let known = |name: &str| {
        opensekai_contracts::humanoid_bone(name)
            || (vrm0 && ["leftThumbIntermediate", "rightThumbIntermediate"].contains(&name))
    };
    let unknown: Vec<String> = bones
        .iter()
        .filter(|(name, _)| !known(name))
        .map(|(name, _)| {
            if name.is_empty() {
                "(empty)".into()
            } else {
                name.clone()
            }
        })
        .collect();
    if !unknown.is_empty() {
        return Err(rig_error("Unknown VRM humanoid bones", unknown));
    }
    let mut seen = HashSet::new();
    let duplicate: Vec<String> = bones
        .iter()
        .filter(|(name, _)| !seen.insert(name.as_str()))
        .map(|(name, _)| name.clone())
        .collect();
    if !duplicate.is_empty() {
        return Err(rig_error("Duplicate VRM humanoid bones", duplicate));
    }
    let missing: Vec<String> = REQUIRED_BONES
        .iter()
        .copied()
        .chain(vrm0.then_some("chest"))
        .filter(|required| !bones.iter().any(|(name, _)| name == required))
        .map(String::from)
        .collect();
    if !missing.is_empty() {
        return Err(rig_error("Missing VRM humanoid bones", missing));
    }
    let bad_node: Vec<String> = bones
        .iter()
        .filter(|(_, node)| {
            node.and_then(Value::as_u64)
                .is_none_or(|n| n >= nodes.len() as u64)
        })
        .map(|(name, _)| name.clone())
        .collect();
    if !bad_node.is_empty() {
        return Err(rig_error("VRM humanoid bones have no valid node", bad_node));
    }
    let mut by_node: std::collections::HashMap<u64, Vec<String>> = Default::default();
    for (name, node) in &bones {
        if let Some(node) = node.and_then(Value::as_u64) {
            by_node.entry(node).or_default().push(name.clone());
        }
    }
    let shared: Vec<String> = by_node
        .into_values()
        .filter(|names| names.len() > 1)
        .flatten()
        .collect();
    if !shared.is_empty() {
        return Err(rig_error("VRM humanoid bones share one node", shared));
    }
    Ok(())
}

/// The keys of a JSON object in document order. `serde_json::Value` sorts keys, so the expression list reads them here.
struct OrderedKeys(Vec<String>);
impl<'de> Deserialize<'de> for OrderedKeys {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Keys;
        impl<'de> Visitor<'de> for Keys {
            type Value = OrderedKeys;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("an object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<OrderedKeys, A::Error> {
                let mut keys = Vec::new();
                while let Some(key) = map.next_key::<String>()? {
                    map.next_value::<IgnoredAny>()?;
                    keys.push(key);
                }
                Ok(OrderedKeys(keys))
            }
        }
        deserializer.deserialize_map(Keys)
    }
}
#[derive(Deserialize)]
struct Document {
    extensions: Option<Extensions>,
}
#[derive(Deserialize)]
struct Extensions {
    #[serde(rename = "VRMC_vrm")]
    vrm1: Option<Vrm1>,
}
#[derive(Deserialize)]
struct Vrm1 {
    expressions: Option<Vrm1Expressions>,
}
#[derive(Deserialize)]
struct Vrm1Expressions {
    preset: Option<OrderedKeys>,
    custom: Option<OrderedKeys>,
}

fn vrm0_name(preset: &str) -> Option<&'static str> {
    Some(match preset {
        "joy" => "happy",
        "angry" => "angry",
        "sorrow" => "sad",
        "fun" => "relaxed",
        "a" => "aa",
        "i" => "ih",
        "u" => "ou",
        "e" => "ee",
        "o" => "oh",
        "blink" => "blink",
        "blink_l" => "blinkLeft",
        "blink_r" => "blinkRight",
        "lookup" => "lookUp",
        "lookdown" => "lookDown",
        "lookleft" => "lookLeft",
        "lookright" => "lookRight",
        "neutral" => "neutral",
        _ => return None,
    })
}

/// The triggerable expression names of a VRM document, in document order. `raw` is the JSON chunk that `json` was parsed from.
/// Names that tracking drives are dropped before the limit, as Warudo imports every other VRM expression.
pub(super) fn vrm_expressions(json: &Value, raw: &[u8]) -> Vec<AssetExpression> {
    let entries: Vec<(String, bool)> = if json.pointer("/extensions/VRMC_vrm").is_some() {
        serde_json::from_slice::<Document>(raw)
            .ok()
            .and_then(|d| d.extensions?.vrm1?.expressions)
            .map(|e| {
                let preset = e.preset.map(|k| k.0).unwrap_or_default();
                let custom = e.custom.map(|k| k.0).unwrap_or_default();
                preset
                    .into_iter()
                    .map(|name| (name, true))
                    .chain(custom.into_iter().map(|name| (name, false)))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        json.pointer("/extensions/VRM/blendShapeMaster/blendShapeGroups")
            .and_then(Value::as_array)
            .map(|groups| {
                groups
                    .iter()
                    .map(|group| {
                        let name = group.get("name").and_then(Value::as_str).unwrap_or("");
                        match group
                            .get("presetName")
                            .and_then(Value::as_str)
                            .and_then(|p| vrm0_name(&p.to_ascii_lowercase()))
                        {
                            Some(preset) => (preset.to_string(), true),
                            None => (name.to_string(), false),
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut seen = HashSet::new();
    entries
        .into_iter()
        .filter(|(name, _)| {
            (1..=128).contains(&name.encode_utf16().count())
                && !is_tracked_expression(name)
                && seen.insert(name.clone())
        })
        .take(MAX_EXPRESSIONS)
        .map(|(name, preset)| AssetExpression { name, preset })
        .collect()
}

/// True when the humanoid lists both eye bones, in a VRM 1.0 or 0.x document.
pub(super) fn vrm_has_eye_bones(json: &Value) -> bool {
    let has = |name: &str| match json.pointer("/extensions/VRMC_vrm/humanoid/humanBones") {
        Some(Value::Object(bones)) => bones.contains_key(name),
        _ => json
            .pointer("/extensions/VRM/humanoid/humanBones")
            .and_then(Value::as_array)
            .is_some_and(|bones| {
                bones
                    .iter()
                    .any(|b| b.get("bone").and_then(Value::as_str) == Some(name))
            }),
    };
    has("leftEye") && has("rightEye")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn vrm1() -> Value {
        serde_json::from_str(include_str!("../../tests/fixtures/minimal-vrm1.json")).unwrap()
    }
    fn vrm0() -> Value {
        serde_json::from_str(include_str!("../../tests/fixtures/minimal-vrm0.json")).unwrap()
    }
    #[test]
    fn eye_bones_need_both_eyes() {
        let mut v1 = vrm1();
        assert!(!vrm_has_eye_bones(&v1));
        let bones = v1["extensions"]["VRMC_vrm"]["humanoid"]["humanBones"]
            .as_object_mut()
            .unwrap();
        bones.insert("leftEye".into(), serde_json::json!({"node": 0}));
        assert!(!vrm_has_eye_bones(&v1));
        v1["extensions"]["VRMC_vrm"]["humanoid"]["humanBones"]
            .as_object_mut()
            .unwrap()
            .insert("rightEye".into(), serde_json::json!({"node": 0}));
        assert!(vrm_has_eye_bones(&v1));
        let mut v0 = vrm0();
        assert!(!vrm_has_eye_bones(&v0));
        let list = v0["extensions"]["VRM"]["humanoid"]["humanBones"]
            .as_array_mut()
            .unwrap();
        list.push(serde_json::json!({"bone": "leftEye", "node": 0}));
        list.push(serde_json::json!({"bone": "rightEye", "node": 0}));
        assert!(vrm_has_eye_bones(&v0));
    }
    #[test]
    fn humanoid_errors_name_the_failing_bones() {
        assert!(validate_humanoid(&vrm1(), false).is_ok());
        assert!(validate_humanoid(&vrm0(), true).is_ok());
        let mut missing = vrm1();
        let bones = missing["extensions"]["VRMC_vrm"]["humanoid"]["humanBones"]
            .as_object_mut()
            .unwrap();
        bones.remove("head");
        bones.remove("leftHand");
        let error = validate_humanoid(&missing, false).unwrap_err();
        assert_eq!(error.message, "Missing VRM humanoid bones: head, leftHand");
        assert_eq!(error.ids, ["head", "leftHand"]);

        let mut shared = vrm1();
        shared["extensions"]["VRMC_vrm"]["humanoid"]["humanBones"]["head"]["node"] =
            serde_json::json!(0);
        let error = validate_humanoid(&shared, false).unwrap_err();
        assert_eq!(
            error.message,
            "VRM humanoid bones share one node: head, hips"
        );

        let mut unknown = vrm1();
        unknown["extensions"]["VRMC_vrm"]["humanoid"]["humanBones"]["tail"] =
            serde_json::json!({"node": 0});
        assert_eq!(
            validate_humanoid(&unknown, false).unwrap_err().message,
            "Unknown VRM humanoid bones: tail"
        );

        let mut out_of_range = vrm1();
        out_of_range["extensions"]["VRMC_vrm"]["humanoid"]["humanBones"]["head"]["node"] =
            serde_json::json!(999);
        assert_eq!(
            validate_humanoid(&out_of_range, false).unwrap_err().ids,
            ["head"]
        );

        let mut no_chest = vrm0();
        no_chest["extensions"]["VRM"]["humanoid"]["humanBones"]
            .as_array_mut()
            .unwrap()
            .retain(|bone| bone["bone"] != "chest");
        assert_eq!(
            validate_humanoid(&no_chest, true).unwrap_err().message,
            "Missing VRM humanoid bones: chest"
        );

        let mut duplicate = vrm0();
        let list = duplicate["extensions"]["VRM"]["humanoid"]["humanBones"]
            .as_array_mut()
            .unwrap();
        list.push(list[0].clone());
        let error = validate_humanoid(&duplicate, true).unwrap_err();
        assert!(error.message.starts_with("Duplicate VRM humanoid bones: "));
        assert_eq!(error.ids.len(), 1);
    }
    #[test]
    fn long_bone_lists_are_shortened_in_the_message() {
        let mut empty = vrm1();
        let bones = empty["extensions"]["VRMC_vrm"]["humanoid"]["humanBones"]
            .as_object_mut()
            .unwrap();
        bones.retain(|name, _| name == "hips");
        let error = validate_humanoid(&empty, false).unwrap_err();
        assert_eq!(error.ids.len(), 14);
        assert!(error.message.ends_with(" and 6 more"), "{}", error.message);
    }
    #[test]
    fn vrm1_expressions_keep_document_order_presets_first() {
        let raw = br#"{"extensions":{"VRMC_vrm":{"expressions":{
            "custom":{"Wink":{},"Angry2":{},"":{}},
            "preset":{"happy":{},"blink":{},"aa":{},"surprised":{}}}}}}"#;
        let json: Value = serde_json::from_slice(raw).unwrap();
        let names: Vec<_> = vrm_expressions(&json, raw)
            .into_iter()
            .map(|e| (e.name, e.preset))
            .collect();
        assert_eq!(
            names,
            [
                ("happy".into(), true),
                ("surprised".into(), true),
                ("Wink".into(), false),
                ("Angry2".into(), false)
            ]
        );
    }
    #[test]
    fn vrm0_expressions_map_presets_and_drop_duplicates() {
        let raw = br#"{"extensions":{"VRM":{"blendShapeMaster":{"blendShapeGroups":[
            {"name":"Joy","presetName":"joy"},
            {"name":"A","presetName":"a"},
            {"name":"Blink_L","presetName":"blink_l"},
            {"name":"Smirk","presetName":"unknown"},
            {"name":"Tears"},
            {"name":"Smirk","presetName":"unknown"},
            {"name":"","presetName":"unknown"}]}}}}"#;
        let json: Value = serde_json::from_slice(raw).unwrap();
        let names: Vec<_> = vrm_expressions(&json, raw)
            .into_iter()
            .map(|e| (e.name, e.preset))
            .collect();
        assert_eq!(
            names,
            [
                ("happy".into(), true),
                ("Smirk".into(), false),
                ("Tears".into(), false)
            ]
        );
    }
    #[test]
    fn tracked_names_do_not_use_the_limit() {
        // The layout of a perfect sync VRM 0.x model: presets, visemes, and the 52 ARKit clips before the modeler clips.
        let group =
            |name: &str, preset: &str| format!(r#"{{"name":"{name}","presetName":"{preset}"}}"#);
        let groups: Vec<String> = [group("Blink", "blink"), group("A", "a")]
            .into_iter()
            .chain(
                ["SIL", "PP", "FF", "TH", "DD", "KK", "CH", "SS", "NN", "RR"]
                    .map(|name| group(name, "unknown")),
            )
            .chain(opensekai_contracts::ARKIT_NAMES.map(|name| group(name, "unknown")))
            .chain([group("Joy", "joy"), group("ToggleHat", "unknown")])
            .collect();
        assert!(groups.len() > MAX_EXPRESSIONS);
        let raw = format!(
            r#"{{"extensions":{{"VRM":{{"blendShapeMaster":{{"blendShapeGroups":[{}]}}}}}}}}"#,
            groups.join(",")
        );
        let json: Value = serde_json::from_str(&raw).unwrap();
        let names: Vec<_> = vrm_expressions(&json, raw.as_bytes())
            .into_iter()
            .map(|e| (e.name, e.preset))
            .collect();
        assert_eq!(names, [("happy".into(), true), ("ToggleHat".into(), false)]);
    }
    #[test]
    fn expressions_stop_at_the_limit_and_tolerate_bad_shapes() {
        let custom: Vec<String> = (0..70).map(|i| format!("\"c{i}\":{{}}")).collect();
        let raw = format!(
            r#"{{"extensions":{{"VRMC_vrm":{{"expressions":{{"custom":{{{}}}}}}}}}}}"#,
            custom.join(",")
        );
        let json: Value = serde_json::from_str(&raw).unwrap();
        let list = vrm_expressions(&json, raw.as_bytes());
        assert_eq!(list.len(), MAX_EXPRESSIONS);
        assert_eq!(list[63].name, "c63");
        let raw = br#"{"extensions":{"VRMC_vrm":{"expressions":{"preset":[1,2]}}}}"#;
        let json: Value = serde_json::from_slice(raw).unwrap();
        assert!(vrm_expressions(&json, raw).is_empty());
    }
}
