# REASONS: Tracking receive and two performers

Date: 2026-10-18. Scope: bundle B5 (#18 TRK-01 first subset, #19 TRK-02 first subset, #16 CHR-10 first subset for two performers). Analysis: [tracking receive and two performers](../analysis/2026-10-18-tracking-receive-two-performers.md). Related: [minimum live VTubing](2026-10-03-minimum-live-vtubing.md), [One Euro filter](2026-10-04-one-euro-filter.md), [tracking smoothing controls](2026-10-04-tracking-smoothing-controls.md).

This file is the contract only. The implementation run starts after the owner merges it. The [Warudo VMC](https://docs.warudo.app/docs/mocap/vmc), [iFacialMocap](https://docs.warudo.app/docs/mocap/ifacialmocap), [Motion capture overview](https://docs.warudo.app/docs/mocap/overview), and [Character](https://docs.warudo.app/docs/assets/character) pages were read on 2026-10-18. The rules of the minimum live contract stay in force unless a requirement below changes them.

## Subset

This slice delivers and verifies these subsets. The parity notes use these words.

- **TRK-01 first subset:** VMC receive that accepts extra OSC data and unknown bones from a real sender, on a dedicated or a shared endpoint. Not in it: VMC tracker, HMD, controller, camera, and light addresses, bundle timetags, calibration and offsets (TRK-05), VMC sending (MED-09).
- **TRK-02 first subset:** iFacialMocap v2 UDP receive with a repeated handshake, the computer addresses in the Inspector, and two phones on one port. Not in it: head translation, Body Movement Intensity, Calibrate iFacialMocap (B6), TCP modes, FaceMotion3D (TRK-03).
- **CHR-10 first subset:** two characters, each with its own body and face sources, with no accidental shared source. Not in it: more than 2 characters, more than 4 sources, tracking Blueprints.

## R — Requirements

### VMC receive (TRK-01)

R1. The OSC reader accepts these type tags with OSC 1.0 sizes: `i` and `f` (4 bytes), `h`, `d`, and `t` (8 bytes), `s` (a string padded to 4 bytes), `b` (an int32 length, then the bytes padded to 4; a negative length or a length past the end rejects), and `T`, `F`, `N`, and `I` (no bytes). Each other tag (for example `c`, `r`, `m`, `S`, `[`, `]`) rejects the whole datagram, also in an address that the receiver ignores, because the reader cannot know its size. Bad padding, truncation, trailing bytes, or a non-finite `f` or `d` also reject the whole datagram. The limits do not change (8 KiB, depth 4, 64 messages).
R2. An address that the receiver does not handle never rejects a datagram when its tags are known (R1). A number argument of a handled address can be `f`, `d`, or `i`. The other argument rules of `Root/Pos`, `Bone/Pos`, `Blend/Val`, `Blend/Apply`, `OK`, and `T` do not change.
R3. The decoder checks each `Bone/Pos` first: 8 arguments, a string name, and a finite pose with a valid quaternion. A malformed `Bone/Pos` rejects the datagram as today. Then, when the name after the existing first-letter and thumb mapping is not a humanoid bone, the decoder skips the message; the other messages of the datagram apply. A skipped bone does not count toward the limit of 64 bones. A datagram that holds only skipped bones and no other handled data returns "not recognized" and does not publish a sample.
R4. Coordinate conversion, Apply boundaries, the bone and expression limits, and the hold and fade rules do not change.

### iFacialMocap receive (TRK-02)

R5. The decoder checks each iFacialMocap bone field first (the `name#values` form and finite numbers). Then a field with a key other than `head`, `leftEye`, or `rightEye` is skipped; the other fields apply. The value rules of the known keys do not change. The head translation stays discarded.
R6. When `phoneAddress` is set, the host sends the v2 handshake from the endpoint socket (so the phone answers to that socket) to phone port 49983, after bind. It sends it again when at least 2000 ms passed since the last send and the source has no packet in the last 500 ms (the host's own receipt time, as `snapshot` uses for `stale`). It stops when the source is stopped, removed, or replaced by a new generation. A send error is transient: the host keeps the retry, and it does not change the source state. Each iFacialMocap source on a shared endpoint (R8) has its own retry to its own phone address.
R7. `AppStatus` gets an optional `localAddresses: string[]`, as `trackingStatus` is optional: the IPv4 addresses of the up, non-loopback, non-link-local interfaces of this computer, at most 8, in numeric order. TypeScript and Rust accept and write the same shape; a missing field means an empty list. The host and its clients ship in one app, so the strict schemas change together. The host reads the interfaces with the `if-addrs` crate (a new direct dependency of `apps/desktop/src-tauri`; the owner approves it by merging this contract). The iFacialMocap receiver Inspector shows the addresses, as Warudo does on the receiver. When the list is empty, the Inspector shows nothing for it.

### Shared endpoint (TRK-01, TRK-02, CHR-10)

R8. Two sources overlap when they have the same `port` and their bind addresses are equal or one of them is `0.0.0.0`. Overlapping enabled sources of the same kind (VMC or iFacialMocap) share one endpoint when each has a different non-null sender address (VMC `senderAddress`, iFacialMocap `phoneAddress`). The host binds one socket for the endpoint, on the first bind address. Each datagram goes to the source whose address equals the sender IP, before parsing. A datagram from another IP goes to no source; the endpoint counts it in `unmatchedPackets` on each of its sources, so the Inspector diagnostics show why nothing arrives. Each source keeps its own decoder, generation, packet counters, status, and sample. A source with no overlap works as today, also with no address.
R9. Overlapping enabled sources that cannot share (different kinds, a source with no address, or two sources with the same address) conflict. The source that already holds the endpoint wins. On a cold start (no holder), the first source in scene order wins. Each other source gets the state `error` with the message "Endpoint used by <name of the winner>".
R10. Reconcile works from the endpoint plan (`endpointRoutes`), not only from a change of the source's own config. Thus a source in `error` because of a conflict or a failed bind tries again on each accepted revision when the plan gives it an endpoint. A source that joins or leaves a shared endpoint does not reset the other sources on it (their generation, counters, sample, and handshake retry stay). The socket closes when the last source leaves the endpoint.
R11. The routing is a pure function `endpointRoutes(sources, holders) → { endpoints, conflicts }` in the tracking module, with unit tests on each platform.

### Two performers (CHR-10)

R12. A `scenePatch` fails with `INVALID_INPUT` and the IDs of the avatars when its end state has a source that two avatars use (as body or face source) and its start state did not have that pair. The check uses the end state, so it covers `setAvatarTracking`, `createEntity` of an avatar with `tracking`, and a swap of sources in one patch. One avatar can use one source for both body and face. A share that already exists in an old show stays valid, also when a patch changes other fields of those avatars. `sceneReplace` and show load keep the current rules, so an old show still loads and runs. MCP reaches the rule through `scene_patch`.
R13. The Body source and Face source selects of a character disable each source that the other character uses. The current value of the select stays enabled.
R14. Add Character puts a new character at world position (x + 1, y, z), where (x, y, z) is the position of the last avatar in scene order, with that avatar's rotation. With no avatar, it uses the world origin as today. Duplicate of a character sets the copy position with the same rule (it does not keep the copied position). Duplicate still clears the copied assignment. A camera that follows a character does not move.
R15. With two avatars and four sources, the session produces two poses, each from its own sources only. A stale or stopped source of one avatar does not change the pose of the other. The renderer applies each pose to its own VRM instance only (bones, expressions, and root). The run adds a renderer test for this; no current test covers two VRM instances.

### MCP and documents

R16. The `scene_patch` tool description in `apps/mcp` names `createEntity` for a tracking source, `setTrackingConfig`, `setAvatarTracking`, and `setTrackingSmoothing`. The `app_status` description names `localAddresses`. No tool is added.
R17. `ARCHITECTURE.md` gets a short **Tracking path** section: receiver sockets and shared endpoints in the host, the credited clock, the session composer, and the renderer binding. `docs/warudo-parity.md` records the Subset words with the verified checks only. TRK-01, TRK-02, and CHR-10 stay unchecked until the owner verifies the physical and OBS parts. The evidence file follows the change evidence rows of `docs/qa.md`.

## E — Entities

- `AppStatus`: adds optional `localAddresses: string[]` (max 8, IPv4 dotted form).
- `TrackingStatus`: adds optional `unmatchedPackets: number` (R8). A missing field means 0.
- Rust `Arg` (private, `tracking/parser.rs`): adds `Long(i64)`, `Double(f64)`, `Blob(Vec<u8>)`, `Time(u64)`, `Bool(bool)`, `Nil`, `Impulse`.
- Rust tracking (pure): `Endpoint = { kind, bind_address, port }`; `endpointRoutes(sources, holders) → { endpoints: Vec<(Endpoint, Vec<(SourceId, Option<IpAddr>)>)>, conflicts: Vec<(SourceId, winner_name)> }`.
- Session: no new type. `applyPatch` gets the R12 end-state check.
- Editor (pure): `sourceOptions(entities, channel, avatarId)` returns `disabled` for a source that another avatar uses; `nextAvatarPosition(entities) → Vec3`.
- No change to the show format, `TrackingConfig`, or `TrackingSample`.

## A — Approach

Change the decoders first, with unit tests for each rule. Then the endpoint routing as a pure function, then the socket manager on top of it, with real UDP integration tests. Then the handshake retry and the local addresses. Then the session rule, the editor selects, and the character place. Then MCP descriptions and tests. Then a headless two-performer render. Leave the physical sender, the phone, OBS, and the frame cost to the owner.

## S — Structure

- `apps/desktop/src-tauri/src/tracking/parser.rs` (type tags, tolerant addresses, skipped bones and keys), `tracking/endpoints.rs` (new, pure routing), `tracking/mod.rs` (endpoint manager, handshake retry, unmatched count), `service/router.rs` (`localAddresses`), `Cargo.toml` (`if-addrs`).
- `apps/desktop/src-tauri/tests/clock_integration.rs` and a new `tests/tracking_integration.rs`.
- `crates/contracts/src/lib.rs` and `tracking.rs` (`AppStatus`, `TrackingStatus`), `crates/contracts/tests/tracking.rs`; `packages/contracts/src/schema.ts` and `tracking.ts` and their tests.
- `packages/session/src/scene-ops.ts` (R12); `packages/session/test/two-performers.test.ts` (new).
- `apps/desktop/src/editor/live-fields.ts`, `authoring.ts`, `asset-management.ts`, `tracking-diagnostics.ts`; `components/AvatarSourceFields.svelte`, `TrackingSourceFields.svelte`, `TrackingAdvanced.svelte`; desktop tests.
- `packages/renderer/test/avatar-pose.test.ts` or a new headless test with two VRM instances.
- `apps/mcp/src/server.ts`; an MCP test for `setAvatarTracking`.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/tracking-receive-two-performers.md` (new).

## O — Operations

1. Parser: unit tests for each new type tag (size, padding, a bad blob length), an ignored address with `T`, `d`, and `b` arguments, an ignored address with an unknown tag (rejects), a `d` number in `Bone/Pos`, an unknown bone between two known bones (the known bones apply), a malformed unknown bone (rejects), 64 known bones plus unknown bones (accepts), a bundle that holds `Root/Pos`, `Bone/Pos`, `Blend/Val`, and `Blend/Apply`, a datagram of only unknown bones (not recognized), and an iFacialMocap packet with an unknown bone key. `parser_rejects_truncation_unknown_bones_and_nonfinite` loses its unknown-bone and unknown-key cases, which the new skip tests replace; its other cases stay. Each new behavior has a test that fails on the old code.
2. Endpoints: unit tests for `endpointRoutes`: two iFacialMocap sources with two phone addresses share one endpoint; `0.0.0.0` and `127.0.0.1` on one port overlap; a source with no address conflicts only on an overlap; two equal addresses conflict; VMC and iFacialMocap on one port conflict; a holder keeps the endpoint when an earlier source in scene order joins; scene order picks the winner on a cold start; a source in `error` gets the endpoint when the holder leaves.
3. Host: real UDP integration tests (reason: the socket bind and route are the boundary). (a) VMC bytes (a bundle with `Root/Pos` and `Bone/Pos`) reach the credited clock as one sample. (b) A fake phone socket receives the exact handshake bytes from the endpoint port after bind, and again after the retry time while no data comes, and no more while packets arrive. The test uses tokio paused time or an injected clock, and checks that the gap is at least 2000 ms. (c) Two iFacialMocap sources on one port route by sender IP: the senders bind `127.0.0.1` and `127.0.0.2`. The test is Linux only (`#[cfg(target_os = "linux")]`); on Linux a failed bind of `127.0.0.2` fails the test. The evidence file says that the shared-endpoint real UDP check ran on Linux only, and that macOS has the pure routing tests and the owner check. (d) Adding and removing a second source on a shared endpoint keeps the first source's generation, counters, and handshake retry. (e) A source that failed to bind binds on the next revision after the port is free.
4. `localAddresses`: a unit test for the filter (loopback, link-local, down interfaces, the limit of 8, numeric order) on plain data.
5. Session: tests for R12 (a new share in `setAvatarTracking`, in `createEntity`, and in a swap patch fails; body and face on one avatar passes; an old show with a share loads and accepts a patch that changes another field) and R15 (two avatars, four sources, one source stale, two independent poses).
6. Editor: tests for `sourceOptions` disabled values and `nextAvatarPosition`. Headless Chromium check of the editor flow: add a second character, see it at +1 m, assign sources, see the other character's sources disabled.
7. Renderer: a headless test with two instances of `fixture_vrm_1` (public) and two different poses: the head bone world rotations differ, and an expression on one changes only its own expression weights. When `fixture_vrm0_arkit` is ready (private bucket), the same test checks an ARKit morph on one instance only; when it is not ready, the evidence file says so.
8. MCP: R16 descriptions and a test that `scene_patch` with `setAvatarTracking` returns the R12 error.
9. Documents: the evidence file with the commit, platform, backend, each check and its raw result, and the gaps; parity notes (R17); `ARCHITECTURE.md` (R17).

## N — Norms

- Unit tests for the decoders, the routing, the address filter, the session rule, and the editor helpers. Integration tests only at the UDP boundary.
- UI copy is the control label only (constitution principle 1). The address list has no helper sentence. Controls come from `@oshi-connect/ui`.
- Functional TypeScript and plain data. Rust keeps the decoders and the routing free of socket state.
- Mock packets prove decoding and routing. They do not prove a physical phone or a VMC application.

## S — Safeguards

- Do not change the show format, the sample shape, the source limit (4), or the avatar limit (2).
- Do not act on network model paths or other remote commands. Do not add a VMC sender.
- Do not make an old show fail to load (R12).
- Do not send a handshake to an address other than the configured phone address.
- Do not add a dependency other than `if-addrs`.
- Do not claim a macOS, OBS, phone, or VMC application result. These stay for the owner: a real VMC sender (for example VSeeFace or VirtualMotionCapture on a Windows computer, or XR Animator) on port 39539 drives a character on macOS with no invalid packets; an iPhone with iFacialMocap that starts after OpenSekai connects through the handshake retry, with the address from the Inspector; the port that the phone sends to (49983, or the handshake source port); two iPhones on one port drive two characters; one source cannot be assigned to both characters in the editor; the two-performer frame cost at 60 fps in OBS with alpha; and continued motion of both characters while the editor is minimized.
