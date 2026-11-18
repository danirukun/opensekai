mod endpoints;
pub mod facekit;
pub mod osc_out;
mod parser;
use endpoints::{endpoint_routes, Endpoint, RouteSource, SourceKind};
use facekit::{adapter::*, FaceKitManager};
use opensekai_contracts::*;
use parser::Decoder;
use std::{
    collections::BTreeMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};
use tokio::{
    sync::{watch, Mutex as AsyncMutex},
    task::JoinHandle,
};
pub const IFACIAL_HANDSHAKE: &[u8] =
    b"iFacialMocap_sahuasouryya9218sauhuiayeta91555dy3719|sendDataVersion=v2";
pub const IFACIAL_PHONE_PORT: u16 = 49983;
const HANDSHAKE_RETRY: Duration = Duration::from_millis(2000);
const HANDSHAKE_QUIET: Duration = Duration::from_millis(500);
const MAX_COUNT: u64 = 9_007_199_254_740_991;
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}
/// `receiving` becomes `stale` when the last sample is older than 500 ms. The sample stays.
fn aged(mut s: TrackingStatus, now_ms: f64) -> TrackingStatus {
    if s.state == TrackingState::Receiving
        && s.last_received_at_ms.is_some_and(|t| now_ms - t > 500.)
    {
        s.state = TrackingState::Stale;
    }
    s
}
/// The next time the handshake is due after a send (R6): 2000 ms after the last send, and
/// 500 ms after the last received packet. `None` before the first send (due at once).
fn next_handshake(last_sent: Option<Instant>, last_packet: Option<Instant>) -> Option<Instant> {
    let sent = last_sent?;
    Some((sent + HANDSHAKE_RETRY).max(last_packet.map_or(sent, |p| p + HANDSHAKE_QUIET)))
}
fn handshake_due(now: Instant, last_sent: Option<Instant>, last_packet: Option<Instant>) -> bool {
    next_handshake(last_sent, last_packet).is_none_or(|due| now >= due)
}
#[derive(Default)]
struct Inputs {
    samples: BTreeMap<String, TrackingSample>,
    statuses: BTreeMap<String, TrackingStatus>,
}
impl Inputs {
    fn status(&mut self, id: &str, generation: u64) -> Option<&mut TrackingStatus> {
        self.statuses
            .get_mut(id)
            .filter(|s| s.generation == generation)
    }
}
struct Source {
    generation: u64,
    config: TrackingConfig,
}
#[derive(Debug, Clone, PartialEq)]
struct Route {
    id: String,
    generation: u64,
    address: Option<IpAddr>,
}
struct Socket {
    routes: watch::Sender<Vec<Route>>,
    stop: watch::Sender<bool>,
    task: Option<JoinHandle<()>>,
}
impl Socket {
    async fn close(mut self) {
        self.stop.send_replace(true);
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}
/// The latest work for the FaceKit worker. A newer value replaces one the worker did not take.
#[derive(Clone)]
enum FaceWork {
    Idle,
    /// The FaceKit sources of one accepted revision.
    Scene(SceneView),
    Stop,
}
/// The FaceKit worker task. It applies the FaceKit part of each revision in order, so the
/// publisher frame loop never waits for a camera to start or stop.
struct FaceWorker {
    work: watch::Sender<FaceWork>,
    task: JoinHandle<()>,
}
#[derive(Default)]
struct Lifecycle {
    revision: Option<u64>,
    sources: BTreeMap<String, Source>,
    endpoints: BTreeMap<Endpoint, Socket>,
    face_worker: Option<FaceWorker>,
    stopped: bool,
}
pub struct TrackingManager {
    clock: Instant,
    inputs: Arc<Mutex<Inputs>>,
    lifecycle: AsyncMutex<Lifecycle>,
    /// Behind an `Arc`: its reconcile and shutdown run on the blocking pool (a run's drop waits for
    /// the camera to stop), never on a tokio worker thread.
    facekit: Arc<FaceKitManager>,
}
async fn facekit_blocking(
    facekit: &Arc<FaceKitManager>,
    work: impl FnOnce(&FaceKitManager) + Send + 'static,
) {
    let facekit = facekit.clone();
    if let Err(error) = tokio::task::spawn_blocking(move || work(&facekit)).await {
        eprintln!("OpenSekai FaceKit task failed: {error}");
    }
}
/// Takes only the latest scene: a scene that a newer one replaced is skipped. One reconcile runs
/// at a time, so the old camera stops before the next one opens.
async fn face_worker(facekit: Arc<FaceKitManager>, mut work: watch::Receiver<FaceWork>) {
    while work.changed().await.is_ok() {
        let next = work.borrow_and_update().clone();
        match next {
            FaceWork::Idle => {}
            FaceWork::Scene(scene) => {
                facekit_blocking(&facekit, move |f| f.reconcile(&scene)).await
            }
            FaceWork::Stop => return,
        }
    }
    // The tracking manager was dropped without a shutdown.
    facekit_blocking(&facekit, FaceKitManager::shutdown).await;
}
fn route_source(id: &str, name: &str, config: &TrackingConfig) -> Option<Result<RouteSource, ()>> {
    let (kind, enabled, bind_address, port, address) = match config {
        TrackingConfig::Vmc {
            enabled,
            bind_address,
            port,
            sender_address,
            ..
        } => (SourceKind::Vmc, enabled, bind_address, port, sender_address),
        TrackingConfig::IFacialMocap {
            enabled,
            bind_address,
            port,
            phone_address,
        } => (
            SourceKind::IFacialMocap,
            enabled,
            bind_address,
            port,
            phone_address,
        ),
        TrackingConfig::OpenSeeFace {
            enabled,
            bind_address,
            port,
            sender_address,
        } => (
            SourceKind::OpenSeeFace,
            enabled,
            bind_address,
            port,
            sender_address,
        ),
        TrackingConfig::Mediapipe { .. } | TrackingConfig::FaceKit { .. } => return None,
    };
    if !enabled {
        return None;
    }
    Some(
        bind_address
            .parse::<IpAddr>()
            .map(|bind_address| RouteSource {
                id: id.into(),
                name: name.into(),
                kind,
                bind_address,
                port: *port,
                address: address
                    .as_ref()
                    .and_then(|a| a.parse::<IpAddr>().ok())
                    .map(|a| a.to_canonical()),
            })
            .map_err(|_| ()),
    )
}
impl TrackingManager {
    pub fn new(clock: Instant) -> Self {
        Self::with_face_adapter(clock, facekit::platform_adapter())
    }
    pub fn with_face_adapter(clock: Instant, adapter: Arc<dyn FaceAdapter>) -> Self {
        Self {
            clock,
            inputs: Arc::new(Mutex::new(Inputs::default())),
            lifecycle: AsyncMutex::new(Lifecycle::default()),
            facekit: Arc::new(FaceKitManager::new(clock, adapter)),
        }
    }
    pub fn face_cameras(&self) -> Vec<CameraInfo> {
        self.facekit.cameras()
    }
    pub fn snapshot(&self) -> TrackingUpdate {
        let now = self.clock.elapsed().as_secs_f64() * 1000.;
        let mut update = {
            let inputs = lock(&self.inputs);
            TrackingUpdate {
                samples: inputs.samples.values().cloned().collect(),
                statuses: inputs
                    .statuses
                    .values()
                    .map(|s| aged(s.clone(), now))
                    .collect(),
            }
        };
        let face = self.facekit.snapshot(now);
        update.samples.extend(face.samples);
        update.statuses.extend(face.statuses);
        update
    }
    /// Reconciles the receivers from the endpoint plan (R8-R10) once for each accepted revision,
    /// so a failed bind retries on the next revision and not on each frame. A source that keeps
    /// its generation and config keeps its socket, decoder, counters, sample, and handshake retry.
    pub async fn reconcile(&self, scene: &SceneView) {
        let mut life = self.lifecycle.lock().await;
        if life.stopped || life.revision.is_some_and(|r| scene.revision <= r) {
            return;
        }
        life.revision = Some(scene.revision);
        let faces = SceneView {
            schema_version: scene.schema_version,
            scene_id: scene.scene_id.clone(),
            revision: scene.revision,
            outputs: vec![],
            entities: scene
                .entities
                .iter()
                .filter(|e| {
                    matches!(
                        e,
                        SceneEntity::Tracking {
                            config: TrackingConfig::FaceKit { .. },
                            ..
                        }
                    )
                })
                .cloned()
                .collect(),
        };
        let facekit = self.facekit.clone();
        life.face_worker
            .get_or_insert_with(|| {
                let (work, receiver) = watch::channel(FaceWork::Idle);
                let task = tokio::spawn(face_worker(facekit, receiver));
                FaceWorker { work, task }
            })
            .work
            .send_replace(FaceWork::Scene(faces));
        let desired: Vec<_> = scene
            .entities
            .iter()
            .filter_map(|e| match e {
                SceneEntity::Tracking {
                    id,
                    name,
                    generation,
                    config,
                    ..
                } if !matches!(
                    config,
                    TrackingConfig::Mediapipe { .. } | TrackingConfig::FaceKit { .. }
                ) =>
                {
                    Some((id.clone(), name.clone(), *generation, config.clone()))
                }
                _ => None,
            })
            .take(4)
            .collect();
        let removed: Vec<String> = life
            .sources
            .iter()
            .filter(|(id, s)| {
                desired
                    .iter()
                    .find(|(d, ..)| d == *id)
                    .is_none_or(|(_, _, g, c)| *g != s.generation || *c != s.config)
            })
            .map(|(id, _)| id.clone())
            .collect();
        {
            let mut inputs = lock(&self.inputs);
            for id in &removed {
                life.sources.remove(id);
                inputs.samples.remove(id);
                inputs.statuses.remove(id);
            }
            for (id, _, generation, config) in &desired {
                if life.sources.contains_key(id) {
                    continue;
                }
                let enabled = route_source(id, "", config).is_some();
                inputs.statuses.insert(
                    id.clone(),
                    TrackingStatus {
                        source_id: id.clone(),
                        generation: *generation,
                        state: if enabled {
                            TrackingState::Waiting
                        } else {
                            TrackingState::Stopped
                        },
                        packets: 0,
                        invalid_packets: 0,
                        inference_ms: None,
                        unmatched_packets: None,
                        last_received_at_ms: None,
                        error: None,
                    },
                );
                life.sources.insert(
                    id.clone(),
                    Source {
                        generation: *generation,
                        config: config.clone(),
                    },
                );
            }
        }
        let finished: Vec<Endpoint> = life
            .endpoints
            .iter()
            .filter(|(_, s)| s.task.as_ref().is_none_or(|t| t.is_finished()))
            .map(|(e, _)| *e)
            .collect();
        for endpoint in finished {
            if let Some(socket) = life.endpoints.remove(&endpoint) {
                socket.close().await;
            }
        }
        let mut sources = vec![];
        for (id, name, generation, config) in &desired {
            match route_source(id, name, config) {
                Some(Ok(source)) => sources.push(source),
                Some(Err(())) => self.fail(id, *generation, "Invalid receiver endpoint"),
                None => {}
            }
        }
        let order = |id: &str| sources.iter().position(|s| s.id == id);
        let mut holders: Vec<(Endpoint, Vec<String>)> = life
            .endpoints
            .iter()
            .map(|(e, s)| {
                (
                    *e,
                    s.routes
                        .borrow()
                        .iter()
                        .filter(|r| {
                            life.sources
                                .get(&r.id)
                                .is_some_and(|s| s.generation == r.generation)
                        })
                        .map(|r| r.id.clone())
                        .collect(),
                )
            })
            .collect();
        holders.sort_by_key(|(_, ids)| ids.iter().filter_map(|id| order(id)).min());
        let plan = endpoint_routes(&sources, &holders);
        let planned: BTreeMap<Endpoint, Vec<Route>> = plan
            .endpoints
            .into_iter()
            .map(|(endpoint, members)| {
                let routes = members
                    .into_iter()
                    .filter_map(|(id, address)| {
                        life.sources.get(&id).map(|s| Route {
                            generation: s.generation,
                            id,
                            address,
                        })
                    })
                    .collect();
                (endpoint, routes)
            })
            .collect();
        let closed: Vec<Endpoint> = life
            .endpoints
            .keys()
            .filter(|e| !planned.contains_key(e))
            .copied()
            .collect();
        for endpoint in closed {
            if let Some(socket) = life.endpoints.remove(&endpoint) {
                socket.close().await;
            }
        }
        for (endpoint, routes) in planned {
            if let Some(socket) = life.endpoints.get(&endpoint) {
                socket.routes.send_if_modified(|current| {
                    let changed = *current != routes;
                    *current = routes.clone();
                    changed
                });
            } else {
                match tokio::net::UdpSocket::bind(SocketAddr::new(
                    endpoint.bind_address,
                    endpoint.port,
                ))
                .await
                {
                    Ok(udp) => {
                        let (stop, shutdown) = watch::channel(false);
                        let (routes_tx, routes_rx) = watch::channel(routes.clone());
                        let task = tokio::spawn(serve(
                            udp,
                            endpoint.kind,
                            routes_rx,
                            self.clock,
                            self.inputs.clone(),
                            shutdown,
                        ));
                        life.endpoints.insert(
                            endpoint,
                            Socket {
                                routes: routes_tx,
                                stop,
                                task: Some(task),
                            },
                        );
                    }
                    Err(_) => {
                        for route in &routes {
                            self.fail(&route.id, route.generation, "Cannot bind receiver endpoint");
                        }
                        continue;
                    }
                }
            }
            let mut inputs = lock(&self.inputs);
            for route in &routes {
                if let Some(status) = inputs
                    .status(&route.id, route.generation)
                    .filter(|s| s.state == TrackingState::Error)
                {
                    status.state = TrackingState::Waiting;
                    status.error = None;
                }
            }
        }
        for (id, winner) in plan.conflicts {
            if let Some(generation) = life.sources.get(&id).map(|s| s.generation) {
                self.fail(&id, generation, &format!("Endpoint used by {winner}"));
            }
        }
    }
    fn fail(&self, id: &str, generation: u64, message: &str) {
        let mut inputs = lock(&self.inputs);
        if let Some(s) = inputs.status(id, generation) {
            s.state = TrackingState::Error;
            s.error = Some(message.into());
            inputs.samples.remove(id);
        }
    }
    pub async fn shutdown(&self) {
        let mut life = self.lifecycle.lock().await;
        life.stopped = true;
        // The worker ends its current reconcile, and the shutdown then releases the camera.
        if let Some(worker) = life.face_worker.take() {
            worker.work.send_replace(FaceWork::Stop);
            if let Err(error) = worker.task.await {
                eprintln!("OpenSekai FaceKit worker failed: {error}");
            }
        }
        facekit_blocking(&self.facekit, FaceKitManager::shutdown).await;
        life.sources.clear();
        for (_, socket) in std::mem::take(&mut life.endpoints) {
            socket.close().await;
        }
        let mut inputs = lock(&self.inputs);
        inputs.samples.clear();
        inputs.statuses.clear();
    }
}
impl Drop for TrackingManager {
    fn drop(&mut self) {
        for socket in self.lifecycle.get_mut().endpoints.values_mut() {
            socket.stop.send_replace(true);
            if let Some(task) = socket.task.take() {
                task.abort();
            }
        }
    }
}
struct Phone {
    address: IpAddr,
    last_sent: Option<Instant>,
    last_packet: Option<Instant>,
}
fn count(n: u64) -> u64 {
    n.saturating_add(1).min(MAX_COUNT)
}
/// One endpoint socket. It routes each datagram by sender IP before parsing (R8) and sends
/// the iFacialMocap handshake of each phone route from this socket (R6).
async fn serve(
    socket: tokio::net::UdpSocket,
    kind: SourceKind,
    mut routes: watch::Receiver<Vec<Route>>,
    clock: Instant,
    inputs: Arc<Mutex<Inputs>>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut buffer = [0u8; 8193];
    let mut decoders: BTreeMap<String, (u64, Decoder)> = BTreeMap::new();
    let mut phones: BTreeMap<(String, u64), Phone> = BTreeMap::new();
    loop {
        let current = routes.borrow_and_update().clone();
        decoders.retain(|id, _| current.iter().any(|r| &r.id == id));
        if kind == SourceKind::IFacialMocap {
            phones.retain(|(id, generation), _| {
                current
                    .iter()
                    .any(|r| &r.id == id && r.generation == *generation && r.address.is_some())
            });
            for route in &current {
                if let Some(address) = route.address {
                    phones
                        .entry((route.id.clone(), route.generation))
                        .or_insert(Phone {
                            address,
                            last_sent: None,
                            last_packet: None,
                        });
                }
            }
            let now = Instant::now();
            for phone in phones.values_mut() {
                if handshake_due(now, phone.last_sent, phone.last_packet) {
                    // A send error is transient; the retry continues (R6).
                    let _ = socket
                        .send_to(
                            IFACIAL_HANDSHAKE,
                            SocketAddr::new(phone.address, IFACIAL_PHONE_PORT),
                        )
                        .await;
                    phone.last_sent = Some(now);
                }
            }
        }
        let wake = phones
            .values()
            .filter_map(|p| next_handshake(p.last_sent, p.last_packet))
            .min();
        let retry = async {
            match wake {
                Some(at) => tokio::time::sleep_until(at.into()).await,
                None => std::future::pending().await,
            }
        };
        let received = tokio::select! {
            biased;
            _ = shutdown.changed() => break,
            changed = routes.changed() => {
                if changed.is_err() {
                    break;
                }
                continue;
            }
            _ = retry => continue,
            r = socket.recv_from(&mut buffer) => r,
        };
        let (size, sender) = match received {
            Ok(value) => value,
            // Windows reports an ICMP port unreachable from a handshake as a reset.
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionRefused
                ) =>
            {
                continue
            }
            Err(_) => {
                let mut input = lock(&inputs);
                for route in &current {
                    if let Some(s) = input.status(&route.id, route.generation) {
                        s.state = TrackingState::Error;
                        s.error = Some("Receiver socket failed".into());
                    }
                }
                break;
            }
        };
        let ip = sender.ip().to_canonical();
        let route = current
            .iter()
            .find(|r| r.address == Some(ip))
            .or(match current.as_slice() {
                [only] if only.address.is_none() => Some(only),
                _ => None,
            });
        let Some(route) = route else {
            let mut input = lock(&inputs);
            for route in &current {
                if let Some(s) = input.status(&route.id, route.generation) {
                    s.unmatched_packets = Some(count(s.unmatched_packets.unwrap_or(0)));
                }
            }
            continue;
        };
        let decoder = decoders
            .entry(route.id.clone())
            .or_insert_with(|| (route.generation, Decoder::default()));
        if decoder.0 != route.generation {
            *decoder = (route.generation, Decoder::default());
        }
        let decoder = &mut decoder.1;
        let parsed = if size > 8192 {
            Err(invalid("Oversized datagram"))
        } else {
            match kind {
                SourceKind::Vmc => decoder.vmc(&buffer[..size]),
                SourceKind::IFacialMocap => decoder.ifacial(&buffer[..size]),
                SourceKind::OpenSeeFace => decoder.openseeface(&buffer[..size]),
            }
        };
        let mut input = lock(&inputs);
        let Some(status) = input.status(&route.id, route.generation) else {
            continue;
        };
        status.packets = count(status.packets);
        match parsed {
            Ok(true) => {
                if let Some(phone) = phones.get_mut(&(route.id.clone(), route.generation)) {
                    phone.last_packet = Some(Instant::now());
                }
                let now = clock.elapsed().as_secs_f64() * 1000.;
                status.state = TrackingState::Receiving;
                status.last_received_at_ms = Some(now);
                status.error = None;
                input.samples.insert(
                    route.id.clone(),
                    TrackingSample {
                        source_id: route.id.clone(),
                        generation: route.generation,
                        received_at_ms: now,
                        bones: decoder.bones.clone(),
                        expressions: decoder.expressions.clone(),
                        root: decoder.root.clone(),
                        head_position: decoder.head_position,
                    },
                );
            }
            Ok(false) => {}
            Err(_) => status.invalid_packets = count(status.invalid_packets),
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
                calibration: None,
                mapping: None,
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
    // A frame repeats its revision about 60 times each second; only a new revision binds again.
    #[tokio::test]
    async fn failed_bind_waits_for_the_next_revision() {
        let occupied = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = occupied.local_addr().unwrap().port();
        let manager = TrackingManager::new(Instant::now());
        manager.reconcile(&scene(port, 1, true)).await;
        assert_eq!(manager.snapshot().statuses[0].state, TrackingState::Error);
        drop(occupied);
        manager.reconcile(&scene(port, 1, true)).await;
        assert_eq!(manager.snapshot().statuses[0].state, TrackingState::Error);
        let mut next = scene(port, 1, true);
        next.revision = 2;
        manager.reconcile(&next).await;
        assert_eq!(manager.snapshot().statuses[0].state, TrackingState::Waiting);
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
                    unmatched_packets: None,
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
                calibration: None,
                mapping: None,
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
                    positions: None,
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
        assert_eq!(status.unmatched_packets, Some(5));
        assert_eq!(status.state, TrackingState::Waiting);
        manager.shutdown().await;
    }
    #[tokio::test]
    async fn facekit_update_is_in_the_snapshot() {
        use facekit::tests::{face, tracking, FakeAdapter};
        let fake = Arc::new(FakeAdapter::default());
        let manager = TrackingManager::with_face_adapter(Instant::now(), fake.clone());
        let vmc = TrackingConfig::Vmc {
            enabled: false,
            bind_address: "127.0.0.1".into(),
            port: 39539,
            sender_address: None,
            positions: None,
        };
        let face_config = TrackingConfig::FaceKit {
            enabled: true,
            device_id: "cam-1".into(),
        };
        let scene = SceneView {
            schema_version: 1,
            scene_id: "s".into(),
            revision: 1,
            outputs: vec![],
            entities: vec![
                tracking("vmc", "Body", 1, vmc),
                tracking("face", "Face", 1, face_config),
            ],
        };
        manager.reconcile(&scene).await;
        assert!(wait_until(|| fake.starts() == 1).await);
        fake.send(0, face(5.));
        let update = manager.snapshot();
        let mut ids: Vec<_> = update
            .statuses
            .iter()
            .map(|s| s.source_id.as_str())
            .collect();
        ids.sort();
        assert_eq!(ids, ["face", "vmc"]);
        assert_eq!(update.samples.len(), 1);
        assert_eq!(update.samples[0].source_id, "face");
        manager.shutdown().await;
        assert_eq!(fake.drops(), 1);
        assert!(manager.snapshot().statuses.is_empty());
    }
}
#[cfg(test)]
mod face_worker_tests {
    use super::*;
    use facekit::tests::tracking;
    const SLOW: Duration = Duration::from_millis(500);
    const FAST: Duration = Duration::from_millis(50);
    /// Each start and each stop takes 500 ms, like a slow camera. The log gets "start <camera>"
    /// when a start begins and "stopped <camera>" when a stop ends, so the camera of a run is on
    /// from its "start" entry to its "stopped" entry.
    #[derive(Default)]
    struct SlowAdapter {
        log: Arc<Mutex<Vec<String>>>,
    }
    struct SlowRun(String, Arc<Mutex<Vec<String>>>);
    impl FaceRun for SlowRun {}
    impl Drop for SlowRun {
        fn drop(&mut self) {
            std::thread::sleep(SLOW);
            lock(&self.1).push(format!("stopped {}", self.0));
        }
    }
    impl FaceAdapter for SlowAdapter {
        fn cameras(&self) -> Vec<CameraInfo> {
            vec![]
        }
        fn start(&self, device_id: &str, _: FaceSink) -> Box<dyn FaceRun> {
            lock(&self.log).push(format!("start {device_id}"));
            std::thread::sleep(SLOW);
            Box::new(SlowRun(device_id.into(), self.log.clone()))
        }
    }
    fn face_scene(revision: u64, device_id: &str) -> SceneView {
        let config = TrackingConfig::FaceKit {
            enabled: true,
            device_id: device_id.into(),
        };
        SceneView {
            schema_version: 1,
            scene_id: "s".into(),
            revision,
            outputs: vec![],
            entities: vec![tracking("face", "Face", revision, config)],
        }
    }
    fn setup() -> (Arc<Mutex<Vec<String>>>, TrackingManager) {
        let adapter = Arc::new(SlowAdapter::default());
        let log = adapter.log.clone();
        (
            log,
            TrackingManager::with_face_adapter(Instant::now(), adapter),
        )
    }
    async fn timed_reconcile(manager: &TrackingManager, scene: &SceneView) -> Duration {
        let started = Instant::now();
        manager.reconcile(scene).await;
        started.elapsed()
    }
    #[tokio::test(flavor = "multi_thread")]
    async fn reconcile_does_not_wait_for_a_slow_camera() {
        let (log, manager) = setup();
        assert!(timed_reconcile(&manager, &face_scene(1, "cam-1")).await < FAST);
        assert!(wait_until(|| lock(&log).len() == 1).await);
        // The worker is in the start of cam-1; the next revision must not wait for it.
        assert!(timed_reconcile(&manager, &face_scene(2, "cam-2")).await < FAST);
        assert!(wait_until(|| lock(&log).len() == 3).await);
        assert_eq!(*lock(&log), ["start cam-1", "stopped cam-1", "start cam-2"]);
        let status = manager.snapshot().statuses;
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].generation, 2);
        assert_eq!(status[0].state, TrackingState::Waiting);
        // The shutdown waits for the camera to stop.
        let started = Instant::now();
        manager.shutdown().await;
        assert!(started.elapsed() >= SLOW);
        assert_eq!(lock(&log).last().map(String::as_str), Some("stopped cam-2"));
    }
    #[tokio::test(flavor = "multi_thread")]
    async fn quick_scenes_give_one_ordered_stop_then_start() {
        let (log, manager) = setup();
        manager.reconcile(&face_scene(1, "cam-1")).await;
        assert!(wait_until(|| lock(&log).len() == 1).await);
        // Both arrive while the start of cam-1 is in progress; cam-2 is replaced before it starts.
        manager.reconcile(&face_scene(2, "cam-2")).await;
        manager.reconcile(&face_scene(3, "cam-3")).await;
        assert!(wait_until(|| lock(&log).len() == 3).await);
        manager.shutdown().await;
        assert_eq!(
            *lock(&log),
            [
                "start cam-1",
                "stopped cam-1",
                "start cam-3",
                "stopped cam-3"
            ]
        );
    }
}
/// Polls `done` for at most 5 s. The FaceKit worker applies a scene after `reconcile` returns.
#[cfg(test)]
async fn wait_until(done: impl Fn() -> bool) -> bool {
    for _ in 0..500 {
        if done() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    done()
}
#[cfg(test)]
mod handshake_tests {
    use super::*;
    // Injected clock: the retry rule of R6 on plain instants.
    #[test]
    fn handshake_retries_after_2000_ms_while_no_packet_in_500_ms() {
        let t0 = Instant::now();
        let at = |ms| t0 + Duration::from_millis(ms);
        assert!(handshake_due(t0, None, None));
        assert!(!handshake_due(at(1999), Some(t0), None));
        assert!(handshake_due(at(2000), Some(t0), None));
        assert!(!handshake_due(at(2400), Some(t0), Some(at(2000))));
        assert!(handshake_due(at(2500), Some(t0), Some(at(2000))));
        assert!(handshake_due(at(2100), Some(t0), Some(at(100))));
        assert_eq!(next_handshake(Some(t0), Some(at(100))), Some(at(2000)));
        assert_eq!(next_handshake(Some(t0), Some(at(1900))), Some(at(2400)));
        assert_eq!(next_handshake(None, Some(at(1900))), None);
    }
}
