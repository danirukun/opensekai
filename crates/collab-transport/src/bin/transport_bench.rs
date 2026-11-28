//! Multiplayer transport benchmark for ADR 0001.
//!
//! Every room holds four peers (slot 0 is the host). All peers run in this process, so
//! `received_at_us - sender_ts_us` is a one-way relay transit time without clock skew between machines.

use std::collections::HashMap;
use std::io::Write as _;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use clap::{Parser, ValueEnum};
use collab_transport::signaling::{ServerEvent, SignalingClient};
use collab_transport::stats::{ImpairmentConfig, StreamMetrics, StreamSummary};
use collab_transport::{
    now_us, AutoUpgradeConfig, AutoUpgradeTransport, MocapTransport, PoseFrame, ReceivedPose,
    RoomCipher, RoomRef, SendOutcome, Str0mTransport, TransportCreds, TransportError,
    TransportKind, TransportStats, WebSocketTransport,
};
use serde::Serialize;
use serde_json::Value;
use tokio::sync::{broadcast, oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::Instant;

const PEERS_PER_ROOM: usize = 4;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const EVENT_TIMEOUT: Duration = Duration::from_secs(10);
const DRAIN: Duration = Duration::from_millis(500);
const FREEZE_LIMIT_MS: f64 = 100.0;
const STEADY_FRAMES_SECS: u64 = 2;
const REJOIN_WAIT_FOR_DROP: Duration = Duration::from_secs(600);
const REJOIN_RECOVERY_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum BenchTransport {
    #[value(name = "websocket")]
    WebSocket,
    #[value(name = "ex_webrtc")]
    ExWebRtc,
    #[value(name = "auto_ex_webrtc")]
    AutoExWebRtc,
    #[value(name = "livekit_lossy")]
    LiveKitLossy,
    #[value(name = "livekit_track")]
    LiveKitTrack,
}

impl BenchTransport {
    fn label(self) -> &'static str {
        match self {
            Self::WebSocket => "websocket",
            Self::ExWebRtc => "ex_webrtc",
            Self::AutoExWebRtc => "auto_ex_webrtc",
            Self::LiveKitLossy => "livekit_lossy",
            Self::LiveKitTrack => "livekit_track",
        }
    }

    fn relay_kind(self) -> TransportKind {
        match self {
            Self::WebSocket => TransportKind::WebSocket,
            Self::ExWebRtc | Self::AutoExWebRtc => TransportKind::ExWebRtc,
            Self::LiveKitLossy | Self::LiveKitTrack => TransportKind::LiveKit,
        }
    }

    fn needs_livekit(self) -> bool {
        matches!(self, Self::LiveKitLossy | Self::LiveKitTrack)
    }
}

fn parse_hz(value: &str) -> Result<u32, String> {
    match value.parse::<u32>() {
        Ok(hz @ (30 | 60)) => Ok(hz),
        _ => Err("hz must be 30 or 60".to_owned()),
    }
}

#[derive(Debug, Clone, Parser)]
#[command(
    name = "transport-bench",
    about = "ADR 0001 multiplayer transport benchmark"
)]
struct Cli {
    /// Relay Phoenix socket, for example ws://127.0.0.1:4002/socket/websocket.
    #[arg(long)]
    relay_url: String,
    #[arg(long, value_enum)]
    transport: BenchTransport,
    #[arg(long, default_value_t = 60, value_parser = parse_hz)]
    hz: u32,
    #[arg(long, default_value_t = 30)]
    duration_secs: u64,
    #[arg(long, default_value_t = 1)]
    rooms: usize,
    /// Receive-side packet loss in percent.
    #[arg(long, default_value_t = 0.0)]
    loss_pct: f64,
    /// Receive-side random delay up to this many milliseconds.
    #[arg(long, default_value_t = 0.0)]
    jitter_ms: f64,
    /// Playout delay of the simulated jitter buffer.
    #[arg(long, default_value_t = 40)]
    jitter_buf_ms: u64,
    /// Wait for a relay restart, then measure host reclaim, guest rejoin, and pose resume.
    #[arg(long)]
    rejoin_check: bool,
    #[arg(long)]
    json_out: Option<PathBuf>,
}

impl Cli {
    fn validate(&self) -> Result<(), String> {
        if self.rooms == 0 {
            return Err("--rooms must be at least 1".to_owned());
        }
        if self.duration_secs == 0 {
            return Err("--duration-secs must be at least 1".to_owned());
        }
        if !(0.0..=100.0).contains(&self.loss_pct) {
            return Err("--loss-pct must be between 0 and 100".to_owned());
        }
        if !self.jitter_ms.is_finite() || self.jitter_ms < 0.0 {
            return Err("--jitter-ms must be 0 or more".to_owned());
        }
        if self.transport.needs_livekit() && !cfg!(feature = "livekit") {
            return Err(format!(
                "--transport {} needs a build with --features livekit",
                self.transport.label()
            ));
        }
        if self.rejoin_check && self.rooms != 1 {
            return Err("--rejoin-check runs one room".to_owned());
        }
        Ok(())
    }

