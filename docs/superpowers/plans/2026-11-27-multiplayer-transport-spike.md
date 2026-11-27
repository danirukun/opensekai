# Multiplayer Transport Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `apps/relay` Elixir/Phoenix relay and `crates/collab-transport` Rust crate, run shared conformance tests across `ExWebRTCRelay` (`str0m`), `LiveKitRelay` (`livekit`), and `WebSocketFrames`, deploy both servers to Fly.io `ams`, and record the ADR 0001 transport gate evidence in `docs/evaluation/transport-spike.md`.

**Architecture:** `apps/relay` supervises one in-memory `Relay.RoomServer` per room (`DynamicSupervisor` + `Registry`, max 4 peers, slot `0` host, `1..3` guests) behind Phoenix Channels (`room:<room_id>`) and a `Relay.Transport` behaviour with three adapters (`ExWebRTC`, `LiveKit`, `WebSocket`). `crates/collab-transport` implements `MocapTransport`, AES-256-GCM `sekai-pose/1` test frames (340 B plaintext -> 368 B ciphertext), `WebSocketTransport`, `Str0mTransport`, feature-gated `LiveKitTransport`, `AutoUpgradeTransport`, shared conformance tests, and the `transport-bench` CLI.

**Tech Stack:** Elixir 1.20 / Phoenix 1.8 / Bandit 1.15 / `ex_webrtc` 0.18.0 / `ex_sctp` 0.1.3; Rust 1.93.1 / Tokio 1.53 / `str0m` 0.26.0 / `aes-gcm` 0.11.1 / `tokio-tungstenite` 0.30.0 / optional `livekit` 0.12.1; Fly.io `ams` + self-hosted `livekit/livekit-server`.

## Global Constraints

- Authority: `docs/adr/0001-multiplayer-collab-relay-and-transport.md`, `docs/superpowers/specs/2026-11-27-multiplayer-transport-spike-design.md`, and `spdd/prompt/2026-11-27-multiplayer-transport-spike.md`.
- Worktree: `/Users/danirukun/ghq/github.com/oshi-connect/opensekai/.worktrees/multiplayer-transport-spike` on branch `feat/multiplayer-transport-spike`.
- `apps/desktop` and `packages/session` MUST NOT be modified in this spike.
- Run all Cargo commands via `direnv exec . cargo ...` so builds use the shared `$HOME/.cache/opensekai/target` directory.
- Hard cap of 4 peers per room (`slot` `0` host, `1..3` guests). Never open a peer transport session before explicit host `approve`. Close the peer transport session immediately on `kick` or leave.
- Relay forwards opaque ciphertext only; never decrypt pose frames on the relay, never expose peer IP addresses, never enable TURN, and never use LiveKit Cloud.
- `sekai-pose/1` wire sizes: 340 B plaintext (`version: u8 = 1`, `slot: u8`, `flags: u8`, `reserved: u8`, `seq: u32 BE`, `sender_ts_us: u64 BE`, `body: [u8; 324]`), AES-256-GCM nonce `slot(1) || 0(3) || seq(4 BE) || salt(4)` (12 B), AAD `b"sekai-pose/1" || [slot]`, ciphertext `nonce(12) || enc(340) || tag(16)` = 368 B. Relay-to-receiver envelope on `ExWebRTC` and `WebSocket`: `[slot: 1 B][ciphertext: 368 B]` = 369 B. LiveKit carries 368 B payload with participant identity `"slot-<N>"`.
- `livekit` Rust dependency MUST stay behind optional Cargo feature `livekit` (off by default).
- Never add `Co-Authored-By` or agent attribution trailers to commits (use `git -c core.hooksPath=/dev/null commit ...` if the host hook injects a trailer, and verify with `git log -1 --format=%B`).
- Write long prose in ASD-STE100 Simplified Technical English; record unavailable measurements as `unknown`, never zero.

---

### Task 1: `apps/relay` scaffold, `RoomServer`, `RoomChannel`, `Relay.Transport`, and `WebSocketFrames`

**Files:**
- Create: `apps/relay/mix.exs`
- Create: `apps/relay/config/config.exs`
- Create: `apps/relay/config/dev.exs`
- Create: `apps/relay/config/test.exs`
- Create: `apps/relay/config/runtime.exs`
- Create: `apps/relay/lib/relay/application.ex`
- Create: `apps/relay/lib/relay/endpoint.ex`
- Create: `apps/relay/lib/relay/router.ex`
- Create: `apps/relay/lib/relay/user_socket.ex`
- Create: `apps/relay/lib/relay/transport.ex`
- Create: `apps/relay/lib/relay/transport/websocket.ex`
- Create: `apps/relay/lib/relay/room_supervisor.ex`
- Create: `apps/relay/lib/relay/room_server.ex`
- Create: `apps/relay/lib/relay/room_channel.ex`
- Test: `apps/relay/test/test_helper.exs`
- Test: `apps/relay/test/support/channel_case.ex`
- Test: `apps/relay/test/relay/room_server_test.exs`
- Test: `apps/relay/test/relay/room_channel_test.exs`

