use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::{
    MocapTransport, ReceivedPose, RoomRef, SendOutcome, TransportCreds, TransportError,
    TransportKind, TransportStats,
};

const RECEIVED_CAPACITY: usize = 1024;

/// Liveness signals that `AutoUpgradeTransport` reads from its paths.
pub trait LinkHealth {
    fn is_connected(&self) -> bool;

    /// Arrival time of the last datagram from the relay, or `None` when the transport cannot tell.
    fn last_inbound(&self) -> Option<Instant>;
}

/// Retry delays for the primary path. The last step repeats.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackoffSchedule {
    steps: Vec<Duration>,
    next: usize,
}

impl BackoffSchedule {
    /// An empty schedule retries immediately.
    pub fn new(steps: Vec<Duration>) -> Self {
        Self { steps, next: 0 }
    }

    pub fn next_delay(&mut self) -> Duration {
        let delay = self
            .steps
            .get(self.next)
            .or(self.steps.last())
            .copied()
            .unwrap_or_default();
        self.next = (self.next + 1).min(self.steps.len());
        delay
    }

    pub fn reset(&mut self) {
        self.next = 0;
    }
}

impl Default for BackoffSchedule {
    fn default() -> Self {
        Self::new([2, 4, 8, 16, 30].map(Duration::from_secs).to_vec())
    }
}

#[derive(Debug, Clone)]
pub struct AutoUpgradeConfig {
    /// Falls back when sends are active and the primary receives nothing for this long.
    pub loss_timeout: Duration,
    pub check_interval: Duration,
    /// A primary that stays up this long resets the backoff.
    pub stable_after: Duration,
    pub backoff: BackoffSchedule,
}

impl Default for AutoUpgradeConfig {
    fn default() -> Self {
        Self {
            loss_timeout: Duration::from_millis(1000),
            check_interval: Duration::from_millis(100),
            stable_after: Duration::from_secs(30),
            backoff: BackoffSchedule::default(),
        }
    }
}

#[derive(Default)]
struct Counters {
    sent: AtomicU64,
    dropped_backpressure: AtomicU64,
    received: AtomicU64,
}

impl Counters {
    fn count(&self, outcome: SendOutcome) -> SendOutcome {
        let counter = match outcome {
            SendOutcome::Sent => &self.sent,
            SendOutcome::DroppedBackpressure => &self.dropped_backpressure,
            SendOutcome::Disconnected => return outcome,
        };
        counter.fetch_add(1, Ordering::Relaxed);
        outcome
    }
}

/// A run of sends without a gap longer than the loss timeout.
#[derive(Clone, Copy)]
struct SendStreak {
    started: Instant,
    last: Instant,
}

struct Shared<W, P> {
    ws: RwLock<Option<W>>,
    primary: RwLock<Option<P>>,
    on_primary: AtomicBool,
    streak: Mutex<Option<SendStreak>>,
    counters: Arc<Counters>,
    received_tx: broadcast::Sender<ReceivedPose>,
}

fn read<T>(lock: &RwLock<T>) -> std::sync::RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(|e| e.into_inner())
}

fn write<T>(lock: &RwLock<T>) -> std::sync::RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(|e| e.into_inner())
}

impl<W, P> Shared<W, P>
where
    W: MocapTransport + LinkHealth + Sync,
    P: MocapTransport + LinkHealth + Sync,
{
    fn note_send(&self, now: Instant, loss_timeout: Duration) {
        let mut streak = self.streak.lock().unwrap_or_else(|e| e.into_inner());
        *streak = Some(match *streak {
            Some(s) if now.saturating_duration_since(s.last) <= loss_timeout => {
                SendStreak { last: now, ..s }
            }
            _ => SendStreak {
                started: now,
                last: now,
            },
        });
    }

    /// `None` when the primary is gone; the caller then uses WebSocket.
    fn send_primary(&self, ciphertext: &[u8]) -> Option<SendOutcome> {
        let primary = read(&self.primary);
        match primary.as_ref()?.send_pose(ciphertext) {
            SendOutcome::Disconnected => {
                self.on_primary.store(false, Ordering::Release);
                None
            }
            outcome => Some(outcome),
        }
    }

    fn send_ws(&self, ciphertext: &[u8]) -> SendOutcome {
        read(&self.ws)
            .as_ref()
            .map_or(SendOutcome::Disconnected, |ws| ws.send_pose(ciphertext))
    }

    /// Total loss means: sends are active, WebSocket is up, and the primary received nothing
    /// for `loss_timeout` since it opened or since the current send streak started.
    fn primary_healthy(&self, now: Instant, opened_at: Instant, loss_timeout: Duration) -> bool {
        if !self.on_primary.load(Ordering::Acquire) {
            return false;
        }
        let primary = read(&self.primary);
        let Some(primary) = primary.as_ref().filter(|p| p.is_connected()) else {
            return false;
        };
        let Some(streak) = *self.streak.lock().unwrap_or_else(|e| e.into_inner()) else {
            return true;
        };
        let sending = now.saturating_duration_since(streak.last) <= loss_timeout;
        let ws_up = read(&self.ws).as_ref().is_some_and(W::is_connected);
        if !sending || !ws_up {
            return true;
        }
        let quiet_since = primary
            .last_inbound()
            .map_or(opened_at, |at| at.max(opened_at))
            .max(streak.started);
        now.saturating_duration_since(quiet_since) < loss_timeout
    }
}

