use serde::{Deserialize, Serialize};

use crate::{BodyPart, Id};

pub const MAX_OVERLAY_POSES: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OverlayPoseId {
    Rest,
    Selfie,
    Wave,
    Mic,
    Controller,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HandPoseId {
    Open,
    Fist,
    Grab,
    HangLoose,
    Hold1,
    Hold2,
    Idle,
    OkayDokey,
    Peace,
    Pinch1,
    Pinch2,
    PistolGrip,
    Point1,
    Point2,
    RockOn,
    Scoop,
    Scratch,
    ScrewYou,
    SplayedOut,
    ThumbsUp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverlayPoseEntry {
    pub id: Id,
    pub pose: OverlayPoseId,
    pub masked_body_parts: Vec<BodyPart>,
    pub weight: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
}

impl OverlayPoseEntry {
    pub fn is_valid(&self) -> bool {
        self.weight.is_finite()
            && (0.0..=1.0).contains(&self.weight)
            && self.masked_body_parts.len() <= 8
            && {
                let mut seen = std::collections::HashSet::new();
                self.masked_body_parts.iter().all(|p| seen.insert(*p))
            }
            && self
                .speed
                .map(|s| s.is_finite() && (0.0..=4.0).contains(&s))
                .unwrap_or(true)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandOverride {
    pub enabled: bool,
    pub pose: HandPoseId,
    pub weight: f64,
    pub high_priority: bool,
}

impl HandOverride {
    pub fn is_valid(&self) -> bool {
        self.weight.is_finite() && (0.0..=1.0).contains(&self.weight)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HandPinMode {
    Preset,
    Hold,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandPin {
    pub enabled: bool,
    pub mode: HandPinMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandOverrides {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<HandOverride>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<HandOverride>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandPins {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<HandPin>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<HandPin>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AvatarAnimation {
    pub overlaying_poses: Vec<OverlayPoseEntry>,
    pub overlay_transition_seconds: f64,
    pub override_hand_poses: HandOverrides,
    pub hand_pin: HandPins,
}

impl AvatarAnimation {
    pub fn is_valid(&self) -> bool {
        self.overlaying_poses.len() <= MAX_OVERLAY_POSES
            && self.overlay_transition_seconds.is_finite()
            && (0.0..=5.0).contains(&self.overlay_transition_seconds)
            && {
                let mut ids = std::collections::BTreeSet::new();
                self.overlaying_poses
                    .iter()
                    .all(|e| e.is_valid() && ids.insert(e.id.clone()))
            }
            && self
                .override_hand_poses
                .left
                .as_ref()
                .map(HandOverride::is_valid)
                .unwrap_or(true)
            && self
                .override_hand_poses
                .right
                .as_ref()
                .map(HandOverride::is_valid)
                .unwrap_or(true)
    }
}
