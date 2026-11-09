mod image;
mod registry;
mod scene_import;
mod vrm;
pub use image::{parse_image, ImageHeader};
pub use registry::{
    prepare_scene, read_located, resolve_asset, stage_avatar, stage_image, stage_scene,
    AssetRegistry, ImportResult, PreparedScene, StagedAsset,
};
pub use scene_import::{pack_scene, Limits, PackedScene};

use opensekai_contracts::{invalid, AppError};
use serde_json::Value;

// Extensions that three.js 0.180 GLTFLoader handles without an extra decoder in this renderer.
const SUPPORTED_REQUIRED: &[&str] = &[
    "KHR_materials_anisotropy",
    "KHR_materials_clearcoat",
    "KHR_materials_dispersion",
    "KHR_materials_emissive_strength",
    "KHR_materials_ior",
    "KHR_materials_iridescence",
    "KHR_materials_sheen",
    "KHR_materials_specular",
    "KHR_materials_transmission",
    "KHR_materials_unlit",
    "KHR_materials_volume",
    "KHR_mesh_quantization",
    "KHR_texture_transform",
    "KHR_lights_punctual",
    "EXT_materials_bump",
    "EXT_texture_avif",
    "EXT_texture_webp",
    "EXT_mesh_gpu_instancing",
];
// Extensions that three-vrm reads in addition, for a VRM import.
const VRM_REQUIRED: &[&str] = &[
    "VRMC_vrm",
    "VRMC_springBone",
    "VRMC_node_constraint",
    "VRMC_materials_mtoon",
    "VRMC_materials_hdr_emissiveMultiplier",
    "VRM",
];

/// Rejects a glTF whose `extensionsRequired` names an extension that the renderer cannot read.
fn check_required(json: &Value, extra: &[&str]) -> Result<(), AppError> {
    for name in json
        .get("extensionsRequired")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = name.as_str().unwrap_or("");
        if !SUPPORTED_REQUIRED.contains(&name) && !extra.contains(&name) {
            return Err(invalid(format!(
                "Unsupported required extension: {}",
                name.chars().take(120).collect::<String>()
            )));
        }
    }
    Ok(())
}