**Interfaces:**
- Consumes: none (first task).
- Produces:
  - `Relay.Transport` behaviour callbacks:
    - `open_session(room_ctx :: map(), peer_slot :: 0..3) :: {:ok, state :: term(), creds :: map()} | {:error, term()}`
    - `negotiate(state :: term(), peer_slot :: 0..3, signal :: map()) :: {:ok, state :: term(), signals :: [map()]} | {:error, term()}`
    - `forward(state :: term(), from_slot :: 0..3, ciphertext :: binary()) :: {:ok, state :: term()} | {:error, term()}`
    - `stats(state :: term()) :: map()`
    - `close(state :: term(), target :: 0..3 | :all) :: :ok`
  - `Relay.RoomServer` API: `start_link/1`, `create_or_reclaim/5`, `knock/3`, `approve/3`, `reject/3`, `kick/3`, `leave/2`, `signal/3`, `forward_ws_pose/3`, `set_hz/3`, `stats/1`, `lookup/1`.
  - Phoenix Channel topic `"room:" <> room_id` on `/socket` (V2 JSON + binary serializer) with events: `"create"`, `"reclaim"`, `"knock"`, `"approve"`, `"reject"`, `"kick"`, `"signal"`, `"set_hz"`, `"stats"`, `"pose"` (binary push).
  - Health endpoint: `GET /healthz` returning `200 {"status":"ok"}`.

- [ ] **Step 1: Create `apps/relay/mix.exs` and config files**

Create `apps/relay/mix.exs` with `phoenix ~> 1.8.0`, `bandit ~> 1.15.0`, `jason ~> 1.4`, `ex_webrtc ~> 0.18.0`, `ex_sctp ~> 0.1.3`. Configure `Relay.Endpoint` with `Bandit.PhoenixAdapter`, `pubsub_server: Relay.PubSub`, and `check_origin: false` (non-browser Rust clients connect directly). In `config/runtime.exs`, read `PORT` (default `4000`), `SECRET_KEY_BASE` (dev/self-host default generated or env), `RELAY_UDP_BIND_IP` (default `"127.0.0.1"`), `RELAY_PUBLIC_IPV4` (default `nil`), `RELAY_ICE_PORT_MIN` (default `50000`), `RELAY_ICE_PORT_MAX` (default `50999`), `LIVEKIT_URL` (default `"ws://127.0.0.1:7880"`), `LIVEKIT_HTTP_URL` (default `"http://127.0.0.1:7880"`), `LIVEKIT_API_KEY` (default `"devkey"`), `LIVEKIT_API_SECRET` (default `"secret"`).

- [ ] **Step 2: Fetch deps and verify `mix compile` works cleanly**

Run in `apps/relay`: `mix deps.get && mix compile`
Expected: `ex_webrtc`, `ex_sctp` (Rustler NIF), `phoenix`, `bandit`, and `jason` compile with exit code 0. (If `ex_sctp` NIF fails on host OTP 29, record the exact compiler error before adapting.)

- [ ] **Step 3: Write failing tests for `RoomServer` and `RoomChannel`**

Create `apps/relay/test/relay/room_server_test.exs` and `apps/relay/test/relay/room_channel_test.exs` testing:
1. Host creates room -> gets `slot: 0`, `hz: 60`.
2. Guest knocks -> gets `knock_id`; no transport session opened until host calls `approve`.
3. Host approves 3 guests -> slots `1`, `2`, `3` assigned; 4th guest approval rejected with `{:error, :room_full}`.
4. Host rejects knock -> pending knock removed, guest receives `"rejected"`.
5. Host kicks slot `1` -> transport `close(state, 1)` called immediately, slot freed, kicked peer's further poses rejected.
6. Host `reclaim` after `RoomServer` process stops -> recreates room with same `room_id` and `host_secret`, rejects wrong `host_secret`, guest can knock and be approved again.
7. `WebSocketFrames` binary `"pose"` push from slot `0` delivers `<<0, payload::binary>>` to slots `1..3` and NOT back to slot `0`.
8. Non-host cannot call `approve`, `reject`, `kick`, or `set_hz`.

Run: `mix test`
Expected: FAIL (modules not defined yet).

- [ ] **Step 4: Implement `Relay.Transport`, `Relay.Transport.WebSocket`, `Relay.RoomSupervisor`, `Relay.RoomServer`, `Relay.RoomChannel`, `Relay.UserSocket`, `Relay.Router`, `Relay.Endpoint`, `Relay.Application`**

Key details:
- `Relay.RoomServer` holds: `room_id`, `host_secret`, `transport_mod`, `transport_state`, `hz` (`60` | `30`), `peers` (`%{slot => %{pid: channel_pid, ref: monitor_ref, display_name: String.t()}}`), `pending_knocks` (`%{knock_id => %{pid: channel_pid, ref: monitor_ref, display_name: String.t()}}`).
- Monitor every connected channel pid (`Process.monitor/1`). On `{:DOWN, ref, :process, pid, _}`, remove pending knock or active peer slot and invoke `transport_mod.close(state, slot)`. When host disconnects and no peers remain (or after idle timeout), stop `RoomServer` cleanly.
- `Relay.Transport.WebSocket` stores `room_id` and active `peers` map; `forward/3` sends `{:ws_pose, <<from_slot::8, ciphertext::binary>>}` directly to every other peer's `channel_pid`, and `RoomChannel.handle_info({:ws_pose, bin}, socket)` pushes `{:binary, bin}` with event `"pose"`. Enforce `byte_size(ciphertext) <= 1200`.
- `RoomChannel` joins `"room:" <> room_id` without assigning a slot yet (`assigns.slot == nil`). `"create"` / `"reclaim"` assigns `slot: 0`. `"knock"` registers pending knock and pushes `"knock_received"` to host pid. `"approve"` sends `{:approved, slot, creds, hz}` to the knocking guest's channel pid, which assigns `slot` and pushes `"approved"` to the guest socket. `"kick"` sends `:kicked` to the target channel pid, which pushes `"kicked"` and stops the channel.

