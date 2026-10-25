use opensekai_contracts::{invalid, AppError, AssetCredits};
use std::path::Path;
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_glb: u64,
    pub max_json: usize,
    pub zip_entries: usize,
    pub zip_bytes: u64,
}
impl Limits {
    pub const DEFAULT: Self = Self {
        max_glb: super::registry::MAX_IMPORT_BYTES,
        max_json: super::registry::MAX_GLB_JSON_BYTES,
        zip_entries: 4096,
        zip_bytes: 1 << 30,
    };
}
#[derive(Debug)]
pub struct PackedScene {
    pub glb: Vec<u8>,
    pub credits: Option<AssetCredits>,
    pub stem: String,
}
use base64::{engine::general_purpose::STANDARD, Engine};
use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;

const JSON_CHUNK: u32 = 0x4e4f534a;
const BIN_CHUNK: u32 = 0x004e4942;
const LIGHTS: &str = "KHR_lights_punctual";
// Extensions that three.js GLTFLoader handles without an extra decoder in this renderer.
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
    "EXT_texture_webp",
    "EXT_mesh_gpu_instancing",
];

fn named(message: &str, reference: &str) -> AppError {
    invalid(format!(
        "{message}: {}",
        reference.chars().take(120).collect::<String>()
    ))
}

trait SceneSource {
    fn read(&mut self, relative: &str, max: u64) -> Result<Vec<u8>, AppError>;
}

fn normalize(relative: &str) -> Result<String, AppError> {
    if relative.is_empty()
        || relative.starts_with('/')
        || relative.contains('\\')
        || relative.contains('\0')
    {
        return Err(named("Unsupported file reference", relative));
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in relative.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(named("File reference leaves the model folder", relative));
                }
            }
            part => parts.push(part),
        }
    }
    if parts.is_empty() {
        return Err(named("Unsupported file reference", relative));
    }
    Ok(parts.join("/"))
}

const BUDGET: &str = "Scene exceeds import budget";
const GLTF_BUDGET: &str = "glTF JSON exceeds budget";
// `hint` is the expected size (file length or zip entry size). It sets the first capacity, so the buffer does not grow by doubling.
fn read_bounded(reader: impl Read, max: u64, hint: u64, over: &str) -> Result<Vec<u8>, AppError> {
    let mut bytes = Vec::with_capacity(hint.min(max) as usize);
    reader
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid("File unavailable"))?;
    if bytes.len() as u64 > max {
        return Err(invalid(over));
    }
    Ok(bytes)
}

struct FolderSource {
    root: PathBuf,
}
impl SceneSource for FolderSource {
    fn read(&mut self, relative: &str, max: u64) -> Result<Vec<u8>, AppError> {
        let relative = normalize(relative)?;
        let path = self
            .root
            .join(&relative)
            .canonicalize()
            .map_err(|_| named("Missing file", &relative))?;
        if !path.starts_with(&self.root) {
            return Err(named("File reference leaves the model folder", &relative));
        }
        if !path.is_file() {
            return Err(named("Missing file", &relative));
        }
        let file = std::fs::File::open(&path).map_err(|_| named("Missing file", &relative))?;
        let hint = file.metadata().map(|m| m.len()).unwrap_or(0);
        read_bounded(file, max, hint, BUDGET)
    }
}

struct ZipSource {
    archive: zip::ZipArchive<std::fs::File>,
    base: String,
}
impl ZipSource {
    fn open(path: &Path, limits: Limits) -> Result<(Self, String), AppError> {
        let file = std::fs::File::open(path).map_err(|_| invalid("Archive unavailable"))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|_| invalid("Invalid zip archive"))?;
        if archive.len() > limits.zip_entries {
            return Err(invalid("Archive has too many files"));
        }
        let mut total = 0u64;
        let mut roots = Vec::new();
        for index in 0..archive.len() {
            let entry = archive
                .by_index_raw(index)
                .map_err(|_| invalid("Invalid zip archive"))?;
            let name = entry
                .name()
                .map_err(|_| invalid("Invalid zip archive"))?
                .into_owned();
            if entry.enclosed_name().is_none() {
                return Err(named("Archive entry leaves the archive", &name));
            }
            total = total.saturating_add(entry.size());
            if total > limits.zip_bytes {
                return Err(invalid("Archive is too large"));
            }
            let lower = name.to_ascii_lowercase();
            if !entry.is_dir()
                && !lower.starts_with("__macosx/")
                && name.matches('/').count() <= 1
                && (lower.ends_with(".gltf") || lower.ends_with(".glb"))
            {
                roots.push(name);
            }
        }
        let [root] = roots.as_slice() else {
            return Err(invalid("Archive must hold exactly one .gltf or .glb file"));
        };
        let root = root.clone();
        let base = root
            .rsplit_once('/')
            .map(|(folder, _)| format!("{folder}/"))
            .unwrap_or_default();
        Ok((Self { archive, base }, root))
    }
    fn entry(&mut self, name: &str, max: u64, over: &str) -> Result<Vec<u8>, AppError> {
        let entry = self.archive.by_name(name).map_err(|error| match error {
            zip::result::ZipError::FileNotFound => named("Missing file", name),
            _ => invalid("Invalid zip archive"),
        })?;
        let hint = entry.size();
        read_bounded(entry, max, hint, over)
    }
}
impl SceneSource for ZipSource {
    fn read(&mut self, relative: &str, max: u64) -> Result<Vec<u8>, AppError> {
        let relative = normalize(relative)?;
        let name = format!("{}{relative}", self.base);
        self.entry(&name, max, BUDGET)
    }
}

