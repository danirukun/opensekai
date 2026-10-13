mod auth;
mod queues;
mod router;
use crate::assets::AssetRegistry;
pub use auth::allowed_origin;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::{HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{FutureExt, SinkExt, StreamExt};
use opensekai_contracts::*;
use queues::{StateQueue, CONTROL_CAPACITY, PENDING_CAPACITY};
pub use router::{RpcContext, RpcHandler};
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};
use tokio::{
    sync::{mpsc, oneshot, watch, Notify},
    task::JoinHandle,
};
use uuid::Uuid;
/// The accelerator set the session last reported. `counter` moves on every change, and
/// `origin` names the publisher connection and Blueprint revision that produced the set.
#[derive(Default)]
struct KnownKeystrokes {
    counter: u64,
    origin: Option<(String, u64)>,
    set: BTreeSet<String>,
    /// Key codes that held-key nodes of enabled graphs read.
    watched: BTreeSet<String>,
}
/// A capture field is armed: the OS must pass every key to the editor, so nothing is registered.
struct KeystrokeCapture {
    generation: u64,
    until: Option<Instant>,
}
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(30);
pub struct ServiceConfig {
    pub output_root: PathBuf,
    pub asset_manifest: PathBuf,
    pub evidence_root: PathBuf,
    pub evaluation_enabled: bool,
}
#[derive(Clone)]
pub struct ServicePorts {
    shared: Arc<Shared>,
}
pub type EvidenceReader =
    Arc<dyn Fn(&str, &str) -> Result<(Vec<u8>, &'static str), AppError> + Send + Sync>;
pub struct ServiceHandle {
    shared: Arc<Shared>,
    server: Option<JoinHandle<Result<(), std::io::Error>>>,
}
struct Shared {
    origin: String,
    session: String,
    publisher_token: String,
    operator_token: String,
    evaluation: bool,
    output_root: PathBuf,
    registry: Mutex<AssetRegistry>,
    clock: Instant,
    tracking: crate::tracking::TrackingManager,
    inner: Mutex<Inner>,
    input: Mutex<crate::input::InputQueue>,
    keystrokes: Mutex<Arc<dyn crate::input::KeystrokeRegistrar>>,
    monitor: Mutex<Arc<dyn crate::input::monitor::KeyMonitor>>,
    keystrokes_known: Mutex<KnownKeystrokes>,
    keystroke_capture: Mutex<KeystrokeCapture>,
    capture_timeout: Mutex<Duration>,
    keystroke_warnings: Mutex<Vec<String>>,
    keystroke_gate: tokio::sync::Mutex<()>,
    keystrokes_stopped: watch::Sender<bool>,
    stop: watch::Sender<bool>,
    connections: Notify,
}
#[derive(Default)]
struct Inner {
    publisher: Option<Connection>,
    renderers: HashMap<String, Connection>,
    tickets: HashMap<String, String>,
    latest: Option<RuntimeFrame>,
    acks: HashMap<String, VecDeque<(FrameApplied, u64)>>,
    diagnostics: HashMap<String, (RendererDiagnostics, u64)>,
    frames: VecDeque<RuntimeFrame>,
    pending: HashMap<String, Pending>,
    handler: Option<RpcHandler>,
    evidence: Option<EvidenceReader>,
    active: usize,
}
#[derive(Clone)]
struct Connection {
    clock_credit: Arc<ClockCredit>,
    id: String,
    control: mpsc::Sender<Value>,
    state: Arc<Mutex<StateQueue<Value>>>,
    notify: Arc<Notify>,
    close: Arc<Notify>,
    delivered: Arc<Mutex<VecDeque<RuntimeFrame>>>,
}
#[derive(Default)]
struct ClockCredit {
    deadline: Mutex<Option<tokio::time::Instant>>,
    changed: Notify,
}
impl ClockCredit {
    fn release(&self) {
        if lock(&self.deadline).take().is_some() {
            self.changed.notify_one();
        }
    }
    async fn expired(&self) {
        loop {
            let changed = self.changed.notified();
            let deadline = *lock(&self.deadline);
            match deadline {
                Some(deadline) => tokio::select! {
                    _ = tokio::time::sleep_until(deadline) => return,
                    _ = changed => {},
                },
                None => changed.await,
            }
        }
    }
}
struct Pending {
    owner: String,
    target: String,
    method: String,
    reply: oneshot::Sender<Result<Value, AppError>>,
}
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
fn err(code: ErrorCode, message: &str) -> AppError {
    AppError {
        code,
        message: message.into(),
        ids: vec![],
    }
}
fn failure(error: AppError) -> Value {
    json!(Reply::<Value>::failure(error))
}
fn clock_message(
    session_id: Id,
    elapsed_ms: u64,
    mut tracking: TrackingUpdate,
    input: Option<InputUpdate>,
) -> Value {
    loop {
        let value = json!(WireMessage::Clock {
            session_id: session_id.clone(),
            elapsed_ms,
            tracking: if tracking.statuses.is_empty() && tracking.samples.is_empty() {
                None
            } else {
                Some(tracking.clone())
            },
            input: input.clone()
        });
        if value.to_string().len() <= MAX_TRACKING_CLOCK_BYTES {
            return value;
        }
        if !tracking.samples.is_empty() {
            let oldest = tracking
                .samples
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| a.received_at_ms.total_cmp(&b.received_at_ms))
                .map(|(i, _)| i)
                .unwrap();
            tracking.samples.remove(oldest);
        } else {
            return json!(WireMessage::Clock {
                session_id,
                elapsed_ms,
                tracking: None,
                input
            });
        }
    }
}
impl Shared {
    /// Queued keystrokes plus the watched keys that are down, for the next clock.
    fn clock_input(&self) -> Option<InputUpdate> {
        let mut update = lock(&self.input).drain();
        let held = lock(&self.monitor).clone().held();
        if !held.is_empty() {
            match update.as_mut() {
                Some(update) => update.held = held,
                None => update = Some(InputUpdate { events: vec![], held }),
            }
        }
        update
    }
    fn now_ms(&self) -> u64 {
        self.clock.elapsed().as_millis().min(u64::MAX as u128) as u64
    }
    fn descriptor(
        &self,
        role: Role,
        token: String,
        output_id: Option<String>,
    ) -> ConnectionDescriptor {
        ConnectionDescriptor {
            schema_version: 1,
            session_id: self.session.clone(),
            http_origin: self.origin.clone(),
            ws_url: format!("{}/ws", self.origin.replacen("http://", "ws://", 1)),
            capabilities: if role == Role::Operator && self.evaluation {
                vec![
                    Capability::Read,
                    Capability::Edit,
                    Capability::Capture,
                    Capability::Benchmark,
                ]
            } else if role == Role::Operator {
                vec![Capability::Read, Capability::Edit]
            } else {
                vec![Capability::Read]
            },
            role,
            token,
            output_id,
        }
    }
    /// Records a set the session reported, unless a newer set from the same publisher is
    /// already known. The session restarts its revision for a new publisher, so a different
    /// publisher always wins. Returns whether the set was accepted.
    fn learn_keystrokes(
        &self,
        publisher: &str,
        revision: u64,
        reported: BTreeSet<String>,
        watched: BTreeSet<String>,
    ) -> bool {
        let mut known = lock(&self.keystrokes_known);
        Self::learn_locked(&mut known, publisher, revision, reported, watched)
    }
    fn learn_locked(
        known: &mut KnownKeystrokes,
        publisher: &str,
        revision: u64,
        reported: BTreeSet<String>,
        watched: BTreeSet<String>,
    ) -> bool {
        let newer = known
            .origin
            .as_ref()
            .is_none_or(|(id, seen)| id != publisher || revision > *seen);
        if newer {
            known.counter += 1;
            known.origin = Some((publisher.into(), revision));
            known.set = reported;
            known.watched = watched;
        }
        newer
    }
    /// Makes the OS registrations match the current authoritative set: the last reported
    /// set while a publisher is connected, and nothing otherwise. The set is read inside the
    /// gate, so the order of events that ask for a sync never decides the outcome.
    /// Runs the registrar off the async runtime: it blocks on the main thread.
    async fn sync_keystrokes(&self) {
        // Shutdown never waits on the gate or on a plugin call that may need the main thread.
        let mut stopped = self.keystrokes_stopped.subscribe();
        if *stopped.borrow() {
            return;
        }
        let work = async {
            let _gate = self.keystroke_gate.lock().await;
            // The monitor is passive, so a keystroke capture does not affect it.
            let watched = if lock(&self.inner).publisher.is_some() {
                lock(&self.keystrokes_known).watched.clone()
            } else {
                BTreeSet::new()
            };
            lock(&self.monitor).clone().set_watched(&watched);
            let capturing = lock(&self.keystroke_capture)
                .until
                .is_some_and(|until| until > Instant::now());
            let wanted = if !capturing && lock(&self.inner).publisher.is_some() {
                lock(&self.keystrokes_known).set.clone()
            } else {
                BTreeSet::new()
            };
            let registrar = lock(&self.keystrokes).clone();
            let failed = tokio::task::spawn_blocking(move || registrar.reconcile(&wanted))
                .await
                .unwrap_or_default();
            *lock(&self.keystroke_warnings) = failed;
        };
        tokio::select! {
            _ = work => {},
            _ = stopped.wait_for(|stopped| *stopped) => {},
        }
    }
    /// A publisher can connect with graphs the host has not seen reported (a reconnect of
    /// the same worker session, or a new session). When the host knows a set, it asks the
    /// publisher and syncs to the answer.
    async fn relearn_keystrokes(self: &Arc<Self>) {
        let seen = lock(&self.keystrokes_known).counter;
        // Nothing was ever reported, so nothing is registered and nothing is stale.
        if seen == 0 {
            return;
        }
        // Restore the remembered set at once; the question must not wait behind a slow plugin call.
        let restore = self.clone();
        tokio::spawn(async move { restore.sync_keystrokes().await });
        let asked = lock(&self.inner).publisher.as_ref().map(|p| p.id.clone());
        let reported = match self.running_publisher().await {
            Some(target) => self
                .relay("host", target, "blueprintInspect", |request_id| {
                    json!(WireMessage::Call {
                        request_id,
                        method: "blueprintInspect".into(),
                        params: json!({})
                    })
                })
                .await
                .ok()
                .and_then(|result| {
                    let data = result.get("data")?;
                    let revision = data.get("revision")?.as_u64()?;
                    let list = data.get("keystrokes")?.clone();
                    let held = data
                        .get("heldKeys")
                        .cloned()
                        .map(serde_json::from_value::<Vec<String>>)
                        .transpose()
                        .ok()?
                        .unwrap_or_default();
                    Some((revision, serde_json::from_value::<Vec<String>>(list).ok()?, held))
                }),
            None => None,
        };
        let changed = {
            let mut known = lock(&self.keystrokes_known);
            let same_publisher = asked.is_some()
                && lock(&self.inner).publisher.as_ref().map(|p| &p.id) == asked.as_ref();
            match (reported, asked) {
                // An edit reply that is newer than the answer wins by revision.
                (Some((revision, list, held)), Some(asked)) if same_publisher => Self::learn_locked(
                    &mut known,
                    &asked,
                    revision,
                    list.into_iter().collect(),
                    held.into_iter().collect(),
                ),
                // A publisher that is gone will be asked again when the next one connects.
                (Some(_), _) => false,
                // A publisher that is still here and gave no valid answer has no known set: its
                // session may be new, so the restored accelerators may belong to no graph. An
                // edit that finished while the question was open is newer than the silence.
                (None, _) if same_publisher && known.counter == seen => {
                    known.counter += 1;
                    known.origin = None;
                    known.set.clear();
                    known.watched.clear();
                    true
                }
                _ => false,
            }
        };
        if changed {
            self.sync_keystrokes().await;
        }
    }
    /// The publisher, once it has answered a clock with a frame. A call that arrives while the
    /// worker still starts up can make it miss the clock credit and drop again.
    async fn running_publisher(&self) -> Option<Connection> {
        let first = lock(&self.inner).publisher.as_ref().map(|p| p.id.clone())?;
        for _ in 0..60 {
            if *self.stop.borrow() {
                return None;
            }
            {
                let inner = lock(&self.inner);
                let publisher = inner.publisher.as_ref().filter(|p| p.id == first)?;
                if inner.latest.is_some() {
                    return Some(publisher.clone());
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        None
    }
    async fn disconnect_session(&self, id: &str) {
        if self.disconnect(id) {
            // No publisher: nothing is registered. The reported set is kept for a reconnect.
            self.sync_keystrokes().await;
        }
    }
    /// Returns true when the connection was the publisher.
    fn disconnect(&self, id: &str) -> bool {
        let mut inner = lock(&self.inner);
        let lost_publisher = inner.publisher.as_ref().is_some_and(|p| p.id == id);
        if lost_publisher {
            *lock(&self.input) = crate::input::InputQueue::default();
            inner.publisher = None;
            inner.latest = None;
            inner.frames.clear();
            inner.acks.clear();
            inner.diagnostics.clear();
            for renderer in inner.renderers.values() {
                lock(&renderer.state).clear();
                lock(&renderer.delivered).clear();
            }
        }
        let outputs: Vec<_> = inner
            .renderers
            .iter()
            .filter(|(_, c)| c.id == id)
            .map(|(o, _)| o.clone())
            .collect();
        for output in outputs {
            inner.renderers.remove(&output);
            inner.acks.remove(&output);
            inner.diagnostics.remove(&output);
        }
        let ids: Vec<_> = inner
            .pending
            .iter()
            .filter(|(_, p)| p.owner == id || p.target == id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            if let Some(p) = inner.pending.remove(&id) {
                let _ = p
                    .reply
                    .send(Err(err(ErrorCode::Unavailable, "Connection closed")));
            }
        }
        lost_publisher
    }
    fn send(connection: &Connection, value: Value) -> Result<(), AppError> {
        if value.to_string().len() > MAX_MESSAGE_BYTES {
            connection.close.notify_one();
            return Err(invalid("Oversized outgoing message"));
        }
        connection.control.try_send(value).map_err(|_| {
            connection.close.notify_one();
            err(ErrorCode::Unavailable, "Control queue full or disconnected")
        })
    }
}
pub async fn start_service(config: ServiceConfig) -> Result<ServiceHandle, AppError> {
    let mut registry = if config.asset_manifest.as_os_str().is_empty() {
        AssetRegistry::empty(
            &config
                .evidence_root
                .parent()
                .unwrap_or(&config.evidence_root)
                .join("assets"),
        )?
    } else {
        AssetRegistry::load(&config.asset_manifest)?
    };
    registry.set_library(
        &config
            .evidence_root
            .parent()
            .unwrap_or(&config.evidence_root)
            .join("assets")
            .join("library"),
    )?;
    let output_root = config
        .output_root
        .canonicalize()
        .map_err(|_| err(ErrorCode::NotFound, "Renderer resources unavailable"))?;
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|_| err(ErrorCode::Unavailable, "Cannot bind local service"))?;
    let address = listener
        .local_addr()
        .map_err(|_| err(ErrorCode::Unavailable, "Cannot read local address"))?;
    let (stop, _) = watch::channel(false);
    let clock = Instant::now();
    let shared = Arc::new(Shared {
        origin: format!("http://{address}"),
        session: Uuid::new_v4().to_string(),
        publisher_token: Uuid::new_v4().to_string(),
        operator_token: Uuid::new_v4().to_string(),
        evaluation: config.evaluation_enabled,
        output_root,
        registry: Mutex::new(registry),
        clock,
        tracking: crate::tracking::TrackingManager::new(clock),
        inner: Mutex::new(Inner::default()),
        input: Mutex::default(),
        keystrokes: Mutex::new(Arc::new(crate::input::NoKeystrokes)),
        monitor: Mutex::new(Arc::new(crate::input::monitor::NoKeyMonitor)),
        keystrokes_known: Mutex::default(),
        keystroke_capture: Mutex::new(KeystrokeCapture {
            generation: 0,
            until: None,
        }),
        capture_timeout: Mutex::new(CAPTURE_TIMEOUT),
        keystroke_warnings: Mutex::default(),
        keystroke_gate: tokio::sync::Mutex::new(()),
        keystrokes_stopped: watch::channel(false).0,
        stop,
        connections: Notify::new(),
    });
    let router = Router::new()
        .route("/ws", get(upgrade))
        .route(
            "/diagnostics/{id}",
            get(diagnostics_snapshot).options(asset_preflight),
        )
        .route("/renderer/", get(renderer_index))
        .route("/renderer/{*file}", get(renderer_file))
        .route("/assets/{id}", get(asset).options(asset_preflight))
        .route(
            "/evidence/{id}/{filename}",
            get(evidence).options(asset_preflight),
        )
        .with_state(shared.clone());
    let mut shutdown = shared.stop.subscribe();
    let server = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                if !*shutdown.borrow() {
                    let _ = shutdown.changed().await;
                }
            })
            .await
    });
    Ok(ServiceHandle {
        shared,
        server: Some(server),
    })
}
impl ServicePorts {
    pub fn now_ms(&self) -> u64 {
        self.shared.now_ms()
    }
    pub fn set_key_monitor(&self, monitor: Arc<dyn crate::input::monitor::KeyMonitor>) {
        *lock(&self.shared.monitor) = monitor;
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let shared = self.shared.clone();
            runtime.spawn(async move { shared.sync_keystrokes().await });
        }
    }
    pub fn set_keystroke_registrar(&self, registrar: Arc<dyn crate::input::KeystrokeRegistrar>) {
        *lock(&self.shared.keystrokes) = registrar;
        // The session may have reported its set before the registrar existed.
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let shared = self.shared.clone();
            runtime.spawn(async move { shared.sync_keystrokes().await });
        }
    }
    /// Suspends every registration while a capture field waits for a key, and registers the
    /// remembered set again when it ends. A capture that is not ended expires, so an editor
    /// that closes or crashes cannot leave the hotkeys off.
    pub async fn set_keystroke_capture(&self, active: bool) {
        let timeout = *lock(&self.shared.capture_timeout);
        let generation = {
            let mut capture = lock(&self.shared.keystroke_capture);
            capture.generation += 1;
            capture.until = active.then(|| Instant::now() + timeout);
            capture.generation
        };
        if active {
            let shared = self.shared.clone();
            tokio::spawn(async move {
                let mut stopped = shared.stop.subscribe();
                tokio::select! {
                    _ = tokio::time::sleep(timeout) => {},
                    _ = stopped.wait_for(|stopped| *stopped) => return,
                }
                let expired = {
                    let mut capture = lock(&shared.keystroke_capture);
                    let expired = capture.generation == generation;
                    if expired {
                        capture.until = None;
                    }
                    expired
                };
                if expired {
                    shared.sync_keystrokes().await;
                }
            });
        }
        self.shared.sync_keystrokes().await;
    }
    /// Ends a capture only when one is active, so a window that loses focus with no capture
    /// registers nothing again. Returns whether a capture ended.
    pub async fn end_keystroke_capture(&self) -> bool {
        if lock(&self.shared.keystroke_capture).until.is_none() {
            return false;
        }
        self.set_keystroke_capture(false).await;
        true
    }
    pub fn set_keystroke_capture_timeout(&self, timeout: Duration) {
        *lock(&self.shared.capture_timeout) = timeout;
    }
    pub fn push_keystroke(&self, accelerator: String) {
        lock(&self.shared.input).push(accelerator);
    }
    pub async fn import_avatar(
        &self,
        path: PathBuf,
    ) -> Result<crate::assets::ImportResult, AppError> {
        let shared = self.shared.clone();
        tokio::task::spawn_blocking(move || lock(&shared.registry).import_avatar(&path))
            .await
            .map_err(|_| err(ErrorCode::Unavailable, "Avatar import failed"))?
    }
    pub fn asset_records(&self) -> Vec<AssetRecord> {
        lock(&self.shared.registry).records()
    }
    pub fn last_applied(&self, output: &str) -> Option<(FrameApplied, u64)> {
        lock(&self.shared.inner).acks.get(output)?.back().cloned()
    }
    pub fn applied_at(&self, output: &str, sequence: u64) -> Option<(FrameApplied, u64)> {
        lock(&self.shared.inner)
            .acks
            .get(output)?
            .iter()
            .find(|(f, _)| f.sequence == sequence)
            .cloned()
    }
    pub fn applied_since(&self, output: &str, sequence: u64) -> Vec<(FrameApplied, u64)> {
        lock(&self.shared.inner)
            .acks
            .get(output)
            .map(|ring| {
                ring.iter()
                    .filter(|(f, _)| f.sequence > sequence)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }
    pub fn current_output(&self, output: &str) -> Result<(FrameApplied, u64), AppError> {
        let inner = lock(&self.shared.inner);
        if *self.shared.stop.borrow() {
            return Err(err(ErrorCode::Unavailable, "Service stopped"));
        }
        if inner.publisher.is_none() || !inner.renderers.contains_key(output) {
            return Err(err(ErrorCode::Unavailable, "Output disconnected"));
        }
        let latest = inner
            .latest
            .as_ref()
            .ok_or_else(|| err(ErrorCode::Unavailable, "Scene unavailable"))?;
        let (ack, at) = inner
            .acks
            .get(output)
            .and_then(|r| r.back())
            .ok_or_else(|| err(ErrorCode::StaleFrame, "Output not acknowledged"))?;
        if ack.session_id != latest.session_id
            || ack.revision != latest.scene.revision
            || !latest
                .scene
                .outputs
                .iter()
                .any(|o| o.id == output && o.camera_id == ack.camera_id)
            || *at > self.now_ms()
            || self.now_ms().saturating_sub(*at) > 500
        {
            return Err(err(ErrorCode::StaleFrame, "Output not current"));
        }
        Ok((ack.clone(), *at))
    }
    pub async fn validate_smoke_fixture(&self) -> Result<(), AppError> {
        let shared = self.shared.clone();
        tokio::task::spawn_blocking(move || {
            let manifest: Value =
                serde_json::from_str(include_str!("../../../../../fixtures/smoke/manifest.json"))
                    .map_err(|_| invalid("Invalid smoke fixture"))?;
            let mut expected: Vec<AssetRecord> = serde_json::from_value(manifest["assets"].clone())
                .map_err(|_| invalid("Invalid smoke assets"))?;
            expected.sort_by(|a, b| a.id.cmp(&b.id));
            let records = lock(&shared.registry).fixture_records();
            if records.len() != expected.len()
                || records
                    .iter()
                    .zip(&expected)
                    .any(|(a, b)| a.id != b.id || a.sha256 != b.sha256 || a.bytes != b.bytes)
            {
                return Err(err(
                    ErrorCode::Conflict,
                    "Smoke fixture registration mismatch",
                ));
            }
            for record in expected {
                lock(&shared.registry).read(&record.id)?;
            }
            Ok(())
        })
        .await
        .map_err(|_| err(ErrorCode::Unavailable, "Fixture validation failed"))?
    }
    pub async fn request_capture(&self, params: CaptureParams) -> Result<CaptureBytes, AppError> {
        self.shared.capture(params).await
    }
    pub async fn route_scene_call(&self, call: Call) -> Reply<Value> {
        self.shared.route_scene_call(call, "native").await
    }
}
impl ServiceHandle {
    pub fn ports(&self) -> ServicePorts {
        ServicePorts {
            shared: self.shared.clone(),
        }
    }
    pub fn install_evidence_reader(&self, reader: EvidenceReader) {
        lock(&self.shared.inner).evidence = Some(reader);
    }

    pub fn publisher_descriptor(&self) -> ConnectionDescriptor {
        self.shared
            .descriptor(Role::Publisher, self.shared.publisher_token.clone(), None)
    }
    pub fn operator_descriptor(&self) -> ConnectionDescriptor {
        self.shared
            .descriptor(Role::Operator, self.shared.operator_token.clone(), None)
    }
    pub fn renderer_descriptor(&self, output_id: &str) -> Result<ConnectionDescriptor, AppError> {
        if output_id.is_empty()
            || output_id.len() > 256
            || !output_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        {
            return Err(invalid("Invalid output ID"));
        }
        let mut inner = lock(&self.shared.inner);
        if !inner.tickets.contains_key(output_id) && inner.tickets.len() >= 64 {
            return Err(err(ErrorCode::RateLimited, "Output ticket limit"));
        }
        let token = inner
            .tickets
            .entry(output_id.into())
            .or_insert_with(|| Uuid::new_v4().to_string())
            .clone();
        Ok(self
            .shared
            .descriptor(Role::Renderer, token, Some(output_id.into())))
    }
    pub async fn import_avatar(
        &self,
        path: PathBuf,
    ) -> Result<crate::assets::ImportResult, AppError> {
        self.ports().import_avatar(path).await
    }
    pub fn asset_records(&self) -> Vec<AssetRecord> {
        lock(&self.shared.registry).records()
    }
    pub fn now_ms(&self) -> u64 {
        self.shared.now_ms()
    }
    pub fn last_applied(&self, output_id: &str) -> Option<(FrameApplied, u64)> {
        lock(&self.shared.inner)
            .acks
            .get(output_id)?
            .back()
            .cloned()
    }
    pub fn applied_at(&self, output_id: &str, sequence: u64) -> Option<(FrameApplied, u64)> {
        lock(&self.shared.inner)
            .acks
            .get(output_id)?
            .iter()
            .find(|(f, _)| f.sequence == sequence)
            .cloned()
    }
    /// Handlers that call this service must capture a Weak<ServiceHandle>, to avoid an ownership cycle.
    pub fn install_evaluation_handler(&self, handler: RpcHandler) {
        lock(&self.shared.inner).handler = Some(handler);
    }
    pub async fn route_scene_call(&self, call: Call) -> Reply<Value> {
        self.shared.route_scene_call(call, "native").await
    }
    pub async fn request_capture(&self, params: CaptureParams) -> Result<CaptureBytes, AppError> {
        self.shared.capture(params).await
    }
    pub fn write_descriptors(
        &self,
        directory: &FsPath,
        output_id: &str,
    ) -> Result<(PathBuf, PathBuf), AppError> {
        std::fs::create_dir_all(directory)
            .map_err(|_| err(ErrorCode::Unavailable, "Cannot create descriptor directory"))?;
        let operator = directory.join("operator.json");
        let renderer = directory.join(format!("renderer-{output_id}.json"));
        let descriptor = self.renderer_descriptor(output_id)?;
        write_descriptor(&operator, &self.operator_descriptor())?;
        write_descriptor(&renderer, &descriptor)?;
        Ok((operator, renderer))
    }
    pub async fn shutdown(mut self) -> Result<(), AppError> {
        // Exit may run on the main thread, so shutdown unregisters nothing; the OS drops hotkeys at exit.
        self.shared.keystrokes_stopped.send_replace(true);
        {
            let mut inner = lock(&self.shared.inner);
            inner.handler = None;
            inner.evidence = None;
            for (_, pending) in inner.pending.drain() {
                let _ = pending
                    .reply
                    .send(Err(err(ErrorCode::Unavailable, "Service stopped")));
            }
        }
        self.shared.tracking.shutdown().await;
        let _ = self.shared.stop.send(true);
        self.server
            .take()
            .ok_or_else(|| err(ErrorCode::Unavailable, "Service already stopped"))?
            .await
            .map_err(|_| err(ErrorCode::Unavailable, "Service task failed"))?
            .map_err(|_| err(ErrorCode::Unavailable, "Service failed"))?;
        loop {
            let changed = self.shared.connections.notified();
            if lock(&self.shared.inner).active == 0 {
                break;
            }
            changed.await;
        }
        Ok(())
    }
}
fn write_descriptor(path: &FsPath, descriptor: &ConnectionDescriptor) -> Result<(), AppError> {
    use std::io::Write;
    let parent = path
        .parent()
        .ok_or_else(|| invalid("Invalid descriptor location"))?;
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| err(ErrorCode::Unavailable, "Cannot create descriptor"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| err(ErrorCode::Unavailable, "Cannot protect descriptor"))?;
    }
    file.write_all(&serde_json::to_vec(descriptor).map_err(|_| invalid("Invalid descriptor"))?)
        .map_err(|_| err(ErrorCode::Unavailable, "Cannot write descriptor"))?;
    file.as_file()
        .sync_all()
        .map_err(|_| err(ErrorCode::Unavailable, "Cannot sync descriptor"))?;
    file.persist(path)
        .map_err(|_| err(ErrorCode::Unavailable, "Cannot replace descriptor"))?;
    Ok(())
}
fn headers_allowed(headers: &HeaderMap, shared: &Shared) -> bool {
    let host = shared.origin.strip_prefix("http://").unwrap_or("");
    headers.get("host").and_then(|h| h.to_str().ok()) == Some(host)
        && headers
            .get("origin")
            .is_none_or(|h| h.to_str().is_ok_and(|o| allowed_origin(o, &shared.origin)))
}
async fn upgrade(
    State(shared): State<Arc<Shared>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !headers_allowed(&headers, &shared) || *shared.stop.borrow() {
        return StatusCode::FORBIDDEN.into_response();
    }
    #[cfg(debug_assertions)]
    if std::env::var("OPENSEKAI_TRACE_ORIGIN").as_deref() == Ok("1") {
        match headers.get("origin").and_then(|h| h.to_str().ok()) {
            Some(origin) => eprintln!("OpenSekai accepted WS Origin: {origin}"),
            None => eprintln!("OpenSekai accepted WS Origin: absent"),
        }
    }
    ws.max_message_size(MAX_CAPTURE_MESSAGE_BYTES)
        .max_frame_size(MAX_CAPTURE_MESSAGE_BYTES)
        .on_upgrade(move |socket| socket_connection(socket, shared))
        .into_response()
}
async fn renderer_index(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> Response {
    static_file(shared, &headers, "index.html").await
}
async fn renderer_file(
    State(shared): State<Arc<Shared>>,
    Path(file): Path<String>,
    headers: HeaderMap,
) -> Response {
    static_file(shared, &headers, &file).await
}
async fn static_file(shared: Arc<Shared>, headers: &HeaderMap, file: &str) -> Response {
    if !headers_allowed(headers, &shared) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if file.split('/').any(|s| s == ".." || s.is_empty()) || file.contains('\\') {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let root = shared.output_root.clone();
    let file_path = file.to_owned();
    let result = tokio::task::spawn_blocking(move || {
        let path = root.join(file_path).canonicalize().ok()?;
        if !path.starts_with(&root) || !path.is_file() {
            return None;
        }
        std::fs::read(path).ok()
    })
    .await;
    let Ok(Some(bytes)) = result else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = if file.ends_with(".js") {
        "text/javascript"
    } else if file.ends_with(".css") {
        "text/css"
    } else if file.ends_with(".html") {
        "text/html"
    } else if file.ends_with(".wasm") {
        "application/wasm"
    } else {
        "application/octet-stream"
    };
    (
        [
            ("content-type", mime),
            ("x-content-type-options", "nosniff"),
        ],
        bytes,
    )
        .into_response()
}
async fn asset(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !headers_allowed(&headers, &shared) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(token) = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
    else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let authorized = token == shared.publisher_token
        || token == shared.operator_token
        || lock(&shared.inner).tickets.values().any(|t| t == token);
    if !authorized {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let registry = shared.clone();
    let result = tokio::task::spawn_blocking(move || lock(&registry.registry).read(&id)).await;
    let mut response = match result {
        Ok(Ok(bytes)) => (
            [
                ("content-type", "model/gltf-binary"),
                ("x-content-type-options", "nosniff"),
            ],
            bytes,
        )
            .into_response(),
        Ok(Err(e)) if e.code == ErrorCode::NotFound => StatusCode::NOT_FOUND.into_response(),
        _ => StatusCode::BAD_REQUEST.into_response(),
    };
    if let Some(origin) = headers.get("origin") {
        response
            .headers_mut()
            .insert("access-control-allow-origin", origin.clone());
        response
            .headers_mut()
            .insert("vary", axum::http::HeaderValue::from_static("Origin"));
    }
    response
}
async fn socket_connection(socket: WebSocket, shared: Arc<Shared>) {
    {
        let mut inner = lock(&shared.inner);
        inner.active += 1;
    }
    connection_loop(socket, &shared).await;
    lock(&shared.inner).active -= 1;
    shared.connections.notify_one();
}
async fn connection_loop(mut socket: WebSocket, shared: &Arc<Shared>) {
    let mut shutdown = shared.stop.subscribe();
    if *shutdown.borrow() {
        return;
    }
    let first = tokio::select! {message=tokio::time::timeout(Duration::from_secs(2),socket.recv())=>message, _=shutdown.changed()=>return};
    let Ok(Some(Ok(Message::Text(text)))) = first else {
        return;
    };
    let Ok(WireMessage::Auth {
        role,
        token,
        output_id,
        ..
    }) = parse_wire(text.as_bytes())
    else {
        return;
    };
    let (tx, control) = mpsc::channel(CONTROL_CAPACITY);
    let connection = Connection {
        clock_credit: Arc::new(ClockCredit::default()),
        id: Uuid::new_v4().to_string(),
        control: tx,
        state: Arc::new(Mutex::new(StateQueue::default())),
        notify: Arc::new(Notify::new()),
        close: Arc::new(Notify::new()),
        delivered: Arc::new(Mutex::new(VecDeque::new())),
    };
    let registered = {
        let mut inner = lock(&shared.inner);
        match role {
            Role::Publisher
                if token == shared.publisher_token
                    && output_id.is_none()
                    && inner.publisher.is_none() =>
            {
                inner.publisher = Some(connection.clone());
                true
            }
            Role::Operator if token == shared.operator_token && output_id.is_none() => true,
            Role::Renderer
                if output_id.as_ref().is_some_and(|id| {
                    inner.tickets.get(id) == Some(&token) && !inner.renderers.contains_key(id)
                }) =>
            {
                if let Some(id) = &output_id {
                    inner.acks.remove(id);
                    inner.diagnostics.remove(id);
                    inner.renderers.insert(id.clone(), connection.clone());
                    if let Some(frame) = &inner.latest {
                        lock(&connection.state).push(json!(WireMessage::Frame {
                            frame: frame.clone()
                        }));
                        connection.notify.notify_one();
                    }
                }
                true
            }
            _ => false,
        }
    };
    if !registered {
        return;
    }
    if role == Role::Publisher {
        let shared = shared.clone();
        tokio::spawn(async move { shared.relearn_keystrokes().await });
    }
    let capabilities = shared
        .descriptor(role.clone(), token, output_id.clone())
        .capabilities;
    if socket
        .send(Message::Text(
            json!(WireMessage::AuthReply {
                session_id: shared.session.clone(),
                schema_version: 1,
                capabilities: capabilities.clone()
            })
            .to_string()
            .into(),
        ))
        .await
        .is_err()
    {
        shared.disconnect_session(&connection.id).await;
        return;
    }
    let (sink, mut stream) = socket.split();
    let (writer_stop, writer_stopped) = watch::channel(false);
    let writer_connection = connection.clone();
    let writer_shared = shared.clone();
    let clock_enabled = role == Role::Publisher;
    let mut writer = tokio::spawn(async move {
        write_connection(
            sink,
            control,
            writer_connection,
            writer_shared,
            writer_stopped,
            clock_enabled,
        )
        .await;
    });
    let mut calls = tokio::task::JoinSet::new();
    let mut writer_finished = false;
    loop {
        tokio::select! {
            _=shutdown.changed()=>break,
            _=connection.close.notified()=>break,
            _=&mut writer=>{writer_finished=true;break;},
            Some(_)=calls.join_next(),if !calls.is_empty()=>{},
            message=stream.next()=>{
                let Some(Ok(Message::Text(text)))=message else {break;};
                let Ok(message)=parse_wire(text.as_bytes()) else {break;};
                match message {
                    WireMessage::Ping{request_id}=>{if Shared::send(&connection,json!(WireMessage::Pong{request_id})).is_err(){break;}},
                    WireMessage::Frame { frame } if role == Role::Publisher => {
                        let envelope = json!(WireMessage::Frame { frame: frame.clone() });
                        if envelope.to_string().len() > MAX_MESSAGE_BYTES {
                            break;
                        }
                        let scene = frame.scene.clone();
                        { let mut inner = lock(&shared.inner);
                        if frame.session_id != shared.session
                            || inner.latest.as_ref().is_some_and(|last| frame.sequence <= last.sequence)
                        {
                            break;
                        }
                        connection.clock_credit.release();
                        connection.notify.notify_one();
                        inner.latest = Some(frame.clone());
                        inner.frames.push_back(frame);
                        if inner.frames.len() > 32 {
                            inner.frames.pop_front();
                        }
                        for renderer in inner.renderers.values() {
                            lock(&renderer.state).push(envelope.clone());
                            renderer.notify.notify_one();
                        }
                        }
                        shared.tracking.reconcile(&scene).await;
                    },
                    WireMessage::Applied { frame } if role == Role::Renderer => {
                        let mut inner = lock(&shared.inner);
                        if output_id.as_deref() != Some(&frame.output_id)
                            || frame.session_id != shared.session
                        {
                            break;
                        }
                        let mut delivered = lock(&connection.delivered);
                        let provenance = delivered.iter().find(|published| published.sequence == frame.sequence);
                        let Some(published) = provenance else {
                            if let Some((ack, _)) = inner.acks.get(&frame.output_id).and_then(|ring|ring.iter().find(|(ack,_)|ack.sequence == frame.sequence)) {
                                if ack.tick != frame.tick || ack.revision != frame.revision || ack.camera_id != frame.camera_id {
                                    break;
                                }
                                continue;
                            }
                            if inner.frames.front().is_some_and(|oldest| frame.sequence < oldest.sequence) {
                                continue;
                            }
                            break;
                        };
                        let valid = published.tick == frame.tick
                            && published.scene.revision == frame.revision
                            && published.scene.outputs.iter().any(|output| {
                                output.id == frame.output_id && output.camera_id == frame.camera_id
                            });
                        if !valid { break; }
                        // A coalescing renderer can acknowledge the newer delivered frame only.
                        while delivered.front().is_some_and(|sent|sent.sequence <= frame.sequence) {
                            delivered.pop_front();
                        }
                        connection.notify.notify_one();
                        let ring = inner.acks.entry(frame.output_id.clone()).or_default();
                        if ring.back().is_some_and(|(last, _)| frame.sequence <= last.sequence) {
                            break;
                        }
                        ring.push_back((frame, shared.now_ms()));
                        if ring.len() > 32 {
                            ring.pop_front();
                        }
                    },
                    WireMessage::Diagnostics { diagnostics } if role == Role::Renderer => {
                        if !shared.evaluation { continue; }
                        let mut inner=lock(&shared.inner);
                        if diagnostics.session_id != shared.session || output_id.as_deref() != Some(&diagnostics.output_id) || inner.renderers.get(&diagnostics.output_id).is_none_or(|current|current.id != connection.id) { break; }
                        let now=shared.now_ms();
                        let acknowledged=inner.acks.get(&diagnostics.output_id).and_then(|ring|ring.iter().find(|(ack,_)|ack.sequence == diagnostics.sequence));
                        let Some((ack,received))=acknowledged else { break; };
                        if ack.revision != diagnostics.revision || ack.backend != diagnostics.backend { break; }
                        if now.saturating_sub(*received)>500 || inner.latest.as_ref().is_none_or(|latest|latest.scene.revision != diagnostics.revision) { continue; }
                        if let Some((previous,at))=inner.diagnostics.get(&diagnostics.output_id) {
                            if previous.renderer_epoch != diagnostics.renderer_epoch { break; }
                            if now.saturating_sub(*at)<1000 || diagnostics.sequence<=previous.sequence { continue; }
                        }
                        inner.diagnostics.insert(diagnostics.output_id.clone(),(diagnostics,now));
                    },
                    WireMessage::Reply{request_id,result} if role==Role::Publisher=>shared.accept_reply(&connection.id,&request_id,result,false),
                    WireMessage::CaptureReply{request_id,result} if role==Role::Renderer=>shared.accept_reply(&connection.id,&request_id,result,true),
                    WireMessage::Call{request_id,method,params}=>{
                        if calls.len()>=PENDING_CAPACITY {if Shared::send(&connection,json!(WireMessage::Reply{request_id,result:failure(err(ErrorCode::RateLimited,"Too many pending calls"))})).is_err(){break;}continue;}
                        let Ok(call)=parse_call(text.as_bytes()) else {break;};
                        let _=(method,params);
                        let service=shared.clone();let client=connection.clone();let role=role.clone();let capabilities=capabilities.clone();
                        calls.spawn(async move {let result=service.route_call(call,&client.id,&role,&capabilities).await;let _=Shared::send(&client,json!(WireMessage::Reply{request_id,result:json!(result)}));});
                    },_=>break
                }
            }
        }
    }
    shared.disconnect_session(&connection.id).await;
    let _ = writer_stop.send(true);
    if !writer_finished {
        let _ = writer.await;
    }
    calls.abort_all();
    while calls.join_next().await.is_some() {}
}

async fn write_connection(
    mut sink: futures_util::stream::SplitSink<WebSocket, Message>,
    mut control: mpsc::Receiver<Value>,
    connection: Connection,
    shared: Arc<Shared>,
    mut stopped: watch::Receiver<bool>,
    clock_enabled: bool,
) {
    let mut shutdown = shared.stop.subscribe();
    let mut interval = tokio::time::interval(Duration::from_nanos(1_000_000_000 / 60));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut clock_due = false;
    let mut ready_control = None;
    loop {
        if *stopped.borrow() || *shutdown.borrow() {
            break;
        }
        let outstanding = lock(&connection.clock_credit.deadline).is_some();
        if clock_enabled && !outstanding && interval.tick().now_or_never().is_some() {
            clock_due = true;
        }
        // A due pulse gets one turn before controls. Credit bounds socket ingress too.
        let value = if clock_enabled && !outstanding && clock_due {
            let elapsed_ms = shared.now_ms();
            if elapsed_ms > 9_007_199_254_740_991 {
                break;
            }
            *lock(&connection.clock_credit.deadline) =
                Some(tokio::time::Instant::now() + Duration::from_secs(2));
            clock_due = false;
            Some(clock_message(
                shared.session.clone(),
                elapsed_ms,
                shared.tracking.snapshot(),
                shared.clock_input(),
            ))
        } else if let Some(value) = ready_control.take().or_else(|| control.try_recv().ok()) {
            Some(value)
        } else {
            let mut delivered = lock(&connection.delivered);
            if delivered.len() < queues::STATE_CAPACITY {
                let value = lock(&connection.state).pop();
                if let Some(value) = &value {
                    let Ok(WireMessage::Frame { frame }) = serde_json::from_value(value.clone())
                    else {
                        break;
                    };
                    delivered.push_back(frame);
                }
                value
            } else {
                None
            }
        };
        if let Some(value) = value {
            let result = tokio::select! {
                biased;
                _=stopped.changed()=>break,
                _=shutdown.changed()=>break,
                _=connection.clock_credit.expired()=>break,
                result=sink.send(Message::Text(value.to_string().into()))=>result,
            };
            if result.is_err() {
                break;
            }
            continue;
        }
        tokio::select! {
            biased;
            _=stopped.changed()=>break,
            _=shutdown.changed()=>break,
            _=connection.clock_credit.expired()=>break,
            _=interval.tick(), if clock_enabled && !outstanding => { clock_due = true; },
            Some(value)=control.recv()=> { ready_control = Some(value); },
            _=connection.notify.notified()=>{},
        }
    }
    let _ = tokio::time::timeout(Duration::from_millis(200), sink.close()).await;
}

impl Drop for ServiceHandle {
    fn drop(&mut self) {
        let _ = self.shared.stop.send(true);
        let mut inner = lock(&self.shared.inner);
        inner.handler = None;
        inner.evidence = None;
        for (_, pending) in inner.pending.drain() {
            let _ = pending
                .reply
                .send(Err(err(ErrorCode::Unavailable, "Service stopped")));
        }
    }
}
async fn asset_preflight(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> Response {
    if !headers_allowed(&headers, &shared)
        || headers.get("origin").is_none()
        || headers
            .get("access-control-request-method")
            .and_then(|h| h.to_str().ok())
            != Some("GET")
        || !headers
            .get("access-control-request-headers")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|s| s.eq_ignore_ascii_case("authorization"))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    if let Some(origin) = headers.get("origin") {
        response
            .headers_mut()
            .insert("access-control-allow-origin", origin.clone());
    }
    for (key, value) in [
        ("access-control-allow-methods", "GET"),
        ("access-control-allow-headers", "Authorization"),
        ("vary", "Origin"),
    ] {
        response
            .headers_mut()
            .insert(key, axum::http::HeaderValue::from_static(value));
    }
    response
}

async fn evidence(
    State(shared): State<Arc<Shared>>,
    Path((id, filename)): Path<(String, String)>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    if !headers_allowed(&headers, &shared) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let mut response = if token != Some(shared.operator_token.as_str()) {
        if token.is_some_and(|t| {
            lock(&shared.inner).tickets.values().any(|known| known == t)
                || t == shared.publisher_token
        }) {
            StatusCode::FORBIDDEN.into_response()
        } else {
            StatusCode::UNAUTHORIZED.into_response()
        }
    } else if uri.query().is_some()
        || uri.path() != format!("/evidence/{id}/{filename}")
        || uuid::Uuid::parse_str(&id).is_err()
        || !matches!(filename.as_str(), "capture.png" | "summary.json")
    {
        StatusCode::BAD_REQUEST.into_response()
    } else {
        let reader = lock(&shared.inner).evidence.clone();
        let result = match reader {
            Some(read) => tokio::task::spawn_blocking(move || read(&id, &filename))
                .await
                .ok(),
            None => None,
        };
        match result {
            Some(Ok((bytes, mime))) => (
                [
                    ("content-type", mime),
                    ("x-content-type-options", "nosniff"),
                    ("cache-control", "no-store"),
                ],
                bytes,
            )
                .into_response(),
            Some(Err(error)) if error.code == ErrorCode::InvalidInput => {
                StatusCode::BAD_REQUEST.into_response()
            }
            _ => StatusCode::NOT_FOUND.into_response(),
        }
    };
    if let Some(origin) = headers.get("origin") {
        response
            .headers_mut()
            .insert("access-control-allow-origin", origin.clone());
        response
            .headers_mut()
            .insert("vary", axum::http::HeaderValue::from_static("Origin"));
    }
    response
}

async fn diagnostics_snapshot(
    State(shared): State<Arc<Shared>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    if !headers_allowed(&headers, &shared) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut response = if !shared.evaluation {
        StatusCode::NOT_FOUND.into_response()
    } else if headers.get("authorization").and_then(|v| v.to_str().ok())
        != Some(format!("Bearer {}", shared.operator_token).as_str())
    {
        StatusCode::UNAUTHORIZED.into_response()
    } else if uri.query().is_some()
        || uri.path() != format!("/diagnostics/{id}")
        || id.is_empty()
        || id.len() > 256
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    {
        StatusCode::BAD_REQUEST.into_response()
    } else {
        let reader = shared.clone();
        let result=tokio::task::spawn_blocking(move || {
            let inner=lock(&reader.inner);
            let connection=inner.renderers.get(&id)?;
            let (packet,received)=inner.diagnostics.get(&id)?;
            let mut pending=HashMap::<&str,usize>::new();for call in inner.pending.values() { *pending.entry(&call.owner).or_default()+=1; }
            let per_owner=pending.values().copied().max().unwrap_or(0);
            let state_frames=lock(&connection.state).len();
            let delivered_frames=lock(&connection.delivered).len();
            Some(json!({"renderer":packet,"receivedAgeMs":reader.now_ms().saturating_sub(*received),"native":{"stateFrames":state_frames,"deliveredFrames":delivered_frames,"controls":connection.control.max_capacity()-connection.control.capacity(),"pendingCallsPerOwner":per_owner,"pendingOwnerCount":pending.len(),"ackHistory":inner.acks.get(&id).map_or(0,VecDeque::len)}}))
        }).await;
        match result {
            Ok(Some(value)) => (
                [
                    ("content-type", "application/json"),
                    ("cache-control", "no-store"),
                    ("x-content-type-options", "nosniff"),
                ],
                value.to_string(),
            )
                .into_response(),
            _ => StatusCode::NOT_FOUND.into_response(),
        }
    };
    if let Some(origin) = headers.get("origin") {
        response
            .headers_mut()
            .insert("access-control-allow-origin", origin.clone());
        response
            .headers_mut()
            .insert("vary", axum::http::HeaderValue::from_static("Origin"));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn service_control_queue_cannot_be_displaced_by_state() {
        let (control, mut receiver) = mpsc::channel(CONTROL_CAPACITY);
        let connection = Connection {
            clock_credit: Arc::new(ClockCredit::default()),
            id: "test".into(),
            control,
            state: Arc::new(Mutex::new(StateQueue::default())),
            notify: Arc::new(Notify::new()),
            close: Arc::new(Notify::new()),
            delivered: Arc::new(Mutex::new(VecDeque::new())),
        };
        for n in 0..CONTROL_CAPACITY {
            Shared::send(&connection, json!({"command": n})).unwrap();
        }
        for n in 0..100 {
            lock(&connection.state).push(json!({"frame": n}));
        }
        assert_eq!(
            Shared::send(&connection, json!({"command":"overflow"}))
                .unwrap_err()
                .code,
            ErrorCode::Unavailable
        );
        for n in 0..CONTROL_CAPACITY {
            assert_eq!(receiver.recv().await.unwrap()["command"], n);
        }
        assert_eq!(lock(&connection.state).pop().unwrap()["frame"], 98);
        assert_eq!(lock(&connection.state).pop().unwrap()["frame"], 99);
        tokio::time::timeout(Duration::from_millis(100), connection.close.notified())
            .await
            .unwrap();
    }
}
#[cfg(test)]
mod tracking_budget_tests {
    use super::*;
    #[test]
    fn outgoing_clock_never_exceeds_tracking_budget() {
        let samples = (0..4)
            .map(|i| TrackingSample {
                source_id: format!("s{i}"),
                generation: 1,
                received_at_ms: 0.,
                bones: ["left", "right"]
                    .into_iter()
                    .flat_map(|side| {
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
                        .into_iter()
                        .map(move |finger| {
                            (
                                format!("{side}{finger}"),
                                TrackingBone {
                                    rotation: [
                                        0.3333333333333333,
                                        0.3333333333333333,
                                        0.3333333333333333,
                                        0.816496580927726,
                                    ],
                                    position: Some([1.7976931348623157e308; 3]),
                                    weight: Some(0.3333333333333333),
                                    space: BoneSpace::Raw,
                                },
                            )
                        })
                    })
                    .collect(),
                expressions: (0..64)
                    .map(|n| (format!("{n}{}", "x".repeat(126)), 0.3333333333333333))
                    .collect(),
                root: None,
            })
            .collect();
        let update = TrackingUpdate {
            samples,
            statuses: vec![],
        };
        assert!(
            clock_message("s".into(), 1, update, None).to_string().len()
                <= MAX_TRACKING_CLOCK_BYTES
        );
    }
}