- [ ] **Step 5: Run `mix test` and verify all tests pass**

Run in `apps/relay`: `mix test`
Expected: PASS (0 failures).

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/relay
git -c core.hooksPath=/dev/null commit -m "feat(relay): scaffold apps/relay with RoomServer, RoomChannel, and WebSocket transport"
```
Verify no agent trailer with `git log -1 --format=%B`.

---

### Task 2: `ExWebRTCRelay` (`ex_webrtc` + `ex_sctp`) and `LiveKitRelay` (JWT + Twirp) adapters

**Files:**
- Create: `apps/relay/lib/relay/transport/ex_webrtc.ex`
- Create: `apps/relay/lib/relay/transport/ex_webrtc_peer.ex`
- Create: `apps/relay/lib/relay/transport/livekit.ex`
- Modify: `apps/relay/lib/relay/room_server.ex` (wire `"ex_webrtc"` -> `Relay.Transport.ExWebRTC`, `"livekit"` -> `Relay.Transport.LiveKit`, `"websocket"` -> `Relay.Transport.WebSocket`, and route `{:transport_signal, slot, payload}` from transport back to the peer's channel pid)
- Test: `apps/relay/test/relay/transport/ex_webrtc_test.exs`
- Test: `apps/relay/test/relay/transport/livekit_test.exs`

**Interfaces:**
- Consumes: `Relay.Transport` behaviour and `Relay.RoomServer` dispatch from Task 1.
- Produces:
  - `Relay.Transport.ExWebRTC` implementing `Relay.Transport`:
    - `open_session/2` starts a supervised `ExWebRTCPeer` (`ExWebRTC.PeerConnection` with `ice_ip_filter`, `host_to_srflx_ip_mapper`, `ice_port_range`, `ice_aggressive_nomination: true`) and returns `%{kind: "ex_webrtc", slot: slot, ice_servers: []}`.
    - `negotiate/3` handles `%{"type" => "offer", "sdp" => sdp}` (sets remote offer, creates & sets local answer, returns `[%{"type" => "answer", "sdp" => answer.sdp}]`) and `%{"type" => "candidate", "candidate" => cand, "sdpMid" => mid, "sdpMLineIndex" => idx}` (calls `ExWebRTC.PeerConnection.add_ice_candidate/2`). Trickle local ICE candidates are sent to the peer's channel as `%{"type" => "candidate", "candidate" => ..., "sdpMid" => ..., "sdpMLineIndex" => ...}`.
    - Incoming DataChannel `"pose"` binary message `ciphertext` (`byte_size <= 1200`) calls `forward/3`, which sends `<<from_slot::8, ciphertext::binary>>` via `ExWebRTC.PeerConnection.send_data(pc, dc_ref, frame, :binary)` to every other open peer DataChannel in the room.
  - `Relay.Transport.LiveKit` implementing `Relay.Transport`:
    - `mint_token(room_id, slot, api_key, api_secret, opts)` -> HS256 JWT with `iss`, `sub: "slot-#{slot}"`, `nbf`, `exp`, `video: %{roomJoin: true, room: room_id, canPublish: false, canSubscribe: true, canPublishData: true}`.
    - `open_session/2` calls Twirp `POST /twirp/livekit.RoomService/CreateRoom` (with `name: room_id`, `max_participants: 4`, Bearer service JWT) and returns `%{kind: "livekit", slot: slot, url: livekit_ws_url, token: peer_jwt, room: room_id}`.
    - `close/2` calls `RemoveParticipant` for single slot or `DeleteRoom` for `:all`.

- [ ] **Step 1: Write failing ExUnit tests for `ExWebRTC` and `LiveKit` transports**

Create `apps/relay/test/relay/transport/ex_webrtc_test.exs`:
- Starts two client-side `ExWebRTC.PeerConnection` instances in the test process, each creating DataChannel `"pose"` (`ordered: :unordered, max_retransmits: 0`).
- Runs SDP offer/answer + ICE candidate exchange through `Relay.Transport.ExWebRTC` for slots `0` and `1` on `127.0.0.1`.
- Sends a 368-byte binary frame from client 0 -> asserts client 1 receives `<<0, payload::binary-size(368)>>` and client 0 does not receive its own frame.
- Closes slot `1` via `ExWebRTC.close(state, 1)` -> asserts subsequent frames from client 0 are no longer delivered to client 1.

Create `apps/relay/test/relay/transport/livekit_test.exs`:
- Verifies `mint_token/5` decodes header `{"alg":"HS256","typ":"JWT"}`, valid HMAC-SHA256 signature, `sub == "slot-2"`, `video.roomJoin == true`, `video.canPublish == false`, `video.canPublishData == true`, `video.canSubscribe == true`.
- Uses an injected HTTP client function (`http_post_fn`) to verify `open_session/2` calls `CreateRoom` with `max_participants: 4` and returns `%{kind: "livekit", url: _, token: _}`, `close(state, 1)` calls `RemoveParticipant` with `identity: "slot-1"`, and `close(state, :all)` calls `DeleteRoom`.

Run in `apps/relay`: `mix test test/relay/transport/`
Expected: FAIL (modules not defined yet).

- [ ] **Step 2: Implement `ExWebRTCPeer` and `Relay.Transport.ExWebRTC`**

- Parse `RELAY_UDP_BIND_IP`: if `"fly-global-services"`, resolve via `:inet.getaddr(~c"fly-global-services", :inet)`; otherwise parse IPv4 tuple via `:inet.parse_address/1`. Build `ice_ip_filter: fn ip -> ip == bind_ip end`.
- Parse `RELAY_PUBLIC_IPV4`: if non-empty, build `host_to_srflx_ip_mapper: fn _ip -> public_ip end`; else `nil`.
- `ice_port_range`: `port_min..port_max` (in test config, `40000..40500` on `127.0.0.1`).
- Use an ETS table or registry per room (or `RoomServer` forward cast) so incoming `{:ex_webrtc, pc, {:data, _ref, bin}}` forwards `<<slot::8, bin::binary>>` without blocking other peers. Guard `byte_size(bin) <= 1200`. Track counters (`frames_in`, `frames_out`, `bytes_in`, `bytes_out`, `dropped_oversize`) for `stats/1`.
- On `close(state, slot)`, stop the peer's `ExWebRTC.PeerConnection` immediately (`ExWebRTC.PeerConnection.close(pc)` + terminate child) and remove it from the room fan-out table.

- [ ] **Step 3: Implement `Relay.Transport.LiveKit`**

- Implement pure-Elixir HS256 JWT encoding with `Base.url_encode64(..., padding: false)` and `:crypto.mac(:hmac, :sha256, secret, signing_input)`.
- Service JWT for Twirp (`roomCreate: true, roomAdmin: true, room: room_id`).
- Use `:httpc.request(:post, ...)` with 5 s timeout (`:inets` and `:ssl` started in `mix.exs` `extra_applications`), accepting an injectable `http_post` option in `room_ctx` for unit tests.

- [ ] **Step 4: Wire both adapters into `Relay.RoomServer` and `Relay.RoomChannel`**

Ensure `RoomChannel` forwards `{:relay_signal, signal_map}` from `RoomServer` / `ExWebRTCPeer` to the client socket as `"signal"`, and forwards client `"signal"` pushes to `RoomServer.signal/3`.

- [ ] **Step 5: Run full `apps/relay` test suite**

Run in `apps/relay`: `mix test`
Expected: PASS (all RoomServer, RoomChannel, ExWebRTC, and LiveKit tests pass with 0 failures).

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/relay
git -c core.hooksPath=/dev/null commit -m "feat(relay): add ExWebRTC and LiveKit transport adapters"
```
Verify no agent trailer with `git log -1 --format=%B`.

