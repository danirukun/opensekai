# Multiplayer transport spike design (`ex_webrtc` + `str0m` vs LiveKit)

Date: 2026-11-27. Status: approved for spec review. Authority: [ADR 0001](../../adr/0001-multiplayer-collab-relay-and-transport.md).

## Intent

ADR 0001 stays in status `Proposed` until a transport spike proves that the chosen relay and client stack meets the multiplayer motion target on Fly.io (`ams`): 1 host plus 3 guests, 60 Hz default (30 Hz optional), p95 added latency at or below 150 ms within Europe, no visible freeze above 100 ms under 1% loss and 30 ms jitter, and zero peer IP exposure.

This spike builds the real relay skeleton in `apps/relay` and the shared Rust transport crate in `crates/collab-transport`. It benchmarks the primary path (`ExWebRTCRelay` + `Str0mTransport`), the explore path (`LiveKitRelay` + `LiveKitTransport`), and the last-resort baseline (`WebSocketFrames` + `WebSocketTransport`) locally and on Fly.io `ams`. `apps/desktop` does not change in this spike.

## Goals

- G1. Create `apps/relay` (Elixir / Phoenix, pure Elixir Docker image, self-hostable via env vars) with in-memory `RoomSupervisor`, `RoomRegistry`, and `RoomServer` (max 4 peers: slot `0` host, slots `1..3` guests).
- G2. Enforce the ADR 0001 room lifecycle in signalling (`room:<id>` Phoenix Channel): host creates room with `host_secret`, guest knocks, host approves before any transport session opens, kick closes the peer transport session immediately, and host can reclaim the room after a relay restart so guests rejoin through one approval.
- G3. Define the `Relay.Transport` behaviour (`open_session/2`, `negotiate/3`, `forward/3`, `stats/1`, `close/2`) and implement `ExWebRTCRelay` (`ex_webrtc` 0.18 + `ex_sctp` 0.1.3), `LiveKitRelay` (HS256 JWT + Twirp HTTP, TURN off), and `WebSocketFrames`.
- G4. Create `crates/collab-transport` (Rust workspace member) with the `MocapTransport` trait, `sekai-pose/1` AES-256-GCM test frame codec (340 B plaintext, 368 B ciphertext), `WebSocketTransport`, `Str0mTransport` (`str0m` 0.26), `LiveKitTransport` (`livekit` 0.12 behind optional Cargo feature `livekit`), and `AutoUpgradeTransport` (immediate WebSocket start, upgrade to UDP when open, drop back after 1 s total loss, retry with backoff).
- G5. Run one shared conformance suite (`connect`, 60 Hz and 30 Hz send/receive, 4-peer fan-out, kick stops delivery, close) against all three transports.
- G6. Deploy `apps/relay` and a separate self-hosted LiveKit SFU app (`apps/relay/deploy/livekit/`) to Fly.io `ams` (dedicated IPv4s, TURN off) and run `transport-bench` to measure ICE success rate, setup time, RTT and one-way p50/p95/p99, loss %, RFC 3550 jitter, max gap (> 100 ms freeze check under synthetic 1% loss and 30 ms jitter), LiveKit lossy packet vs data track ordering under loss, Fly UDP port-range routing (`50000..50999` vs individual ports if range fails), restart reclaim/rejoin time, and CPU/RAM scaling toward 100 rooms.
- G7. Record all measurements, environment facts, and the transport gate verdict in `docs/evaluation/transport-spike.md`. Update `ARCHITECTURE.md` and `docs/dependencies.md` for `apps/relay` and `crates/collab-transport`.

## Non-goals

- N1. Do not wire `crates/collab-transport` into `apps/desktop` or `packages/session` in this slice.
- N2. Do not build avatar E2EE upload/R2 transfer, HPKE safety words UI, join-link web pages, Lane B edit RPC, or visemes.
- N3. Do not build the `sekai-rt` WebTransport sidecar or `CloudflareRealtime` Plan B unless Fly UDP fails in G6 (if it fails, stop and document the trigger).
- N4. Do not enable TURN or use LiveKit Cloud.

## Architecture and boundaries

### Relay (`apps/relay`)

