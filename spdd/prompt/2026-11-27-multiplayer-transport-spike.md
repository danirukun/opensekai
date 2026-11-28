# REASONS: Multiplayer transport spike (ADR 0001 gate)

Date: 2026-11-27. Authority: [ADR 0001](../../docs/adr/0001-multiplayer-collab-relay-and-transport.md). Analysis: [multiplayer-transport-spike](../analysis/2026-11-27-multiplayer-transport-spike.md). Design: [multiplayer-transport-spike-design](../../docs/superpowers/specs/2026-11-27-multiplayer-transport-spike-design.md).

## R — Requirements

R1. Create `apps/relay` as an Elixir / Phoenix application with in-memory `RoomSupervisor` (`DynamicSupervisor`), `RoomRegistry` (`Registry`), and `RoomServer` enforcing a hard cap of 4 peers per room (`slot` `0` host, `1..3` guests).
R2. Implement the Phoenix Channel signalling contract (`room:<room_id>`) for `create`, `reclaim`, `knock`, `approve`, `reject`, `kick`, `signal`, `set_hz`, `stats`, and binary `pose` frames. Never open a transport session before host `approve`. Close the peer transport session immediately on `kick` or leave.
R3. Define `Relay.Transport` (`open_session/2`, `negotiate/3`, `forward/3`, `stats/1`, `close/2`) and implement:
  - `ExWebRTCRelay` (`ex_webrtc` 0.18 + `ex_sctp` 0.1.3): client offers DataChannel `"pose"` with `ordered: false, max_retransmits: 0`, relay answers with trickle ICE, `ice_ip_filter` from `RELAY_UDP_BIND_IP`, `host_to_srflx_ip_mapper` from `RELAY_PUBLIC_IPV4`, `ice_port_range` from `RELAY_ICE_PORT_MIN..RELAY_ICE_PORT_MAX`.
  - `LiveKitRelay`: pure-Elixir HS256 JWT minting (identity `"slot-<N>"`, data-only grants) and Twirp HTTP (`CreateRoom`, `RemoveParticipant`, `DeleteRoom`). TURN disabled.
  - `WebSocketFrames`: binary broadcast over the room channel.
R4. Provide one self-hostable `apps/relay/Dockerfile`, `apps/relay/fly.toml` (`ams`, dedicated IPv4, UDP `50000-50399` as one service for each port, because a Fly UDP port range received no packets), and `apps/relay/deploy/livekit/` (`fly.toml` on `ams` UDP `7882`, `livekit.yaml` with `turn.enabled: false`, and local `docker-compose.yml`).
R5. Create `crates/collab-transport` as a Rust workspace member exposing `MocapTransport`, the `sekai-pose/1` AES-256-GCM frame codec (340 B plaintext -> 368 B ciphertext, AAD `b"sekai-pose/1" || [slot]`), `WebSocketTransport`, `Str0mTransport` (`str0m` 0.26, DataChannel `"pose"`, `ordered: false, max_retransmits: 0`, latest-only backpressure drop above 16 KiB of SCTP buffered bytes), `LiveKitTransport` (`livekit` 0.12 with `rustls-tls-webpki-roots` behind optional Cargo feature `livekit`, supporting both `LossyPacket` and `DataTrack`), and `AutoUpgradeTransport` (immediate WebSocket start, upgrade on UDP open, fallback after 1000 ms total loss, exponential backoff retry).
R6. Build one shared conformance test suite that tests `connect`, 4-peer 60 Hz and 30 Hz delivery, decrypted sequence verification, `kick` stop, and `close` against `WebSocketFrames`, `ExWebRTCRelay`, and `LiveKitRelay`.
R7. Build the `transport-bench` CLI in `crates/collab-transport` to run 4-peer full-mesh benchmarks (60 Hz and 30 Hz), synthetic 1% loss / 30 ms jitter tests (measuring raw and jitter-buffered max freeze gap), Fly restart reclaim/rejoin timing, and multi-room CPU/memory scaling runs.
R8. Deploy `apps/relay` and the self-hosted LiveKit SFU to Fly.io `ams`, execute the benchmark matrix, and record all results, Fly UDP port-range findings, and the transport gate verdict in `docs/evaluation/transport-spike.md`.
R9. Update `ARCHITECTURE.md` and `docs/dependencies.md` to map `apps/relay`, `crates/collab-transport`, and new pinned dependencies.

