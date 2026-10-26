use super::scene_import::PackedScene;
use opensekai_contracts::AssetFormat;
use opensekai_contracts::{
    invalid, is_tracked_expression, AppError, AssetRecord, ErrorCode, Validate,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom, Write};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    fixture_id: String,
    assets: Vec<Entry>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    record: AssetRecord,
    path: PathBuf,
}
pub struct AssetRegistry {
    root: PathBuf,
    library: PathBuf,
    entries: HashMap<String, Entry>,
}
fn error(code: ErrorCode, id: &str) -> AppError {
    AppError {
        code,
        message: "Asset unavailable or invalid".into(),
        ids: if id.is_empty() {
            vec![]
        } else {
            vec![id.into()]
        },
    }
}
fn opaque(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 256
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub record: AssetRecord,
    pub name: String,
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub const MAX_IMPORT_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_GLB_JSON_BYTES: usize = 16 * 1024 * 1024;
impl AssetRegistry {
    pub fn empty(root: &Path) -> Result<Self, AppError> {
        std::fs::create_dir_all(root).map_err(|_| error(ErrorCode::Unavailable, ""))?;
        let root = root
            .canonicalize()
            .map_err(|_| error(ErrorCode::Unavailable, ""))?;
        let mut result = Self {
            library: root.join("library"),
            root,
            entries: HashMap::new(),
        };
        result.load_library()?;
        Ok(result)
    }
    pub fn set_library(&mut self, root: &Path) -> Result<(), AppError> {
        std::fs::create_dir_all(root).map_err(|_| error(ErrorCode::Unavailable, ""))?;
        self.library = root
            .canonicalize()
            .map_err(|_| error(ErrorCode::Unavailable, ""))?;
        self.load_library()
    }
    fn load_library(&mut self) -> Result<(), AppError> {
        let library = self.library.clone();
        std::fs::create_dir_all(&library).map_err(|_| error(ErrorCode::Unavailable, ""))?;
        for item in std::fs::read_dir(&library).map_err(|_| error(ErrorCode::Unavailable, ""))? {
            let p = item.map_err(|_| error(ErrorCode::Unavailable, ""))?.path();
            if p.extension().is_some_and(|s| s == "json") {
                let Ok(mut value) = std::fs::read(&p)
                    .map_err(|_| ())
                    .and_then(|b| serde_json::from_slice::<Value>(&b).map_err(|_| ()))
                else {
                    continue;
                };
                let stored = p.with_extension("vrm");
                // The first importer kept the names that tracking drives and stopped at 64 names, so it lost later clips.
                let stale = value
                    .get("expressions")
                    .and_then(Value::as_array)
                    .is_some_and(|list| {
                        list.iter()
                            .any(|entry| entry["name"].as_str().is_some_and(is_tracked_expression))
                    });
                // Records from before B21 have no rig: the VMC sender needs its rest data.
                let rigless = value.get("format").and_then(Value::as_str) == Some("vrm")
                    && value.get("rig").is_none();
                let named = value.is_object()
                    && (value.get("name").is_none() || value.get("expressions").is_none() || stale);
                let mut backfilled = named || (value.is_object() && rigless);
                if backfilled {
                    // Older records have no name or expression list: read them from the stored file.
                    let vrm = stored.is_file().then(|| stored_vrm(&stored)).flatten();
                    if value.get("name").is_none() {
                        value["name"] = Value::String(
                            vrm.as_ref()
                                .and_then(|(json, _)| meta_name(json))
                                .unwrap_or_else(|| "Avatar".into()),
                        );
                    }
                    if value.get("expressions").is_none() || stale {
                        let expressions = vrm
                            .as_ref()
                            .map(|(json, raw)| super::vrm::vrm_expressions(json, raw))
                            .unwrap_or_default();
                        value["expressions"] =
                            serde_json::to_value(expressions).unwrap_or_default();
                    }
                    if rigless {
                        match vrm.as_ref().and_then(|(json, _)| super::vrm::vrm_rig(json)) {
                            Some(rig) => {
                                value["rig"] = serde_json::to_value(rig).unwrap_or_default()
                            }
                            None => {
                                eprintln!(
                                    "OpenSekai cannot read the rig of asset {}",
                                    value["id"].as_str().unwrap_or("")
                                );
                                // Do not write the record again only for a rig that cannot be read.
                                backfilled = named;
                            }
                        }
                    }
                }
                let Ok(record) = serde_json::from_value::<AssetRecord>(value) else {
                    continue;
                };
                let extension = if record.format == AssetFormat::Vrm
                    && record.id == format!("avatar_{}", record.sha256)
                {
                    Some("vrm")
                } else if record.format == AssetFormat::Glb
                    && record.id == format!("scene_{}", record.sha256)
                {
                    Some("glb")
                } else {
                    None
                };
                if let (true, true, Some(extension)) =
                    (record.validate().is_ok(), opaque(&record.id), extension)
                {
                    if backfilled {
                        if let Ok(bytes) = serde_json::to_vec(&record) {
                            if let Ok(mut temp) = tempfile::NamedTempFile::new_in(&library) {
                                let _ = temp
                                    .write_all(&bytes)
                                    .and_then(|_| temp.as_file().sync_all());
                                let _ = temp.persist(&p);
                            }
                        }
                    }
                    self.entries.insert(
                        record.id.clone(),
                        Entry {
                            path: library.join(format!("{}.{extension}", record.id)),
                            record,
                        },
                    );
                }
            }
        }
        Ok(())
    }
    pub fn library(&self) -> PathBuf {
        self.library.clone()
    }
    /// The record of an entry whose library file exists with the recorded length.
    pub fn intact(&self, id: &str) -> Option<ImportResult> {
        self.entries
            .get(id)
            .filter(|entry| {
                std::fs::metadata(&entry.path)
                    .is_ok_and(|m| m.is_file() && m.len() == entry.record.bytes)
            })
            .map(|entry| ImportResult {
                name: entry.record.name.clone(),
                record: entry.record.clone(),
            })
    }
    /// Renames the staged files into the library and inserts the record. Keep this step short: callers hold the registry lock.
    pub fn commit(&mut self, staged: StagedAsset) -> Result<ImportResult, AppError> {
        if let Some(existing) = self
            .intact(&staged.record.id)
            .filter(|_| staged.deduplicate)
        {
            return Ok(existing);
        }
        if staged.library != self.library {
            return Err(error(ErrorCode::Unavailable, ""));
        }
        let mut target = None;
        for (temp, name) in staged.files {
            let path = self.library.join(name);
            temp.persist(&path)
                .map_err(|_| error(ErrorCode::Unavailable, ""))?;
            target.get_or_insert(path);
        }
        let path = target.ok_or_else(|| error(ErrorCode::Unavailable, ""))?;
        self.entries.insert(
            staged.record.id.clone(),
            Entry {
                path,
                record: staged.record.clone(),
            },
        );
        Ok(ImportResult {
            record: staged.record,
            name: staged.name,
        })
    }
    pub fn import_avatar(&mut self, path: &Path) -> Result<ImportResult, AppError> {
        let staged = stage_avatar(&self.library, path)?;
        self.commit(staged)
    }
    pub fn store_scene(&mut self, packed: PackedScene) -> Result<ImportResult, AppError> {
        let prepared = prepare_scene(packed)?;
        if let Some(existing) = self.intact(&prepared.record.id) {
            return Ok(existing);
        }
        let staged = stage_scene(&self.library, prepared)?;
        self.commit(staged)
    }
    pub fn load(manifest: &Path) -> Result<Self, AppError> {
        let path = manifest
            .canonicalize()
            .map_err(|_| error(ErrorCode::NotFound, ""))?;
        let root = path
            .parent()
            .ok_or_else(|| invalid("Invalid manifest location"))?
            .to_path_buf();
        let bytes = std::fs::read(&path).map_err(|_| error(ErrorCode::NotFound, ""))?;
        let mut value: Value =
            serde_json::from_slice(&bytes).map_err(|_| invalid("Invalid asset manifest"))?;
        // Older local manifests have records without a name: use the record ID as the name.
        if let Some(assets) = value.get_mut("assets").and_then(Value::as_array_mut) {
            for entry in assets.iter_mut().filter_map(Value::as_object_mut) {
                let path = entry.get("path").and_then(Value::as_str).map(PathBuf::from);
                let Some(record) = entry.get_mut("record").and_then(Value::as_object_mut) else {
                    continue;
                };
                if !record.contains_key("name") {
                    if let Some(id) = record.get("id").cloned() {
                        record.insert("name".into(), id);
                    }
                }
                // Older manifests have no expression list: read it from a VRM fixture file.
                if !record.contains_key("expressions") {
                    let expressions = path
                        .clone()
                        .filter(|_| record.get("format").and_then(Value::as_str) == Some("vrm"))
                        .and_then(|path| stored_vrm(&path))
                        .map(|(json, raw)| super::vrm::vrm_expressions(&json, &raw))
                        .unwrap_or_default();
                    record.insert(
                        "expressions".into(),
                        serde_json::to_value(expressions).unwrap_or_default(),
                    );
                }
                // Fixture avatars get the rig from the same reader as an import (B21 R6).
                if !record.contains_key("rig")
                    && record.get("format").and_then(Value::as_str) == Some("vrm")
                {
                    if let Some(rig) = path
                        .as_ref()
                        .and_then(|path| stored_vrm(path))
                        .and_then(|(json, _)| super::vrm::vrm_rig(&json))
                    {
                        record.insert("rig".into(), serde_json::to_value(rig).unwrap_or_default());
                    }
                }
            }
        }
        let manifest: Manifest =
            serde_json::from_value(value).map_err(|_| invalid("Invalid asset manifest"))?;
        if manifest.schema_version != 1 || manifest.fixture_id != "smoke_v1" {
            return Err(invalid("Invalid asset manifest version or fixture"));
        }
        let mut entries = HashMap::new();
        for entry in manifest.assets {
            entry.record.validate()?;
            if !opaque(&entry.record.id)
                || !entry.path.is_absolute()
                || entries.contains_key(&entry.record.id)
            {
                return Err(invalid("Invalid asset registration"));
            }
            entries.insert(entry.record.id.clone(), entry);
        }
        // Individual missing/corrupt fixtures must not prevent the local service from starting.
        Ok(Self {
            library: root.join("library"),
            root,
            entries,
        })
    }
    pub fn fixture_records(&self) -> Vec<AssetRecord> {
        self.records()
            .into_iter()
            .filter(|r| !r.id.starts_with("avatar_") && !r.id.starts_with("scene_"))
            .collect()
    }
    pub fn records(&self) -> Vec<AssetRecord> {
        let mut records: Vec<_> = self.entries.values().map(|e| e.record.clone()).collect();
        records.sort_by(|a, b| a.id.cmp(&b.id));
        records
    }
    pub fn read(&self, id: &str) -> Result<Vec<u8>, AppError> {
        let (path, record) = self.locate(id)?;
        read_located(&path, &record)
    }
    /// Resolves an ID to its library path and record. Callers read the file with `read_located` after they release the lock.
    pub fn locate(&self, id: &str) -> Result<(PathBuf, AssetRecord), AppError> {
        let record = self
            .entries
            .get(id)
            .ok_or_else(|| error(ErrorCode::NotFound, id))?
            .record
            .clone();
        Ok((resolve_asset(id, self)?, record))
    }
}
/// Reads a located asset and checks its length, hash, and container. It does not need the registry.
pub fn read_located(path: &Path, record: &AssetRecord) -> Result<Vec<u8>, AppError> {
    let id = record.id.as_str();
    let bytes = std::fs::read(path).map_err(|_| error(ErrorCode::NotFound, id))?;
    if bytes.len() as u64 != record.bytes || hex(&Sha256::digest(&bytes)) != record.sha256 {
        return Err(error(ErrorCode::InvalidInput, id));
    }
    validate_glb(&bytes).map_err(|_| error(ErrorCode::InvalidInput, id))?;
    Ok(bytes)
}
/// Temporary library files that `AssetRegistry::commit` renames into place. Dropping it removes the files.
pub struct StagedAsset {
    record: AssetRecord,
    name: String,
    library: PathBuf,
    files: Vec<(tempfile::NamedTempFile, String)>,
    // Scenes keep an intact existing entry (environment import R14). Avatars replace it, as before.
    deduplicate: bool,
}
impl StagedAsset {
    pub fn id(&self) -> &str {
        &self.record.id
    }
}
/// A validated scene and its record, before any library write.
pub struct PreparedScene {
    record: AssetRecord,
    name: String,
    glb: Vec<u8>,
}
impl PreparedScene {
    pub fn id(&self) -> &str {
        &self.record.id
    }
}
fn temp_file(dir: &Path, bytes: &[u8]) -> Result<tempfile::NamedTempFile, AppError> {
    let mut temp =
        tempfile::NamedTempFile::new_in(dir).map_err(|_| error(ErrorCode::Unavailable, ""))?;
    temp.write_all(bytes)
        .map_err(|_| error(ErrorCode::Unavailable, ""))?;
    temp.as_file()
        .sync_all()
        .map_err(|_| error(ErrorCode::Unavailable, ""))?;
    Ok(temp)
}
fn record_file(
    dir: &Path,
    record: &AssetRecord,
) -> Result<(tempfile::NamedTempFile, String), AppError> {
    let bytes = serde_json::to_vec(record).map_err(|_| invalid("Invalid asset record"))?;
    Ok((temp_file(dir, &bytes)?, format!("{}.json", record.id)))
}
pub fn prepare_scene(packed: PackedScene) -> Result<PreparedScene, AppError> {
    validate_glb(&packed.glb)?;
    let sha256 = hex(&Sha256::digest(&packed.glb));
    let id = format!("scene_{sha256}");
    let credits = packed.credits;
    let name = credits
        .as_ref()
        .and_then(|c| c.title.as_deref())
        .filter(|t| t.encode_utf16().count() <= 128)
        .and_then(bounded_name)
        .or_else(|| bounded_name(&packed.stem))
        .unwrap_or_else(|| "Scene".into());
    let record = AssetRecord {
        id,
        format: AssetFormat::Glb,
        sha256,
        bytes: packed.glb.len() as u64,
        source_url: credits.as_ref().and_then(|c| c.source_url.clone()),
        license_label: credits
            .as_ref()
            .and_then(|c| c.license.clone())
            .unwrap_or_default(),
        importer_version: 1,
        name: name.clone(),
        credits,
        expressions: vec![],
        eye_bones: None,
        rig: None,
    };
    record.validate()?;
    Ok(PreparedScene {
        record,
        name,
        glb: packed.glb,
    })
}
/// Writes and syncs the scene and its record as temporary files in the library. Runs without the registry lock.
pub fn stage_scene(library: &Path, prepared: PreparedScene) -> Result<StagedAsset, AppError> {
    std::fs::create_dir_all(library).map_err(|_| error(ErrorCode::Unavailable, ""))?;
    let glb = (
        temp_file(library, &prepared.glb)?,
        format!("{}.glb", prepared.record.id),
    );
    let json = record_file(library, &prepared.record)?;
    Ok(StagedAsset {
        record: prepared.record,
        name: prepared.name,
        library: library.to_path_buf(),
        files: vec![glb, json],
        deduplicate: true,
    })
}
/// Copies, hashes, and validates an avatar into temporary library files. Runs without the registry lock.
pub fn stage_avatar(library: &Path, path: &Path) -> Result<StagedAsset, AppError> {
    let mut source = std::fs::File::open(path).map_err(|_| error(ErrorCode::NotFound, ""))?;
    let size = source
        .metadata()
        .map_err(|_| error(ErrorCode::Unavailable, ""))?
        .len();
    if size > MAX_IMPORT_BYTES {
        return Err(invalid("Avatar exceeds import budget"));
    }
    std::fs::create_dir_all(library).map_err(|_| error(ErrorCode::Unavailable, ""))?;
    let mut copy =
        tempfile::NamedTempFile::new_in(library).map_err(|_| error(ErrorCode::Unavailable, ""))?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    let mut count = 0u64;
    loop {
        let n = source
            .read(&mut buffer)
            .map_err(|_| error(ErrorCode::Unavailable, ""))?;
        if n == 0 {
            break;
        }
        count += n as u64;
        if count > MAX_IMPORT_BYTES {
            return Err(invalid("Avatar exceeds import budget"));
        }
        hash.update(&buffer[..n]);
        copy.write_all(&buffer[..n])
            .map_err(|_| error(ErrorCode::Unavailable, ""))?;
    }
    copy.as_file_mut()
        .flush()
        .map_err(|_| error(ErrorCode::Unavailable, ""))?;
    let (json, raw) = validate_import_file(copy.as_file_mut(), count)?;
    let expressions = super::vrm::vrm_expressions(&json, &raw);
    let eye_bones = Some(super::vrm::vrm_has_eye_bones(&json));
    let rig = super::vrm::vrm_rig(&json);
    let sha256 = hex(&hash.finalize());
    let id = format!("avatar_{sha256}");
    let name = meta_name(&json)
        .or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .and_then(bounded_name)
        })
        .unwrap_or_else(|| "Avatar".into());
    let record = AssetRecord {
        id: id.clone(),
        format: AssetFormat::Vrm,
        sha256,
        bytes: count,
        source_url: None,
        license_label: "User supplied".into(),
        importer_version: 1,
        name: name.clone(),
        credits: None,
        expressions,
        eye_bones,
        rig,
    };
    copy.as_file()
        .sync_all()
        .map_err(|_| error(ErrorCode::Unavailable, ""))?;
    let json = record_file(library, &record)?;
    Ok(StagedAsset {
        record,
        name,
        library: library.to_path_buf(),
        files: vec![(copy, format!("{id}.vrm")), json],
        deduplicate: false,
    })
}
pub fn resolve_asset(id: &str, registry: &AssetRegistry) -> Result<PathBuf, AppError> {
    if !opaque(id) {
        return Err(error(ErrorCode::InvalidInput, ""));
    }
    let entry = registry
        .entries
        .get(id)
        .ok_or_else(|| error(ErrorCode::NotFound, id))?;
    let path = entry
        .path
        .canonicalize()
        .map_err(|_| error(ErrorCode::NotFound, id))?;
    if (!path.starts_with(&registry.root) && !path.starts_with(&registry.library))
        || !path.is_file()
    {
        return Err(error(ErrorCode::InvalidInput, id));
    }
    Ok(path)
}
pub(super) fn validate_glb(bytes: &[u8]) -> Result<(), AppError> {
    let word = |offset: usize| -> Result<u32, AppError> {
        let raw: [u8; 4] = bytes
            .get(offset..offset + 4)
            .ok_or_else(|| invalid("Truncated GLB"))?
            .try_into()
            .map_err(|_| invalid("Truncated GLB"))?;
        Ok(u32::from_le_bytes(raw))
    };
    if bytes.get(..4) != Some(b"glTF") || word(4)? != 2 || word(8)? as usize != bytes.len() {
        return Err(invalid("Invalid GLB"));
    }
    let mut offset = 12;
    let mut json = None;
    let mut binary = false;
    while offset < bytes.len() {
        let size = word(offset)? as usize;
        let kind = word(offset + 4)?;
        offset += 8;
        let end = offset
            .checked_add(size)
            .ok_or_else(|| invalid("Invalid GLB chunk"))?;
        let chunk = bytes
            .get(offset..end)
            .ok_or_else(|| invalid("Invalid GLB chunk"))?;
        if !size.is_multiple_of(4) {
            return Err(invalid("Unaligned GLB chunk"));
        }
        match kind {
            0x4e4f534a if json.is_none() && offset == 20 => {
                json = Some(
                    serde_json::from_slice::<Value>(chunk)
                        .map_err(|_| invalid("Invalid GLB JSON"))?,
                )
            }
            0x004e4942 if json.is_some() && !binary => binary = true,
            _ => return Err(invalid("Invalid GLB chunks")),
        }
        offset = end;
    }
    let json = json.ok_or_else(|| invalid("Missing GLB JSON"))?;
    fn external(value: &Value) -> bool {
        match value {
            Value::Object(o) => o.iter().any(|(k, v)| {
                k == "uri" && !v.as_str().is_some_and(|s| s.starts_with("data:")) || external(v)
            }),
            Value::Array(a) => a.iter().any(external),
            _ => false,
        }
    }
    if external(&json) {
        return Err(invalid("External GLB URI"));
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn service_asset_rejects_encoded_traversal_and_unknown() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("manifest.json");
        std::fs::write(
            &p,
            r#"{"schemaVersion":1,"fixtureId":"smoke_v1","assets":[]}"#,
        )
        .unwrap();
        let registry = AssetRegistry::load(&p).unwrap();
        assert_eq!(
            resolve_asset("%2e%2e", &registry).unwrap_err().code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            resolve_asset("missing", &registry).unwrap_err().code,
            ErrorCode::NotFound
        );
    }
    #[test]
    fn service_asset_glb_rejects_external_uri() {
        let mut json = br#"{"images":[{"uri":"secret.png"}]}"#.to_vec();
        while !json.len().is_multiple_of(4) {
            json.push(b' ');
        }
        let mut bytes = b"glTF".to_vec();
        bytes.extend(2u32.to_le_bytes());
        bytes.extend((20u32 + json.len() as u32).to_le_bytes());
        bytes.extend((json.len() as u32).to_le_bytes());
        bytes.extend(0x4e4f534au32.to_le_bytes());
        bytes.extend(json);
        assert!(validate_glb(&bytes).is_err());
    }
    // Reads the manifest that scripts/prepare-fixtures.ts writes. Without it, the test has nothing to check.
    #[test]
    fn prepared_local_fixtures_load_and_read() {
        let manifest =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/local/manifest.json");
        if !manifest.is_file() {
            eprintln!("skip: no {}", manifest.display());
            return;
        }
        let registry = AssetRegistry::load(&manifest).unwrap();
        let records = registry.fixture_records();
        assert!(!records.is_empty());
        for record in records {
            let bytes = registry.read(&record.id).unwrap();
            assert_eq!(bytes.len() as u64, record.bytes, "{}", record.id);
            if matches!(record.format, AssetFormat::Vrm) {
                assert!(!record.expressions.is_empty(), "{}", record.id);
                // The VMC sender reads the rest data of each fixture avatar (B21 R6).
                let rig = record.rig.as_ref().expect("fixture rig");
                assert!(rig.rest_positions.contains_key("hips"), "{}", record.id);
                eprintln!(
                    "{}: VRM {:?}, {} rest positions, identityRest {}",
                    record.id,
                    rig.meta_version,
                    rig.rest_positions.len(),
                    rig.identity_rest
                );
            }
        }
    }
}
#[cfg(test)]
mod boundary_tests {
    use super::*;
    fn glb() -> Vec<u8> {
        let mut json = br#"{"asset":{"version":"2.0"}}"#.to_vec();
        while !json.len().is_multiple_of(4) {
            json.push(b' ');
        }
        let mut bytes = b"glTF".to_vec();
        bytes.extend(2u32.to_le_bytes());
        bytes.extend((20 + json.len() as u32).to_le_bytes());
        bytes.extend((json.len() as u32).to_le_bytes());
        bytes.extend(0x4e4f534au32.to_le_bytes());
        bytes.extend(json);
        bytes
    }
    fn packed(title: Option<&str>, glb: Vec<u8>) -> super::super::PackedScene {
        super::super::PackedScene {
            glb,
            credits: title.map(|t| opensekai_contracts::AssetCredits {
                title: Some(t.into()),
                author: Some("CG Lads".into()),
                license: Some("CC-BY-4.0".into()),
                source_url: Some("https://sketchfab.com/3d-models/room".into()),
            }),
            stem: "scene".into(),
        }
    }
    #[test]
    fn stores_scene_with_credits_and_reloads_it() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = AssetRegistry::empty(dir.path()).unwrap();
        let result = registry.store_scene(packed(Some("Room"), glb())).unwrap();
        let record = &result.record;
        assert!(record.id.starts_with("scene_"));
        assert_eq!(record.format, opensekai_contracts::AssetFormat::Glb);
        assert_eq!(record.name, "Room");
        assert_eq!(record.license_label, "CC-BY-4.0");
        assert_eq!(
            record.source_url.as_deref(),
            Some("https://sketchfab.com/3d-models/room")
        );
        assert_eq!(registry.read(&record.id).unwrap(), glb());
        let reopened = AssetRegistry::empty(dir.path()).unwrap();
        assert_eq!(reopened.records(), vec![record.clone()]);
        assert_eq!(reopened.read(&record.id).unwrap(), glb());
    }
    #[test]
    fn same_scene_returns_the_existing_record() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = AssetRegistry::empty(dir.path()).unwrap();
        let first = registry.store_scene(packed(Some("Room"), glb())).unwrap();
        let second = registry.store_scene(packed(Some("Other"), glb())).unwrap();
        assert_eq!(first.record, second.record);
        assert_eq!(registry.records().len(), 1);
    }
    #[test]
    fn storing_again_repairs_a_missing_scene_file() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = AssetRegistry::empty(dir.path()).unwrap();
        let id = registry
            .store_scene(packed(Some("Room"), glb()))
            .unwrap()
            .record
            .id;
        let file = registry.entries.get(&id).unwrap().path.clone();
        std::fs::remove_file(&file).unwrap();
        assert!(registry.read(&id).is_err());
        registry.store_scene(packed(Some("Room"), glb())).unwrap();
        assert!(file.is_file());
        assert_eq!(registry.read(&id).unwrap(), glb());
        assert_eq!(registry.records().len(), 1);
    }
    #[test]
    fn storing_again_repairs_a_scene_file_of_the_wrong_length() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = AssetRegistry::empty(dir.path()).unwrap();
        let id = registry
            .store_scene(packed(Some("Room"), glb()))
            .unwrap()
            .record
            .id;
        let file = registry.entries.get(&id).unwrap().path.clone();
        std::fs::write(&file, &glb()[..8]).unwrap();
        registry.store_scene(packed(Some("Room"), glb())).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), glb());
        assert_eq!(registry.records().len(), 1);
    }
    #[test]
    fn scene_name_keeps_a_title_of_128_code_units() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = AssetRegistry::empty(dir.path()).unwrap();
        let title = "x".repeat(128);
        assert_eq!(
            registry
                .store_scene(packed(Some(&title), glb()))
                .unwrap()
                .record
                .name,
            title
        );
    }
    #[test]
    fn scene_name_falls_back_to_stem_then_scene() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = AssetRegistry::empty(dir.path()).unwrap();
        let long = "x".repeat(129);
        assert_eq!(
            registry
                .store_scene(packed(Some(&long), glb()))
                .unwrap()
                .record
                .name,
            "scene"
        );
        let mut other = glb();
        other.extend([b' '; 4]);
        let len = other.len() as u32;
        other[8..12].copy_from_slice(&len.to_le_bytes());
        other[12..16].copy_from_slice(&(len - 20).to_le_bytes());
        let mut nameless = packed(None, other);
        nameless.stem = "   ".into();
        let record = registry.store_scene(nameless).unwrap().record;
        assert_eq!(record.name, "Scene");
        assert!(record.credits.is_none());
        assert_eq!(record.license_label, "");
    }
    #[test]
    fn scene_with_external_uri_is_not_stored() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = AssetRegistry::empty(dir.path()).unwrap();
        let mut json = br#"{"images":[{"uri":"secret.png"}]}"#.to_vec();
        while !json.len().is_multiple_of(4) {
            json.push(b' ');
        }
        let mut bytes = b"glTF".to_vec();
        bytes.extend(2u32.to_le_bytes());
        bytes.extend((20 + json.len() as u32).to_le_bytes());
        bytes.extend((json.len() as u32).to_le_bytes());
        bytes.extend(0x4e4f534au32.to_le_bytes());
        bytes.extend(json);
        assert!(registry.store_scene(packed(Some("Room"), bytes)).is_err());
        assert!(registry.records().is_empty());
    }
    fn registry(root: &Path, path: &Path, bytes: &[u8]) -> AssetRegistry {
        let hash = Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let manifest = root.join("manifest.json");
        std::fs::write(&manifest,serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"fixtureId":"smoke_v1","assets":[{"record":{"id":"fixture_asset","format":"glb","sha256":hash,"bytes":bytes.len(),"sourceUrl":null,"licenseLabel":"test","importerVersion":1,"name":"Test"},"path":path}]})).unwrap()).unwrap();
        AssetRegistry::load(&manifest).unwrap()
    }
    #[test]
    fn manifest_record_without_name_uses_its_id() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("asset.glb");
        let bytes = glb();
        std::fs::write(&path, &bytes).unwrap();
        let hash = Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let manifest = root.path().join("manifest.json");
        std::fs::write(&manifest,serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"fixtureId":"smoke_v1","assets":[{"record":{"id":"fixture_asset","format":"glb","sha256":hash,"bytes":bytes.len(),"sourceUrl":null,"licenseLabel":"test","importerVersion":1},"path":path}]})).unwrap()).unwrap();
        let registry = AssetRegistry::load(&manifest).unwrap();
        let record = registry
            .records()
            .into_iter()
            .find(|r| r.id == "fixture_asset")
            .unwrap();
        assert_eq!(record.name, "fixture_asset");
    }
    #[test]
    fn service_asset_bytes_hash_and_missing_are_checked() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("asset.glb");
        let bytes = glb();
        std::fs::write(&path, &bytes).unwrap();
        let registry = registry(root.path(), &path, &bytes);
        assert_eq!(registry.read("fixture_asset").unwrap(), bytes);
        std::fs::write(&path, b"corrupt").unwrap();
        assert_eq!(
            registry.read("fixture_asset").unwrap_err().code,
            ErrorCode::InvalidInput
        );
        std::fs::remove_file(path).unwrap();
        assert_eq!(
            registry.read("fixture_asset").unwrap_err().code,
            ErrorCode::NotFound
        );
    }
    #[cfg(unix)]
    #[test]
    fn service_asset_symlink_cannot_escape_root() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("asset.glb");
        let bytes = glb();
        std::fs::write(&target, &bytes).unwrap();
        let path = root.path().join("asset.glb");
        std::os::unix::fs::symlink(target, &path).unwrap();
        let registry = registry(root.path(), &path, &bytes);
        assert_eq!(
            registry.read("fixture_asset").unwrap_err().code,
            ErrorCode::InvalidInput
        );
    }
}

