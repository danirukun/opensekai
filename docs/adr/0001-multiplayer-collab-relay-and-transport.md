# 0001. Multiplayer collab: relay, transport and trust model

Status: Proposed (owner decisions below locked 2026-11-22; the transport choice waits for the spike)
Date: 2026-11-22
Owner: danirukun
Related: [#219](https://github.com/danirukun/opensekai/issues/219) VRM protection, [#190](https://github.com/danirukun/opensekai/issues/190) / [#308](https://github.com/danirukun/opensekai/issues/308) deep links, [#67](https://github.com/danirukun/opensekai/issues/67) VMC sender, [#18](https://github.com/danirukun/opensekai/issues/18) / [#19](https://github.com/danirukun/opensekai/issues/19) VMC / iFacialMocap receive, [#16](https://github.com/danirukun/opensekai/issues/16) CHR-10 multiple characters, [#134](https://github.com/danirukun/opensekai/issues/134) stale source, [#135](https://github.com/danirukun/opensekai/issues/135) per-source smoothing, [#340](https://github.com/danirukun/opensekai/issues/340) 5-minute first run. Figma: [Flows · Draft – multiplayer](https://www.figma.com/board/9cW3tyqSn8CDBIsSlMiPcb/OpenSekai-Flows?node-id=68-700), [UI · Draft – multiplayer UI (low-fi)](https://www.figma.com/design/WSkWz6AUxzNxbweU4Tjmkz/OpenSekai-UI?node-id=109-10). Long-form research: the multiplayer epic draft (to be linked later). Collab spec in docs/superpowers/specs/ to follow.

Requested by danirukun.

## Context

OpenSekai needs two collab lanes:

- **Lane A, guest rooms.** A host starts a session, shares a link or code, a guest (for example Xiu) joins, shares their already-loaded avatar with one click, and their motion and face capture is relayed to the host automatically. Target: **≤ 5 minutes from opening OpenSekai to Xiu moving in the host's scene**, for VTubers who use VBridger or Warudo, know VNet, and don't do port forwarding, WireGuard or Tailscale. Bidirectional (host avatar on the guest side) and lip sync are follow-ups.
- **Lane B, live edit collaboration.** A helper (for example Ben) gets **View only** or **Edit** access to the host's editor for remote help or building a scene together.
- **Lane C, long horizon.** View-only clients that render the scene themselves, served by the **same relay**. **Out of the MVP.** The product shape stays open.

Constraints from the owner: no accounts in the first slice; security first (no malicious links, no IP leaks, protect shared avatars as far as possible, in the spirit of VRoid Hub); an **Elixir / Phoenix** relay with one process per room and all of a room's participants on one node (the Discord guild model); **everything in memory** in the first slice, Postgres later; hosted on **Fly.io**. On transport, the owner cares about **smoothness over completeness**: dropped frames are fine, the receiver fills the gaps.

What exists today (see `ARCHITECTURE.md`): a Tauri 2 app whose **Rust host** owns sockets, the asset registry and a loopback service; the **session worker** is the single scene authority and connects as `publisher`; clients connect as `operator` or `renderer`, and the host's router checks role and capability (`edit`) before relaying calls. Blueprint edits are already server-authoritative op batches with a revision journal and optimistic clients. The session already produces an evaluated pose (`vmcPoses`) for the VMC sender.

## Decision

### Owner decisions (2026-11-22)

| Topic | Decision |
| --- | --- |
| Hosting | Fly.io, first region **`ams`** (Amsterdam) |
| Self-hosting | **Self-hosted from day 1.** The same Docker image runs on Fly.io and on a machine the user runs. Settings holds the relay URL. |
| Repo | Relay in the monorepo at **`apps/relay`** |
| Room size | **4 max: 1 host + 3 guests** |
| Approval | **Every room join needs one explicit host approval** (knock), for links and codes, including people seen before |
| "Remember my choice" | Allowed, but it only skips the **guest-side consent prompts** (share avatar, send motion, show host's avatar), never the host approval |
| VRM license | **Show the license in the consent prompt; never block** sharing |
| Persistence | In memory first; Postgres in a later phase |
| Mocap transport | **WebRTC first** (DataChannels terminated by the Elixir relay), **WebTransport as the fallback "if all fails"**, built **only if the spike shows a need** |
| Plan B if Fly UDP fails | **Cloudflare Realtime SFU DataChannels**, behind an **abstract transport adapter** so a later switch (for example to a pure-Elixir relay on a plain VM) is cheap |
| TURN | **None** |
| Pose rate | **60 Hz by default**, with a **30 Hz mode** the host can switch to. Add an automatic drop to 30 Hz under congestion **only if it is easy**. If it is not easy, keep the manual switch. |
| Platforms | **macOS and Windows first**; Linux later |
| Join links | **`https://` links** that hand off to `opensekai://` (the secret stays in the URL fragment); Windows scheme registration is tracked in this epic |
| ADR location | New **`docs/adr/`** folder; this is **0001**; AGENTS.md documents the convention |
| Lip sync | **Visemes on the guest's machine**, plus a **voice-delay slider**. **No audio** is sent. Build it in slice 1 only if it fits. If it does not fit, defer it. |
| Lane B preview | **Video preview first.** A 3D remote viewport comes later. **Collabs come first.** |
| Invites | **Only the host** may invite, for now. |
| Milestone | **Part of the MVP.** Lane C is not part of the MVP. |
| Relay restart | Guests **rejoin the existing session**. The host reclaims the room. **Node drainage** is a follow-up if the relay is Elixir. |
| Spectators | **Deferred.** Out of the MVP. |
| Process | This ADR first; issues and SPDD slice contracts follow from it |

### Architecture decisions

1. **A remote participant is just another client.** Guests appear in the host's session as a tracking source of kind **`remote`** (so #134 stale handling, #135 smoothing, diagnostics and CHR-10 rules apply unchanged). Remote editors are remote **`operator`** clients behind the existing role and capability router, with calls carried as an end-to-end encrypted RPC envelope. The session never touches the network; **all collab networking lives in the Rust host**.
2. **Relay = `apps/relay`, Elixir / Phoenix on Fly.io (`ams`).** One `RoomServer` GenServer per room (`DynamicSupervisor` + `Registry`), Phoenix Channels for signalling, presence, consent, key wraps, scene state, the edit RPC and WebRTC offer/answer/ICE. One Machine in one region for slice 1; all state in memory.
3. **Mocap transport, in this order:**
   1. **WebRTC DataChannel over UDP, terminated by the relay (primary).** Each participant opens **one `RTCPeerConnection` to the relay only**, with a DataChannel `pose` set to **`ordered: false, maxRetransmits: 0`**. The relay runs **`ex_webrtc`** (with `ex_sctp`): one PeerConnection process per participant, supervised under that room's `RoomServer`, which forwards each incoming pose message to the other members' DataChannels (an SFU for data). The relay is the **only ICE peer**; there is never a peer-to-peer path, so **no participant ever sees another's IP**.
   2. **WebTransport datagrams over QUIC on UDP 443 (fallback if WebRTC can't connect).** A small Rust sidecar `sekai-rt` (`wtransport`) in the same Machine, started as an Erlang Port, verifies a Phoenix-issued ticket and forwards datagrams the same way. **Decided: built only if the spike shows a need** (see "Does WebTransport as a fallback add value?").
   3. **Binary frames over the Phoenix WebSocket (last resort)** for networks that block UDP. Always available, because every client already holds the WebSocket for signalling.
   Clients start sending poses over the WebSocket immediately (the 5-minute flow never waits on UDP) and switch up as soon as the DataChannel (or WebTransport) opens; they drop back automatically after 1 s of total loss and retry with backoff. Diagnostics show which path is active.
4. **Transport adapter (both ends).** Callers never use a transport directly; they use one small interface, so the relay implementation can change without touching the session, the room logic or the UI:

   ```ts
   // Client side (Rust host implements it; shape shown in TS for clarity)
   interface MocapTransport {
     connect(room: RoomRef, creds: TransportCreds): Promise<void> // negotiate (SDP/ICE, ticket, or WS) after host approval
     sendPose(frame: Uint8Array): void            // unreliable, latest-only; drops instead of queuing
     subscribe(onPose: (slot: number, frame: Uint8Array) => void): Unsubscribe
     stats(): { kind: 'webrtc-relay' | 'cf-realtime' | 'webtransport' | 'websocket'; rttMs: number; lossPct: number; jitterMs: number; hz: 30 | 60 }
     close(reason?: string): void
   }
   ```

   On the relay, a matching `Relay.Transport` behaviour (`open_session/2`, `negotiate/3`, `forward/3`, `stats/1`, `close/2`) sits under the `RoomServer`; the room logic (roster, permissions, kick) calls only the behaviour. Implementations:
   - **`ExWebRTCRelay`** (primary): `ex_webrtc` PeerConnections on Fly.
   - **`CloudflareRealtime`** (Plan B): each participant publishes its `pose` DataChannel to a Cloudflare Realtime SFU session and subscribes to the others'; Phoenix creates and closes the SFU sessions with the app secret (server side only) and mirrors kick and permission changes by closing or not creating subscriptions.
   - **`WebTransportSidecar`** (conditional fallback) and **`WebSocketFrames`** (last resort).
   - Later, if wanted: a **pure-Elixir relay on a plain VM** (WebRTC or WebTransport) behind the same behaviour.
   Transport selection is per room and per participant and is reported in diagnostics. Matches the constitution rule "Keep platform code behind adapters" and the R2 adapter pattern.
5. **Client WebRTC lives in the Rust host, using `str0m`** (sans-I/O Rust WebRTC, data channels supported, 0.25.0 published 2026-11-03), not in the WebView. Reasons: `ARCHITECTURE.md` already puts sockets in the Rust host, frames arrive where tracking already arrives, one implementation covers **macOS and Windows** (the first targets), and the WebTransport fallback (`wtransport`) sits next to it. Because WebRTC is in Rust, the WebView's WebRTC support (including WebKitGTK's lack of it) doesn't matter when Linux comes later. See "Client options".
6. **Frame format `sekai-pose/1`:** the guest's **final evaluated pose** (bones as smallest-three quaternions, root, expression weights, optional visemes), **absolute state in every message, no deltas**, ~340 B, sequence number + sender timestamp, AES-GCM with the room group key. **End-to-end encryption stays even though WebRTC already encrypts with DTLS**, because the relay terminates DTLS and would otherwise see plaintext poses. Optional redundancy (previous frame repeated) when measured loss > ~2%.
7. **Receiver "fills the gaps":** adaptive jitter buffer (30–100 ms), slerp/lerp interpolation, up to 100 ms damped extrapolation for bones (expressions held), then hold, then fade to idle via the existing stale path after 1 s.
8. **Trust model without accounts:** link = room ID + **128-bit secret in the URL fragment** (server stores only a hash); codes are short and always knock; **mandatory host approval with matching safety words** derived from both parties' X25519 keys; **end-to-end encryption** (HPKE-wrapped group key, AES-256-GCM) so the relay sees only ciphertext; join links are **`https://` universal links** (e.g. `https://opensekai.app/j/<room>#<secret>`, final domain TBD) whose landing page hands off to `opensekai://` (macOS Universal Links / Windows app-URI handler where available, otherwise a JS redirect with an "Open OpenSekai" button and a download link if the app is missing); the secret stays in the fragment so the landing page server never sees it; the app-side `opensekai://` handler follows #190 (strict parse, relay allowlist, open a dialog only), and Windows needs the deep-link plugin registered (#190 / #308 follow-up, tracked in this epic); kick, revoke, rate limits. A WebRTC PeerConnection is created only after the host approves, using credentials from the room channel.
9. **Asset protection is deterrence, layered:** consent with license summary → E2E encrypted transfer with TTL → decrypted **into memory only**, never written to disk or the show file → no export paths → obfuscated loopback handoff to renderers → later VRoid Hub-style distortion and watermarking (F2, #219). We state plainly that anyone who can render a model can extract it.
10. **Edit collaboration keeps the current model:** server-authoritative ops through the host's session, **no CRDT**, revision journal **pushed** instead of polled, presence (names, cursors, selections), and a **video preview** of the host's output for helpers first (no scene assets leave the host). A 3D remote viewport comes later. Collabs (Lane A and Lane B) come before that viewport. **Only the host may invite**, for now. An Edit helper cannot invite.
11. **In-memory relay, host is the source of truth.** A relay restart **does not end the session.** The host's client **reclaims** the room under the same ID (proved with a host secret); known guests reconnect and re-join that session, **still through one host approval** (the UI makes it a one-click "Let Xiu back in"). PeerConnections are re-established after re-join. Encrypted avatar blobs live in object storage with a TTL, not on the Machine. **Follow-up:** if the relay stays on Elixir, drain the node before shutdown so rooms can move. Until that drain exists, rejoin is the recovery path.
12. **Spectators (Lane C) are out of the MVP.** Do not add a public audience, a trusted-spectator mode, or a video-only audience in the first slices. The product shape of Lane C stays open. Remote editors still use the scene snapshot stream that Lane B needs. A `viewer` role and spectator fan-out wait.
13. **The relay is self-hostable from day 1.** One Docker image runs on Fly.io and on a machine the user runs. Settings stores the relay URL. The client does not hard-code the Fly host.

## Q3: can we meet the target for 1 host + 3 guests?

**Yes, with an unreliable channel (WebRTC DataChannel or WebTransport datagrams).** WebSocket alone meets the bandwidth easily but not the smoothness target on typical Wi-Fi, so it is the last resort only.

### Target (proposed)

- Added motion latency (guest's pose → visible on host), same continent: **p95 ≤ 150 ms**.
- **No visible freeze > 100 ms** at 1% random loss and 30 ms jitter.
- **60 Hz by default**, with a **30 Hz mode** (host setting per room) for weak uplinks; works with up to 3 guests and bidirectional streams. Add an automatic drop from 60 Hz to 30 Hz under congestion, and a return to 60 Hz when it clears, **only if that change is easy to build**. If it is not easy, the host uses the manual switch only.

### Bandwidth (full mesh via the relay: each participant sends 1 stream and receives 3)

Per frame ≈ 340 B pose + 28 B AES-GCM = 368 B. On the wire:
- **WebRTC DataChannel ≈ 461 B**: IPv4 20 + UDP 8 + DTLS 1.2 record with AES-GCM ≈ 37 + SCTP common header 12 + DATA chunk 16. SCTP also sends SACKs back (about one ~90 B packet per two DATA packets), adding roughly **10%** in the reverse direction.
- WebTransport datagram ≈ 428 B; WebSocket ≈ 435 B (plus TCP ACKs).

| Transport, rate | Per client up | Per client down | Relay in (room) | Relay out (room) | Egress per room-hour |
| --- | --- | --- | --- | --- | --- |
| WebRTC DC, 30 Hz | 111 kbit/s | 332 kbit/s | 0.44 Mbit/s | 1.33 Mbit/s | 0.60 GB |
| **WebRTC DC, 60 Hz** | **221 kbit/s** | **664 kbit/s** | **0.89 Mbit/s** | **2.66 Mbit/s** | **1.19 GB** |
| WebRTC DC + redundancy 1, 60 Hz | 398 kbit/s | 1.20 Mbit/s | 1.59 Mbit/s | 4.78 Mbit/s | 2.15 GB |
| WebTransport, 60 Hz | 205 kbit/s | 616 kbit/s | 0.82 Mbit/s | 2.47 Mbit/s | 1.11 GB |
| WebSocket, 60 Hz | 209 kbit/s | 626 kbit/s | 0.84 Mbit/s | 2.51 Mbit/s | 1.13 GB |

(Excluding SACKs and ACKs.) 240 packets/s in and 720 out per room at 60 Hz.

- **Clients:** at most ~1.3 Mbit/s even with redundancy; home uplinks are not a constraint. Avatar transfer (a one-off 10–50 MB upload) dominates the 5-minute budget, not mocap.
- **Relay cost:** Fly egress is $0.02/GB in Europe and North America → **≈ $0.024 per room-hour at 60 Hz**, plus **$2/month** for the dedicated IPv4 UDP needs. 100 concurrent rooms ≈ 270 Mbit/s out and ≈ 96k packets/s, all through DTLS + SCTP in the BEAM (`ex_dtls` uses OpenSSL; `ex_sctp` wraps the Rust `sctp_proto`), which the spike must load-test.

### Latency and jitter

Added latency ≈ one-way guest→`ams` + one-way `ams`→host + **playout buffer** + up to one render frame (≤ 17 ms). Typical one-way to Amsterdam from European homes is ~5–25 ms; US East adds ~40–50 ms each way [estimate; measure in the spike].

**WebSocket (TCP) under loss.** TCP delivers in order, so one lost segment holds back every later frame until it is retransmitted (head-of-line blocking). With one frame per segment at 60 Hz, fast retransmit needs three duplicate ACKs (RFC 5681), so a loss costs **≈ 3 frame intervals + 1 RTT ≈ 70–130 ms**; a tail loss waits for a probe or timeout (RACK-TLP ~2 × SRTT, RFC 8985; Linux minimum RTO 200 ms). Each stream crosses **two TCP hops**, and the host's **single downlink carries all 3 guests**, so one loss freezes everyone. Stall events per host ≈ loss × ~360 packets/s: ≈ 0.36/s at 0.1% loss (wired) and ≈ 3.6/s at 1% (common on home Wi-Fi [estimate]). Hiding that needs a **150–250 ms** buffer, which breaks the latency target.

**WebRTC DataChannel `ordered:false, maxRetransmits:0` (and WebTransport datagrams).** A lost message is skipped; nothing waits, and each guest's frames are independent. At 1% loss about one frame in 100 is a 16.7 ms gap that interpolation hides; 5% loss or 100 ms bursts are covered by the jitter buffer plus extrapolation. The buffer stays at **30–50 ms**, so added latency is **~45–100 ms within Europe**. SCTP congestion control still applies to the association; with `maxRetransmits: 0` an abandoned message is dropped instead of retransmitted (RFC 8831 / RFC 3758 partial reliability). Senders watch `bufferedAmount` and **drop a frame instead of queuing** it when anything is still buffered. An automatic change from 60 Hz to 30 Hz is optional. See "Target".

## Does WebTransport as a fallback add value?

Both WebRTC and WebTransport need UDP, so in a network that blocks UDP entirely **neither helps**: the WebSocket is the floor. WebTransport adds value only in narrower cases:

- **"UDP 443 only" networks.** Many corporate and campus firewalls allow UDP to port 443 (for QUIC/HTTP/3) and block other UDP ports. Our WebRTC uses an ICE port range (for example 50000–50999), because `ex_webrtc` binds one UDP port per PeerConnection and has **no single-port mux**, so it can't share 443 across participants. A WebTransport endpoint on UDP 443 can serve everyone on one port.
- **Fly or `ex_webrtc` problems found in the spike** (for example the UDP port range not being routed, see Fly caveats), where a single-port QUIC listener still works.
- **Not** for UDP-blocked networks, and not for latency: on a network where both work they behave the same.

**TURN/TCP options:** `ex_ice` doesn't support ICE-TCP or TCP relay candidates yet. TURN over TLS on 443 (Cloudflare Realtime TURN, or coturn) would carry WebRTC over TCP, but that brings back the same head-of-line stalls as our WebSocket fallback with more moving parts, so **no TURN** in the plan.

**Decided:** keep the order WebRTC → WebTransport → WebSocket, with WebTransport **conditional**: the spike measures how often ICE fails while UDP 443 works; if that is rare, we skip building `sekai-rt` and go straight from WebRTC to WebSocket. **No TURN** (decided).

## Client options

| Engine | WebRTC DataChannels |
| --- | --- |
| **WKWebView (macOS Tauri, today's target)** | `RTCPeerConnection` and DataChannels exist in WebKit on macOS. A DataChannel-only connection needs no camera or microphone permission (only `getUserMedia` does); a sandboxed (Mac App Store) build would need the network client/server entitlements [UNVERIFIED for Tauri builds; check in the spike]. |
| **WebView2 (Windows Tauri)** | Chromium WebRTC, full support. |
| **WebKitGTK (Linux Tauri, later target)** | Not relevant to the plan (WebRTC runs in Rust), but for the record: **not usable.** `enable-webrtc` defaults to off and wry never turns it on; Ubuntu, Arch and the GNOME Flatpak build WebKitGTK without WebRTC (`RTCPeerConnection` is `undefined`), and WebKit disabled the GStreamer WebRTC backend for the 2.54 stable branch while it moves to LibWebRTC. |
| **Rust host: `str0m` (chosen)** | Sans-I/O WebRTC in Rust with DataChannels (0.25.0, 2026-11-03). Same behaviour on every OS, fits the host-owns-sockets rule, and we control the UDP socket. |
| Rust host: `webrtc-rs` | A port of Pion; viable alternative with its own async runtime. |

## Options considered

### Transport (primary)
1. **WebRTC DataChannel via the Elixir relay (chosen).** Unreliable, unordered, client–server, keeps the relay **pure Elixir** (`ex_webrtc` 0.18.0, Oct 2026, Apache-2.0, maintained by the Elixir WebRTC / Software Mansion team, DataChannels via optional `ex_sctp`, in-band negotiation only, supports `ordered`, `max_retransmits`, `max_packet_life_time`). Costs: ICE/DTLS/SCTP setup (~1–2 RTT more than QUIC), more parts to debug, and pre-1.0 APIs.
2. **WebTransport datagrams as primary (rejected as primary, kept as fallback).** Simpler protocol and one UDP port, but the relay would need a Rust sidecar because every Elixir QUIC/WebTransport library is still experimental, and Fly explicitly says QUIC through its UDP services "isn't supported". The owner prefers the pure-Elixir path.
3. **WebSocket only (rejected as primary, kept as last resort):** head-of-line stalls (see Q3).
4. **Direct P2P WebRTC (rejected):** leaks IP addresses.
5. **Cloudflare Realtime SFU DataChannels instead of our own relay (decided as Plan B if Fly UDP fails, behind the transport adapter).** Clients publish and subscribe to DataChannels on Cloudflare's SFU; unordered + `maxRetransmits: 0` is supported (since Aug 2026, with identical settings for publisher and subscribers); $0.05/GB after 1 TB/month free (1.19 GB per room-hour → about 840 free room-hours a month). No UDP to operate on Fly, global anycast, TURN included; Phoenix keeps signalling and room state. Against: a second vendor, and room logic (kick, permissions) has to be mirrored into SFU sessions. Poses stay E2E encrypted, so Cloudflare sees only ciphertext.

### Hosting option: Cloudflare Containers (Elixir + WebTransport there?)

What the docs say (Nov 2026):
- **No inbound UDP to Containers.** A Container is reachable only through its Durable Object, via the Worker's `fetch()` (HTTP and WebSockets) or, since 19 Nov 2026 in public beta, raw **TCP** through a Spectrum application with a Worker origin (Pro/Business zones get one such app per zone on one TCP port). So no WebRTC host candidates and no QUIC.
- **No WebTransport in Workers or Durable Objects.** The edge accepts HTTP/3 from browsers but doesn't forward WebTransport sessions or datagrams to a Worker or Container; a workerd maintainer said in Mar and Jul 2026 that it is "not currently on our priority list" because the runtime has no QUIC/HTTP-3 implementation.
- **Long-lived BEAM is possible:** no fixed maximum runtime, `setInactivityTimeout()` controls sleep, host restarts send `SIGTERM` with up to 15 min grace; instance types from `lite` (1/16 vCPU, 256 MiB) to `standard-4` (4 vCPU, 12 GiB); placement can be constrained to regions such as WEUR (not a specific city like Amsterdam). **One Container per Durable Object** maps neatly to one room per GenServer.
- **Pricing:** memory $0.0000025/GiB-s, CPU $0.00002/vCPU-s (active only), egress $0.025/GB in NA/EU after 1 TB/month, on top of the $5 Workers Paid plan. A `lite` container per room ≈ $0.002 per room-hour in memory.

**Verdict:** **Elixir with WebTransport (or WebRTC) on Cloudflare Containers is not possible today**, because neither inbound UDP nor WebTransport reaches a Container. Containers could host the Elixir control plane with WebSockets, but that only gives us the WebSocket last-resort path and loses easy distributed Erlang between rooms. The one Cloudflare piece worth keeping in view is **Realtime SFU DataChannels (option 5)** as the mocap path if Fly UDP fails in the spike, with Phoenix on Fly unchanged.

### Edit sync
- **CRDT (Yjs / Automerge):** rejected for slice 1. The op journal is already server-authoritative and conflict-aware.
- **Server-authoritative ops through the host's session with a pushed journal (chosen).**

### Lip sync (follow-up)
- **Send audio and run lip sync on the host:** rejected. It sends the guest's voice and needs a media stack.
- **Visemes computed on the guest's machine, inside the pose frame (chosen):** no audio leaves the guest, and the mouth stays in sync with face capture. The owner confirmed this on 2026-11-22 and added a voice-delay slider. Build it in slice 1 only if it fits. If it does not fit, defer it (F1).

## Fly.io deployment for WebRTC

- **UDP needs a dedicated IPv4** ($2/month; no UDP over shared IPv4 or public IPv6) and the app must bind UDP to **`fly-global-services`** on the **same port** as the public one (Fly rewrites IPs, not ports). TCP (Phoenix, signalling) binds to `0.0.0.0` as usual.
- **ICE candidates:** restrict `ex_ice` gathering to the `fly-global-services` address with `ice_ip_filter`, and advertise the **dedicated public IPv4** with `host_to_srflx_ip_mapper` (meant for 1:1 NAT), so clients get a candidate they can reach. No STUN needed on the server.
- **Ports:** `ex_webrtc` binds one UDP port per PeerConnection from `ice_port_range` (no single-port mux; ICE-lite server mode isn't documented). Declare a UDP range in `fly.toml` (for example `start_port = 50000, end_port = 50999`, with internal = external ports). **Risk:** a Fly community report (Sep 2026) says a UDP service declared as a port range never received packets; the spike tests a range first and falls back to listing individual ports.
- **No per-flow UDP load balancing:** one Machine per region receives all UDP for that IP. So **one relay Machine per region**, which matches "all of a room on one node". Signalling still uses Phoenix Channels over the shared/anycast HTTP path with **`fly-replay`** to the room's Machine; UDP has no replay, so multi-region later needs one app (and IPv4) per region, with the room's region chosen at creation.
- **MTU:** WireGuard and the UDP proxy take ~72 B; SCTP messages of ~460 B are far below any limit.
- **Deploys:** UDP associations die on restart; clients re-join (with one approval) and the jitter buffer holds, then idles.

### Spike (1–2 days, before slice A1)
1. **`ex_webrtc` DataChannel on Fly `ams`:** dedicated IPv4, UDP port range, `str0m` client from EU/NA/JP home connections. Measure ICE success rate, setup time, loss, jitter, p95 added latency, CPU per 100 rooms, behaviour across deploys.
2. **WebTransport sidecar second:** only if (1) shows ICE failing where UDP 443 works, or the port range can't be routed.
3. **Plan B** if Fly UDP fails (decided): switch the room's transport adapter to `CloudflareRealtime`; Phoenix stays on Fly. A pure-Elixir relay on a plain VM stays possible later through the same adapter.

## Consequences

### Positive
- The relay stays **pure Elixir** for the primary path: one language, one supervision tree, PeerConnections live next to their room's GenServer.
- Smooth motion on lossy home Wi-Fi with low latency; guests don't stall each other; no IP exposure.
- One relay design covers guests and helpers. Spectators stay out of the MVP.
- Small running cost (≈ $0.024 per room-hour plus $2/month).

### Negative / risks
- **WebRTC complexity:** ICE, DTLS and SCTP on both ends, slower setup than QUIC, harder debugging; `ex_webrtc` and `str0m` are pre-1.0.
- **`ex_sctp` needs Rust to compile** (it wraps `sctp_proto`), so the relay image still has a Rust build step even without a sidecar.
- **Port-per-PeerConnection** means a UDP port range on Fly, which has an open routing report; the spike must prove it.
- **CPU:** DTLS + SCTP for every packet runs in the BEAM; load-test before promising room counts.
- Mandatory approval adds a click to every rejoin, including after a relay restart.
- Asset protection can only deter theft, never prevent it. The consent UI must say so.
- The WebTransport fallback, if built, adds the Rust sidecar and certificates back.
- The adapter layer is a small extra abstraction and must be kept honest: one shared conformance test suite (connect, send/receive at 60 and 30 Hz, loss handling, kick, close) runs against every implementation.
- Plan B puts the mocap stream on a second vendor (Cloudflare). Poses stay E2E encrypted, so Cloudflare only forwards ciphertext.

### Follow-up work this ADR implies
- `ARCHITECTURE.md`: new process boundary (collab client in the Rust host; `apps/relay` with `ex_webrtc`; the transport adapter).
- `docs/adr/` folder with `README.md`, this record as `0001-…`, and the ADR section in `AGENTS.md` (then `cp AGENTS.md CLAUDE.md`).
- Join links: the `https://` landing page (fragment-only secret, "Open OpenSekai" button, download link), the Universal Links / Windows app-URI association files on the link domain, and `opensekai://` registration on Windows (#190 / #308 follow-up, in this epic).
- SPDD analysis and prompt slice contracts for A1, B1 and the transport spike, per `AGENTS.md`.
- Settings field for the relay URL, and the same Docker image for the Fly.io host and a self-hosted relay.
- Node drainage for the Elixir relay, after the rejoin path. A restart does not wait for drainage.
- Issues (once this is accepted): epic, Lane A1, Lane B1, transport spike, F1 lip sync (defer past slice 1 if it does not fit), F2 avatar protection (#219), F4 VMC bridge guest mode, F7 spectators (out of the MVP), F8 Postgres, F9 multi-region.

## Open questions

Resolved on 2026-11-22 and moved into "Owner decisions": ADR location, Plan B, WebTransport fallback, TURN, pose rate, platforms, self-hosting, lip sync, Lane B preview, invites, milestone, relay restart, spectators, and the 30 Hz step-down. Blob storage follows the constitution (Cloudflare R2 behind the S3-compatible adapter), so it is no longer open. Windows deep links are resolved: share links are `https://` and hand off to `opensekai://`; Windows scheme registration is tracked in this epic (see decision 8).

1. **Lane C product shape:** video-only or a 3D view? A public audience, or a few trusted people? This waits. Lane C is out of the MVP.

## Sources

- WebRTC server: [ex_webrtc on Hex (0.18.0, Apache-2.0)](https://hex.pm/packages/ex_webrtc), [ex_webrtc GitHub](https://github.com/elixir-webrtc/ex_webrtc), [ExWebRTC.DataChannel](https://ex-webrtc.hexdocs.pm/ExWebRTC.DataChannel.html), [PeerConnection configuration (ice_port_range, ice_ip_filter, host_to_srflx_ip_mapper)](https://ex-webrtc.hexdocs.pm/ExWebRTC.PeerConnection.Configuration.html), [Deploying on bare machines (no ICE-TCP)](https://ex-webrtc.hexdocs.pm/bare.html), [Elixir Observer: ex_webrtc dependencies](https://elixir-observer.com/packages/ex_webrtc).
- WebRTC client: [str0m crate](https://crates.io/crates/str0m), [str0m Channel docs](https://docs.rs/str0m/latest/str0m/channel/struct.Channel.html), [WebKitGTK enable-webrtc (default FALSE)](https://webkitgtk.org/reference/webkitgtk/stable/property.Settings.enable-webrtc.html), [Tauri app report: WebKitGTK builds lack WebRTC, wry never enables it](https://github.com/LanternOps/breeze/issues/9557), [WebKit bug 321290: WebRTC disabled for GTK/WPE 2.54](https://bugs.webkit.org/show_bug.cgi?id=321290).
- Protocols: [RFC 8831 WebRTC data channels](https://www.rfc-editor.org/rfc/rfc8831), [RFC 3758 SCTP partial reliability](https://www.rfc-editor.org/rfc/rfc3758), [RFC 9221 QUIC datagrams](https://www.rfc-editor.org/rfc/rfc9221), [RFC 5681](https://www.rfc-editor.org/rfc/rfc5681), [RFC 6298](https://www.rfc-editor.org/rfc/rfc6298), [RFC 8985](https://www.rfc-editor.org/rfc/rfc8985).
- WebTransport (fallback): [WebKit: Safari 26.4 features](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/), [webstatus.dev](https://webstatus.dev/features/webtransport), [wtransport](https://crates.io/crates/wtransport), [phoenix_web_transport (prototype)](https://github.com/jfreeze/phoenix_web_transport).
- Fly.io: [UDP and TCP](https://fly.io/docs/networking/udp-and-tcp/), [fly.toml port ranges](https://docs.fly.io/reference/configuration), [community: UDP port range never receives packets (Sep 2026)](https://community.fly.io/t/udp-service-defined-with-a-port-range-never-receives-packets/28711), [pricing](https://fly.io/pricing), [fly-replay](https://docs.fly.io/networking/dynamic-request-routing).
- Cloudflare: [Containers FAQ (inbound TCP via Spectrum, lifetime)](https://developers.cloudflare.com/containers/faq/), [Container lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/), [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/), [Containers limits](https://developers.cloudflare.com/containers/platform/limits/), [Placement](https://developers.cloudflare.com/containers/concepts/placement/), [Workers protocols](https://developers.cloudflare.com/workers/reference/protocols/), [workerd WebTransport request (not on priority list)](https://github.com/cloudflare/workerd/issues/6451), [Inbound TCP for Workers/Containers (blog)](https://blog.cloudflare.com/grpc-workers/), [Realtime SFU DataChannels](https://developers.cloudflare.com/realtime/sfu/features/datachannels/), [DataChannel delivery controls (Aug 2026)](https://developers.cloudflare.com/changelog/post/2026-08-13-datachannels-reliability-ordering/), [Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/).
- Discord guild process model: [Maxjourney](https://discord.com/blog/maxjourney-pushing-discords-limits-with-a-million-plus-online-users-in-a-single-server). Asset protection: [VRoid Hub content protection policy](https://hub.vroid.com/en/content-protection-policy).
