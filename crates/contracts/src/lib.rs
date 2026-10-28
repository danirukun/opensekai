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
pub const MAX_CAPTURE_PNG_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_SCREENSHOT_PNG_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_SCREENSHOT_MESSAGE_BYTES: usize = 12 * 1024 * 1024;
pub const SCREENSHOT_TIMEOUT_MS: u64 = 5000;
pub const MAX_CAMERAS: usize = 8;
pub const MAX_LIGHTS: usize = 8;
pub const MAX_SHADOW_LIGHTS: usize = 2;
pub const MAX_HAZES: usize = 1;
pub const MAX_FPS_COUNTERS: usize = 1;
macro_rules! object { ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)] #[serde(rename_all="camelCase", deny_unknown_fields)] pub struct $name {$(pub $field: $ty),*}} }
macro_rules! strings { ($name:ident { $($variant:ident => $wire:literal),* $(,)? }) => {#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)] pub enum $name {$(#[serde(rename=$wire)] $variant),*}} }
mod tracking;
pub use tracking::*;
mod devices;
pub use devices::*;
mod vmc_sender;
pub use vmc_sender::*;
mod youtube;
pub use youtube::*;
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
strings!(QualityProfileId { PreviewV1=>"preview_v1", ProductionV1=>"production_v1", PerformanceV1=>"performance_v1" });
strings!(CameraAntiAliasing { None=>"none", Fxaa=>"fxaa" });
strings!(LightType { Directional=>"directional", Point=>"point", Spot=>"spot", Ambient=>"ambient" });
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
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub enum CameraNavigation {
    None,
    FreeLook {
        sensitivity: f64,
    },
    OrbitCharacter {
        sensitivity: f64,
        #[serde(rename = "targetId")]
        target_id: Option<Id>,
        #[serde(rename = "pivotOffset")]
        pivot_offset: Vec3,
    },
}
impl Validate for CameraNavigation {
    fn validate(&self) -> Result<(), AppError> {
        let sensitivity_ok = |s: &f64| s.is_finite() && (0.1..=10.).contains(s);
        match self {
            Self::None => Ok(()),
            Self::FreeLook { sensitivity } => {
                require(sensitivity_ok(sensitivity), "invalid camera sensitivity")
            }
            Self::OrbitCharacter {
                sensitivity,
                target_id,
                pivot_offset,
            } => {
                require(sensitivity_ok(sensitivity), "invalid camera sensitivity")?;
                require(
                    target_id.as_deref().is_none_or(id_text_ok),
                    "invalid camera target",
                )?;
                require(
                    pivot_offset
                        .iter()
                        .all(|n| n.is_finite() && (-1000. ..=1000.).contains(n)),
                    "invalid pivot offset",
                )
            }
        }
    }
}
object!(LightShadow {
    enabled: bool,
    intensity: f64,
    soft: bool,
    bias: f64,
    normal_bias: f64
});
// The full cone angle in degrees, as Warudo and Unity show it (B13 R1).
object!(LightCone {
    angle_degrees: f64,
    penumbra: f64
});
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LightSettings {
    #[serde(rename = "type")]
    pub light_type: LightType,
    pub color: String,
    pub intensity: f64,
    pub range: f64,
    pub affect_characters: bool,
    pub affect_props: bool,
    pub affect_environment: bool,
    pub shadow: LightShadow,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cone: Option<LightCone>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volumetric: Option<bool>,
}
object!(HazeSettings {
    density: f64,
    smoke: f64,
    intensity: f64,
    drift: f64
});
strings!(FpsCounterCorner { TopLeft=>"topLeft", TopRight=>"topRight", BottomLeft=>"bottomLeft", BottomRight=>"bottomRight" });
// Size is in pixels of a 1080-pixel output (B19 R1).
object!(FpsCounterSettings {
    corner: FpsCounterCorner,
    size: u32,
    color: String
});
fn light_color_ok(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color[1..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn within(n: f64, min: f64, max: f64) -> bool {
    n.is_finite() && (min..=max).contains(&n)
}
impl Validate for LightSettings {
    fn validate(&self) -> Result<(), AppError> {
        require(light_color_ok(&self.color), "invalid light color")?;
        require(
            within(self.intensity, 0., 1000.) && within(self.range, 0., 1000.),
            "invalid light",
        )?;
        require(
            within(self.shadow.intensity, 0., 1.)
                && within(self.shadow.bias, -0.01, 0.01)
                && within(self.shadow.normal_bias, 0., 1.),
            "invalid light shadow",
        )?;
        require(
            self.cone
                .as_ref()
                .is_none_or(|c| within(c.angle_degrees, 1., 170.) && within(c.penumbra, 0., 1.)),
            "invalid light cone",
        )?;
        require(
            self.light_type != LightType::Spot || self.cone.is_some(),
            "a spot light needs a cone",
        )?;
        require(
            self.light_type != LightType::Ambient || !self.shadow.enabled,
            "an ambient light has no shadow",
        )?;
        require(
            self.volumetric != Some(true)
                || matches!(self.light_type, LightType::Point | LightType::Spot),
            "only point and spot lights scatter in haze",
        )
    }
}
impl Validate for HazeSettings {
    fn validate(&self) -> Result<(), AppError> {
        require(
            within(self.density, 0., 2.)
                && within(self.smoke, 0., 3.)
                && within(self.intensity, 0., 4.)
                && within(self.drift, 0., 2.),
            "invalid haze",
        )
    }
}
impl Validate for FpsCounterSettings {
    fn validate(&self) -> Result<(), AppError> {
        require(light_color_ok(&self.color), "invalid fps counter color")?;
        require((8..=128).contains(&self.size), "invalid fps counter size")
    }
}
fn reflections_intensity_ok(n: f64) -> bool {
    n.is_finite() && (0. ..=2.).contains(&n)
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
        asset_id: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tracking: Option<AvatarTracking>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "idleAnimation"
        )]
        idle_animation: Option<AvatarIdle>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expressions: Option<BTreeMap<String, ExpressionSettings>>,
    },
    Tracking {
        id: Id,
        name: String,
        visible: bool,
        transform: Transform,
        config: TrackingConfig,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        smoothing: Option<TrackingSmoothing>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        calibration: Option<Box<TrackingCalibration>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mapping: Option<Box<TrackingMapping>>,
        generation: u64,
    },
    Environment {
        id: Id,
        name: String,
        visible: bool,
        transform: Transform,
        #[serde(rename = "assetId")]
        asset_id: Option<Id>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "reflectionsIntensity"
        )]
        reflections_intensity: Option<f64>,
    },
    Light {
        id: Id,
        name: String,
        visible: bool,
        transform: Transform,
        light: LightSettings,
    },
    Haze {
        id: Id,
        name: String,
        visible: bool,
        transform: Transform,
        haze: HazeSettings,
    },
    FpsCounter {
        id: Id,
        name: String,
        visible: bool,
        transform: Transform,
        #[serde(rename = "fpsCounter")]
        fps_counter: FpsCounterSettings,
    },
    VmcSender {
        id: Id,
        name: String,
        visible: bool,
        transform: Transform,
        #[serde(rename = "vmcSender")]
        vmc_sender: VmcSenderSettings,
    },
    Camera {
        id: Id,
        name: String,
        visible: bool,
        transform: Transform,
        lens: Lens,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "renderEnvironment"
        )]
        render_environment: Option<bool>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "antiAliasing"
        )]
        anti_aliasing: Option<CameraAntiAliasing>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        navigation: Option<CameraNavigation>,
    },
}
impl SceneEntity {
    pub fn id(&self) -> &str {
        match self {
            Self::Mesh { id, .. }
            | Self::Avatar { id, .. }
            | Self::Environment { id, .. }
            | Self::Camera { id, .. }
            | Self::Light { id, .. }
            | Self::Haze { id, .. }
            | Self::FpsCounter { id, .. }
            | Self::VmcSender { id, .. }
            | Self::Tracking { id, .. } => id,
        }
    }
    pub fn transform(&self) -> &Transform {
        match self {
            Self::Mesh { transform, .. }
            | Self::Avatar { transform, .. }
            | Self::Environment { transform, .. }
            | Self::Camera { transform, .. }
            | Self::Light { transform, .. }
            | Self::Haze { transform, .. }
            | Self::FpsCounter { transform, .. }
            | Self::VmcSender { transform, .. }
            | Self::Tracking { transform, .. } => transform,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutputSpec {
    pub id: Id,
    pub camera_id: Id,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// A missing value means 1. `null` is rejected, as the TypeScript schema does (B22 R1).
    #[serde(
        default,
        deserialize_with = "present_f64",
        skip_serializing_if = "Option::is_none"
    )]
    pub render_scale: Option<f64>,
}
fn present_f64<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<f64>, D::Error> {
    f64::deserialize(deserializer).map(Some)
}
/// The `output_main` formats of B22 R1. Each size is 16:9 and at most 1920 x 1080.
pub const OUTPUT_SIZES: [(u32, u32); 4] = [(1920, 1080), (1600, 900), (1280, 720), (960, 540)];
pub const OUTPUT_FRAME_LIMITS: [u32; 2] = [30, 60];
pub const OUTPUT_RENDER_SCALES: [f64; 3] = [0.5, 0.75, 1.0];
fn output_format_ok(width: u32, height: u32, fps: u32, render_scale: f64) -> bool {
    OUTPUT_SIZES.contains(&(width, height))
        && OUTPUT_FRAME_LIMITS.contains(&fps)
        && OUTPUT_RENDER_SCALES.contains(&render_scale)
}
impl OutputSpec {
    pub fn is_default_format(&self) -> bool {
        self.width == 1920
            && self.height == 1080
            && self.fps == 60
            && self.render_scale.unwrap_or(1.0) == 1.0
    }
    fn format_ok(&self) -> bool {
        output_format_ok(
            self.width,
            self.height,
            self.fps,
            self.render_scale.unwrap_or(1.0),
        )
    }
}
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
    SetAvatarModel {
        #[serde(rename = "entityId")]
        entity_id: Id,
        #[serde(rename = "assetId")]
        asset_id: Option<Id>,
    },
    SetEnvironmentModel {
        #[serde(rename = "entityId")]
        entity_id: Id,
        #[serde(rename = "assetId")]
        asset_id: Option<Id>,
    },
    SetEnvironmentReflections {
        #[serde(rename = "entityId")]
        entity_id: Id,
        #[serde(rename = "reflectionsIntensity")]
        reflections_intensity: f64,
    },
    SetLight {
        #[serde(rename = "entityId")]
        entity_id: Id,
        light: LightSettings,
    },
    SetHaze {
        #[serde(rename = "entityId")]
        entity_id: Id,
        haze: HazeSettings,
    },
    SetFpsCounter {
        #[serde(rename = "entityId")]
        entity_id: Id,
        #[serde(rename = "fpsCounter")]
        fps_counter: FpsCounterSettings,
    },
    SetOutputFormat {
        #[serde(rename = "outputId")]
        output_id: Id,
        width: u32,
        height: u32,
        fps: u32,
        #[serde(rename = "renderScale")]
        render_scale: f64,
    },
    SetVmcSender {
        #[serde(rename = "entityId")]
        entity_id: Id,
        #[serde(rename = "vmcSender")]
        vmc_sender: VmcSenderSettings,
    },
    SetCameraRenderEnvironment {
        #[serde(rename = "entityId")]
        entity_id: Id,
        #[serde(rename = "renderEnvironment")]
        render_environment: bool,
    },
    SetCameraAntiAliasing {
        #[serde(rename = "entityId")]
        entity_id: Id,
        #[serde(rename = "antiAliasing")]
        anti_aliasing: CameraAntiAliasing,
    },
    SetCameraNavigation {
        #[serde(rename = "entityId")]
        entity_id: Id,
        navigation: CameraNavigation,
    },
    SetAvatarExpression {
        #[serde(rename = "entityId")]
        entity_id: Id,
        name: String,
        settings: Option<ExpressionSettings>,
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
    CalibrateTracking {
        #[serde(rename = "entityId")]
        entity_id: Id,
    },
    FitBlendShapeRanges {
        #[serde(rename = "entityId")]
        entity_id: Id,
        neutral: BTreeMap<String, f64>,
    },
    SetTrackingCalibration {
        #[serde(rename = "entityId")]
        entity_id: Id,
        calibration: Option<TrackingCalibration>,
    },
    SetTrackingMapping {
        #[serde(rename = "entityId")]
        entity_id: Id,
        mapping: TrackingMapping,
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
object!(AssetCredits {
    title: Option<String>,
    author: Option<String>,
    license: Option<String>,
    source_url: Option<String>
});
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetRecord {
    pub id: Id,
    pub format: AssetFormat,
    pub sha256: String,
    pub bytes: u64,
    pub source_url: Option<String>,
    pub license_label: String,
    pub importer_version: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits: Option<AssetCredits>,
    pub expressions: Vec<AssetExpression>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eye_bones: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rig: Option<AvatarRig>,
}
object!(AssetExpression {
    name: String,
    preset: bool
});
object!(ExpressionSuppress {
    blink: bool,
    mouth: bool,
    brow: bool
});
object!(ExpressionSettings {
    layer: u32,
    fade_seconds: f64,
    suppress: ExpressionSuppress
});
object!(ExpressionView {
    name: String,
    preset: bool,
    layer: u32,
    fade_seconds: f64,
    suppress: ExpressionSuppress,
    active: bool,
    weight: f64
});
object!(ExpressionState {
    avatar_id: Id,
    expressions: Vec<ExpressionView>
});
object!(ExpressionGetParams { avatar_id: Id });
object!(ExpressionSetParams {
    avatar_id: Id,
    name: String,
    active: bool
});
pub const MAX_EXPRESSIONS: usize = 64;
pub const ARKIT_NAMES: [&str; 52] = [
    "eyeBlinkLeft",
    "eyeLookDownLeft",
    "eyeLookInLeft",
    "eyeLookOutLeft",
    "eyeLookUpLeft",
    "eyeSquintLeft",
    "eyeWideLeft",
    "eyeBlinkRight",
    "eyeLookDownRight",
    "eyeLookInRight",
    "eyeLookOutRight",
    "eyeLookUpRight",
    "eyeSquintRight",
    "eyeWideRight",
    "jawForward",
    "jawLeft",
    "jawRight",
    "jawOpen",
    "mouthClose",
    "mouthFunnel",
    "mouthPucker",
    "mouthLeft",
    "mouthRight",
    "mouthSmileLeft",
    "mouthSmileRight",
    "mouthFrownLeft",
    "mouthFrownRight",
    "mouthDimpleLeft",
    "mouthDimpleRight",
    "mouthStretchLeft",
    "mouthStretchRight",
    "mouthRollLower",
    "mouthRollUpper",
    "mouthShrugLower",
    "mouthShrugUpper",
    "mouthPressLeft",
    "mouthPressRight",
    "mouthLowerDownLeft",
    "mouthLowerDownRight",
    "mouthUpperUpLeft",
    "mouthUpperUpRight",
    "browDownLeft",
    "browDownRight",
    "browInnerUp",
    "browOuterUpLeft",
    "browOuterUpRight",
    "cheekPuff",
    "cheekSquintLeft",
    "cheekSquintRight",
    "noseSneerLeft",
    "noseSneerRight",
    "tongueOut",
];
/// Names that face tracking or lip sync drives, compared without case. Keep in step with `isTrackedExpression` in TypeScript.
const TRACKED_EXPRESSIONS: [&str; 23] = [
    "aa",
    "ih",
    "ou",
    "ee",
    "oh",
    "blink",
    "blinkleft",
    "blinkright",
    "lookup",
    "lookdown",
    "lookleft",
    "lookright",
    "neutral",
    "sil",
    "pp",
    "ff",
    "th",
    "dd",
    "kk",
    "ch",
    "ss",
    "nn",
    "rr",
];
pub fn is_tracked_expression(name: &str) -> bool {
    let lower = name.to_lowercase();
    TRACKED_EXPRESSIONS.contains(&lower.as_str())
        || ARKIT_NAMES.iter().any(|arkit| {
            let side = arkit
                .strip_suffix("Left")
                .map(|base| format!("{base}_L"))
                .or_else(|| arkit.strip_suffix("Right").map(|base| format!("{base}_R")));
            arkit.to_lowercase() == lower || side.is_some_and(|side| side.to_lowercase() == lower)
        })
}
fn expression_name_ok(name: &str) -> bool {
    (1..=128).contains(&name.encode_utf16().count())
}
impl Validate for ExpressionSettings {
    fn validate(&self) -> Result<(), AppError> {
        require(
            self.layer <= 15
                && self.fade_seconds.is_finite()
                && (0. ..=5.).contains(&self.fade_seconds),
            "invalid expression settings",
        )
    }
}
fn expressions_ok(list: &[AssetExpression]) -> Result<(), AppError> {
    let mut names = HashSet::new();
    require(
        list.len() <= MAX_EXPRESSIONS
            && list
                .iter()
                .all(|e| expression_name_ok(&e.name) && names.insert(e.name.as_str())),
        "invalid expression list",
    )
}
impl Validate for ExpressionState {
    fn validate(&self) -> Result<(), AppError> {
        require(
            id_text_ok(&self.avatar_id) && self.expressions.len() <= MAX_EXPRESSIONS,
            "invalid expression state",
        )?;
        for view in &self.expressions {
            require(
                expression_name_ok(&view.name)
                    && view.weight.is_finite()
                    && (0. ..=1.).contains(&view.weight),
                "invalid expression view",
            )?;
            ExpressionSettings {
                layer: view.layer,
                fade_seconds: view.fade_seconds,
                suppress: view.suppress.clone(),
            }
            .validate()?;
        }
        Ok(())
    }
}
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blueprint_revision: Option<u64>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrameApplied {
    pub output_id: Id,
    pub session_id: Id,
    pub sequence: u64,
    pub tick: u64,
    pub revision: u64,
    pub camera_id: Id,
    pub backend: Backend,
    pub cpu_ms: f64,
    pub gpu_ms: Option<f64>,
    pub warnings: Vec<AppError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality_profile: Option<QualityProfileId>,
}
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blueprint_revision: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_addresses: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vmc_senders: Option<Vec<VmcSenderStatus>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub youtube: Option<YouTubeStatus>,
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
object!(SceneReplaceParams {
    scene: SceneView,
    expected_revision: u64
});
object!(CameraSelectParams {
    output_id: Id,
    camera_id: Id,
    expected_revision: u64
});
object!(CameraScreenshotParams {
    camera_id: Id,
    expected_revision: u64
});
object!(CameraScreenshotResult {
    file_name: String,
    width: u32,
    height: u32,
    bytes: u64,
    sha256: String,
    camera_id: Id,
    revision: u64
});
object!(ScreenshotReplyData {
    session_id: Id,
    revision: u64,
    camera_id: Id,
    width: u32,
    height: u32,
    png_base64: String
});
impl Validate for CameraScreenshotParams {
    fn validate(&self) -> Result<(), AppError> {
        require(
            id_text_ok(&self.camera_id) && self.expected_revision <= 9_007_199_254_740_991,
            "invalid screenshot call",
        )
    }
}
/// `<yyyyMMdd>-<HHmmss>-<SSS>-<camera part>[-1..-9].png`, the name the host makes.
pub fn screenshot_file_name_ok(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".png") else {
        return false;
    };
    let b = stem.as_bytes();
    if b.len() < 21 || b[8] != b'-' || b[15] != b'-' || b[19] != b'-' {
        return false;
    }
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    if !(digits(0..8) && digits(9..15) && digits(16..19)) {
        return false;
    }
    let rest = &stem[20..];
    let camera = match rest.rsplit_once('-') {
        Some((camera, n))
            if n.len() == 1 && (b'1'..=b'9').contains(&n.as_bytes()[0]) && !camera.is_empty() =>
        {
            camera
        }
        _ => rest,
    };
    let part_ok = |p: &str| {
        (1..=64).contains(&p.len())
            && p.bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    };
    part_ok(camera) || part_ok(rest)
}
impl Validate for CameraScreenshotResult {
    fn validate(&self) -> Result<(), AppError> {
        require(
            screenshot_file_name_ok(&self.file_name),
            "invalid screenshot name",
        )?;
        require(
            self.width == 1920
                && self.height == 1080
                && self.bytes > 0
                && self.bytes <= MAX_SCREENSHOT_PNG_BYTES as u64
                && self.revision <= 9_007_199_254_740_991,
            "invalid screenshot size",
        )?;
        require(id_text_ok(&self.camera_id), "invalid camera ID")?;
        hash(&self.sha256)
    }
}
impl Validate for ScreenshotReplyData {
    fn validate(&self) -> Result<(), AppError> {
        require(
            id_text_ok(&self.session_id)
                && id_text_ok(&self.camera_id)
                && self.revision <= 9_007_199_254_740_991,
            "invalid screenshot reply",
        )?;
        require(
            self.width == 1920 && self.height == 1080,
            "invalid screenshot dimensions",
        )?;
        validate_base64(&self.png_base64, MAX_SCREENSHOT_PNG_BYTES)
    }
}
/// Either `{ graphId, triggerNodeId }` (a Manual Trigger) or `{ event, payload? }` (a custom event).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlueprintRunParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graph_id: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger_node_id: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    /// `null` stays `Some(Value::Null)`, so `validate` rejects it as the TypeScript schema does.
    #[serde(
        default,
        deserialize_with = "present_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub payload: Option<Value>,
}
fn present_value<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}
impl BlueprintRunParams {
    pub fn validate(&self) -> Result<(), AppError> {
        let trigger = self.graph_id.is_some() && self.trigger_node_id.is_some();
        let event = self.event.as_deref().is_some_and(|name| {
            let name = name.trim();
            !name.is_empty() && name.encode_utf16().count() <= 64
        });
        require(
            (trigger && self.event.is_none() && self.payload.is_none())
                || (event && self.graph_id.is_none() && self.trigger_node_id.is_none()),
            "invalid Blueprint run",
        )?;
        require(
            self.payload.as_ref().is_none_or(inline_value_ok),
            "invalid event payload",
        )
    }
}
object!(BlueprintEditParams { client_id: Id, batch_id: Id, ops: Vec<Value> });
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlueprintEditResult {
    pub revision: u64,
    pub keystrokes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub held_keys: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub devices: Option<Vec<DeviceKind>>,
    /// Present (and true) when a listened graph has a YouTube node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub youtube: Option<bool>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlueprintInspectParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since_revision: Option<u64>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlueprintDebugParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum InputEvent {
    Keystroke { accelerator: String },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct InputUpdate {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<InputEvent>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub held: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub devices: Option<DeviceUpdate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub youtube: Option<YouTubeInput>,
}
impl InputUpdate {
    pub fn validate(&self) -> Result<(), AppError> {
        require(
            self.events.len() <= 16
                && self.held.len() <= 16
                && !(self.events.is_empty()
                    && self.held.is_empty()
                    && self.devices.is_none()
                    && self.youtube.is_none()),
            "invalid input event count",
        )?;
        if let Some(devices) = &self.devices {
            devices.validate()?;
        }
        if let Some(youtube) = &self.youtube {
            youtube.validate()?;
        }
        for code in &self.held {
            require(
                !code.is_empty() && code.chars().count() <= 32,
                "invalid held key",
            )?;
        }
        for InputEvent::Keystroke { accelerator } in &self.events {
            require(
                !accelerator.is_empty() && accelerator.chars().count() <= 64,
                "invalid accelerator",
            )?;
        }
        Ok(())
    }
}

fn id_ok(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|s| !s.is_empty() && s.chars().count() <= 256)
}
fn port_ok(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|s| !s.is_empty() && s.chars().count() <= 64)
}
fn node_type_ok(value: &str) -> bool {
    let part = |p: Option<&str>| {
        p.is_some_and(|p| {
            p.starts_with(|c: char| c.is_ascii_lowercase())
                && p.chars().all(|c| c.is_ascii_alphanumeric())
        })
    };
    let mut parts = value.split('.');
    value.len() <= 64 && part(parts.next()) && part(parts.next()) && parts.next().is_none()
}
fn keys_within(value: &Value, allowed: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|o| o.keys().all(|k| allowed.contains(&k.as_str())))
}
fn position_ok(value: &Value) -> bool {
    keys_within(value, &["x", "y"])
        && ["x", "y"]
            .iter()
            .all(|a| value[*a].as_f64().is_some_and(f64::is_finite))
}
fn variable_name_ok(name: &Value) -> bool {
    name.as_str()
        .is_some_and(|n| !n.trim().is_empty() && n.chars().count() <= 64)
}
const BLUEPRINT_SCALAR_TYPES: [&str; 5] = ["number", "integer", "boolean", "string", "vector3"];
const MAX_BLUEPRINT_STRING_CHARS: usize = 1024;
const MAX_BLUEPRINT_LIST_ITEMS: usize = 256;
const MAX_BLUEPRINT_INLINE_INPUTS: usize = 16;
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
fn finite_number(v: &Value) -> bool {
    v.as_f64().is_some_and(f64::is_finite)
}
fn safe_integer(v: &Value) -> bool {
    v.as_f64()
        .is_some_and(|f| f.fract() == 0.0 && f.abs() <= MAX_SAFE_INTEGER)
}
fn blueprint_string_ok(v: &Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() <= MAX_BLUEPRINT_STRING_CHARS)
}
fn vector3_ok(v: &Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() == 3 && a.iter().all(finite_number))
}
// A scalar type name, or a scalar type name with `[]` for a list.
fn blueprint_data_type_ok(kind: &str) -> bool {
    BLUEPRINT_SCALAR_TYPES.contains(&kind.strip_suffix("[]").unwrap_or(kind))
}
fn blueprint_scalar_ok(kind: &str, v: &Value) -> bool {
    match kind {
        "number" => finite_number(v),
        "integer" => safe_integer(v),
        "boolean" => v.is_boolean(),
        "string" => blueprint_string_ok(v),
        "vector3" => vector3_ok(v),
        _ => false,
    }
}
fn blueprint_value_ok(kind: &str, v: &Value) -> bool {
    blueprint_data_type_ok(kind)
        && match kind.strip_suffix("[]") {
            Some(item) => v.as_array().is_some_and(|a| {
                a.len() <= MAX_BLUEPRINT_LIST_ITEMS
                    && a.iter().all(|x| blueprint_scalar_ok(item, x))
            }),
            None => blueprint_scalar_ok(kind, v),
        }
}
// Any scalar shape; the session checks the value against the port type.
fn inline_value_ok(v: &Value) -> bool {
    finite_number(v) || v.is_boolean() || blueprint_string_ok(v) || vector3_ok(v)
}
fn inline_inputs_ok(v: &Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.len() <= MAX_BLUEPRINT_INLINE_INPUTS
            && o.iter().all(|(port, value)| {
                !port.is_empty() && port.chars().count() <= 64 && inline_value_ok(value)
            })
    })
}
fn variable_ok(v: &Value) -> bool {
    keys_within(v, &["id", "name", "type", "default"])
        && id_ok(&v["id"])
        && variable_name_ok(&v["name"])
        && v["type"]
            .as_str()
            .is_some_and(|kind| blueprint_value_ok(kind, &v["default"]))
}

