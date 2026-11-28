# Multiplayer transport spike (ADR 0001)

Date of the runs: 2026-11-27 23:44 to 2026-11-28 00:19 UTC. Scope: the transport spike of [ADR 0001](../adr/0001-multiplayer-collab-relay-and-transport.md). Design: [Multiplayer transport spike](../superpowers/specs/2026-11-27-multiplayer-transport-spike-design.md). Contract: [SPDD prompt](../../spdd/prompt/2026-11-27-multiplayer-transport-spike.md). Code: the relay image is `apps/relay` at `00e9ef69` (unchanged in `b85bcb4b`). The relay Machine config and the `transport-bench` binary match `b85bcb4b`, which has the three fixes in "Fixes from this run". Scenario C rows marked "1024 B" and the first LiveKit attempt used `00e9ef69`. Tool: `transport-bench` (`crates/collab-transport/src/bin/transport_bench.rs`), release build with `--features livekit`.

This record gives measured facts. It does not change ADR 0001. The owner decides the transport choice.

## Gate verdict

- **Fly UDP.** A UDP service with a port range did not receive packets. One `[[services]]` entry for each port works. Fly UDP works for the relay, so the spike does not trigger Plan B (Cloudflare Realtime). ICE did not fail where UDP 443 works, and the individual-port fallback of the ADR routes, so the spike does not trigger the WebTransport sidecar.
- **Primary transport.** ADR 0001 keeps `ex_webrtc` unless LiveKit shows better ICE success, loss, jitter, and p95 latency. LiveKit `LossyPacket` had lower loss (0.1 to 0.3% against 1.6 to 2.6%). ICE success was the same (100%). p95 latency was the same within 2 ms. Jitter was higher for LiveKit at 60 Hz (8.9 ms against 5.8 ms). Thus the rule keeps **`ex_webrtc` + `str0m` as the primary**.
- **Not in the gate rule.** Two results go against `ex_webrtc`:
  - With the final 16 KiB drop bound, `str0m` senders stopped for 0.9 to 2.0 s in 2 of 9 `ex_webrtc` runs below saturation: one sender in Scenario B run 1 (2.0 s), and four senders in the 10-room step of Scenario E (0.9 to 1.1 s, at 79% relay CPU). Each time, the buffered amount of the SCTP association stayed above the bound, and that peer sent no poses. A check with a 4380 B bound had one more stop (1.1 s). No LiveKit run with one room for each client process had a gap above 230 ms.
  - The relay used 21.7% of its 2 shared vCPUs for one room of 4 peers at 60 Hz. The LiveKit SFU used 4.0% for the same room. The relay saturated between 10 and 25 rooms.
- **Recommendation.** Keep `ex_webrtc` + `str0m` as the primary for slice A1 only together with two follow-ups: find and fix the SCTP send stall, and reduce the relay CPU for each room. If A1 cannot fix both, write a new ADR that makes LiveKit `LossyPacket` the primary. The adapter boundary already supports that change.
- **LiveKit `LossyPacket` against `DataTrack`.** No `DataTrack` run showed a stall after a gap. `DataTrack` lost more frames at 60 Hz (1.5 to 2.4% against 0.2 to 1.1%), and its setup was about 150 ms slower. Use `LossyPacket` if LiveKit becomes the primary. The synthetic loss of Scenario B is applied at the receiver after the transport. Thus Scenario B does not test head-of-line wait on network loss. Only the real Wi-Fi loss of the runs tests it.

## Setup

