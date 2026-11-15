//! The platform boundary of the FaceKit tracker (TRK-24 B33). Only plain data crosses it.
use std::sync::Arc;

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraInfo {
    pub device_id: String,
    pub label: String,
}

/// One usable face: the 51 blend shapes in `FACEKIT_NAMES` order and the rotation as delivered.
#[derive(Clone, Debug, PartialEq)]
pub struct FaceFrame {
    pub blendshapes: [f32; 51],
    pub tongue_out: Option<f32>,
    pub rotation: [[f32; 3]; 3],
}

// One event goes to the sink for each camera frame; a box would allocate for each of them.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq)]
pub enum FaceEvent {
    Unavailable(String),
    PermissionNeeded,
    CameraFailed(String),
    Face { frame: FaceFrame, inference_ms: f64 },
    NoFace,
}

pub type FaceSink = Arc<dyn Fn(FaceEvent) + Send + Sync>;

pub trait FaceAdapter: Send + Sync {
    fn cameras(&self) -> Vec<CameraInfo>;
    /// Returns at once. Progress and failures arrive through `sink`, possibly before `start` returns.
    /// Before a terminal event (`Unavailable`, `PermissionNeeded`, `CameraFailed`) the adapter stops the camera and releases the tracker.
    fn start(&self, device_id: &str, sink: FaceSink) -> Box<dyn FaceRun>;
}

/// Drop stops the capture and releases the tracker. It returns after the capture stopped.
pub trait FaceRun: Send {}
