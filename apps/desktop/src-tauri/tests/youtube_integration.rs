// Integration test (B25 Operation 5): the YouTube client crosses a real HTTP socket to a local
// mock of the channel `/live` page, the live chat page, and `get_live_chat`, and its events
// cross the real WebSocket clock envelope to a publisher. The pure parts have unit tests in
// `src/youtube/`; this test checks the task, the reconnect, the de-duplication, the listen
// flag, the settings file, and the `integrationsSet` and `appStatus` calls together.
//
// `youtube_live_gate` is the live selection gate of R1. It is ignored: it needs the network to
// reach YouTube and runs for 30 minutes.
use axum::{
    extract::State,
    http::{StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use opensekai_contracts::*;
use opensekai_desktop_lib::service::{start_service_with, ServiceConfig, ServiceHandle};
use opensekai_desktop_lib::youtube::{YouTubeConfig, YouTubeHub};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// Every wait of the client is divided by this: a re-check takes 3 s, a poll wait 50 ms.
const DIVISOR: u32 = 20;
const CHANNEL: &str = "https://www.youtube.com/@fixture";

enum PollReply {
    Json(Value),
    Status(u16),
}

#[derive(Default)]
struct Mock {
    channel_page: Mutex<String>,
    chat_pages: Mutex<HashMap<String, String>>,
    polls: Mutex<VecDeque<PollReply>>,
    chat_gets: AtomicUsize,
    posts: AtomicUsize,
    requests: AtomicUsize,
    last_body: Mutex<Value>,
}

fn channel_page(video: Option<&str>) -> String {
    let canonical = video.map_or("https://www.youtube.com/@fixture".to_string(), |v| {
        format!("https://www.youtube.com/watch?v={v}")
    });
    format!(
        r#"<html><head><link rel="canonical" href="{canonical}"></head><body>"isLiveNow":true</body></html>"#
    )
}
fn chat_page(backlog: Vec<Value>, replay: bool) -> String {
    let mut renderer = json!({
        "continuations": [{"invalidationContinuationData": {"continuation": "top", "timeoutMs": 5000}}],
        "actions": backlog,
        "header": {"liveChatHeaderRenderer": {"viewSelector": {"sortFilterSubMenuRenderer": {"subMenuItems": [
            {"title": "Top chat", "continuation": {"reloadContinuationData": {"continuation": "top"}}},
            {"title": "Live chat", "continuation": {"reloadContinuationData": {"continuation": "all"}}}
        ]}}}}
    });
    if replay {
        renderer["isReplay"] = json!(true);
    }
    let config = json!({"INNERTUBE_API_KEY": "mock-key", "INNERTUBE_CONTEXT": {"client": {"clientName": "WEB", "clientVersion": "2.0"}}});
    let data = json!({"contents": {"liveChatRenderer": renderer}});
    format!(
        "<script>ytcfg.set({config});</script><script>window[\"ytInitialData\"] = {data};</script>"
    )
}
fn text_item(id: &str, seconds: u64, message: &str) -> Value {
    json!({"addChatItemAction": {"item": {"liveChatTextMessageRenderer": {
        "id": id, "timestampUsec": (seconds * 1_000_000).to_string(),
        "message": {"runs": [{"text": message}]},
        "authorName": {"simpleText": "Viewer"}, "authorExternalChannelId": "UC0000000000000000000001",
        "authorPhoto": {"thumbnails": [{"url": "//yt3.example.com/v.png"}]}
    }}}})
}
fn super_chat_item(id: &str, seconds: u64) -> Value {
    json!({"addChatItemAction": {"item": {"liveChatPaidMessageRenderer": {
        "id": id, "timestampUsec": (seconds * 1_000_000).to_string(),
        "purchaseAmountText": {"simpleText": "$5.00"}, "bodyBackgroundColor": 4_280_150_454u64,
        "authorName": {"simpleText": "Viewer"}, "authorExternalChannelId": "UC0000000000000000000001"
    }}}})
}
fn reply(actions: Vec<Value>, next: bool) -> PollReply {
    let mut chat = json!({"actions": actions});
    if next {
        chat["continuations"] =
            json!([{"timedContinuationData": {"continuation": "next", "timeoutMs": 1000}}]);
    }
    PollReply::Json(json!({"continuationContents": {"liveChatContinuation": chat}}))
}

async fn mock_live(State(mock): State<Arc<Mock>>) -> Response {
    mock.requests.fetch_add(1, Ordering::SeqCst);
    lock(&mock.channel_page).clone().into_response()
}
async fn mock_chat(State(mock): State<Arc<Mock>>, uri: Uri) -> Response {
    mock.requests.fetch_add(1, Ordering::SeqCst);
    mock.chat_gets.fetch_add(1, Ordering::SeqCst);
    let query = uri.query().unwrap_or_default();
    assert!(query.ends_with("&is_popout=1"), "{query}");
    let video = query
        .strip_prefix("v=")
        .and_then(|q| q.split('&').next())
        .unwrap_or_default();
    match lock(&mock.chat_pages).get(video) {
        Some(page) => page.clone().into_response(),
        None => "<html>no chat</html>".into_response(),
    }
}
async fn mock_poll(State(mock): State<Arc<Mock>>, uri: Uri, body: String) -> Response {
    mock.requests.fetch_add(1, Ordering::SeqCst);
    mock.posts.fetch_add(1, Ordering::SeqCst);
    assert_eq!(uri.query(), Some("key=mock-key&prettyPrint=false"));
    *lock(&mock.last_body) = serde_json::from_str(&body).unwrap();
    match lock(&mock.polls)
        .pop_front()
        .unwrap_or_else(|| reply(vec![], true))
    {
        PollReply::Json(value) => value.to_string().into_response(),
        PollReply::Status(code) => StatusCode::from_u16(code).unwrap().into_response(),
    }
}
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap()
}

async fn start_mock() -> (Arc<Mock>, String) {
    let mock = Arc::new(Mock::default());
    *lock(&mock.channel_page) = channel_page(None);
    let router = Router::new()
        .route("/@fixture/live", get(mock_live))
        .route("/live_chat", get(mock_chat))
        .route("/youtubei/v1/live_chat/get_live_chat", post(mock_poll))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (mock, format!("http://{address}"))
}

async fn send(s: &mut Socket, v: Value) {
    s.send(Message::Text(v.to_string().into())).await.unwrap();
}
async fn recv(s: &mut Socket) -> Value {
    let m = tokio::time::timeout(Duration::from_secs(5), s.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    serde_json::from_str(&m.into_text().unwrap()).unwrap()
}
async fn auth(d: &ConnectionDescriptor) -> Socket {
    let (mut s, _) = connect_async(&d.ws_url).await.unwrap();
    send(&mut s, json!({"kind":"auth","role":d.role,"token":d.token,"schemaVersion":1,"outputId":d.output_id})).await;
    assert_eq!(recv(&mut s).await["kind"], "authReply");
    s
}

/// A publisher that answers each clock with a frame, records the YouTube events of each clock,
/// and answers `blueprintEdit` with the listen flag of `listening`.
struct Publisher {
    events: Arc<Mutex<Vec<Value>>>,
    clocks: Arc<AtomicU64>,
    listening: Arc<AtomicBool>,
}
fn publisher(mut socket: Socket, session: String) -> Publisher {
    let events = Arc::new(Mutex::new(Vec::new()));
    let clocks = Arc::new(AtomicU64::new(0));
    let listening = Arc::new(AtomicBool::new(true));
    let (e, c, l) = (events.clone(), clocks.clone(), listening.clone());
    tokio::spawn(async move {
        let mut sequence = 0u64;
        let mut revision = 0u64;
        while let Some(Ok(message)) = socket.next().await {
            let Ok(text) = message.into_text() else { break };
            // A close or ping frame has no JSON text.
            let Ok(value) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            if value["kind"] == "clock" {
                c.fetch_add(1, Ordering::SeqCst);
                // The clock passes the shared wire checks on this side too.
                parse_wire(text.as_bytes()).unwrap();
                if let Some(list) = value["input"]["youtube"]["events"].as_array() {
                    assert!((1..=8).contains(&list.len()));
                    lock(&e).extend(list.iter().cloned());
                }
                sequence += 1;
                let frame = json!({"kind":"frame","frame":{"schemaVersion":1,"sessionId":session,"sequence":sequence,"tick":sequence,"elapsedMs":sequence as f64,"scene":{"schemaVersion":1,"sceneId":"scene_main","revision":0,"entities":[],"outputs":[]}}});
                if socket
                    .send(Message::Text(frame.to_string().into()))
                    .await
                    .is_err()
                {
                    break;
                }
            } else if value["kind"] == "call" && value["method"] == "blueprintEdit" {
                revision += 1;
                let mut data = json!({"revision": revision, "keystrokes": []});
                if l.load(Ordering::SeqCst) {
                    data["youtube"] = json!(true);
                }
                let reply = json!({"kind":"reply","requestId":value["requestId"],"result":{"ok":true,"data":data}});
                if socket
                    .send(Message::Text(reply.to_string().into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        }
    });
    Publisher {
        events,
        clocks,
        listening,
    }
}

struct Operator {
    socket: Socket,
    next: u64,
}
impl Operator {
    async fn call(&mut self, method: &str, params: Value) -> Value {
        self.next += 1;
        let id = format!("r{}", self.next);
        send(
            &mut self.socket,
            json!({"kind":"call","requestId":id,"method":method,"params":params}),
        )
        .await;
        loop {
            let reply = recv(&mut self.socket).await;
            if reply["kind"] == "reply" && reply["requestId"] == id {
                return reply["result"].clone();
            }
        }
    }
    async fn status(&mut self) -> Value {
        self.call("appStatus", json!({})).await["data"]["youtube"].clone()
    }
    async fn set_link(&mut self, link: Value) -> Value {
        self.call("integrationsSet", json!({"youtube": {"link": link}}))
            .await
    }
    async fn edit(&mut self) {
        let result = self
            .call("blueprintEdit", json!({"clientId":"c","batchId":format!("b{}", self.next),"ops":[{"kind":"removeGraph","graphId":"g"}]}))
            .await;
        assert_eq!(result["ok"], true, "{result}");
    }
    /// Polls `appStatus` until the YouTube state is `state`.
    async fn wait_state(&mut self, state: &str) -> Value {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let status = self.status().await;
            if status["state"] == state {
                return status;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "state {state} not reached: {status}"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

/// Waits until the recorded events hold one whose `id` (or `status`) is `key`.
async fn wait_event(events: &Arc<Mutex<Vec<Value>>>, key: &str) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while !lock(events)
        .iter()
        .any(|e| e["id"] == key || e["status"] == key)
    {
        assert!(
            tokio::time::Instant::now() < deadline,
            "no event {key}: {:?}",
            lock(events)
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
fn ids(events: &[Value]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| e["id"].as_str().map(str::to_string))
        .collect()
}
fn statuses(events: &[Value]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| e["status"].as_str().map(str::to_string))
        .collect()
}

async fn service(base: &str) -> (tempfile::TempDir, ServiceHandle) {
    let dir = tempfile::tempdir().unwrap();
    let manifest = dir.path().join("manifest.json");
    std::fs::write(
        &manifest,
        r#"{"schemaVersion":1,"fixtureId":"smoke_v1","assets":[]}"#,
    )
    .unwrap();
    let service = start_service_with(
        ServiceConfig {
            output_root: dir.path().into(),
            asset_manifest: manifest,
            evidence_root: dir.path().join("evidence"),
            evaluation_enabled: false,
        },
        YouTubeConfig {
            base_url: base.into(),
            time_divisor: DIVISOR,
        },
    )
    .await
    .unwrap();
    (dir, service)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_channel_link_reads_chat_reconnects_without_duplicates_and_ends() {
    let (mock, base) = start_mock().await;
    let (dir, s) = service(&base).await;
    let pd = s.publisher_descriptor();
    let publisher = publisher(auth(&pd).await, pd.session_id.clone());
    let mut o = Operator {
        socket: auth(&s.operator_descriptor()).await,
        next: 0,
    };
    // A graph with a YouTube node: the session reports the listen flag.
    o.edit().await;
    assert_eq!(o.status().await["state"], "notConnected");

    // A channel link while the channel is not live: waiting, and the link is stored.
    let set = o.set_link(json!(CHANNEL)).await;
    assert_eq!(set["data"]["state"], "waiting", "{set}");
    assert_eq!(set["data"]["link"], CHANNEL);
    let stored = dir.path().join("settings").join("integrations.json");
    assert_eq!(
        serde_json::from_slice::<Value>(&std::fs::read(&stored).unwrap()).unwrap(),
        json!({"youtube": {"link": CHANNEL}})
    );
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(o.status().await["state"], "waiting");
    assert_eq!(mock.chat_gets.load(Ordering::SeqCst), 0);

    // The channel goes live. The backlog on the first bootstrap starts nothing.
    lock(&mock.chat_pages).insert(
        "liveVideo01".into(),
        chat_page(vec![text_item("before_1", 100, "before")], false),
    );
    lock(&mock.polls).push_back(reply(
        vec![
            text_item("chat_1", 200, "hello"),
            super_chat_item("super_1", 201),
        ],
        true,
    ));
    *lock(&mock.channel_page) = channel_page(Some("liveVideo01"));
    let live = o.wait_state("live").await;
    assert_eq!(live["videoId"], "liveVideo01");
    wait_event(&publisher.events, "super_1").await;
    {
        let events = lock(&publisher.events);
        assert_eq!(ids(&events), ["chat_1", "super_1"]);
        assert_eq!(
            *events.iter().find(|e| e["id"] == "super_1").unwrap(),
            json!({"kind":"superChat","id":"super_1","message":"","username":"Viewer","userChannelId":"UC0000000000000000000001","avatarUrl":"","amount":"$5.00","amountMicros":5_000_000,"currency":"USD","tierColor":"#1DE9B6"})
        );
        assert_eq!(
            events.iter().find(|e| e["id"] == "chat_1").unwrap()["avatarUrl"],
            "https://yt3.example.com/v.png"
        );
    }
    let body = lock(&mock.last_body).clone();
    assert_eq!(body["context"]["client"]["hl"], "en");
    assert_eq!(body["context"]["client"]["gl"], "US");

    // Two failed polls: error, then a new bootstrap whose backlog repeats chat_1 and holds the
    // gap item. The gap item arrives once, chat_1 never again, and the state is live again.
    lock(&mock.chat_pages).insert(
        "liveVideo01".into(),
        chat_page(
            vec![
                text_item("before_1", 100, "before"),
                text_item("chat_1", 200, "hello"),
                text_item("gap_1", 202, "during the gap"),
            ],
            false,
        ),
    );
    {
        let mut polls = lock(&mock.polls);
        polls.push_back(PollReply::Status(500));
        polls.push_back(PollReply::Status(503));
    }
    let gets = mock.chat_gets.load(Ordering::SeqCst);
    o.wait_state("error").await;
    wait_event(&publisher.events, "gap_1").await;
    let again = o.wait_state("live").await;
    assert!(mock.chat_gets.load(Ordering::SeqCst) > gets);
    assert_eq!(
        ids(&lock(&publisher.events)),
        ["chat_1", "super_1", "gap_1"]
    );
    assert_eq!(again["items"], 3);
    assert_eq!(again["error"], Value::Null);

    // A reply without a continuation and without an end signal.
    lock(&mock.polls).push_back(reply(vec![], false));
    let changed = o.wait_state("error").await;
    assert_eq!(changed["error"], "Chat page changed");
    o.wait_state("live").await;

    // The chat ends. The channel page still names the ended video, so it does not resolve again.
    lock(&mock.polls).push_back(reply(
        vec![json!({"addChatItemAction": {"item": {"liveChatEndedRenderer": {}}}})],
        true,
    ));
    o.wait_state("ended").await;
    o.wait_state("waiting").await;
    let gets = mock.chat_gets.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(3500)).await;
    assert_eq!(o.status().await["state"], "waiting");
    assert_eq!(mock.chat_gets.load(Ordering::SeqCst), gets);
    let seen = statuses(&lock(&publisher.events));
    assert_eq!(
        seen,
        ["waiting", "live", "error", "live", "error", "live", "ended", "waiting"],
        "{seen:?}"
    );

    // A replay page is ended, never live.
    lock(&mock.chat_pages).insert("replayVid01".into(), chat_page(vec![], true));
    let replay = o.set_link(json!("https://youtu.be/replayVid01")).await;
    assert_eq!(replay["data"]["state"], "waiting");
    let ended = o.wait_state("ended").await;
    assert_eq!(ended["videoId"], "replayVid01");
    let posts = mock.posts.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(mock.posts.load(Ordering::SeqCst), posts);

    // No listening graph: the client still reads chat, but no event rides the clock.
    publisher.listening.store(false, Ordering::SeqCst);
    o.edit().await;
    lock(&mock.chat_pages).insert("liveVideo02".into(), chat_page(vec![], false));
    lock(&mock.polls).push_back(reply(vec![text_item("quiet_1", 300, "unheard")], true));
    let before = lock(&publisher.events).len();
    o.set_link(json!("https://www.youtube.com/watch?v=liveVideo02"))
        .await;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while o.status().await["items"] != 1 {
        assert!(tokio::time::Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let clocks = publisher.clocks.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(publisher.clocks.load(Ordering::SeqCst) > clocks);
    assert_eq!(lock(&publisher.events).len(), before);
    assert_eq!(o.status().await["dropped"], 0);

    // An invalid link: INVALID_INPUT with the reason, and the old link stays.
    let invalid = o
        .set_link(json!("https://example.com/watch?v=liveVideo02"))
        .await;
    assert_eq!(
        invalid,
        json!({"ok": false, "error": {"code": "INVALID_INPUT", "message": "Not a YouTube link", "ids": []}})
    );
    let kept = o.status().await;
    assert_eq!(kept["link"], "https://www.youtube.com/watch?v=liveVideo02");
    assert_eq!(kept["state"], "live");

    // Clear the link: not connected, no more requests, and the stored link is null.
    let cleared = o.set_link(Value::Null).await;
    assert_eq!(
        cleared["data"],
        json!({"link": null, "state": "notConnected", "error": null, "videoId": null, "items": 0, "skipped": 0, "redemptions": 0, "dropped": 0})
    );
    let requests = mock.requests.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(mock.requests.load(Ordering::SeqCst), requests);
    assert_eq!(
        serde_json::from_slice::<Value>(&std::fs::read(&stored).unwrap()).unwrap(),
        json!({"youtube": {"link": null}})
    );
    s.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stored_link_starts_at_startup_and_shutdown_stops_requests() {
    let (mock, base) = start_mock().await;
    lock(&mock.chat_pages).insert("liveVideo01".into(), chat_page(vec![], false));
    let dir = tempfile::tempdir().unwrap();
    let settings = dir.path().join("settings");
    std::fs::create_dir_all(&settings).unwrap();
    std::fs::write(
        settings.join("integrations.json"),
        r#"{"youtube":{"link":"https://youtu.be/liveVideo01"}}"#,
    )
    .unwrap();
    let manifest = dir.path().join("manifest.json");
    std::fs::write(
        &manifest,
        r#"{"schemaVersion":1,"fixtureId":"smoke_v1","assets":[]}"#,
    )
    .unwrap();
    let s = start_service_with(
        ServiceConfig {
            output_root: dir.path().into(),
            asset_manifest: manifest,
            evidence_root: dir.path().join("evidence"),
            evaluation_enabled: false,
        },
        YouTubeConfig {
            base_url: base,
            time_divisor: DIVISOR,
        },
    )
    .await
    .unwrap();
    let mut o = Operator {
        socket: auth(&s.operator_descriptor()).await,
        next: 0,
    };
    let live = o.wait_state("live").await;
    assert_eq!(live["link"], "https://youtu.be/liveVideo01");
    // Without a publisher, nothing listens.
    s.shutdown().await.unwrap();
    let requests = mock.requests.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(mock.requests.load(Ordering::SeqCst), requests);
}

/// The live gate of R1. Run on a computer that reaches YouTube:
/// `OPENSEKAI_YOUTUBE_GATE_LINKS="<watch link> <youtu.be link> <@handle link>" cargo test -p opensekai-desktop --test youtube_integration -- --ignored --nocapture`.
/// `OPENSEKAI_YOUTUBE_GATE_MINUTES` shortens the 30-minute run for a smoke check.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "needs the network to reach YouTube and runs for 30 minutes"]
async fn youtube_live_gate() {
    let links: Vec<String> = std::env::var("OPENSEKAI_YOUTUBE_GATE_LINKS")
        .expect("set OPENSEKAI_YOUTUBE_GATE_LINKS")
        .split_whitespace()
        .map(str::to_string)
        .collect();
    let minutes: u64 = std::env::var("OPENSEKAI_YOUTUBE_GATE_MINUTES")
        .ok()
        .and_then(|m| m.parse().ok())
        .unwrap_or(30);
    let runs = links.into_iter().map(|link| {
        tokio::spawn(async move {
            let dir = tempfile::tempdir().unwrap();
            let hub = YouTubeHub::new(
                YouTubeConfig::default(),
                dir.path().join("integrations.json"),
            );
            hub.set_listening(true);
            hub.set_link(Some(link.clone())).await.unwrap();
            let start = tokio::time::Instant::now();
            let total = Duration::from_secs(minutes * 60);
            let (mut seen, mut duplicates, mut errors, mut forced, mut lives_after_force) =
                (std::collections::HashSet::new(), 0u64, 0u64, false, 0u64);
            while start.elapsed() < total {
                if !forced && start.elapsed() > total / 2 {
                    hub.probe().force_reconnect.store(true, Ordering::SeqCst);
                    forced = true;
                }
                while let Some(input) = hub.take_clock_events() {
                    for event in input.events {
                        match event {
                            YouTubeEvent::Status { status } => {
                                if status == YouTubeStreamStatus::Error {
                                    errors += 1;
                                }
                                if forced && status == YouTubeStreamStatus::Live {
                                    lives_after_force += 1;
                                }
                            }
                            other => {
                                let id = serde_json::to_value(&other).unwrap()["id"]
                                    .as_str()
                                    .unwrap()
                                    .to_string();
                                if !seen.insert(id) {
                                    duplicates += 1;
                                }
                            }
                        }
                    }
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            let status = hub.status();
            let margin = *hub.probe().min_wait_margin_ms.lock().unwrap();
            let polls = *hub.probe().polls.lock().unwrap();
            hub.shutdown().await;
            // One error is the forced reconnect.
            let unforced = errors.saturating_sub(forced as u64);
            let passed = status.video_id.is_some()
                && polls > 0
                && duplicates == 0
                && unforced == 0
                && lives_after_force > 0
                && margin.is_some_and(|m| m >= 0);
            println!(
                "gate: link={link} video={:?} state={:?} minutes={minutes} items={} polls={polls} duplicates={duplicates} unforced_errors={unforced} live_after_reconnect={} min_wait_margin_ms={margin:?} skipped={} redemptions={} result={}",
                status.video_id,
                status.state,
                seen.len(),
                lives_after_force > 0,
                status.skipped,
                status.redemptions,
                if passed { "pass" } else { "fail" }
            );
            passed
        })
    });
    let results: Vec<bool> = futures_util::future::join_all(runs)
        .await
        .into_iter()
        .map(Result::unwrap)
        .collect();
    let passed = results.iter().filter(|p| **p).count();
    println!("gate: {passed} of {} streams passed", results.len());
    assert!(
        results.len() >= 3 && results.len() - passed < 2,
        "R1: two or more streams failed; stop and ask on #197"
    );
}