#[cfg(test)]
mod import_tests {
    use super::*;
    pub(super) fn vrm(json: &str) -> Vec<u8> {
        let mut j = json.as_bytes().to_vec();
        while !j.len().is_multiple_of(4) {
            j.push(b' ');
        }
        let mut b = b"glTF".to_vec();
        b.extend(2u32.to_le_bytes());
        b.extend((20 + j.len() as u32).to_le_bytes());
        b.extend((j.len() as u32).to_le_bytes());
        b.extend(0x4e4f534au32.to_le_bytes());
        b.extend(j);
        b
    }
    #[test]
    fn managed_import_copies_content_and_deduplicates() {
        let source = tempfile::tempdir().unwrap();
        let managed = tempfile::tempdir().unwrap();
        let path = source.path().join("avatar.vrm");
        let bytes = vrm(include_str!("../../tests/fixtures/minimal-vrm1.json"));
        std::fs::write(&path, &bytes).unwrap();
        let mut r = AssetRegistry::empty(managed.path()).unwrap();
        let a = r.import_avatar(&path).unwrap();
        assert_eq!(a.record.bytes, bytes.len() as u64);
        assert_eq!(r.read(&a.record.id).unwrap(), bytes);
        assert_eq!(r.import_avatar(&path).unwrap().record.id, a.record.id);
        std::fs::remove_file(path).unwrap();
        assert!(r.read(&a.record.id).is_ok());
        let reopened = AssetRegistry::empty(managed.path()).unwrap();
        assert_eq!(reopened.read(&a.record.id).unwrap(), bytes);
    }
    fn with_expressions() -> String {
        include_str!("../../tests/fixtures/minimal-vrm1.json").replacen(
            r#""VRMC_vrm": {"#,
            r#""VRMC_vrm": {"expressions":{"preset":{"happy":{},"aa":{}},"custom":{"Wink":{}}},"#,
            1,
        )
    }
    #[test]
    fn import_and_library_load_fill_the_rig() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rig.vrm");
        std::fs::write(
            &path,
            vrm(include_str!("../../tests/fixtures/minimal-vrm0.json")),
        )
        .unwrap();
        let managed = dir.path().join("managed");
        let mut r = AssetRegistry::empty(&managed).unwrap();
        let imported = r.import_avatar(&path).unwrap().record;
        let rig = imported.rig.clone().unwrap();
        assert_eq!(rig.meta_version, opensekai_contracts::RigMetaVersion::V0);
        assert_eq!(rig.rest_positions["hips"], [0., 1., 0.]);
        assert!(rig.identity_rest);
        // A record from before B21 gets the rig from its stored file, and the library writes it again.
        let json_path = r.library().join(format!("{}.json", imported.id));
        let mut old: Value = serde_json::from_slice(&std::fs::read(&json_path).unwrap()).unwrap();
        old.as_object_mut().unwrap().remove("rig");
        std::fs::write(&json_path, old.to_string()).unwrap();
        let reopened = AssetRegistry::empty(&managed).unwrap();
        assert_eq!(reopened.records()[0].rig, Some(rig));
        let written: Value = serde_json::from_slice(&std::fs::read(&json_path).unwrap()).unwrap();
        assert_eq!(written["rig"]["metaVersion"], "0");
        // A stored file that does not parse leaves the record without a rig.
        std::fs::write(&json_path, old.to_string()).unwrap();
        std::fs::write(r.library().join(format!("{}.vrm", imported.id)), b"broken").unwrap();
        let broken = AssetRegistry::empty(&managed).unwrap();
        assert_eq!(broken.records().len(), 1);
        assert!(broken.records()[0].rig.is_none());
    }
    #[test]
    fn import_and_library_load_record_expression_names() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("expressive.vrm");
        std::fs::write(&path, vrm(&with_expressions())).unwrap();
        let managed = dir.path().join("managed");
        let mut r = AssetRegistry::empty(&managed).unwrap();
        let imported = r.import_avatar(&path).unwrap().record;
        let names: Vec<_> = imported
            .expressions
            .iter()
            .map(|e| (e.name.as_str(), e.preset))
            .collect();
        assert_eq!(names, [("happy", true), ("Wink", false)]);
        // A record written before expression lists existed gets the list from its stored file.
        let json_path = r.library().join(format!("{}.json", imported.id));
        let mut old: Value = serde_json::from_slice(&std::fs::read(&json_path).unwrap()).unwrap();
        old.as_object_mut().unwrap().remove("expressions");
        std::fs::write(&json_path, old.to_string()).unwrap();
        let reopened = AssetRegistry::empty(&managed).unwrap();
        assert_eq!(reopened.records()[0].expressions, imported.expressions);
        let written: Value = serde_json::from_slice(&std::fs::read(&json_path).unwrap()).unwrap();
        assert_eq!(written["expressions"][1]["name"], "Wink");
        // A list from the first importer still has tracked names: the library reads it again.
        old["expressions"] =
            serde_json::json!([{"name":"happy","preset":true},{"name":"aa","preset":true}]);
        std::fs::write(&json_path, old.to_string()).unwrap();
        let rebuilt = AssetRegistry::empty(&managed).unwrap();
        assert_eq!(rebuilt.records()[0].expressions, imported.expressions);
        // A stored file that does not parse gives an empty list and keeps the record.
        old.as_object_mut().unwrap().remove("expressions");
        std::fs::write(&json_path, old.to_string()).unwrap();
        std::fs::write(r.library().join(format!("{}.vrm", imported.id)), b"broken").unwrap();
        let broken = AssetRegistry::empty(&managed).unwrap();
        assert_eq!(broken.records().len(), 1);
        assert!(broken.records()[0].expressions.is_empty());
    }
    #[test]
    fn imports_vrm0_thumb_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("thumb.vrm");
        let bytes = vrm(include_str!("../../tests/fixtures/minimal-vrm0.json"));
        std::fs::write(&path, bytes).unwrap();
        assert!(AssetRegistry::empty(dir.path())
            .unwrap()
            .import_avatar(&path)
            .is_ok());
    }
    #[test]
    fn managed_import_rejects_non_vrm_and_external_resources() {
        let dir = tempfile::tempdir().unwrap();
        let mut r = AssetRegistry::empty(dir.path()).unwrap();
        for json in [
            r#"{"asset":{"version":"2.0"}}"#,
            r#"{"extensions":{"VRM":{"humanoid":{"humanBones":[{"bone":"hips","node":0}]}}},"images":[{"uri":"secret.png"}]}"#,
        ] {
            let p = dir.path().join("bad.vrm");
            std::fs::write(&p, vrm(json)).unwrap();
            assert!(r.import_avatar(&p).is_err());
        }
        assert!(r.records().is_empty());
    }
    fn without_meta_name() -> String {
        let mut v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/minimal-vrm1.json")).unwrap();
        v["extensions"]["VRMC_vrm"]["meta"]
            .as_object_mut()
            .unwrap()
            .remove("name");
        v.to_string()
    }
    #[test]
    fn import_stores_meta_name_or_file_stem() {
        let dir = tempfile::tempdir().unwrap();
        let mut r = AssetRegistry::empty(&dir.path().join("managed")).unwrap();
        let named = dir.path().join("named.vrm");
        std::fs::write(
            &named,
            vrm(include_str!("../../tests/fixtures/minimal-vrm1.json")),
        )
        .unwrap();
        let a = r.import_avatar(&named).unwrap();
        assert_eq!(a.record.name, "Test avatar");
        assert_eq!(a.name, a.record.name);
        let stem = dir.path().join("Rem Model.vrm");
        std::fs::write(&stem, vrm(&without_meta_name())).unwrap();
        assert_eq!(r.import_avatar(&stem).unwrap().record.name, "Rem Model");
    }
    #[test]
    fn fills_a_missing_name_from_stored_vrm_meta() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("a.vrm");
        std::fs::write(
            &source,
            vrm(include_str!("../../tests/fixtures/minimal-vrm1.json")),
        )
        .unwrap();
        let managed = dir.path().join("managed");
        let id = AssetRegistry::empty(&managed)
            .unwrap()
            .import_avatar(&source)
            .unwrap()
            .record
            .id;
        let json = managed.join("library").join(format!("{id}.json"));
        let mut legacy: Value = serde_json::from_slice(&std::fs::read(&json).unwrap()).unwrap();
        legacy.as_object_mut().unwrap().remove("name");
        std::fs::write(&json, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let reopened = AssetRegistry::empty(&managed).unwrap();
        assert_eq!(reopened.records()[0].name, "Test avatar");
        let rewritten: Value = serde_json::from_slice(&std::fs::read(&json).unwrap()).unwrap();
        assert_eq!(rewritten["name"], "Test avatar");
    }
    #[test]
    fn legacy_record_with_unreadable_file_falls_back_to_avatar() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("a.vrm");
        std::fs::write(
            &source,
            vrm(include_str!("../../tests/fixtures/minimal-vrm1.json")),
        )
        .unwrap();
        let managed = dir.path().join("managed");
        let id = AssetRegistry::empty(&managed)
            .unwrap()
            .import_avatar(&source)
            .unwrap()
            .record
            .id;
        let library = managed.join("library");
        let json = library.join(format!("{id}.json"));
        let mut legacy: Value = serde_json::from_slice(&std::fs::read(&json).unwrap()).unwrap();
        legacy.as_object_mut().unwrap().remove("name");
        std::fs::write(&json, serde_json::to_vec(&legacy).unwrap()).unwrap();
        std::fs::write(library.join(format!("{id}.vrm")), b"not a glb").unwrap();
        let reopened = AssetRegistry::empty(&managed).unwrap();
        assert_eq!(reopened.records()[0].name, "Avatar");
    }
}
fn bounded_name(name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let mut units = 0;
    Some(
        name.chars()
            .take_while(|c| {
                units += c.len_utf16();
                units <= 128
            })
            .collect(),
    )
}
fn meta_name(json: &Value) -> Option<String> {
    json.pointer("/extensions/VRMC_vrm/meta/name")
        .or_else(|| json.pointer("/extensions/VRM/meta/title"))
        .and_then(Value::as_str)
        .and_then(bounded_name)
}
/// The JSON chunk of a stored VRM, or None when the file does not open or validate.
fn stored_vrm(path: &Path) -> Option<(Value, Vec<u8>)> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    validate_import_file(&mut file, len).ok()
}
/// Validates a stored or imported VRM and returns its JSON chunk, parsed and raw.
fn validate_import_file(file: &mut std::fs::File, len: u64) -> Result<(Value, Vec<u8>), AppError> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| invalid("Invalid avatar file"))?;
    let mut header = [0u8; 12];
    file.read_exact(&mut header)
        .map_err(|_| invalid("Truncated GLB"))?;
    if &header[..4] != b"glTF"
        || u32::from_le_bytes(header[4..8].try_into().unwrap()) != 2
        || u32::from_le_bytes(header[8..].try_into().unwrap()) as u64 != len
    {
        return Err(invalid("Invalid GLB header"));
    }
    let mut offset = 12u64;
    let mut json = None;
    let mut raw = Vec::new();
    let mut binary = false;
    while offset < len {
        let mut h = [0u8; 8];
        file.read_exact(&mut h)
            .map_err(|_| invalid("Truncated GLB chunk"))?;
        let size = u32::from_le_bytes(h[..4].try_into().unwrap()) as usize;
        let kind = u32::from_le_bytes(h[4..].try_into().unwrap());
        offset += 8;
        if !size.is_multiple_of(4) || offset + size as u64 > len {
            return Err(invalid("Invalid GLB chunk"));
        }
        match kind {
            0x4e4f534a if json.is_none() && offset == 20 => {
                if size > MAX_GLB_JSON_BYTES {
                    return Err(invalid("GLB JSON exceeds budget"));
                }
                let mut data = vec![0; size];
                file.read_exact(&mut data)
                    .map_err(|_| invalid("Truncated GLB JSON"))?;
                json = Some(
                    serde_json::from_slice::<Value>(&data)
                        .map_err(|_| invalid("Invalid GLB JSON"))?,
                );
                raw = data;
            }
            0x004e4942 if json.is_some() && !binary => {
                binary = true;
                file.seek(SeekFrom::Current(size as i64))
                    .map_err(|_| invalid("Invalid GLB binary"))?;
            }
            _ => return Err(invalid("Invalid GLB chunks")),
        }
        offset += size as u64;
    }
    let json = json.ok_or_else(|| invalid("Missing GLB JSON"))?;
    fn external(v: &Value) -> bool {
        match v {
            Value::Object(o) => o.iter().any(|(k, v)| k == "uri" || external(v)),
            Value::Array(a) => a.iter().any(external),
            _ => false,
        }
    }
    if external(&json) {
        return Err(invalid("External GLB URI"));
    }
    let vrm1 = json.pointer("/extensions/VRMC_vrm");
    let vrm0 = json.pointer("/extensions/VRM");
    if json.pointer("/asset/version").and_then(Value::as_str) != Some("2.0")
        || vrm1.is_some() == vrm0.is_some()
        || vrm1.is_some_and(|v| v.get("specVersion").and_then(Value::as_str) != Some("1.0"))
        || vrm0.is_some_and(|v| v.get("specVersion").and_then(Value::as_str) != Some("0.0"))
    {
        return Err(invalid("Unsupported VRM version"));
    }
    super::vrm::validate_humanoid(&json, vrm0.is_some())?;
    Ok((json, raw))
}
#[cfg(test)]
mod budget_tests {
    use super::*;
    #[test]
    fn import_rejects_sparse_oversized_file_without_reading_it() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("oversized.vrm");
        std::fs::File::create(&p)
            .unwrap()
            .set_len(MAX_IMPORT_BYTES + 1)
            .unwrap();
        let mut r = AssetRegistry::empty(dir.path()).unwrap();
        assert!(r.import_avatar(&p).is_err());
        assert!(r.records().is_empty());
    }
    #[test]
    fn json_budget_rejects_before_allocation() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("json.vrm");
        let size = MAX_GLB_JSON_BYTES as u32 + 4;
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(b"glTF").unwrap();
        f.write_all(&2u32.to_le_bytes()).unwrap();
        f.write_all(&(size + 20).to_le_bytes()).unwrap();
        f.write_all(&size.to_le_bytes()).unwrap();
        f.write_all(&0x4e4f534au32.to_le_bytes()).unwrap();
        f.set_len((size + 20) as u64).unwrap();
        drop(f);
        let mut f = std::fs::File::open(p).unwrap();
        assert!(validate_import_file(&mut f, (size + 20) as u64).is_err());
    }
}
#[cfg(test)]
mod rig_validation_tests {
    use super::*;
    #[test]
    fn rejects_incomplete_version_duplicate_and_data_uri() {
        let valid: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/minimal-vrm1.json")).unwrap();
        let mut cases = Vec::new();
        let mut incomplete = valid.clone();
        incomplete["extensions"]["VRMC_vrm"]["humanoid"]["humanBones"]
            .as_object_mut()
            .unwrap()
            .remove("head");
        cases.push(incomplete);
        let mut version = valid.clone();
        version["extensions"]["VRMC_vrm"]["specVersion"] = serde_json::json!("9.0");
        cases.push(version);
        let mut data = valid.clone();
        data["images"] = serde_json::json!([{"uri":"data:image/png;base64,AA=="}]);
        cases.push(data);
        let mut duplicate = valid.clone();
        duplicate["extensions"]["VRMC_vrm"]["humanoid"]["humanBones"]["head"]["node"] =
            serde_json::json!(0);
        cases.push(duplicate);
        let mut duplicate_name: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/minimal-vrm0.json")).unwrap();
        let bones = duplicate_name["extensions"]["VRM"]["humanoid"]["humanBones"]
            .as_array_mut()
            .unwrap();
        bones.push(bones[0].clone());
        cases.push(duplicate_name);
        let dir = tempfile::tempdir().unwrap();
        for json in cases {
            let p = dir.path().join("invalid.vrm");
            std::fs::write(&p, super::import_tests::vrm(&json.to_string())).unwrap();
            let mut registry = AssetRegistry::empty(dir.path()).unwrap();
            assert!(registry.import_avatar(&p).is_err());
            assert!(registry.records().is_empty());
        }
    }
}
