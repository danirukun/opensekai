//! The VMC sender manager (B21 R10-R14). It reads the senders of each accepted scene revision,
//! owns one UDP socket for each enabled sender, and sends the poses that the session publishes.
use crate::tracking::osc_out::encode_vmc_pose;
use opensekai_contracts::*;
use std::{
    collections::BTreeMap,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, UdpSocket},
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};
/// The least time between two sent poses of one sender (R13).
pub const MIN_POSE_INTERVAL: Duration = Duration::from_millis(15);
/// A sender is `sending` while its last sent pose is younger than this, else `waiting` (R14).
const ACTIVE_WINDOW: Duration = Duration::from_millis(1000);
const MAX_COUNT: u64 = 9_007_199_254_740_991;
pub const REST_POSE_UNKNOWN: &str = "Character rest pose unknown";
pub const RIG_NOT_SUPPORTED: &str = "Character rig not supported";
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}
/// One VMC sender entity of the scene, as the guard reads it.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedSender {
    pub id: String,
    pub settings: VmcSenderSettings,
}
/// One enabled VMC receiver of the scene, as the guard reads it.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedReceiver {
    pub name: String,
    pub bind_address: IpAddr,
    pub port: u16,
}
fn is_local(address: IpAddr, receiver: &PlannedReceiver, local_addresses: &[IpAddr]) -> bool {
    let address = address.to_canonical();
    address.is_loopback()
        || address == receiver.bind_address.to_canonical()
        || local_addresses.iter().any(|a| a.to_canonical() == address)
}
/// The loop guard (R11). For each enabled sender whose port equals the port of an enabled VMC
/// receiver and whose address is a local address of this computer, the name of the first such
/// receiver. It ignores the receiver sender filter on purpose, so it can stop more than a real loop.
pub fn sender_conflicts(
    senders: &[PlannedSender],
    receivers: &[PlannedReceiver],
    local_addresses: &[IpAddr],
) -> BTreeMap<String, String> {
    senders
        .iter()
        .filter(|s| s.settings.enabled)
        .filter_map(|s| {
            let address = s.settings.address.parse::<IpAddr>().ok()?;
            receivers
                .iter()
                .find(|r| r.port == s.settings.port && is_local(address, r, local_addresses))
                .map(|r| (s.id.clone(), r.name.clone()))
        })
        .collect()
}
/// The senders and the enabled VMC receivers of a scene, in scene order.
pub fn plan(scene: &SceneView) -> (Vec<PlannedSender>, Vec<PlannedReceiver>) {
    let senders = scene
        .entities
        .iter()
        .filter_map(|e| match e {
            SceneEntity::VmcSender { id, vmc_sender, .. } => Some(PlannedSender {
                id: id.clone(),
                settings: vmc_sender.clone(),
            }),
            _ => None,
        })
        .take(MAX_VMC_SENDERS)
        .collect();
    let receivers = scene
        .entities
        .iter()
        .filter_map(|e| match e {
            SceneEntity::Tracking {
                name,
                config:
                    TrackingConfig::Vmc {
                        enabled: true,
                        bind_address,
                        port,
                        ..
                    },
                ..
            } => bind_address
                .parse::<IpAddr>()
                .ok()
                .map(|bind_address| PlannedReceiver {
                    name: name.clone(),
                    bind_address,
                    port: *port,
                }),
            _ => None,
        })
        .collect();
    (senders, receivers)
}
/// The character error of a sender (R14): the record of its avatar has no rig, or a rig that the
/// sender cannot send. None when the sender has no character or the character has no model.
pub fn character_error(
    scene: &SceneView,
    avatar_id: Option<&str>,
    records: &[AssetRecord],
) -> Option<&'static str> {
    let asset = scene.entities.iter().find_map(|e| match e {
        SceneEntity::Avatar { id, asset_id, .. } if Some(id.as_str()) == avatar_id => {
            asset_id.as_deref()
        }
        _ => None,
    })?;
    let record = records.iter().find(|r| r.id == asset)?;
    match &record.rig {
        None => Some(REST_POSE_UNKNOWN),
        Some(rig) if !rig.identity_rest => Some(RIG_NOT_SUPPORTED),
        Some(_) => None,
    }
}
struct Sender {
    settings: VmcSenderSettings,
    socket: Option<UdpSocket>,
    target: Option<SocketAddr>,
    error: Option<String>,
    started: Instant,
    last_sent: Option<Instant>,
    datagrams: u64,
    errors: u64,
}
impl Sender {
    fn open(settings: VmcSenderSettings, error: Option<String>, now: Instant) -> Self {
        let mut sender = Self {
            target: None,
            socket: None,
            error,
            started: now,
            last_sent: None,
            datagrams: 0,
            errors: 0,
            settings,
        };
        if !sender.settings.enabled || sender.error.is_some() {
            return sender;
        }
        let Ok(address) = sender.settings.address.parse::<IpAddr>() else {
            sender.error = Some("Invalid address".into());
            return sender;
        };
        let address = address.to_canonical();
        let bind: SocketAddr = match address {
            IpAddr::V4(_) => (Ipv4Addr::UNSPECIFIED, 0).into(),
            IpAddr::V6(_) => (Ipv6Addr::UNSPECIFIED, 0).into(),
        };
        match UdpSocket::bind(bind).and_then(|s| s.set_nonblocking(true).map(|_| s)) {
            Ok(socket) => {
                sender.socket = Some(socket);
                sender.target = Some(SocketAddr::new(address, sender.settings.port));
            }
            Err(e) => sender.error = Some(e.to_string()),
        }
        sender
    }
    fn status(&self, id: &str, now: Instant) -> VmcSenderStatus {
        let state = if !self.settings.enabled {
            VmcSenderState::Stopped
        } else if self.error.is_some() {
            VmcSenderState::Error
        } else if self
            .last_sent
            .is_some_and(|t| now.saturating_duration_since(t) < ACTIVE_WINDOW)
        {
            VmcSenderState::Sending
        } else {
            VmcSenderState::Waiting
        };
        VmcSenderStatus {
            entity_id: id.into(),
            state,
            datagrams: self.datagrams,
            errors: self.errors,
            error: self.error.clone(),
        }
    }
}
#[derive(Default)]
struct State {
    revision: Option<u64>,
    // Scene order, at most `MAX_VMC_SENDERS`.
    senders: Vec<(String, Sender)>,
}
#[derive(Default)]
pub struct VmcSenderManager {
    state: Mutex<State>,
}
impl VmcSenderManager {
    pub fn new() -> Self {
        Self::default()
    }
    /// Whether `reconcile` would read this scene: only a newer revision changes the senders.
    pub fn is_new_revision(&self, scene: &SceneView) -> bool {
        lock(&self.state)
            .revision
            .is_none_or(|r| scene.revision > r)
    }
    /// Reads the senders of an accepted revision (R10). A sender that keeps its settings and its
    /// error keeps its socket and counters; any other change opens it again.
    pub fn reconcile(
        &self,
        scene: &SceneView,
        records: &[AssetRecord],
        local_addresses: impl FnOnce() -> Vec<IpAddr>,
    ) {
        self.reconcile_at(scene, records, local_addresses, Instant::now());
    }
    pub fn reconcile_at(
        &self,
        scene: &SceneView,
        records: &[AssetRecord],
        local_addresses: impl FnOnce() -> Vec<IpAddr>,
        now: Instant,
    ) {
        let mut state = lock(&self.state);
        if state.revision.is_some_and(|r| scene.revision <= r) {
            return;
        }
        state.revision = Some(scene.revision);
        let (senders, receivers) = plan(scene);
        let guarded = senders
            .iter()
            .any(|s| s.settings.enabled && receivers.iter().any(|r| r.port == s.settings.port));
        let conflicts = if guarded {
            sender_conflicts(&senders, &receivers, &local_addresses())
        } else {
            BTreeMap::new()
        };
        let mut previous: BTreeMap<String, Sender> =
            std::mem::take(&mut state.senders).into_iter().collect();
        state.senders = senders
            .into_iter()
            .map(|planned| {
                let error = planned.settings.enabled.then(|| {
                    conflicts
                        .get(&planned.id)
                        .map(|name| format!("Endpoint used by {name}"))
                        .or_else(|| {
                            character_error(scene, planned.settings.avatar_id.as_deref(), records)
                                .map(String::from)
                        })
                });
                let error = error.flatten();
                let sender = match previous.remove(&planned.id) {
                    Some(old) if old.settings == planned.settings && old.error == error => old,
                    _ => Sender::open(planned.settings, error, now),
                };
                (planned.id, sender)
            })
            .collect();
    }
    /// Sends the poses of one `vmcPoses` envelope (R9, R13). A pose for a sender that is not
    /// enabled, has an error, or sent a pose less than 15 ms ago is dropped.
    pub fn submit(&self, poses: &[VmcSendPose]) {
        self.submit_at(poses, Instant::now());
    }
    pub fn submit_at(&self, poses: &[VmcSendPose], now: Instant) {
        let mut state = lock(&self.state);
        for pose in poses {
            let Some((_, sender)) = state
                .senders
                .iter_mut()
                .find(|(id, _)| *id == pose.sender_id)
            else {
                continue;
            };
            let (Some(socket), Some(target)) = (&sender.socket, sender.target) else {
                continue;
            };
            if !sender.settings.enabled || sender.error.is_some() {
                continue;
            }
            if sender
                .last_sent
                .is_some_and(|t| now.saturating_duration_since(t) < MIN_POSE_INTERVAL)
            {
                continue;
            }
            let seconds = now.saturating_duration_since(sender.started).as_secs_f32();
            for datagram in encode_vmc_pose(pose, seconds) {
                match socket.send_to(&datagram, target) {
                    Ok(_) => sender.datagrams = (sender.datagrams + 1).min(MAX_COUNT),
                    Err(_) => sender.errors = (sender.errors + 1).min(MAX_COUNT),
                }
            }
            sender.last_sent = Some(now);
        }
    }
    /// The status of each sender in scene order (R14). Empty before the first scene.
    pub fn statuses(&self) -> Vec<VmcSenderStatus> {
        self.statuses_at(Instant::now())
    }
    pub fn statuses_at(&self, now: Instant) -> Vec<VmcSenderStatus> {
        lock(&self.state)
            .senders
            .iter()
            .map(|(id, sender)| sender.status(id, now))
            .collect()
    }
    /// Closes each socket. A later scene opens them again.
    pub fn stop(&self) {
        let mut state = lock(&self.state);
        state.senders.clear();
        state.revision = None;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn sender(id: &str, address: &str, port: u16) -> PlannedSender {
        PlannedSender {
            id: id.into(),
            settings: VmcSenderSettings {
                enabled: true,
                address: address.into(),
                port,
                avatar_id: None,
            },
        }
    }
    fn receiver(name: &str, bind: &str, port: u16) -> PlannedReceiver {
        PlannedReceiver {
            name: name.into(),
            bind_address: bind.parse().unwrap(),
            port,
        }
    }
    #[test]
    fn loop_guard_stops_local_targets_on_a_receiver_port() {
        let receivers = [receiver("VMC Receiver", "127.0.0.1", 39539)];
        let local: Vec<IpAddr> = vec!["192.168.1.20".parse().unwrap()];
        let senders = [
            sender("loopback", "127.0.0.1", 39539),
            sender("loopback_range", "127.4.5.6", 39539),
            sender("ipv6_loopback", "::1", 39539),
            sender("lan_self", "192.168.1.20", 39539),
            sender("mapped_self", "::ffff:192.168.1.20", 39539),
            sender("other_port", "127.0.0.1", 39540),
            sender("other_host", "192.168.1.21", 39539),
        ];
        let conflicts = sender_conflicts(&senders, &receivers, &local);
        assert_eq!(
            conflicts.keys().map(String::as_str).collect::<Vec<_>>(),
            [
                "ipv6_loopback",
                "lan_self",
                "loopback",
                "loopback_range",
                "mapped_self"
            ]
        );
        assert!(conflicts.values().all(|name| name == "VMC Receiver"));
    }
    #[test]
    fn loop_guard_uses_the_receiver_bind_address_and_skips_disabled_senders() {
        let receivers = [receiver("Studio", "10.0.0.5", 40000)];
        let mut disabled = sender("off", "10.0.0.5", 40000);
        disabled.settings.enabled = false;
        let senders = [sender("bound", "10.0.0.5", 40000), disabled];
        let conflicts = sender_conflicts(&senders, &receivers, &[]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts["bound"], "Studio");
        assert!(sender_conflicts(&senders, &[], &[]).is_empty());
    }
}
