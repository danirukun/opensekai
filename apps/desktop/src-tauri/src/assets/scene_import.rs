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
    invalid(format!("{message}: {}", reference.chars().take(120).collect::<String>()))
}

trait SceneSource {
    fn read(&mut self, relative: &str) -> Result<Vec<u8>, AppError>;
}

fn normalize(relative: &str) -> Result<String, AppError> {
    if relative.is_empty() || relative.starts_with('/') || relative.contains('\\') || relative.contains('\0') {
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

fn read_bounded(reader: impl Read, max: u64) -> Result<Vec<u8>, AppError> {
    let mut bytes = Vec::new();
    reader
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid("File unavailable"))?;
    if bytes.len() as u64 > max {
        return Err(invalid("Scene exceeds import budget"));
    }
    Ok(bytes)
}

struct FolderSource {
    root: PathBuf,
    max: u64,
}
impl SceneSource for FolderSource {
    fn read(&mut self, relative: &str) -> Result<Vec<u8>, AppError> {
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
        read_bounded(file, self.max)
    }
}

struct ZipSource {
    archive: zip::ZipArchive<std::fs::File>,
    base: String,
    max: u64,
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
            let entry = archive.by_index_raw(index).map_err(|_| invalid("Invalid zip archive"))?;
            let name = entry.name().map_err(|_| invalid("Invalid zip archive"))?.into_owned();
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
        Ok((Self { archive, base, max: limits.max_glb }, root))
    }
    fn entry(&mut self, name: &str) -> Result<Vec<u8>, AppError> {
        let max = self.max;
        let entry = self.archive.by_name(name).map_err(|_| named("Missing file", name))?;
        read_bounded(entry, max)
    }
}
impl SceneSource for ZipSource {
    fn read(&mut self, relative: &str) -> Result<Vec<u8>, AppError> {
        let relative = normalize(relative)?;
        let name = format!("{}{relative}", self.base);
        self.entry(&name).map_err(|_| named("Missing file", &relative))
    }
}

pub fn pack_scene(path: &Path, limits: Limits) -> Result<PackedScene, AppError> {
    let extension = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    let stem = |name: &Path| name.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    match extension.as_deref() {
        Some("zip") => {
            let (mut source, root) = ZipSource::open(path, limits)?;
            let bytes = source.entry(&root)?;
            let binary = root.to_ascii_lowercase().ends_with(".glb");
            pack_root(&bytes, binary, &mut source, limits, stem(Path::new(&root)))
        }
        Some(kind @ ("glb" | "gltf")) => {
            let folder = path.parent().ok_or_else(|| invalid("Model folder unavailable"))?;
            let root = folder.canonicalize().map_err(|_| invalid("Model folder unavailable"))?;
            let max = if kind == "glb" { limits.max_glb } else { limits.max_json as u64 };
            let file = std::fs::File::open(path).map_err(|_| invalid("File unavailable"))?;
            let bytes = read_bounded(file, max)?;
            let mut source = FolderSource { root, max: limits.max_glb };
            pack_root(&bytes, kind == "glb", &mut source, limits, stem(path))
        }
        _ => Err(invalid("Choose a .glb, .gltf, or .zip file")),
    }
}

fn pack_root(
    bytes: &[u8],
    binary: bool,
    source: &mut dyn SceneSource,
    limits: Limits,
    stem: String,
) -> Result<PackedScene, AppError> {
    let (json, bin) = if binary {
        split_glb(bytes)?
    } else {
        (serde_json::from_slice(bytes).map_err(|_| invalid("Invalid glTF JSON"))?, None)
    };
    let credits = read_credits(&json);
    let glb = pack(json, bin, source, limits)?;
    Ok(PackedScene { glb, credits, stem })
}

fn split_glb(bytes: &[u8]) -> Result<(Value, Option<Vec<u8>>), AppError> {
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
    let json = serde_json::from_slice(&bytes[20..json_end]).map_err(|_| invalid("Invalid GLB JSON"))?;
    let bin = if json_end + 8 <= bytes.len() {
        if word(json_end + 4)? != BIN_CHUNK {
            return Err(invalid("Invalid GLB chunks"));
        }
        let start = json_end + 8;
        let end = start
            .checked_add(word(json_end)? as usize)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| invalid("Invalid GLB chunks"))?;
        Some(bytes[start..end].to_vec())
    } else {
        None
    };
    Ok((json, bin))
}

