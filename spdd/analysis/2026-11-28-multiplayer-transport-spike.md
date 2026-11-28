# Analysis: Multiplayer transport spike

Date: 2026-11-28. Scope: issue [#365](https://github.com/danirukun/opensekai/issues/365). Epic: [#364](https://github.com/danirukun/opensekai/issues/364). Contract: [transport spike](../prompt/2026-11-28-multiplayer-transport-spike.md). Source of truth: [ADR 0001](../../docs/adr/0001-multiplayer-collab-relay-and-transport.md). This spike gates [#366](https://github.com/danirukun/opensekai/issues/366) and [#367](https://github.com/danirukun/opensekai/issues/367). It does not implement those lanes.

## Request

Issue #365 asks for a measurement of the ADR 0001 pose path before any guest-room or editor-collab slice. The primary path is an Elixir relay with `ex_webrtc` DataChannels and a Rust `str0m` client. A self-hosted LiveKit server is a comparison, not the chosen server. The relay must refuse a join credential until the host approves. Pose bytes stay opaque to the relay. A lost pose must not hold the next pose. WebTransport and Cloudflare Realtime stay out unless the ADR trigger is met. Fly `ams`, macOS, and Windows numbers are part of the issue. This environment cannot produce those numbers.

## Sources

| Source | What it gives | Status |
| --- | --- | --- |
| ADR 0001 | Server order, adapter, approval, encryption, spike steps, Fly UDP risk | Read on 2026-11-28 |
| Issue #365 | The four steps, the outcome, and the gate on Lane A1 | Read on 2026-11-28 |
| `ARCHITECTURE.md` | The Rust host owns sockets. No relay process exists. The session is the scene authority | Read |
| `apps/desktop/src-tauri` | Tauri host. No collab module. Default build has no WebRTC stack | Read |
| `ex_webrtc` 0.18.0 docs | `PeerConnection`, in-band DataChannels, `ordered: :unordered`, `max_retransmits: 0`, `ice_port_range` | Read on 2026-11-28 |
| `str0m` 0.25.0 docs | Sans-IO `Rtc`, `add_channel_with_config`, `Reliability::MaxRetransmits` | Read on 2026-11-28 |
| LiveKit server and data-packet docs | Go SFU, lossy packets sent once with no order guarantee, Apache-2.0, self-host | Read on 2026-11-24 |

## Current state

- No `apps/relay`. No Phoenix application. No Fly config.
- The host has no transport adapter, no pose cipher, and no collab socket.
- ADR 0001 status is still **Proposed**. The transport choice waits on this spike.
- Lane A1 and Lane B1 are not started.

## Decisions

### Owner (ADR 0001, unchanged)

| # | Decided | Rejected alternative |
| --- | --- | --- |
| D1 | `ex_webrtc` stays the primary until this spike shows better numbers | Switch to LiveKit or Cloudflare before the measurement |
| D2 | One host approval before any join credential. The relay does not see pose plaintext | A token at knock time, or a relay that parses poses |
| D3 | Pose DataChannel is unordered and does not retransmit. A gap does not hold the next pose | An ordered reliable channel |
| D4 | No TURN. No LiveKit Cloud. WebTransport and Cloudflare Realtime only on the ADR triggers | Build those paths in the first spike |
| D5 | Fly region `ams`, dedicated IPv4, UDP port range, then individual ports if the range is not routed | Skip the Fly check |

### Integrator (2026-11-28, this contract)

| # | Decided | Rejected alternative |
| --- | --- | --- |
| D6 | The spike client lives in `crates/transport-spike`. The Tauri host re-exports it behind the cargo feature `transport-spike`. The default desktop build does not link it and does not open a relay socket | Put the client on the session worker or the production output path |
| D7 | The measurement process holds the room key. The relay API has no key field. Pose bytes on the DataChannel are AES-256-GCM ciphertext | Let the relay mint the pose key and return it in the approve body |
| D8 | Signaling for the harness is HTTP on the Phoenix endpoint. A room is one `RoomServer`. LiveKit, when configured, returns a token only after approval | A second relay process for the spike |
| D9 | Local loopback may record numbers. Fly, home-network, macOS, and Windows cells stay empty when this run cannot measure them. An empty cell is unknown. It is not zero | Fill those cells from a loopback run |
| D10 | The LiveKit Rust client is a second adapter behind the same report shape. This run links it only when the crate builds. A missing server or a missing link stays a blocker, not a failed comparison | Treat a missing LiveKit binary as a loss against `ex_webrtc` |

## Risks

- **Fly UDP port range.** The ADR cites a report that a range can be declared and still receive no packets. This contract does not claim the range works.
- **Clock.** Loopback latency uses one machine clock. It is not the ADR p95 target.
- **`str0m` and `ex_webrtc` interop.** ICE and DTLS can fail on the first cut. A failed ICE result is a measurement. It does not authorize the WebTransport sidecar. That sidecar waits on the ADR trigger (ICE fails where UDP 443 works, or the Fly range is not routed).
- **LiveKit crate weight.** The official Rust SDK may not link in this Linux spike build. The adapter still exists in source.
- **Elixir on the image.** `ex_sctp` compiles Rust into the relay. The Fly image needs a Rust toolchain. This run does not deploy that image.