---

### Task 3: `crates/collab-transport` core (codec, AES-GCM cipher, stats, `MocapTransport`, `SignalingClient`, `WebSocketTransport`)

**Files:**
- Modify: `Cargo.toml` (add `"crates/collab-transport"` to workspace members; pin `aes-gcm = "=0.11.1"`, `str0m = "=0.26.0"`, `clap = "=4.6.10"`, `thiserror = "=2.0.21"`)
- Create: `crates/collab-transport/Cargo.toml`
- Create: `crates/collab-transport/src/lib.rs`
- Create: `crates/collab-transport/src/codec.rs`
- Create: `crates/collab-transport/src/stats.rs`
- Create: `crates/collab-transport/src/signaling.rs`
- Create: `crates/collab-transport/src/websocket.rs`

**Interfaces:**
- Consumes: `apps/relay` Phoenix Channel protocol from Task 1.
- Produces:
  - `codec::POSE_PLAINTEXT_LEN = 340`, `codec::POSE_WIRE_LEN = 368`, `codec::RELAY_ENVELOPE_LEN = 369`.
  - `codec::PoseFrame { version: u8, slot: u8, flags: u8, seq: u32, sender_ts_us: u64, body: [u8; 324] }`
  - `codec::RoomCipher::new(key: [u8; 32], salt: [u8; 4])` with `encrypt(&self, frame: &PoseFrame) -> Result<[u8; 368], CodecError>` and `decrypt(&self, expected_slot: u8, wire: &[u8]) -> Result<PoseFrame, CodecError>`.
  - `codec::parse_relay_envelope(bytes: &[u8]) -> Result<(u8, &[u8; 368]), CodecError>` and `parse_livekit_slot(identity: &str) -> Result<u8, CodecError>`.
  - `stats::StreamMetrics` with `record(seq: u32, sender_ts_us: u64, recv_ts_us: u64)` and `summary(jitter_buf_ms: u64) -> StreamSummary { received, expected, loss_pct, rfc3550_jitter_ms, latency_p50_ms, latency_p95_ms, latency_p99_ms, max_raw_gap_ms, max_buffered_freeze_ms, freezes_over_100ms }`.
  - `ImpairmentConfig { loss_pct: f64, jitter_ms: f64, seed: u64 }` and `ImpairmentFilter` (deterministic PRNG for reproducible tests).
  - `MocapTransport` trait (`connect`, `send_pose`, `subscribe`, `stats`, `close`), `TransportKind`, `RoomRef`, `TransportCreds`, `SendOutcome`, `ReceivedPose`, `TransportStats`, `TransportError`.
  - `SignalingClient` (Phoenix V2 serializer over `tokio-tungstenite`, supporting text JSON push/reply and Phoenix V2 binary push/broadcast frames per Phoenix JS client binary wire format).
  - `WebSocketTransport` implementing `MocapTransport`.