    fn impairment(&self, seed: u64) -> Option<ImpairmentConfig> {
        (self.loss_pct > 0.0 || self.jitter_ms > 0.0).then_some(ImpairmentConfig {
            loss_pct: self.loss_pct,
            jitter_ms: self.jitter_ms,
            seed,
        })
    }
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

type AutoPrimary = Box<dyn Fn() -> Str0mTransport + Send + Sync>;

enum AnyTransport {
    WebSocket(Box<WebSocketTransport>),
    ExWebRtc(Box<Str0mTransport>),
    Auto(Box<AutoUpgradeTransport<WebSocketTransport, Str0mTransport, AutoPrimary>>),
    #[cfg(feature = "livekit")]
    LiveKit(Box<collab_transport::LiveKitTransport>),
}

macro_rules! delegate {
    ($self:expr, $t:ident => $body:expr) => {
        match $self {
            AnyTransport::WebSocket($t) => $body,
            AnyTransport::ExWebRtc($t) => $body,
            AnyTransport::Auto($t) => $body,
            #[cfg(feature = "livekit")]
            AnyTransport::LiveKit($t) => $body,
        }
    };
}

impl MocapTransport for AnyTransport {
    async fn connect(
        &mut self,
        room: RoomRef,
        creds: TransportCreds,
    ) -> Result<(), TransportError> {
        delegate!(self, t => t.connect(room, creds).await)
    }

    fn send_pose(&self, ciphertext: &[u8]) -> SendOutcome {
        delegate!(self, t => t.send_pose(ciphertext))
    }

    fn subscribe(&self) -> broadcast::Receiver<ReceivedPose> {
        delegate!(self, t => t.subscribe())
    }

    fn stats(&self) -> TransportStats {
        delegate!(self, t => t.stats())
    }

