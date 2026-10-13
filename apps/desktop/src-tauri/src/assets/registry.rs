use super::scene_import::PackedScene;
use opensekai_contracts::AssetFormat;
use opensekai_contracts::{invalid, AppError, AssetRecord, ErrorCode, Validate};
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
fn write_atomic(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), AppError> {
    let mut temp = tempfile::NamedTempFile::new_in(dir).map_err(|_| error(ErrorCode::Unavailable, ""))?;
    temp.write_all(bytes).map_err(|_| error(ErrorCode::Unavailable, ""))?;
    temp.as_file().sync_all().map_err(|_| error(ErrorCode::Unavailable, ""))?;
    temp.persist(dir.join(name)).map_err(|_| error(ErrorCode::Unavailable, ""))?;
    Ok(())
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
                let backfilled = value.get("name").is_none() && value.is_object();
                if backfilled {
                    value["name"] = Value::String(
                        stored_meta_name(&stored).unwrap_or_else(|| "Avatar".into()),
                    );
                }
                let Ok(record) = serde_json::from_value::<AssetRecord>(value) else {
                    continue;
                };
                let extension = if record.format == AssetFormat::Vrm && record.id == format!("avatar_{}", record.sha256) {
                    Some("vrm")
                } else if record.format == AssetFormat::Glb && record.id == format!("scene_{}", record.sha256) {
                    Some("glb")
                } else {
                    None
                };
                if let (true, true, Some(extension)) = (record.validate().is_ok(), opaque(&record.id), extension) {
                    if backfilled {
                        if let Ok(bytes) = serde_json::to_vec(&record) {
                            if let Ok(mut temp) = tempfile::NamedTempFile::new_in(&library) {
                                let _ = temp.write_all(&bytes).and_then(|_| temp.as_file().sync_all());
                                let _ = temp.persist(&p);
                            }
                        }
                    }
                    self.entries.insert(
                        record.id.clone(),
                        Entry { path: library.join(format!("{}.{extension}", record.id)), record },
                    );
                }
            }
        }
        Ok(())
    }
    pub fn import_avatar(&mut self, path: &Path) -> Result<ImportResult, AppError> {
        let mut source = std::fs::File::open(path).map_err(|_| error(ErrorCode::NotFound, ""))?;
        let size = source
            .metadata()
            .map_err(|_| error(ErrorCode::Unavailable, ""))?
            .len();
        if size > MAX_IMPORT_BYTES {
            return Err(invalid("Avatar exceeds import budget"));
        }
        let library = self.library.clone();
        std::fs::create_dir_all(&library).map_err(|_| error(ErrorCode::Unavailable, ""))?;
        let mut copy = tempfile::NamedTempFile::new_in(&library)
            .map_err(|_| error(ErrorCode::Unavailable, ""))?;
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
        let json = validate_import_file(copy.as_file_mut(), count)?;
        let sha256 = hash
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let id = format!("avatar_{sha256}");
        let name = meta_name(&json)
            .or_else(|| path.file_stem().and_then(|s| s.to_str()).and_then(bounded_name))
            .unwrap_or_else(|| "Avatar".into());
        let record = AssetRecord {
            id: id.clone(),
            format: opensekai_contracts::AssetFormat::Vrm,
            sha256,
            bytes: count,
            source_url: None,
            license_label: "User supplied".into(),
            importer_version: 1,
            name: name.clone(),
            credits: None,
        };
        let target = library.join(format!("{id}.vrm"));
        copy.as_file()
            .sync_all()
            .map_err(|_| error(ErrorCode::Unavailable, ""))?;
        copy.persist(&target)
            .map_err(|_| error(ErrorCode::Unavailable, ""))?;
        let mut metadata = tempfile::NamedTempFile::new_in(&library)
            .map_err(|_| error(ErrorCode::Unavailable, ""))?;
        metadata
            .write_all(&serde_json::to_vec(&record).map_err(|_| invalid("Invalid avatar record"))?)
            .map_err(|_| error(ErrorCode::Unavailable, ""))?;
        metadata
            .as_file()
            .sync_all()
            .map_err(|_| error(ErrorCode::Unavailable, ""))?;
        metadata
            .persist(library.join(format!("{id}.json")))
            .map_err(|_| error(ErrorCode::Unavailable, ""))?;
        self.entries.insert(
            id,
            Entry {
                record: record.clone(),
                path: target,
            },
        );
        Ok(ImportResult { record, name })
    }
    pub fn store_scene(&mut self, packed: PackedScene) -> Result<ImportResult, AppError> {
        validate_glb(&packed.glb)?;
        let sha256 = hex(&Sha256::digest(&packed.glb));
        let id = format!("scene_{sha256}");
        let intact = |entry: &Entry| std::fs::metadata(&entry.path).is_ok_and(|m| m.is_file() && m.len() == entry.record.bytes);
        if let Some(entry) = self.entries.get(&id).filter(|entry| intact(entry)) {
            return Ok(ImportResult { name: entry.record.name.clone(), record: entry.record.clone() });
        }
        let credits = packed.credits;
        let name = credits
            .as_ref()
            .and_then(|c| c.title.as_deref())
            .filter(|t| t.encode_utf16().count() <= 128)
            .and_then(bounded_name)
            .or_else(|| bounded_name(&packed.stem))
            .unwrap_or_else(|| "Scene".into());
        let record = AssetRecord {
            id: id.clone(),
            format: AssetFormat::Glb,
            sha256,
            bytes: packed.glb.len() as u64,
            source_url: credits.as_ref().and_then(|c| c.source_url.clone()),
            license_label: credits.as_ref().and_then(|c| c.license.clone()).unwrap_or_default(),
            importer_version: 1,
            name: name.clone(),
            credits,
        };
        record.validate()?;
        let library = self.library.clone();
        std::fs::create_dir_all(&library).map_err(|_| error(ErrorCode::Unavailable, ""))?;
        write_atomic(&library, &format!("{id}.glb"), &packed.glb)?;
        write_atomic(
            &library,
            &format!("{id}.json"),
            &serde_json::to_vec(&record).map_err(|_| invalid("Invalid scene record"))?,
        )?;
        self.entries.insert(id.clone(), Entry { path: library.join(format!("{id}.glb")), record: record.clone() });
        Ok(ImportResult { record, name })
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
            for record in assets
                .iter_mut()
                .filter_map(|entry| entry.get_mut("record").and_then(Value::as_object_mut))
            {
                if !record.contains_key("name") {
                    if let Some(id) = record.get("id").cloned() {
                        record.insert("name".into(), id);
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
        let entry = self
            .entries
            .get(id)
            .ok_or_else(|| error(ErrorCode::NotFound, id))?;
        let path = resolve_asset(id, self)?;
        let bytes = std::fs::read(path).map_err(|_| error(ErrorCode::NotFound, id))?;
        if bytes.len() as u64 != entry.record.bytes
            || Sha256::digest(&bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
                != entry.record.sha256
        {
            return Err(error(ErrorCode::InvalidInput, id));
        }
        validate_glb(&bytes).map_err(|_| error(ErrorCode::InvalidInput, id))?;
        Ok(bytes)
    }
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
        assert_eq!(record.source_url.as_deref(), Some("https://sketchfab.com/3d-models/room"));
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
        let id = registry.store_scene(packed(Some("Room"), glb())).unwrap().record.id;
        let file = registry.entries.get(&id).unwrap().path.clone();
        std::fs::remove_file(&file).unwrap();
        assert!(registry.read(&id).is_err());
        registry.store_scene(packed(Some("Room"), glb())).unwrap();
        assert!(file.is_file());
        assert_eq!(registry.read(&id).unwrap(), glb());
        assert_eq!(registry.records().len(), 1);
    }
    #[test]
    fn scene_name_falls_back_to_stem_then_scene() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = AssetRegistry::empty(dir.path()).unwrap();
        let long = "x".repeat(129);
        assert_eq!(registry.store_scene(packed(Some(&long), glb())).unwrap().record.name, "scene");
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
        std::fs::write(&named, vrm(include_str!("../../tests/fixtures/minimal-vrm1.json"))).unwrap();
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
        std::fs::write(&source, vrm(include_str!("../../tests/fixtures/minimal-vrm1.json"))).unwrap();
        let managed = dir.path().join("managed");
        let id = AssetRegistry::empty(&managed).unwrap().import_avatar(&source).unwrap().record.id;
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
        std::fs::write(&source, vrm(include_str!("../../tests/fixtures/minimal-vrm1.json"))).unwrap();
        let managed = dir.path().join("managed");
        let id = AssetRegistry::empty(&managed).unwrap().import_avatar(&source).unwrap().record.id;
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
fn stored_meta_name(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    meta_name(&validate_import_file(&mut file, len).ok()?)
}
fn validate_import_file(file: &mut std::fs::File, len: u64) -> Result<Value, AppError> {
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
    let nodes = json
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Missing VRM nodes"))?;
    let bones = json
        .pointer("/extensions/VRMC_vrm/humanoid/humanBones")
        .and_then(Value::as_object)
        .map(|b| {
            b.iter()
                .map(|(name, v)| (name.as_str(), v.get("node")))
                .collect::<Vec<_>>()
        })
        .or_else(|| {
            json.pointer("/extensions/VRM/humanoid/humanBones")
                .and_then(Value::as_array)
                .map(|b| {
                    b.iter()
                        .map(|v| {
                            (
                                v.get("bone").and_then(Value::as_str).unwrap_or(""),
                                v.get("node"),
                            )
                        })
                        .collect()
                })
        });
    let bones = bones.ok_or_else(|| invalid("Missing VRM humanoid"))?;
    let required = [
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
    let mut names = std::collections::HashSet::new();
    let mut node_ids = std::collections::HashSet::new();
    if required
        .iter()
        .any(|name| !bones.iter().any(|(n, _)| n == name))
        || (vrm0.is_some() && !bones.iter().any(|(n, _)| *n == "chest"))
        || bones.iter().any(|(name, node)| {
            !names.insert(*name) || !node_ids.insert(node.and_then(Value::as_u64))
        })
    {
        return Err(invalid("Missing or duplicate VRM humanoid bone"));
    }
    if bones.is_empty()
        || !bones.iter().any(|(name, _)| *name == "hips")
        || bones.iter().any(|(name, node)| {
            !(opensekai_contracts::humanoid_bone(name)
                || (vrm0.is_some()
                    && ["leftThumbIntermediate", "rightThumbIntermediate"].contains(name)))
                || node
                    .and_then(Value::as_u64)
                    .is_none_or(|n| n >= (nodes.len() as u64))
        })
    {
        return Err(invalid("Invalid VRM humanoid"));
    }
    Ok(json)
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
