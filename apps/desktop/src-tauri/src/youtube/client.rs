//! The YouTube chat client (B25 R5 to R18): one task for the current link that resolves the
//! video, reads the live chat page, polls `get_live_chat`, and queues typed events for the
//! session clock. Parsing and timing are pure functions; the task only does the requests.
use super::link::{channel_live_url, parse_stream_link, StreamTarget};
use super::parse::{chat_page, poll_reply, poll_wait, Actions, ChatItem, ChatPage, Innertube};
use super::settings;
use opensekai_contracts::*;
use serde_json::{json, Value};
use std::{
    collections::{HashSet, VecDeque},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{Duration, Instant},
};
use tokio::{sync::watch, task::JoinHandle};

/// At most this many events wait for the clock; an overflow drops the oldest (R10).
pub const MAX_QUEUED_EVENTS: usize = 256;
/// The serialized JSON budget of the YouTube events in one clock (R10).
pub const CLOCK_EVENT_BYTES: usize = 24 * 1024;
/// The item IDs that one link remembers (R12).
pub const SEEN_CAPACITY: usize = 4096;
/// After a reconnect, unseen backlog items newer than the newest seen timestamp minus this are queued (R12).
pub const BACKLOG_WINDOW_USEC: u64 = 5_000_000;
/// The wait before a new check of a waiting stream or an ended channel (R5, R6, R7a).
pub const RECHECK: Duration = Duration::from_secs(60);
const PAGE_BYTES: usize = 4 * 1024 * 1024;
const POLL_BYTES: usize = 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_REDIRECTS: usize = 5;
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MAX_COUNT: u64 = 9_007_199_254_740_991;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Where the client sends its requests. The app always uses `https://www.youtube.com`; the
/// integration test points it at a local mock.
#[derive(Debug, Clone)]
pub struct YouTubeConfig {
    pub base_url: String,
    /// Tests divide every wait (poll, backoff, re-check) by this. The app uses 1.
    #[doc(hidden)]
    pub time_divisor: u32,
}
impl Default for YouTubeConfig {
    fn default() -> Self {
        Self {
            base_url: "https://www.youtube.com".into(),
            time_divisor: 1,
        }
    }
}

/// `max(1 s, min(60 s, 1 s × 2^attempt) × (0.5 + 0.5 r))` with `r` in `[0, 1)` (R13).
pub fn backoff(attempt: u32, r: f64) -> Duration {
    let base = 2f64.powi(attempt.min(16) as i32).min(60.0);
    Duration::from_secs_f64((base * (0.5 + 0.5 * r.clamp(0.0, 1.0))).max(1.0))
}
fn jitter() -> f64 {
    (uuid::Uuid::new_v4().as_u128() >> 75) as f64 / (1u64 << 53) as f64
}

/// The last `SEEN_CAPACITY` item IDs, evicted in insertion order.
#[derive(Debug, Default)]
pub struct SeenIds {
    set: HashSet<String>,
    order: VecDeque<String>,
}
impl SeenIds {
    /// Records the ID. Returns false when it was already seen.
    pub fn insert(&mut self, id: &str) -> bool {
        if self.set.contains(id) {
            return false;
        }
        if self.order.len() == SEEN_CAPACITY {
            if let Some(oldest) = self.order.pop_front() {
                self.set.remove(&oldest);
            }
        }
        self.set.insert(id.into());
        self.order.push_back(id.into());
        true
    }
    pub fn len(&self) -> usize {
        self.order.len()
    }
    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }
}

/// The de-duplication state of the current link (R12).
#[derive(Debug, Default)]
pub struct LinkMemory {
    seen: SeenIds,
    /// The largest server `timestampUsec` of any item seen for the link.
    latest_usec: Option<u64>,
    /// The video of the last successful bootstrap. A first bootstrap of a video queues nothing.
    video: Option<String>,
}
impl LinkMemory {
    fn note(&mut self, item: &ChatItem) -> bool {
        self.latest_usec = Some(self.latest_usec.unwrap_or(0).max(item.timestamp_usec));
        self.seen.insert(&item.id)
    }
    /// The backlog items of a bootstrap that start Blueprints: none on the first bootstrap of a
    /// video, else the unseen items newer than `latest_usec` minus 5 s, in timestamp order.
    pub fn admit_backlog(&mut self, video: &str, mut items: Vec<ChatItem>) -> Vec<ChatItem> {
        let first = self.video.as_deref() != Some(video);
        self.video = Some(video.into());
        let cutoff = self
            .latest_usec
            .map(|l| l.saturating_sub(BACKLOG_WINDOW_USEC));
        items.sort_by_key(|item| item.timestamp_usec);
        items
            .into_iter()
            .filter(|item| {
                let new = self.note(item);
                new && !first && cutoff.is_none_or(|cutoff| item.timestamp_usec > cutoff)
            })
            .collect()
    }
    /// The unseen items of a poll, in reply order.
    pub fn admit(&mut self, items: Vec<ChatItem>) -> Vec<ChatItem> {
        items.into_iter().filter(|item| self.note(item)).collect()
    }
}

