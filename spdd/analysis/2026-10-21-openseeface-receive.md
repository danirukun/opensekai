# OpenSeeFace receive analysis

Issue: [#25](https://github.com/danirukun/opensekai/issues/25) (TRK-08). Queue bundle B20. Mode: contract-first. Date: 2026-10-21. Contract: [OpenSeeFace receive](../prompt/2026-10-21-openseeface-receive.md).

## Problem

TRK-08 asks for OpenSeeFace integration. OpenSeeFace is a webcam face tracker (BSD-2). It is the tracker in VSeeFace. Some operators cannot use MediaPipe, for example on an old computer, or they already run OpenSeeFace for VSeeFace. OpenSekai has VMC, iFacialMocap, and MediaPipe sources. It has no OpenSeeFace source.

## Sources

- [Warudo OpenSeeFace](https://docs.warudo.app/docs/mocap/openseeface), read 2026-10-21. It gives: webcam face tracking with a basic set of blend shapes, head rotation, and head translation; the quality is similar to VSeeFace; Warudo recommends MediaPipe; OpenSeeFace is built into Warudo ("no extra software"); the tracker calibrates itself for 10 to 15 s after start, and the face can move at random in that time; **Calibrate OpenSeeFace** (look straight ahead); the settings **Eye Blinking Offset**, **Eye Wide Sensitivity**, **Eyebrow Movement Sensitivity**, **Mouth Left Right Sensitivity**, **Mouth Open Threshold**, **Mouth Open Sensitivity**, **Mouth Funnel Sensitivity**, **Mouth Smile Sensitivity**, **Body Movement Intensity**. It gives no port and no address. Troubleshooting names a Windows console window and antivirus camera protection.
- OpenSeeFace `facetracker.py` (master, read 2026-10-21). It sends one UDP datagram for each camera frame to `--ip` (default `127.0.0.1`) and `--port` (default `11573`). `--faces` defaults to 1. It sends nothing while it detects no face, and it sends nothing for 40 or more faces. All values use `struct.pack` without a byte-order prefix, which is native order (little-endian on x86_64 and arm64).
- OpenSeeFace `Unity/OpenSee.cs` (master, read 2026-10-21). The reference receiver. One face is 1785 bytes. A datagram is valid only when its length is a non-zero multiple of 1785. A later face with the same ID replaces an earlier one.

One face record, little-endian:

| Offset | Field | Type |
| --- | --- | --- |
| 0 | time | f64 |
| 8 | id | i32 |
| 12 | camera width, height | 2 × f32 |
| 20 | right eye open, left eye open | 2 × f32 |
| 28 | 3D fit success | u8 |
| 29 | fit error | f32 |
| 33 | quaternion x, y, z, w | 4 × f32 |
| 49 | Euler x, y, z | 3 × f32 |
| 61 | translation x, y, z | 3 × f32 |
| 73 | landmark confidence | 68 × f32 |
| 345 | landmarks (y, x) | 68 × 2 × f32 |
| 889 | 3D points | 70 × 3 × f32 |
| 1729 | features | 14 × f32 |

The 14 features, in order: EyeLeft, EyeRight, EyebrowSteepnessLeft, EyebrowUpDownLeft, EyebrowQuirkLeft, EyebrowSteepnessRight, EyebrowUpDownRight, EyebrowQuirkRight, MouthCornerUpDownLeft, MouthCornerInOutLeft, MouthCornerUpDownRight, MouthCornerInOutRight, MouthOpen, MouthWide. The tracker normalizes each feature against its own running range (the 10 to 15 s self-calibration that Warudo names).

## Existing material

- `apps/desktop/src-tauri/src/tracking/mod.rs` binds one UDP socket for each endpoint, routes a datagram to a source by sender IP, and calls one decoder method by kind. The receive buffer is 8193 bytes and a datagram larger than 8192 bytes is invalid. Four faces (7140 bytes) fit.
- `tracking/endpoints.rs` (`endpoint_routes`) plans endpoints for VMC and iFacialMocap sources. Two sources of one kind can share an endpoint when each has a different sender address.
- `tracking/parser.rs` (`Decoder`) gives `bones`, `expressions`, and `root`. iFacialMocap gives `head`, `leftEye`, and `rightEye` in normalized space and ARKit weights.
- `packages/contracts/src/tracking.ts` and `crates/contracts/src/tracking.rs` define `TrackingConfig` as a union of `vmc`, `ifacialmocap`, and `mediapipe`. `schema.ts` allows an `ifacialmocap` source only as a face source.
- The session (`packages/session`) applies smoothing, calibration (`tracking-calibration.ts`), and face mapping (`tracking-mapping.ts`) for each source. Calibration makes the captured neutral the identity. The face mapping works on ARKit names (`canonicalArkitName`).
- The editor (`TrackingSourceFields.svelte`, `live-fields.ts`, `asset-groups.ts`, `authoring.ts`) shows each kind. MCP adds sources through `scene_patch` with the same contract schema.

## Findings

1. OpenSeeFace sends binary records, not OSC and not text. A new decoder is necessary. The receive path, routing, status, and clock can stay the same.
2. OpenSeeFace gives no ARKit names. It gives 2 eye values and 12 features. The session face mapping and the B6 overrides need ARKit names. The decoder must map the features to ARKit names.
3. The record has a quaternion and Euler angles in the camera frame of the tracker. The head neutral of a real face is not identity in that frame. The existing calibration removes a neutral, but a source that is not calibrated must still turn the head the correct way. The axis conversion needs a test with known records.
4. A record with the 3D fit success byte at 0 has no usable pose.
5. The tracker sends nothing when it detects no face. The existing stale and hold rules cover that.
6. Warudo runs OpenSeeFace inside the app. OpenSekai would need to bundle the tracker (Python and ONNX models on macOS, a Windows binary build) and start a process. That is a new process boundary and a packaging choice.
7. `--faces 2` on one camera gives two face IDs in one datagram. The IDs come from the tracker and can change when a face is lost.

## Decisions (reversible; the owner can change each one in review of this contract)

- **Receive only.** The operator starts OpenSeeFace (or VSeeFace's tracker) outside OpenSekai. OpenSekai binds a UDP endpoint. Alternative: bundle and start the tracker like Warudo. Deferred to a later slice with a selection gate (licence, packaging on macOS and Windows, process supervision), because it adds a process and a packaged dependency.
- **New source kind `openseeface`.** Config `{kind:'openseeface', enabled, bindAddress, port, senderAddress}`, the same shape as VMC. Defaults: `127.0.0.1`, port `11573`, no sender address. These match the tracker defaults. Alternative: reuse the VMC kind with a format switch. Rejected because the kinds have different defaults, decoders, and assignment rules. Old show files stay valid. A show file with an `openseeface` source does not load in an older build; this is the same as for each earlier new kind.
- **Face source only.** Like iFacialMocap, the source can be the face source of an avatar, not the body or finger source. It gives the head bone, so the existing head rule applies. Alternative: also a body source. Rejected because OpenSeeFace gives no body bones.
- **One face for each source.** From each datagram the decoder uses the valid record with the lowest face ID. Other records are ignored. Alternative: a face ID setting. Deferred; two performers use two trackers with two sender addresses, which the existing endpoint sharing supports.
- **Head rotation, no head translation.** The decoder gives `head` rotation in normalized space. It does not give translation. This matches the iFacialMocap decoder and the B6 subset (head translation is in TRK-05 "not in this subset"). Alternative: give translation as the head position. Deferred with TRK-05 head translation.
- **No eye bones.** The record has pupil landmarks but no gaze angle. The decoder gives no `leftEye` or `rightEye` bone. Alternative: estimate gaze from landmarks. Deferred.
- **Feature to ARKit map** (each result clamped to 0..1):
  - `eyeBlinkLeft = 1 − leftEyeOpen`, `eyeBlinkRight = 1 − rightEyeOpen`.
  - `jawOpen = MouthOpen`.
  - `mouthSmileLeft = MouthCornerUpDownLeft`, `mouthFrownLeft = −MouthCornerUpDownLeft`; the same for the right side.
  - `mouthStretchLeft = MouthWide`, `mouthStretchRight = MouthWide`; `mouthFunnel = −MouthWide`.
  - `browOuterUpLeft = EyebrowUpDownLeft`, `browDownLeft = −EyebrowUpDownLeft`; the same for the right side; `browInnerUp` = the mean of the two positive up-down values.
  - Steepness, quirk, and in-out features are not mapped.
  Alternative: send the 14 raw feature names as custom expressions. Rejected because the face mapping, overrides, and character expression channels work on ARKit names.
- **Left and right.** OpenSeeFace "left" and "right" are taken as the performer's left and right, as in `OpenSee.cs`. If the owner check shows a mirror, the fix is a swap in the decoder, and the contract records it.
- **Warudo sensitivity settings.** Not in this slice. The B6 face mapping already gives a sensitivity and a range for each ARKit channel, which covers Eye Blinking Offset, the mouth thresholds, and the sensitivities in another form. A one-to-one Warudo setting set is a later subset.

## Risks

- **Axis conversion.** A wrong sign turns the head the wrong way. Mitigation: unit tests with records whose quaternion is a known yaw, pitch, and roll, and one owner check with a real webcam (`accept:local`).
- **Neutral offset.** A face that looks straight at the camera can give a non-identity rotation. Mitigation: the existing **Calibrate** applies to the new kind. The decoder does not add a hidden offset.
- **Byte order.** The tracker uses native order. All supported targets (x86_64, arm64) are little-endian. The decoder reads little-endian.
- **Garbage input.** Any sender on the port can send bytes. Mitigation: the length rule, at most 4 records, finite values, a unit-length quaternion check, and the existing invalid packet counter.
- **Self-calibration noise.** The first 10 to 15 s after the tracker starts can move the face at random. This is tracker behavior, not a defect. No UI copy is added for it.
- **Version drift.** A future OpenSeeFace can change the record. The length rule rejects a different size; the parity line names the source commit that the tests use.