- **Supervision:** `Relay.RoomSupervisor` (`DynamicSupervisor`) supervises one `Relay.RoomServer` per active room, registered in `Relay.RoomRegistry` (`Registry`). State stays in memory only.
- **Room protocol (Phoenix Channel `room:<room_id>`):**
  - `create` (host): registers room with `host_secret`, `transport_kind` (`"ex_webrtc"` | `"livekit"` | `"websocket"`), and `hz` (`60` | `30`). Returns `slot: 0`.
  - `reclaim` (host): recreates or reattaches room after a restart using the same `room_id` and `host_secret`.
  - `knock` (guest): queues a pending join request (`knock_id`, `display_name`) and notifies the host. No transport session opens yet.
  - `approve` (host, `knock_id`): assigns the lowest free slot (`1..3`, rejects when 4 peers are active), calls `transport.open_session/2`, and returns transport credentials to the guest.
  - `reject` (host, `knock_id`): denies the knock.
  - `kick` (host, `slot`): removes the slot, calls `transport.close/2`, and notifies the room.
  - `signal` (approved peer): forwards SDP offer/answer and ICE candidates through `transport.negotiate/3`.
  - `pose` (binary push on Channel): accepted from approved peers for `WebSocketFrames` and forwarded as `[slot: 1 B][ciphertext: 368 B]` to the other active peers in the room.
  - `set_hz` (host, `60 | 30`): broadcasts the active room rate.
  - `stats` (any approved peer): returns `transport.stats/1` and room counts.
- **`Relay.Transport` behaviour:**
  - `open_session(room_ctx, peer_slot) :: {:ok, session_state, client_creds} | {:error, term()}`
  - `negotiate(session_state, peer_slot, signal_payload) :: {:ok, session_state, outbound_signals} | {:error, term()}`
  - `forward(session_state, from_slot, ciphertext_bin) :: {:ok, session_state} | {:error, term()}`
  - `stats(session_state) :: map()`
  - `close(session_state, peer_slot | :all) :: :ok`
- **Adapters:**
  - `ExWebRTCRelay`: supervises one `ExWebRTC.PeerConnection` per approved slot under `Relay.PeerSupervisor`, one global `DynamicSupervisor` for all rooms. The client acts as the SDP offerer and creates DataChannel `"pose"` with `ordered: false, max_retransmits: 0`; `ExWebRTCRelay` sets the remote offer, creates the SDP answer, exchanges trickle ICE candidates via `signal`, and accepts the inbound `"pose"` DataChannel. Configures `ice_ip_filter` to `RELAY_UDP_BIND_IP` (`fly-global-services` on Fly; a non-loopback LAN IPv4 locally, because `ex_ice` rejects `127.0.0.1`), `host_to_srflx_ip_mapper` to `RELAY_PUBLIC_IPV4` when set, and `ice_port_range` from `RELAY_ICE_PORT_MIN..RELAY_ICE_PORT_MAX` (default `50000..50999`). On incoming DataChannel binary message from `from_slot`, validates byte size (`<= 1200 B`) and sends `<<from_slot::8, ciphertext::binary>>` to every other room member. A member with an open `"pose"` DataChannel gets the frame on that channel. A member without one (not open yet, or after a fallback to WebSocket) gets it as a WebSocket `pose` push. No member gets the same frame twice. A WebSocket `pose` from a member of an `ex_webrtc` room fans out by the same rule. The relay uses one ECDSA P-256 DTLS certificate for each node, because `str0m` 0.26 (`dimpl`) accepts only ECDSA. Each `offer` starts a new peer connection for the slot and stops the old one, so a client can retry after a failure.
  - `LiveKitRelay`: no media/UDP inside BEAM. On `approve`, calls LiveKit Twirp `CreateRoom` (idempotent) and returns `{url, token}` where `token` is an HS256 JWT with identity `"slot-<N>"`, `roomJoin: true`, `canPublishData: true`, `canSubscribe: true`, `canPublish: false` (no audio/video). On `kick` / `close`, calls `RemoveParticipant` / `DeleteRoom`. LiveKit server runs with TURN disabled (`turn.enabled: false`).
  - `WebSocketFrames`: broadcasts `<<from_slot::8, ciphertext::binary>>` over the room channel to all other approved sockets.

