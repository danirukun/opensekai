use super::*;
// The VMC sender slice (B21, MED-09). Mirrors `packages/contracts/src/vmc-sender.ts`.
pub const MAX_VMC_SENDERS: usize = 4;
pub const VMC_SENDER_DEFAULT_PORT: u16 = 39539;
object!(VmcSenderSettings {
    enabled: bool,
    address: String,
    port: u16,
    avatar_id: Option<Id>
});
strings!(RigMetaVersion { V0=>"0", V1=>"1" });
object!(AvatarRig {
    meta_version: RigMetaVersion,
    rest_positions: BTreeMap<String, Vec3>,
    identity_rest: bool
});
object!(VmcTransform {
    position: Vec3,
    rotation: Quat
});
object!(VmcSendPose {
    sender_id: Id,
    root: VmcTransform,
    bones: BTreeMap<String, VmcTransform>,
    blends: BTreeMap<String, f64>
});
strings!(VmcSenderState { Stopped=>"stopped", Waiting=>"waiting", Sending=>"sending", Error=>"error" });
object!(VmcSenderStatus {
    entity_id: Id,
    state: VmcSenderState,
    datagrams: u64,
    errors: u64,
    error: Option<String>
});
/// A send target cannot be unspecified, multicast, or the limited broadcast (R1). An
/// IPv4-mapped IPv6 address counts as its IPv4 address.
pub fn vmc_send_address_ok(address: &str) -> bool {
    address.len() <= 64
        && address
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| match ip.to_canonical() {
                std::net::IpAddr::V4(v4) => {
                    !v4.is_unspecified() && !v4.is_multicast() && !v4.is_broadcast()
                }
                std::net::IpAddr::V6(v6) => !v6.is_unspecified() && !v6.is_multicast(),
            })
}
/// A blend name goes into an OSC string: no NUL, at most 128 UTF-8 bytes.
pub fn vmc_blend_name_ok(name: &str) -> bool {
    !name.is_empty() && name.len() <= 128 && !name.contains('\0')
}
fn unit_rotation(q: &Quat) -> Result<(), AppError> {
    require(
        q.iter().all(|v| v.is_finite())
            && (q.iter().map(|v| v * v).sum::<f64>().sqrt() - 1.).abs() <= 0.001,
        "invalid VMC rotation",
    )
}
fn finite_vec(v: &Vec3) -> bool {
    v.iter().all(|n| n.is_finite())
}
impl Validate for VmcSenderSettings {
    fn validate(&self) -> Result<(), AppError> {
        require(
            vmc_send_address_ok(&self.address),
            "invalid VMC send address",
        )?;
        require(self.port > 0, "invalid VMC send port")?;
        require(
            self.avatar_id
                .as_ref()
                .is_none_or(|id| !id.is_empty() && id.encode_utf16().count() <= 256),
            "invalid VMC sender character",
        )
    }
}
impl Validate for AvatarRig {
    fn validate(&self) -> Result<(), AppError> {
        require(
            self.rest_positions.len() <= 55
                && self
                    .rest_positions
                    .iter()
                    .all(|(name, p)| humanoid_bone(name) && finite_vec(p)),
            "invalid avatar rig",
        )
    }
}
impl Validate for VmcSendPose {
    fn validate(&self) -> Result<(), AppError> {
        require(
            !self.sender_id.is_empty() && self.sender_id.encode_utf16().count() <= 256,
            "invalid VMC sender",
        )?;
        require(
            self.bones.len() <= 55 && self.blends.len() <= 64,
            "too many VMC channels",
        )?;
        unit_rotation(&self.root.rotation)?;
        require(finite_vec(&self.root.position), "invalid VMC root")?;
        for (name, bone) in &self.bones {
            require(
                humanoid_bone(name) && finite_vec(&bone.position),
                "invalid VMC bone",
            )?;
            unit_rotation(&bone.rotation)?;
        }
        for (name, weight) in &self.blends {
            require(
                vmc_blend_name_ok(name) && weight.is_finite() && (0. ..=1.).contains(weight),
                "invalid VMC blend",
            )?;
        }
        Ok(())
    }
}
pub fn validate_vmc_poses(poses: &[VmcSendPose]) -> Result<(), AppError> {
    require(
        (1..=MAX_VMC_SENDERS).contains(&poses.len()),
        "invalid VMC pose count",
    )?;
    let mut ids = HashSet::new();
    for pose in poses {
        require(ids.insert(&pose.sender_id), "duplicate VMC pose")?;
        pose.validate()?;
    }
    Ok(())
}
impl Validate for VmcSenderStatus {
    fn validate(&self) -> Result<(), AppError> {
        require(
            !self.entity_id.is_empty()
                && self.entity_id.encode_utf16().count() <= 256
                && self.datagrams <= 9_007_199_254_740_991
                && self.errors <= 9_007_199_254_740_991
                && self
                    .error
                    .as_ref()
                    .is_none_or(|s| s.encode_utf16().count() <= 512),
            "invalid VMC sender status",
        )
    }
}
pub(crate) fn validate_vmc_statuses(statuses: &[VmcSenderStatus]) -> Result<(), AppError> {
    require(
        statuses.len() <= MAX_VMC_SENDERS,
        "too many VMC sender statuses",
    )?;
    let mut ids = HashSet::new();
    for s in statuses {
        require(ids.insert(&s.entity_id), "duplicate VMC sender status")?;
        s.validate()?;
    }
    Ok(())
}
