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
pub const MAX_IMPORT_BYTES: u64 = 128 * 1024 * 1024;
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
                if let Ok(record) = std::fs::read(&p).and_then(|b| {
                    serde_json::from_slice::<AssetRecord>(&b).map_err(std::io::Error::other)
                }) {
                    if record.validate().is_ok()
                        && opaque(&record.id)
                        && record.id == format!("avatar_{}", record.sha256)
                    {
                        self.entries.insert(
                            record.id.clone(),
                            Entry {
                                path: library.join(format!("{}.vrm", record.id)),
                                record,
                            },
                        );
                    }
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
        let record = AssetRecord {
            id: id.clone(),
            format: opensekai_contracts::AssetFormat::Vrm,
            sha256,
            bytes: count,
            source_url: None,
            license_label: "User supplied".into(),
            importer_version: 1,
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
        let name = json
            .pointer("/extensions/VRMC_vrm/meta/name")
            .or_else(|| json.pointer("/extensions/VRM/meta/title"))
            .and_then(Value::as_str)
            .filter(|n| !n.is_empty())
            .unwrap_or("Avatar")
            .chars()
            .take(128)
            .collect();
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
        let manifest: Manifest =
            serde_json::from_slice(&bytes).map_err(|_| invalid("Invalid asset manifest"))?;
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
            .filter(|r| !r.id.starts_with("avatar_"))
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
fn validate_glb(bytes: &[u8]) -> Result<(), AppError> {
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
    fn registry(root: &Path, path: &Path, bytes: &[u8]) -> AssetRegistry {
        let hash = Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let manifest = root.join("manifest.json");
        std::fs::write(&manifest,serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"fixtureId":"smoke_v1","assets":[{"record":{"id":"fixture_asset","format":"glb","sha256":hash,"bytes":bytes.len(),"sourceUrl":null,"licenseLabel":"test","importerVersion":1},"path":path}]})).unwrap()).unwrap();
        AssetRegistry::load(&manifest).unwrap()
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
