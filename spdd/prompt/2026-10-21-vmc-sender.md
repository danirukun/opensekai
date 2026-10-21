# REASONS: VMC sender

Analysis: [VMC sender](../analysis/2026-10-21-vmc-sender.md). Issue: [#67](https://github.com/danirukun/opensekai/issues/67) (MED-09). Queue bundle B21.

## R — Requirements

1. A scene can hold at most 4 entities of kind `vmcSender`. Each has the entity base (`id`, `name`, `visible`, `transform`) and `vmcSender: {enabled, address, port, avatarId}`. `enabled` is a boolean. `address` is an IPv4 or IPv6 address (the tracking `ip` rule). `port` is an integer from 1 to 65535. `avatarId` is an ID or `null`. When `avatarId` is not `null`, it must name an avatar entity in the scene, or the scene fails validation.
2. The patch operation `setVmcSender {entityId, vmcSender}` replaces the settings. It fails with `INVALID_INPUT` and the entity ID when the entity is not a VMC sender. `createEntity`, `renameEntity`, `removeEntity`, and `setVisibility` work as for the other kinds. `setTransform` on a sender fails with `INVALID_INPUT`, as for a tracking source. `removeEntity` of an avatar sets `avatarId` to `null` on each sender that names it, in the same patch, as it clears tracking references. A fifth sender makes the scene fail validation.
3. TypeScript and Rust validate the same shape, the same limit, and the avatar reference. The validation vectors (target `scene`) have a valid sender, a fifth sender, port 0, port 65536, a port that is not an integer, a bad address, and an `avatarId` that names no avatar. Target `call` has a valid and a wrong-shape `setVmcSender` patch.
4. The Add Asset menu has "VMC Sender". The new entity is named "VMC Sender", visible, with the identity transform, disabled, address `127.0.0.1`, port 39539, and the first avatar of the scene or `null`. One helper `vmcSenderLimitReached(entities)` disables the menu item and the Hierarchy Duplicate action at the limit, with the existing "Scene asset limit reached" title.
5. The Inspector of a sender shows Start or Stop (as the receivers), IP Address, Port, and Character (`Select` of the avatars and None). It shows the status state and the error text from `appStatus`, as the receivers do. It has no Transform section. Reset to default (B17) uses the values in requirement 4. The Hierarchy shows senders in a new group "VMC Senders", after "VMC Receivers", with one icon from the existing icon set.
6. An avatar `AssetRecord` gets an optional `rig: {metaVersion: '0' | '1', restPositions: Record<string, Vec3>}` (keys from `HUMANOID_BONES`). `restPositions` holds the glTF local translation of each humanoid bone node that the VRM names (at most 55). The VRM import fills it. At startup the registry fills it for each avatar record that does not have it, from the stored file, and writes the record again with the existing atomic write. A failure leaves the record without `rig` and logs the asset ID. TypeScript and Rust validate the same shape.
7. The session makes the sent pose with one pure function `vmcSendPose(pose, rig)`. For each humanoid bone in `rig.restPositions`:
   - The rotation starts at identity, takes the `baseBones` rotation, then slerps to the `bones` rotation by its `weight` (default 1). A `normalized` value gets the VRM 0 sign `(-x, y, -z, w)` when `rig.metaVersion` is `'0'`. A `raw` value is used as it is. Then the `boneOffsets` rotation multiplies on the left, with the same sign rule. This is the order of `avatar-pose.ts`.
   - The position is the rest position. For `hips` only, a pose position adds to it: a `normalized` position with the VRM 0 sign `(-x, y, -z)` when the version is `'0'`, or a `raw` position that replaces the rest position.
   - When `rig.restPositions` has no `chest`, the `chest` rotation multiplies into `spine` on the right, as `resolveChest` does.
   The result is `{root, bones, blends}` in the OpenSekai (three.js, right-handed) convention of the raw rig. `root` is the pose root or the identity at the origin. `blends` is `pose.expressions` with the VRM 1 preset names changed to the VRM 0 clip names: the reverse of the preset part of the renderer alias table (`happy` to `Joy`, `angry` to `Angry`, `sad` to `Sorrow`, `relaxed` to `Fun`, `aa` to `A`, `ih` to `I`, `ou` to `U`, `ee` to `E`, `oh` to `O`, `blink` to `Blink`, `blinkLeft` to `Blink_L`, `blinkRight` to `Blink_R`). Other names do not change.
8. On each tick that makes a frame, when the scene has an enabled sender whose avatar has a pose and a record with `rig`, the session sends one `vmcPoses` envelope to the host after the frame: `{kind: 'vmcPoses', sessionId, tick, poses: [{senderId, root, bones, blends}]}`, at most 4 poses, one for each such sender. When no sender qualifies, it sends nothing. The envelope is never part of the frame and never goes to a renderer.
9. The host accepts `vmcPoses` only from the publisher connection, with the same byte limit as a frame. It checks the shape with the Rust mirror. It drops a pose whose `senderId` is not an enabled sender of the latest accepted scene, or whose sender has an error.
10. The host sender manager (`apps/desktop/src-tauri/src/vmc_sender.rs`) reads the senders on each accepted scene revision, as the tracking manager reads the sources. For each enabled sender it binds one UDP socket on the unspecified address of the target family, port 0. A bind error puts the sender in `error` with the text. A disabled or removed sender closes its socket.
11. Loop guard: a sender is in `error` with "Endpoint used by <name>" and sends nothing when an enabled VMC receiver in the same scene has the same port and the sender address is a loopback address, the unspecified address, or the receiver bind address. The pure function `sender_conflicts` makes this check and has unit tests.
12. Encoding: the host converts each value to Unity with the exact inverse of the decoder in `parser.rs`: position `(x, y, -z)`, rotation `(-x, -y, z, w)`. Bone names are the VRM 0 / Unity names that the decoder accepts, with the decoder thumb mapping reversed (`leftThumbMetacarpal` to `LeftThumbProximal`, `leftThumbProximal` to `LeftThumbIntermediate`, and the same on the right) and the first letter in upper case. Each datagram is one OSC bundle (`#bundle`, time tag 1) of at most 1,200 bytes and at most 32 messages. The first bundle starts with `/VMC/Ext/OK 1` (`i`) and `/VMC/Ext/T <seconds since the sender started>` (`f`), then `/VMC/Ext/Root/Pos`. Then `/VMC/Ext/Bone/Pos` for each bone, in `HUMANOID_BONES` order. Then `/VMC/Ext/Blend/Val` for each blend, in name order. The last bundle ends with `/VMC/Ext/Blend/Apply`. Floats are `f`.
13. Rate: the host sends at most one pose each 1/60 s for each sender. It drops a pose that comes earlier. A send error counts in `errors` and does not stop the sender.
14. `appStatus` gets an optional `vmcSenders: [{entityId, state, datagrams, errors, error}]`, at most 4. `state` is `stopped`, `waiting`, `sending`, or `error`. `waiting` means enabled, with no pose in the last 1 s. `sending` means a pose was sent in the last 1 s. `datagrams` and `errors` are counts since the sender started. TypeScript and Rust check the same shape.
15. Round trip: the bytes that the encoder makes for a pose decode with the OpenSekai VMC decoder to the same raw bones (rotation within 1e-6, position within 1e-6), the same root, and the same blends after the decoder aliases. A unit test proves it for bones, thumbs, root, blends, and a pose that needs more than one datagram.
16. MCP `scene_patch` documents `createEntity` with kind `vmcSender`, `setVmcSender`, the fields, the limit, and that the sender starts disabled. `app_status` returns `vmcSenders`. No new MCP tool.
17. Known gaps, not in this slice: **Send to VirtualMotionCapture**, **Calibrating (VirtualMotionCapture)**, VMC tracker, HMD, controller, camera, and light addresses, a warning for a rig with initial bone rotations that are not 0, and Windows.

## E — Entities

- `VmcSenderSettings`: `{enabled: boolean, address: string, port: number, avatarId: Id | null}` (zod `VmcSenderSettingsSchema`, Rust `VmcSenderSettings`).
- `SceneEntity` gains `{kind: 'vmcSender', vmcSender: VmcSenderSettings}` on the entity base. `LIMITS.vmcSenders = 4`.
- `PatchOp` gains `{kind: 'setVmcSender', entityId, vmcSender}`.
- `AvatarRig`: `{metaVersion: '0' | '1', restPositions: Record<string, Vec3>}`, keys from `HUMANOID_BONES`. `AssetRecord.rig?: AvatarRig`.
- `VmcSendPose`: `{senderId: Id, root: {position: Vec3, rotation: Quat}, bones: Record<string, {position: Vec3, rotation: Quat}>, blends: Record<string, number>}`. At most 55 bones and 64 blends.
- `VmcPosesEnvelope`: `{kind: 'vmcPoses', sessionId: Id, tick: number, poses: VmcSendPose[]}` (at most 4).
- `VmcSenderStatus`: `{entityId: Id, state: 'stopped' | 'waiting' | 'sending' | 'error', datagrams: number, errors: number, error: string | null}`.

## A — Approach

- Contracts: add the schemas, the limit and avatar reference checks in the `SceneViewSchema` refine, the patch operation, the record field, the envelope, and the status field. Add the Rust mirror and the vectors.
- Session: one `setVmcSender` case in `scene-ops.ts`; `setTransform` rejects the kind; `removeEntity` clears the avatar reference. A new `packages/session/src/vmc-send.ts` holds `vmcSendPose` and `vmcPosesFor(scene, poses, records)`. The worker sends the envelope after the frame on the publisher connection.
- Renderer: add `vmcSender` to the kinds without a scene object (the `wanted` filter, the `continue` with `tracking`, and the screenshot `show` exclusions), as `fpsCounter` does.
- Host import: `assets/vrm.rs` reads the version and the rest translations from the JSON that it already parses. `assets/registry.rs` fills `rig` at startup for older avatar records.
- Host send: `vmc_sender.rs` owns the plan, the sockets, the rate cap, the counters, and the status. The encoder functions (`encode_vmc_pose`, the inverse conversion, the bundle split) go in `tracking/parser.rs` next to the decoder, or in a new `tracking/osc_out.rs` that the round-trip test can call with the decoder. The service routes `vmcPoses` from the publisher to the manager and adds the status to `appStatus`. `ARCHITECTURE.md` gets a VMC send path.
- Editor: add the kind to `live-fields.ts` (`AddKind`), `authoring.ts`, `model.ts` (`setVmcSender`), a small `vmcSenderLimitReached` helper, `property-defaults.ts`, `inspector-sections.ts`, `asset-groups.ts` (the "VMC Senders" group), `Hierarchy.svelte` (Add menu, Duplicate limit, icon), `Inspector.svelte`, and a new `VmcSenderFields.svelte` that uses the kit `Button`, `Input`, and `Select`, as `TrackingSourceFields.svelte` does.

## S — Structure

- New: `packages/session/src/vmc-send.ts`, `packages/session/test/vmc-send.test.ts`, `packages/session/test/vmc-sender-patch.test.ts`, `apps/desktop/src-tauri/src/vmc_sender.rs`, `apps/desktop/src/components/VmcSenderFields.svelte`, `apps/mcp/test/vmc-sender.integration.test.ts`, `crates/contracts/tests/vmc_sender.rs`.
- Changed: `packages/contracts/src/schema.ts`, `tracking.ts`, `types.ts`, and their tests; `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`; `packages/session/src/scene-ops.ts` and the worker publish path; `packages/renderer/src/renderer.ts`; `apps/desktop/src-tauri/src/assets/vrm.rs`, `assets/registry.rs`, `tracking/parser.rs` (or the new `tracking/osc_out.rs`), `service/mod.rs`, `service/router.rs`, `lib.rs`; the editor files in the approach and the `asset-groups` test; `apps/mcp/src/server.ts`.
- Changed: `ARCHITECTURE.md` (processes diagram: the host sends VMC over UDP; a new "VMC send path" section; the asset record `rig` field).
- Changed: `docs/warudo-parity.md` MED-09 with only the verified behavior.
- No change: the renderer pose code, the OBS page, Tauri IPC, the tracking receive path.

## O — Operations

1. Add the contract shapes, the Rust mirror, and the vectors. Run the vector tests on both sides.
2. Add `setVmcSender` to the session with unit tests: replace, wrong kind, `setTransform` rejected, fifth sender rejected, avatar removal clears the reference.
3. Add `rig` to the import and the startup fill. Add Rust unit tests for a VRM 0 and a VRM 1 JSON (version, rest translations, a rig without `chest`) and for the fill of an older record. Check both fixture VRM files when the `fixtures:` line lists them.
4. Add `vmc-send.ts` with unit tests: base only, weighted tracking, raw bones unchanged, VRM 0 sign, offsets on the left, hips position for each space, chestless rig, preset name map, no envelope without an enabled sender or `rig`.
5. Add the encoder with unit tests: the inverse conversion, the thumb names, the bundle split at 1,200 bytes and 32 messages, `OK` and `T` first, `Blend/Apply` last. Add the round-trip test of requirement 15. Add `sender_conflicts` tests.
6. Add the host manager with an integration test over real loopback UDP: a test socket receives the datagrams of an enabled sender, the decoder reads the pose, the rate cap holds under a burst of 10 poses, a disabled sender sends nothing, a loop target gets the error, and `appStatus` shows the states. State why it is an integration test: it crosses a real UDP socket.
7. Add the editor kind, the Inspector fields, the Hierarchy icon, and the reset defaults.
8. Add the MCP integration test: `createEntity` of a sender, `setVmcSender`, a fifth sender fails, `removeEntity` of the avatar clears the reference, `app_status` lists the sender.
9. Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo fmt --check`, `cargo clippy`, and `cargo test --workspace`.
10. Run a headless browser check on the software adapter with each fixture VRM: apply a pose with base, normalized, raw, and offset bones in the renderer, read the raw bone local rotations and the hips position, and compare them with `vmcSendPose` (rotation within 1e-4).
11. Run the Editor flow headless where WebGL works: Add › VMC Sender, set IP Address, Port, and Character, Start, see `waiting` or `sending`, Stop, reset Port, Duplicate is disabled at the limit. If the flow cannot run headless, the parity line stays partial and names the flow that is not checked.
12. Ask a reviewer on a different model for defects against these requirements.
13. Update the parity line with the source commit, the platform, the tests, and the remaining gaps. Update `ARCHITECTURE.md`.

## N — Norms

Functional TypeScript and plain data. Match the compact style of the tracking and haze files. Rust matches `tracking/`. Controls come from `@oshi-connect/ui`. UI copy is the menu item, the four field labels, Start and Stop, and the existing state and error texts, with no helper text (constitution principle 1). No pill, badge, or card for the status (principle 2). Prose follows ASD-STE100.

## S — Safeguards

- Do not send from a renderer, the Scene preview, or the OBS page. The send path is session to host to UDP.
- Do not put `vmcPoses` into a frame or relay it to a renderer or an operator.
- Do not start a new sender enabled. Do not send to an address that the operator did not set.
- Do not send into an enabled VMC receiver of the same app (requirement 11).
- Do not send zero positions in place of rest positions. A sender without `rig` waits and sends nothing.
- Do not add a new crate for OSC. The decoder already reads OSC; the encoder sits next to it.
- Do not claim MED-09 on macOS, with a real VMC application, or on Windows from the cloud run. A real receiver and the send cost need an owner check (`accept:local`).
