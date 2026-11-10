// Capture screens (B31, MED-04 slice 1). The manager turns each accepted scene into capture
// streams, keeps the host status of each capture screen, and fans the encoded chunks out to the
// `/capture` subscribers. No window title or display name goes into the status or a log.
pub mod adapter;
pub mod allow;
#[cfg(feature = "capture-fixture")]
pub mod fixture;
#[cfg(target_os = "macos")]
mod macos;
pub mod plan;
mod stub;
pub mod transport;
use adapter::*;
use allow::AllowedSources;
use opensekai_contracts::{
    AppError, CaptureScreenStatus, CaptureSource, CaptureState, CaptureStatusEntry, ErrorCode, Id,
    SceneEntity, SceneView, ScreenContent, Validate, WireMessage,
};
use plan::{capture_plan, match_source, CapturePlan, StreamKey};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, MutexGuard,
};
use std::time::{Duration, Instant};
use tokio::sync::{watch, Notify};
use transport::{KeyThrottle, Outgoing, Pushed, SubscriberQueue};

pub const IDLE_AFTER: Duration = Duration::from_secs(5);
pub const REMATCH_INTERVAL: Duration = Duration::from_secs(2);
pub const MAX_STREAM_SUBSCRIBERS: usize = 4;
pub const MAX_SUBSCRIBERS: usize = 8;
pub const MAX_LISTED_WINDOWS: usize = 64;
pub type StatusSink = Arc<dyn Fn(WireMessage) + Send + Sync>;

