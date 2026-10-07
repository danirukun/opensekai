use opensekai_contracts::{AppError, ErrorCode, SceneView, Validate, MAX_MESSAGE_BYTES};
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Write},
    path::Path,
};

fn invalid(message: impl Into<String>) -> AppError {
    AppError {
        code: ErrorCode::InvalidInput,
        message: message.into(),
        ids: vec![],
    }
}

fn unavailable(message: impl Into<String>) -> AppError {
    AppError {
        code: ErrorCode::Unavailable,
        message: message.into(),
        ids: vec![],
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ShowDocument {
    schema_version: u32,
    name: String,
    scene: SceneView,
    blueprints: Vec<BlueprintGraph>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlueprintGraph {
    schema_version: u32,
    id: String,
    name: String,
    nodes: Vec<BlueprintNode>,
    connections: Vec<BlueprintConnection>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BlueprintNode {
    id: String,
    version: u32,
    position: Position,
    #[serde(rename = "type")]
    node_type: String,
    settings: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Position {
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlueprintConnection {
    id: String,
    source_node_id: String,
    source_port: String,
    target_node_id: String,
    target_port: String,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().count() <= 256
}
fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 128
}

fn validate_graph(graph: &BlueprintGraph) -> Result<(), AppError> {
    if graph.schema_version != 1
        || !valid_id(&graph.id)
        || !valid_name(&graph.name)
        || graph.nodes.len() > 128
        || graph.connections.len() > 256
    {
        return Err(invalid("Invalid Blueprint graph"));
    }
    let mut nodes = HashSet::new();
    for node in &graph.nodes {
        if !valid_id(&node.id)
            || !nodes.insert(node.id.as_str())
            || node.version != 1
            || !node.position.x.is_finite()
            || !node.position.y.is_finite()
        {
            return Err(invalid("Invalid Blueprint node"));
        }
        let settings = node
            .settings
            .as_object()
            .ok_or_else(|| invalid("Invalid Blueprint settings"))?;
        let valid = match node.node_type.as_str() {
            "event.manual" | "math.add" | "logic.greater" => settings.is_empty(),
            "value.number" => {
                settings.len() == 1
                    && settings
                        .get("value")
                        .and_then(Value::as_f64)
                        .is_some_and(f64::is_finite)
            }
            "value.boolean" => {
                settings.len() == 1 && settings.get("value").and_then(Value::as_bool).is_some()
            }
            "scene.setVisibility" => {
                settings.len() == 1
                    && settings
                        .get("entityId")
                        .and_then(Value::as_str)
                        .is_some_and(valid_id)
            }
            _ => false,
        };
        if !valid {
            return Err(invalid("Invalid Blueprint node settings"));
        }
    }
    let mut connections = HashSet::new();
    for connection in &graph.connections {
        if !valid_id(&connection.id)
            || !connections.insert(connection.id.as_str())
            || !valid_id(&connection.source_node_id)
            || !valid_id(&connection.target_node_id)
            || connection.source_port.is_empty()
            || connection.source_port.chars().count() > 64
            || connection.target_port.is_empty()
            || connection.target_port.chars().count() > 64
        {
            return Err(invalid("Invalid Blueprint connection"));
        }
    }
    Ok(())
}

pub fn validate_show(value: &Value) -> Result<(), AppError> {
    let bytes = serde_json::to_vec(value).map_err(|_| invalid("Invalid show document"))?;
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(invalid("Show file is too large"));
    }
    let show: ShowDocument =
        serde_json::from_value(value.clone()).map_err(|_| invalid("Invalid show document"))?;
    if show.schema_version != 1 || !valid_name(&show.name) || show.blueprints.len() > 1 {
        return Err(invalid("Unsupported show document"));
    }
    show.scene.validate()?;
    if !["output_main", "preview_main"]
        .iter()
        .all(|id| show.scene.outputs.iter().any(|output| output.id == *id))
    {
        return Err(invalid("Show requires main and preview outputs"));
    }
    for graph in &show.blueprints {
        validate_graph(graph)?;
    }
    Ok(())
}

pub fn read_show(path: &Path) -> Result<Value, AppError> {
    let file = File::open(path).map_err(|_| unavailable("Show file could not be opened"))?;
    let mut bytes = Vec::new();
    file.take((MAX_MESSAGE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable("Show file could not be read"))?;
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(invalid("Show file is too large"));
    }
    let value = serde_json::from_slice(&bytes).map_err(|_| invalid("Invalid show JSON"))?;
    validate_show(&value)?;
    Ok(value)
}

pub fn write_show(path: &Path, value: &Value) -> Result<(), AppError> {
    validate_show(value)?;
    let bytes = serde_json::to_vec(value).map_err(|_| invalid("Invalid show document"))?;
    let parent = path.parent().ok_or_else(|| invalid("Invalid show path"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| unavailable("Show file could not be saved"))?;
    temp.write_all(&bytes)
        .map_err(|_| unavailable("Show file could not be saved"))?;
    temp.as_file()
        .sync_all()
        .map_err(|_| unavailable("Show file could not be saved"))?;
    temp.persist(path)
        .map_err(|_| unavailable("Show file could not be saved"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn show() -> Value {
        let scene: Value = serde_json::from_str(include_str!(
            "../../../../fixtures/protocol/valid-scene.json"
        ))
        .unwrap();
        json!({"schemaVersion":1,"name":"Concert","scene":scene,"blueprints":[{
            "schemaVersion":1,"id":"graph_1","name":"Lights","nodes":[],"connections":[]
        }]})
    }

    #[test]
    fn round_trip_keeps_references_and_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("concert.osekai");
        let mut document = show();
        document["scene"]["entities"][1]["assetId"] = json!("missing_avatar");
        assert!(validate_show(&document).is_ok());
        write_show(&path, &document).unwrap();
        assert_eq!(read_show(&path).unwrap(), document);
        document["name"] = json!("Second take");
        write_show(&path, &document).unwrap();
        assert_eq!(read_show(&path).unwrap(), document);
    }

    #[test]
    fn invalid_open_or_save_preserves_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("concert.osekai");
        let document = show();
        write_show(&path, &document).unwrap();
        let original = std::fs::read(&path).unwrap();
        let mut invalid = document.clone();
        invalid["schemaVersion"] = json!(2);
        assert!(write_show(&path, &invalid).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        std::fs::write(dir.path().join("bad.osekai"), b"{broken").unwrap();
        assert!(read_show(&dir.path().join("bad.osekai")).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    #[test]
    fn rejects_bad_graph_and_missing_output() {
        let mut document = show();
        document["blueprints"][0]["nodes"] = json!([{"id":"n","version":1,"position":{"x":0,"y":0},"type":"value.number","settings":{"value":1,"extra":true}}]);
        assert!(validate_show(&document).is_err());
        document["blueprints"] = json!([]);
        document["scene"]["outputs"] = json!([]);
        assert!(validate_show(&document).is_err());
    }
}
