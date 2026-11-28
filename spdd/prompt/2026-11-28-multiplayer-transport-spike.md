# REASONS: Multiplayer transport spike

Date: 2026-11-28. Scope: issue [#365](https://github.com/danirukun/opensekai/issues/365). Analysis: [transport spike](../analysis/2026-11-28-multiplayer-transport-spike.md). Source of truth: [ADR 0001](../../docs/adr/0001-multiplayer-collab-relay-and-transport.md). Depends on: none. Does not start #366 or #367. Changes: new `apps/relay` process, new host feature `transport-spike`, Fly config, spike runbook. No scene schema change. No production output path change.

The owner decisions D1 to D5 are the ADR. The integrator sets D6 to D10 in the analysis. This contract does not change them.

## Decisions

| # | Decided | Rejected alternative |
| --- | --- | --- |
| D1 | `ex_webrtc` stays the primary until measured numbers are better | Choose LiveKit or Cloudflare first |
| D2 | A join credential exists only after host approval. The relay stores no pose key | Mint a credential at knock time |
| D3 | The pose channel is unordered with `max_retransmits` 0. A missing sequence does not hold a later sequence | Ordered reliable delivery |
| D4 | No TURN, no LiveKit Cloud, no WebTransport sidecar, no Cloudflare adapter in this slice | Build those paths now |
| D5 | Fly `ams` uses a UDP port range. A later deploy may list ports one by one if the range is dark | Omit the Fly config |
| D6 | Spike code is the host feature `transport-spike`. The default app binary does not include it | Always link WebRTC into the editor |
| D7 | The harness holds the AES-256-GCM key. The approve response has no key | Return the key from the relay |
| D8 | HTTP on the Phoenix endpoint is the harness signal path. One `RoomServer` per room | A second non-Phoenix process for signaling |
| D9 | Unknown measurements stay null. Loopback numbers are labeled loopback | Copy loopback into the Fly or desktop cells |
| D10 | LiveKit uses the same report shape. A missing link or a missing server is a blocker | Score LiveKit as a failed ICE run |

## Constants

| Name | Value | Use |
| --- | --- | --- |
| `POSE_LABEL` | `pose` | DataChannel label |
| `ROOM_CAP` | 4 | 1 host + 3 guests |
| `HZ` | 60 and 30 | Two local runs |
| `ICE_PORT_RANGE` | 50000–50099 | Local and the Fly range in `fly.toml` |
| `CIPHER` | AES-256-GCM, 12-byte nonce, 16-byte tag | Pose body on the wire |
| `REGION` | `ams` | Fly primary region |

## R — Requirements

### Room and approval

R1. `create` opens one room and returns a host secret and a host participant secret. The host is approved.
R2. `knock` adds a guest with status `pending`. The response has no participant secret and no LiveKit token.
R3. `approve` with the host secret moves that guest to `approved` and returns a participant secret. A wrong host secret does not.
R4. `signal` with a missing or pending secret returns `not_approved` and does not start a PeerConnection.
R5. A room has at most 4 participants.

### Opaque fan-out

R6. `fanout(participants, from_id, bytes)` returns the same bytes for every other approved participant. It drops the sender and every pending participant.
R7. The room state has no pose-key field. The approve JSON has no pose-key field.

### Pose channel

R8. The client offers a DataChannel `pose` with `ordered: false` and max retransmits 0.
R9. The relay answers that offer. It forwards DataChannel bytes with R6. It does not decrypt them.
R10. `deliver_unordered(seq)` returns that sequence at once. A call with sequence 3 after sequence 1, with 2 absent, returns 3. It does not wait.

### Cipher and metrics

R11. `seal` / `open` round-trip one frame. The ciphertext differs from the plaintext. The nonce includes the sender id and the sequence.
R12. `summarize` reports loss, RFC 3550 jitter, and p95 from samples. An empty sample list yields null for those three fields, not zero.
R13. The harness report labels a loopback run `loopback`. Fields that this run did not measure are null.

### LiveKit adapter

R14. A LiveKit token is minted only for an approved participant. The token payload has no TURN URL. The URL comes from `LIVEKIT_URL`. Unset configuration returns `livekit_unconfigured` and does not invent a cloud host.
R15. The Rust LiveKit sender uses lossy packets (`reliable: false`) when that crate is linked. The report uses the same fields as the `ex_webrtc` run.

### Fly and triggers

R16. `apps/relay/fly.toml` sets primary region `ams` and UDP ports 50000–50099. The runbook states that a dark range falls back to one port per line, and that this run does not deploy.
R17. This slice does not add a WebTransport sidecar and does not add a Cloudflare Realtime adapter.

## E — Entities

- `apps/relay`: Phoenix endpoint, `Relay.RoomServer`, `Relay.Fanout`, `Relay.LiveKitToken`, `Relay.Transport.ExWebRTC`, Fly config, Dockerfile.
- `apps/desktop/src-tauri/src/collab/`: pose cipher, playout, metrics, `str0m` client, LiveKit adapter, measurement bin.
- `scripts/transport-spike.sh`: start the relay on loopback and run the bin.
- `docs/spikes/2026-11-28-multiplayer-transport.md`: runbook and the result table.
- `ARCHITECTURE.md`: the new process and the feature gate.

## A — Approach

Write this contract first. Then the relay and the host feature. Unit tests cover R1–R8, R10–R12, and R14 without a network. The measurement bin runs the loopback session when the relay is up. It writes JSON. The runbook copies that JSON and leaves Fly, macOS, and Windows null. Do not mark ADR 0001 Accepted in this slice. Acceptance waits on the Fly and desktop numbers the issue names.

## S — Structure

| Area | Create | Modify |
| --- | --- | --- |
| Contract | `spdd/analysis/2026-11-28-multiplayer-transport-spike.md`, this file | — |
| Relay | `apps/relay/**` | `.gitignore` |
| Host spike | `apps/desktop/src-tauri/src/collab/**`, `src/bin/transport-spike.rs` | `Cargo.toml`, `src/lib.rs` |
| Run | `scripts/transport-spike.sh`, `docs/spikes/2026-11-28-multiplayer-transport.md` | `ARCHITECTURE.md` |

## O — Operations

1. Land the analysis and this contract.
2. Land the relay, the host feature, the Fly file, and the runbook.
3. Run `mix test` in `apps/relay`.
4. Run `cargo test -p opensekai-desktop --features transport-spike --lib collab`.
5. Run `scripts/transport-spike.sh` on loopback. Record the JSON. Leave every cell this host cannot measure as null.

## N — Norms

- Unit tests for the pure functions in R6, R10, R11, and R12, and for the approval HTTP path in R2–R4.
- No test for static copy.
- The spike bin is not a Tauri window and does not touch the scene.
- Long prose is Simplified Technical English.
- An unknown measurement is null. It is never zero.

## S — Safeguards

- Do not start Lane A1 or Lane B1.
- Do not put the spike client on the production frame path or the OBS path.
- Do not give a pending guest a participant secret, a PeerConnection, or a LiveKit token (R2, R4, R14).
- Do not store or return a pose key from the relay (R7).
- Do not build WebTransport or Cloudflare Realtime in this slice (R17).
- Do not set TURN on, and do not point the harness at LiveKit Cloud (R14).
- Do not write a loopback latency into the Fly, macOS, or Windows cells (D9).
- Do not change ADR 0001 status to Accepted in this slice.
