use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use str0m::change::SdpAnswer;
use str0m::channel::{ChannelConfig, ChannelId, Reliability};
use str0m::net::{Protocol, Receive};
use str0m::stats::PeerStats;
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc, RtcConfig};
use tokio::net::UdpSocket;
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::auto_upgrade::LinkHealth;
use crate::codec::parse_relay_envelope;
use crate::signaling::{ServerEvent, SignalingClient, SignalingError};
use crate::stats::{ImpairmentConfig, ImpairmentFilter};
use crate::{
    now_us, MocapTransport, ReceivedPose, RoomRef, SendOutcome, TransportCreds, TransportError,
    TransportKind, TransportStats,
};

const POSE_LABEL: &str = "pose";
const SIGNAL_EVENT: &str = "signal";
/// A frame is dropped instead of queued when SCTP already buffers more than this.
const MAX_BUFFERED_BYTES: usize = 1024;
const RECEIVED_CAPACITY: usize = 1024;
const RECV_BUFFER_LEN: usize = 2048;
const NEGOTIATION_TIMEOUT: Duration = Duration::from_secs(10);
const STATS_INTERVAL: Duration = Duration::from_secs(1);
const CLOSE_TIMEOUT: Duration = Duration::from_secs(1);
const FALLBACK_PROBE: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)), 80);
const PROBE_PORT: u16 = 9;

#[derive(Default)]
struct Link {
    open: AtomicBool,
    ice_up: AtomicBool,
    buffered: AtomicUsize,
    sent: AtomicU64,
    dropped_backpressure: AtomicU64,
    received: AtomicU64,
    last_inbound: Mutex<Option<tokio::time::Instant>>,
    peer: Mutex<PeerSample>,
}

#[derive(Default, Clone, Copy)]
struct PeerSample {
    rtt_ms: Option<f64>,
    loss_pct: Option<f64>,
}

impl Link {
    fn is_up(&self) -> bool {
        self.open.load(Ordering::Acquire) && self.ice_up.load(Ordering::Acquire)
    }

    fn drop_frame(&self) -> SendOutcome {
        self.dropped_backpressure.fetch_add(1, Ordering::Relaxed);
        SendOutcome::DroppedBackpressure
    }

    fn touch_inbound(&self) {
        *self.last_inbound.lock().unwrap_or_else(|e| e.into_inner()) =
            Some(tokio::time::Instant::now());
    }

    fn record_peer(&self, stats: &PeerStats) {
        *self.peer.lock().unwrap_or_else(|e| e.into_inner()) = PeerSample {
            rtt_ms: stats.rtt.map(|rtt| rtt.as_secs_f64() * 1000.0),
            loss_pct: stats.egress_loss_fraction.map(|f| f64::from(f) * 100.0),
        };
    }