### Client crate (`crates/collab-transport`)

- **Trait (`MocapTransport`):**
  - `async fn connect(&mut self, room: RoomRef, creds: TransportCreds) -> Result<(), TransportError>`
  - `fn send_pose(&self, ciphertext: &[u8]) -> SendOutcome` (`Sent` | `DroppedBackpressure` | `Disconnected`) — non-blocking, latest-only; never queues behind unsent frames.
  - `fn subscribe(&self) -> broadcast::Receiver<ReceivedPose>` (or callback subscription returning a drop guard) yielding `ReceivedPose { slot: u8, ciphertext: Vec<u8>, received_at_us: u64 }`.
  - `fn stats(&self) -> TransportStats` (`kind`, `rtt_ms`, `loss_pct`, `jitter_ms`, `hz`, `sent`, `dropped_backpressure`, `received`).
  - `async fn close(&mut self, reason: Option<&str>)`
- **Wire format (`sekai-pose/1` test frame):**
  - Plaintext (340 B): `version: u8 (1)`, `slot: u8 (0..=3)`, `flags: u8`, `reserved: u8`, `seq: u32` (BE), `sender_ts_us: u64` (BE), `body: [u8; 324]`.
  - Encryption: AES-256-GCM with 32-byte room key. Nonce (12 B) = `slot (1 B) || 0u8 (3 B) || seq (4 B, BE) || salt (4 B)`. AAD = `b"sekai-pose/1" || [slot]`. Nonce rule: each sender session MUST generate a fresh random 4-byte `salt`, or the 32-byte room group key MUST rotate on every membership change and rejoin. Then `(key, slot, seq, salt)` never repeats on rejoin, reconnect, or slot reuse.
  - Ciphertext on the wire = `nonce (12 B) || enc_payload (340 B) || tag (16 B)` = **368 bytes**.
  - Relay-to-receiver envelope on `ExWebRTCRelay` and `WebSocketFrames`: `[slot: 1 B][ciphertext: 368 B]` = 369 B. On `LiveKitRelay`, LiveKit carries the 368 B payload with participant identity `"slot-<N>"`.
- **Implementations:**
  - `WebSocketTransport`: Phoenix V2 channel wire framing (`tokio-tungstenite`), binary push/receive for poses plus JSON signalling client shared by all adapters.
  - `Str0mTransport`: sans-I/O `str0m` 0.26 driven by a `tokio::net::UdpSocket` task. Negotiates SDP/ICE over the signalling channel. Opens DataChannel `"pose"` (`ordered: false, max_retransmits: 0`). Checks `str0m` SCTP buffered amount before each write and drops the frame (`DroppedBackpressure`) if buffered bytes exceed 16 KiB (about 0.7 s of 60 Hz poses). The `str0m` buffered amount also counts in-flight bytes until a SACK or abandonment. The first bound of one frame (1024 B) dropped 42% of frames on the Fly `ams` path (refer to [the transport spike record](../../evaluation/transport-spike.md)).
  - `LiveKitTransport` (Cargo feature `livekit`, disabled by default): wraps `livekit` 0.12. Supports two modes for the spike comparison: `LossyPacket` (`publish_data` with `reliable: false`) and `DataTrack` (data track publish/subscribe to verify whether gaps stall subsequent frames). The `livekit` dependency enables `rustls-tls-webpki-roots`; without a TLS feature, `wss://` signalling fails with `TLS support not compiled in`. On macOS, a binary that links the feature needs the `-ObjC` linker flag, or `libwebrtc` aborts at the first peer connection. The `collab-transport` build script adds it for the tests of the crate.
  - `AutoUpgradeTransport`: wraps `WebSocketTransport` + one primary UDP transport (`Str0mTransport` or `LiveKitTransport`). Starts sending on WebSocket immediately after approval, switches active send/receive path to UDP as soon as primary connects, falls back to WebSocket on primary disconnect or after 1000 ms of total loss (no received UDP poses or ping reply while sending/expecting frames) while WebSocket is alive, and retries primary with exponential backoff (2 s, 4 s, 8 s, cap 30 s).

### Deployment topology