    async fn close(&mut self) {
        delegate!(self, t => t.close().await)
    }
}

fn build_transport(
    kind: BenchTransport,
    signaling: &SignalingClient,
    impairment: Option<ImpairmentConfig>,
) -> Result<AnyTransport, String> {
    match kind {
        BenchTransport::WebSocket => Ok(AnyTransport::WebSocket(Box::new(
            WebSocketTransport::new(signaling.clone(), impairment),
        ))),
        BenchTransport::ExWebRtc => Ok(AnyTransport::ExWebRtc(Box::new(Str0mTransport::new(
            signaling.clone(),
            impairment,
        )))),
        BenchTransport::AutoExWebRtc => {
            let ws = WebSocketTransport::new(signaling.clone(), impairment);
            let primary_signaling = signaling.clone();
            let factory: AutoPrimary = Box::new(move || {
                Str0mTransport::new(primary_signaling.clone(), impairment).keep_signaling_on_close()
            });
            Ok(AnyTransport::Auto(Box::new(AutoUpgradeTransport::new(
                ws,
                factory,
                AutoUpgradeConfig::default(),
            ))))
        }
        #[cfg(feature = "livekit")]
        BenchTransport::LiveKitLossy | BenchTransport::LiveKitTrack => {
            let mode = if kind == BenchTransport::LiveKitLossy {
                collab_transport::LiveKitMode::LossyPacket
            } else {
                collab_transport::LiveKitMode::DataTrack
            };
            Ok(AnyTransport::LiveKit(Box::new(
                collab_transport::LiveKitTransport::new(mode, impairment),
            )))
        }
        #[cfg(not(feature = "livekit"))]
        BenchTransport::LiveKitLossy | BenchTransport::LiveKitTrack => Err(format!(
            "{} needs a build with --features livekit",
            kind.label()
        )),
    }
}

struct Member {
    signaling: SignalingClient,
    creds: TransportCreds,
}

async fn next_event(
    events: &mut broadcast::Receiver<ServerEvent>,
    name: &str,
) -> Result<ServerEvent, String> {
    tokio::time::timeout(EVENT_TIMEOUT, async {
        loop {
            match events.recv().await {
                Ok(event) if event.event == name => return Ok(event),
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => {
                    return Err(format!("signalling closed before {name}"))
                }
            }
        }
    })
    .await
    .map_err(|_| format!("no {name} event within {EVENT_TIMEOUT:?}"))?
}

fn creds_of(payload: &Value) -> Result<TransportCreds, String> {
    TransportCreds::from_relay_value(&payload["creds"]).map_err(err)
}

/// Admits one guest through knock and approve and returns its signalling and credentials.
async fn admit_guest(
    relay_url: &str,
    room_id: &str,
    host: &SignalingClient,
    host_events: &mut broadcast::Receiver<ServerEvent>,
    name: &str,
) -> Result<Member, String> {
    let guest = SignalingClient::connect(relay_url, room_id)
        .await
        .map_err(err)?;
    let mut guest_events = guest.subscribe_events();
    guest.knock(name).await.map_err(err)?;
    let knock = next_event(host_events, "knock_received").await?;
    let knock_id = knock.payload["knock_id"]
        .as_str()
        .ok_or("knock without knock_id")?;
    host.approve(knock_id).await.map_err(err)?;
    let approved = next_event(&mut guest_events, "approved").await?;
    Ok(Member {
        creds: creds_of(&approved.payload)?,
        signaling: guest,
    })
}

struct Room {
    id: String,
    host_secret: String,
    members: Vec<Member>,
}

async fn setup_room(
    relay_url: &str,
    room_id: String,
    kind: TransportKind,
    hz: u32,
    peers: usize,
) -> Result<Room, String> {
    let host_secret = format!("bench-secret-{room_id}");
    let host = SignalingClient::connect(relay_url, &room_id)
        .await
        .map_err(err)?;
    let mut host_events = host.subscribe_events();
    let created = host
        .create(&host_secret, kind.as_relay_str(), hz)
        .await
        .map_err(err)?;
    let mut members = vec![Member {
        creds: creds_of(&created)?,
        signaling: host.clone(),
    }];
    for guest_ix in 1..peers {
        let name = format!("bench-{guest_ix}");
        members.push(admit_guest(relay_url, &room_id, &host, &mut host_events, &name).await?);
    }
    Ok(Room {
        id: room_id,
        host_secret,
        members,
    })
}

#[derive(Default)]
struct Collected {
    streams: HashMap<u8, StreamMetrics>,
    latencies_ms: Vec<f64>,
    decode_errors: u64,
    lagged: u64,
}

struct Pump {
    sending: Arc<AtomicBool>,
    stop: oneshot::Sender<()>,
    received: Arc<AtomicU64>,
    first_rx: watch::Receiver<Option<Instant>>,
    join: JoinHandle<(AnyTransport, Collected, TransportStats)>,
}

struct PumpSpec {
    slot: u8,
    hz: u32,
    cipher: Arc<RoomCipher>,
}

/// Sends a pose each tick and records each received pose until `stop` fires.
fn start_pump(transport: AnyTransport, spec: PumpSpec) -> Pump {
    let sending = Arc::new(AtomicBool::new(true));
    let received = Arc::new(AtomicU64::new(0));
    let (stop, mut stop_rx) = oneshot::channel::<()>();
    let (first_tx, first_rx) = watch::channel(None);
    let mut rx = transport.subscribe();
    let join = tokio::spawn({
        let sending = Arc::clone(&sending);
        let received = Arc::clone(&received);
        async move {
            let mut collected = Collected::default();
            let mut ticker =
                tokio::time::interval(Duration::from_secs_f64(1.0 / f64::from(spec.hz)));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut seq = 0u32;
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    _ = ticker.tick(), if sending.load(Ordering::Relaxed) => {
                        let frame = PoseFrame::new(spec.slot, seq, now_us());
                        if let Ok(wire) = spec.cipher.encrypt(&frame) {
                            transport.send_pose(&wire);
                        }
                        seq = seq.wrapping_add(1);
                    }
                    message = rx.recv() => match message {
                        Ok(pose) => record_pose(&spec, &pose, &mut collected, &received, &first_tx),
                        Err(broadcast::error::RecvError::Lagged(n)) => collected.lagged += n,
                        Err(broadcast::error::RecvError::Closed) => break,
                    },
                }
            }
            let stats = transport.stats();
            (transport, collected, stats)
        }
    });
    Pump {
        sending,
        stop,
        received,
        first_rx,
        join,
    }
}

fn record_pose(
    spec: &PumpSpec,
    pose: &ReceivedPose,
    collected: &mut Collected,
    received: &AtomicU64,
    first_tx: &watch::Sender<Option<Instant>>,
) {
    if pose.slot == spec.slot {
        return;
    }
    let Ok(frame) = spec.cipher.decrypt(pose.slot, &pose.ciphertext) else {
        collected.decode_errors += 1;
        return;
    };
    collected.streams.entry(pose.slot).or_default().record(
        frame.seq,
        frame.sender_ts_us,
        pose.received_at_us,
    );
    collected
        .latencies_ms
        .push((pose.received_at_us as i64 - frame.sender_ts_us as i64) as f64 / 1000.0);
    received.fetch_add(1, Ordering::Relaxed);
    first_tx.send_if_modified(|first| first.replace(Instant::now()).is_none());
}