    fn peer(&self) -> PeerSample {
        *self.peer.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Latest-only hand-off from `send_pose` to the UDP loop: one frame waits at most.
struct Outbox {
    tx: mpsc::Sender<Vec<u8>>,
    link: Arc<Link>,
}

impl Outbox {
    fn offer(&self, ciphertext: &[u8]) -> SendOutcome {
        if !self.link.is_up() {
            return SendOutcome::Disconnected;
        }
        if self.link.buffered.load(Ordering::Relaxed) > MAX_BUFFERED_BYTES {
            return self.link.drop_frame();
        }
        match self.tx.try_send(ciphertext.to_vec()) {
            Ok(()) => SendOutcome::Sent,
            Err(mpsc::error::TrySendError::Full(_)) => self.link.drop_frame(),
            Err(mpsc::error::TrySendError::Closed(_)) => SendOutcome::Disconnected,
        }
    }
}

/// Turns `[slot][ciphertext]` DataChannel messages into `ReceivedPose`, after optional impairment.
struct Inbound {
    tx: broadcast::Sender<ReceivedPose>,
    link: Arc<Link>,
    impairment: Option<ImpairmentFilter>,
}

impl Inbound {
    fn accept(&mut self, data: &[u8]) {
        let Ok((slot, wire)) = parse_relay_envelope(data) else {
            return;
        };
        let delay = match self.impairment.as_mut().map(ImpairmentFilter::apply) {
            Some(None) => return,
            Some(Some(delay)) => delay,
            None => Duration::ZERO,
        };
        let deliver = {
            let tx = self.tx.clone();
            let link = Arc::clone(&self.link);
            let ciphertext = wire.to_vec();
            move || {
                link.received.fetch_add(1, Ordering::Relaxed);
                let _ = tx.send(ReceivedPose {
                    slot,
                    ciphertext,
                    received_at_us: now_us(),
                });
            }
        };
        if delay.is_zero() {
            deliver();
        } else {
            tokio::spawn(async move {
                tokio::time::sleep(delay).await;
                deliver();
            });
        }
    }
}

#[derive(Debug, PartialEq)]
enum RelaySignal {
    Answer(String),
    Candidate(String),
}

fn parse_signal(payload: &Value) -> Option<RelaySignal> {
    let field = |name: &str| payload.get(name).and_then(Value::as_str).map(str::to_owned);
    match payload.get("type").and_then(Value::as_str)? {
        "answer" => field("sdp").map(RelaySignal::Answer),
        "candidate" => field("candidate")
            .filter(|candidate| !candidate.is_empty())
            .map(RelaySignal::Candidate),
        _ => None,
    }
}

/// `str0m` starts SCTP only as the DTLS client, and an `ex_webrtc` answerer takes the client
/// role for `actpass` and then waits for the peer's SCTP INIT. Offering `active` breaks that deadlock.
fn offer_dtls_client_role(sdp: &str) -> String {
    sdp.replace("a=setup:actpass", "a=setup:active")
}

/// `ex_ice` rejects loopback candidates, so a loopback or unresolved relay probes the default route.
fn probe_target(relay_ip: Option<Ipv4Addr>) -> SocketAddr {
    relay_ip
        .filter(|ip| !ip.is_loopback() && !ip.is_unspecified())
        .map_or(FALLBACK_PROBE, |ip| {
            SocketAddr::new(IpAddr::V4(ip), PROBE_PORT)
        })
}

async fn resolve_relay_ipv4(url: &url::Url) -> Option<Ipv4Addr> {
    let host = url.host_str()?;
    let port = url.port_or_known_default()?;
    tokio::net::lookup_host((host, port))
        .await
        .ok()?
        .find_map(|addr| match addr.ip() {
            IpAddr::V4(ip) => Some(ip),
            IpAddr::V6(_) => None,
        })
}

fn local_ipv4_towards(target: SocketAddr) -> std::io::Result<Ipv4Addr> {
    let probe = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))?;
    probe.connect(target)?;
    match probe.local_addr()?.ip() {
        IpAddr::V4(ip) if !ip.is_unspecified() => Ok(ip),
        other => Err(std::io::Error::other(format!(
            "no routable local IPv4 towards {target} (got {other})"
        ))),
    }
}

fn connect_err(err: impl std::fmt::Display) -> TransportError {
    TransportError::Connect(err.to_string())
}

async fn bind_host_socket(relay_url: &url::Url) -> Result<(UdpSocket, SocketAddr), TransportError> {
    let target = probe_target(resolve_relay_ipv4(relay_url).await);
    let local_ip = local_ipv4_towards(target).map_err(connect_err)?;
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .await
        .map_err(connect_err)?;
    let port = socket.local_addr().map_err(connect_err)?.port();
    Ok((socket, SocketAddr::new(IpAddr::V4(local_ip), port)))
}

/// Waits for the relay answer. Candidates that arrive first are returned with it.
async fn await_answer(
    signals: &mut broadcast::Receiver<ServerEvent>,
) -> Result<(SdpAnswer, Vec<Candidate>), TransportError> {
    let deadline = tokio::time::Instant::now() + NEGOTIATION_TIMEOUT;
    let mut early = Vec::new();
    loop {
        let event = match tokio::time::timeout_at(deadline, signals.recv()).await {
            Err(_) => return Err(SignalingError::Timeout.into()),
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => {
                return Err(SignalingError::Closed.into())
            }
            Ok(Ok(event)) => event,
        };
        if event.event != SIGNAL_EVENT {
            continue;
        }
        match parse_signal(&event.payload) {
            Some(RelaySignal::Answer(sdp)) => {
                let answer = SdpAnswer::from_sdp_string(&sdp).map_err(connect_err)?;
                return Ok((answer, early));
            }
            Some(RelaySignal::Candidate(line)) => {
                early.extend(Candidate::from_sdp_string(&line).ok());
            }
            None => {}
        }
    }
}

