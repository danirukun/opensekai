# VMC sender analysis

Issue: [#67](https://github.com/danirukun/opensekai/issues/67) (MED-09). Queue bundle B21. Mode: contract-first. Contract: [VMC sender](../prompt/2026-10-21-vmc-sender.md).

## Problem

An operator wants to send the pose of an OpenSekai character to another application through the VMC protocol. Examples: a second VTubing application, a recorder, a VR overlay, or a second OpenSekai computer. Today OpenSekai only receives VMC (TRK-01). It cannot send.

## Sources

- [Warudo VMC Sender](https://docs.warudo.app/docs/assets/vmc-sender), read 2026-10-21. The asset sends the animation data of one character to software that supports the VirtualMotionCapture protocol. Its properties are **IP Address**, **Port**, **Character**, **Send to VirtualMotionCapture** ("must be enabled due to a bug in VirtualMotionCapture when parsing animation data"), and **Calibrating (VirtualMotionCapture)** (on during T-pose calibration in VirtualMotionCapture, then off). The page gives no defaults. A caution says that each initial bone rotation of the model must be 0; VRM models usually comply, and a model that was exported without **Enforce T-Pose** must be exported again.
- [Warudo asset overview](https://docs.warudo.app/docs/assets/overview), read 2026-10-21. **VMC Sender** is an asset in the Add Asset catalog, next to Music Player and Screen.
- [Warudo VMC](https://docs.warudo.app/docs/mocap/vmc), read 2026-10-18 for B5: the default VMC port is 39539.
- [Tracking receive contract](../prompt/2026-10-18-tracking-receive-two-performers.md) and `apps/desktop/src-tauri/src/tracking/parser.rs`: the OpenSekai VMC decoder and its Unity conversion.

## Existing material

- **Pose data.** The session makes one `AvatarPose` for each avatar on each tick (`packages/contracts/src/tracking.ts`). A pose has `baseBones` (idle, normalized space), `bones` (tracking, `normalized` or `raw` space, with an optional `weight`), `expressions`, an optional `root`, and `boneOffsets` (Blueprint layer, normalized frame). The frame carries the poses to the host and the host relays them to the renderers.
- **Final pose.** Only the renderer makes the final bone transforms (`packages/renderer/src/avatar-pose.ts`). It needs the loaded VRM: the rest transform of each raw bone, the VRM version (VRM 0 normalized rotations get the sign `(-x, y, -z, w)`), and the chest of the rig.
- **VMC decode.** `parser.rs` reads `Bone/Pos` and `Root/Pos` as Unity values. It converts them with position `(x, y, -z)` and rotation `(-x, -y, z, w)`. It stores bones as `raw` with a position. The renderer puts the position and the rotation on the raw node. Thus a VMC position is the absolute local position of the bone, not a delta. A sender that sends zero positions collapses the skeleton in an OpenSekai receiver.
- **Asset records.** `assets/vrm.rs` reads the VRM JSON at import and keeps the expression names in the `AssetRecord`. The Scene window gives the record list to the session worker. The record has no rest pose data.
- **Clock and minimize.** The host clock drives the session tick, not `requestAnimationFrame`. The Scene preview uses `requestAnimationFrame` and stops when its window is hidden. Thus a sender in the preview renderer stops when the Scene window is minimized. A sender in the session and the host does not stop.
- **UDP send.** The host already sends a UDP datagram from Rust (the iFacialMocap handshake in `tracking/mod.rs`). The web clients cannot send UDP.
- **Status.** The host answers `appStatus` itself and returns `trackingStatus` and `localAddresses`.

## Findings

1. The send path must not use a renderer. The renderer is the only part that knows the final pose, but the preview stops when the Scene window is hidden, and the OBS page is not under app control. The session runs on the host clock, so a sender that uses session data keeps sending when a window is minimized.
2. The session can make the sent pose from the `AvatarPose` and a small amount of rest data for the model: the VRM version, and the rest local position of each humanoid bone. With the Warudo rule (each initial bone rotation is 0), a normalized rotation is also the local rotation of the raw bone, after the VRM 0 sign. A raw bone from a VMC receiver is already a raw local rotation.
3. The rest positions are in the VRM file. The host can read them at import with the same JSON read as the expression names. An older record does not have them.
4. The sender must be the inverse of the OpenSekai decoder. Then OpenSekai to OpenSekai is a round trip that a Linux test can prove without another application.
5. One full pose is more than one small datagram: up to 55 bones, 1 root, up to 64 blend values, and `Blend/Apply`. The OpenSekai decoder takes at most 64 messages and 8 KiB in one datagram. A LAN path is safer with datagrams under the Ethernet MTU.
6. The default VMC port is 39539. The OpenSekai VMC receiver also uses 127.0.0.1:39539 by default. A sender with the default target and an enabled receiver with the default endpoint in the same scene makes a loop.
7. **Send to VirtualMotionCapture** and **Calibrating** are workarounds for one Windows application. The cloud cannot check them, and the owner works on macOS first.
8. A new entity kind changes the show format: an older build rejects a show that holds a sender. `schemaVersion` stays 1, as for `haze` and `fpsCounter`, because each older show stays valid.

## Questions resolved without the owner (reversible)

The owner reviews these in the contract pull request before code exists.

- **Scene entity.** The sender is an entity of kind `vmcSender`, saved in the show, in the Add Asset menu, as in Warudo. Alternative: an app preference. Rejected because Warudo saves it with the scene and a show can need a different target.
- **Fields.** Enabled, IP Address (IPv4 or IPv6, default `127.0.0.1`), Port (1 to 65535, default 39539), and Character (an avatar ID or none). The sender starts disabled. Alternative: the Warudo fields with no Enabled switch. Rejected because the tracking receivers have Start and Stop, and a sender that starts at once can send into a loop.
- **Pose source.** The session resolves the sent pose (finding 2) and sends it to the host in a new publisher envelope `vmcPoses`, once for each tick, only when an enabled sender has a character. The host never relays the envelope. Alternative: the host resolves the pose from the frame in Rust. Rejected because it duplicates the TypeScript pose composition in a second language. Alternative: the Scene preview renderer reads the final bones. Rejected by finding 1.
- **Rest data.** The VRM import adds an optional `rig: {metaVersion, restPositions}` to the avatar `AssetRecord`. The registry adds it to an older avatar record at startup from the stored file. Alternative: send rotations with zero positions. Rejected by the decoder finding.
- **Unity conversion in Rust.** The session sends raw-frame values in the OpenSekai (three.js) convention. The host applies the exact inverse of the decoder conversion next to it in `parser.rs`. Thus one file holds both directions and one test proves the round trip.
- **Datagrams.** One OSC bundle in each datagram, at most 1,200 bytes and at most 32 messages. The first bundle starts with `/VMC/Ext/OK 1` and `/VMC/Ext/T <seconds>`, then `Root/Pos`. Then the bones. Then `Blend/Val` for each expression. The last bundle ends with `Blend/Apply`. Alternative: one large bundle. Rejected by finding 5.
- **Rate.** At most 60 poses each second for each sender. The host drops a pose that comes earlier than 1/60 s after the last sent pose for that sender. Alternative: the session tick rate without a cap.
- **Expression names.** The sender sends the expression names of the pose. It changes the VRM 1 preset names to the VRM 0 clip names that VMC applications use (`happy` to `Joy`, `aa` to `A`, `blink` to `Blink`, and the other presets in the renderer alias table, in reverse). ARKit names go out unchanged. Alternative: the names without a change.
- **Root.** `Root/Pos` carries the pose root of the character (tracking root motion), not the entity transform in the scene. Alternative: the entity world transform. Rejected because a receiver places its own model.
- **Loop guard.** A sender gets the error "Endpoint used by <name>" and does not send when its target port equals the port of an enabled VMC receiver in the same scene and its target address is a loopback address, the unspecified address, or the receiver bind address. Alternative: no guard.
- **Limit.** At most 4 VMC senders in a scene. Two senders can send one character to two targets.
- **Status.** `appStatus` gets an optional `vmcSenders` list: `{entityId, state, datagrams, errors, error}`. `state` is `stopped`, `waiting` (enabled, but no character, no pose, or no rest data), `sending`, or `error`. The sender Inspector shows the state and the error text only, as the receivers do.
- **Not in this slice.** **Send to VirtualMotionCapture**, **Calibrating (VirtualMotionCapture)**, VMC tracker, HMD, controller, camera, and light addresses, a VMC sender that sends the editor camera, and a receive of the same pose by the same app.

## Risks

- The session composition repeats part of the renderer composition (base, weighted tracking, offsets). The two can drift. A headless browser check compares the session result with the renderer normalized pose for the fixture VRM files.
- A rig with initial bone rotations that are not 0 sends a wrong pose. Warudo has the same rule. The Inspector does not warn about it in this slice.
- A chestless rig: the renderer moves the chest rotation to the spine. The session does not know the rig chest from the record unless `restPositions` has no `chest`; the contract uses that key.
- A wrong target address sends UDP data to another computer on the network. The sender starts disabled and sends only to the address that the operator types.
- The cloud has no other VMC application. Only the OpenSekai round trip and the byte format are checked in the cloud. A real receiver (VSeeFace or VirtualMotionCapture on another computer, or a second OpenSekai) needs an owner check on macOS (`accept:local`).
- The send cost at 60 poses each second for 4 senders is unknown until the owner measures it.