impl Pump {
    async fn finish(self) -> (AnyTransport, Collected, TransportStats) {
        let _ = self.stop.send(());
        self.join.await.expect("pump task")
    }
}

#[derive(Debug, Serialize)]
struct StreamReport {
    room: usize,
    to_slot: u8,
    from_slot: u8,
    #[serde(flatten)]
    summary: StreamSummary,
}

#[derive(Debug, Serialize)]
struct PeerReport {
    room: usize,
    slot: u8,
    connected: bool,
    connect_ms: Option<f64>,
    error: Option<String>,
    sent: u64,
    dropped_backpressure: u64,
    received: u64,
    decode_errors: u64,
    lagged: u64,
    streams: Vec<StreamReport>,
}

#[derive(Debug, Clone, Serialize)]
struct Aggregate {
    received: u64,
    expected: u64,
    loss_pct: f64,
    rfc3550_jitter_ms: f64,
    latency_p50_ms: f64,
    latency_p95_ms: f64,
    latency_p99_ms: f64,
    max_raw_gap_ms: f64,
    max_buffered_freeze_ms: f64,
    freezes_over_100ms: u64,
}

fn percentile(sorted: &[f64], pct: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let rank = (pct / 100.0 * sorted.len() as f64).ceil() as usize;
    sorted[rank.clamp(1, sorted.len()) - 1]
}

fn sorted(mut values: Vec<f64>) -> Vec<f64> {
    values.retain(|v| v.is_finite());
    values.sort_by(f64::total_cmp);
    values
}

fn max_known(values: impl Iterator<Item = f64>) -> f64 {
    values
        .filter(|v| v.is_finite())
        .reduce(f64::max)
        .unwrap_or(f64::NAN)
}

fn mean_known(values: impl Iterator<Item = f64>) -> f64 {
    let (sum, count) = values
        .filter(|v| v.is_finite())
        .fold((0.0, 0u32), |(sum, count), v| (sum + v, count + 1));
    if count == 0 {
        f64::NAN
    } else {
        sum / f64::from(count)
    }
}

/// Loss comes from the pooled counts, latency percentiles from the pooled samples, and gaps from the worst stream.
/// A value that no stream can compute stays `NAN`, never zero.
fn aggregate(streams: &[&StreamSummary], latencies_ms: Vec<f64>) -> Aggregate {
    let received: u64 = streams.iter().map(|s| s.received).sum();
    let expected: u64 = streams.iter().map(|s| s.expected).sum();
    let latencies = sorted(latencies_ms);
    Aggregate {
        received,
        expected,
        loss_pct: if expected == 0 {
            f64::NAN
        } else {
            (expected.saturating_sub(received)) as f64 / expected as f64 * 100.0
        },
        rfc3550_jitter_ms: mean_known(streams.iter().map(|s| s.rfc3550_jitter_ms)),
        latency_p50_ms: percentile(&latencies, 50.0),
        latency_p95_ms: percentile(&latencies, 95.0),
        latency_p99_ms: percentile(&latencies, 99.0),
        max_raw_gap_ms: max_known(streams.iter().map(|s| s.max_raw_gap_ms)),
        max_buffered_freeze_ms: max_known(streams.iter().map(|s| s.max_buffered_freeze_ms)),
        freezes_over_100ms: streams.iter().map(|s| s.freezes_over_100ms).sum(),
    }
}

#[derive(Debug, Serialize)]
struct RunReport {
    transport: &'static str,
    relay_url: String,
    hz: u32,
    duration_secs: u64,
    rooms: usize,
    injected_loss_pct: f64,
    injected_jitter_ms: f64,
    jitter_buf_ms: u64,
    peers_attempted: usize,
    peers_connected: usize,
    ice_success_rate: f64,
    connect_ms_p50: f64,
    connect_ms_max: f64,
    dropped_backpressure: u64,
    aggregate: Aggregate,
    peers: Vec<PeerReport>,
}

fn fmt_ms(value: f64) -> String {
    if value.is_finite() {
        format!("{value:.2} ms")
    } else {
        "unknown".to_owned()
    }
}

fn fmt_pct(value: f64) -> String {
    if value.is_finite() {
        format!("{value:.2}%")
    } else {
        "unknown".to_owned()
    }
}