pub fn validate_blueprint_node(node: &Value) -> Result<(), AppError> {
    require(
        keys_within(
            node,
            &["id", "version", "type", "settings", "position", "inputs"],
        ) && id_ok(&node["id"])
            && node["version"].as_u64() == Some(1)
            && position_ok(&node["position"])
            && node["type"].as_str().is_some_and(node_type_ok)
            && node["settings"].as_object().is_some_and(|s| s.len() <= 16)
            && node.get("inputs").is_none_or(inline_inputs_ok),
        "Invalid Blueprint node",
    )
}
pub fn validate_blueprint_connection(c: &Value) -> Result<(), AppError> {
    require(
        keys_within(
            c,
            &[
                "id",
                "sourceNodeId",
                "sourcePort",
                "targetNodeId",
                "targetPort",
            ],
        ) && id_ok(&c["id"])
            && id_ok(&c["sourceNodeId"])
            && id_ok(&c["targetNodeId"])
            && port_ok(&c["sourcePort"])
            && port_ok(&c["targetPort"]),
        "Invalid Blueprint connection",
    )
}
pub fn validate_blueprint_graph(graph: &Value) -> Result<(), AppError> {
    require(
        keys_within(
            graph,
            &[
                "schemaVersion",
                "id",
                "name",
                "enabled",
                "nodes",
                "connections",
                "variables",
                "comments",
            ],
        ),
        "Invalid Blueprint graph",
    )?;
    require(
        graph["schemaVersion"].as_u64() == Some(1),
        "unsupported Blueprint version",
    )?;
    require(
        id_ok(&graph["id"])
            && graph["name"]
                .as_str()
                .is_some_and(|n| !n.trim().is_empty() && n.chars().count() <= 128)
            && (graph.get("enabled").is_none() || graph["enabled"].is_boolean()),
        "Invalid Blueprint graph",
    )?;
    let nodes = graph["nodes"]
        .as_array()
        .filter(|n| n.len() <= 128)
        .ok_or_else(|| invalid("invalid Blueprint nodes"))?;
    let connections = graph["connections"]
        .as_array()
        .filter(|c| c.len() <= 256)
        .ok_or_else(|| invalid("invalid Blueprint connections"))?;
    let mut ids = std::collections::HashSet::new();
    for node in nodes {
        validate_blueprint_node(node)?;
        require(
            ids.insert(node["id"].as_str().unwrap_or_default()),
            "Duplicate node ID",
        )?;
    }
    let mut wires = std::collections::HashSet::new();
    for c in connections {
        validate_blueprint_connection(c)?;
        require(
            wires.insert(c["id"].as_str().unwrap_or_default()),
            "Duplicate connection ID",
        )?;
    }
    if let Some(vars) = graph.get("variables") {
        let vars = vars
            .as_array()
            .filter(|v| v.len() <= 32)
            .ok_or_else(|| invalid("invalid Blueprint variables"))?;
        let mut ids = std::collections::HashSet::new();
        for v in vars {
            require(variable_ok(v), "Invalid Blueprint variable")?;
            require(
                ids.insert(v["id"].as_str().unwrap_or_default()),
                "Duplicate variable ID",
            )?;
        }
    }
    validate_blueprint_comments(graph)?;
    Ok(())
}
pub fn validate_blueprint_set(values: &[Value]) -> Result<(), AppError> {
    require(values.len() <= 8, "too many Blueprints")?;
    let mut ids = std::collections::HashSet::new();
    for graph in values {
        validate_blueprint_graph(graph)?;
        require(
            ids.insert(graph["id"].as_str().unwrap_or_default()),
            "duplicate Blueprint ID",
        )?;
    }
    Ok(())
}
fn comment_text_ok(text: &Value) -> bool {
    text.as_str()
        .is_some_and(|t| t.encode_utf16().count() <= 512)
}
fn comment_size_ok(size: &Value) -> bool {
    keys_within(size, &["width", "height"])
        && ["width", "height"].iter().all(|a| {
            size[*a]
                .as_f64()
                .is_some_and(|v| v.is_finite() && (64.0..=8192.0).contains(&v))
        })
}
fn comment_ok(c: &Value) -> bool {
    keys_within(c, &["id", "text", "position", "size"])
        && id_ok(&c["id"])
        && comment_text_ok(&c["text"])
        && position_ok(&c["position"])
        && comment_size_ok(&c["size"])
}
// Comments are optional: a graph without the key is valid.
fn validate_blueprint_comments(graph: &Value) -> Result<(), AppError> {
    let Some(comments) = graph.get("comments") else {
        return Ok(());
    };
    let comments = comments
        .as_array()
        .filter(|c| c.len() <= 32)
        .ok_or_else(|| invalid("invalid Blueprint comments"))?;
    let mut ids = std::collections::HashSet::new();
    for c in comments {
        require(comment_ok(c), "Invalid Blueprint comment")?;
        require(
            ids.insert(c["id"].as_str().unwrap_or_default()),
            "Duplicate comment ID",
        )?;
    }
    Ok(())
}
fn blueprint_authoring_op_ok(op: &Value) -> Option<bool> {
    Some(match op["kind"].as_str()? {
        "addComment" => {
            keys_within(op, &["kind", "graphId", "comment"])
                && id_ok(&op["graphId"])
                && comment_ok(&op["comment"])
        }
        "updateComment" => {
            keys_within(
                op,
                &["kind", "graphId", "commentId", "text", "position", "size"],
            ) && id_ok(&op["graphId"])
                && id_ok(&op["commentId"])
                && op.get("text").is_none_or(comment_text_ok)
                && op.get("position").is_none_or(position_ok)
                && op.get("size").is_none_or(comment_size_ok)
        }
        "removeComment" => {
            keys_within(op, &["kind", "graphId", "commentId"])
                && id_ok(&op["graphId"])
                && id_ok(&op["commentId"])
        }
        "duplicateGraph" => {
            keys_within(op, &["kind", "graphId", "newGraphId", "name"])
                && id_ok(&op["graphId"])
                && id_ok(&op["newGraphId"])
                && op.get("name").is_none_or(|n| {
                    n.as_str()
                        .is_some_and(|n| !n.trim().is_empty() && n.chars().count() <= 128)
                })
        }
        _ => return None,
    })
}
pub fn validate_blueprint_ops(ops: &[Value]) -> Result<(), AppError> {
    require(
        (1..=64).contains(&ops.len()),
        "invalid Blueprint batch size",
    )?;
    for op in ops {
        let ok = match op["kind"].as_str() {
            Some("replaceAll") => {
                keys_within(op, &["kind", "graphs"])
                    && op["graphs"]
                        .as_array()
                        .is_some_and(|g| validate_blueprint_set(g).is_ok())
            }
            Some("createGraph") => {
                keys_within(op, &["kind", "graph"])
                    && validate_blueprint_graph(&op["graph"]).is_ok()
            }
            Some("removeGraph") => keys_within(op, &["kind", "graphId"]) && id_ok(&op["graphId"]),
            Some("updateGraph") => {
                keys_within(op, &["kind", "graphId", "name", "enabled"])
                    && id_ok(&op["graphId"])
                    && op.get("name").is_none_or(|n| {
                        n.as_str()
                            .is_some_and(|n| !n.trim().is_empty() && n.chars().count() <= 128)
                    })
                    && op.get("enabled").is_none_or(Value::is_boolean)
            }
            Some("addNode") => {
                keys_within(op, &["kind", "graphId", "node"])
                    && id_ok(&op["graphId"])
                    && validate_blueprint_node(&op["node"]).is_ok()
            }
            Some("removeNode") => {
                keys_within(op, &["kind", "graphId", "nodeId"])
                    && id_ok(&op["graphId"])
                    && id_ok(&op["nodeId"])
            }
            Some("moveNode") => {
                keys_within(op, &["kind", "graphId", "nodeId", "position"])
                    && id_ok(&op["graphId"])
                    && id_ok(&op["nodeId"])
                    && position_ok(&op["position"])
            }
            Some("setNodeSettings") => {
                keys_within(op, &["kind", "graphId", "nodeId", "settings"])
                    && id_ok(&op["graphId"])
                    && id_ok(&op["nodeId"])
                    && op["settings"].as_object().is_some_and(|s| s.len() <= 16)
            }
            Some("connect") => {
                keys_within(op, &["kind", "graphId", "connection"])
                    && id_ok(&op["graphId"])
                    && validate_blueprint_connection(&op["connection"]).is_ok()
            }
            Some("disconnect") => {
                keys_within(op, &["kind", "graphId", "connectionId"])
                    && id_ok(&op["graphId"])
                    && id_ok(&op["connectionId"])
            }
            Some("addVariable") => {
                keys_within(op, &["kind", "graphId", "variable"])
                    && id_ok(&op["graphId"])
                    && variable_ok(&op["variable"])
            }
            Some("updateVariable") => {
                keys_within(
                    op,
                    &["kind", "graphId", "variableId", "name", "type", "default"],
                ) && id_ok(&op["graphId"])
                    && id_ok(&op["variableId"])
                    && op.get("name").is_none_or(variable_name_ok)
                    && op
                        .get("type")
                        .is_none_or(|t| t.as_str().is_some_and(blueprint_data_type_ok))
                    && op.get("default").is_none_or(|d| {
                        inline_value_ok(d)
                            || d.as_array()
                                .is_some_and(|a| a.len() <= MAX_BLUEPRINT_LIST_ITEMS)
                    })
            }
            Some("removeVariable") => {
                keys_within(op, &["kind", "graphId", "variableId"])
                    && id_ok(&op["graphId"])
                    && id_ok(&op["variableId"])
            }
            Some("setNodeInput") => {
                keys_within(op, &["kind", "graphId", "nodeId", "port", "value"])
                    && id_ok(&op["graphId"])
                    && id_ok(&op["nodeId"])
                    && port_ok(&op["port"])
                    && op
                        .get("value")
                        .is_some_and(|v| v.is_null() || inline_value_ok(v))
            }
            _ => blueprint_authoring_op_ok(op).unwrap_or(false),
        };
        require(ok, "Invalid Blueprint operation")?;
    }
    Ok(())
}