- **Client.** MacBook Pro (Apple M3 Pro, 12 cores), macOS 27.2.1 (26B131), arm64. Home connection in Vienna, Austria (T-Mobile Austria), on Wi-Fi. Apple `networkQuality`: 492 Mbit/s down, 66 Mbit/s up, base RTT 64 ms. All 4 peers of a room run in one `transport-bench` process, so one-way latency is sender to relay to receiver on one clock.
- **Client path.** ICMP RTT to the relay IPv4 was 23 to 28 ms, with one 45 to 113 ms sample about every 0.5 s (`ping -i 0.1`, 50 samples: 27 27 27 99 27 26 27 24 113 …). The AWDL interface was active. This periodic Wi-Fi stall is in every transport, WebSocket included. It sets p95 near 115 ms and the max raw gap near 110 to 130 ms for all transports. The 100 ms freeze target cannot be checked from this client.
- **Relay.** Fly app `opensekai-relay-spike`, region `ams`, one Machine `shared-cpu-2x`, 1 GB, Firecracker. Dedicated IPv4 `66.51.127.176`. `RELAY_UDP_BIND_IP=fly-global-services` (`172.19.4.91` in the Machine). Elixir 1.18.6, OTP 27 (image `hexpm/elixir:1.18.6-erlang-27.3.4.20-debian-bookworm-20261123-slim`), `ex_webrtc` 0.18.0, `ex_ice` 0.16.1, `ex_dtls` 0.18.2, `ex_sctp` 0.1.3, Phoenix 1.8.17, Bandit 1.15.0, Jason 1.4.5. Release build, `MIX_ENV=prod`.
- **LiveKit.** Fly app `opensekai-livekit-spike`, region `ams`, one Machine `shared-cpu-2x`, 1 GB. Dedicated IPv4 `168.220.88.192` as `NODE_IP`. `livekit-server` 1.13.11 (image `livekit/livekit-server:latest`), one UDP port `7882`, TURN off, ICE over TCP not published.
- **Client libraries.** Rust 1.93.1, `str0m` 0.26.0, `livekit` 0.12.1 (`webrtc-sys` 0.3.55), `tokio-tungstenite` 0.30.0 with `rustls`.
- **Load.** One room has 4 peers in a full mesh: each peer sends one stream and receives 3, so a room has 12 streams. A pose frame is 368 B of ciphertext. 60 Hz unless the table says 30 Hz. The jitter buffer for the freeze numbers is 40 ms.
- **Metrics.** "Setup" is the connect time of the transport after approval (p50 / max of the 4 peers). WebSocket uses the signalling socket, so its setup is n/a. "Loss" counts missing sequence numbers between the first and the last received frame of each stream. "Jitter" is RFC 3550 interarrival jitter. "Freeze" is the longest gap after the simulated 40 ms jitter buffer. "Freezes" is the number of buffered gaps above 100 ms in all streams.

## Fixes from this run

The first deploy found three defects. Each fix is in this change.

| Defect | Evidence | Fix |
| --- | --- | --- |
| A Fly UDP port range does not route | Scenario C below | `apps/relay/fly.toml`: 400 `[[services]]` entries, UDP `50000` to `50399`, internal port = external port. `RELAY_ICE_PORT_MAX=50399`. Fly accepted 400 services on one Machine. |
| `livekit` 0.12.1 has no TLS without a feature | All 4 peers: `URL error: TLS support not compiled in` on `wss://opensekai-livekit-spike.fly.dev` | `crates/collab-transport/Cargo.toml`: `livekit` with `rustls-tls-webpki-roots`. The local tests used `ws://`, so they did not show this. |
| The `str0m` drop bound of 1024 B drops frames on a WAN | 1 room, 5 s: 509 of 1204 frames dropped (42%), loss 43% | `MAX_BUFFERED_BYTES` 16 KiB. The `str0m` buffered amount also counts in-flight bytes until a SACK, so at 25 ms RTT and 60 Hz it is above 1024 B most of the time. A bound of 4380 B (one initial SCTP congestion window) still had one 1.1 s drop run in 10 s. At 64 KiB, 2 runs of 10 s had 0 drops. |

## Scenario C: Fly UDP port range

| Configuration | Check | Result |
| --- | --- | --- |
| One UDP service, `start_port = 50000`, `end_port = 50999`, `internal_port = 50000` | `ex_webrtc`, 1 room, 5 s | 0/4 connected: `pose DataChannel did not open` |
| Same | Raw UDP from the client to `66.51.127.176:50998`, `gen_udp` socket on `172.19.4.91:50998` | No packet in 20 s (4 sends) |
| Same | Raw UDP to ports `50000` and `50998`, socket on `172.19.4.91:50000` | No packet in 20 s |
| 64 UDP services, `50000` to `50063`, one for each port | `ex_webrtc`, 1 room, 5 s (drop bound 1024 B) | 4/4 connected, setup p50 510 ms, frames flow (loss from the drop bound, see "Fixes") |
| 400 UDP services, `50000` to `50399` | Raw UDP to `50399`, socket on `172.19.4.91:50399`, reply | Packet received; reply came back from `66.51.127.176:50399` |
| Same | `ex_webrtc`, 1 room, 5 s, 2 runs | 4/4 both runs, setup p50 513 / 478 ms, loss 2.33% / 2.33%, p50 37.4 / 38.2 ms, p95 126.6 / 128.5 ms, freeze max 84 / 84 ms, 0 freezes |
| LiveKit, one UDP service `7882` | `livekit_lossy`, 1 room, 5 s | 4/4 at the first deploy |