impl RunReport {
    fn print(&self) {
        let a = &self.aggregate;
        println!(
            "transport-bench {} hz={} duration={}s rooms={} impairment loss={}% jitter={} ms jitter_buf={} ms",
            self.transport,
            self.hz,
            self.duration_secs,
            self.rooms,
            self.injected_loss_pct,
            self.injected_jitter_ms,
            self.jitter_buf_ms
        );
        println!(
            "connected {}/{} (success {}) connect p50 {} max {}",
            self.peers_connected,
            self.peers_attempted,
            fmt_pct(self.ice_success_rate * 100.0),
            fmt_ms(self.connect_ms_p50),
            fmt_ms(self.connect_ms_max)
        );
        for peer in &self.peers {
            println!(
                "  room {} slot {}: {} connect {} sent {} dropped {} received {} decode_errors {}{}",
                peer.room,
                peer.slot,
                if peer.connected { "up" } else { "DOWN" },
                peer.connect_ms.map_or("unknown".to_owned(), fmt_ms),
                peer.sent,
                peer.dropped_backpressure,
                peer.received,
                peer.decode_errors,
                peer.error
                    .as_ref()
                    .map_or(String::new(), |e| format!(" error: {e}"))
            );
        }
        println!(
            "received {}/{} loss {} jitter {} latency p50 {} p95 {} p99 {}",
            a.received,
            a.expected,
            fmt_pct(a.loss_pct),
            fmt_ms(a.rfc3550_jitter_ms),
            fmt_ms(a.latency_p50_ms),
            fmt_ms(a.latency_p95_ms),
            fmt_ms(a.latency_p99_ms)
        );
        println!(
            "max raw gap {} buffered freeze max {} freezes>{FREEZE_LIMIT_MS:.0}ms {}",
            fmt_ms(a.max_raw_gap_ms),
            fmt_ms(a.max_buffered_freeze_ms),
            a.freezes_over_100ms
        );
    }
}

struct Attempt {
    room: usize,
    slot: u8,
    outcome: Result<(AnyTransport, f64), String>,
}

async fn connect_member(cli: &Cli, room_ix: usize, room_id: &str, member: &Member) -> Attempt {
    let slot = member.creds.slot();
    let seed = (room_ix * PEERS_PER_ROOM + usize::from(slot) + 1) as u64;
    let outcome = async {
        let mut transport =
            build_transport(cli.transport, &member.signaling, cli.impairment(seed))?;
        let room = RoomRef {
            room_id: room_id.to_owned(),
            hz: cli.hz,
        };
        let started = Instant::now();
        let connected = tokio::time::timeout(
            CONNECT_TIMEOUT,
            transport.connect(room, member.creds.clone()),
        )
        .await;
        match connected {
            Ok(Ok(())) => Ok((transport, started.elapsed().as_secs_f64() * 1000.0)),
            Ok(Err(error)) => {
                transport.close().await;
                Err(err(error))
            }
            Err(_) => {
                transport.close().await;
                Err(format!("connect timed out after {CONNECT_TIMEOUT:?}"))
            }
        }
    }
    .await;
    Attempt {
        room: room_ix,
        slot,
        outcome,
    }
}

fn room_cipher(room_ix: usize) -> Arc<RoomCipher> {
    let seed = (room_ix as u8).wrapping_mul(31).wrapping_add(7);
    Arc::new(RoomCipher::new([seed; 32], [seed, 1, 2, 3]))
}