struct Driver {
    rtc: Rtc,
    socket: UdpSocket,
    local: SocketAddr,
    channel: ChannelId,
    frames: mpsc::Receiver<Vec<u8>>,
    signals: broadcast::Receiver<ServerEvent>,
    inbound: Inbound,
    link: Arc<Link>,
    open_tx: Option<oneshot::Sender<()>>,
    stop: oneshot::Receiver<()>,
}

impl Driver {
    async fn run(mut self) {
        let mut buf = vec![0u8; RECV_BUFFER_LEN];
        let mut signals_open = true;
        loop {
            let Some(deadline) = self.drain().await else {
                break;
            };
            let wake = tokio::time::sleep_until(deadline.into());
            let alive = tokio::select! {
                _ = &mut self.stop => false,
                received = self.socket.recv_from(&mut buf) => match received {
                    Ok((len, source)) => self.receive(source, &buf[..len]),
                    Err(_) => true,
                },
                Some(frame) = self.frames.recv() => {
                    self.write(&frame);
                    true
                }
                signal = self.signals.recv(), if signals_open => {
                    match signal {
                        Ok(event) => self.signal(&event),
                        Err(broadcast::error::RecvError::Lagged(_)) => {}
                        Err(broadcast::error::RecvError::Closed) => signals_open = false,
                    }
                    true
                }
                () = wake => self.rtc.handle_input(Input::Timeout(Instant::now())).is_ok(),
            };
            if !alive {
                break;
            }
        }
        self.link.open.store(false, Ordering::Release);
        self.rtc.disconnect();
    }

    /// Sends every pending datagram and handles every event. Returns the next timeout.
    async fn drain(&mut self) -> Option<Instant> {
        if let Some(mut channel) = self.rtc.channel(self.channel) {
            self.link
                .buffered
                .store(channel.buffered_amount(), Ordering::Relaxed);
        }
        loop {
            match self.rtc.poll_output().ok()? {
                Output::Timeout(deadline) => return Some(deadline),
                Output::Transmit(transmit) => {
                    let _ = self
                        .socket
                        .send_to(&transmit.contents, transmit.destination)
                        .await;
                }
                Output::Event(event) => {
                    if !self.event(event) {
                        return None;
                    }
                }
            }
        }
    }

    fn event(&mut self, event: Event) -> bool {
        match event {
            Event::ChannelOpen(id, label) if id == self.channel && label == POSE_LABEL => {
                self.link.open.store(true, Ordering::Release);
                if let Some(open_tx) = self.open_tx.take() {
                    let _ = open_tx.send(());
                }
            }
            Event::ChannelData(data) if data.id == self.channel => self.inbound.accept(&data.data),
            Event::ChannelClose(id) if id == self.channel => return false,
            Event::IceConnectionStateChange(state) => self.link.ice_up.store(
                matches!(
                    state,
                    IceConnectionState::Connected | IceConnectionState::Completed
                ),
                Ordering::Release,
            ),
            Event::PeerStats(stats) => self.link.record_peer(&stats),
            _ => {}
        }
        true
    }

    fn receive(&mut self, source: SocketAddr, bytes: &[u8]) -> bool {
        self.link.touch_inbound();
        let Ok(receive) = Receive::new(Protocol::Udp, source, self.local, bytes) else {
            return true;
        };
        self.rtc
            .handle_input(Input::Receive(Instant::now(), receive))
            .is_ok()
    }

    fn write(&mut self, frame: &[u8]) {
        let written = self.rtc.channel(self.channel).is_some_and(|mut channel| {
            let accepted = channel.buffered_amount() <= MAX_BUFFERED_BYTES
                && matches!(channel.write(true, frame), Ok(true));
            self.link
                .buffered
                .store(channel.buffered_amount(), Ordering::Relaxed);
            accepted
        });
        if written {
            self.link.sent.fetch_add(1, Ordering::Relaxed);
        } else {
            self.link.drop_frame();
        }
    }

