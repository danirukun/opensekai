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
use futures_util::{SinkExt, StreamExt};
use opensekai_contracts::*;
use queues::{StateQueue, CONTROL_CAPACITY, PENDING_CAPACITY};
pub use router::{RpcContext, RpcHandler};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};
use tokio::{
    sync::{mpsc, oneshot, watch, Notify},
    task::JoinHandle,
};
use uuid::Uuid;
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
    registry: AssetRegistry,
    clock: Instant,
    inner: Mutex<Inner>,
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
    frames: VecDeque<RuntimeFrame>,
    pending: HashMap<String, Pending>,
    handler: Option<RpcHandler>,
    evidence: Option<EvidenceReader>,
    active: usize,
}
#[derive(Clone)]
struct Connection {
    id: String,
    control: mpsc::Sender<Value>,
    state: Arc<Mutex<StateQueue<Value>>>,
    notify: Arc<Notify>,
    close: Arc<Notify>,
    delivered: Arc<Mutex<VecDeque<RuntimeFrame>>>,
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
impl Shared {
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
            } else {
                vec![Capability::Read]
            },
            role,
            token,
            output_id,
        }
    }
    fn disconnect(&self, id: &str) {
        let mut inner = lock(&self.inner);
        if inner.publisher.as_ref().is_some_and(|p| p.id == id) {
            inner.publisher = None;
            inner.latest = None;
            inner.frames.clear();
            inner.acks.clear();
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
    let registry = AssetRegistry::load(&config.asset_manifest)?;
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
    let shared = Arc::new(Shared {
        origin: format!("http://{address}"),
        session: Uuid::new_v4().to_string(),
        publisher_token: Uuid::new_v4().to_string(),
        operator_token: Uuid::new_v4().to_string(),
        evaluation: config.evaluation_enabled,
        output_root,
        registry,
        clock: Instant::now(),
        inner: Mutex::new(Inner::default()),
        stop,
        connections: Notify::new(),
    });
    let router = Router::new()
        .route("/ws", get(upgrade))
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
    pub fn asset_records(&self) -> Vec<AssetRecord> {
        self.shared.registry.records()
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
            let records = shared.registry.records();
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
                shared.registry.read(&record.id)?;
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
    pub fn asset_records(&self) -> Vec<AssetRecord> {
        self.shared.registry.records()
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
    let result = tokio::task::spawn_blocking(move || registry.registry.read(&id)).await;
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
        shared.disconnect(&connection.id);
        return;
    }
    let (sink, mut stream) = socket.split();
    let (writer_stop, writer_stopped) = watch::channel(false);
    let writer_connection = connection.clone();
    let writer_shared = shared.clone();
    let mut writer = tokio::spawn(async move {
        write_connection(
            sink,
            control,
            writer_connection,
            writer_shared,
            writer_stopped,
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
                        let mut inner = lock(&shared.inner);
                        if frame.session_id != shared.session
                            || inner.latest.as_ref().is_some_and(|last| frame.sequence <= last.sequence)
                        {
                            break;
                        }
                        inner.latest = Some(frame.clone());
                        inner.frames.push_back(frame);
                        if inner.frames.len() > 32 {
                            inner.frames.pop_front();
                        }
                        for renderer in inner.renderers.values() {
                            lock(&renderer.state).push(envelope.clone());
                            renderer.notify.notify_one();
                        }
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
    shared.disconnect(&connection.id);
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
) {
    let mut shutdown = shared.stop.subscribe();
    loop {
        if *stopped.borrow() || *shutdown.borrow() {
            break;
        }
        let control_value = control.try_recv().ok();
        let value = if control_value.is_some() {
            control_value
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
                result=sink.send(Message::Text(value.to_string().into()))=>result,
                _=stopped.changed()=>break,
                _=shutdown.changed()=>break,
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
            Some(value)=control.recv()=> {
                let result=tokio::select! {
                    result=sink.send(Message::Text(value.to_string().into()))=>result,
                    _=stopped.changed()=>break,
                    _=shutdown.changed()=>break,
                };
                if result.is_err() { break; }
            },
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

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn service_control_queue_cannot_be_displaced_by_state() {
        let (control, mut receiver) = mpsc::channel(CONTROL_CAPACITY);
        let connection = Connection {
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