pub fn pack_scene(path: &Path, limits: Limits) -> Result<PackedScene, AppError> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    let stem = |name: &Path| {
        name.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string()
    };
    match extension.as_deref() {
        Some("zip") => {
            let (mut source, root) = ZipSource::open(path, limits)?;
            let binary = root.to_ascii_lowercase().ends_with(".glb");
            let max = if binary {
                limits.max_glb
            } else {
                limits.max_json as u64
            };
            let bytes = source.entry(&root, max, if binary { BUDGET } else { GLTF_BUDGET })?;
            pack_root(bytes, binary, &mut source, limits, stem(Path::new(&root)))
        }
        Some(kind @ ("glb" | "gltf")) => {
            let folder = path
                .parent()
                .ok_or_else(|| invalid("Model folder unavailable"))?;
            let root = folder
                .canonicalize()
                .map_err(|_| invalid("Model folder unavailable"))?;
            let max = if kind == "glb" {
                limits.max_glb
            } else {
                limits.max_json as u64
            };
            let file = std::fs::File::open(path).map_err(|_| invalid("File unavailable"))?;
            let hint = file.metadata().map(|m| m.len()).unwrap_or(0);
            let bytes = read_bounded(
                file,
                max,
                hint,
                if kind == "glb" { BUDGET } else { GLTF_BUDGET },
            )?;
            let mut source = FolderSource { root };
            pack_root(bytes, kind == "glb", &mut source, limits, stem(path))
        }
        _ => Err(invalid("Choose a .glb, .gltf, or .zip file")),
    }
}

fn pack_root(
    bytes: Vec<u8>,
    binary: bool,
    source: &mut dyn SceneSource,
    limits: Limits,
    stem: String,
) -> Result<PackedScene, AppError> {
    let (json, bin) = if binary {
        split_glb(&bytes, limits.max_json)?
    } else {
        (
            serde_json::from_slice(&bytes).map_err(|_| invalid("Invalid glTF JSON"))?,
            None,
        )
    };
    let credits = read_credits(&json);
    let budget = Budget(limits.max_glb.saturating_sub(bytes.len() as u64));
    let glb = pack(json, bytes, bin, source, limits, budget)?;
    Ok(PackedScene { glb, credits, stem })
}

// Returns the JSON and the byte range of the BIN chunk in `bytes`, so the caller can borrow the chunk instead of copying it.
fn split_glb(
    bytes: &[u8],
    max_json: usize,
) -> Result<(Value, Option<std::ops::Range<usize>>), AppError> {
    let word = |offset: usize| -> Result<u32, AppError> {
        bytes
            .get(offset..offset + 4)
            .map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]))
            .ok_or_else(|| invalid("Truncated GLB"))
    };
    if bytes.get(..4) != Some(b"glTF") || word(4)? != 2 || word(8)? as usize != bytes.len() {
        return Err(invalid("Invalid GLB header"));
    }
    if word(16)? != JSON_CHUNK {
        return Err(invalid("Invalid GLB JSON"));
    }
    let json_end = 20usize
        .checked_add(word(12)? as usize)
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| invalid("Invalid GLB JSON"))?;
    if json_end - 20 > max_json {
        return Err(invalid("GLB JSON exceeds budget"));
    }
    let json =
        serde_json::from_slice(&bytes[20..json_end]).map_err(|_| invalid("Invalid GLB JSON"))?;
    let bin = if json_end + 8 <= bytes.len() {
        if word(json_end + 4)? != BIN_CHUNK {
            return Err(invalid("Invalid GLB chunks"));
        }
        let start = json_end + 8;
        let end = start
            .checked_add(word(json_end)? as usize)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| invalid("Invalid GLB chunks"))?;
        Some(start..end)
    } else {
        None
    };
    Ok((json, bin))
}

struct Budget(u64);
impl Budget {
    fn spend(&mut self, bytes: usize) -> Result<(), AppError> {
        self.0 = self
            .0
            .checked_sub(bytes as u64)
            .ok_or_else(|| invalid("Scene exceeds import budget"))?;
        Ok(())
    }
}

fn resolve(
    uri: &str,
    source: &mut dyn SceneSource,
    budget: &mut Budget,
) -> Result<Vec<u8>, AppError> {
    let bytes = resolve_uncounted(uri, source, budget.0)?;
    budget.spend(bytes.len())?;
    Ok(bytes)
}