/// The events that wait for the clock.
#[derive(Debug, Default)]
pub struct EventQueue {
    events: VecDeque<YouTubeEvent>,
    pub dropped: u64,
}
impl EventQueue {
    pub fn push(&mut self, event: YouTubeEvent) {
        if self.events.len() == MAX_QUEUED_EVENTS {
            self.events.pop_front();
            self.dropped = (self.dropped + 1).min(MAX_COUNT);
        }
        self.events.push_back(event);
    }
    pub fn clear(&mut self) {
        self.events.clear();
    }
    pub fn len(&self) -> usize {
        self.events.len()
    }
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
    /// At most 8 events from the front that fit the 24 KiB budget; the rest stay (R10).
    pub fn take_for_clock(&mut self) -> Option<YouTubeInput> {
        let mut bytes = 0;
        let mut taken = 0;
        for event in self.events.iter().take(MAX_YOUTUBE_CLOCK_EVENTS) {
            let size = json!(event).to_string().len() + 1;
            if taken > 0 && bytes + size > CLOCK_EVENT_BYTES {
                break;
            }
            bytes += size;
            taken += 1;
        }
        (taken > 0).then(|| YouTubeInput {
            events: self.events.drain(..taken).collect(),
        })
    }
}

/// The status event for a state change between `waiting`, `live`, `ended`, and `error` (R10).
pub fn status_event(previous: YouTubeState, next: YouTubeState) -> Option<YouTubeEvent> {
    let status = match next {
        YouTubeState::Waiting => YouTubeStreamStatus::Waiting,
        YouTubeState::Live => YouTubeStreamStatus::Live,
        YouTubeState::Ended => YouTubeStreamStatus::Ended,
        YouTubeState::Error => YouTubeStreamStatus::Error,
        YouTubeState::NotConnected => return None,
    };
    (previous != next).then_some(YouTubeEvent::Status { status })
}

/// Live gate measurements (R1). The app never reads them.
#[doc(hidden)]
#[derive(Debug, Default)]
pub struct GateProbe {
    /// The next poll fails as a network error, to force a reconnect.
    pub force_reconnect: AtomicBool,
    /// The smallest time between a reply and the next poll, minus the server `timeoutMs`.
    pub min_wait_margin_ms: Mutex<Option<i64>>,
    pub polls: Mutex<u64>,
}

#[derive(Default)]
struct HubState {
    link: Option<String>,
    generation: u64,
    state: Option<YouTubeState>,
    error: Option<String>,
    video_id: Option<String>,
    items: u64,
    skipped: u64,
    redemptions: u64,
    queue: EventQueue,
    listening: bool,
    stop: Option<watch::Sender<bool>>,
    task: Option<JoinHandle<()>>,
}
impl HubState {
    fn current(&self) -> YouTubeState {
        self.state.unwrap_or(YouTubeState::NotConnected)
    }
    fn queue(&mut self, event: YouTubeEvent) {
        if self.listening {
            self.queue.push(event);
        }
    }
    fn set_state(&mut self, state: YouTubeState, error: Option<String>) {
        if let Some(event) = status_event(self.current(), state) {
            self.queue(event);
        }
        self.state = Some(state);
        self.error = error;
    }
}

/// The YouTube integration of the host: the stored link, the client task, the status, and the
/// event queue. One hub for each service; at most one client task at a time.
pub struct YouTubeHub {
    config: YouTubeConfig,
    settings: PathBuf,
    state: Mutex<HubState>,
    /// Serializes `set_link`, so the stored file and the running client name the same link.
    setting: tokio::sync::Mutex<()>,
    probe: GateProbe,
}