async fn run_benchmark(cli: &Cli) -> Result<RunReport, String> {
    let run_id = now_us();
    let setups = futures_util::future::join_all((0..cli.rooms).map(|ix| {
        setup_room(
            &cli.relay_url,
            format!("bench-{run_id}-{ix}"),
            cli.transport.relay_kind(),
            cli.hz,
            PEERS_PER_ROOM,
        )
    }))
    .await;

    let mut peers = Vec::new();
    let mut rooms = Vec::new();
    for (ix, setup) in setups.into_iter().enumerate() {
        match setup {
            Ok(room) => rooms.push((ix, room)),
            Err(error) => {
                eprintln!("room {ix} setup failed: {error}");
                peers.extend((0..PEERS_PER_ROOM).map(|slot| failed_peer(ix, slot as u8, &error)));
            }
        }
    }

    let attempts = futures_util::future::join_all(rooms.iter().flat_map(|(ix, room)| {
        room.members
            .iter()
            .map(move |member| connect_member(cli, *ix, &room.id, member))
    }))
    .await;

    let mut pumps = Vec::new();
    for attempt in attempts {
        match attempt.outcome {
            Ok((transport, connect_ms)) => {
                let spec = PumpSpec {
                    slot: attempt.slot,
                    hz: cli.hz,
                    cipher: room_cipher(attempt.room),
                };
                pumps.push((
                    attempt.room,
                    attempt.slot,
                    connect_ms,
                    start_pump(transport, spec),
                ));
            }
            Err(error) => peers.push(failed_peer(attempt.room, attempt.slot, &error)),
        }
    }

    tokio::time::sleep(Duration::from_secs(cli.duration_secs)).await;
    pumps
        .iter()
        .for_each(|(_, _, _, pump)| pump.sending.store(false, Ordering::Relaxed));
    tokio::time::sleep(DRAIN).await;

    let mut latencies = Vec::new();
    let mut summaries = Vec::new();
    for (room, slot, connect_ms, pump) in pumps {
        let (mut transport, collected, stats) = pump.finish().await;
        transport.close().await;
        let streams = collected
            .streams
            .iter()
            .map(|(from_slot, metrics)| StreamReport {
                room,
                to_slot: slot,
                from_slot: *from_slot,
                summary: metrics.summary(cli.jitter_buf_ms),
            })
            .collect::<Vec<_>>();
        latencies.extend(collected.latencies_ms);
        summaries.extend(streams.iter().map(|s| s.summary.clone()));
        peers.push(PeerReport {
            room,
            slot,
            connected: true,
            connect_ms: Some(connect_ms),
            error: None,
            sent: stats.sent,
            dropped_backpressure: stats.dropped_backpressure,
            received: stats.received,
            decode_errors: collected.decode_errors,
            lagged: collected.lagged,
            streams,
        });
    }
    for (_, room) in &rooms {
        for member in &room.members {
            member.signaling.close().await;
        }
    }
    peers.sort_by_key(|p| (p.room, p.slot));

    let attempted = cli.rooms * PEERS_PER_ROOM;
    let connected = peers.iter().filter(|p| p.connected).count();
    let connect_times = sorted(peers.iter().filter_map(|p| p.connect_ms).collect());
    Ok(RunReport {
        transport: cli.transport.label(),
        relay_url: cli.relay_url.clone(),
        hz: cli.hz,
        duration_secs: cli.duration_secs,
        rooms: cli.rooms,
        injected_loss_pct: cli.loss_pct,
        injected_jitter_ms: cli.jitter_ms,
        jitter_buf_ms: cli.jitter_buf_ms,
        peers_attempted: attempted,
        peers_connected: connected,
        ice_success_rate: connected as f64 / attempted as f64,
        connect_ms_p50: percentile(&connect_times, 50.0),
        connect_ms_max: connect_times.last().copied().unwrap_or(f64::NAN),
        dropped_backpressure: peers.iter().map(|p| p.dropped_backpressure).sum(),
        aggregate: aggregate(&summaries.iter().collect::<Vec<_>>(), latencies),
        peers,
    })
}

fn failed_peer(room: usize, slot: u8, error: &str) -> PeerReport {
    PeerReport {
        room,
        slot,
        connected: false,
        connect_ms: None,
        error: Some(error.to_owned()),
        sent: 0,
        dropped_backpressure: 0,
        received: 0,
        decode_errors: 0,
        lagged: 0,
        streams: Vec::new(),
    }
}

#[derive(Debug, Serialize)]
struct RejoinReport {
    transport: &'static str,
    room_id: String,
    /// Relay disconnect seen by the host until the host `reclaim` succeeds.
    reclaim_ms: f64,
    /// Host `reclaim` until the guest holds a slot again and its transport is connected.
    rejoin_ms: f64,
    /// Relay disconnect seen by the host until the first pose from the guest arrives at the host.
    pose_resume_ms: f64,
}

fn ms_since(from: Instant) -> f64 {
    from.elapsed().as_secs_f64() * 1000.0
}

fn announce(line: &str) {
    println!("{line}");
    let _ = std::io::stdout().flush();
}

async fn connect_pair_member(
    cli: &Cli,
    room_id: &str,
    member: &Member,
    seed: u64,
) -> Result<AnyTransport, String> {
    let mut transport = build_transport(cli.transport, &member.signaling, cli.impairment(seed))?;
    let room = RoomRef {
        room_id: room_id.to_owned(),
        hz: cli.hz,
    };
    match tokio::time::timeout(
        CONNECT_TIMEOUT,
        transport.connect(room, member.creds.clone()),
    )
    .await
    {
        Ok(Ok(())) => Ok(transport),
        Ok(Err(error)) => {
            transport.close().await;
            Err(err(error))
        }
        Err(_) => {
            transport.close().await;
            Err("connect timed out".to_owned())
        }
    }
}

/// Reconnects the host signalling until the relay is back and accepts `reclaim`.
async fn reclaim_host(cli: &Cli, room: &Room) -> Result<(SignalingClient, TransportCreds), String> {
    let deadline = Instant::now() + REJOIN_RECOVERY_TIMEOUT;
    let mut delay = Duration::from_millis(100);
    loop {
        let attempt = async {
            let signaling = SignalingClient::connect(&cli.relay_url, &room.id)
                .await
                .map_err(err)?;
            let reply = signaling
                .reclaim(
                    &room.host_secret,
                    cli.transport.relay_kind().as_relay_str(),
                    cli.hz,
                )
                .await
                .map_err(err)?;
            Ok::<_, String>((signaling, creds_of(&reply)?))
        }
        .await;
        match attempt {
            Ok(result) => return Ok(result),
            Err(error) if Instant::now() >= deadline => {
                return Err(format!("host could not reclaim: {error}"))
            }
            Err(_) => {
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(2));
            }
        }
    }
}