fn resolve_uncounted(
    uri: &str,
    source: &mut dyn SceneSource,
    max: u64,
) -> Result<Vec<u8>, AppError> {
    if let Some(rest) = uri.strip_prefix("data:") {
        let (_, payload) = rest
            .split_once(";base64,")
            .ok_or_else(|| named("Unsupported data URI", "data:"))?;
        if (payload.len() as u64 / 4 * 3) > max.saturating_add(3) {
            return Err(invalid("Scene exceeds import budget"));
        }
        return STANDARD
            .decode(payload)
            .map_err(|_| named("Invalid data URI", "data:"));
    }
    if let Some(colon) = uri.find(':') {
        if !uri[..colon].contains('/') {
            return Err(named("Unsupported file reference", uri));
        }
    }
    let decoded = percent_decode_str(uri)
        .decode_utf8()
        .map_err(|_| named("Invalid file reference", uri))?;
    source.read(&decoded, max)
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"\xabKTX 20\xbb\r\n\x1a\n") {
        Some("image/ktx2")
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && matches!(&bytes[8..12], b"avif" | b"avis")
    {
        Some("image/avif")
    } else {
        None
    }
}

// A core texture source must be a type that every renderer decodes; KTX2 and AVIF only pass behind an optional extension.
fn core_image(mime: &str) -> bool {
    matches!(mime, "image/png" | "image/jpeg" | "image/webp")
}

// validate_glb rejects every non-data `uri`, so the importer names one that it does not embed before it reads any file.
fn stray_uri(value: &Value, path: &mut Vec<String>) -> Option<String> {
    let embedded =
        |path: &[String]| path.len() == 2 && matches!(path[0].as_str(), "buffers" | "images");
    match value {
        Value::Object(object) => object.iter().find_map(|(key, value)| {
            path.push(key.replace('~', "~0").replace('/', "~1"));
            let found = if key == "uri"
                && !(embedded(&path[..path.len() - 1]) && value.is_string())
                && !value.as_str().is_some_and(|s| s.starts_with("data:"))
            {
                Some(format!("/{}", path.join("/")))
            } else {
                stray_uri(value, path)
            };
            path.pop();
            found
        }),
        Value::Array(items) => items.iter().enumerate().find_map(|(index, value)| {
            path.push(index.to_string());
            let found = stray_uri(value, path);
            path.pop();
            found
        }),
        _ => None,
    }
}

fn append(bin: &mut Vec<u8>, data: &[u8], max: u64) -> Result<usize, AppError> {
    let offset = bin.len().next_multiple_of(4);
    if (offset as u64).saturating_add(data.len() as u64) > max {
        return Err(invalid("Scene exceeds import budget"));
    }
    bin.resize(offset, 0);
    bin.extend_from_slice(data);
    Ok(offset)
}

