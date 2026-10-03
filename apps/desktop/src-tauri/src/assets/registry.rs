use opensekai_contracts::{invalid, AppError, AssetRecord, ErrorCode, Validate};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
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
impl AssetRegistry {
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
        Ok(Self { root, entries })
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
    if !path.starts_with(&registry.root) || !path.is_file() {
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
