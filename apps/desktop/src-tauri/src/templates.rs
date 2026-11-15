//! Show templates bundled in `<resources>/templates/`. The window asks for one by ID; the ID is
//! looked up in this table and never joined to a path.
use opensekai_contracts::{AppError, ErrorCode};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowTemplate {
    pub id: &'static str,
    pub name: &'static str,
    #[serde(skip)]
    pub file: &'static str,
}

pub const TEMPLATES: [ShowTemplate; 1] = [ShowTemplate {
    id: "stage-lights",
    name: "Stage Lights",
    file: "stage-lights.osekai",
}];

pub fn template_path(resource_dir: &Path, id: &str) -> Result<PathBuf, AppError> {
    TEMPLATES
        .iter()
        .find(|template| template.id == id)
        .map(|template| resource_dir.join("templates").join(template.file))
        .ok_or_else(|| AppError {
            code: ErrorCode::InvalidInput,
            message: "Unknown show template".into(),
            ids: vec![],
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use opensekai_contracts::ErrorCode;
    use serde_json::Value;

    fn resource_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
    }

    fn has_asset(value: &Value) -> bool {
        match value {
            Value::Object(map) => map
                .iter()
                .any(|(key, value)| (key == "assetId" && value.is_string()) || has_asset(value)),
            Value::Array(items) => items.iter().any(has_asset),
            _ => false,
        }
    }

    #[test]
    fn every_template_is_a_valid_show_without_assets() {
        for template in TEMPLATES {
            let path = template_path(&resource_dir(), template.id).unwrap();
            let document = crate::show::read_show(&path).unwrap();
            assert!(!has_asset(&document), "{} refers to an asset", template.id);
        }
    }

    #[test]
    fn template_name_matches_document() {
        for template in TEMPLATES {
            let path = template_path(&resource_dir(), template.id).unwrap();
            let document = crate::show::read_show(&path).unwrap();
            assert_eq!(document["name"], template.name);
        }
    }

    #[test]
    fn unknown_template_is_invalid() {
        for id in ["../x", "stage-lights.osekai", ""] {
            assert_eq!(
                template_path(&resource_dir(), id).unwrap_err().code,
                ErrorCode::InvalidInput
            );
        }
    }
}