// Peak memory for a GLB root of N bytes is about 2N: the root and the new BIN, then the new BIN and the output.
fn pack(
    mut json: Value,
    root: Vec<u8>,
    glb_bin: Option<std::ops::Range<usize>>,
    source: &mut dyn SceneSource,
    limits: Limits,
    mut budget: Budget,
) -> Result<Vec<u8>, AppError> {
    if !json.is_object() || json.pointer("/asset/version").and_then(Value::as_str) != Some("2.0") {
        return Err(invalid("Unsupported glTF version"));
    }
    for name in json
        .get("extensionsRequired")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = name.as_str().unwrap_or("");
        if !SUPPORTED_REQUIRED.contains(&name) {
            return Err(named("Unsupported required extension", name));
        }
    }
    if let Some(path) = stray_uri(&json, &mut Vec::new()) {
        return Err(named("Unsupported file reference", &path));
    }
    let core: std::collections::HashSet<u64> = json
        .get("textures")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|texture| texture.get("source").and_then(Value::as_u64))
        .collect();
    let mut glb_bin = glb_bin;
    let mut sources: Vec<std::borrow::Cow<[u8]>> = Vec::new();
    for (index, buffer) in json
        .get("buffers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let bytes = match buffer.get("uri").and_then(Value::as_str) {
            Some(uri) => std::borrow::Cow::Owned(resolve(uri, source, &mut budget)?),
            None if index == 0 => std::borrow::Cow::Borrowed(
                &root[glb_bin
                    .take()
                    .ok_or_else(|| invalid("Missing GLB binary chunk"))?],
            ),
            None => return Err(invalid("Buffer has no data")),
        };
        let length = buffer
            .get("byteLength")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("Invalid buffer length"))?;
        if (bytes.len() as u64) < length {
            return Err(invalid("Buffer is shorter than its byteLength"));
        }
        sources.push(bytes);
    }
    let view_bytes = json
        .get("bufferViews")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|view| {
            view.get("byteLength")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                // Untrusted length: round up to 4 without overflow.
                .saturating_add(3)
                & !3
        })
        .fold(0u64, u64::saturating_add);
    let mut bin = Vec::with_capacity(view_bytes.min(limits.max_glb) as usize);
    for view in json
        .get_mut("bufferViews")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        let buffer = view
            .get("buffer")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("Invalid buffer view"))? as usize;
        let offset = view.get("byteOffset").and_then(Value::as_u64).unwrap_or(0) as usize;
        let length = view
            .get("byteLength")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("Invalid buffer view"))? as usize;
        let data = sources
            .get(buffer)
            .and_then(|b| b.get(offset..offset.checked_add(length)?))
            .ok_or_else(|| invalid("Buffer view outside its buffer"))?;
        let at = append(&mut bin, data, limits.max_glb)?;
        view["buffer"] = json!(0);
        view["byteOffset"] = json!(at);
    }
    drop(sources);
    drop(root);
    let mut views: Vec<Value> = json
        .get("bufferViews")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut images: Vec<Value> = json
        .get("images")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut packed: std::collections::HashMap<String, (usize, &'static str)> =
        std::collections::HashMap::new();
    for (index, image) in images.iter_mut().enumerate() {
        let core = core.contains(&(index as u64));
        let object = image
            .as_object_mut()
            .ok_or_else(|| invalid("Invalid image"))?;
        if let Some(uri) = object.get("uri").and_then(Value::as_str).map(str::to_owned) {
            let (view, mime) = match packed.get(&uri) {
                Some(found) => *found,
                None => {
                    let bytes = resolve(&uri, source, &mut budget)?;
                    let mime =
                        image_mime(&bytes).ok_or_else(|| named("Unsupported image type", &uri))?;
                    let at = append(&mut bin, &bytes, limits.max_glb)?;
                    views.push(json!({"buffer": 0, "byteOffset": at, "byteLength": bytes.len()}));
                    if !uri.starts_with("data:") {
                        packed.insert(uri.clone(), (views.len() - 1, mime));
                    }
                    (views.len() - 1, mime)
                }
            };
            if core && !core_image(mime) {
                return Err(named("Unsupported image type", &uri));
            }
            object.remove("uri");
            object.insert("bufferView".into(), json!(view));
            object.insert("mimeType".into(), json!(mime));
        } else {
            let view = object
                .get("bufferView")
                .and_then(Value::as_u64)
                .and_then(|index| views.get(index as usize))
                .ok_or_else(|| invalid("Image has no data"))?;
            let start = view["byteOffset"].as_u64().unwrap_or(0) as usize;
            let end = start
                .checked_add(view["byteLength"].as_u64().unwrap_or(0) as usize)
                .ok_or_else(|| invalid("Image has no data"))?;
            let mime = bin
                .get(start..end)
                .and_then(image_mime)
                .filter(|mime| !core || core_image(mime))
                .ok_or_else(|| invalid("Unsupported image type"))?;
            object.insert("mimeType".into(), json!(mime));
        }
    }
    while !bin.len().is_multiple_of(4) {
        bin.push(0);
    }
    let root = json.as_object_mut().expect("checked object");
    if !views.is_empty() {
        root.insert("bufferViews".into(), Value::Array(views));
    }
    if !images.is_empty() {
        root.insert("images".into(), Value::Array(images));
    }
    if bin.is_empty() {
        root.remove("buffers");
    } else {
        root.insert("buffers".into(), json!([{"byteLength": bin.len()}]));
    }
    strip_lights(&mut json);
    let mut text = serde_json::to_vec(&json).map_err(|_| invalid("Invalid glTF JSON"))?;
    while !text.len().is_multiple_of(4) {
        text.push(b' ');
    }
    if text.len() > limits.max_json {
        return Err(invalid("GLB JSON exceeds budget"));
    }
    let total = 20 + text.len() + if bin.is_empty() { 0 } else { 8 + bin.len() };
    if total as u64 > limits.max_glb {
        return Err(invalid("Scene exceeds import budget"));
    }
    let mut glb = Vec::with_capacity(total);
    glb.extend_from_slice(b"glTF");
    glb.extend(2u32.to_le_bytes());
    glb.extend((total as u32).to_le_bytes());
    glb.extend((text.len() as u32).to_le_bytes());
    glb.extend(JSON_CHUNK.to_le_bytes());
    glb.extend(text);
    if !bin.is_empty() {
        glb.extend((bin.len() as u32).to_le_bytes());
        glb.extend(BIN_CHUNK.to_le_bytes());
        glb.extend(bin);
    }
    Ok(glb)
}

fn strip_lights(json: &mut Value) {
    if let Some(extensions) = json.get_mut("extensions").and_then(Value::as_object_mut) {
        extensions.remove(LIGHTS);
    }
    for node in json
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        if let Some(extensions) = node.get_mut("extensions").and_then(Value::as_object_mut) {
            extensions.remove(LIGHTS);
        }
    }
    for key in ["extensionsUsed", "extensionsRequired"] {
        if let Some(list) = json.get_mut(key).and_then(Value::as_array_mut) {
            list.retain(|value| value.as_str() != Some(LIGHTS));
            if list.is_empty() {
                json.as_object_mut().expect("checked object").remove(key);
            }
        }
    }
}

