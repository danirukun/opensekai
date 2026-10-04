mod parser;
use opensekai_contracts::*;
use parser::Decoder;
use std::{
    collections::BTreeMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex, MutexGuard},
    time::Instant,
};
use tokio::{
    sync::{watch, Mutex as AsyncMutex},
    task::JoinHandle,
};
pub const IFACIAL_HANDSHAKE: &[u8] =
    b"iFacialMocap_sahuasouryya9218sauhuiayeta91555dy3719|sendDataVersion=v2";
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}
#[derive(Default)]
struct Inputs {
    samples: BTreeMap<String, TrackingSample>,
    statuses: BTreeMap<String, TrackingStatus>,
}
struct Receiver {
    generation: u64,
    config: TrackingConfig,
    stop: watch::Sender<bool>,
    task: Option<JoinHandle<()>>,
}
#[derive(Default)]
struct Lifecycle {
    revision: Option<u64>,
    receivers: BTreeMap<String, Receiver>,
    stopped: bool,
}
pub struct TrackingManager {
    clock: Instant,
    inputs: Arc<Mutex<Inputs>>,
    lifecycle: AsyncMutex<Lifecycle>,
}
impl TrackingManager {
    pub fn new(clock: Instant) -> Self {
        Self {
            clock,
            inputs: Arc::new(Mutex::new(Inputs::default())),
            lifecycle: AsyncMutex::new(Lifecycle::default()),
        }
    }
    pub fn snapshot(&self) -> TrackingUpdate {
        let inputs = lock(&self.inputs);
        let now = self.clock.elapsed().as_secs_f64() * 1000.;
        TrackingUpdate {
            samples: inputs.samples.values().cloned().collect(),
            statuses: inputs
                .statuses
                .values()
                .cloned()
                .map(|mut s| {
                    if s.state == TrackingState::Receiving
                        && s.last_received_at_ms.is_some_and(|t| now - t > 500.)
                    {
                        s.state = TrackingState::Stale;
                    }
                    s
                })
                .collect(),
        }
    }
    pub async fn reconcile(&self, scene: &SceneView) {
        let mut life = self.lifecycle.lock().await;
        if life.stopped || life.revision.is_some_and(|r| scene.revision < r) {
            return;
        }
        life.revision = Some(scene.revision);
        let desired: BTreeMap<_, _> = scene
            .entities
            .iter()
            .filter_map(|e| {
                if let SceneEntity::Tracking {
                    id,
                    generation,
                    config,
                    ..
                } = e
                {
                    if !matches!(config, TrackingConfig::Mediapipe { .. }) {
                        Some((id.clone(), (*generation, config.clone())))
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
            .take(4)
            .collect();
        let removed: Vec<_> = life
            .receivers
            .iter()
            .filter(|(id, r)| {
                desired
                    .get(*id)
                    .is_none_or(|(g, c)| *g != r.generation || *c != r.config)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in removed {
            if let Some(mut r) = life.receivers.remove(&id) {
                r.stop.send_replace(true);
                if let Some(task) = r.task.take() {
                    let _ = task.await;
                }
            }
            let mut inputs = lock(&self.inputs);
            inputs.samples.remove(&id);
            inputs.statuses.remove(&id);
        }
        for (id, (generation, config)) in desired {
            if life.receivers.contains_key(&id) {
                continue;
            }
            let enabled = match &config {
                TrackingConfig::Vmc { enabled, .. }
                | TrackingConfig::IFacialMocap { enabled, .. } => *enabled,
                _ => false,
            };
            let (stop, shutdown) = watch::channel(false);
            lock(&self.inputs).statuses.insert(
                id.clone(),
                TrackingStatus {
                    source_id: id.clone(),
                    generation,
                    state: if enabled {
                        TrackingState::Waiting
                    } else {
                        TrackingState::Stopped
                    },
                    packets: 0,
                    invalid_packets: 0,
                    inference_ms: None,
                    last_received_at_ms: None,
                    error: None,
                },
            );
            let task = if enabled {
                let endpoint = match &config {
                    TrackingConfig::Vmc {
                        bind_address, port, ..
                    }
                    | TrackingConfig::IFacialMocap {
                        bind_address, port, ..
                    } => bind_address
                        .parse::<IpAddr>()
                        .ok()
                        .map(|ip| SocketAddr::new(ip, *port)),
                    _ => None,
                };
                match endpoint {
                    Some(endpoint) => match tokio::net::UdpSocket::bind(endpoint).await {
                        Ok(socket) => {
                            let filter = match &config {
                                TrackingConfig::Vmc { sender_address, .. } => sender_address,
                                TrackingConfig::IFacialMocap { phone_address, .. } => phone_address,
                                _ => unreachable!(),
                            }
                            .as_ref()
                            .and_then(|s| s.parse::<IpAddr>().ok());
                            let ifacial = matches!(config, TrackingConfig::IFacialMocap { .. });
                            if let Some(phone) = filter.filter(|_| ifacial) {
                                if socket
                                    .send_to(IFACIAL_HANDSHAKE, SocketAddr::new(phone, 49983))
                                    .await
                                    .is_err()
                                {
                                    self.set_error(&id, generation, "Cannot send phone handshake");
                                    None
                                } else {
                                    Some(tokio::spawn(receive(
                                        socket,
                                        id.clone(),
                                        generation,
                                        ifacial,
                                        filter,
                                        self.clock,
                                        self.inputs.clone(),
                                        shutdown,
                                    )))
                                }
                            } else {
                                Some(tokio::spawn(receive(
                                    socket,
                                    id.clone(),
                                    generation,
                                    ifacial,
                                    filter,
                                    self.clock,
                                    self.inputs.clone(),
                                    shutdown,
                                )))
                            }
                        }
                        Err(_) => {
                            self.set_error(&id, generation, "Cannot bind receiver endpoint");
                            None
                        }
                    },
                    None => {
                        self.set_error(&id, generation, "Invalid receiver endpoint");
                        None
                    }
                }
            } else {
                None
            };
            life.receivers.insert(
                id,
                Receiver {
                    generation,
                    config,
                    stop,
                    task,
                },
            );
        }
    }
    fn set_error(&self, id: &str, generation: u64, message: &str) {
        let mut inputs = lock(&self.inputs);
        if let Some(s) = inputs
            .statuses
            .get_mut(id)
            .filter(|s| s.generation == generation)
        {
            s.state = TrackingState::Error;
            s.error = Some(message.into());
        }
    }
    pub async fn shutdown(&self) {
        let mut life = self.lifecycle.lock().await;
        life.stopped = true;
        for (_, mut r) in std::mem::take(&mut life.receivers) {
            r.stop.send_replace(true);
            if let Some(task) = r.task.take() {
                let _ = task.await;
            }
        }
        let mut inputs = lock(&self.inputs);
        inputs.samples.clear();
        inputs.statuses.clear();
    }
}
impl Drop for TrackingManager {
    fn drop(&mut self) {
        for r in self.lifecycle.get_mut().receivers.values_mut() {
            r.stop.send_replace(true);
            if let Some(task) = r.task.take() {
                task.abort();
            }
        }
    }
}
#[allow(clippy::too_many_arguments)]
async fn receive(
    socket: tokio::net::UdpSocket,
    id: String,
    generation: u64,
    ifacial: bool,
    filter: Option<IpAddr>,
    clock: Instant,
    inputs: Arc<Mutex<Inputs>>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut buffer = [0u8; 8193];
    let mut decoder = Decoder::default();
    loop {
        let received =
            tokio::select! {biased;_=shutdown.changed()=>break,r=socket.recv_from(&mut buffer)=>r};
        let (size, sender) = match received {
            Ok(value) => value,
            Err(_) => {
                let mut input = lock(&inputs);
                if let Some(s) = input
                    .statuses
                    .get_mut(&id)
                    .filter(|s| s.generation == generation)
                {
                    s.state = TrackingState::Error;
                    s.error = Some("Receiver socket failed".into());
                }
                break;
            }
        };
        if filter.is_some_and(|ip| ip != sender.ip()) {
            continue;
        }
        let parsed = if size > 8192 {
            Err(invalid("Oversized datagram"))
        } else if ifacial {
            decoder.ifacial(&buffer[..size])
        } else {
            decoder.vmc(&buffer[..size])
        };
        let mut input = lock(&inputs);
        let Some(status) = input
            .statuses
            .get_mut(&id)
            .filter(|s| s.generation == generation)
        else {
            break;
        };
        status.packets = status.packets.saturating_add(1).min(9_007_199_254_740_991);
        match parsed {
            Ok(true) => {
                let now = clock.elapsed().as_secs_f64() * 1000.;
                status.state = TrackingState::Receiving;
                status.last_received_at_ms = Some(now);
                status.error = None;
                input.samples.insert(
                    id.clone(),
                    TrackingSample {
                        source_id: id.clone(),
                        generation,
                        received_at_ms: now,
                        bones: decoder.bones.clone(),
                        expressions: decoder.expressions.clone(),
                        root: decoder.root.clone(),
                    },
                );
            }
            Ok(false) => {}
            Err(_) => {
                status.invalid_packets = status
                    .invalid_packets
                    .saturating_add(1)
                    .min(9_007_199_254_740_991)
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    fn scene(port: u16, generation: u64, enabled: bool) -> SceneView {
        SceneView {
            schema_version: 1,
            scene_id: "s".into(),
            revision: generation,
            outputs: vec![],
            entities: vec![SceneEntity::Tracking {
                smoothing: None,
                id: "source".into(),
                name: "Face".into(),
                visible: true,
                transform: Transform {
                    position: [0.; 3],
                    rotation: [0., 0., 0., 1.],
                    scale: [1.; 3],
                },
                generation,
                config: TrackingConfig::IFacialMocap {
                    enabled,
                    bind_address: "127.0.0.1".into(),
                    port,
                    phone_address: None,
                },
            }],
        }
    }
    // Real UDP boundary verifies socket ownership, status and generation across Stop/rebind.
    #[tokio::test]
    async fn receiver_udp_stop_rebind_and_generation() {
        let probe = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        let manager = TrackingManager::new(Instant::now());
        manager.reconcile(&scene(port, 1, true)).await;
        let sender = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        sender
            .send_to(b"jawOpen&50|", ("127.0.0.1", port))
            .await
            .unwrap();
        let mut update = manager.snapshot();
        for _ in 0..20 {
            if !update.samples.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
            update = manager.snapshot();
        }
        assert_eq!(update.samples.len(), 1);
        assert_eq!(update.samples[0].generation, 1);
        assert_eq!(update.statuses[0].state, TrackingState::Receiving);
        manager.reconcile(&scene(port, 2, false)).await;
        let stopped = manager.snapshot();
        assert!(stopped.samples.is_empty());
        assert_eq!(stopped.statuses[0].state, TrackingState::Stopped);
        assert_eq!(stopped.statuses[0].generation, 2);
        manager.reconcile(&scene(port, 3, true)).await;
        assert!(manager.snapshot().samples.is_empty());
        manager.reconcile(&scene(port, 1, true)).await;
        assert_eq!(manager.snapshot().statuses[0].generation, 3);
        manager.shutdown().await;
        assert!(std::net::UdpSocket::bind(("127.0.0.1", port)).is_ok());
    }
    #[tokio::test]
    async fn receiver_bind_error_is_not_waiting() {
        let occupied = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let manager = TrackingManager::new(Instant::now());
        manager
            .reconcile(&scene(occupied.local_addr().unwrap().port(), 1, true))
            .await;
        assert_eq!(manager.snapshot().statuses[0].state, TrackingState::Error);
        manager.shutdown().await;
    }
}
#[cfg(test)]
mod status_tests {
    use super::*;
    use std::time::Duration;
    #[test]
    fn snapshot_marks_stale_without_replacing_errors() {
        let manager = TrackingManager::new(Instant::now() - Duration::from_millis(600));
        for (id, state) in [
            ("stale", TrackingState::Receiving),
            ("error", TrackingState::Error),
        ] {
            lock(&manager.inputs).statuses.insert(
                id.into(),
                TrackingStatus {
                    source_id: id.into(),
                    generation: 1,
                    state,
                    packets: 1,
                    invalid_packets: 0,
                    inference_ms: None,
                    last_received_at_ms: Some(0.),
                    error: if id == "error" {
                        Some("Cannot bind receiver endpoint".into())
                    } else {
                        None
                    },
                },
            );
        }
        let update = manager.snapshot();
        assert_eq!(update.statuses[0].state, TrackingState::Error);
        assert_eq!(update.statuses[1].state, TrackingState::Stale);
    }
    #[tokio::test]
    async fn receiver_filters_sender_before_parsing_invalid_packets() {
        let probe = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        let manager = TrackingManager::new(Instant::now());
        let scene = SceneView {
            schema_version: 1,
            scene_id: "s".into(),
            revision: 1,
            outputs: vec![],
            entities: vec![SceneEntity::Tracking {
                smoothing: None,
                id: "filtered".into(),
                name: "Filtered".into(),
                visible: true,
                transform: Transform {
                    position: [0.; 3],
                    rotation: [0., 0., 0., 1.],
                    scale: [1.; 3],
                },
                generation: 1,
                config: TrackingConfig::Vmc {
                    enabled: true,
                    bind_address: "127.0.0.1".into(),
                    port,
                    sender_address: Some("127.0.0.2".into()),
                },
            }],
        };
        manager.reconcile(&scene).await;
        let sender = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        for _ in 0..5 {
            sender
                .send_to(b"invalid", ("127.0.0.1", port))
                .await
                .unwrap();
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
        let status = &manager.snapshot().statuses[0];
        assert_eq!(status.packets, 0);
        assert_eq!(status.invalid_packets, 0);
        assert_eq!(status.state, TrackingState::Waiting);
        manager.shutdown().await;
    }
}