fn resolve(uri: &str, source: &mut dyn SceneSource) -> Result<Vec<u8>, AppError> {
    if let Some(rest) = uri.strip_prefix("data:") {
        let (_, payload) = rest
            .split_once(";base64,")
            .ok_or_else(|| named("Unsupported data URI", "data:"))?;
        return STANDARD.decode(payload).map_err(|_| named("Invalid data URI", "data:"));
    }
    if let Some(colon) = uri.find(':') {
        if !uri[..colon].contains('/') {
            return Err(named("Unsupported file reference", uri));
        }
    }
    let decoded = percent_decode_str(uri)
        .decode_utf8()
        .map_err(|_| named("Invalid file reference", uri))?;
    source.read(&decoded)
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn append(bin: &mut Vec<u8>, data: &[u8]) -> usize {
    while !bin.len().is_multiple_of(4) {
        bin.push(0);
    }
    let offset = bin.len();
    bin.extend_from_slice(data);
    offset
}

fn pack(
    mut json: Value,
    glb_bin: Option<Vec<u8>>,
    source: &mut dyn SceneSource,
    limits: Limits,
) -> Result<Vec<u8>, AppError> {
    if !json.is_object() || json.pointer("/asset/version").and_then(Value::as_str) != Some("2.0") {
        return Err(invalid("Unsupported glTF version"));
    }
    for name in json.get("extensionsRequired").and_then(Value::as_array).into_iter().flatten() {
        let name = name.as_str().unwrap_or("");
        if !SUPPORTED_REQUIRED.contains(&name) {
            return Err(named("Unsupported required extension", name));
        }
    }
    let mut glb_bin = glb_bin;
    let mut sources = Vec::new();
    for (index, buffer) in json.get("buffers").and_then(Value::as_array).into_iter().flatten().enumerate() {
        let bytes = match buffer.get("uri").and_then(Value::as_str) {
            Some(uri) => resolve(uri, source)?,
            None if index == 0 => glb_bin.take().ok_or_else(|| invalid("Missing GLB binary chunk"))?,
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
    let mut bin = Vec::new();
    for view in json.get_mut("bufferViews").and_then(Value::as_array_mut).into_iter().flatten() {
        let buffer = view.get("buffer").and_then(Value::as_u64).ok_or_else(|| invalid("Invalid buffer view"))? as usize;
        let offset = view.get("byteOffset").and_then(Value::as_u64).unwrap_or(0) as usize;
        let length = view.get("byteLength").and_then(Value::as_u64).ok_or_else(|| invalid("Invalid buffer view"))? as usize;
        let data = sources
            .get(buffer)
            .and_then(|b| b.get(offset..offset.checked_add(length)?))
            .ok_or_else(|| invalid("Buffer view outside its buffer"))?;
        let at = append(&mut bin, data);
        view["buffer"] = json!(0);
        view["byteOffset"] = json!(at);
    }
    drop(sources);
    let mut views: Vec<Value> = json.get("bufferViews").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut images: Vec<Value> = json.get("images").and_then(Value::as_array).cloned().unwrap_or_default();
    for image in &mut images {
        let object = image.as_object_mut().ok_or_else(|| invalid("Invalid image"))?;
        if let Some(uri) = object.get("uri").and_then(Value::as_str).map(str::to_owned) {
            let bytes = resolve(&uri, source)?;
            let mime = image_mime(&bytes).ok_or_else(|| named("Unsupported image type", &uri))?;
            let at = append(&mut bin, &bytes);
            views.push(json!({"buffer": 0, "byteOffset": at, "byteLength": bytes.len()}));
            object.remove("uri");
            object.insert("bufferView".into(), json!(views.len() - 1));
            object.insert("mimeType".into(), json!(mime));
        } else {
            let view = object
                .get("bufferView")
                .and_then(Value::as_u64)
                .and_then(|index| views.get(index as usize))
                .ok_or_else(|| invalid("Image has no data"))?;
            let start = view["byteOffset"].as_u64().unwrap_or(0) as usize;
            let end = start + view["byteLength"].as_u64().unwrap_or(0) as usize;
            let mime = bin.get(start..end).and_then(image_mime).ok_or_else(|| invalid("Unsupported image type"))?;
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
    for node in json.get_mut("nodes").and_then(Value::as_array_mut).into_iter().flatten() {
        if let Some(extensions) = node.get_mut("extensions").and_then(Value::as_object_mut) {
            extensions.remove(LIGHTS);
        }
    }
    for key in ["extensionsUsed", "extensionsRequired"] {
        if let Some(list) = json.get_mut(key).and_then(Value::as_array_mut) {
            list.retain(|value| value.as_str() != Some(LIGHTS));
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
        url::Url::parse(s).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
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
        std::fs::write(dir.path().join("scene.gltf"), serde_json::to_vec(json).unwrap()).unwrap();
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
            writer.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        path
    }
    fn json_of(glb: &[u8]) -> Value {
        split_glb(glb).unwrap().0
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
        let dir = folder(&room("textures/Room%20color.png"), &[("textures/Room color.png", PNG)]);
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
        while !text.len().is_multiple_of(4) { text.push(b' '); }
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
            let zip = zip_file(dir.path(), &[
                (&format!("{prefix}scene.gltf"), json.clone()),
                (&format!("{prefix}scene.bin"), vec![1u8; 8]),
                (&format!("{prefix}textures/a.png"), PNG.to_vec()),
            ]);
            assert!(!has_uri(&json_of(&pack_scene(&zip, Limits::DEFAULT).unwrap().glb)), "{prefix}");
        }
    }
    #[test]
    fn zip_ignores_macos_resource_forks() {
        let json = serde_json::to_vec(&room("textures/a.png")).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let zip = zip_file(dir.path(), &[
            ("scene.gltf", json),
            ("__MACOSX/._scene.gltf", b"resource fork".to_vec()),
            ("scene.bin", vec![1u8; 8]),
            ("textures/a.png", PNG.to_vec()),
        ]);
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
            assert!(message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT)).contains(expected), "{uri}");
        }
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_outside_the_folder() {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.png"), PNG).unwrap();
        let dir = folder(&room("textures/link.png"), &[]);
        std::fs::create_dir_all(dir.path().join("textures")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.png"), dir.path().join("textures/link.png")).unwrap();
        assert!(message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT)).contains("leaves the model folder"));
    }
    #[test]
    fn rejects_unsupported_images_and_required_extensions() {
        let dir = folder(&room("a.gif"), &[("a.gif", b"GIF89a....")]);
        assert!(message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT)).contains("Unsupported image type"));
        let mut json = room("a.png");
        json["extensionsRequired"] = json!(["KHR_draco_mesh_compression"]);
        let dir = folder(&json, &[("a.png", PNG)]);
        assert!(message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT)).contains("KHR_draco_mesh_compression"));
    }
    #[test]
    fn rejects_bad_zip_archives() {
        let json = serde_json::to_vec(&room("a.png")).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let two = zip_file(dir.path(), &[("a.gltf", json.clone()), ("b.glb", vec![0; 4])]);
        assert!(message(pack_scene(&two, Limits::DEFAULT)).contains("exactly one"));
        let dir = tempfile::tempdir().unwrap();
        let slip = zip_file(dir.path(), &[("scene.gltf", json.clone()), ("../evil.png", PNG.to_vec())]);
        assert!(message(pack_scene(&slip, Limits::DEFAULT)).contains("leaves the archive"));
        let dir = tempfile::tempdir().unwrap();
        let many = zip_file(dir.path(), &[("scene.gltf", json.clone()), ("scene.bin", vec![1; 8]), ("a.png", PNG.to_vec())]);
        assert!(message(pack_scene(&many, Limits { zip_entries: 2, ..Limits::DEFAULT })).contains("too many files"));
        assert!(message(pack_scene(&many, Limits { zip_bytes: 16, ..Limits::DEFAULT })).contains("too large"));
    }
    #[test]
    fn rejects_output_over_budget() {
        let dir = folder(&room("a.png"), &[("a.png", PNG)]);
        assert!(message(pack_scene(&dir.path().join("scene.gltf"), Limits { max_glb: 64, ..Limits::DEFAULT })).contains("exceeds import budget"));
    }
    #[test]
    fn strips_file_lights() {
        let mut json = room("a.png");
        json["extensionsUsed"] = json!(["KHR_lights_punctual", "KHR_materials_specular"]);
        json["extensions"] = json!({"KHR_lights_punctual": {"lights": [{"type": "point"}]}});
        json["nodes"][0]["extensions"] = json!({"KHR_lights_punctual": {"light": 0}});
        let dir = folder(&json, &[("a.png", PNG)]);
        let out = json_of(&pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT).unwrap().glb);
        assert_eq!(out["extensionsUsed"], json!(["KHR_materials_specular"]));
        assert!(out["extensions"].get("KHR_lights_punctual").is_none());
        assert!(out["nodes"][0]["extensions"].get("KHR_lights_punctual").is_none());
    }
    #[test]
    fn bounds_credits() {
        let mut json = room("a.png");
        json["asset"]["extras"] = json!({"title": "  ", "author": 7, "license": "x".repeat(513), "source": "javascript:alert(1)"});
        let dir = folder(&json, &[("a.png", PNG)]);
        assert!(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT).unwrap().credits.is_none());
    }
}