fn read_credits(json: &Value) -> Option<AssetCredits> {
    let text = |key: &str| {
        json.pointer(&format!("/asset/extras/{key}"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.encode_utf16().count() <= 512)
            .map(str::to_owned)
    };
    let source_url = text("source").filter(|s| {
        (s.starts_with("http://") || s.starts_with("https://")) && url::Url::parse(s).is_ok()
    });
    let credits = AssetCredits {
        title: text("title"),
        author: text("author"),
        license: text("license"),
        source_url,
    };
    (credits.title.is_some()
        || credits.author.is_some()
        || credits.license.is_some()
        || credits.source_url.is_some())
    .then_some(credits)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::io::Write;
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake-png-body";
    fn room(image_uri: &str) -> Value {
        json!({
            "asset": {"version": "2.0", "extras": {
                "title": "Anime stylized room free",
                "author": "CG Lads (https://sketchfab.com/CGlads)",
                "license": "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)",
                "source": "https://sketchfab.com/3d-models/anime-stylized-room-free-223df82515de41e684720e2eaa02e93d"}},
            "buffers": [{"uri": "scene.bin", "byteLength": 8}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 8}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 2, "type": "SCALAR"}],
            "images": [{"uri": image_uri}],
            "textures": [{"source": 0}],
            "nodes": [{"name": "root"}]
        })
    }
    fn folder(json: &Value, files: &[(&str, &[u8])]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("scene.gltf"),
            serde_json::to_vec(json).unwrap(),
        )
        .unwrap();
        std::fs::write(dir.path().join("scene.bin"), [1u8; 8]).unwrap();
        for (name, bytes) in files {
            let path = dir.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        dir
    }
    fn zip_file(dir: &Path, entries: &[(&str, Vec<u8>)]) -> std::path::PathBuf {
        let path = dir.join("room.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for (name, bytes) in entries {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        path
    }
    fn json_of(glb: &[u8]) -> Value {
        split_glb(glb, usize::MAX).unwrap().0
    }
    fn has_uri(value: &Value) -> bool {
        match value {
            Value::Object(o) => o.iter().any(|(k, v)| k == "uri" || has_uri(v)),
            Value::Array(a) => a.iter().any(has_uri),
            _ => false,
        }
    }
    fn message(result: Result<PackedScene, AppError>) -> String {
        result.unwrap_err().message
    }
    #[test]
    fn packs_multi_file_gltf() {
        let dir = folder(
            &room("textures/Room%20color.png"),
            &[("textures/Room color.png", PNG)],
        );
        let packed = pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT).unwrap();
        super::super::registry::validate_glb(&packed.glb).unwrap();
        let json = json_of(&packed.glb);
        assert!(!has_uri(&json));
        assert_eq!(json["buffers"].as_array().unwrap().len(), 1);
        assert_eq!(json["images"][0]["mimeType"], "image/png");
        let view = &json["bufferViews"][json["images"][0]["bufferView"].as_u64().unwrap() as usize];
        assert_eq!(view["byteLength"], PNG.len());
        assert_eq!(view["byteOffset"].as_u64().unwrap() % 4, 0);
        for key in ["accessors", "nodes", "textures"] {
            assert_eq!(json[key].as_array().unwrap().len(), 1, "{key}");
        }
        let credits = packed.credits.unwrap();
        assert_eq!(credits.title.as_deref(), Some("Anime stylized room free"));
        assert_eq!(packed.stem, "scene");
    }
    #[test]
    fn resolves_non_ascii_names() {
        let dir = folder(&room("textures/%E8%89%B2.png"), &[("textures/色.png", PNG)]);
        assert!(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT).is_ok());
    }
    #[test]
    fn decodes_data_uris() {
        let mut json = room("data:image/png;base64,iVBORw0KGgpmYWtl");
        json["buffers"][0]["uri"] = json!("data:application/octet-stream;base64,AQEBAQEBAQE=");
        let dir = folder(&json, &[]);
        let packed = pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT).unwrap();
        assert!(!has_uri(&json_of(&packed.glb)));
    }
    #[test]
    fn packs_glb_with_external_texture() {
        let dir = folder(&room("textures/a.png"), &[("textures/a.png", PNG)]);
        let mut json = room("textures/a.png");
        json["buffers"][0].as_object_mut().unwrap().remove("uri");
        let mut text = serde_json::to_vec(&json).unwrap();
        while !text.len().is_multiple_of(4) {
            text.push(b' ');
        }
        let bin = [1u8; 8];
        let mut glb = b"glTF".to_vec();
        glb.extend(2u32.to_le_bytes());
        glb.extend(((12 + 8 + text.len() + 8 + bin.len()) as u32).to_le_bytes());
        glb.extend((text.len() as u32).to_le_bytes());
        glb.extend(0x4e4f534au32.to_le_bytes());
        glb.extend(&text);
        glb.extend((bin.len() as u32).to_le_bytes());
        glb.extend(0x004e4942u32.to_le_bytes());
        glb.extend(bin);
        std::fs::write(dir.path().join("room.glb"), glb).unwrap();
        let packed = pack_scene(&dir.path().join("room.glb"), Limits::DEFAULT).unwrap();
        assert!(!has_uri(&json_of(&packed.glb)));
        assert_eq!(packed.stem, "room");
    }
    #[test]
    fn packs_sketchfab_zip_at_root_and_one_folder_down() {
        let json = serde_json::to_vec(&room("textures/a.png")).unwrap();
        for prefix in ["", "room/"] {
            let dir = tempfile::tempdir().unwrap();
            let zip = zip_file(
                dir.path(),
                &[
                    (&format!("{prefix}scene.gltf"), json.clone()),
                    (&format!("{prefix}scene.bin"), vec![1u8; 8]),
                    (&format!("{prefix}textures/a.png"), PNG.to_vec()),
                ],
            );
            assert!(
                !has_uri(&json_of(&pack_scene(&zip, Limits::DEFAULT).unwrap().glb)),
                "{prefix}"
            );
        }
    }
    #[test]
    fn zip_ignores_macos_resource_forks() {
        let json = serde_json::to_vec(&room("textures/a.png")).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let zip = zip_file(
            dir.path(),
            &[
                ("scene.gltf", json),
                ("__MACOSX/._scene.gltf", b"resource fork".to_vec()),
                ("scene.bin", vec![1u8; 8]),
                ("textures/a.png", PNG.to_vec()),
            ],
        );
        assert!(pack_scene(&zip, Limits::DEFAULT).is_ok());
    }
    #[test]
    fn rejects_unsafe_or_missing_references() {
        for (uri, expected) in [
            ("../outside.png", "leaves the model folder"),
            ("/etc/passwd", "Unsupported file reference"),
            ("https://example.com/a.png", "Unsupported file reference"),
            ("file:///etc/passwd", "Unsupported file reference"),
            ("missing.png", "Missing file"),
        ] {
            let dir = folder(&room(uri), &[]);
            assert!(
                message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT))
                    .contains(expected),
                "{uri}"
            );
        }
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_outside_the_folder() {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.png"), PNG).unwrap();
        let dir = folder(&room("textures/link.png"), &[]);
        std::fs::create_dir_all(dir.path().join("textures")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.png"),
            dir.path().join("textures/link.png"),
        )
        .unwrap();
        assert!(
            message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT))
                .contains("leaves the model folder")
        );
    }
    #[test]
    fn rejects_unsupported_images_and_required_extensions() {
        let dir = folder(&room("a.gif"), &[("a.gif", b"GIF89a....")]);
        assert!(
            message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT))
                .contains("Unsupported image type")
        );
        let mut json = room("a.png");
        json["extensionsRequired"] = json!(["KHR_draco_mesh_compression"]);
        let dir = folder(&json, &[("a.png", PNG)]);
        assert!(
            message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT))
                .contains("KHR_draco_mesh_compression")
        );
    }
    #[test]
    fn rejects_bad_zip_archives() {
        let json = serde_json::to_vec(&room("a.png")).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let two = zip_file(
            dir.path(),
            &[("a.gltf", json.clone()), ("b.glb", vec![0; 4])],
        );
        assert!(message(pack_scene(&two, Limits::DEFAULT)).contains("exactly one"));
        let dir = tempfile::tempdir().unwrap();
        let slip = zip_file(
            dir.path(),
            &[("scene.gltf", json.clone()), ("../evil.png", PNG.to_vec())],
        );
        assert!(message(pack_scene(&slip, Limits::DEFAULT)).contains("leaves the archive"));
        let dir = tempfile::tempdir().unwrap();
        let many = zip_file(
            dir.path(),
            &[
                ("scene.gltf", json.clone()),
                ("scene.bin", vec![1; 8]),
                ("a.png", PNG.to_vec()),
            ],
        );
        assert!(message(pack_scene(
            &many,
            Limits {
                zip_entries: 2,
                ..Limits::DEFAULT
            }
        ))
        .contains("too many files"));
        assert!(message(pack_scene(
            &many,
            Limits {
                zip_bytes: 16,
                ..Limits::DEFAULT
            }
        ))
        .contains("too large"));
    }
    #[test]
    fn rejects_output_over_budget() {
        let dir = folder(&room("a.png"), &[("a.png", PNG)]);
        assert!(message(pack_scene(
            &dir.path().join("scene.gltf"),
            Limits {
                max_glb: 64,
                ..Limits::DEFAULT
            }
        ))
        .contains("exceeds import budget"));
    }
    #[test]
    fn rejects_repeated_references_over_budget() {
        let mut json = room("a.png");
        // Each spelling of the same file is a separate read, so the shared budget still applies.
        json["images"] = json!((0..50)
            .map(|i| json!({"uri": format!("{}a.png", "./".repeat(i))}))
            .collect::<Vec<_>>());
        let dir = folder(&json, &[("a.png", &[PNG, &[0u8; 400]].concat())]);
        let limits = Limits {
            max_glb: 4096,
            ..Limits::DEFAULT
        };
        assert!(message(pack_scene(&dir.path().join("scene.gltf"), limits))
            .contains("exceeds import budget"));
    }
    #[test]
    fn rejects_a_huge_buffer_view_length_without_overflow() {
        let mut json = room("a.png");
        json["bufferViews"][0]["byteLength"] = json!(u64::MAX - 1);
        let dir = folder(&json, &[("a.png", PNG)]);
        assert!(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT).is_err());
    }
    #[test]
    fn rejects_overlapping_buffer_views_over_budget() {
        let mut json = room("a.png");
        json["buffers"][0]["byteLength"] = json!(1000);
        json["bufferViews"] = json!((0..50)
            .map(|_| json!({"buffer": 0, "byteOffset": 0, "byteLength": 1000}))
            .collect::<Vec<_>>());
        let dir = folder(&json, &[("a.png", PNG)]);
        std::fs::write(dir.path().join("scene.bin"), [1u8; 1000]).unwrap();
        let limits = Limits {
            max_glb: 4096,
            ..Limits::DEFAULT
        };
        assert!(message(pack_scene(&dir.path().join("scene.gltf"), limits))
            .contains("exceeds import budget"));
    }
    #[test]
    fn rejects_zip_entry_larger_than_remaining_budget() {
        let json = serde_json::to_vec(&room("a.png")).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let zip = zip_file(
            dir.path(),
            &[
                ("scene.gltf", json),
                ("scene.bin", vec![1; 8]),
                ("a.png", [PNG, &vec![0u8; 1 << 20]].concat()),
            ],
        );
        let limits = Limits {
            max_glb: 4096,
            ..Limits::DEFAULT
        };
        assert!(message(pack_scene(&zip, limits)).contains("exceeds import budget"));
    }
    #[test]
    fn rejects_gltf_json_over_budget() {
        let dir = folder(&room("a.png"), &[("a.png", PNG)]);
        let limits = Limits {
            max_json: 64,
            ..Limits::DEFAULT
        };
        assert!(message(pack_scene(&dir.path().join("scene.gltf"), limits))
            .contains("glTF JSON exceeds budget"));
    }
    #[test]
    fn drops_a_source_with_an_uppercase_scheme() {
        let mut json = room("a.png");
        json["asset"]["extras"]["source"] = json!("HTTPS://example.com/room");
        assert!(read_credits(&json).unwrap().source_url.is_none());
        json["asset"]["extras"]["source"] = json!("https://example.com/room");
        assert!(read_credits(&json).unwrap().source_url.is_some());
    }
    #[test]
    fn rejects_glb_json_over_budget() {
        let dir = folder(&room("a.png"), &[("a.png", PNG)]);
        let mut json = room("a.png");
        json["buffers"][0].as_object_mut().unwrap().remove("uri");
        let mut text = serde_json::to_vec(&json).unwrap();
        while !text.len().is_multiple_of(4) {
            text.push(b' ');
        }
        let mut glb = b"glTF".to_vec();
        glb.extend(2u32.to_le_bytes());
        glb.extend(((12 + 8 + text.len()) as u32).to_le_bytes());
        glb.extend((text.len() as u32).to_le_bytes());
        glb.extend(0x4e4f534au32.to_le_bytes());
        glb.extend(&text);
        std::fs::write(dir.path().join("room.glb"), glb).unwrap();
        let limits = Limits {
            max_json: 64,
            ..Limits::DEFAULT
        };
        assert!(message(pack_scene(&dir.path().join("room.glb"), limits))
            .contains("GLB JSON exceeds budget"));
    }
    #[test]
    fn strips_file_lights() {
        let mut json = room("a.png");
        json["extensionsUsed"] = json!(["KHR_lights_punctual", "KHR_materials_specular"]);
        json["extensions"] = json!({"KHR_lights_punctual": {"lights": [{"type": "point"}]}});
        json["nodes"][0]["extensions"] = json!({"KHR_lights_punctual": {"light": 0}});
        let dir = folder(&json, &[("a.png", PNG)]);
        let out = json_of(
            &pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT)
                .unwrap()
                .glb,
        );
        assert_eq!(out["extensionsUsed"], json!(["KHR_materials_specular"]));
        assert!(out["extensions"].get("KHR_lights_punctual").is_none());
        assert!(out["nodes"][0]["extensions"]
            .get("KHR_lights_punctual")
            .is_none());
    }
    #[test]
    fn bounds_credits() {
        let mut json = room("a.png");
        json["asset"]["extras"] = json!({"title": "  ", "author": 7, "license": "x".repeat(513), "source": "javascript:alert(1)"});
        let dir = folder(&json, &[("a.png", PNG)]);
        assert!(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT)
            .unwrap()
            .credits
            .is_none());
    }
    const KTX2: &[u8] = b"\xabKTX 20\xbb\r\n\x1a\nfake-ktx2-body";
    #[test]
    fn keeps_images_that_only_an_optional_extension_uses() {
        let mut json = room("a.png");
        json["images"] = json!([{"uri": "a.png"}, {"uri": "a.ktx2"}]);
        json["textures"][0]["extensions"] = json!({"KHR_texture_basisu": {"source": 1}});
        json["extensionsUsed"] = json!(["KHR_texture_basisu"]);
        let dir = folder(&json, &[("a.png", PNG), ("a.ktx2", KTX2)]);
        let out = json_of(
            &pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT)
                .unwrap()
                .glb,
        );
        assert_eq!(out["images"][0]["mimeType"], "image/png");
        assert_eq!(out["images"][1]["mimeType"], "image/ktx2");
        assert!(!has_uri(&out));
    }
    #[test]
    fn rejects_core_texture_source_that_is_not_png_jpeg_or_webp() {
        let dir = folder(&room("a.ktx2"), &[("a.ktx2", KTX2)]);
        assert!(
            message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT))
                .starts_with("Unsupported image type")
        );
    }
    #[test]
    fn shares_one_buffer_view_for_a_repeated_image_uri() {
        let mut json = room("a.png");
        json["images"] = json!([{"uri": "a.png"}, {"uri": "a.png"}]);
        json["textures"] = json!([{"source": 0}, {"source": 1}]);
        let dir = folder(&json, &[("a.png", PNG)]);
        let packed = pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT).unwrap();
        let out = json_of(&packed.glb);
        assert_eq!(
            out["images"][0]["bufferView"],
            out["images"][1]["bufferView"]
        );
        assert_eq!(out["bufferViews"].as_array().unwrap().len(), 2);
        assert!(packed.glb.windows(PNG.len()).filter(|w| *w == PNG).count() == 1);
    }
    #[test]
    fn rejects_an_external_uri_outside_buffers_and_images_and_names_it() {
        let mut json = room("a.png");
        json["extensions"] = json!({"KHR_audio": {"sources": [{"uri": "a.mp3"}]}});
        let dir = folder(&json, &[("a.png", PNG)]);
        let error = message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT));
        assert_eq!(
            error,
            "Unsupported file reference: /extensions/KHR_audio/sources/0/uri"
        );
    }
    #[test]
    fn removes_extension_lists_that_only_held_file_lights() {
        let mut json = room("a.png");
        json["extensionsUsed"] = json!(["KHR_lights_punctual"]);
        json["extensionsRequired"] = json!(["KHR_lights_punctual"]);
        let dir = folder(&json, &[("a.png", PNG)]);
        let out = json_of(
            &pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT)
                .unwrap()
                .glb,
        );
        assert!(out.get("extensionsUsed").is_none());
        assert!(out.get("extensionsRequired").is_none());
    }
    #[test]
    fn rejects_a_file_that_is_not_a_scene() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("room.txt");
        std::fs::write(&path, b"room").unwrap();
        assert!(message(pack_scene(&path, Limits::DEFAULT)).contains(".glb, .gltf, or .zip"));
    }
    #[test]
    fn rejects_a_zip_without_a_root_near_the_top() {
        let json = serde_json::to_vec(&room("a.png")).unwrap();
        for entries in [
            vec![("readme.txt", b"room".to_vec())],
            vec![
                ("a/b/scene.gltf", json.clone()),
                ("a/b/scene.bin", vec![1u8; 8]),
            ],
        ] {
            let dir = tempfile::tempdir().unwrap();
            let zip = zip_file(dir.path(), &entries);
            assert!(message(pack_scene(&zip, Limits::DEFAULT)).contains("exactly one"));
        }
    }
    // A stored entry with a broken checksum fails when it is read, so a pass proves it was not read.
    fn zip_with_a_broken_entry(json: &Value) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("room.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let json = serde_json::to_vec(json).unwrap();
        for (name, bytes) in [
            ("scene.gltf", json.as_slice()),
            ("scene.bin", &[1u8; 8][..]),
            ("a.png", PNG),
            (
                "textures/broken.png",
                b"\x89PNG\r\n\x1a\nBROKEN-ENTRY-BODY".as_slice(),
            ),
        ] {
            writer.start_file(name, stored).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        let mut bytes = std::fs::read(&path).unwrap();
        let at = bytes
            .windows(17)
            .position(|w| w == b"BROKEN-ENTRY-BODY")
            .unwrap();
        bytes[at] = b'X';
        std::fs::write(&path, bytes).unwrap();
        (dir, path)
    }
    #[test]
    fn reads_only_the_zip_entries_that_the_root_refers_to() {
        let (_dir, path) = zip_with_a_broken_entry(&room("a.png"));
        assert!(pack_scene(&path, Limits::DEFAULT).is_ok());
        let mut uses_it = room("a.png");
        uses_it["images"] = json!([{"uri": "a.png"}, {"uri": "textures/broken.png"}]);
        let (_dir, path) = zip_with_a_broken_entry(&uses_it);
        assert_eq!(
            message(pack_scene(&path, Limits::DEFAULT)),
            "File unavailable"
        );
    }
    // File boundary: the downloaded fixture stages (fixtures/local), when setup prepared them.
    #[test]
    fn prepared_fixture_stages_pack_with_the_same_counts() {
        let manifest =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/local/manifest.json");
        let Ok(text) = std::fs::read_to_string(&manifest) else {
            eprintln!("skip: no {}", manifest.display());
            return;
        };
        let manifest: Value = serde_json::from_str(&text).unwrap();
        let stages: Vec<&str> = manifest["assets"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|asset| {
                ["fixture_glb_stage", "fixture_test_stage"]
                    .contains(&asset["record"]["id"].as_str().unwrap_or(""))
            })
            .filter_map(|asset| asset["path"].as_str())
            .collect();
        for path in stages {
            let source = json_of(&std::fs::read(path).unwrap());
            let packed = pack_scene(Path::new(path), Limits::DEFAULT).unwrap();
            super::super::registry::validate_glb(&packed.glb).unwrap();
            let json = json_of(&packed.glb);
            assert!(!has_uri(&json), "{path}");
            for key in [
                "accessors",
                "meshes",
                "materials",
                "nodes",
                "textures",
                "images",
            ] {
                assert_eq!(
                    json[key].as_array().map(Vec::len),
                    source[key].as_array().map(Vec::len),
                    "{path} {key}"
                );
            }
            eprintln!(
                "{path}: {} bytes in, {} bytes packed",
                std::fs::metadata(path).unwrap().len(),
                packed.glb.len()
            );
        }
    }
}