- **App 1 (`apps/relay/fly.toml`):** Fly `ams`, `shared-cpu-2x` (or `performance-1x` for 100-room load test, recorded in evaluation doc), 1 dedicated IPv4, HTTPS/WSS on 443 -> internal 4000, UDP ports `50000-50399`, one `[[services]]` entry for each port with the same internal port (a UDP port-range service received no packets on Fly, Scenario C), `RELAY_UDP_BIND_IP=fly-global-services`, `RELAY_PUBLIC_IPV4=<dedicated IPv4>`.
- **App 2 (`apps/relay/deploy/livekit/fly.toml`):** Fly `ams`, official `livekit/livekit-server` image, 1 dedicated IPv4, HTTPS/WSS on 443 -> internal 7880, single UDP mux port `7882` -> internal `7882`, `use_external_ip: false` with explicit `node_ip: <dedicated IPv4>`, `turn.enabled: false`.
- **Local dev (`apps/relay/deploy/livekit/docker-compose.yml`):** runs `livekit/livekit-server --dev` on localhost for conformance tests without cloud access.

## Verification and benchmark matrix

1. **Unit tests:**
   - Rust: `sekai-pose/1` round-trip and exact 368 B length, AES-GCM tamper and wrong-slot AAD rejection, latest-only backpressure drop, jitter/loss/gap statistics calculator, `AutoUpgradeTransport` 1 s loss fallback and backoff timer.
   - Elixir (`mix test`): `RoomServer` 4-peer limit, mandatory knock/approval, reject, kick tears down transport, host reclaim after process restart, `LiveKitRelay` JWT claims and expiry, `ExWebRTCRelay` session lifecycle.
2. **Conformance suite (`crates/collab-transport` integration tests):**
   - Runs one shared test matrix against `WebSocketFrames`, `ExWebRTCRelay`, and `LiveKitRelay` (when local LiveKit is running): connect, 4-peer full mesh at 60 Hz and 30 Hz, verify decrypted sequence integrity across all 3 receivers per sender, kick stops delivery within 200 ms, clean close.
3. **Fly `ams` benchmarks (`transport-bench` CLI):**
   - **Scenario A (4-peer full mesh, 60 Hz and 30 Hz, 30 s each):** `ex_webrtc` (`str0m`), `livekit` (`LossyPacket`), `livekit` (`DataTrack`), and `websocket`. Records ICE success rate, setup time (ms), RTT p50/p95/p99, estimated one-way latency p50/p95/p99, loss %, RFC 3550 jitter (ms), max inter-arrival gap (ms).
   - **Scenario B (synthetic impairment, 1% random loss + 30 ms jitter):** compares raw and 40 ms jitter-buffer max freeze gap across `ex_webrtc`, `livekit` (`LossyPacket`), `livekit` (`DataTrack`), and `websocket`, verifying whether freezes stay at or below 100 ms and whether LiveKit data tracks hold later frames on a gap.
   - **Scenario C (Fly UDP port-range check):** verifies `50000-50999` range routing on Fly `ams`; if packets fail to arrive, tests explicit individual UDP service entries and records the outcome.
   - **Scenario D (deploy / restart recovery):** restarts the `apps/relay` Fly Machine during an active 60 Hz room and measures host reclaim + guest rejoin + pose resume time.
   - **Scenario E (CPU / memory headroom):** ramps concurrent 4-peer 60 Hz rooms against Fly `ams` (10, 25, 50, up to 100 rooms or CPU saturation) and records Fly Machine CPU %, RSS memory, and latency degradation for `ex_webrtc` and `livekit`.

## Gate criteria (from ADR 0001)

- `ExWebRTCRelay` + `Str0mTransport` stays the primary path if Fly UDP routes cleanly, ICE connects reliably, p95 added latency is at or below 150 ms, no freeze exceeds 100 ms at 1% loss / 30 ms jitter, and CPU headroom supports target room density.
- Switch primary to `LiveKitRelay` only if `LiveKitRelay` beats `ExWebRTCRelay` on ICE success, loss, jitter, and p95 latency without head-of-line stalls and builds cleanly.
- Trigger WebTransport sidecar or `CloudflareRealtime` Plan B only if Fly UDP fails for `ex_webrtc`.