#[derive(Debug)]
enum Fetch {
    Network,
    Http(u16),
    TooLarge,
    Consent,
}
impl Fetch {
    fn text(&self) -> String {
        match self {
            Fetch::Network => "Network".into(),
            Fetch::Http(code) => format!("HTTP {code}"),
            Fetch::TooLarge => "Chat page changed".into(),
            Fetch::Consent => "Consent page".into(),
        }
    }
}

/// What ended one watch of a video.
enum Watch {
    Ended,
    /// No live chat yet: check again after 60 s (a channel resolves again).
    NoChat,
    Stopped,
}

impl YouTubeHub {
    pub fn new(config: YouTubeConfig, settings: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            config,
            settings,
            state: Mutex::default(),
            setting: tokio::sync::Mutex::new(()),
            probe: GateProbe::default(),
        })
    }
    #[doc(hidden)]
    pub fn probe(&self) -> &GateProbe {
        &self.probe
    }
    /// Starts the client from the stored link, if any. Call it once at startup.
    pub fn start_stored(self: &Arc<Self>) {
        if let Some(link) = settings::load(&self.settings) {
            if let Ok(target) = parse_stream_link(&link) {
                let mut state = lock(&self.state);
                state.link = Some(link);
                self.start_locked(&mut state, target);
            }
        }
    }
    pub fn status(&self) -> YouTubeStatus {
        let state = lock(&self.state);
        YouTubeStatus {
            link: state.link.clone(),
            state: state.current(),
            error: state.error.clone(),
            video_id: state.video_id.clone(),
            items: state.items,
            skipped: state.skipped,
            redemptions: state.redemptions,
            dropped: state.queue.dropped,
        }
    }
    /// Whether a listened graph has a YouTube node and a publisher is connected. Events are
    /// queued only while this is true; turning it off drops the queued events.
    pub fn set_listening(&self, listening: bool) {
        let mut state = lock(&self.state);
        state.listening = listening;
        if !listening {
            state.queue.clear();
        }
    }
    /// The events for the next clock (R10).
    pub fn take_clock_events(&self) -> Option<YouTubeInput> {
        lock(&self.state).queue.take_for_clock()
    }
    /// `integrationsSet` (R3): checks, stores, and restarts the client. An invalid link changes
    /// nothing.
    pub async fn set_link(
        self: &Arc<Self>,
        link: Option<String>,
    ) -> Result<YouTubeStatus, AppError> {
        let _setting = self.setting.lock().await;
        let link = link.map(|l| l.trim().to_string()).filter(|l| !l.is_empty());
        let target = link
            .as_deref()
            .map(parse_stream_link)
            .transpose()
            .map_err(|error| invalid(error.reason()))?;
        let path = self.settings.clone();
        let stored = link.clone();
        tokio::task::spawn_blocking(move || settings::save(&path, stored.as_deref()))
            .await
            .map_err(|_| invalid("Cannot write settings"))??;
        let previous = {
            let mut state = lock(&self.state);
            let previous = self.stop_locked(&mut state);
            let (generation, listening) = (state.generation, state.listening);
            *state = HubState {
                link,
                generation,
                listening,
                ..HubState::default()
            };
            if let Some(target) = target {
                self.start_locked(&mut state, target);
            }
            previous
        };
        if let Some(task) = previous {
            let _ = task.await;
        }
        Ok(self.status())
    }
    /// Stops the client task without waiting for it.
    pub fn stop(&self) {
        let mut state = lock(&self.state);
        if let Some(task) = self.stop_locked(&mut state) {
            task.abort();
        }
    }
    /// Stops the client task and waits for it. No request starts after this returns.
    pub async fn shutdown(&self) {
        let task = self.stop_locked(&mut lock(&self.state));
        if let Some(task) = task {
            let _ = task.await;
        }
    }
    fn stop_locked(&self, state: &mut HubState) -> Option<JoinHandle<()>> {
        state.generation += 1;
        if let Some(stop) = state.stop.take() {
            let _ = stop.send(true);
        }
        state.task.take()
    }
    fn start_locked(self: &Arc<Self>, state: &mut HubState, target: StreamTarget) {
        let (stop, stopped) = watch::channel(false);
        state.generation += 1;
        state.set_state(YouTubeState::Waiting, None);
        let generation = state.generation;
        let hub = self.clone();
        state.stop = Some(stop);
        state.task = Some(tokio::spawn(async move {
            hub.run(generation, target, stopped).await;
        }));
    }
    /// Applies `change` while the task's link is current. Returns false when it is not.
    fn update(&self, generation: u64, change: impl FnOnce(&mut HubState)) -> bool {
        let mut state = lock(&self.state);
        if state.generation != generation {
            return false;
        }
        change(&mut state);
        true
    }
    fn set(&self, generation: u64, next: YouTubeState, error: Option<String>) -> bool {
        self.update(generation, |s| s.set_state(next, error))
    }
    /// Counts a poll reply and queues its new items. Backlog items pass `None`: a page repeats
    /// its backlog at each bootstrap, so only polls count skipped actions and redemptions.
    fn deliver(&self, generation: u64, actions: Option<&Actions>, admitted: Vec<ChatItem>) -> bool {
        self.update(generation, |s| {
            if let Some(actions) = actions {
                s.skipped = (s.skipped + actions.skipped).min(MAX_COUNT);
                s.redemptions = (s.redemptions + actions.redemptions).min(MAX_COUNT);
            }
            s.items = (s.items + admitted.len() as u64).min(MAX_COUNT);
            for item in admitted {
                s.queue(item.event);
            }
        })
    }
    fn scaled(&self, duration: Duration) -> Duration {
        duration / self.config.time_divisor.max(1)
    }
    /// Waits, or returns false at a stop.
    async fn sleep(&self, duration: Duration, stop: &mut watch::Receiver<bool>) -> bool {
        let stopped = tokio::select! {
            _ = tokio::time::sleep(self.scaled(duration)) => false,
            _ = stop.wait_for(|s| *s) => true,
        };
        !stopped && !*stop.borrow()
    }
    fn client(&self) -> Option<reqwest::Client> {
        let jar = reqwest::cookie::Jar::default();
        if let Ok(url) = "https://www.youtube.com".parse() {
            jar.add_cookie_str("SOCS=CAI; Domain=.youtube.com; Path=/", &url);
        }
        let allowed = reqwest::Url::parse(&self.config.base_url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string));
        let policy = reqwest::redirect::Policy::custom(move |attempt| {
            let host = attempt.url().host_str().unwrap_or_default().to_string();
            let youtube = attempt.url().scheme() == "https"
                && (host == "youtube.com" || host.ends_with(".youtube.com"));
            if attempt.previous().len() > MAX_REDIRECTS {
                attempt.error("too many redirects")
            } else if youtube || allowed.as_deref() == Some(host.as_str()) {
                attempt.follow()
            } else {
                attempt.error("redirect off YouTube")
            }
        });
        reqwest::Client::builder()
            .cookie_provider(Arc::new(jar))
            .user_agent(USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(policy)
            .build()
            .ok()
    }
    /// Sends the request and reads at most `limit` bytes of a 200 reply.
    async fn fetch(request: reqwest::RequestBuilder, limit: usize) -> Result<Vec<u8>, Fetch> {
        let mut response = request.send().await.map_err(|_| Fetch::Network)?;
        if response.url().host_str() == Some("consent.youtube.com") {
            return Err(Fetch::Consent);
        }
        if response.status() != reqwest::StatusCode::OK {
            return Err(Fetch::Http(response.status().as_u16()));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Fetch::Network)? {
            if body.len() + chunk.len() > limit {
                return Err(Fetch::TooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }
    /// A request that a stop cancels. `None` at a stop.
    async fn request(
        &self,
        request: reqwest::RequestBuilder,
        limit: usize,
        stop: &mut watch::Receiver<bool>,
    ) -> Option<Result<Vec<u8>, Fetch>> {
        if *stop.borrow() {
            return None;
        }
        tokio::select! {
            result = Self::fetch(request, limit) => Some(result),
            _ = stop.wait_for(|s| *s) => None,
        }
    }

    async fn run(
        self: Arc<Self>,
        generation: u64,
        target: StreamTarget,
        mut stop: watch::Receiver<bool>,
    ) {
        // Without the restricted client, the task makes no request.
        let Some(client) = self.client() else {
            self.set(generation, YouTubeState::Error, Some("Network".into()));
            return;
        };
        let base = self.config.base_url.trim_end_matches('/').to_string();
        let mut memory = LinkMemory::default();
        let mut attempt = 0u32;
        let mut last_ended: Option<String> = None;
        loop {
            let video = match &target {
                StreamTarget::Video(id) => id.clone(),
                StreamTarget::Channel(path) => {
                    let request = client.get(channel_live_url(&base, path));
                    let Some(result) = self.request(request, PAGE_BYTES, &mut stop).await else {
                        return;
                    };
                    let page = match result {
                        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
                        Err(error) => {
                            if !self
                                .retry(generation, &error.text(), &mut attempt, &mut stop)
                                .await
                            {
                                return;
                            }
                            continue;
                        }
                    };
                    match super::parse::canonical_video_id(&page) {
                        Some(id)
                            if last_ended.as_ref() != Some(&id)
                                && !super::parse::page_finished(&page) =>
                        {
                            attempt = 0;
                            id
                        }
                        _ => {
                            attempt = 0;
                            if !self.set(generation, YouTubeState::Waiting, None)
                                || !self.sleep(RECHECK, &mut stop).await
                            {
                                return;
                            }
                            continue;
                        }
                    }
                }
            };
            if !self.update(generation, |s| s.video_id = Some(video.clone())) {
                return;
            }
            match self
                .watch(
                    generation,
                    &client,
                    &base,
                    &video,
                    &mut memory,
                    &mut attempt,
                    &mut stop,
                )
                .await
            {
                Watch::Stopped => return,
                Watch::NoChat => {
                    if !self.set(generation, YouTubeState::Waiting, None)
                        || !self.sleep(RECHECK, &mut stop).await
                    {
                        return;
                    }
                }
                Watch::Ended => {
                    if !self.set(generation, YouTubeState::Ended, None) {
                        return;
                    }
                    // R7a: a video link stays ended and makes no more requests.
                    let StreamTarget::Channel(_) = target else {
                        return;
                    };
                    last_ended = Some(video);
                    if !self.sleep(RECHECK, &mut stop).await
                        || !self.set(generation, YouTubeState::Waiting, None)
                    {
                        return;
                    }
                }
            }
        }
    }

    /// Sets `error`, waits the backoff, and counts the attempt. False at a stop.
    async fn retry(
        &self,
        generation: u64,
        error: &str,
        attempt: &mut u32,
        stop: &mut watch::Receiver<bool>,
    ) -> bool {
        if !self.set(generation, YouTubeState::Error, Some(error.into())) {
            return false;
        }
        let wait = backoff(*attempt, jitter());
        *attempt = attempt.saturating_add(1);
        self.sleep(wait, stop).await
    }

    /// Bootstraps the video and polls its chat until it ends, has no chat, or the task stops.
    /// Errors set `error`, wait the backoff, and bootstrap again (R13).
    #[allow(clippy::too_many_arguments)]
    async fn watch(
        &self,
        generation: u64,
        client: &reqwest::Client,
        base: &str,
        video: &str,
        memory: &mut LinkMemory,
        attempt: &mut u32,
        stop: &mut watch::Receiver<bool>,
    ) -> Watch {
        'bootstrap: loop {
            let request = client.get(format!("{base}/live_chat?v={video}&is_popout=1"));
            let Some(result) = self.request(request, PAGE_BYTES, stop).await else {
                return Watch::Stopped;
            };
            let page = match result {
                Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
                Err(error) => {
                    if !self.retry(generation, &error.text(), attempt, stop).await {
                        return Watch::Stopped;
                    }
                    continue;
                }
            };
            let (innertube, mut continuation, backlog) = match chat_page(&page) {
                ChatPage::NoChat => return Watch::NoChat,
                ChatPage::Replay => return Watch::Ended,
                ChatPage::Changed => {
                    if !self
                        .retry(generation, "Chat page changed", attempt, stop)
                        .await
                    {
                        return Watch::Stopped;
                    }
                    continue;
                }
                ChatPage::Live {
                    innertube,
                    continuation,
                    backlog,
                } => (innertube, continuation, backlog),
            };
            let admitted = memory.admit_backlog(video, backlog.items.clone());
            if !self.deliver(generation, None, admitted) {
                return Watch::Stopped;
            }
            if backlog.ended {
                return Watch::Ended;
            }
            let Innertube { api_key, context } = innertube;
            let url = format!(
                "{base}/youtubei/v1/live_chat/get_live_chat?key={api_key}&prettyPrint=false"
            );
            loop {
                let request = client
                    .post(&url)
                    .json(&json!({"context": context, "continuation": continuation}));
                let forced = self.probe.force_reconnect.swap(false, Ordering::SeqCst);
                let result = if forced {
                    Some(Err(Fetch::Network))
                } else {
                    self.request(request, POLL_BYTES, stop).await
                };
                let Some(result) = result else {
                    return Watch::Stopped;
                };
                let reply = result.map_err(|e| e.text()).and_then(|bytes| {
                    serde_json::from_slice::<Value>(&bytes)
                        .ok()
                        .and_then(|body| poll_reply(&body))
                        .ok_or_else(|| "Chat page changed".to_string())
                });
                let reply = match reply {
                    Ok(reply) => reply,
                    Err(error) => {
                        if !self.retry(generation, &error, attempt, stop).await {
                            return Watch::Stopped;
                        }
                        continue 'bootstrap;
                    }
                };
                let received = Instant::now();
                *lock(&self.probe.polls) += 1;
                let admitted = memory.admit(reply.actions.items.clone());
                if !self.deliver(generation, Some(&reply.actions), admitted) {
                    return Watch::Stopped;
                }
                if reply.actions.ended {
                    return Watch::Ended;
                }
                // Only a reply that continues the chat is a successful poll: it resets the
                // backoff and sets `live` (R13). A reply without a continuation backs off.
                let Some((next, timeout_ms)) = reply.next else {
                    if !self
                        .retry(generation, "Chat page changed", attempt, stop)
                        .await
                    {
                        return Watch::Stopped;
                    }
                    continue 'bootstrap;
                };
                *attempt = 0;
                if !self.set(generation, YouTubeState::Live, None) {
                    return Watch::Stopped;
                }
                continuation = next;
                if !self
                    .sleep(Duration::from_millis(poll_wait(timeout_ms)), stop)
                    .await
                {
                    return Watch::Stopped;
                }
                let margin = received.elapsed().as_millis() as i64
                    * self.config.time_divisor.max(1) as i64
                    - timeout_ms.unwrap_or(0) as i64;
                let mut min = lock(&self.probe.min_wait_margin_ms);
                *min = Some(min.map_or(margin, |m| m.min(margin)));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, timestamp_usec: u64) -> ChatItem {
        ChatItem {
            id: id.into(),
            timestamp_usec,
            event: YouTubeEvent::GiftMemberships {
                id: id.into(),
                username: "A".into(),
                user_channel_id: "U".into(),
                count: 1,
            },
        }
    }
    fn ids(items: &[ChatItem]) -> Vec<&str> {
        items.iter().map(|i| i.id.as_str()).collect()
    }

    #[test]
    fn backoff_stays_between_one_and_sixty_seconds() {
        for attempt in 0..=10 {
            let low = backoff(attempt, 0.0);
            let high = backoff(attempt, 0.999_999);
            let base = 2f64.powi(attempt as i32).min(60.0);
            assert!(low >= Duration::from_secs(1), "{attempt}");
            assert!(high <= Duration::from_secs(60), "{attempt}");
            assert_eq!(low, Duration::from_secs_f64((base * 0.5).max(1.0)));
            assert!((high.as_secs_f64() - base).abs() < 1e-3, "{attempt}");
        }
        assert_eq!(backoff(0, 0.0), Duration::from_secs(1));
        assert_eq!(backoff(10, 1.0), Duration::from_secs(60));
        assert!((0.0..1.0).contains(&jitter()));
    }

    #[test]
    fn seen_ids_drop_duplicates_and_evict_the_oldest() {
        let mut seen = SeenIds::default();
        assert!(seen.insert("a"));
        assert!(!seen.insert("a"));
        for n in 1..SEEN_CAPACITY {
            assert!(seen.insert(&n.to_string()));
        }
        assert_eq!(seen.len(), SEEN_CAPACITY);
        // The 4,097th ID evicts "a", the oldest.
        assert!(seen.insert("new"));
        assert_eq!(seen.len(), SEEN_CAPACITY);
        assert!(seen.insert("a"));
        assert!(!seen.insert("new"));
    }

    #[test]
    fn the_first_bootstrap_queues_no_backlog_and_a_reconnect_queues_only_new_items() {
        let mut memory = LinkMemory::default();
        let first =
            memory.admit_backlog("v", vec![item("old1", 1_000_000), item("old2", 2_000_000)]);
        assert!(first.is_empty());
        assert_eq!(
            ids(&memory.admit(vec![item("old2", 2_000_000), item("p1", 20_000_000)])),
            ["p1"]
        );
        // Reconnect: the backlog repeats p1, has one gap item, and one unseen item older than
        // the newest seen timestamp minus 5 s.
        let again = memory.admit_backlog(
            "v",
            vec![
                item("gap2", 22_000_000),
                item("p1", 20_000_000),
                item("stale", 14_000_000),
                item("gap1", 16_000_000),
            ],
        );
        assert_eq!(ids(&again), ["gap1", "gap2"]);
        assert!(memory.admit(vec![item("gap1", 16_000_000)]).is_empty());
        // A new video of a channel link starts as a first bootstrap again.
        assert!(memory
            .admit_backlog("w", vec![item("w1", 30_000_000)])
            .is_empty());
    }

    #[test]
    fn the_queue_drops_the_oldest_at_257_and_takes_by_count_and_bytes() {
        let mut queue = EventQueue::default();
        for n in 0..=MAX_QUEUED_EVENTS {
            queue.push(item(&format!("e{n}"), 0).event);
        }
        assert_eq!((queue.len(), queue.dropped), (MAX_QUEUED_EVENTS, 1));
        let first = queue.take_for_clock().unwrap();
        assert_eq!(first.events.len(), MAX_YOUTUBE_CLOCK_EVENTS);
        assert!(matches!(&first.events[0], YouTubeEvent::GiftMemberships { id, .. } if id == "e1"));
        let mut queue = EventQueue::default();
        let big = |id: &str| YouTubeEvent::Chat {
            id: id.into(),
            message: "あ".repeat(MAX_YOUTUBE_TEXT),
            username: "あ".repeat(MAX_YOUTUBE_NAME),
            user_channel_id: "U".repeat(MAX_YOUTUBE_NAME),
            avatar_url: "a".repeat(MAX_YOUTUBE_TEXT),
            is_member: false,
            is_moderator: false,
            is_owner: false,
            is_verified: false,
        };
        for n in 0..5 {
            queue.push(big(&format!("b{n}")));
        }
        let taken = queue.take_for_clock().unwrap();
        let bytes = json!(taken).to_string().len();
        assert!(
            taken.events.len() < 5 && bytes <= CLOCK_EVENT_BYTES + 32,
            "{bytes}"
        );
        assert_eq!(queue.len(), 5 - taken.events.len());
        assert!(EventQueue::default().take_for_clock().is_none());
    }

    #[test]
    fn status_events_mark_each_change_between_the_four_states() {
        use YouTubeState::*;
        assert_eq!(
            status_event(NotConnected, Waiting),
            Some(YouTubeEvent::Status {
                status: YouTubeStreamStatus::Waiting
            })
        );
        assert_eq!(status_event(Live, Live), None);
        assert_eq!(
            status_event(Error, Live),
            Some(YouTubeEvent::Status {
                status: YouTubeStreamStatus::Live
            })
        );
        assert_eq!(status_event(Live, NotConnected), None);
    }

    #[tokio::test]
    async fn an_invalid_link_changes_nothing_and_listening_off_drops_events() {
        let dir = tempfile::tempdir().unwrap();
        let hub = YouTubeHub::new(
            YouTubeConfig::default(),
            settings::settings_path(dir.path()),
        );
        let error = hub
            .set_link(Some("https://example.com".into()))
            .await
            .unwrap_err();
        assert_eq!(
            (error.code, error.message.as_str()),
            (ErrorCode::InvalidInput, "Not a YouTube link")
        );
        assert_eq!(hub.status().state, YouTubeState::NotConnected);
        assert!(!settings::settings_path(dir.path()).exists());
        hub.set_listening(true);
        let generation = lock(&hub.state).generation;
        hub.update(generation, |s| s.set_state(YouTubeState::Waiting, None));
        assert!(hub.take_clock_events().is_some());
        hub.set_listening(false);
        hub.update(generation, |s| s.set_state(YouTubeState::Live, None));
        assert!(hub.take_clock_events().is_none());
        assert_eq!(
            hub.set_link(Some("   ".into())).await.unwrap().state,
            YouTubeState::NotConnected
        );
    }
}