Verdict: on 2026-11-28 a Fly UDP port-range service did not deliver packets in `ams`. This agrees with the community report of Sep 2026 in ADR 0001. Single-port UDP services work in both directions, and the reply source is the dedicated IPv4. `flyctl` 0.5.19 `fly services list` also panics (nil pointer) on the app with the range service.

## Scenario A: 4-peer full mesh, 30 s, no added impairment

60 Hz:

| Transport | ICE | Setup p50 / max | p50 | p95 | p99 | Loss | Jitter | Max raw gap | Max freeze | Freezes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ex_webrtc` | 4/4 | 439 / 515 ms | 38.2 ms | 117.0 ms | 127.2 ms | 2.55% | 5.77 ms | 117.9 ms | 102.0 ms | 9 |
| `livekit_lossy` | 4/4 | 626 / 735 ms | 38.7 ms | 115.3 ms | 126.2 ms | 0.24% | 8.88 ms | 121.9 ms | 100.9 ms | 6 |
| `livekit_track` | 4/4 | 820 / 922 ms | 38.3 ms | 116.0 ms | 125.3 ms | 1.53% | 8.56 ms | 113.9 ms | 74.6 ms | 0 |
| `websocket` | 4/4 | n/a | 43.6 ms | 119.1 ms | 130.8 ms | 0.00% | 13.44 ms | 126.6 ms | 124.4 ms | 3 |

30 Hz:

| Transport | ICE | Setup p50 / max | p50 | p95 | p99 | Loss | Jitter | Max raw gap | Max freeze | Freezes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ex_webrtc` | 4/4 | 375 / 487 ms | 37.5 ms | 114.3 ms | 124.1 ms | 1.58% | 12.17 ms | 148.3 ms | 135.1 ms | 18 |
| `livekit_lossy` | 4/4 | 723 / 836 ms | 40.5 ms | 118.6 ms | 132.7 ms | 0.11% | 14.81 ms | 154.3 ms | 123.5 ms | 15 |
| `livekit_track` | 4/4 | 840 / 942 ms | 39.5 ms | 115.0 ms | 126.5 ms | 0.00% | 9.38 ms | 129.8 ms | 91.0 ms | 0 |
| `websocket` | 4/4 | n/a | 51.1 ms | 127.0 ms | 147.5 ms | 0.00% | 12.54 ms | 279.9 ms | 243.3 ms | 96 |

- Every transport meets the p95 target of 150 ms or less from this client.
- `ex_webrtc` loss is spread evenly over the 12 streams (2.5 to 2.7% each at 60 Hz), and no sender dropped a frame. About 7 frames of each stream (0.4% of a 30 s run) are lost at start-up, before the relay registers the far DataChannel. The cause of the remaining loss of about 2% is unknown. LiveKit and WebSocket on the same Wi-Fi lost 0 to 0.3%.
- WebSocket has 0% loss, but it delivers late frames in bursts. At 30 Hz it had the worst freezes (96 above 100 ms).

## Scenario B: 1% loss and 30 ms jitter, 60 Hz, 30 s

The bench drops 1% of received frames and delays each by up to 30 ms at the receiver, after the transport (`--loss-pct 1.0 --jitter-ms 30.0 --jitter-buf-ms 40`). Real network loss of the Wi-Fi adds to it.