    fn signal(&mut self, event: &ServerEvent) {
        if event.event != SIGNAL_EVENT {
            return;
        }
        if let Some(RelaySignal::Candidate(line)) = parse_signal(&event.payload) {
            if let Ok(candidate) = Candidate::from_sdp_string(&line) {
                self.rtc.add_remote_candidate(candidate);
            }
        }
    }
}

/// Pose frames over an unordered, zero-retransmit `str0m` DataChannel to the `ex_webrtc` relay.
pub struct Str0mTransport {
    signaling: SignalingClient,
    impairment: Option<ImpairmentConfig>,
    received_tx: broadcast::Sender<ReceivedPose>,
    link: Arc<Link>,
    outbox: Option<Outbox>,
    stop: Option<oneshot::Sender<()>>,
    driver: Option<JoinHandle<()>>,
    hz: u32,
    close_signaling: bool,
}

impl Str0mTransport {
    /// `signaling` must hold a slot in an `ex_webrtc` room.
    pub fn new(signaling: SignalingClient, impairment: Option<ImpairmentConfig>) -> Self {
        let (received_tx, _) = broadcast::channel(RECEIVED_CAPACITY);
        Self {
            signaling,
            impairment,
            received_tx,
            link: Arc::default(),
            outbox: None,
            stop: None,
            driver: None,
            hz: 0,
            close_signaling: true,
        }
    }

    /// `close` leaves the signalling connection open, for a client that shares it with a fallback path.
    pub fn keep_signaling_on_close(mut self) -> Self {
        self.close_signaling = false;
        self
    }

    async fn stop_driver(&mut self) {
        self.outbox = None;
        self.link.open.store(false, Ordering::Release);
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(mut driver) = self.driver.take() {
            if tokio::time::timeout(CLOSE_TIMEOUT, &mut driver)
                .await
                .is_err()
            {
                driver.abort();
            }
        }
    }
}

impl MocapTransport for Str0mTransport {
    async fn connect(
        &mut self,
        room: RoomRef,
        creds: TransportCreds,
    ) -> Result<(), TransportError> {
        if !matches!(creds, TransportCreds::ExWebRtc { .. }) {
            return Err(TransportError::WrongCreds {
                expected: TransportKind::ExWebRtc,
                actual: creds.kind(),
            });
        }
        if self.driver.is_some() {
            return Err(TransportError::AlreadyConnected);
        }
        let mut signals = self.signaling.subscribe_events();
        let (socket, local) = bind_host_socket(self.signaling.relay_url()).await?;

        let mut rtc = RtcConfig::new()
            .set_stats_interval(Some(STATS_INTERVAL))
            .build(Instant::now());
        rtc.add_local_candidate(Candidate::host(local, "udp").map_err(connect_err)?);
        let mut api = rtc.sdp_api();
        let channel = api.add_channel_with_config(ChannelConfig {
            label: POSE_LABEL.to_owned(),
            ordered: false,
            reliability: Reliability::MaxRetransmits { retransmits: 0 },
            ..Default::default()
        });
        let (offer, pending) = api
            .apply()
            .ok_or_else(|| connect_err("str0m produced no SDP offer"))?;

        let sdp = offer_dtls_client_role(&offer.to_sdp_string());
        self.signaling
            .send_signal(json!({"type": "offer", "sdp": sdp}))
            .await?;
        let (answer, early) = await_answer(&mut signals).await?;
        rtc.sdp_api()
            .accept_answer(pending, answer)
            .map_err(connect_err)?;
        early
            .into_iter()
            .for_each(|candidate| rtc.add_remote_candidate(candidate));

        let (frames_tx, frames) = mpsc::channel(1);
        let (open_tx, open_rx) = oneshot::channel();
        let (stop_tx, stop) = oneshot::channel();
        let driver = Driver {
            rtc,
            socket,
            local,
            channel,
            frames,
            signals,
            inbound: Inbound {
                tx: self.received_tx.clone(),
                link: Arc::clone(&self.link),
                impairment: self.impairment.map(ImpairmentFilter::new),
            },
            link: Arc::clone(&self.link),
            open_tx: Some(open_tx),
            stop,
        };
        self.hz = room.hz;
        self.stop = Some(stop_tx);
        self.driver = Some(tokio::spawn(driver.run()));
        self.outbox = Some(Outbox {
            tx: frames_tx,
            link: Arc::clone(&self.link),
        });

        match tokio::time::timeout(NEGOTIATION_TIMEOUT, open_rx).await {
            Ok(Ok(())) => Ok(()),
            _ => {
                self.stop_driver().await;
                Err(connect_err("pose DataChannel did not open"))
            }
        }
    }