- [ ] **Step 1: Wire `crates/collab-transport` into the Rust workspace**

Add `"crates/collab-transport"` to root `Cargo.toml` with exact pins (`aes-gcm = "=0.11.1"`, `str0m = "=0.26.0"`, `clap = "=4.6.10"`, `thiserror = "=2.0.21"`), and create `crates/collab-transport/Cargo.toml` with optional `livekit = { version = "=0.12.1", optional = true }` under `[features] default = [] livekit = ["dep:livekit"]`.

- [ ] **Step 2: Write unit tests for `codec.rs` and `stats.rs` first**

In `crates/collab-transport/src/codec.rs` (`#[cfg(test)]`):
- Round-trip `PoseFrame` -> 340 B -> `RoomCipher::encrypt` -> exact 368 B -> `decrypt(slot, &wire)` equals original frame.
- Tampering with any ciphertext byte returns `CodecError::DecryptFailed`.
- Decrypting with mismatched `expected_slot` fails AAD check (`CodecError::DecryptFailed`).
- `parse_relay_envelope` accepts 369 B with slot `0..=3`, rejects slot `4` or wrong length.
- `parse_livekit_slot("slot-2")` -> `Ok(2)`, rejects `"slot-4"` or `"guest"`.

In `crates/collab-transport/src/stats.rs` (`#[cfg(test)]`):
- In-order 60 Hz stream with 20 ms latency -> `loss_pct == 0.0`, `latency_p95_ms ≈ 20.0`, `max_raw_gap_ms ≈ 16.7`, `freezes_over_100ms == 0`.
- Dropped sequence numbers (`seq` 0, 1, 3, 4) -> `loss_pct == 20.0`.
- Out-of-order / late arrival after 150 ms gap -> `max_raw_gap_ms >= 150.0`, `freezes_over_100ms >= 1`.
- Simulated 40 ms jitter buffer absorbs 30 ms arrival jitter with `max_buffered_freeze_ms <= 50.0`.

- [ ] **Step 3: Implement `codec.rs`, `stats.rs`, `lib.rs`, `signaling.rs`, and `websocket.rs`**

Verify Phoenix V2 binary frame format (`[kind: u8, join_ref_len: u8, ref_len: u8, topic_len: u8, event_len: u8, ...utf8 strings..., payload]` for push `0` and broadcast `2`, matching `Phoenix.Socket.V2.JSONSerializer` in Phoenix 1.8) with a unit test in `signaling.rs`.
Note: `tokio-tungstenite` 0.30 with `native-tls` or `rustls-tls-webpki-roots` is required for `wss://` when connecting to Fly.io! Enable `rustls-tls-webpki-roots` on `tokio-tungstenite` in `crates/collab-transport/Cargo.toml` so `wss://` works on macOS and Linux with zero OpenSSL dependency.

- [ ] **Step 4: Run Rust unit tests**

Run in worktree: `direnv exec . cargo test -p collab-transport --lib`
Expected: PASS (0 failures), and `apps/desktop/src-tauri` is untouched.

- [ ] **Step 5: Commit Task 3**

```bash
git add Cargo.toml Cargo.lock crates/collab-transport
git -c core.hooksPath=/dev/null commit -m "feat(collab-transport): add sekai-pose/1 codec, stats, signaling, and WebSocket transport"
```
Verify no agent trailer with `git log -1 --format=%B`.

---

### Task 4: `Str0mTransport` (`str0m` 0.26) and `AutoUpgradeTransport`

**Files:**
- Create: `crates/collab-transport/src/str0m_transport.rs`
- Create: `crates/collab-transport/src/auto_upgrade.rs`
- Modify: `crates/collab-transport/src/lib.rs` (export `Str0mTransport`, `AutoUpgradeTransport`, `BackoffSchedule`)

