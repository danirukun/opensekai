# Transport spike runbook

Date: 2026-11-28. Issue: [#365](https://github.com/danirukun/opensekai/issues/365). Contract: [transport spike](../../spdd/prompt/2026-11-28-multiplayer-transport-spike.md). ADR 0001 stays **Proposed**. This run does not accept it.

## What you run

The relay needs Elixir 1.17 and Erlang/OTP 27. OTP 25 cannot compile `ranch` 2.4. The host feature is not in the default desktop build.

```bash
export PATH="/opt/otp-27/bin:/opt/elixir/bin:$PATH"
bash scripts/transport-spike.sh
```

The script runs `mix test`, starts the relay on `127.0.0.1:4000` with `RELAY_LOOPBACK=1`, runs the Rust unit tests, then runs the bin at 60 Hz and at 30 Hz.

Fly is not part of this script. A deploy needs a Fly account, `fly ips allocate-v4 --region ams`, and a check that UDP ports 50000–50099 receive packets. If the range is dark, list one port per line in `apps/relay/fly.toml`.

## Loopback result

Place: this Linux host. Adapter: `ex_webrtc` + `str0m` 0.25.0. Participants did not reach an open DataChannel.

The offer and the answer were exchanged. DTLS then failed:

`DTLS error: certificate error: no client certificate received`

| Field | 60 Hz | 30 Hz |
| --- | --- | --- |
| iceSuccess | false | false |
| setupMs | null | null |
| lossPct | null | null |
| jitterMs | null | null |
| p95Ms | null | null |
| lostPacketHeldNext | null | null |
| clientCpuPct | 10.9 | not a pose load |
| relayErlangRuntimePct | 97.5 | not a pose load |

The CPU samples are from the failed handshake. They are not the CPU of a room at 60 Hz. Null means this run did not measure that field. It is not zero.

Unit tests that did pass:

- Relay: 9 tests, 0 failures. Approval, opaque fan-out, LiveKit token shape, Fly file.
- Rust: 5 tests, 0 failures. Cipher, unordered playout, empty metrics stay null, pose channel `ordered: false` and max retransmits 0.

## Not measured

| Item | Result |
| --- | --- |
| Fly `ams` | null. No Fly credentials in this run. No dedicated IPv4. No deploy. |
| macOS `str0m` and `livekit` | null. This host is Linux. |
| Windows `str0m` and `livekit` | null. This host is Linux. |
| EU, NA, and JP home paths | null. |
| CPU per 100 rooms | null. |
| LiveKit lossy packets | null. The crate is not linked. |
| WebTransport sidecar | not built. The ADR trigger was not met. |
| Cloudflare Realtime | not built. Fly UDP did not fail, because Fly was not deployed. |

## Blockers that need a decision or a machine

1. DTLS between `str0m` 0.25.0 and `ex_webrtc` 0.18.0 fails on loopback with `no client certificate received`. Pose loss, jitter, and p95 stay unknown until that handshake succeeds.
2. `livekit` 0.12.1 needs `zip` ^9.0.4 and `libwebrtc`. The workspace pins `zip` 9.0.3. This run did not link the crate and did not start a LiveKit server.
3. Fly `ams`: an account that can create the app `opensekai-relay`, allocate a dedicated IPv4, and confirm the UDP range. The range risk in the ADR is still open.
4. A Mac and a Windows machine to run the `livekit` crate, after the crate links.

## What this run did build

- `apps/relay`: one `RoomServer` per room, host approval before a participant secret, opaque fan-out, `ex_webrtc` answer path, LiveKit token only after approval, no TURN, no LiveKit Cloud host.
- `crates/transport-spike`: the `str0m` client and the measurement bin. The desktop feature `transport-spike` re-exports it. The default app does not link it.
- `apps/relay/fly.toml`: region `ams`, UDP 50000–50099.