/// The default adapter of this platform.
pub fn platform_adapter() -> Arc<dyn CaptureAdapter> {
    #[cfg(target_os = "macos")]
    {
        Arc::new(macos::MacAdapter::new())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Arc::new(stub::StubAdapter)
    }
}
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceEntry {
    pub source: CaptureSource,
    pub label: String,
    pub width: u32,
    pub height: u32,
}
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceList {
    pub sources: Vec<SourceEntry>,
    pub error: Option<String>,
}
pub const PERMISSION_NEEDED: &str = "Screen Recording permission needed";
pub const NOT_SUPPORTED: &str = "Capture not supported on this platform";
pub const CAPTURE_FAILED: &str = "Capture failed";
/// R6: the editor list of displays and capturable windows. Pure, so it can be tested.
pub fn source_entries(inventory: &Inventory) -> Vec<SourceEntry> {
    let displays = plan::display_ordinals(inventory)
        .into_iter()
        .zip(&inventory.displays)
        .filter(|((name, ordinal), _)| !name.is_empty() && *ordinal <= 7)
        .map(|((name, ordinal), display)| SourceEntry {
            label: if ordinal == 0 {
                name.clone()
            } else {
                format!("{name} ({})", ordinal + 1)
            },
            source: CaptureSource::Display { name, ordinal },
            width: display.width,
            height: display.height,
        });
    let windows = inventory
        .windows
        .iter()
        .filter(|w| plan::capturable(w))
        .take(MAX_LISTED_WINDOWS)
        .map(|w| {
            let app_name = plan::normalize_name(&w.app_name);
            let title = plan::normalize_title(&w.title);
            SourceEntry {
                label: match (app_name.is_empty(), title.is_empty()) {
                    (false, false) => format!("{app_name} — {title}"),
                    (true, _) => title.clone(),
                    (false, true) => app_name,
                },
                source: CaptureSource::Window {
                    app: plan::normalize_app(&w.app),
                    title,
                },
                width: w.width,
                height: w.height,
            }
        });
    displays
        .chain(windows)
        .filter(|entry| entry.source.validate().is_ok())
        .collect()
}
fn error_state(error: &CaptureError) -> CaptureState {
    match error {
        CaptureError::PermissionNeeded => CaptureState::PermissionNeeded,
        CaptureError::NotFound => CaptureState::NotFound,
        CaptureError::Unsupported => CaptureState::Unsupported,
        CaptureError::Failed(_) => CaptureState::Failed,
    }
}
fn subscribable(state: &CaptureState) -> bool {
    matches!(
        state,
        CaptureState::Starting | CaptureState::Idle | CaptureState::Live | CaptureState::Paused
    )
}
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
fn stream_id() -> String {
    format!("{:032x}", rand::random::<u128>())
}
struct Subscriber {
    renderer: String,
    queue: SubscriberQueue,
    signal: Arc<Signal>,
}
/// Wakes the socket task of one subscriber, and tells it to close.
#[derive(Default)]
pub struct Signal {
    notify: Notify,
    closed: AtomicBool,
}
impl Signal {
    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.notify.notify_one();
    }
}
struct Stream {
    id: String,
    key: StreamKey,
    screens: Vec<Id>,
    state: CaptureState,
    width: u32,
    height: u32,
    /// Moves on each start and stop, so a late start or event of an older run is ignored.
    generation: u64,
    control: Option<Arc<dyn StreamControl>>,
    pump: Option<tokio::task::JoinHandle<()>>,
    starting: bool,
    config: Option<DecoderConfig>,
    key_frame: Option<Arc<Vec<u8>>>,
    key_is_latest: bool,
    throttle: KeyThrottle,
    subscribers: HashMap<u64, Subscriber>,
    alone_since: Instant,
    last_match: Instant,
}
impl Stream {
    fn new(key: StreamKey, screens: Vec<Id>) -> Self {
        Self {
            id: stream_id(),
            key,
            screens,
            state: CaptureState::Starting,
            width: 0,
            height: 0,
            generation: 0,
            control: None,
            pump: None,
            starting: false,
            config: None,
            key_frame: None,
            key_is_latest: false,
            throttle: KeyThrottle::default(),
            subscribers: HashMap::new(),
            alone_since: Instant::now(),
            last_match: Instant::now(),
        }
    }
    /// Stops the capture and closes each subscriber.
    fn halt(&mut self) {
        self.generation += 1;
        self.starting = false;
        if let Some(control) = self.control.take() {
            control.stop();
        }
        if let Some(pump) = self.pump.take() {
            pump.abort();
        }
        self.config = None;
        self.key_frame = None;
        self.key_is_latest = false;
        for (_, subscriber) in self.subscribers.drain() {
            subscriber.signal.close();
        }
    }
    fn request_key(&mut self) {
        if let Some(control) = &self.control {
            if self.throttle.try_request(Instant::now()) {
                control.request_key();
            }
        }
    }
}
#[derive(Default)]
struct State {
    allowed: AllowedSources,
    /// The capture screens of the last scene, in scene order: (id, visible, content).
    screens: Vec<(Id, bool, Option<CaptureSource>, bool)>,
    revision: u64,
    plan: CapturePlan,
    streams: Vec<Stream>,
    /// `None` until the first scene, so a scene without capture screens sends one empty list.
    published: Option<Vec<CaptureScreenStatus>>,
    next_subscriber: u64,
    access_requested: bool,
}
pub struct CaptureManager {
    shared: Arc<ManagerShared>,
}
struct ManagerShared {
    state: Mutex<State>,
    adapter: Mutex<Arc<dyn CaptureAdapter>>,
    sink: Mutex<Option<StatusSink>>,
}
/// One `/capture` subscription. The socket task pops what to send until `next` returns `None`.
pub struct Subscription {
    manager: Arc<ManagerShared>,
    stream: String,
    id: u64,
    signal: Arc<Signal>,
}
impl Subscription {
    /// The next message, or `None` when the subscription is closed.
    pub async fn next(&self) -> Option<Outgoing> {
        loop {
            let notified = self.signal.notify.notified();
            if self.signal.closed.load(Ordering::SeqCst) {
                return None;
            }
            if let Some(item) = self.manager.pop(&self.stream, self.id) {
                return Some(item);
            }
            notified.await;
        }
    }
}
impl Drop for Subscription {
    fn drop(&mut self) {
        self.manager.unsubscribe(&self.stream, self.id);
    }
}
impl Default for CaptureManager {
    fn default() -> Self {
        Self::new(platform_adapter())
    }
}
impl CaptureManager {
    pub fn new(adapter: Arc<dyn CaptureAdapter>) -> Self {
        Self {
            shared: Arc::new(ManagerShared {
                state: Mutex::new(State::default()),
                adapter: Mutex::new(adapter),
                sink: Mutex::new(None),
            }),
        }
    }
    pub fn set_adapter(&self, adapter: Arc<dyn CaptureAdapter>) {
        *lock(&self.shared.adapter) = adapter;
    }
    pub fn set_sink(&self, sink: StatusSink) {
        *lock(&self.shared.sink) = Some(sink);
    }
    /// Starts the 250 ms upkeep: idle streams and the 2 s rematch.
    pub fn run(&self, mut stop: watch::Receiver<bool>) {
        let shared = self.shared.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(250));
            loop {
                tokio::select! {
                    _ = interval.tick() => shared.upkeep(),
                    _ = stop.wait_for(|stop| *stop) => break,
                }
            }
            let mut state = lock(&shared.state);
            for stream in &mut state.streams {
                stream.halt();
            }
        });
    }
    /// Reads the capture screens of an accepted scene (R8).
    pub fn apply_scene(&self, scene: &SceneView) {
        let screens: Vec<_> = scene
            .entities
            .iter()
            .filter_map(|e| match e {
                SceneEntity::Screen {
                    id,
                    visible,
                    content: ScreenContent::Capture { source, cursor, .. },
                    ..
                } => Some((id.clone(), *visible, source.clone(), *cursor)),
                _ => None,
            })
            .collect();
        {
            let mut state = lock(&self.shared.state);
            state.revision = scene.revision;
            if state.screens == screens && state.published.is_some() {
                return;
            }
            state.screens = screens;
        }
        self.shared.replan();
    }
    /// R5: only the editor-only command calls this.
    pub fn allow(&self, source: CaptureSource) -> Result<(), AppError> {
        source.validate()?;
        lock(&self.shared.state).allowed.allow(source);
        self.shared.replan();
        Ok(())
    }
    pub fn is_allowed(&self, source: &CaptureSource) -> bool {
        lock(&self.shared.state).allowed.contains(source)
    }
    /// The status for a renderer that just authenticated (R9), one time; `None` before the first scene.
    pub fn current_status(&self) -> Option<WireMessage> {
        let state = lock(&self.shared.state);
        state
            .published
            .as_ref()
            .map(|screens| WireMessage::CaptureStatus {
                revision: state.revision,
                screens: screens.clone(),
            })
    }
    /// `app_status.captures`: states without names or titles.
    pub fn entries(&self) -> Vec<CaptureStatusEntry> {
        lock(&self.shared.state)
            .published
            .iter()
            .flatten()
            .map(|s| CaptureStatusEntry {
                entity_id: s.entity_id.clone(),
                state: s.state.clone(),
            })
            .collect()
    }
    /// The editor source list (R6). The first call asks the OS for access.
    pub async fn source_list(&self) -> SourceList {
        let shared = self.shared.clone();
        tokio::task::spawn_blocking(move || {
            let adapter = lock(&shared.adapter).clone();
            let first = {
                let mut state = lock(&shared.state);
                !std::mem::replace(&mut state.access_requested, true)
            };
            if first {
                adapter.request_access();
            }
            match adapter.inventory() {
                Ok(inventory) => SourceList {
                    sources: source_entries(&inventory),
                    error: None,
                },
                Err(error) => SourceList {
                    sources: vec![],
                    error: Some(
                        match error {
                            CaptureError::PermissionNeeded => PERMISSION_NEEDED,
                            CaptureError::Unsupported => NOT_SUPPORTED,
                            _ => CAPTURE_FAILED,
                        }
                        .into(),
                    ),
                },
            }
        })
        .await
        .unwrap_or_else(|_| SourceList {
            sources: vec![],
            error: Some(CAPTURE_FAILED.into()),
        })
    }
    /// R13: a subscription of one renderer connection to one stream. The error is the close code.
    pub fn subscribe(&self, stream_id: &str, renderer: &str) -> Result<Subscription, u16> {
        let (id, signal) = self.shared.subscribe(stream_id, renderer)?;
        Ok(Subscription {
            manager: self.shared.clone(),
            stream: stream_id.into(),
            id,
            signal,
        })
    }
    /// Closes each subscription of a `/ws` renderer connection that closed.
    pub fn renderer_closed(&self, renderer: &str) {
        let mut state = lock(&self.shared.state);
        for stream in &mut state.streams {
            let ids: Vec<_> = stream
                .subscribers
                .iter()
                .filter(|(_, s)| s.renderer == renderer)
                .map(|(id, _)| *id)
                .collect();
            let removed = !ids.is_empty();
            for id in ids {
                if let Some(s) = stream.subscribers.remove(&id) {
                    s.signal.close();
                }
            }
            if removed && stream.subscribers.is_empty() {
                stream.alone_since = Instant::now();
            }
        }
    }
    pub fn shutdown(&self) {
        let mut state = lock(&self.shared.state);
        for stream in &mut state.streams {
            stream.halt();
        }
    }
}
impl ManagerShared {
    fn replan(self: &Arc<Self>) {
        let mut starts = Vec::new();
        {
            let mut state = lock(&self.state);
            let scene = SceneView {
                schema_version: 1,
                scene_id: String::new(),
                revision: state.revision,
                outputs: vec![],
                entities: state
                    .screens
                    .iter()
                    .map(|(id, visible, source, cursor)| SceneEntity::Screen {
                        id: id.clone(),
                        name: String::new(),
                        visible: *visible,
                        transform: opensekai_contracts::Transform {
                            position: [0.; 3],
                            rotation: [0., 0., 0., 1.],
                            scale: [1.; 3],
                        },
                        content: ScreenContent::Capture {
                            target: source
                                .as_ref()
                                .map(CaptureSource::target)
                                .unwrap_or(opensekai_contracts::CaptureTarget::Display),
                            source: source.clone(),
                            cursor: *cursor,
                        },
                    })
                    .collect(),
            };
            let plan = capture_plan(&scene, &state.allowed);
            let mut kept = Vec::new();
            for mut stream in std::mem::take(&mut state.streams) {
                match plan.streams.iter().find(|p| p.key == stream.key) {
                    Some(planned) => {
                        stream.screens = planned.screens.clone();
                        kept.push(stream);
                    }
                    None => stream.halt(),
                }
            }
            for planned in &plan.streams {
                if !kept.iter().any(|s| s.key == planned.key) {
                    let mut stream = Stream::new(planned.key.clone(), planned.screens.clone());
                    starts.push(Self::begin(&mut stream));
                    kept.push(stream);
                }
            }
            state.streams = kept;
            state.plan = plan;
        }
        for start in starts {
            self.launch(start);
        }
        self.publish();
    }
    /// Marks a stream as starting and returns what `launch` needs.
    fn begin(stream: &mut Stream) -> (String, u64, StreamKey) {
        stream.generation += 1;
        stream.starting = true;
        stream.state = CaptureState::Starting;
        stream.alone_since = Instant::now();
        stream.last_match = Instant::now();
        (stream.id.clone(), stream.generation, stream.key.clone())
    }
    /// Matches the source and starts the adapter off the async runtime.
    fn launch(self: &Arc<Self>, (id, generation, key): (String, u64, StreamKey)) {
        let shared = self.clone();
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        runtime.spawn(async move {
            let adapter = lock(&shared.adapter).clone();
            let result = tokio::task::spawn_blocking(move || {
                let inventory = adapter.inventory()?;
                let target = match_source(&key.source, &inventory).ok_or(CaptureError::NotFound)?;
                adapter.start(target, StreamConfig::new(key.cursor))
            })
            .await
            .unwrap_or_else(|_| Err(CaptureError::Failed("start".into())));
            shared.started(&id, generation, result);
        });
    }
    fn started(
        self: &Arc<Self>,
        id: &str,
        generation: u64,
        result: Result<StreamHandle, CaptureError>,
    ) {
        {
            let mut state = lock(&self.state);
            let Some(stream) = state
                .streams
                .iter_mut()
                .find(|s| s.id == id && s.generation == generation)
            else {
                if let Ok(handle) = result {
                    handle.control.stop();
                }
                return;
            };
            stream.starting = false;
            match result {
                Ok(StreamHandle { events, control }) => {
                    stream.control = Some(control);
                    let shared = self.clone();
                    let id = id.to_owned();
                    stream.pump = Some(tokio::spawn(async move {
                        shared.pump(id, generation, events).await;
                    }));
                }
                Err(error) => {
                    stream.state = error_state(&error);
                    stream.last_match = Instant::now();
                    for (_, s) in stream.subscribers.drain() {
                        s.signal.close();
                    }
                }
            }
        }
        self.publish();
    }
    async fn pump(
        self: Arc<Self>,
        id: String,
        generation: u64,
        mut events: tokio::sync::mpsc::Receiver<StreamEvent>,
    ) {
        loop {
            let event = events.recv().await;
            let changed = {
                let mut state = lock(&self.state);
                let Some(stream) = state
                    .streams
                    .iter_mut()
                    .find(|s| s.id == id && s.generation == generation)
                else {
                    return;
                };
                let before = (stream.state.clone(), stream.width, stream.height);
                let finished = Self::handle(stream, event);
                let after = (stream.state.clone(), stream.width, stream.height);
                if finished {
                    stream.last_match = Instant::now();
                }
                (before != after, finished)
            };
            if changed.0 {
                self.publish();
            }
            if changed.1 {
                return;
            }
        }
    }
    /// Applies one adapter event. Returns true when the capture stopped.
    fn handle(stream: &mut Stream, event: Option<StreamEvent>) -> bool {
        match event {
            Some(StreamEvent::Config(config)) => {
                stream.width = config.coded_width;
                stream.height = config.coded_height;
                for s in stream.subscribers.values_mut() {
                    s.queue.push_config(&config);
                    s.signal.notify.notify_one();
                }
                stream.config = Some(config);
                stream.key_frame = None;
                false
            }
            Some(StreamEvent::Chunk(chunk)) => {
                if stream.state == CaptureState::Starting {
                    stream.state = CaptureState::Live;
                }
                let mut need_key = false;
                match transport::chunk_message(&chunk) {
                    Some(message) => {
                        let message = Arc::new(message);
                        if chunk.key {
                            stream.key_frame = Some(message.clone());
                        }
                        stream.key_is_latest = chunk.key;
                        for s in stream.subscribers.values_mut() {
                            need_key |=
                                s.queue.push_chunk(chunk.key, message.clone()) == Pushed::Overflow;
                            s.signal.notify.notify_one();
                        }
                    }
                    None => {
                        for s in stream.subscribers.values_mut() {
                            s.queue.skip_to_key();
                        }
                        need_key = !stream.subscribers.is_empty();
                    }
                }
                if need_key {
                    stream.request_key();
                }
                false
            }
            Some(StreamEvent::Paused) => {
                stream.state = CaptureState::Paused;
                false
            }
            Some(StreamEvent::Resumed) => {
                stream.state = CaptureState::Live;
                false
            }
            Some(StreamEvent::Ended) => {
                stream.halt();
                stream.state = CaptureState::Ended;
                true
            }
            Some(StreamEvent::Failed(_)) | None => {
                stream.halt();
                stream.state = CaptureState::Failed;
                true
            }
        }
    }
    /// Each 250 ms: a stream without a subscriber for 5 s goes idle; each 2 s a stream that is
    /// `notFound` or `ended` is matched again.
    fn upkeep(self: &Arc<Self>) {
        let now = Instant::now();
        let mut starts = Vec::new();
        let mut changed = false;
        {
            let mut state = lock(&self.state);
            for stream in &mut state.streams {
                let running = stream.control.is_some() || stream.starting;
                if running
                    && stream.subscribers.is_empty()
                    && now.saturating_duration_since(stream.alone_since) >= IDLE_AFTER
                {
                    stream.halt();
                    stream.state = CaptureState::Idle;
                    stream.width = 0;
                    stream.height = 0;
                    changed = true;
                } else if matches!(stream.state, CaptureState::NotFound | CaptureState::Ended)
                    && !stream.starting
                    && now.saturating_duration_since(stream.last_match) >= REMATCH_INTERVAL
                {
                    stream.last_match = now;
                    starts.push((stream.id.clone(), stream.generation, stream.key.clone()));
                }
            }
        }
        for start in starts {
            self.rematch(start);
        }
        if changed {
            self.publish();
        }
    }
    /// Starts a stream again only when its source matches; otherwise it keeps its state and its
    /// stream ID. A new start gets a new stream ID.
    fn rematch(self: &Arc<Self>, (id, generation, key): (String, u64, StreamKey)) {
        let shared = self.clone();
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        runtime.spawn(async move {
            let adapter = lock(&shared.adapter).clone();
            let source = key.source.clone();
            let found = tokio::task::spawn_blocking(move || {
                adapter
                    .inventory()
                    .ok()
                    .and_then(|i| match_source(&source, &i))
            })
            .await
            .ok()
            .flatten();
            if found.is_none() {
                return;
            }
            let start = {
                let mut state = lock(&shared.state);
                let Some(stream) = state.streams.iter_mut().find(|s| {
                    s.id == id
                        && s.generation == generation
                        && matches!(s.state, CaptureState::NotFound | CaptureState::Ended)
                }) else {
                    return;
                };
                stream.id = stream_id();
                stream.width = 0;
                stream.height = 0;
                Self::begin(stream)
            };
            shared.launch(start);
            shared.publish();
        });
    }
    fn statuses(state: &State) -> Vec<CaptureScreenStatus> {
        state
            .screens
            .iter()
            .filter_map(|(entity, ..)| {
                if state.plan.not_allowed.contains(entity) {
                    return Some(CaptureScreenStatus {
                        entity_id: entity.clone(),
                        stream_id: None,
                        state: CaptureState::NotAllowed,
                        width: 0,
                        height: 0,
                    });
                }
                let stream = state.streams.iter().find(|s| s.screens.contains(entity))?;
                Some(CaptureScreenStatus {
                    entity_id: entity.clone(),
                    stream_id: Some(stream.id.clone()),
                    state: stream.state.clone(),
                    width: stream.width,
                    height: stream.height,
                })
            })
            .collect()
    }
    /// Sends `captureStatus` to the renderers when a value changed (R9).
    fn publish(&self) {
        let message = {
            let mut state = lock(&self.state);
            let screens = Self::statuses(&state);
            if state.published.as_ref() == Some(&screens) {
                return;
            }
            state.published = Some(screens.clone());
            WireMessage::CaptureStatus {
                revision: state.revision,
                screens,
            }
        };
        let sink = lock(&self.sink).clone();
        if let Some(sink) = sink {
            sink(message);
        }
    }
    fn subscribe(
        self: &Arc<Self>,
        stream_id: &str,
        renderer: &str,
    ) -> Result<(u64, Arc<Signal>), u16> {
        let mut start = None;
        let result = {
            let mut state = lock(&self.state);
            let total: usize = state.streams.iter().map(|s| s.subscribers.len()).sum();
            let id = state.next_subscriber;
            let stream = state
                .streams
                .iter_mut()
                .find(|s| s.id == stream_id && subscribable(&s.state))
                .ok_or(transport::CLOSE_UNKNOWN_STREAM)?;
            // A second subscription of one renderer connection replaces the first.
            let replaced: Vec<_> = stream
                .subscribers
                .iter()
                .filter(|(_, s)| s.renderer == renderer)
                .map(|(id, _)| *id)
                .collect();
            for old in &replaced {
                if let Some(s) = stream.subscribers.remove(old) {
                    s.signal.close();
                }
            }
            let total = total - replaced.len();
            if stream.subscribers.len() >= MAX_STREAM_SUBSCRIBERS || total >= MAX_SUBSCRIBERS {
                return Err(transport::CLOSE_LIMIT);
            }
            let signal = Arc::new(Signal::default());
            let queue = SubscriberQueue::starting(
                stream.config.as_ref(),
                stream.key_frame.as_ref(),
                stream.key_is_latest,
            );
            let waiting = stream.key_frame.is_none() || !stream.key_is_latest;
            stream.subscribers.insert(
                id,
                Subscriber {
                    renderer: renderer.into(),
                    queue,
                    signal: signal.clone(),
                },
            );
            if stream.state == CaptureState::Idle {
                start = Some(Self::begin(stream));
            } else if waiting {
                stream.request_key();
            }
            signal.notify.notify_one();
            state.next_subscriber += 1;
            (id, signal)
        };
        if let Some(start) = start {
            self.launch(start);
            self.publish();
        }
        Ok(result)
    }
    fn pop(&self, stream_id: &str, id: u64) -> Option<Outgoing> {
        let mut state = lock(&self.state);
        state
            .streams
            .iter_mut()
            .find(|s| s.id == stream_id)?
            .subscribers
            .get_mut(&id)?
            .queue
            .pop()
    }
    fn unsubscribe(&self, stream_id: &str, id: u64) {
        let mut state = lock(&self.state);
        if let Some(stream) = state.streams.iter_mut().find(|s| s.id == stream_id) {
            if stream.subscribers.remove(&id).is_some() && stream.subscribers.is_empty() {
                stream.alone_since = Instant::now();
            }
        }
    }
}
/// An error for a command that needs a valid source.
pub fn invalid_source() -> AppError {
    AppError {
        code: ErrorCode::InvalidInput,
        message: "Invalid capture source".into(),
        ids: vec![],
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn inventory() -> Inventory {
        Inventory {
            displays: vec![
                DisplayInfo {
                    id: 1,
                    name: "DELL U2720Q".into(),
                    width: 3840,
                    height: 2160,
                },
                DisplayInfo {
                    id: 2,
                    name: "DELL U2720Q".into(),
                    width: 3840,
                    height: 2160,
                },
            ],
            windows: vec![
                WindowInfo {
                    id: 3,
                    app: "com.example.chat".into(),
                    app_name: "Chat".into(),
                    title: "Stream\tChat".into(),
                    width: 400,
                    height: 600,
                },
                WindowInfo {
                    id: 4,
                    app: "com.example.tiny".into(),
                    app_name: "Tiny".into(),
                    title: "Dot".into(),
                    width: 16,
                    height: 16,
                },
                WindowInfo {
                    id: 5,
                    app: "com.example.notitle".into(),
                    app_name: "No Title".into(),
                    title: "".into(),
                    width: 400,
                    height: 600,
                },
            ],
        }
    }
    #[test]
    fn the_source_list_labels_ordinals_and_windows() {
        let entries = source_entries(&inventory());
        let labels: Vec<_> = entries.iter().map(|e| e.label.as_str()).collect();
        assert_eq!(
            labels,
            [
                "DELL U2720Q",
                "DELL U2720Q (2)",
                "Chat — Stream Chat",
                "No Title"
            ]
        );
        assert_eq!(
            entries[1].source,
            CaptureSource::Display {
                name: "DELL U2720Q".into(),
                ordinal: 1
            }
        );
        assert_eq!(
            entries[2].source,
            CaptureSource::Window {
                app: "com.example.chat".into(),
                title: "Stream Chat".into()
            }
        );
    }
    #[test]
    fn the_source_list_has_at_most_64_windows() {
        let mut inv = inventory();
        inv.windows = (0..70)
            .map(|n| WindowInfo {
                id: n,
                app: "a".into(),
                app_name: "A".into(),
                title: format!("{n}"),
                width: 100,
                height: 100,
            })
            .collect();
        assert_eq!(source_entries(&inv).len(), 2 + MAX_LISTED_WINDOWS);
    }
    #[test]
    fn stream_config_scales_down_to_even_sides() {
        let config = StreamConfig::new(true);
        assert_eq!(config.scaled(3840, 2160), (1920, 1080));
        assert_eq!(config.scaled(1000, 501), (1000, 500));
        assert_eq!(config.scaled(5120, 1440), (1920, 540));
        assert_eq!(config.scaled(801, 3000), (288, 1080));
    }
}
