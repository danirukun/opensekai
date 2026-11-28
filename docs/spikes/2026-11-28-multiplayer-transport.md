# Transport spike runbook

Date: 2026-11-28. Issue: [#365](https://github.com/danirukun/opensekai/issues/365). Contract: [transport spike](../../spdd/prompt/2026-11-28-multiplayer-transport-spike.md). ADR 0001 stays **Proposed**. This run does not accept it. The numbers below are loopback on this Linux host. They are not the Fly or desktop result.

## What you run

The relay needs Elixir 1.17 and Erlang/OTP 27. The `str0m` client uses the `openssl` feature. The LiveKit client is `cargo run -p opensekai-transport-spike --features livekit`. That feature is not on the default desktop build.

```bash
export PATH="/opt/otp-27/bin:/opt/elixir/bin:$PATH"
# For the LiveKit pass, also:
# livekit-server --dev
# LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret LIVEKIT_URL=ws://127.0.0.1:7880
bash scripts/transport-spike.sh
```

`tc qdisc` is present and returns `Operation not permitted` on this host. Netem was not applied.

## Why the handshake works

Two changes, both in this spike:

1. `str0m` 0.25.0 with its default `dimpl` backend does not finish DTLS against `ex_dtls` 0.18.0. As the DTLS server it returns `no client certificate received`. The spike crate builds `str0m` with the `openssl` feature. That handshake finishes.
2. `ex_webrtc` 0.18.0 starts SCTP only when it sent the SDP offer. `str0m` starts SCTP only when it is the DTLS client. The posted offer rewrites `a=setup:actpass` to `a=setup:active`, so `str0m` sends the SCTP INIT. The relay depends on `ex_sctp` 0.1.3. Without that dependency, `ex_webrtc` compiles the data channel out.

## Loopback result, 4 participants, 2 seconds

| Field | ex_webrtc 60 Hz | ex_webrtc 30 Hz | LiveKit 60 Hz | LiveKit 30 Hz |
| --- | --- | --- | --- | --- |
| iceSuccess | true | true | true | true |
| setupMs | 26 | 29 | 215 | 160 |
| lossPct | 0.81 | 0.42 | 0 | 0 |
| jitterMs | 10.83 | 10.71 | 0.66 | 0.59 |
| p95Ms | 24.5 | 28.1 | 2.58 | 2.81 |
| lostPacketHeldNext | false | false | false | false |

The relay BEAM used about 19% of one core at 60 Hz and about 14% at 30 Hz during the `ex_webrtc` pass. The client process CPU in that same run also includes the LiveKit pass, so it is not an `ex_webrtc`-only figure. CPU per 100 rooms was not measured.

LiveKit server was `livekit-server` 1.13.11 `--dev` on `127.0.0.1:7880`, key `devkey`. No TURN. The token comes from the relay after host approval.

## Not measured

| Item | Result |
| --- | --- |
| Netem | `tc` is installed. `RTNETLINK answers: Operation not permitted`. |
| Fly `ams` | null. No Fly credentials. No dedicated IPv4. No deploy. |
| macOS and Windows | null. This host is Linux. |
| EU, NA, and JP paths | null. |
| CPU per 100 rooms | null. |

The primary stays `ex_webrtc` until a Fly run and the desktop runs exist. Loopback alone does not accept the ADR.

## Still blocked

1. Fly access for `opensekai-relay` in `ams`, plus a dedicated IPv4, to test UDP 50000–50099.
2. A Mac and a Windows machine for the client runs.