| Transport | ICE | Setup p50 / max | p50 | p95 | p99 | Loss | Jitter | Max raw gap | Max freeze | Freezes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ex_webrtc` run 1 | 4/4 | 443 / 506 ms | 57.7 ms | 135.4 ms | 188.2 ms | 5.69% | 18.19 ms | 2038.9 ms | 1917.9 ms | 77 |
| `ex_webrtc` run 2 | 4/4 | 484 / 518 ms | 57.7 ms | 132.0 ms | 149.4 ms | 4.17% | 19.21 ms | 141.6 ms | 133.7 ms | 75 |
| `livekit_lossy` | 4/4 | 667 / 768 ms | 59.1 ms | 132.8 ms | 148.1 ms | 1.10% | 19.70 ms | 129.2 ms | 116.8 ms | 20 |
| `livekit_track` | 4/4 | 733 / 830 ms | 57.5 ms | 131.7 ms | 147.5 ms | 2.39% | 19.77 ms | 136.1 ms | 105.9 ms | 5 |
| `websocket` | 4/4 | n/a | 65.8 ms | 139.2 ms | 156.6 ms | 0.98% | 16.59 ms | 131.1 ms | 133.3 ms | 5 |

- No transport met "no freeze above 100 ms". The 110 to 135 ms freezes of LiveKit and WebSocket match the periodic Wi-Fi stall of the client. They are not a transport result.
- In `ex_webrtc` run 1, peer 2 dropped 138 frames by backpressure, and its 3 outgoing streams had a 2.0 s gap. The other peers dropped 0 or 1. The injected loss is after the transport, so it cannot cause this. Run 2 had no stall.
- `livekit_track` against `livekit_lossy`: the max raw gap of `livekit_track` (136 ms) is in the same range as `livekit_lossy` (129 ms) and WebSocket (131 ms). A wait for a lost frame would make a gap of at least one retransmission time. Thus no head-of-line stall was seen on the real Wi-Fi loss. `livekit_track` lost more frames (2.39% against 1.10%).

## Scenario D: relay restart

`--transport ex_webrtc --hz 60 --rejoin-check`, then `fly machine restart 814e1ec9273398` after `READY_FOR_RESTART`. The restart command took 7.5 s until the health check passed.

| Run | Reclaim (drop to host reclaim) | Rejoin (reclaim to guest transport up) | Pose resume (drop to first guest pose) |
| --- | --- | --- | --- |
| 1 | 674.8 ms | 2582.6 ms | 3295.0 ms |
| 2 | 224.7 ms | 871.9 ms | 1134.6 ms |
| 3 | 243.9 ms | 883.1 ms | 1166.5 ms |

A LiveKit SFU restart was not measured (unknown).

## Scenario E: CPU and memory headroom

CPU is from `/proc/stat` over 5 s, after the relay reports the target room count. "Busy" includes steal. BEAM numbers come from `GET /healthz`, polled every 2 s. The scheduler utilization is `:scheduler.utilization(3)` (normal schedulers only). The relay has 2 schedulers.

`ex_webrtc`, one bench process:

| Rooms (peers) | Relay CPU busy (steal) | Scheduler util. | Run queue max | BEAM memory first → max | Processes max | Loss | p50 | p95 | p99 | Max raw gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0.1% (0.0%) | unknown (not sampled) | 0 | 77 MB | 483 | — | — | — | — | — |
| 1 (4) | 21.7% (0.9%) | unknown (not sampled) | unknown (not polled) | unknown (not polled) | unknown (not polled) | 2.16% | 38.3 ms | 118.8 ms | 178.6 ms | unknown (not recorded) |
| 5 (20) | 61.1% (2.3%) | 25.5% | 33 | 360 → 450 MB | 610 | 2.81% | 45.0 ms | 126.9 ms | 140.9 ms | 148.0 ms |
| 10 (40) | 79.2% (2.3%) | 40.0% | 71 | 95 → 229 MB | 735 | 6.58% | 76.0 ms | 163.4 ms | 236.5 ms | 1164.4 ms |
| 25 (100) | 97.3% (4.0%) | 44.7% | 167 | 217 → 390 MB | 1110 | 38.75% | 369.7 ms | 2426.9 ms | 4412.7 ms | 6893.2 ms |
| 50, 100 | not run | | | | | | | | | |

- The steps ran in the order 10, 25, 5, so the 5-room step started with 360 MB.
- 50 and 100 rooms were not run: the relay saturated at 25 rooms (97% CPU, run queue 167, loss 39%). A second 25-room run after a restart gave loss 36.6% and p50 423 ms.
- The client was not the limit at 25 rooms: `/usr/bin/time` gave 8.6 s user + 22.6 s system in 31.7 s (about 1 of 12 cores), with a peak RSS of 106 MB.
- At the 1-room rate, 100 rooms need about 43 shared vCPUs. This is an extrapolation, not a measurement.
- **Memory does not come back.** After one 25-room step from a fresh restart, BEAM memory at 0 rooms went from 77 MB to 230 MB. After the 10, 25, and 5 steps it was 445 MB at 0 rooms with 483 processes. `:erlang.memory()` then gave `binary` 219 MB and `processes` 167 MB. A full garbage collection of all processes freed about 5 MB. The largest process was 0.2 MB. The cause is unknown. Possible owners are NIF resources of `ex_dtls`, `ex_sctp`, or `ex_ice`. At this rate a 1 GB Machine fails after a few load cycles.

`livekit_lossy`:

| Rooms | Client processes | SFU CPU busy (steal) | Relay CPU | Connected | Loss | p50 | p95 / p99 max | Max raw gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | — | 0.2% (0.0%) | 0.1% | — | — | — | — | — |
| 1 | 1 | 4.0% (0.0%) | 0.5% | 4/4 | 0.34% | 39.4 ms | 115.1 / 125.4 ms | unknown (not recorded) |
| 4 | 4, one room each | 14.3% (0.0%) | unknown (not sampled) | 16/16 | 0.32% | 39.8 ms (median) | 117.0 / 126.8 ms | 113.7 ms |
| 4 | 1 | 12.3% (0.0%) | unknown (not sampled) | 16/16 | 0.12% | 883.1 ms | 2035.5 / 2228.7 ms | 229.4 ms |
| 10 | 10, one room each | unknown (the sample ran after the clients stopped) | 0.1% | 32/40 | 40.0% | 124.2 ms (median) | 389.1 / 637.2 ms | 449.8 ms |
| 10 | 1 | unknown | unknown | unknown | unknown | unknown | unknown | unknown |

- The LiveKit SFU used about 3.6 to 4.0% of its 2 shared vCPUs for each room, about one fifth of the `ex_webrtc` relay.
- One client process with more than one LiveKit room queues frames on the client: 4 rooms in one process gave p50 883 ms with low loss, while 4 processes gave p50 40 ms. With 10 rooms in one process, the bench did not exit after the run and was stopped after 2.5 min, so that row has no data.
- At 10 client processes, 2 processes failed with `no approved event within 10s`, and the others dropped 15075 frames by backpressure. The client was the limit. LiveKit SFU headroom above 4 rooms is unknown.
- The relay BEAM stayed at 85 to 87 MB with run queue 4 or less during the LiveKit runs, because it only handles signalling and tokens.

## Findings from Tasks 1 to 6

- **`ex_sctp` and the Cargo workspace.** `ex_sctp` builds a Rustler NIF inside `apps/relay/deps`. The root `Cargo.toml` is a workspace, so Cargo refuses to build it there. The root `Cargo.toml` has `exclude = ["apps/relay/deps"]`. In a nested worktree under `.worktrees/`, Cargo still finds the parent workspace, so the relay deps go to `MIX_DEPS_PATH` outside the checkout.
- **ECDSA DTLS certificate.** `str0m` 0.26 uses `dimpl` for DTLS 1.2. `dimpl` offers only ECDHE-ECDSA cipher suites and accepts only ECDSA certificates. `ex_dtls` makes RSA-2048 by default. The relay gives each PeerConnection a cached P-256 ECDSA `key_cert`.
- **SCTP role.** `str0m` offers `a=setup:actpass` and starts SCTP only as the DTLS client. An `ex_webrtc` answerer takes the DTLS client role for `actpass`, and it starts SCTP only as the offerer. No side sent SCTP INIT. The client now offers `a=setup:active`.
- **Loopback ICE.** `ex_ice` does not gather `127.0.0.1`. A local relay must bind a LAN IPv4 or `0.0.0.0`. The default `RELAY_UDP_BIND_IP=127.0.0.1` fails ICE.
- **`-ObjC` on macOS.** `livekit` 0.12.1 (`webrtc-sys` 0.3.55) needs `-ObjC` at link time. Without it, the first `Room::connect` aborts with `+[NSString stringForStdString:]: unrecognized selector`. `cargo check` does not show this. `crates/collab-transport/build.rs` adds the flag for the tests and for `transport-bench`. The desktop app does not link `livekit`.
- **`auto_ex_webrtc`.** The switch from WebSocket to the primary transport makes one gap of about 200 ms in each stream (Task 6, local run). It was not run on Fly.
- The `livekit` crate was not run on Windows. That check of ADR 0001 is open.

## Fly resources

The apps `opensekai-relay-spike` and `opensekai-livekit-spike` and their dedicated IPv4 addresses (`66.51.127.176`, `168.220.88.192`, USD 2 a month each) stay provisioned for the owner to inspect or destroy. Both Machines were stopped at 2026-11-28 00:19 UTC. Both services have `auto_start_machines = true`, so a request to an app can start its Machine again. Secrets are in Fly only (`fly secrets list`). To remove everything: `fly apps destroy opensekai-relay-spike` and `fly apps destroy opensekai-livekit-spike`.

## Unknown

- Results from other networks (wired, EU, NA, JP homes). ADR 0001 asks for EU, NA, and JP. This run has one Wi-Fi client in Vienna.
- The cause of the `ex_webrtc` baseline loss of about 2%.
- The cause of the `str0m` SCTP send stall of 1 to 2 s.
- The cause of the relay memory growth.
- LiveKit SFU headroom above 4 rooms, and LiveKit SFU restart recovery.
- Behaviour across a full `fly deploy` (only `fly machine restart` was run).
- A `performance` Machine size. All runs used `shared-cpu-2x`.
