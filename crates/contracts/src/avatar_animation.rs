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

fn overlay_parts_ok(parts: &[BodyPart]) -> bool {
    parts.len() <= 8 && {
        let mut seen = std::collections::HashSet::new();
        parts.iter().all(|p| seen.insert(*p))
    }
}

fn overlay_weight_speed_ok(weight: f64, speed: Option<f64>) -> bool {
    weight.is_finite()
        && (0.0..=1.0).contains(&weight)
        && speed
            .map(|s| s.is_finite() && (0.0..=4.0).contains(&s))
            .unwrap_or(true)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OverlayPoseEntry {
    /// Clip first so `kind: "clip"` does not fall through to the pose shape.
    Clip {
        id: Id,
        kind: OverlayClipKind,
        #[serde(rename = "assetId")]
        asset_id: Id,
        #[serde(rename = "maskedBodyParts")]
        masked_body_parts: Vec<BodyPart>,
        weight: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speed: Option<f64>,
    },
    Pose {
        id: Id,
        pose: OverlayPoseId,
        #[serde(rename = "maskedBodyParts")]
        masked_body_parts: Vec<BodyPart>,
        weight: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speed: Option<f64>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OverlayClipKind {
    Clip,
}

impl OverlayPoseEntry {
    pub fn id(&self) -> &Id {
        match self {
            Self::Clip { id, .. } | Self::Pose { id, .. } => id,
        }
    }

    pub fn is_valid(&self) -> bool {
        match self {
            Self::Clip {
                asset_id,
                masked_body_parts,
                weight,
                speed,
                ..
            } => {
                !asset_id.is_empty()
                    && overlay_parts_ok(masked_body_parts)
                    && overlay_weight_speed_ok(*weight, *speed)
            }
            Self::Pose {
                masked_body_parts,
                weight,
                speed,
                ..
            } => overlay_parts_ok(masked_body_parts) && overlay_weight_speed_ok(*weight, *speed),
        }
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
                    .all(|e| e.is_valid() && ids.insert(e.id().clone()))
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