**Interfaces:**
- Consumes: `MocapTransport`, `SignalingClient`, `codec::parse_relay_envelope`, `ImpairmentConfig` from Task 3; `ExWebRTCRelay` SDP/ICE signalling from Task 2.
- Produces:
  - `Str0mTransport::new(signaling: SignalingClient, impairment: Option<ImpairmentConfig>)` implementing `MocapTransport`:
    - Binds a `tokio::net::UdpSocket` (`0.0.0.0:0` or `127.0.0.1:0` when target relay is loopback).
    - Discovers local socket IP (via connecting a dummy UDP socket to the relay's resolved IP or `127.0.0.1` for loopback) and adds local host ICE candidate to `str0m::Rtc`.
    - Creates DataChannel `"pose"` via `str0m` `SdpApi::add_channel_with_config` with `ordered: false` and `Reliability::MaxRetransmits { retransmits: 0 }`.
    - Sends SDP Offer over `SignalingClient::send_signal`, applies SDP Answer + trickle ICE candidates from relay, drives `Rtc::poll_output()` / `Rtc::handle_input()` in a tokio loop until `Event::ChannelOpen(cid, "pose")`.
    - `send_pose` writes to a bounded `watch` / latest-only slot or `mpsc::channel(1)` (`try_send`): if the channel is full OR `ch.buffered_amount() > 1024`, drops the frame and returns `SendOutcome::DroppedBackpressure` (incrementing `dropped_backpressure`).
    - On `Event::ChannelData`, parses `[slot: 1 B][ciphertext: 368 B]` and emits `ReceivedPose` (applying optional `ImpairmentConfig` drop/delay before emitting when configured for Scenario B).
  - `AutoUpgradeTransport::new(ws: WebSocketTransport, primary_factory, config)` implementing `MocapTransport`:
    - `connect` connects WebSocket immediately and spawns background primary connect; active path starts as `WebSocket`.
    - Switches active path to primary when primary opens.
    - Monitors primary health: if primary disconnects OR 1000 ms elapses without any incoming UDP packet while sends are active and WebSocket is healthy, switches active path back to `WebSocket` and retries primary with backoff `[2s, 4s, 8s, 16s, 30s]` (cap 30 s).

- [ ] **Step 1: Write unit tests for `str0m_transport` backpressure & `auto_upgrade` state machine**

In `str0m_transport.rs`:
- Test that latest-only send queue drops frames and returns `SendOutcome::DroppedBackpressure` when the previous frame has not been drained.
- Test `ImpairmentFilter` with `loss_pct: 10.0, jitter_ms: 30.0` produces deterministic ~10% drops and delays in `[0, 30ms]`.

In `auto_upgrade.rs`:
- Using a mock `MocapTransport`, verify:
  1. Sends immediately go to WebSocket while primary is still connecting.
  2. Once primary opens, sends switch to primary and `stats().kind` reflects primary.
  3. After 1000 ms of simulated total loss on primary while sending, active path drops back to WebSocket.
  4. Retry schedule follows 2 s, 4 s, 8 s, 16 s, 30 s, 30 s.

- [ ] **Step 2: Implement `str0m_transport.rs` and `auto_upgrade.rs`**

Ensure clean shutdown on `close()` (send stop signal to tokio UDP loop task and await handle so no sockets leak in multi-room benchmarks).

- [ ] **Step 3: Run unit tests**

Run in worktree: `direnv exec . cargo test -p collab-transport --lib`
Expected: PASS (0 failures).

- [ ] **Step 4: Commit Task 4**

```bash
git add crates/collab-transport
git -c core.hooksPath=/dev/null commit -m "feat(collab-transport): add Str0mTransport and AutoUpgradeTransport"
```
Verify no agent trailer with `git log -1 --format=%B`.

---

### Task 5: Feature-gated `LiveKitTransport`, local LiveKit Docker Compose, and shared conformance suite

**Files:**
- Create: `crates/collab-transport/src/livekit_transport.rs`
- Modify: `crates/collab-transport/src/lib.rs` (conditionally export `LiveKitTransport` and `LiveKitMode` under `#[cfg(feature = "livekit")]`)
- Create: `apps/relay/deploy/livekit/livekit.yaml`
- Create: `apps/relay/deploy/livekit/docker-compose.yml`
- Create: `crates/collab-transport/tests/conformance.rs`

**Interfaces:**
- Consumes: `MocapTransport`, `codec::RoomCipher`, `codec::parse_livekit_slot`, `SignalingClient`, `WebSocketTransport`, `Str0mTransport`, and `apps/relay` from Tasks 1–4.
- Produces:
  - `LiveKitMode::{LossyPacket, DataTrack}` and `LiveKitTransport::new(mode: LiveKitMode, impairment: Option<ImpairmentConfig>)` (compiled only when `--features livekit`).
    - `connect` extracts `{url, token}` from `TransportCreds::LiveKit`, calls `livekit::Room::connect(&url, &token, RoomOptions::default())`.
    - In `LossyPacket` mode: sends via `local_participant().publish_data(DataPacket { payload, topic: Some("pose".into()), reliable: false, destination_identities: vec![] })` through a capacity-1 latest-only worker task (returns `SendOutcome::DroppedBackpressure` if busy); receives `RoomEvent::DataReceived { payload, participant, .. }` and maps `participant.identity()` (`"slot-N"`) to `slot: u8`.
    - In `DataTrack` mode: publishes a local data track `"pose"` and subscribes to `RoomEvent::DataTrackPublished(remote_track)` frames so the benchmark directly tests ADR 0001's head-of-line question on data tracks vs lossy packets.
  - Shared conformance test matrix (`crates/collab-transport/tests/conformance.rs`): one generic async function `run_conformance_matrix(transport_kind, relay_ws_url)` that:
    1. Creates room (`slot 0`), knocks + approves 3 guests (`slots 1, 2, 3`), verifies 4th guest approval fails with `room_full`.
    2. Connects all 4 peers via the target `MocapTransport`.
    3. Sends 60 Hz encrypted `sekai-pose/1` frames for 1 s from all 4 peers (full mesh), asserts every peer receives and decrypts frames from the other 3 slots with valid monotonic sequence numbers and zero tamper errors.
    4. Switches room to 30 Hz via `set_hz`, sends 0.5 s, verifies reception.
    5. Kicks slot `3`, waits 200 ms, verifies slot `3` stops receiving and sending poses.
    6. Cleanly closes all peers.

- [ ] **Step 1: Create `apps/relay/deploy/livekit/livekit.yaml` and `docker-compose.yml`**

In `livekit.yaml`:
- `port: 7880`
- `rtc: { tcp_port: 7881, udp_port: 7882, use_external_ip: false }`
- `turn: { enabled: false }`
- `keys: { devkey: secret }` (overridden via `LIVEKIT_KEYS` env on Fly)

In `docker-compose.yml`:
- Service `livekit` using `livekit/livekit-server:latest`, command `--dev --bind 0.0.0.0`, ports `7880:7880`, `7881:7881`, `7882:7882/udp`.

- [ ] **Step 2: Implement `crates/collab-transport/src/livekit_transport.rs`**

Verify build both WITHOUT and WITH `--features livekit`:
- Run: `direnv exec . cargo check -p collab-transport` (must NOT compile `livekit` / `libwebrtc`)
- Run: `direnv exec . cargo check -p collab-transport --features livekit` (verifies `livekit` 0.12 builds on macOS arm64; record build outcome for ADR 0001!).

- [ ] **Step 3: Write `crates/collab-transport/tests/conformance.rs`**

Include three integration tests gated on `RELAY_TEST_URL` (default `ws://127.0.0.1:4002/socket/websocket` when started by a test harness or running local server):
- `conformance_websocket`
- `conformance_ex_webrtc`
- `#[cfg(feature = "livekit")] conformance_livekit_lossy` (runs when `LIVEKIT_TEST_ENABLED=1`)

- [ ] **Step 4: Run conformance tests locally against running `apps/relay` (and local LiveKit container)**

Start `apps/relay` on port `4002` with `RELAY_UDP_BIND_IP=127.0.0.1 RELAY_ICE_PORT_MIN=41000 RELAY_ICE_PORT_MAX=41999`, run `conformance_websocket` and `conformance_ex_webrtc`. Start local LiveKit (`docker compose up -d` or VMPal container), run `conformance_livekit_lossy` with `--features livekit`.
Expected: All three conformance tests PASS!

- [ ] **Step 5: Commit Task 5**

```bash
git add apps/relay/deploy/livekit crates/collab-transport Cargo.lock
git -c core.hooksPath=/dev/null commit -m "feat(collab-transport): add feature-gated LiveKit transport and shared conformance suite"
```
Verify no agent trailer with `git log -1 --format=%B`.

---

### Task 6: `transport-bench` CLI + self-hostable `Dockerfile` + Fly.io `ams` deployment files

**Files:**
- Create: `crates/collab-transport/src/bin/transport_bench.rs`
- Create: `apps/relay/Dockerfile`
- Create: `apps/relay/.dockerignore`
- Create: `apps/relay/fly.toml`
- Create: `apps/relay/deploy/livekit/fly.toml`
- Create: `apps/relay/deploy/livekit/fly-livekit.yaml`

**Interfaces:**
- Consumes: `WebSocketTransport`, `Str0mTransport`, `AutoUpgradeTransport`, `LiveKitTransport` (feature `livekit`), `RoomCipher`, `StreamMetrics`, `ImpairmentConfig` from Tasks 3–5.
- Produces:
  - Binary `transport-bench` with CLI flags:
    - `--relay-url <ws://...|wss://...>`
    - `--transport <websocket|ex_webrtc|auto_ex_webrtc|livekit_lossy|livekit_track>`
    - `--hz <60|30>` (default `60`)
    - `--duration-secs <u64>` (default `30`)
    - `--rooms <usize>` (default `1`)
    - `--loss-pct <f64>` (default `0.0`)
    - `--jitter-ms <f64>` (default `0.0`)
    - `--jitter-buf-ms <u64>` (default `40`)
    - `--rejoin-check` (waits for relay disconnect/restart, measures host reclaim + guest rejoin + first pose resume time)
    - `--json-out <path>` (optional structured JSON report)
  - Self-hostable `apps/relay/Dockerfile`:
    - Builder stage: `hexpm/elixir` + Rust toolchain (needed for `ex_sctp` Rustler NIF), builds `MIX_ENV=prod mix release`.
    - Runtime stage: slim Debian with `libssl`, `libstdc++`, `ca-certificates`, exposes `4000/tcp` and `50000-50999/udp`, runs `/app/bin/relay start`.
  - `apps/relay/fly.toml`: `primary_region = "ams"`, `[[services]]` HTTPS/WSS 443 -> 4000 TCP + `[[services]]` UDP `start_port = 50000`, `end_port = 50999`, `RELAY_UDP_BIND_IP = "fly-global-services"`.
  - `apps/relay/deploy/livekit/fly.toml`: `primary_region = "ams"`, `livekit/livekit-server` image, HTTPS/WSS 443 -> 7880 TCP + UDP `7882` -> `7882`, `turn.enabled: false`.

- [ ] **Step 1: Implement `transport-bench` CLI**

Key benchmark measurement details:
- Every room spawns 4 peers (`slot 0..3`) sharing a single `tokio::time::Instant` origin so `recv_ts_us - sender_ts_us` measures true one-way relay transit latency without cross-machine clock skew!
- Records per-peer connect/ICE setup time (`connect_ms`), ICE success rate (`connected / attempted`), sent count, dropped-backpressure count, received count, loss %, RFC 3550 jitter, one-way p50/p95/p99 latency, raw max inter-arrival gap, simulated 40 ms jitter-buffer max freeze gap, and count of freezes > 100 ms.
- For `--rejoin-check`, prints `"READY_FOR_RESTART room=<id>"` once pose flow is steady, detects channel/transport drop, triggers host `reclaim` with backoff until relay returns, knocks & approves guest, and reports exact `reclaim_ms`, `rejoin_ms`, and `pose_resume_ms`.

- [ ] **Step 2: Smoke-test `transport-bench` locally**

Run local `apps/relay` and execute:
`direnv exec . cargo run --release -p collab-transport --bin transport-bench -- --relay-url ws://127.0.0.1:4002/socket/websocket --transport ex_webrtc --hz 60 --duration-secs 5`
Expected: 4/4 ICE connected, 0% loss, p95 < 10 ms, 0 freezes > 100 ms.

- [ ] **Step 3: Create `apps/relay/Dockerfile`, `.dockerignore`, `fly.toml`, and LiveKit Fly deploy files**

Verify `apps/relay/Dockerfile` builds cleanly (if local Docker daemon or VMPal Containers is running; otherwise note for Fly remote builder).

- [ ] **Step 4: Commit Task 6**

```bash
git add crates/collab-transport apps/relay
git -c core.hooksPath=/dev/null commit -m "feat(collab-transport): add transport-bench CLI and Fly.io ams deployment configs"
```
Verify no agent trailer with `git log -1 --format=%B`.

---

### Task 7: Deploy to Fly.io `ams`, run Scenarios A–E, write `docs/evaluation/transport-spike.md`, update `ARCHITECTURE.md` and `docs/dependencies.md`

**Files:**
- Create: `docs/evaluation/transport-spike.md`
- Modify: `ARCHITECTURE.md` (add `apps/relay` and `crates/collab-transport` to Workspace map and note spike status)
- Modify: `docs/dependencies.md` (pin `str0m`, `aes-gcm`, `clap`, optional `livekit`, and Elixir `phoenix` / `bandit` / `ex_webrtc` / `ex_sctp`)
- Optional modify: `apps/relay/fly.toml` (only if Scenario C proves Fly UDP port range fails and individual UDP ports must be tested)

**Interfaces:**
- Consumes: `apps/relay` + `transport-bench` + Fly configs from Tasks 1–6.
- Produces: Completed ADR 0001 transport spike evidence record (`docs/evaluation/transport-spike.md`) and updated architecture/dependency docs.

- [ ] **Step 1: Verify Fly authentication**

Run: `fly auth whoami`
If expired, pause and ask the user to run `fly auth login` (do not guess credentials).

- [ ] **Step 2: Provision and deploy `apps/relay` and LiveKit SFU apps on Fly.io `ams`**

- Create Fly app for relay (e.g., `opensekai-relay-spike`) in `ams`, allocate 1 dedicated IPv4 (`fly ips allocate-v4`), set secrets (`SECRET_KEY_BASE`, `RELAY_PUBLIC_IPV4`, `LIVEKIT_URL`, `LIVEKIT_HTTP_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`), deploy with `fly deploy`.
- Create Fly app for LiveKit (e.g., `opensekai-livekit-spike`) in `ams`, allocate 1 dedicated IPv4, set `LIVEKIT_KEYS` and `node_ip` to that dedicated IPv4 with `turn.enabled: false`, deploy with `fly deploy`.
- Verify both health/signalling endpoints respond over HTTPS/WSS.

- [ ] **Step 3: Execute Scenarios A–E against Fly.io `ams`**

- **Scenario C (Fly UDP port range check):** Run 1 room `ex_webrtc` 5 s test. Verify ICE connects over UDP `50000-50999` and frames flow. If UDP range drops packets, test explicit individual ports in `fly.toml`, redeploy, and record both outcomes.
- **Scenario A (4-peer full mesh, 60 Hz & 30 Hz, 30 s each):** Run `ex_webrtc`, `livekit_lossy`, `livekit_track`, and `websocket`.
- **Scenario B (synthetic 1% loss + 30 ms jitter, 30 s each):** Run `ex_webrtc`, `livekit_lossy`, `livekit_track`, and `websocket`. Compare max freeze gap (> 100 ms threshold) and check whether `livekit_track` delays subsequent frames on packet loss.
- **Scenario D (restart recovery):** Run `--rejoin-check` on `ex_webrtc`, execute `fly machine restart` on the relay Machine mid-stream, record `reclaim_ms`, `rejoin_ms`, and `pose_resume_ms`.
- **Scenario E (CPU / memory headroom):** Run 10, 25, 50, and 100 rooms (or up to Machine saturation) at 60 Hz against `ex_webrtc` and `livekit_lossy`, capturing `fly machine status` / BEAM `:erlang.memory()` + scheduler utilization / Fly metrics.

- [ ] **Step 4: Write `docs/evaluation/transport-spike.md` and update `ARCHITECTURE.md` and `docs/dependencies.md`**

Include in `docs/evaluation/transport-spike.md` (ASD-STE100 prose):
- Date, commit hash, client location/network, Fly region (`ams`), Machine VM size, Elixir/OTP/Rust/`ex_webrtc`/`str0m`/`livekit` versions.
- Complete tables for Scenarios A–E (no zero placeholders for unavailable metrics — mark `unknown` if any metric could not be collected).
- Explicit Fly UDP port-range finding.
- Explicit LiveKit `LossyPacket` vs `DataTrack` ordering finding and macOS build finding.
- Explicit ADR 0001 gate verdict (keep `ex_webrtc` + `str0m`, switch to LiveKit, or trigger WebTransport / Cloudflare Realtime Plan B).

- [ ] **Step 5: Run full verification checks and commit Task 7**

Run:
- `mix test` in `apps/relay`
- `direnv exec . cargo test -p collab-transport --lib`
- `direnv exec . cargo check --workspace` (confirms `apps/desktop` and all workspace crates still compile with default features and without pulling `livekit`)

```bash
git add docs/evaluation/transport-spike.md ARCHITECTURE.md docs/dependencies.md
git -c core.hooksPath=/dev/null commit -m "docs: record multiplayer transport spike results and update architecture map"
```
Verify no agent trailer with `git log -1 --format=%B`.
