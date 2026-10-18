# REASONS: Tracking receive and two performers

Date: 2026-10-18. Scope: bundle B5 (#18 TRK-01 first subset, #19 TRK-02 first subset, #16 CHR-10 first subset for two performers). Analysis: [tracking receive and two performers](../analysis/2026-10-18-tracking-receive-two-performers.md). Related: [minimum live VTubing](2026-10-03-minimum-live-vtubing.md), [One Euro filter](2026-10-04-one-euro-filter.md), [tracking smoothing controls](2026-10-04-tracking-smoothing-controls.md).

This file is the contract only. The implementation run starts after the owner merges it. The [Warudo VMC](https://docs.warudo.app/docs/mocap/vmc), [iFacialMocap](https://docs.warudo.app/docs/mocap/ifacialmocap), [Motion capture overview](https://docs.warudo.app/docs/mocap/overview), and [Character](https://docs.warudo.app/docs/assets/character) pages were read on 2026-10-18. The rules of the minimum live contract stay in force unless a requirement below changes them.

## R — Requirements

### VMC receive (TRK-01)

R1. The OSC reader accepts the type tags `i`, `f`, `s`, `b`, `h`, `d`, `t`, `T`, `F`, `N`, and `I` with OSC 1.0 sizes and padding. An unknown type tag, bad padding, truncation, trailing bytes, or a non-finite `f` or `d` still rejects the whole datagram. The limits do not change (8 KiB, depth 4, 64 messages).
R2. An address that the receiver does not handle never rejects a datagram, whatever its arguments. A number argument of a handled address can be `f`, `d`, or `i`. The other argument rules of `Root/Pos`, `Bone/Pos`, `Blend/Val`, `Blend/Apply`, `OK`, and `T` do not change.
R3. A `Bone/Pos` whose name, after the existing first-letter and thumb mapping, is not a humanoid bone is skipped. The other messages of the datagram apply. A datagram that holds only skipped bones and no other handled data returns "not recognized" and does not publish a sample.
R4. Coordinate conversion, Apply boundaries, the bone and expression limits, and the hold and fade rules do not change.

### iFacialMocap receive (TRK-02)

R5. An iFacialMocap bone field with a key other than `head`, `leftEye`, or `rightEye` is skipped. The other fields apply. The value rules of the known keys do not change. The head translation stays discarded (B6).
R6. When `phoneAddress` is set, the host sends the v2 handshake to phone port 49983 after bind, and again each 2000 ms ± 100 ms while the source state is `waiting` or `stale`. It stops when the source is `receiving`, stopped, removed, or replaced by a new generation. A send failure sets the existing error "Cannot send phone handshake" and stops the retry for that generation.
R7. `AppStatus` gets an optional `localAddresses: string[]`, as `trackingStatus` is optional: the IPv4 addresses of the up, non-loopback, non-link-local interfaces of this computer, at most 8, sorted. TypeScript and Rust accept and write the same shape; a missing field means an empty list. The iFacialMocap receiver Inspector shows them, as Warudo does on the receiver. When the list is empty, the Inspector shows nothing for it.

### Shared endpoint (TRK-01, TRK-02, CHR-10)

R8. Two or more enabled sources of the same kind (VMC or iFacialMocap) can use the same `bindAddress` and `port` when each has a different non-null sender address (VMC `senderAddress`, iFacialMocap `phoneAddress`). The host binds one socket for the endpoint. Each datagram goes to the source whose address equals the sender IP, before parsing. A datagram from another IP goes to no source and counts as invalid on no source. Each source keeps its own decoder, generation, packet counters, status, and sample.
R9. On an endpoint shared by sources of different kinds, or by a source without an address, or by two sources with the same address, the host keeps the first source in scene order and gives each other source the state `error` with the message "Endpoint used by <name of the first source>". A change that removes the conflict reconciles the sources on the next accepted revision.
R10. A source that joins or leaves a shared endpoint does not reset the other sources on it (their generation, counters, and sample stay). The socket closes when the last source leaves the endpoint. The handshake retry (R6) runs for each iFacialMocap source on the endpoint with its own phone address.
R11. The routing is a pure function `endpointRoutes(configs) → { endpoints, conflicts }` in the tracking module, with unit tests on each platform.

### Two performers (CHR-10)

R12. `setAvatarTracking` rejects, with `INVALID_INPUT` and the ID of the other avatar, a body or face source that another avatar uses as its body or face source. One avatar can use one source for both body and face. `sceneReplace` and show load keep the current rules, so an old show that shares a source still loads and runs. MCP reaches the rule through `scene_patch`.
R13. The Body source and Face source selects of a character disable each source that the other character uses. The current value of the select stays enabled.
R14. Add Character puts a new character at the position of the last avatar in scene order plus 1 m along +X, with the same rotation. With no avatar, it uses the world origin as today. Duplicate of a character uses the same rule. Duplicate still clears the copied assignment.
R15. With two avatars and four sources, the session produces two poses, each from its own sources only. A stale or stopped source of one avatar does not change the pose of the other. The renderer applies each pose to its own VRM instance only (bones, expressions, and root).

### MCP and documents

R16. The `scene_patch` tool description in `apps/mcp` names `createEntity` for a tracking source, `setTrackingConfig`, `setAvatarTracking`, and `setTrackingSmoothing`. The `app_status` description names `localAddresses`. No tool is added.
R17. `ARCHITECTURE.md` gets a short **Tracking path** section: receiver sockets and shared endpoints in the host, the credited clock, the session composer, and the renderer binding. `docs/warudo-parity.md` records only the verified subset. TRK-01, TRK-02, and CHR-10 stay unchecked until the owner verifies the physical and OBS parts.

## E — Entities

- `AppStatus`: adds optional `localAddresses: string[]` (max 8, IPv4 dotted form).
- Rust `Arg` (private, `tracking/parser.rs`): adds `Long(i64)`, `Double(f64)`, `Blob(Vec<u8>)`, `Time(u64)`, `Bool(bool)`, `Nil`, `Impulse`.
- Rust tracking (pure): `EndpointKey = { kind, bind_address, port }`; `endpointRoutes(sources) → { endpoints: Map<EndpointKey, Vec<(SourceId, Option<IpAddr>)>>, conflicts: Vec<(SourceId, first_source_name)> }`.
- Session: no new type. `setAvatarTracking` gets the R12 check.
- Editor (pure): `sourceOptions(entities, channel, avatarId)` returns `disabled` for a source that another avatar uses; `nextAvatarPosition(entities) → Vec3`.
- No change to the show format, `TrackingConfig`, `TrackingSample`, or `TrackingStatus`.

## A — Approach

Change the decoders first, with unit tests for each rule. Then the endpoint routing as a pure function, then the socket manager on top of it, with real UDP integration tests. Then the handshake retry and the local addresses. Then the session rule, the editor selects, and the character place. Then MCP descriptions and tests. Then a headless two-performer render with the fixture VRMs. Leave the physical sender, the phone, OBS, and the frame cost to the owner.

## S — Structure

- `apps/desktop/src-tauri/src/tracking/parser.rs` (type tags, tolerant addresses, skipped bones and keys), `tracking/mod.rs` (endpoint manager, routing, handshake retry), `tracking/endpoints.rs` (new, pure routing), `service/router.rs` (`localAddresses`).
- `apps/desktop/src-tauri/tests/clock_integration.rs` and a new `tests/tracking_integration.rs`.
- `crates/contracts/src/lib.rs` (`AppStatus`), `crates/contracts/tests/tracking.rs`; `packages/contracts/src/schema.ts` and its tests.
- `packages/session/src/scene-ops.ts` (R12); `packages/session/test/live-session.test.ts` or a new `two-performers.test.ts`.
- `apps/desktop/src/editor/live-fields.ts`, `authoring.ts`, `asset-management.ts`; `components/AvatarSourceFields.svelte`, `TrackingSourceFields.svelte`; desktop tests.
- `packages/renderer` headless test with two fixture VRMs.
- `apps/mcp/src/server.ts`; an MCP test for `setAvatarTracking`.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/tracking-receive-two-performers.md` (new).

## O — Operations

1. Parser: unit tests for each new type tag (size and padding), an ignored address with `T`, `d`, and `b` arguments, a `d` number in `Bone/Pos`, an unknown bone between two known bones (the known bones apply), a bundle that holds `Root/Pos`, `Bone/Pos`, `Blend/Val`, and `Blend/Apply`, a datagram of only unknown bones (not recognized), and an iFacialMocap packet with an unknown bone key. Each existing reject test still passes. Each new behavior has a test that fails on the old code.
2. Endpoints: unit tests for `endpointRoutes`: two iFacialMocap sources with two phone addresses share one endpoint; a source without an address conflicts; two equal addresses conflict; VMC and iFacialMocap on one port conflict; scene order picks the first source.
3. Host: real UDP integration tests (reason: the socket bind and route are the boundary). (a) VMC bytes (a bundle with `Root/Pos` and `Bone/Pos`) reach the credited clock as one sample. (b) A fake phone socket receives the exact handshake bytes after bind, again after about 2 s while no data comes, and no more after it sends one packet. (c) Two iFacialMocap sources on one port route by sender IP: the senders bind `127.0.0.1` and `127.0.0.2` on Linux. On a host where `127.0.0.2` cannot bind (macOS by default), the test returns early with a printed reason, and the pure routing tests (step 2) cover the rule. (d) Adding and removing a second source on a shared endpoint keeps the first source's generation and counters.
4. `localAddresses`: a unit test for the filter (loopback, link-local, down interfaces, the limit of 8, the sort) on plain data; the read of the interfaces uses the standard library or a crate that the workspace already has. If neither can list interfaces, the run asks the owner before it adds a dependency.
5. Session: tests for R12 (reject on the other avatar, accept body and face on one avatar, an old shared show still loads) and R15 (two avatars, four sources, one source stale, two independent poses).
6. Editor: tests for `sourceOptions` disabled values and `nextAvatarPosition`. Headless Chromium check of the editor flow: add a second character, see it at +1 m, assign sources, see the other character's sources disabled.
7. Renderer: headless render of the two fixture VRMs with two different poses; check that the head bone world rotations differ and that each expression changes only its own VRM.
8. MCP: R16 descriptions and a test that `scene_patch` with `setAvatarTracking` returns the R12 error.
9. Documents: the evidence file with the commit, platform, backend, each check and its raw result, and the gaps; parity notes for TRK-01, TRK-02, and CHR-10 with the verified subset only; `ARCHITECTURE.md` (R17).

## N — Norms

- Unit tests for the decoders, the routing, the address filter, the session rule, and the editor helpers. Integration tests only at the UDP boundary.
- UI copy is the control label only (constitution principle 1). The address list has no helper sentence. Controls come from `@oshi-connect/ui`.
- Functional TypeScript and plain data. Rust keeps the decoders free of socket state.
- Mock packets prove decoding and routing. They do not prove a physical phone or a VMC application.

## S — Safeguards

- Do not change the show format, the sample shape, the source limit (4), or the avatar limit (2).
- Do not act on network model paths or other remote commands. Do not add a VMC sender.
- Do not make an old show fail to load (R12).
- Do not send a handshake to an address other than the configured phone address.
- Do not add a new dependency without the owner (Operations 4).
- Do not claim a macOS, OBS, phone, or VMC application result. These stay for the owner: a real VMC sender (for example VSeeFace or VirtualMotionCapture on a Windows computer, or XR Animator) on port 39539 drives a character on macOS with no invalid packets; an iPhone with iFacialMocap that starts after OpenSekai connects through the handshake retry, with the address from the Inspector; two iPhones on port 49983 drive two characters; one source cannot be assigned to both characters in the editor; the two-performer frame cost at 60 fps in OBS with alpha; and continued motion of both characters while the editor is minimized.
