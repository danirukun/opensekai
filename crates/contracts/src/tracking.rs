use super::*;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum TrackingConfig {
    Vmc {
        enabled: bool,
        #[serde(rename = "bindAddress")]
        bind_address: String,
        port: u16,
        #[serde(rename = "senderAddress")]
        sender_address: Option<String>,
    },
    #[serde(rename = "ifacialmocap")]
    IFacialMocap {
        enabled: bool,
        #[serde(rename = "bindAddress")]
        bind_address: String,
        port: u16,
        #[serde(rename = "phoneAddress")]
        phone_address: Option<String>,
    },
    Mediapipe {
        enabled: bool,
        #[serde(rename = "deviceId")]
        device_id: String,
        face: bool,
        #[serde(rename = "upperBody")]
        upper_body: bool,
        hands: bool,
        mirror: bool,
    },
}
object!(AvatarTracking {body_source_id:Option<Id>,face_source_id:Option<Id>});
strings!(BoneSpace { Raw=>"raw",Normalized=>"normalized" });
strings!(TrackingState { Stopped=>"stopped",Waiting=>"waiting",Receiving=>"receiving",Stale=>"stale",Error=>"error" });
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrackingBone {
    pub rotation: Quat,
    pub space: BoneSpace,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<Vec3>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<f64>,
}
object!(TrackingRoot {
    position: Vec3,
    rotation: Quat
});
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrackingSample {
    pub source_id: Id,
    pub generation: u64,
    pub received_at_ms: f64,
    pub bones: BTreeMap<String, TrackingBone>,
    pub expressions: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<TrackingRoot>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrackingStatus {
    pub source_id: Id,
    pub generation: u64,
    pub state: TrackingState,
    pub packets: u64,
    pub invalid_packets: u64,
    pub last_received_at_ms: Option<f64>,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inference_ms: Option<f64>,
}
object!(TrackingUpdate {samples:Vec<TrackingSample>,statuses:Vec<TrackingStatus>});
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AvatarPose {
    pub avatar_id: Id,
    pub bones: BTreeMap<String, TrackingBone>,
    pub expressions: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<TrackingRoot>,
}
pub fn humanoid_bone(name: &str) -> bool {
    const CORE: &[&str] = &[
        "hips",
        "spine",
        "chest",
        "upperChest",
        "neck",
        "head",
        "leftEye",
        "rightEye",
        "jaw",
        "leftUpperLeg",
        "leftLowerLeg",
        "leftFoot",
        "leftToes",
        "rightUpperLeg",
        "rightLowerLeg",
        "rightFoot",
        "rightToes",
        "leftShoulder",
        "leftUpperArm",
        "leftLowerArm",
        "leftHand",
        "rightShoulder",
        "rightUpperArm",
        "rightLowerArm",
        "rightHand",
    ];
    CORE.contains(&name)
        || ["left", "right"].iter().any(|side| {
            name.strip_prefix(side).is_some_and(|n| {
                [
                    "ThumbMetacarpal",
                    "ThumbProximal",
                    "ThumbDistal",
                    "IndexProximal",
                    "IndexIntermediate",
                    "IndexDistal",
                    "MiddleProximal",
                    "MiddleIntermediate",
                    "MiddleDistal",
                    "RingProximal",
                    "RingIntermediate",
                    "RingDistal",
                    "LittleProximal",
                    "LittleIntermediate",
                    "LittleDistal",
                ]
                .contains(&n)
            })
        })
}
impl Validate for TrackingConfig {
    fn validate(&self) -> Result<(), AppError> {
        match self {
            Self::Vmc {
                bind_address,
                port,
                sender_address,
                ..
            }
            | Self::IFacialMocap {
                bind_address,
                port,
                phone_address: sender_address,
                ..
            } => {
                require(
                    bind_address.parse::<std::net::IpAddr>().is_ok() && *port > 0,
                    "invalid receiver endpoint",
                )?;
                if let Some(s) = sender_address {
                    require(
                        s.parse::<std::net::IpAddr>().is_ok(),
                        "invalid sender address",
                    )?;
                }
            }
            Self::Mediapipe {
                enabled,
                device_id,
                face,
                upper_body,
                hands,
                ..
            } => require(
                device_id.encode_utf16().count() <= 512
                    && (!enabled || *face || *upper_body || *hands),
                "invalid webcam config",
            )?,
        }
        Ok(())
    }
}
fn rotation(q: &Quat) -> Result<(), AppError> {
    require(
        q.iter().all(|v| v.is_finite())
            && (q.iter().map(|v| v * v).sum::<f64>().sqrt() - 1.).abs() <= 0.001,
        "invalid tracking rotation",
    )
}
fn channels(
    bones: &BTreeMap<String, TrackingBone>,
    expressions: &BTreeMap<String, f64>,
    root: &Option<TrackingRoot>,
) -> Result<(), AppError> {
    require(
        bones.len() <= 64 && expressions.len() <= 64,
        "too many tracking channels",
    )?;
    for (name, bone) in bones {
        require(humanoid_bone(name), "unknown humanoid bone")?;
        rotation(&bone.rotation)?;
        require(
            bone.weight
                .is_none_or(|w| w.is_finite() && (0. ..=1.).contains(&w)),
            "invalid bone weight",
        )?;
        if let Some(p) = bone.position {
            require(p.iter().all(|n| n.is_finite()), "invalid bone position")?;
        }
    }
    for (name, weight) in expressions {
        require(
            !name.is_empty() && name.encode_utf16().count() <= 128 && (0. ..=1.).contains(weight),
            "invalid expression",
        )?;
    }
    if let Some(r) = root {
        rotation(&r.rotation)?;
        require(
            r.position.iter().all(|n| n.is_finite()),
            "invalid root position",
        )?;
    }
    Ok(())
}
impl Validate for TrackingSample {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(
            self.received_at_ms.is_finite()
                && (0. ..=9_007_199_254_740_991.).contains(&self.received_at_ms),
            "invalid tracking time",
        )?;
        channels(&self.bones, &self.expressions, &self.root)
    }
}
impl Validate for AvatarPose {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        channels(&self.bones, &self.expressions, &self.root)
    }
}
impl Validate for TrackingStatus {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(
            self.error
                .as_ref()
                .is_none_or(|s| s.encode_utf16().count() <= 512)
                && self
                    .inference_ms
                    .is_none_or(|n| n.is_finite() && (0. ..=60_000.).contains(&n))
                && self
                    .last_received_at_ms
                    .is_none_or(|n| n.is_finite() && (0. ..=9_007_199_254_740_991.).contains(&n)),
            "invalid tracking status",
        )
    }
}
pub(crate) fn validate_statuses(statuses: &[TrackingStatus]) -> Result<(), AppError> {
    require(statuses.len() <= 4, "too many tracking statuses")?;
    let mut ids = HashSet::new();
    for s in statuses {
        require(ids.insert(&s.source_id), "duplicate tracking status")?;
        s.validate()?;
    }
    Ok(())
}
impl Validate for TrackingUpdate {
    fn validate(&self) -> Result<(), AppError> {
        validate_statuses(&self.statuses)?;
        require(self.samples.len() <= 4, "too many tracking samples")?;
        let mut ids = HashSet::new();
        for s in &self.samples {
            require(ids.insert(&s.source_id), "duplicate tracking sample")?;
            s.validate()?;
        }
        Ok(())
    }
}
