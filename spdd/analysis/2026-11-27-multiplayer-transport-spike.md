# Multiplayer transport spike analysis (ADR 0001 gate)

Date: 2026-11-27. Authority: [ADR 0001](../../docs/adr/0001-multiplayer-collab-relay-and-transport.md). Design: [multiplayer transport spike design](../../docs/superpowers/specs/2026-11-27-multiplayer-transport-spike-design.md).

## Original business requirement

OpenSekai needs low-latency, smooth multiplayer motion relay for 1 host plus up to 3 guests (60 Hz default, 30 Hz switchable, p95 added latency <= 150 ms same continent, no visible freeze > 100 ms at 1% loss and 30 ms jitter, no IP leaks, no TURN). ADR 0001 selects an Elixir/Phoenix relay (`apps/relay`) with `ex_webrtc` + Rust `str0m` as primary and asks the spike to also explore a self-hosted LiveKit SFU (`livekit` Rust crate) behind the same adapter before committing to Lane A1.

## Domain concept identification

### Existing concepts (from codebase)

- **Rust workspace (`Cargo.toml`)**: owns host sockets and shared Rust crates (`crates/contracts`, `crates/evaluation`).
- **Evaluation records (`docs/evaluation/`)**: store benchmark outputs, environment metadata, and feasibility verdicts.
- **Adapter pattern (constitution)**: isolate platform and vendor transports behind a small interface with shared conformance tests.

### New concepts required

- **Relay application (`apps/relay`)**: Elixir / Phoenix app running in-memory `RoomServer` processes (`DynamicSupervisor` + `Registry`), Phoenix Channels for signalling, and a `Relay.Transport` behaviour.
- **Transport crate (`crates/collab-transport`)**: Rust crate defining `MocapTransport`, `sekai-pose/1` AES-256-GCM test frames, `WebSocketTransport`, `Str0mTransport`, feature-gated `LiveKitTransport`, `AutoUpgradeTransport`, conformance suite, and `transport-bench` CLI.
- **Room slot**: integer `0..=3` (`0` host, `1..=3` guests) assigned only after explicit host approval.
- **Spike benchmark harness (`transport-bench`)**: spawns 4 simulated peers (full mesh), injects optional synthetic loss/jitter, and computes RTT, one-way latency p50/p95/p99, loss %, RFC 3550 jitter, and max freeze gap.

### Key business rules

- Maximum 4 peers per room (1 host + 3 guests).
- Every guest join requires one explicit host approval before any transport session opens.
- Kick terminates the peer's transport session and stops forwarding immediately.
- Poses are AES-256-GCM encrypted end-to-end (`sekai-pose/1`, 368 B ciphertext); the relay forwards ciphertext only and never holds the room key.
- Self-hostable from day 1: one Docker image for `apps/relay` runs on Fly.io and on a user host via env vars.
- TURN stays disabled; LiveKit Cloud is not used.

## Strategic approach

### Solution direction

Build the real `apps/relay` skeleton and `crates/collab-transport` crate up front rather than a throwaway script. Keep `LiveKitTransport` behind a Cargo feature flag (`livekit`, disabled by default) so desktop builds stay pure Rust unless LiveKit wins the gate. Deploy `apps/relay` and a separate self-hosted LiveKit SFU app to Fly.io `ams` so BEAM and Go SFU CPU/RAM stay isolated during load testing.

### Key design decisions

- **Separate Fly apps for `apps/relay` and LiveKit**: keeps `apps/relay` pure Elixir and avoids mixed CPU measurements.
- **Cargo feature `livekit` off by default**: avoids pulling C++ `libwebrtc` prebuilts into `apps/desktop`.
- **Single-byte slot prefix on relay fan-out (`ExWebRTCRelay`, `WebSocketFrames`)**: preserves opaque E2EE ciphertext while identifying the sender slot cleanly; LiveKit uses participant identity `"slot-<N>"`.
- **Immediate WebSocket start + UDP auto-upgrade**: matches ADR 0001 so the 5-minute join flow never blocks on ICE.

### Alternatives considered

- **Throwaway probe in `tools/transport-spike/`**: rejected by owner; starting in `apps/relay` + `crates/collab-transport` avoids rewriting the room and adapter scaffolding for Lane A1.
- **Single Fly Machine running Elixir + LiveKit side by side**: rejected by owner; pollutes the relay Docker image and mixes CPU numbers.

## Risk and gap analysis

### Technical risks

- **Fly.io UDP port range routing**: Sep 2026 Fly community report noted range-declared UDP services not receiving packets. Mitigation: test `50000-50999` first, fall back to explicit individual ports in `fly.toml` if needed, and record both.
- **Elixir 1.20.5 / OTP 29 + `ex_sctp` NIF compilation**: `ex_sctp` compiles a Rustler NIF (`sctp_proto`). Mitigation: pin compatible OTP/Elixir/Rust versions in `apps/relay/Dockerfile` and verify local + container builds.
- **`livekit` Rust crate build on macOS (arm64)**: downloads `libwebrtc` binary during build. Mitigation: keep behind Cargo feature `livekit` and verify build early.
- **Clock skew on one-way latency**: client machines can measure true one-way latency when all 4 `transport-bench` peers share one monotonic clock in the same process; network RTT is also measured independently via echo / SCTP / channel pings.

### Acceptance criteria coverage

| Gate question (ADR 0001) | Addressable? | Method |
| --- | --- | --- |
| Fly `ams` UDP port-range routing works | Yes | Live Fly deploy + `transport-bench` |
| `ex_webrtc` + `str0m` meets p95 <= 150 ms & <= 100 ms freeze | Yes | 4-peer 60 Hz / 30 Hz + 1% loss / 30 ms jitter run |
| BEAM CPU/RAM headroom toward 100 rooms | Yes | Multi-room ramp on Fly `ams` |
| Restart reclaim + guest rejoin | Yes | `fly machine restart` during active room |
| LiveKit lossy packet vs data track ordering | Yes | Synthetic loss run comparing both APIs |
| Shared adapter conformance across all transports | Yes | Shared integration test matrix |

## Next step

REASONS contract: [multiplayer-transport-spike](../prompt/2026-11-27-multiplayer-transport-spike.md).