    fn send_pose(&self, ciphertext: &[u8]) -> SendOutcome {
        self.outbox
            .as_ref()
            .map_or(SendOutcome::Disconnected, |outbox| outbox.offer(ciphertext))
    }

    fn subscribe(&self) -> broadcast::Receiver<ReceivedPose> {
        self.received_tx.subscribe()
    }

    fn stats(&self) -> TransportStats {
        let peer = self.link.peer();
        TransportStats {
            kind: TransportKind::ExWebRtc,
            rtt_ms: peer.rtt_ms,
            loss_pct: peer.loss_pct,
            jitter_ms: None,
            hz: self.hz,
            sent: self.link.sent.load(Ordering::Relaxed),
            dropped_backpressure: self.link.dropped_backpressure.load(Ordering::Relaxed),
            received: self.link.received.load(Ordering::Relaxed),
        }
    }

    async fn close(&mut self) {
        self.stop_driver().await;
        if self.close_signaling {
            self.signaling.close().await;
        }
    }
}

impl LinkHealth for Str0mTransport {
    fn is_connected(&self) -> bool {
        self.outbox.is_some() && self.link.is_up()
    }

    fn last_inbound(&self) -> Option<tokio::time::Instant> {
        *self
            .link
            .last_inbound
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::RELAY_ENVELOPE_LEN;

    fn open_link() -> Arc<Link> {
        let link = Arc::new(Link::default());
        link.open.store(true, Ordering::Release);
        link.ice_up.store(true, Ordering::Release);
        link
    }

    fn envelope(slot: u8) -> Vec<u8> {
        let mut bytes = vec![0xA5u8; RELAY_ENVELOPE_LEN];
        bytes[0] = slot;
        bytes
    }

    #[test]
    fn outbox_drops_a_frame_while_the_previous_one_is_not_drained() {
        let link = open_link();
        let (tx, mut rx) = mpsc::channel(1);
        let outbox = Outbox {
            tx,
            link: Arc::clone(&link),
        };
        assert_eq!(outbox.offer(&[1]), SendOutcome::Sent);
        assert_eq!(outbox.offer(&[2]), SendOutcome::DroppedBackpressure);
        assert_eq!(outbox.offer(&[3]), SendOutcome::DroppedBackpressure);
        assert_eq!(link.dropped_backpressure.load(Ordering::Relaxed), 2);

        assert_eq!(rx.try_recv().unwrap(), vec![1]);
        assert_eq!(outbox.offer(&[4]), SendOutcome::Sent);
        assert_eq!(rx.try_recv().unwrap(), vec![4]);
    }

    #[test]
    fn outbox_drops_when_sctp_buffers_more_than_1024_bytes() {
        let link = open_link();
        let (tx, mut rx) = mpsc::channel(1);
        let outbox = Outbox {
            tx,
            link: Arc::clone(&link),
        };
        link.buffered.store(1025, Ordering::Relaxed);
        assert_eq!(outbox.offer(&[1]), SendOutcome::DroppedBackpressure);
        assert!(rx.try_recv().is_err());
        link.buffered.store(1024, Ordering::Relaxed);
        assert_eq!(outbox.offer(&[1]), SendOutcome::Sent);
        assert_eq!(link.dropped_backpressure.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn outbox_reports_disconnected_when_closed_or_not_open() {
        let link = open_link();
        let (tx, rx) = mpsc::channel(1);
        let outbox = Outbox {
            tx,
            link: Arc::clone(&link),
        };
        link.ice_up.store(false, Ordering::Release);
        assert_eq!(outbox.offer(&[1]), SendOutcome::Disconnected);
        link.ice_up.store(true, Ordering::Release);
        drop(rx);
        assert_eq!(outbox.offer(&[1]), SendOutcome::Disconnected);
        assert_eq!(link.dropped_backpressure.load(Ordering::Relaxed), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn inbound_impairment_drops_about_ten_percent_and_delays_up_to_30ms() {
        const FRAMES: usize = 2000;
        let (tx, mut rx) = broadcast::channel(FRAMES * 2);
        let link = open_link();
        let mut inbound = Inbound {
            tx,
            link: Arc::clone(&link),
            impairment: Some(ImpairmentFilter::new(ImpairmentConfig {
                loss_pct: 10.0,
                jitter_ms: 30.0,
                seed: 11,
            })),
        };
        inbound.accept(&envelope(4));
        inbound.accept(&envelope(1)[..100]);
        (0..FRAMES).for_each(|_| inbound.accept(&envelope(2)));

        let delivered = |rx: &mut broadcast::Receiver<ReceivedPose>| {
            std::iter::from_fn(|| rx.try_recv().ok()).count()
        };
        tokio::task::yield_now().await;
        let immediate = delivered(&mut rx);
        tokio::time::sleep(Duration::from_millis(15)).await;
        let by_15ms = immediate + delivered(&mut rx);
        tokio::time::sleep(Duration::from_millis(16)).await;
        let by_31ms = by_15ms + delivered(&mut rx);
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(delivered(&mut rx), 0, "a frame arrived after 30 ms");

        let drop_pct = (FRAMES - by_31ms) as f64 / FRAMES as f64 * 100.0;
        assert!((drop_pct - 10.0).abs() < 1.5, "drop {drop_pct}");
        assert!(immediate < by_15ms / 10, "immediate {immediate}");
        assert!(
            by_15ms > by_31ms / 3 && by_15ms < by_31ms * 2 / 3,
            "by 15 ms {by_15ms}"
        );
        assert_eq!(link.received.load(Ordering::Relaxed), by_31ms as u64);
    }

    #[tokio::test]
    async fn inbound_without_impairment_delivers_slot_and_ciphertext() {
        let (tx, mut rx) = broadcast::channel(4);
        let mut inbound = Inbound {
            tx,
            link: open_link(),
            impairment: None,
        };
        inbound.accept(&envelope(3));
        let pose = rx.try_recv().unwrap();
        assert_eq!(pose.slot, 3);
        assert_eq!(pose.ciphertext, envelope(3)[1..].to_vec());
    }

    #[test]
    fn relay_signals_parse_answer_and_candidate_payloads() {
        assert_eq!(
            parse_signal(&json!({"type": "answer", "sdp": "v=0"})),
            Some(RelaySignal::Answer("v=0".into()))
        );
        let candidate = "candidate:1 1 UDP 2122252543 192.168.1.20 50001 typ host";
        assert_eq!(
            parse_signal(
                &json!({"type": "candidate", "candidate": candidate, "sdpMid": "0", "sdpMLineIndex": 0})
            ),
            Some(RelaySignal::Candidate(candidate.into()))
        );
        assert!(Candidate::from_sdp_string(candidate).is_ok());
        assert_eq!(
            parse_signal(&json!({"type": "candidate", "candidate": ""})),
            None
        );
        assert_eq!(parse_signal(&json!({"type": "offer", "sdp": "v=0"})), None);
    }

    #[test]
    fn offer_takes_the_dtls_client_role() {
        let mut rtc = Rtc::new(Instant::now());
        let mut api = rtc.sdp_api();
        api.add_channel(POSE_LABEL.to_owned());
        let (offer, _) = api.apply().unwrap();
        let original = offer.to_sdp_string();
        assert!(original.contains("a=setup:actpass\r\n"));

        let rewritten = offer_dtls_client_role(&original);
        assert!(rewritten.contains("a=setup:active\r\n"));
        assert!(!rewritten.contains("actpass"));
        assert!(str0m::change::SdpOffer::from_sdp_string(&rewritten).is_ok());
    }

    #[test]
    fn probe_target_uses_a_routable_relay_ip_or_the_default_route() {
        let lan = Ipv4Addr::new(192, 168, 1, 20);
        assert_eq!(
            probe_target(Some(lan)),
            SocketAddr::new(lan.into(), PROBE_PORT)
        );
        assert_eq!(probe_target(Some(Ipv4Addr::LOCALHOST)), FALLBACK_PROBE);
        assert_eq!(probe_target(Some(Ipv4Addr::UNSPECIFIED)), FALLBACK_PROBE);
        assert_eq!(probe_target(None), FALLBACK_PROBE);
    }
}
