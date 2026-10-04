#![forbid(unsafe_code)]
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
pub type Id = String;
pub type Vec3 = [f64; 3];
pub type Quat = [f64; 4];
pub const MAX_DIAGNOSTICS_BYTES: usize = 2048;
pub const MAX_CLOCK_BYTES: usize = 2048;
pub const MAX_TRACKING_CLOCK_BYTES: usize = 65536;
pub const MAX_MESSAGE_BYTES: usize = 256 * 1024;
pub const MAX_CAPTURE_MESSAGE_BYTES: usize = 3 * 1024 * 1024;
macro_rules! object { ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)] #[serde(rename_all="camelCase", deny_unknown_fields)] pub struct $name {$(pub $field: $ty),*}} }
macro_rules! strings { ($name:ident { $($variant:ident => $wire:literal),* $(,)? }) => {#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)] pub enum $name {$(#[serde(rename=$wire)] $variant),*}} }
mod tracking;
pub use tracking::*;
strings!(Backend { Webgpu=>"webgpu", Webgl2=>"webgl2" });
strings!(Capability { Read=>"read", Edit=>"edit", Capture=>"capture", Benchmark=>"benchmark" });
strings!(Role { Publisher=>"publisher", Operator=>"operator", Renderer=>"renderer" });
strings!(ErrorCode { InvalidInput=>"INVALID_INPUT", Conflict=>"CONFLICT", Forbidden=>"FORBIDDEN", Unavailable=>"UNAVAILABLE", NotFound=>"NOT_FOUND", Unsupported=>"UNSUPPORTED", Timeout=>"TIMEOUT", RateLimited=>"RATE_LIMITED", Busy=>"BUSY", Cancelled=>"CANCELLED", VersionMismatch=>"VERSION_MISMATCH", StaleFrame=>"STALE_FRAME" });
strings!(RunState { Warming=>"warming", Measuring=>"measuring", Complete=>"complete", Cancelled=>"cancelled", Failed=>"failed" });
strings!(AssetFormat { Glb=>"glb", Vrm=>"vrm" });
strings!(EvidenceKind { Capture=>"capture", Benchmark=>"benchmark" });
strings!(CapturePreset { DiagnosticV1=>"diagnostic_v1" });
strings!(FixtureId { SmokeV1=>"smoke_v1" });
strings!(ProfileId { WebgpuSmokeV1=>"webgpu_smoke_v1", Webgl2SmokeV1=>"webgl2_smoke_v1" });
strings!(MimeType { ImagePng=>"image/png" });
object!(AppError {code:ErrorCode,message:String,ids:Vec<Id>});
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Reply<T> {
    Success(Success<T>),
    Failure(Failure),
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Success<T> {
    pub ok: bool,
    pub data: T,
}
object!(Failure {
    ok: bool,
    error: AppError
});
object!(Transform {
    position: Vec3,
    rotation: Quat,
    scale: Vec3
});
object!(EntityBase {
    id: Id,
    name: String,
    visible: bool,
    transform: Transform
});
object!(Lens {
    fov_degrees: f64,
    near: f64,
    far: f64
});
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum MeshSource {
    Box,
    Asset {
        #[serde(rename = "assetId")]
        asset_id: Id,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SceneEntity {
    Mesh {
        id: Id,
        name: String,
        visible: bool,
        transform: Transform,
        source: MeshSource,
    },
    Avatar {
        id: Id,
        name: String,
        visible: bool,
        transform: Transform,
        #[serde(rename = "assetId")]
        asset_id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tracking: Option<AvatarTracking>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "idleAnimation"
        )]
        idle_animation: Option<AvatarIdle>,
    },
    Tracking {
        id: Id,
        name: String,
        visible: bool,
        transform: Transform,
        config: TrackingConfig,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        smoothing: Option<TrackingSmoothing>,
        generation: u64,
    },
    Camera {
        id: Id,
        name: String,
        visible: bool,
        transform: Transform,
        lens: Lens,
    },
}
impl SceneEntity {
    pub fn id(&self) -> &str {
        match self {
            Self::Mesh { id, .. }
            | Self::Avatar { id, .. }
            | Self::Camera { id, .. }
            | Self::Tracking { id, .. } => id,
        }
    }
    pub fn transform(&self) -> &Transform {
        match self {
            Self::Mesh { transform, .. }
            | Self::Avatar { transform, .. }
            | Self::Camera { transform, .. }
            | Self::Tracking { transform, .. } => transform,
        }
    }
}
object!(OutputSpec {
    id: Id,
    camera_id: Id,
    width: u32,
    height: u32,
    fps: u32
});
object!(SceneView {schema_version:u32,scene_id:Id,revision:u64,entities:Vec<SceneEntity>,outputs:Vec<OutputSpec>});
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum PatchOp {
    CreateEntity {
        entity: SceneEntity,
    },
    RenameEntity {
        #[serde(rename = "entityId")]
        entity_id: Id,
        name: String,
    },
    RemoveEntity {
        #[serde(rename = "entityId")]
        entity_id: Id,
    },
    SetCameraLens {
        #[serde(rename = "entityId")]
        entity_id: Id,
        lens: Lens,
    },
    SetAvatarIdle {
        #[serde(rename = "entityId")]
        entity_id: Id,
        #[serde(rename = "idleAnimation")]
        idle_animation: AvatarIdle,
    },
    SetAvatarTracking {
        #[serde(rename = "entityId")]
        entity_id: Id,
        tracking: AvatarTracking,
    },
    SetTrackingSmoothing {
        #[serde(rename = "entityId")]
        entity_id: Id,
        smoothing: TrackingSmoothing,
    },
    SetTrackingConfig {
        #[serde(rename = "entityId")]
        entity_id: Id,
        config: TrackingConfig,
    },
    SetTransform {
        #[serde(rename = "entityId")]
        entity_id: Id,
        transform: Transform,
    },
    SetVisibility {
        #[serde(rename = "entityId")]
        entity_id: Id,
        visible: bool,
    },
}
object!(ScenePatch {scene_id:Id,expected_revision:u64,operations:Vec<PatchOp>});
object!(AssetRecord {id:Id,format:AssetFormat,sha256:String,bytes:u64,source_url:Option<String>,license_label:String,importer_version:u32});
object!(ConnectionDescriptor {schema_version:u32,session_id:Id,http_origin:String,ws_url:String,role:Role,token:String,capabilities:Vec<Capability>,output_id:Option<Id>});
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeFrame {
    pub schema_version: u32,
    pub session_id: Id,
    pub sequence: u64,
    pub tick: u64,
    pub elapsed_ms: f64,
    pub scene: SceneView,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_poses: Option<Vec<AvatarPose>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tracking_status: Option<Vec<TrackingStatus>>,
}
object!(FrameApplied {output_id:Id,session_id:Id,sequence:u64,tick:u64,revision:u64,camera_id:Id,backend:Backend,cpu_ms:f64,gpu_ms:Option<f64>,warnings:Vec<AppError>});
object!(RendererDiagnostics {
    session_id: Id,
    output_id: Id,
    renderer_epoch: Id,
    sequence: u64,
    revision: u64,
    backend: Backend,
    geometries: u64,
    textures: u64,
    live_materials: u64,
    asset_cache_entries: u64,
    active_render_job: bool,
    queued_frames: u64,
    queued_captures: u64
});
object!(OutputStatus {output_id:Id,connected:bool,last_frame:Option<FrameApplied>});
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppStatus {
    pub schema_version: u32,
    pub session_id: Id,
    pub ready: bool,
    pub revision: Option<u64>,
    pub capabilities: Vec<Capability>,
    pub warnings: Vec<AppError>,
    pub outputs: Vec<OutputStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tracking_status: Option<Vec<TrackingStatus>>,
}
object!(CaptureParams {
    output_id: Id,
    expected_revision: u64,
    preset: CapturePreset,
    max_age_ms: u32
});
object!(CaptureRecord {
    id: Id,
    output_id: Id,
    revision: u64,
    tick: u64,
    sequence: u64,
    backend: Backend,
    camera_id: Id,
    width: u32,
    height: u32,
    mime_type: MimeType,
    bytes: u64,
    sha256: String,
    resource_uri: String,
    created_at_utc: String
});
object!(BenchmarkParams {
    request_id: Id,
    fixture_id: FixtureId,
    profile_id: ProfileId
});
object!(BenchmarkRun {id:Id,state:RunState,progress:f64,summary_resource_uri:Option<String>,error:Option<ErrorCode>});
object!(EvidenceResource {
    uri: String,
    mime_type: String,
    sha256: String,
    bytes: u64
});
object!(EvidenceManifest {id:Id,kind:EvidenceKind,session_id:Id,fixture_id:FixtureId,app_commit:String,resources:Vec<EvidenceResource>});
object!(CaptureBytes {frame:FrameApplied,png:Vec<u8>,width:u32,height:u32});
object!(DiagnosticMarker {
    session_tag: u32,
    sequence: u32,
    tick: u32,
    revision: u32,
    camera_tag: u32
});
object!(Call {
    kind: String,
    request_id: Id,
    method: String,
    params: Value
});
object!(SceneInspectParams { scene_id: Id });
object!(CameraSelectParams {
    output_id: Id,
    camera_id: Id,
    expected_revision: u64
});
object!(RunParams { run_id: Id });
object!(EvidenceReadParams { evidence_id: Id });
object!(RevisionResult { revision: u64 });
object!(CaptureMetadata {
    frame: FrameApplied,
    width: u32,
    height: u32
});
object!(CaptureReplyData {
    metadata: CaptureMetadata,
    png_base64: String
});
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum WireMessage {
    Clock {
        #[serde(rename = "sessionId")]
        session_id: Id,
        #[serde(rename = "elapsedMs")]
        elapsed_ms: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tracking: Option<TrackingUpdate>,
    },
    Auth {
        role: Role,
        token: String,
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "outputId")]
        output_id: Option<Id>,
    },
    AuthReply {
        #[serde(rename = "sessionId")]
        session_id: Id,
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        capabilities: Vec<Capability>,
    },
    Call {
        #[serde(rename = "requestId")]
        request_id: Id,
        method: String,
        params: Value,
    },
    Reply {
        #[serde(rename = "requestId")]
        request_id: Id,
        result: Value,
    },
    Frame {
        frame: RuntimeFrame,
    },
    Applied {
        frame: FrameApplied,
    },
    Diagnostics {
        diagnostics: RendererDiagnostics,
    },
    CaptureRequest {
        #[serde(rename = "requestId")]
        request_id: Id,
        params: CaptureParams,
    },
    CaptureReply {
        #[serde(rename = "requestId")]
        request_id: Id,
        result: Value,
    },
    Ping {
        #[serde(rename = "requestId")]
        request_id: Id,
    },
    Pong {
        #[serde(rename = "requestId")]
        request_id: Id,
    },
}
pub fn invalid(message: impl Into<String>) -> AppError {
    AppError {
        code: ErrorCode::InvalidInput,
        message: message.into(),
        ids: vec![],
    }
}
fn require(condition: bool, message: &str) -> Result<(), AppError> {
    if condition {
        Ok(())
    } else {
        Err(invalid(message))
    }
}
fn decode<T: serde::de::DeserializeOwned + Serialize>(value: &Value) -> Result<T, AppError> {
    let normalized = normalize_numbers(value);
    scalar_checks(&normalized)?;
    let typed: T = serde_json::from_value(normalized).map_err(|e| invalid(e.to_string()))?;
    shape(
        value,
        &serde_json::to_value(&typed).map_err(|e| invalid(e.to_string()))?,
    )?;
    Ok(typed)
}
pub trait Validate {
    fn validate(&self) -> Result<(), AppError>;
}
impl Validate for Transform {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(
            self.position
                .iter()
                .chain(self.rotation.iter())
                .chain(self.scale.iter())
                .all(|n| n.is_finite()),
            "non-finite transform",
        )?;
        require(self.scale.iter().all(|n| *n > 0.), "non-positive scale")?;
        require(
            (self.rotation.iter().map(|n| n * n).sum::<f64>().sqrt() - 1.).abs() <= 0.001,
            "non-unit quaternion",
        )
    }
}
impl Validate for Lens {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(
            self.fov_degrees.is_finite()
                && (1. ..=179.).contains(&self.fov_degrees)
                && self.near.is_finite()
                && self.far.is_finite()
                && self.near > 0.
                && self.far > self.near,
            "invalid lens",
        )
    }
}
impl Validate for SceneView {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(self.schema_version == 1, "unsupported schema version")?;
        require(
            self.entities.len() <= 64 && self.outputs.len() <= 64,
            "too many entities",
        )?;
        let mut ids = HashSet::new();
        let mut cameras = HashSet::new();
        for e in &self.entities {
            require(ids.insert(e.id()), "duplicate entity")?;
            e.validate()?;
            if let SceneEntity::Camera { id, lens, .. } = e {
                lens.validate()?;
                cameras.insert(id.as_str());
            }
        }
        let sources: HashSet<_> = self
            .entities
            .iter()
            .filter_map(|e| {
                if matches!(e, SceneEntity::Tracking { .. }) {
                    Some(e.id())
                } else {
                    None
                }
            })
            .collect();
        require(
            sources.len() <= 4
                && self
                    .entities
                    .iter()
                    .filter(|e| matches!(e, SceneEntity::Avatar { .. }))
                    .count()
                    <= 2,
            "too many live entities",
        )?;
        for e in &self.entities {
            if let SceneEntity::Avatar {
                tracking: Some(t), ..
            } = e
            {
                for id in [&t.body_source_id, &t.face_source_id].into_iter().flatten() {
                    require(sources.contains(id.as_str()), "missing tracking source")?;
                    if t.body_source_id.as_ref() == Some(id) {
                        require(self.entities.iter().any(|e| matches!(e, SceneEntity::Tracking { id: source_id, config, .. } if source_id == id && !matches!(config, TrackingConfig::IFacialMocap { .. }))), "invalid body source")?;
                    }
                }
            }
        }
        let mut outputs = HashSet::new();
        for o in &self.outputs {
            require(outputs.insert(&o.id), "duplicate output")?;
            require(
                cameras.contains(o.camera_id.as_str()),
                "missing output camera",
            )?;
            require(
                o.width == 1920 && o.height == 1080 && o.fps == 60,
                "invalid output spec",
            )?;
        }
        Ok(())
    }
}
impl Validate for ScenePatch {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(
            (1..=32).contains(&self.operations.len()),
            "invalid operation count",
        )?;
        for o in &self.operations {
            match o {
                PatchOp::RenameEntity { name, .. } => require(
                    !name.trim().is_empty() && name.trim().encode_utf16().count() <= 128,
                    "invalid entity name",
                )?,
                PatchOp::SetTransform { transform, .. } => transform.validate()?,
                PatchOp::CreateEntity { entity } => entity.validate()?,
                PatchOp::SetCameraLens { lens, .. } => lens.validate()?,
                PatchOp::SetTrackingConfig { config, .. } => config.validate()?,
                PatchOp::SetTrackingSmoothing { smoothing, .. } => smoothing.validate()?,
                _ => {}
            }
        }
        Ok(())
    }
}
impl Validate for RuntimeFrame {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(self.schema_version == 1, "unsupported schema version")?;
        require(
            self.elapsed_ms.is_finite() && self.elapsed_ms >= 0.,
            "invalid elapsed time",
        )?;
        if let Some(poses) = &self.avatar_poses {
            require(poses.len() <= 2, "too many avatar poses")?;
            for pose in poses {
                pose.validate()?;
            }
        }
        if let Some(statuses) = &self.tracking_status {
            validate_statuses(statuses)?;
        }
        self.scene.validate()
    }
}
impl Validate for FrameApplied {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(
            self.cpu_ms.is_finite()
                && self.cpu_ms >= 0.
                && self.gpu_ms.is_none_or(|x| x.is_finite() && x >= 0.),
            "invalid timing",
        )
    }
}
impl Validate for RendererDiagnostics {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(
            !self.renderer_epoch.is_empty() && self.renderer_epoch.encode_utf16().count() <= 256,
            "invalid renderer epoch",
        )?;
        require(
            [
                self.geometries,
                self.textures,
                self.live_materials,
                self.asset_cache_entries,
                self.queued_frames,
                self.queued_captures,
            ]
            .iter()
            .all(|n| *n <= 1_000_000),
            "diagnostic count exceeds budget",
        )
    }
}
impl Validate for CaptureParams {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(self.max_age_ms == 500, "invalid capture age")
    }
}
impl Validate for BenchmarkRun {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(
            self.progress.is_finite() && (0. ..=1.).contains(&self.progress),
            "invalid progress",
        )
    }
}
impl Validate for CaptureRecord {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(
            self.width > 0
                && self.width <= 1920
                && self.height > 0
                && self.height <= 1080
                && self.bytes <= 2 * 1024 * 1024,
            "invalid capture size",
        )?;
        require(
            !self.resource_uri.is_empty() && utc_datetime(&self.created_at_utc),
            "invalid capture resource or date",
        )?;
        hash(&self.sha256)
    }
}
fn hash(s: &str) -> Result<(), AppError> {
    require(
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "invalid SHA-256",
    )
}
impl Validate for AppStatus {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(self.schema_version == 1, "unsupported schema version")?;
        if let Some(statuses) = &self.tracking_status {
            validate_statuses(statuses)?;
        }
        for o in &self.outputs {
            if let Some(f) = &o.last_frame {
                f.validate()?;
            }
        }
        Ok(())
    }
}
impl Validate for EvidenceManifest {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        for r in &self.resources {
            hash(&r.sha256)?;
        }
        Ok(())
    }
}
impl Validate for AssetRecord {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(self.importer_version == 1, "unsupported importer version")?;
        require(
            self.source_url
                .as_ref()
                .is_none_or(|s| url::Url::parse(s).is_ok()),
            "invalid source URL",
        )?;
        hash(&self.sha256)
    }
}
pub fn validate_call(method: &str, params: &Value) -> Result<(), AppError> {
    match method {
        "appStatus" => require(
            params.as_object().is_some_and(|o| o.is_empty()),
            "expected empty params",
        ),
        "sceneInspect" => decode::<SceneInspectParams>(params).map(|_| ()),
        "scenePatch" => decode::<ScenePatch>(params)?.validate(),
        "cameraSelect" => decode::<CameraSelectParams>(params).map(|_| ()),
        "captureFrame" => decode::<CaptureParams>(params)?.validate(),
        "benchmarkStart" => decode::<BenchmarkParams>(params).map(|_| ()),
        "benchmarkStatus" | "benchmarkCancel" => decode::<RunParams>(params).map(|_| ()),
        "evidenceRead" => decode::<EvidenceReadParams>(params).map(|_| ()),
        _ => Err(invalid("unknown method")),
    }
}
pub fn parse_call(bytes: &[u8]) -> Result<Call, AppError> {
    require(bytes.len() <= MAX_MESSAGE_BYTES, "oversized message")?;
    let value: Value = serde_json::from_slice(bytes).map_err(|e| invalid(e.to_string()))?;
    let c: Call = decode(&value)?;
    require(c.kind == "call", "expected call")?;
    validate_call(&c.method, &c.params)?;
    Ok(c)
}
fn reply_data(result: &Value) -> Result<Option<&Value>, AppError> {
    let o = result.as_object().ok_or_else(|| invalid("invalid reply"))?;
    match o.get("ok").and_then(Value::as_bool) {
        Some(true) => {
            require(
                o.len() == 2 && o.contains_key("data"),
                "invalid success reply",
            )?;
            Ok(o.get("data"))
        }
        Some(false) => {
            require(
                o.len() == 2 && o.contains_key("error"),
                "invalid error reply",
            )?;
            decode::<AppError>(&o["error"])?;
            Ok(None)
        }
        _ => Err(invalid("invalid reply discriminator")),
    }
}
pub fn validate_result(method: &str, result: &Value) -> Result<(), AppError> {
    let known = matches!(
        method,
        "appStatus"
            | "sceneInspect"
            | "scenePatch"
            | "cameraSelect"
            | "captureFrame"
            | "benchmarkStart"
            | "benchmarkStatus"
            | "benchmarkCancel"
            | "evidenceRead"
    );
    require(known, "unknown method")?;
    let Some(data) = reply_data(result)? else {
        return Ok(());
    };
    match method {
        "appStatus" => decode::<AppStatus>(data)?.validate(),
        "sceneInspect" => decode::<SceneView>(data)?.validate(),
        "scenePatch" | "cameraSelect" => decode::<RevisionResult>(data).map(|_| ()),
        "captureFrame" => decode::<CaptureRecord>(data)?.validate(),
        "benchmarkStart" | "benchmarkStatus" | "benchmarkCancel" => {
            decode::<BenchmarkRun>(data)?.validate()
        }
        "evidenceRead" => decode::<EvidenceManifest>(data)?.validate(),
        _ => unreachable!(),
    }
}
pub fn parse_wire(bytes: &[u8]) -> Result<WireMessage, AppError> {
    require(
        bytes.len() <= MAX_CAPTURE_MESSAGE_BYTES,
        "oversized message",
    )?;
    let value: Value = serde_json::from_slice(bytes).map_err(|e| invalid(e.to_string()))?;
    let msg: WireMessage = decode(&value)?;
    require(
        bytes.len() <= MAX_MESSAGE_BYTES || matches!(msg, WireMessage::CaptureReply { .. }),
        "oversized ordinary message",
    )?;
    match &msg {
        WireMessage::Clock {
            elapsed_ms,
            tracking,
            ..
        } => {
            if let Some(update) = tracking {
                update.validate()?;
            }
            require(
                bytes.len()
                    <= if tracking.is_some() {
                        MAX_TRACKING_CLOCK_BYTES
                    } else {
                        MAX_CLOCK_BYTES
                    },
                "oversized clock",
            )?;
            require(*elapsed_ms <= 9_007_199_254_740_991, "unsafe clock time")?;
        }
        WireMessage::Auth {
            schema_version,
            token,
            ..
        } => {
            require(!token.is_empty(), "empty token")?;
            require(*schema_version == 1, "unsupported schema version")?;
        }
        WireMessage::AuthReply { schema_version, .. } => {
            require(*schema_version == 1, "unsupported schema version")?
        }
        WireMessage::Call { method, params, .. } => validate_call(method, params)?,
        WireMessage::Reply { result, .. } => {
            reply_data(result)?;
        }
        WireMessage::Frame { frame } => frame.validate()?,
        WireMessage::Applied { frame } => frame.validate()?,
        WireMessage::Diagnostics { diagnostics } => {
            require(
                bytes.len() <= MAX_DIAGNOSTICS_BYTES,
                "oversized diagnostics",
            )?;
            diagnostics.validate()?;
        }
        WireMessage::CaptureRequest { params, .. } => params.validate()?,
        WireMessage::CaptureReply { result, .. } => {
            if let Some(data) = reply_data(result)? {
                let d: CaptureReplyData = decode(data)?;
                d.metadata.frame.validate()?;
                require(
                    d.metadata.width > 0
                        && d.metadata.width <= 1920
                        && d.metadata.height > 0
                        && d.metadata.height <= 1080,
                    "invalid capture dimensions",
                )?;
                validate_base64(&d.png_base64)?;
            }
        }
        _ => {}
    }
    Ok(msg)
}
impl Validate for ConnectionDescriptor {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(self.schema_version == 1, "unsupported schema version")?;
        require(!self.token.is_empty(), "empty token")?;
        require(
            loopback_authority(&self.http_origin, "http://", false)
                .is_some_and(|a| loopback_authority(&self.ws_url, "ws://", true) == Some(a)),
            "invalid loopback endpoints",
        )?;
        match self.role {
            Role::Renderer => require(
                self.output_id.is_some()
                    && self.capabilities.iter().all(|c| *c == Capability::Read),
                "invalid renderer grant",
            )?,
            Role::Publisher | Role::Operator => {}
        }
        Ok(())
    }
}
fn shape(input: &Value, canonical: &Value) -> Result<(), AppError> {
    match (input, canonical) {
        (Value::Object(a), Value::Object(b)) => {
            require(
                a.len() == b.len() && b.keys().all(|k| a.contains_key(k)),
                "missing required field",
            )?;
            for (k, v) in b {
                shape(&a[k], v)?;
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            for (x, y) in a.iter().zip(b) {
                shape(x, y)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn scalar_checks(v: &Value) -> Result<(), AppError> {
    match v {
        Value::Object(o) => {
            for (k, v) in o {
                if matches!(
                    k.as_str(),
                    "id" | "sceneId"
                        | "sessionId"
                        | "requestId"
                        | "entityId"
                        | "assetId"
                        | "cameraId"
                        | "outputId"
                        | "runId"
                        | "evidenceId"
                        | "sourceId"
                        | "avatarId"
                        | "bodySourceId"
                        | "faceSourceId"
                ) && !v.is_null()
                {
                    require(
                        v.as_str()
                            .is_some_and(|s| !s.is_empty() && s.encode_utf16().count() <= 256),
                        "invalid ID",
                    )?;
                }
                if matches!(
                    k.as_str(),
                    "revision"
                        | "generation"
                        | "packets"
                        | "invalidPackets"
                        | "expectedRevision"
                        | "sequence"
                        | "tick"
                        | "bytes"
                        | "width"
                        | "height"
                        | "sessionTag"
                        | "cameraTag"
                ) && !v.is_null()
                {
                    require(
                        v.as_u64().is_some_and(|n| n <= 9_007_199_254_740_991),
                        "invalid unsigned safe integer",
                    )?;
                }
                if k == "sha256" {
                    hash(v.as_str().ok_or_else(|| invalid("invalid SHA-256"))?)?;
                }
                if k == "capabilities" {
                    let values = v
                        .as_array()
                        .ok_or_else(|| invalid("invalid capabilities"))?;
                    let mut seen = HashSet::new();
                    require(
                        values.iter().all(|x| seen.insert(x.as_str())),
                        "duplicate capabilities",
                    )?;
                }
                if k == "ids" {
                    for id in v.as_array().ok_or_else(|| invalid("invalid IDs"))? {
                        require(
                            id.as_str()
                                .is_some_and(|s| !s.is_empty() && s.encode_utf16().count() <= 256),
                            "invalid ID",
                        )?;
                    }
                }
                if k != "expressions" {
                    scalar_checks(v)?;
                }
            }
        }
        Value::Array(a) => {
            for v in a {
                scalar_checks(v)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn validate_base64(s: &str) -> Result<(), AppError> {
    let bytes = s.as_bytes();
    let padding = if s.ends_with("==") {
        2
    } else if s.ends_with('=') {
        1
    } else {
        0
    };
    require(
        bytes.len().is_multiple_of(4) && bytes.len() <= 2796204,
        "invalid base64 length",
    )?;
    require(
        bytes[..bytes.len() - padding]
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'+' || *b == b'/'),
        "invalid base64",
    )?;
    require(
        bytes.len() / 4 * 3 - padding <= 2 * 1024 * 1024,
        "oversized PNG encoding",
    )
}
impl<T> Reply<T> {
    pub fn success(data: T) -> Self {
        Self::Success(Success { ok: true, data })
    }
    pub fn failure(error: AppError) -> Self {
        Self::Failure(Failure { ok: false, error })
    }
}
pub fn validate_value<T: serde::de::DeserializeOwned + Serialize + Validate>(
    value: &Value,
) -> Result<T, AppError> {
    let typed: T = decode(value)?;
    typed.validate()?;
    Ok(typed)
}
fn loopback_authority(url: &str, prefix: &str, websocket: bool) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    if parsed.scheme() != prefix.trim_end_matches("://")
        || parsed.host_str() != Some("127.0.0.1")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != if websocket { "/ws" } else { "/" }
    {
        return None;
    }
    Some(format!(
        "{}:{}",
        parsed.host_str()?,
        parsed.port_or_known_default()?
    ))
}
fn utc_datetime(s: &str) -> bool {
    let Some(s) = s.strip_suffix('Z') else {
        return false;
    };
    let (whole, fraction) = s.split_once('.').unwrap_or((s, ""));
    if whole.len() != 19
        || (s.contains('.') && fraction.is_empty())
        || (!fraction.is_empty() && !fraction.bytes().all(|b| b.is_ascii_digit()))
    {
        return false;
    }
    let b = whole.as_bytes();
    if b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return false;
    }
    let parse = |start, end| whole.get(start..end).and_then(|x| x.parse::<u32>().ok());
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        parse(0, 4),
        parse(5, 7),
        parse(8, 10),
        parse(11, 13),
        parse(14, 16),
        parse(17, 19),
    ) else {
        return false;
    };
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 0,
    };
    day > 0 && day <= days && hour < 24 && minute < 60 && second < 60
}
impl Validate for DiagnosticMarker {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        Ok(())
    }
}
impl Validate for CaptureBytes {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        self.frame.validate()?;
        require(
            self.png.len() <= 2 * 1024 * 1024
                && self.width > 0
                && self.width <= 1920
                && self.height > 0
                && self.height <= 1080,
            "invalid capture bytes",
        )
    }
}
impl Validate for AppError {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)
    }
}
impl Validate for OutputSpec {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(
            self.width == 1920 && self.height == 1080 && self.fps == 60,
            "invalid output spec",
        )
    }
}
impl Validate for EntityBase {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        self.transform.validate()
    }
}
impl Validate for SceneEntity {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        self.transform().validate()?;
        if let Self::Tracking {
            config, smoothing, ..
        } = self
        {
            config.validate()?;
            if let Some(smoothing) = smoothing {
                smoothing.validate()?;
            }
        }
        if let Self::Camera { lens, .. } = self {
            lens.validate()?;
        }
        Ok(())
    }
}
impl Validate for BenchmarkParams {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)
    }
}
impl Validate for Call {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(self.kind == "call", "expected call")?;
        validate_call(&self.method, &self.params)
    }
}
impl Validate for CaptureReplyData {
    fn validate(&self) -> Result<(), AppError> {
        self.metadata.frame.validate()?;
        require(
            self.metadata.width > 0
                && self.metadata.width <= 1920
                && self.metadata.height > 0
                && self.metadata.height <= 1080,
            "invalid capture dimensions",
        )?;
        validate_base64(&self.png_base64)
    }
}

fn normalize_numbers(value: &Value) -> Value {
    match value {
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.is_finite() && f.fract() == 0. && (0. ..=9_007_199_254_740_991.).contains(&f) {
                    return Value::from(f as u64);
                }
            }
            value.clone()
        }
        Value::Array(a) => Value::Array(a.iter().map(normalize_numbers).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, v)| (k.clone(), normalize_numbers(v)))
                .collect(),
        ),
        _ => value.clone(),
    }
}