## E — Entities

- `apps/relay`: `Relay.RoomSupervisor`, `Relay.RoomRegistry`, `Relay.RoomServer`, `Relay.RoomChannel`, `Relay.Transport`, `Relay.Transport.ExWebRTC`, `Relay.Transport.LiveKit`, `Relay.Transport.WebSocket`.
- `crates/collab-transport`: `MocapTransport`, `PoseFrame`, `RoomCipher`, `WebSocketTransport`, `Str0mTransport`, `LiveKitTransport`, `AutoUpgradeTransport`, `TransportStats`, `BenchStats`, `transport-bench` binary.
- Deploy configs: `apps/relay/Dockerfile`, `apps/relay/fly.toml`, `apps/relay/deploy/livekit/{fly.toml,livekit.yaml,docker-compose.yml}`.
- Evidence: `docs/evaluation/transport-spike.md`.

## A — Approach

Build and unit-test `crates/collab-transport` core framing/crypto and `apps/relay` room/transport layers first. Wire local integration conformance across `WebSocketFrames`, `ExWebRTCRelay`, and local Docker `LiveKitRelay`. Then deploy both apps to Fly.io `ams`, run `transport-bench` across all five scenarios, and write `docs/evaluation/transport-spike.md`.

## S — Structure

- `apps/relay/` — Elixir / Phoenix relay app, tests, Dockerfile, Fly and LiveKit deploy configs.
- `crates/collab-transport/` — Rust library (`src/{lib.rs,codec.rs,stats.rs,signaling.rs,websocket.rs,str0m_transport.rs,livekit_transport.rs,auto_upgrade.rs}`), conformance tests (`tests/`), and `src/bin/transport_bench.rs`.
- `Cargo.toml` — add `"crates/collab-transport"` to workspace members and pin new shared dependencies.
- `ARCHITECTURE.md`, `docs/dependencies.md`, `docs/evaluation/transport-spike.md`.

## O — Operations

1. Scaffold `apps/relay` (Phoenix minimal, no Ecto/assets/mailer) with `RoomServer`, `RoomChannel`, `Relay.Transport`, and `WebSocketFrames` + ExUnit tests.
2. Implement `ExWebRTCRelay` (`ex_webrtc` + `ex_sctp`) and `LiveKitRelay` (JWT + Twirp) + ExUnit tests.
3. Scaffold `crates/collab-transport` with `sekai-pose/1` codec, AES-256-GCM cipher, jitter/loss stats, `MocapTransport`, `WebSocketTransport`, `Str0mTransport`, `AutoUpgradeTransport`, and unit tests.
4. Add feature-gated `LiveKitTransport` (`LossyPacket` + `DataTrack`) and local LiveKit Docker Compose config.
5. Run shared conformance suite locally across all three transports.
6. Add `transport-bench` CLI, `apps/relay/Dockerfile`, `apps/relay/fly.toml`, and `apps/relay/deploy/livekit/fly.toml`.
7. Deploy to Fly.io `ams` (after user authenticates `flyctl`), run scenarios A–E, and record results in `docs/evaluation/transport-spike.md`.
8. Update `ARCHITECTURE.md` and `docs/dependencies.md`.

## N — Norms

- Keep `apps/desktop` unchanged in this slice.
- Use `direnv exec . cargo ...` for all Rust commands (shared Cargo target directory).
- Pin exact Rust crate versions in `Cargo.toml` and record them in `docs/dependencies.md`.
- Write long prose in ASD-STE100 Simplified Technical English.
- Do not add agent attribution trailers to commits.

## S — Safeguards

- Never expose peer IP addresses in signalling or transport metadata.
- Never decrypt pose ciphertext on the relay.
- Never enable TURN or connect to LiveKit Cloud.
- Never open a peer transport session before explicit host `approve`.
- Never pull `livekit` / `libwebrtc` into default workspace builds (keep behind Cargo feature `livekit`).
- Never report unavailable benchmark numbers as zero; record `unknown` with the reason.