async fn run_rejoin_check(cli: &Cli) -> Result<RejoinReport, String> {
    let room = setup_room(
        &cli.relay_url,
        format!("rejoin-{}", now_us()),
        cli.transport.relay_kind(),
        cli.hz,
        2,
    )
    .await?;
    let cipher = room_cipher(0);
    let spec = |slot: u8| PumpSpec {
        slot,
        hz: cli.hz,
        cipher: Arc::clone(&cipher),
    };
    let host_transport = connect_pair_member(cli, &room.id, &room.members[0], 1).await?;
    let guest_transport = connect_pair_member(cli, &room.id, &room.members[1], 2).await?;
    let host_pump = start_pump(host_transport, spec(0));
    let guest_pump = start_pump(guest_transport, spec(1));

    let steady = u64::from(cli.hz) * STEADY_FRAMES_SECS;
    let steady_wait = async {
        while host_pump.received.load(Ordering::Relaxed) < steady {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(30), steady_wait)
        .await
        .map_err(|_| "pose flow did not become steady".to_owned())?;
    announce(&format!("READY_FOR_RESTART room={}", room.id));

    let host_signaling = room.members[0].signaling.clone();
    tokio::time::timeout(REJOIN_WAIT_FOR_DROP, host_signaling.wait_closed())
        .await
        .map_err(|_| "relay did not disconnect".to_owned())?;
    let dropped_at = Instant::now();

    for pump in [host_pump, guest_pump] {
        pump.sending.store(false, Ordering::Relaxed);
        let (mut transport, _, _) = pump.finish().await;
        transport.close().await;
    }
    room.members[1].signaling.close().await;

    let (host_signaling, host_creds) = reclaim_host(cli, &room).await?;
    let reclaim_ms = ms_since(dropped_at);
    let reclaimed_at = Instant::now();
    announce(&format!(
        "RECLAIMED room={} reclaim_ms={reclaim_ms:.1}",
        room.id
    ));

    let host_member = Member {
        signaling: host_signaling.clone(),
        creds: host_creds,
    };
    let mut host_events = host_signaling.subscribe_events();
    let (guest_member, host_transport) = tokio::try_join!(
        admit_guest(
            &cli.relay_url,
            &room.id,
            &host_signaling,
            &mut host_events,
            "bench-1"
        ),
        connect_pair_member(cli, &room.id, &host_member, 3),
    )?;
    let guest_transport = connect_pair_member(cli, &room.id, &guest_member, 4).await?;
    let rejoin_ms = ms_since(reclaimed_at);

    let host_pump = start_pump(host_transport, spec(0));
    let guest_pump = start_pump(guest_transport, spec(guest_member.creds.slot()));
    let mut first_rx = host_pump.first_rx.clone();
    tokio::time::timeout(
        REJOIN_RECOVERY_TIMEOUT,
        first_rx.wait_for(|first| first.is_some()),
    )
    .await
    .map_err(|_| "no pose after rejoin".to_owned())?
    .map_err(err)?;
    let pose_resume_ms = ms_since(dropped_at);

    for pump in [host_pump, guest_pump] {
        pump.sending.store(false, Ordering::Relaxed);
        let (mut transport, _, _) = pump.finish().await;
        transport.close().await;
    }
    host_member.signaling.close().await;
    guest_member.signaling.close().await;

    Ok(RejoinReport {
        transport: cli.transport.label(),
        room_id: room.id,
        reclaim_ms,
        rejoin_ms,
        pose_resume_ms,
    })
}

fn write_json(path: &PathBuf, value: &impl Serialize) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(err)?;
    std::fs::write(path, text).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

async fn run(cli: Cli) -> Result<ExitCode, String> {
    cli.validate()?;
    if cli.rejoin_check {
        let report = run_rejoin_check(&cli).await?;
        println!(
            "rejoin {}: reclaim {} rejoin {} pose resume {}",
            report.transport,
            fmt_ms(report.reclaim_ms),
            fmt_ms(report.rejoin_ms),
            fmt_ms(report.pose_resume_ms)
        );
        if let Some(path) = &cli.json_out {
            write_json(path, &report)?;
        }
        return Ok(ExitCode::SUCCESS);
    }
    let report = run_benchmark(&cli).await?;
    report.print();
    if let Some(path) = &cli.json_out {
        write_json(path, &report)?;
    }
    Ok(if report.peers_connected == 0 {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    })
}

#[tokio::main]
async fn main() -> ExitCode {
    match run(Cli::parse()).await {
        Ok(code) => code,
        Err(message) => {
            eprintln!("transport-bench: {message}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cli(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(
            ["transport-bench", "--relay-url", "ws://127.0.0.1:4000"]
                .into_iter()
                .chain(args.iter().copied()),
        )
    }

    fn summary(received: u64, expected: u64, freezes: u64, gap: f64) -> StreamSummary {
        StreamSummary {
            received,
            expected,
            loss_pct: 0.0,
            rfc3550_jitter_ms: 1.0,
            latency_p50_ms: 1.0,
            latency_p95_ms: 2.0,
            latency_p99_ms: 3.0,
            max_raw_gap_ms: gap,
            max_buffered_freeze_ms: gap / 2.0,
            freezes_over_100ms: freezes,
        }
    }

    #[test]
    fn defaults_match_the_brief() {
        let parsed = cli(&["--transport", "websocket"]).unwrap();
        assert_eq!(parsed.hz, 60);
        assert_eq!(parsed.duration_secs, 30);
        assert_eq!(parsed.rooms, 1);
        assert_eq!(parsed.jitter_buf_ms, 40);
        assert!(!parsed.rejoin_check);
        assert!(parsed.impairment(1).is_none());
        parsed.validate().unwrap();
    }

    #[test]
    fn transport_names_and_hz_are_validated() {
        for name in [
            "websocket",
            "ex_webrtc",
            "auto_ex_webrtc",
            "livekit_lossy",
            "livekit_track",
        ] {
            assert!(cli(&["--transport", name]).is_ok(), "{name}");
        }
        assert!(cli(&["--transport", "carrier-pigeon"]).is_err());
        assert!(cli(&["--transport", "websocket", "--hz", "45"]).is_err());
        assert_eq!(
            cli(&["--transport", "websocket", "--hz", "30"]).unwrap().hz,
            30
        );
    }

    #[test]
    fn invalid_values_are_rejected() {
        let bad = |args: &[&str]| {
            let mut full = vec!["--transport", "websocket"];
            full.extend_from_slice(args);
            cli(&full).unwrap().validate().is_err()
        };
        assert!(bad(&["--rooms", "0"]));
        assert!(bad(&["--loss-pct", "101"]));
        assert!(bad(&["--jitter-ms=-1"]));
        assert!(bad(&["--rooms", "2", "--rejoin-check"]));
    }

    #[test]
    fn impairment_is_set_when_loss_or_jitter_is_requested() {
        let parsed = cli(&[
            "--transport",
            "websocket",
            "--loss-pct",
            "5",
            "--jitter-ms",
            "30",
        ])
        .unwrap();
        let config = parsed.impairment(9).unwrap();
        assert_eq!(
            (config.loss_pct, config.jitter_ms, config.seed),
            (5.0, 30.0, 9)
        );
    }

    #[cfg(not(feature = "livekit"))]
    #[test]
    fn livekit_transports_need_the_feature() {
        for name in ["livekit_lossy", "livekit_track"] {
            let message = cli(&["--transport", name]).unwrap().validate().unwrap_err();
            assert!(message.contains("--features livekit"), "{message}");
        }
    }

    #[test]
    fn aggregate_pools_counts_and_takes_the_worst_stream() {
        let a = summary(990, 1000, 0, 20.0);
        let b = summary(900, 1000, 2, 150.0);
        let pooled = aggregate(&[&a, &b], (1..=100).map(f64::from).collect());
        assert_eq!((pooled.received, pooled.expected), (1890, 2000));
        assert!((pooled.loss_pct - 5.5).abs() < 1e-9);
        assert_eq!(pooled.freezes_over_100ms, 2);
        assert_eq!(pooled.max_raw_gap_ms, 150.0);
        assert_eq!(pooled.latency_p95_ms, 95.0);
    }

    #[test]
    fn aggregate_of_nothing_is_unknown_not_zero() {
        let pooled = aggregate(&[], Vec::new());
        assert!(pooled.loss_pct.is_nan());
        assert!(pooled.latency_p95_ms.is_nan());
        assert!(pooled.max_raw_gap_ms.is_nan());
        assert!(pooled.rfc3550_jitter_ms.is_nan());
    }

    #[test]
    fn aggregate_ignores_unknown_stream_values() {
        let mut unknown = summary(10, 10, 0, f64::NAN);
        unknown.rfc3550_jitter_ms = f64::NAN;
        let known = summary(10, 10, 0, 30.0);
        let pooled = aggregate(&[&unknown, &known], vec![1.0, f64::NAN]);
        assert_eq!(pooled.max_raw_gap_ms, 30.0);
        assert_eq!(pooled.rfc3550_jitter_ms, 1.0);
        assert_eq!(pooled.latency_p50_ms, 1.0);
    }

    #[test]
    fn json_report_writes_unknown_as_null() {
        let value = serde_json::to_value(aggregate(&[], Vec::new())).unwrap();
        assert!(value["loss_pct"].is_null());
    }
}