async fn forward_received(
    mut rx: broadcast::Receiver<ReceivedPose>,
    tx: broadcast::Sender<ReceivedPose>,
    counters: Arc<Counters>,
) {
    loop {
        match rx.recv().await {
            Ok(pose) => {
                counters.received.fetch_add(1, Ordering::Relaxed);
                let _ = tx.send(pose);
            }
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
}

async fn supervise<W, P, F>(
    shared: Arc<Shared<W, P>>,
    factory: Arc<F>,
    room: RoomRef,
    creds: TransportCreds,
    mut config: AutoUpgradeConfig,
) where
    W: MocapTransport + LinkHealth + Sync + 'static,
    P: MocapTransport + LinkHealth + Sync + 'static,
    F: Fn() -> P + Send + Sync + 'static,
{
    loop {
        let mut primary = factory();
        if primary.connect(room.clone(), creds.clone()).await.is_ok() {
            run_primary(&shared, primary, &mut config).await;
        }
        tokio::time::sleep(config.backoff.next_delay()).await;
    }
}

/// Keeps `primary` as the active path until it fails, then closes it.
async fn run_primary<W, P>(shared: &Shared<W, P>, primary: P, config: &mut AutoUpgradeConfig)
where
    W: MocapTransport + LinkHealth + Sync,
    P: MocapTransport + LinkHealth + Sync,
{
    let forwarder = tokio::spawn(forward_received(
        primary.subscribe(),
        shared.received_tx.clone(),
        Arc::clone(&shared.counters),
    ));
    let opened_at = Instant::now();
    *write(&shared.primary) = Some(primary);
    shared.on_primary.store(true, Ordering::Release);

    let mut ticker = tokio::time::interval(config.check_interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut stable = false;
    loop {
        ticker.tick().await;
        let now = Instant::now();
        if !stable && now.saturating_duration_since(opened_at) >= config.stable_after {
            config.backoff.reset();
            stable = true;
        }
        if !shared.primary_healthy(now, opened_at, config.loss_timeout) {
            break;
        }
    }

    shared.on_primary.store(false, Ordering::Release);
    forwarder.abort();
    let primary = write(&shared.primary).take();
    if let Some(mut primary) = primary {
        primary.close().await;
    }
}

/// Starts on WebSocket, moves to the primary path when it opens, and returns to WebSocket on loss.
pub struct AutoUpgradeTransport<W, P, F> {
    shared: Arc<Shared<W, P>>,
    factory: Arc<F>,
    config: AutoUpgradeConfig,
    hz: u32,
    ws_forwarder: Option<JoinHandle<()>>,
    supervisor: Option<JoinHandle<()>>,
}

impl<W, P, F> AutoUpgradeTransport<W, P, F>
where
    W: MocapTransport + LinkHealth + Sync + 'static,
    P: MocapTransport + LinkHealth + Sync + 'static,
    F: Fn() -> P + Send + Sync + 'static,
{
    /// `primary_factory` builds a fresh, unconnected primary for each attempt.
    pub fn new(ws: W, primary_factory: F, config: AutoUpgradeConfig) -> Self {
        Self {
            shared: Arc::new(Shared {
                ws: RwLock::new(Some(ws)),
                primary: RwLock::new(None),
                on_primary: AtomicBool::new(false),
                streak: Mutex::new(None),
                counters: Arc::default(),
                received_tx: broadcast::channel(RECEIVED_CAPACITY).0,
            }),
            factory: Arc::new(primary_factory),
            config,
            hz: 0,
            ws_forwarder: None,
            supervisor: None,
        }
    }
}

impl<W, P, F> MocapTransport for AutoUpgradeTransport<W, P, F>
where
    W: MocapTransport + LinkHealth + Sync + 'static,
    P: MocapTransport + LinkHealth + Sync + 'static,
    F: Fn() -> P + Send + Sync + 'static,
{
    /// `creds` go to the primary; WebSocket gets `TransportCreds::WebSocket` with the same slot.
    async fn connect(
        &mut self,
        room: RoomRef,
        creds: TransportCreds,
    ) -> Result<(), TransportError> {
        if self.supervisor.is_some() {
            return Err(TransportError::AlreadyConnected);
        }
        let ws = write(&self.shared.ws).take();
        let mut ws = ws.ok_or(TransportError::AlreadyConnected)?;
        let result = ws
            .connect(
                room.clone(),
                TransportCreds::WebSocket { slot: creds.slot() },
            )
            .await;
        let ws_rx = ws.subscribe();
        *write(&self.shared.ws) = Some(ws);
        result?;

        self.hz = room.hz;
        self.ws_forwarder = Some(tokio::spawn(forward_received(
            ws_rx,
            self.shared.received_tx.clone(),
            Arc::clone(&self.shared.counters),
        )));
        self.supervisor = Some(tokio::spawn(supervise(
            Arc::clone(&self.shared),
            Arc::clone(&self.factory),
            room,
            creds,
            self.config.clone(),
        )));
        Ok(())
    }

    fn send_pose(&self, ciphertext: &[u8]) -> SendOutcome {
        let shared = &self.shared;
        shared.note_send(Instant::now(), self.config.loss_timeout);
        let outcome = shared
            .on_primary
            .load(Ordering::Acquire)
            .then(|| shared.send_primary(ciphertext))
            .flatten()
            .unwrap_or_else(|| shared.send_ws(ciphertext));
        shared.counters.count(outcome)
    }

    fn subscribe(&self) -> broadcast::Receiver<ReceivedPose> {
        self.shared.received_tx.subscribe()
    }

    /// `kind` and link measurements come from the active path; counters cover both paths.
    fn stats(&self) -> TransportStats {
        let shared = &self.shared;
        let active = shared
            .on_primary
            .load(Ordering::Acquire)
            .then(|| read(&shared.primary).as_ref().map(P::stats))
            .flatten()
            .or_else(|| read(&shared.ws).as_ref().map(W::stats));
        TransportStats {
            kind: active.as_ref().map_or(TransportKind::WebSocket, |s| s.kind),
            rtt_ms: active.as_ref().and_then(|s| s.rtt_ms),
            loss_pct: active.as_ref().and_then(|s| s.loss_pct),
            jitter_ms: active.as_ref().and_then(|s| s.jitter_ms),
            hz: self.hz,
            sent: shared.counters.sent.load(Ordering::Relaxed),
            dropped_backpressure: shared.counters.dropped_backpressure.load(Ordering::Relaxed),
            received: shared.counters.received.load(Ordering::Relaxed),
        }
    }

    async fn close(&mut self) {
        if let Some(supervisor) = self.supervisor.take() {
            supervisor.abort();
            let _ = supervisor.await;
        }
        if let Some(forwarder) = self.ws_forwarder.take() {
            forwarder.abort();
        }
        self.shared.on_primary.store(false, Ordering::Release);
        let primary = write(&self.shared.primary).take();
        if let Some(mut primary) = primary {
            primary.close().await;
        }
        let ws = write(&self.shared.ws).take();
        if let Some(mut ws) = ws {
            ws.close().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Probe {
        sent: AtomicU64,
        closes: AtomicU64,
        connects: Mutex<Vec<Instant>>,
        creds: Mutex<Vec<TransportCreds>>,
        connected: AtomicBool,
        inbound_on_send: AtomicBool,
        last_inbound: Mutex<Option<Instant>>,
    }

    impl Probe {
        fn sent(&self) -> u64 {
            self.sent.load(Ordering::Relaxed)
        }

        fn connects(&self) -> Vec<Instant> {
            self.connects.lock().unwrap().clone()
        }
    }

    struct Mock {
        kind: TransportKind,
        probe: Arc<Probe>,
        connect_delay: Duration,
        fail_connect: bool,
        received_tx: broadcast::Sender<ReceivedPose>,
    }

    impl Mock {
        fn new(kind: TransportKind, probe: &Arc<Probe>) -> Self {
            Self {
                kind,
                probe: Arc::clone(probe),
                connect_delay: Duration::ZERO,
                fail_connect: false,
                received_tx: broadcast::channel(16).0,
            }
        }
    }

    impl MocapTransport for Mock {
        async fn connect(
            &mut self,
            _room: RoomRef,
            creds: TransportCreds,
        ) -> Result<(), TransportError> {
            self.probe.connects.lock().unwrap().push(Instant::now());
            self.probe.creds.lock().unwrap().push(creds);
            tokio::time::sleep(self.connect_delay).await;
            if self.fail_connect {
                return Err(TransportError::Connect("mock".into()));
            }
            self.probe.connected.store(true, Ordering::Release);
            Ok(())
        }

        fn send_pose(&self, _ciphertext: &[u8]) -> SendOutcome {
            if !self.probe.connected.load(Ordering::Acquire) {
                return SendOutcome::Disconnected;
            }
            self.probe.sent.fetch_add(1, Ordering::Relaxed);
            if self.probe.inbound_on_send.load(Ordering::Relaxed) {
                *self.probe.last_inbound.lock().unwrap() = Some(Instant::now());
            }
            SendOutcome::Sent
        }

        fn subscribe(&self) -> broadcast::Receiver<ReceivedPose> {
            self.received_tx.subscribe()
        }

        fn stats(&self) -> TransportStats {
            TransportStats {
                kind: self.kind,
                rtt_ms: None,
                loss_pct: None,
                jitter_ms: None,
                hz: 0,
                sent: self.probe.sent(),
                dropped_backpressure: 0,
                received: 0,
            }
        }

        async fn close(&mut self) {
            self.probe.connected.store(false, Ordering::Release);
            self.probe.closes.fetch_add(1, Ordering::Relaxed);
        }
    }

    impl LinkHealth for Mock {
        fn is_connected(&self) -> bool {
            self.probe.connected.load(Ordering::Acquire)
        }

        fn last_inbound(&self) -> Option<Instant> {
            *self.probe.last_inbound.lock().unwrap()
        }
    }

    type Auto = AutoUpgradeTransport<Mock, Mock, Box<dyn Fn() -> Mock + Send + Sync>>;

    struct Harness {
        auto: Auto,
        ws: Arc<Probe>,
        primary: Arc<Probe>,
    }

    async fn harness(connect_delay: Duration, fail_connect: bool) -> Harness {
        let ws = Arc::new(Probe::default());
        let primary = Arc::new(Probe::default());
        primary.inbound_on_send.store(true, Ordering::Relaxed);
        let factory_probe = Arc::clone(&primary);
        let factory: Box<dyn Fn() -> Mock + Send + Sync> = Box::new(move || Mock {
            connect_delay,
            fail_connect,
            ..Mock::new(TransportKind::ExWebRtc, &factory_probe)
        });
        let mut auto = AutoUpgradeTransport::new(
            Mock::new(TransportKind::WebSocket, &ws),
            factory,
            AutoUpgradeConfig::default(),
        );
        auto.connect(
            RoomRef {
                room_id: "r".into(),
                hz: 60,
            },
            TransportCreds::ExWebRtc {
                slot: 2,
                ice_servers: vec![],
            },
        )
        .await
        .unwrap();
        Harness { auto, ws, primary }
    }

    async fn send_for(auto: &Auto, duration: Duration) {
        let frame = Duration::from_millis(16);
        let end = Instant::now() + duration;
        while Instant::now() < end {
            auto.send_pose(&[0u8; 368]);
            tokio::time::sleep(frame).await;
        }
    }

    #[test]
    fn backoff_follows_2_4_8_16_30_then_caps_at_30_seconds() {
        let mut backoff = BackoffSchedule::default();
        let delays: Vec<u64> = (0..7).map(|_| backoff.next_delay().as_secs()).collect();
        assert_eq!(delays, [2, 4, 8, 16, 30, 30, 30]);
        backoff.reset();
        assert_eq!(backoff.next_delay(), Duration::from_secs(2));
    }

    #[tokio::test(start_paused = true)]
    async fn sends_use_websocket_while_primary_connects_then_switch_to_primary() {
        let h = harness(Duration::from_millis(500), false).await;
        assert_eq!(
            *h.ws.creds.lock().unwrap(),
            [TransportCreds::WebSocket { slot: 2 }]
        );

        assert_eq!(h.auto.send_pose(&[1]), SendOutcome::Sent);
        assert_eq!((h.ws.sent(), h.primary.sent()), (1, 0));
        assert_eq!(h.auto.stats().kind, TransportKind::WebSocket);

        tokio::time::sleep(Duration::from_millis(600)).await;
        assert_eq!(h.auto.send_pose(&[2]), SendOutcome::Sent);
        assert_eq!((h.ws.sent(), h.primary.sent()), (1, 1));
        let stats = h.auto.stats();
        assert_eq!(stats.kind, TransportKind::ExWebRtc);
        assert_eq!((stats.sent, stats.hz), (2, 60));
    }

    #[tokio::test(start_paused = true)]
    async fn total_loss_for_1000ms_while_sending_falls_back_to_websocket() {
        let h = harness(Duration::ZERO, false).await;
        tokio::time::sleep(Duration::from_millis(10)).await;
        send_for(&h.auto, Duration::from_millis(500)).await;
        assert_eq!(h.auto.stats().kind, TransportKind::ExWebRtc);

        h.primary.inbound_on_send.store(false, Ordering::Relaxed);
        send_for(&h.auto, Duration::from_millis(900)).await;
        assert_eq!(h.auto.stats().kind, TransportKind::ExWebRtc);
        assert_eq!(h.ws.sent(), 0);

        send_for(&h.auto, Duration::from_millis(300)).await;
        assert_eq!(h.auto.stats().kind, TransportKind::WebSocket);
        assert!(h.ws.sent() > 0);
        assert_eq!(h.primary.closes.load(Ordering::Relaxed), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn idle_primary_without_inbound_stays_active() {
        let h = harness(Duration::ZERO, false).await;
        h.primary.inbound_on_send.store(false, Ordering::Relaxed);
        tokio::time::sleep(Duration::from_secs(5)).await;
        assert_eq!(h.auto.stats().kind, TransportKind::ExWebRtc);
    }

    #[tokio::test(start_paused = true)]
    async fn loss_does_not_fall_back_while_websocket_is_down() {
        let h = harness(Duration::ZERO, false).await;
        tokio::time::sleep(Duration::from_millis(10)).await;
        h.primary.inbound_on_send.store(false, Ordering::Relaxed);
        h.ws.connected.store(false, Ordering::Release);
        send_for(&h.auto, Duration::from_millis(2000)).await;
        assert_eq!(h.auto.stats().kind, TransportKind::ExWebRtc);
    }

    #[tokio::test(start_paused = true)]
    async fn disconnected_primary_sends_the_frame_over_websocket_and_retries_after_2s() {
        let h = harness(Duration::ZERO, false).await;
        tokio::time::sleep(Duration::from_millis(10)).await;
        h.primary.connected.store(false, Ordering::Release);

        assert_eq!(h.auto.send_pose(&[1]), SendOutcome::Sent);
        assert_eq!(h.ws.sent(), 1);
        assert_eq!(h.auto.stats().kind, TransportKind::WebSocket);

        tokio::time::sleep(Duration::from_millis(2500)).await;
        let connects = h.primary.connects();
        assert_eq!(connects.len(), 2);
        let gap = connects[1] - connects[0];
        assert!(
            gap >= Duration::from_secs(2) && gap < Duration::from_millis(2300),
            "{gap:?}"
        );
        assert_eq!(h.auto.stats().kind, TransportKind::ExWebRtc);
    }

    #[tokio::test(start_paused = true)]
    async fn failed_primary_retries_after_2_4_8_16_30_30_seconds() {
        let mut h = harness(Duration::ZERO, true).await;
        tokio::time::sleep(Duration::from_secs(95)).await;
        let connects = h.primary.connects();
        let gaps: Vec<u64> = connects
            .windows(2)
            .map(|pair| (pair[1] - pair[0]).as_millis() as u64)
            .collect();
        assert_eq!(gaps.len(), 6, "{gaps:?}");
        for (gap, expected) in gaps
            .iter()
            .zip([2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
        {
            assert!(gap.abs_diff(expected) <= 5, "{gaps:?}");
        }
        assert_eq!(h.auto.stats().kind, TransportKind::WebSocket);
        h.auto.close().await;
        assert_eq!(h.ws.closes.load(Ordering::Relaxed), 1);
    }
}