fn validate_blueprint_errors(data: &Value) -> Result<(), AppError> {
    let errors = data["errors"]
        .as_array()
        .filter(|e| e.len() <= 16)
        .ok_or_else(|| invalid("invalid Blueprint errors"))?;
    for e in errors {
        require(
            keys_within(e, &["graphId", "kind", "error"])
                && id_ok(&e["graphId"])
                && matches!(e["kind"].as_str(), Some("compile" | "runtime")),
            "invalid Blueprint error",
        )?;
        decode::<AppError>(&e["error"])?;
    }
    Ok(())
}
const MAX_DEBUG_PAGE: usize = 50;
const MAX_DEBUG_VALUES: usize = 64;
const MAX_DEBUG_TEXT_CHARS: usize = 256;
fn debug_count_ok(v: &Value) -> bool {
    v.as_u64().is_some_and(|n| n as f64 <= MAX_SAFE_INTEGER)
}
fn debug_seq_ok(v: &Value) -> bool {
    debug_count_ok(v) && v.as_u64() != Some(0)
}
fn debug_text_ok(v: &Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() <= MAX_DEBUG_TEXT_CHARS)
}
fn debug_time_ok(v: &Value) -> bool {
    v.as_f64().is_some_and(|t| t.is_finite() && t >= 0.0)
}
fn debug_entry_ok(e: &Value) -> bool {
    let common = debug_seq_ok(&e["seq"])
        && debug_time_ok(&e["atMs"])
        && id_ok(&e["graphId"])
        && id_ok(&e["nodeId"])
        && e.get("dropped").is_none_or(debug_seq_ok);
    let keys = |extra: &[&str]| {
        let mut allowed = vec!["seq", "atMs", "graphId", "nodeId", "kind", "dropped"];
        allowed.extend_from_slice(extra);
        keys_within(e, &allowed)
    };
    common
        && match e["kind"].as_str() {
            Some("log") => {
                keys(&["level", "message"])
                    && matches!(
                        e["level"].as_str(),
                        Some("debug" | "info" | "warning" | "error")
                    )
                    && blueprint_string_ok(&e["message"])
            }
            Some("toast") => {
                keys(&["variant", "header", "caption", "durationSeconds"])
                    && matches!(
                        e["variant"].as_str(),
                        Some("success" | "info" | "warning" | "error")
                    )
                    && blueprint_string_ok(&e["header"])
                    && blueprint_string_ok(&e["caption"])
                    && e["durationSeconds"]
                        .as_f64()
                        .is_some_and(|d| (1.0..=30.0).contains(&d))
            }
            Some("event") => {
                keys(&["name", "valueType", "text"])
                    && blueprint_string_ok(&e["name"])
                    && e.get("valueType")
                        .is_none_or(|t| t.as_str().is_some_and(blueprint_data_type_ok))
                    && e.get("text").is_none_or(debug_text_ok)
            }
            _ => false,
        }
}
fn debug_value_ok(v: &Value) -> bool {
    keys_within(
        v,
        &["graphId", "nodeId", "valueType", "text", "changedMs", "seq"],
    ) && id_ok(&v["graphId"])
        && id_ok(&v["nodeId"])
        && v["valueType"].as_str().is_some_and(blueprint_data_type_ok)
        && debug_text_ok(&v["text"])
        && debug_time_ok(&v["changedMs"])
        && debug_seq_ok(&v["seq"])
}
// The Blueprint debug log page of slice F: entries, Debug Value values, and counters.
pub fn validate_blueprint_debug(data: &Value) -> Result<(), AppError> {
    require(
        keys_within(
            data,
            &["epoch", "latest", "next", "dropped", "entries", "values"],
        ) && id_ok(&data["epoch"])
            && debug_count_ok(&data["latest"])
            && debug_count_ok(&data["next"])
            && debug_count_ok(&data["dropped"])
            && data["entries"].as_array().is_some_and(|entries| {
                entries.len() <= MAX_DEBUG_PAGE && entries.iter().all(debug_entry_ok)
            })
            && data["values"].as_array().is_some_and(|values| {
                values.len() <= MAX_DEBUG_VALUES && values.iter().all(debug_value_ok)
            }),
        "invalid Blueprint debug log",
    )
}
fn validate_blueprint_inspect(data: &Value) -> Result<(), AppError> {
    require(
        data["revision"].as_u64().is_some(),
        "invalid Blueprint revision",
    )?;
    if let Some(held) = data.get("heldKeys") {
        require(
            held.as_array().is_some_and(|codes| {
                (1..=16).contains(&codes.len())
                    && codes.iter().all(|c| {
                        c.as_str()
                            .is_some_and(|c| (1..=32).contains(&c.chars().count()))
                    })
            }),
            "invalid held keys",
        )?;
    }
    if let Some(devices) = data.get("devices") {
        validate_device_kinds(&Some(decode::<Vec<DeviceKind>>(devices)?))?;
    }
    if let Some(youtube) = data.get("youtube") {
        require(youtube.as_bool() == Some(true), "invalid YouTube flag")?;
    }
    match data["kind"].as_str() {
        Some("snapshot") => {
            require(
                keys_within(
                    data,
                    &[
                        "kind",
                        "revision",
                        "blueprints",
                        "errors",
                        "keystrokes",
                        "heldKeys",
                        "devices",
                        "youtube",
                    ],
                ),
                "invalid Blueprint snapshot",
            )?;
            validate_blueprint_set(
                data["blueprints"]
                    .as_array()
                    .ok_or_else(|| invalid("invalid Blueprints"))?,
            )?;
        }
        Some("delta") => {
            require(
                keys_within(
                    data,
                    &[
                        "kind",
                        "revision",
                        "batches",
                        "errors",
                        "keystrokes",
                        "heldKeys",
                        "devices",
                        "youtube",
                    ],
                ),
                "invalid Blueprint delta",
            )?;
            let batches = data["batches"]
                .as_array()
                .filter(|b| b.len() <= 32)
                .ok_or_else(|| invalid("invalid Blueprint batches"))?;
            for b in batches {
                require(
                    keys_within(b, &["revision", "clientId", "batchId", "ops"])
                        && b["revision"].as_u64().is_some()
                        && id_ok(&b["clientId"])
                        && id_ok(&b["batchId"]),
                    "invalid Blueprint batch",
                )?;
                let ops = b["ops"]
                    .as_array()
                    .ok_or_else(|| invalid("invalid Blueprint ops"))?;
                validate_blueprint_ops(ops)?;
                require(
                    ops.iter()
                        .all(|o| !matches!(o["kind"].as_str(), Some("replaceAll" | "createGraph"))),
                    "delta cannot carry replaceAll or createGraph",
                )?;
            }
        }
        _ => return Err(invalid("invalid Blueprint inspect kind")),
    }
    if let Some(list) = data.get("keystrokes") {
        require(
            list.as_array().is_some_and(|k| {
                k.len() <= 64
                    && k.iter().all(|k| {
                        k.as_str()
                            .is_some_and(|k| (1..=64).contains(&k.chars().count()))
                    })
            }),
            "invalid keystrokes",
        )?;
    }
    validate_blueprint_errors(data)
}
object!(RunParams { run_id: Id });
strings!(AssetKind { Avatar=>"avatar", Scene=>"scene", Fixture=>"fixture" });
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetSummary {
    pub id: Id,
    pub kind: AssetKind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits: Option<AssetCredits>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetListParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<Id>,
}
object!(AssetList { assets: Vec<AssetSummary>, next: Option<Id> });
pub const ASSET_LIST_PAGE: usize = 64;
pub const ASSET_LIST_BYTES: usize = 192 * 1024;
impl AssetSummary {
    pub fn of(record: &AssetRecord) -> Self {
        let kind = if record.id.starts_with("avatar_") {
            AssetKind::Avatar
        } else if record.id.starts_with("scene_") {
            AssetKind::Scene
        } else {
            AssetKind::Fixture
        };
        Self {
            id: record.id.clone(),
            kind,
            name: record.name.clone(),
            credits: record.credits.clone(),
        }
    }
}
impl AssetList {
    /// One page of summaries in ascending ID order after `after`, bounded by `ASSET_LIST_PAGE` and `ASSET_LIST_BYTES`.
    pub fn page(records: &[AssetRecord], after: Option<&str>) -> Self {
        let mut sorted: Vec<&AssetRecord> = records
            .iter()
            .filter(|r| after.is_none_or(|a| r.id.as_str() > a))
            .collect();
        sorted.sort_by(|a, b| a.id.cmp(&b.id));
        let mut assets = Vec::new();
        let mut bytes = 0usize;
        for record in &sorted {
            let summary = AssetSummary::of(record);
            let size = serde_json::to_vec(&summary).map_or(usize::MAX, |b| b.len() + 1);
            // A page always takes one summary, so paging always advances.
            if !assets.is_empty()
                && (assets.len() == ASSET_LIST_PAGE
                    || bytes.saturating_add(size) > ASSET_LIST_BYTES)
            {
                break;
            }
            bytes += size;
            assets.push(summary);
        }
        let next = (assets.len() < sorted.len())
            .then(|| assets.last().map(|a| a.id.clone()))
            .flatten();
        Self { assets, next }
    }
}
fn credits_ok(credits: &Option<AssetCredits>) -> Result<(), AppError> {
    require(
        credits
            .as_ref()
            .and_then(|c| c.source_url.as_ref())
            .is_none_or(|s| {
                (s.starts_with("http://") || s.starts_with("https://"))
                    && url::Url::parse(s).is_ok()
            }),
        "invalid credits source URL",
    )
}
fn id_text_ok(id: &str) -> bool {
    !id.is_empty() && id.encode_utf16().count() <= 256
}
impl Validate for AssetListParams {
    fn validate(&self) -> Result<(), AppError> {
        require(self.after.as_deref().is_none_or(id_text_ok), "invalid ID")
    }
}
impl Validate for AssetList {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(self.assets.len() <= ASSET_LIST_PAGE, "too many assets")?;
        require(self.next.as_deref().is_none_or(id_text_ok), "invalid ID")?;
        for asset in &self.assets {
            require(
                !asset.name.trim().is_empty() && asset.name.encode_utf16().count() <= 128,
                "invalid asset name",
            )?;
            credits_ok(&asset.credits)?;
        }
        Ok(())
    }
}
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input: Option<InputUpdate>,
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
    ScreenshotRequest {
        #[serde(rename = "requestId")]
        request_id: Id,
        params: CameraScreenshotParams,
    },
    ScreenshotReply {
        #[serde(rename = "requestId")]
        request_id: Id,
        result: Value,
    },
    /// The poses of the enabled VMC senders for one tick, from the publisher only (B21 R8).
    VmcPoses {
        #[serde(rename = "sessionId")]
        session_id: Id,
        tick: u64,
        poses: Vec<VmcSendPose>,
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
        require(
            self.entities
                .iter()
                .filter(|e| matches!(e, SceneEntity::Environment { .. }))
                .count()
                <= 1,
            "too many environments",
        )?;
        require(cameras.len() <= MAX_CAMERAS, "too many cameras")?;
        let lights: Vec<_> = self
            .entities
            .iter()
            .filter_map(|e| match e {
                SceneEntity::Light { light, .. } => Some(light),
                _ => None,
            })
            .collect();
        require(
            lights.len() <= MAX_LIGHTS
                && lights.iter().filter(|l| l.shadow.enabled).count() <= MAX_SHADOW_LIGHTS,
            "too many lights",
        )?;
        // A haze does not count as a light (B13 R2).
        require(
            self.entities
                .iter()
                .filter(|e| matches!(e, SceneEntity::Haze { .. }))
                .count()
                <= MAX_HAZES,
            "too many hazes",
        )?;
        require(
            self.entities
                .iter()
                .filter(|e| matches!(e, SceneEntity::FpsCounter { .. }))
                .count()
                <= MAX_FPS_COUNTERS,
            "too many fps counters",
        )?;
        let senders: Vec<_> = self
            .entities
            .iter()
            .filter_map(|e| match e {
                SceneEntity::VmcSender { vmc_sender, .. } => Some(vmc_sender),
                _ => None,
            })
            .collect();
        require(senders.len() <= MAX_VMC_SENDERS, "too many VMC senders")?;
        for sender in senders {
            if let Some(avatar) = &sender.avatar_id {
                require(
                    self.entities
                        .iter()
                        .any(|e| matches!(e, SceneEntity::Avatar { id, .. } if id == avatar)),
                    "missing VMC sender character",
                )?;
            }
        }
        for e in &self.entities {
            if let SceneEntity::Camera {
                navigation:
                    Some(CameraNavigation::OrbitCharacter {
                        target_id: Some(target),
                        ..
                    }),
                ..
            } = e
            {
                require(
                    self.entities
                        .iter()
                        .any(|a| matches!(a, SceneEntity::Avatar { id, .. } if id == target)),
                    "missing camera target",
                )?;
            }
        }
        for e in &self.entities {
            if let SceneEntity::Avatar {
                tracking: Some(t), ..
            } = e
            {
                for id in [&t.body_source_id, &t.face_source_id, &t.fingers_source_id]
                    .into_iter()
                    .flatten()
                {
                    require(sources.contains(id.as_str()), "missing tracking source")?;
                    // Only the face slot accepts an iFacialMocap source.
                    if t.body_source_id.as_ref() == Some(id)
                        || t.fingers_source_id.as_ref() == Some(id)
                    {
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
                o.format_ok() && (o.id != "preview_main" || o.is_default_format()),
                "invalid output spec",
            )?;
        }
        Ok(())
    }
}
pub fn validate_show_scene(scene: &SceneView) -> Result<(), AppError> {
    scene.validate()?;
    let outputs: HashSet<_> = scene
        .outputs
        .iter()
        .map(|output| output.id.as_str())
        .collect();
    require(
        outputs.contains("output_main") && outputs.contains("preview_main"),
        "show requires main and preview outputs",
    )
}
impl Validate for SceneReplaceParams {
    fn validate(&self) -> Result<(), AppError> {
        require(
            self.expected_revision <= 9_007_199_254_740_991,
            "invalid expected revision",
        )?;
        validate_show_scene(&self.scene)
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
                PatchOp::SetCameraNavigation { navigation, .. } => navigation.validate()?,
                PatchOp::SetLight { light, .. } => light.validate()?,
                PatchOp::SetHaze { haze, .. } => haze.validate()?,
                PatchOp::SetFpsCounter { fps_counter, .. } => fps_counter.validate()?,
                PatchOp::SetVmcSender { vmc_sender, .. } => vmc_sender.validate()?,
                PatchOp::SetOutputFormat {
                    width,
                    height,
                    fps,
                    render_scale,
                    ..
                } => require(
                    output_format_ok(*width, *height, *fps, *render_scale),
                    "invalid output format",
                )?,
                PatchOp::SetEnvironmentReflections {
                    reflections_intensity,
                    ..
                } => require(
                    reflections_intensity_ok(*reflections_intensity),
                    "invalid reflections intensity",
                )?,
                PatchOp::SetTrackingConfig { config, .. } => config.validate()?,
                PatchOp::SetTrackingSmoothing { smoothing, .. } => smoothing.validate()?,
                PatchOp::SetTrackingCalibration {
                    calibration: Some(calibration),
                    ..
                } => calibration.validate()?,
                PatchOp::SetTrackingMapping { mapping, .. } => mapping.validate()?,
                PatchOp::FitBlendShapeRanges { neutral, .. } => require(
                    neutral.iter().all(|(name, value)| {
                        ARKIT_NAMES.contains(&name.as_str()) && (0. ..=1.).contains(value)
                    }),
                    "invalid blend shape neutral",
                )?,
                PatchOp::SetAvatarExpression { name, settings, .. } => {
                    require(expression_name_ok(name), "invalid expression name")?;
                    if let Some(settings) = settings {
                        settings.validate()?;
                    }
                }
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
        if let Some(statuses) = &self.vmc_senders {
            validate_vmc_statuses(statuses)?;
        }
        if let Some(youtube) = &self.youtube {
            youtube.validate()?;
        }
        if let Some(addresses) = &self.local_addresses {
            require(
                addresses.len() <= 8
                    && addresses
                        .iter()
                        .all(|a| a.parse::<std::net::Ipv4Addr>().is_ok()),
                "invalid local addresses",
            )?;
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
            !self.name.trim().is_empty() && self.name.encode_utf16().count() <= 128,
            "invalid asset name",
        )?;
        require(
            self.source_url
                .as_ref()
                .is_none_or(|s| url::Url::parse(s).is_ok()),
            "invalid source URL",
        )?;
        credits_ok(&self.credits)?;
        expressions_ok(&self.expressions)?;
        if let Some(rig) = &self.rig {
            rig.validate()?;
        }
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
        "sceneReplace" => decode::<SceneReplaceParams>(params)?.validate(),
        "cameraSelect" => decode::<CameraSelectParams>(params).map(|_| ()),
        "blueprintRun" => decode::<BlueprintRunParams>(params)?.validate(),
        "blueprintEdit" => validate_blueprint_ops(&decode::<BlueprintEditParams>(params)?.ops),
        "blueprintInspect" => decode::<BlueprintInspectParams>(params).map(|_| ()),
        "blueprintDebug" => decode::<BlueprintDebugParams>(params).map(|_| ()),
        "trackingProbe" => {
            let p = decode::<TrackingProbeParams>(params)?;
            require(id_text_ok(&p.source_id), "invalid source ID")
        }
        "captureFrame" => decode::<CaptureParams>(params)?.validate(),
        "benchmarkStart" => decode::<BenchmarkParams>(params).map(|_| ()),
        "benchmarkStatus" | "benchmarkCancel" => decode::<RunParams>(params).map(|_| ()),
        "evidenceRead" => decode::<EvidenceReadParams>(params).map(|_| ()),
        "assetList" => decode::<AssetListParams>(params)?.validate(),
        "cameraScreenshot" => decode::<CameraScreenshotParams>(params)?.validate(),
        "integrationsSet" => decode::<IntegrationsSetParams>(params)?.validate(),
        "expressionGet" => {
            let p = decode::<ExpressionGetParams>(params)?;
            require(id_text_ok(&p.avatar_id), "invalid avatar ID")
        }
        "expressionSet" => {
            let p = decode::<ExpressionSetParams>(params)?;
            require(
                id_text_ok(&p.avatar_id) && expression_name_ok(&p.name),
                "invalid expression call",
            )
        }
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
            | "sceneReplace"
            | "cameraSelect"
            | "blueprintRun"
            | "blueprintEdit"
            | "blueprintInspect"
            | "blueprintDebug"
            | "trackingProbe"
            | "captureFrame"
            | "benchmarkStart"
            | "benchmarkStatus"
            | "benchmarkCancel"
            | "evidenceRead"
            | "assetList"
            | "expressionGet"
            | "expressionSet"
            | "cameraScreenshot"
            | "integrationsSet"
    );
    require(known, "unknown method")?;
    let Some(data) = reply_data(result)? else {
        return Ok(());
    };
    match method {
        "appStatus" => decode::<AppStatus>(data)?.validate(),
        "sceneInspect" => decode::<SceneView>(data)?.validate(),
        "sceneReplace" => validate_show_scene(&decode::<SceneView>(data)?),
        "scenePatch" | "cameraSelect" | "blueprintRun" => {
            decode::<RevisionResult>(data).map(|_| ())
        }
        "blueprintEdit" => {
            let r = decode::<BlueprintEditResult>(data)?;
            require(
                r.keystrokes.len() <= 64
                    && r.keystrokes
                        .iter()
                        .all(|k| (1..=64).contains(&k.chars().count())),
                "invalid keystrokes",
            )?;
            require(
                r.held_keys.len() <= 16
                    && r.held_keys
                        .iter()
                        .all(|k| (1..=32).contains(&k.chars().count())),
                "invalid held keys",
            )?;
            require(r.youtube.is_none_or(|y| y), "invalid YouTube flag")?;
            validate_device_kinds(&r.devices)
        }
        "blueprintInspect" => validate_blueprint_inspect(data),
        "blueprintDebug" => validate_blueprint_debug(data),
        "trackingProbe" => decode::<TrackingProbe>(data)?.validate(),
        "captureFrame" => decode::<CaptureRecord>(data)?.validate(),
        "benchmarkStart" | "benchmarkStatus" | "benchmarkCancel" => {
            decode::<BenchmarkRun>(data)?.validate()
        }
        "evidenceRead" => decode::<EvidenceManifest>(data)?.validate(),
        "assetList" => decode::<AssetList>(data)?.validate(),
        "expressionGet" | "expressionSet" => decode::<ExpressionState>(data)?.validate(),
        "cameraScreenshot" => decode::<CameraScreenshotResult>(data)?.validate(),
        "integrationsSet" => decode::<YouTubeStatus>(data)?.validate(),
        _ => unreachable!(),
    }
}
/// The byte limit of a clock message (mirrors `clockByteLimit` in TypeScript). A clock with
/// tracking, device input, or YouTube events uses the large limit: tracking samples, 32 device
/// events with 4 pads, and 8 chat events do not fit the plain limit. Any other clock uses the
/// plain limit.
pub fn clock_byte_limit(tracking: Option<&TrackingUpdate>, input: Option<&InputUpdate>) -> usize {
    if tracking.is_some() || input.is_some_and(|i| i.devices.is_some() || i.youtube.is_some()) {
        MAX_TRACKING_CLOCK_BYTES
    } else {
        MAX_CLOCK_BYTES
    }
}
pub fn parse_wire(bytes: &[u8]) -> Result<WireMessage, AppError> {
    require(
        bytes.len() <= MAX_SCREENSHOT_MESSAGE_BYTES,
        "oversized message",
    )?;
    let value: Value = serde_json::from_slice(bytes).map_err(|e| invalid(e.to_string()))?;
    let msg: WireMessage = decode(&value)?;
    let limit = match msg {
        WireMessage::ScreenshotReply { .. } => MAX_SCREENSHOT_MESSAGE_BYTES,
        WireMessage::CaptureReply { .. } => MAX_CAPTURE_MESSAGE_BYTES,
        _ => MAX_MESSAGE_BYTES,
    };
    require(bytes.len() <= limit, "oversized ordinary message")?;
    match &msg {
        WireMessage::Clock {
            elapsed_ms,
            tracking,
            input,
            ..
        } => {
            if let Some(update) = tracking {
                update.validate()?;
            }
            if let Some(update) = input {
                update.validate()?;
            }
            require(
                bytes.len() <= clock_byte_limit(tracking.as_ref(), input.as_ref()),
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
                validate_base64(&d.png_base64, MAX_CAPTURE_PNG_BYTES)?;
            }
        }
        WireMessage::ScreenshotRequest { params, .. } => params.validate()?,
        WireMessage::ScreenshotReply { result, .. } => {
            if let Some(data) = reply_data(result)? {
                decode::<ScreenshotReplyData>(data)?.validate()?;
            }
        }
        WireMessage::VmcPoses { tick, poses, .. } => {
            require(*tick <= 9_007_199_254_740_991, "unsafe VMC tick")?;
            validate_vmc_poses(poses)?;
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
fn validate_base64(s: &str, max_bytes: usize) -> Result<(), AppError> {
    let bytes = s.as_bytes();
    let padding = if s.ends_with("==") {
        2
    } else if s.ends_with('=') {
        1
    } else {
        0
    };
    require(
        bytes.len().is_multiple_of(4) && bytes.len() <= max_bytes.div_ceil(3) * 4,
        "invalid base64 length",
    )?;
    require(
        bytes[..bytes.len() - padding]
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'+' || *b == b'/'),
        "invalid base64",
    )?;
    require(
        bytes.len() / 4 * 3 - padding <= max_bytes,
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
        require(self.format_ok(), "invalid output spec")
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
            config,
            smoothing,
            calibration,
            mapping,
            ..
        } = self
        {
            config.validate()?;
            if let Some(smoothing) = smoothing {
                smoothing.validate()?;
            }
            if let Some(calibration) = calibration {
                calibration.validate()?;
            }
            if let Some(mapping) = mapping {
                mapping.validate()?;
            }
        }
        if let Self::Camera {
            lens, navigation, ..
        } = self
        {
            lens.validate()?;
            if let Some(navigation) = navigation {
                navigation.validate()?;
            }
        }
        if let Self::Light { light, .. } = self {
            light.validate()?;
        }
        if let Self::Haze { haze, .. } = self {
            haze.validate()?;
        }
        if let Self::FpsCounter { fps_counter, .. } = self {
            fps_counter.validate()?;
        }
        if let Self::VmcSender { vmc_sender, .. } = self {
            vmc_sender.validate()?;
        }
        if let Self::Environment {
            reflections_intensity: Some(n),
            ..
        } = self
        {
            require(
                reflections_intensity_ok(*n),
                "invalid reflections intensity",
            )?;
        }
        if let Self::Avatar {
            expressions: Some(expressions),
            ..
        } = self
        {
            require(
                expressions.len() <= MAX_EXPRESSIONS
                    && expressions.keys().all(|name| expression_name_ok(name)),
                "invalid avatar expressions",
            )?;
            for settings in expressions.values() {
                settings.validate()?;
            }
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
        validate_base64(&self.png_base64, MAX_CAPTURE_PNG_BYTES)
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
