# REASONS: Calibration and tracking overrides

Date: 2026-10-18. Scope: bundle B6 (#21 TRK-04, #22 TRK-05 first subset, #24 TRK-07 calibration part). Analysis: [calibration and tracking overrides](../analysis/2026-10-18-calibration-tracking-overrides.md). Related: [tracking receive and two performers](2026-10-18-tracking-receive-two-performers.md), [minimum live VTubing](2026-10-03-minimum-live-vtubing.md), [tracking smoothing controls](2026-10-04-tracking-smoothing-controls.md), [character expressions](2026-10-10-character-expressions.md).

This file is the contract only. The implementation run starts after the owner merges it. The [Warudo Customizing Face Tracking](https://docs.warudo.app/docs/mocap/face-tracking), [iFacialMocap](https://docs.warudo.app/docs/mocap/ifacialmocap), [MediaPipe](https://docs.warudo.app/docs/mocap/mediapipe), [Customizing Pose Tracking](https://docs.warudo.app/docs/mocap/body-tracking), [Motion capture overview](https://docs.warudo.app/docs/mocap/overview), and [Character](https://docs.warudo.app/docs/assets/character) pages were read on 2026-10-18. The rules of the minimum live contract and of the B5 contract stay in force unless a requirement below changes them.

## Subset

This slice delivers and verifies these subsets. The parity notes use these words.

- **TRK-04 subset:** saved face calibration for each source, and face mapping overrides for each source: head rotation intensity and offset, eye rotation intensity, blend shape sensitivity, a range for each ARKit blend shape, and linked blink. Not in it: blend shape threshold, eye squint limit, Clamp All BlendShapes, eye bones versus eye blend shapes, live mapping values.
- **TRK-05 first subset:** saved upper-body calibration (hips to head) for each source, a head rotation offset, and a finger source next to a body source on one character. Not in it: head translation, Body Movement Intensity, Body Rotation Type, Tracked Body Parts, VMC retargeting changes.
- **TRK-07 calibration part:** Calibrate for a MediaPipe source in the editor and through MCP, with the neutral in the session. Not in it: hand calibration, the hand range and push settings, GPU acceleration, and the physical camera check (owner).

## R — Requirements

### Calibration (TRK-04, TRK-05, TRK-07)

R1. A tracking source entity gets an optional field `calibration: { bones: Record<CalibrationBone, { rotation: Quat; space: 'raw' | 'normalized' }> }`. `CalibrationBone` is one of `hips`, `spine`, `chest`, `upperChest`, `neck`, `head`. The record holds 1 to 6 entries. Each rotation is a unit quaternion (the existing `quat` rule). A missing field means no calibration. TypeScript (`packages/contracts`) and Rust (`crates/contracts`) accept and write the same shape. An old show without the field loads as today.
R2. A new patch operation `setTrackingCalibration { entityId, calibration }` sets the field, or removes it when `calibration` is `null`. It fails with `INVALID_INPUT` when the entity is not a tracking source. It does not change the source `generation`.
R3. A new patch operation `calibrateTracking { entityId }` captures a calibration. The session resolves it before `applyOperations`: it reads the current smoothed sample of the source from the tracking composer (the value that `evaluate` uses, before the stale fade), takes each `CalibrationBone` that the sample has, with its rotation and space, and replaces the operation with `setTrackingCalibration`. The operation fails with `INVALID_INPUT` and the source ID when the source is disabled, when it has no sample of its current generation, when the sample is older than 500 ms at the session clock, or when the sample has no `CalibrationBone`. Other operations in the same patch apply in order, as for each patch. Rust validates the shape only.
R4. In `evaluate`, the composer applies the calibration of a source to its sample before mapping (R8) and before mixing: for each calibrated bone that the sample has with the same space, `rotation' = inverse(neutral) × rotation`, normalized. A bone with a different space, or a bone that the calibration does not name, does not change. Thus the captured pose becomes identity, which is the sender's zero for a raw bone and the rest pose for a normalized bone. The stale fade, hold, and the B5 head and chest composition for a MediaPipe face source apply after it, as today.
R5. `setTrackingConfig` keeps the calibration. `sceneReplace` and show load keep the saved calibration. Undo of a `calibrateTracking` patch restores the previous calibration, as for each persistent edit.
R6. The MediaPipe retargeter no longer keeps a neutral. The head rotation that it sends is the face rotation in camera space (identity when the face looks along the camera axis), composed with the chest as today. `createRetargeter().calibrate`, the worker `calibrate` request, and the tracker `calibrate()` are removed.
R7. The tracking source Inspector of an iFacialMocap or MediaPipe source shows a **Calibrate** button next to Start/Stop. It is enabled when the source state is `receiving`. It sends one `scenePatch` with `calibrateTracking`. When the source has a calibration, a **Reset** button next to it sends `setTrackingCalibration` with `null`. A failed patch shows its error message in the existing alert place. VMC sources do not show the buttons, because the VMC sender calibrates; MCP can still calibrate a VMC source.

### Face mapping (TRK-04, TRK-05)

R8. A tracking source entity gets an optional field `mapping`:
`{ headIntensity: number; headOffset: Vec3; eyeIntensity: number; blendShapeSensitivity: number; linkedBlink: boolean; blendShapes: Record<ArkitName, { inputMin: number; inputMax: number; outputMin: number; outputMax: number }> }`.
Limits: `headIntensity` and `eyeIntensity` 0 to 2; `headOffset` each axis −90 to 90 (degrees, Euler order YXZ in the pose frame, as B5 R18); `blendShapeSensitivity` 0 to 3; for each range, `0 ≤ inputMin < inputMax ≤ 1` and `0 ≤ outputMin ≤ outputMax ≤ 1`; `blendShapes` keys are names from `ARKIT_NAMES`, at most 52. The default (`DEFAULT_TRACKING_MAPPING`) is intensity 1, offset `[0, 0, 0]`, sensitivity 1, linked blink off, no ranges. A missing field means the default. TypeScript and Rust accept and write the same shape.
R9. A new patch operation `setTrackingMapping { entityId, mapping }` sets the field. It fails with `INVALID_INPUT` when the entity is not a tracking source. It does not change the source `generation`.
R10. After calibration (R4), the composer applies the mapping of a source to its sample, in this order:
 1. Head: when the sample has `head`, scale its rotation angle by `headIntensity` about the same axis (shortest arc; 0 gives identity), then `rotation' = offset × rotation`, where `offset` is the quaternion of `headOffset`.
 2. Eyes: scale the rotation angle of `leftEye` and `rightEye` by `eyeIntensity`.
 3. Each expression: find its canonical ARKit name with `canonicalArkitName`. When `blendShapes` has a range for that name, `t = clamp((v − inputMin) / (inputMax − inputMin), 0, 1)` and `v' = outputMin + t × (outputMax − outputMin)`. Then `v'' = clamp(v' × blendShapeSensitivity, 0, 1)`. A name with no canonical form gets the sensitivity only. The expression keeps the name that the sample used.
 4. Linked blink: when `linkedBlink` is on and the sample has both blink channels (canonical `eyeBlinkLeft` and `eyeBlinkRight`), both get the larger value.
The stale fade weight applies after the mapping, as today. Expression suppression (B4) applies after the composer, as today.
R11. The tracking source Inspector gets a **Face** group under Smoothing (in `TrackingAdvanced`) for each source kind: Head intensity, Head offset (three numbers), Eye intensity, Sensitivity, Linked blink, and a **Blend shapes** list. The list shows one row for each name in `ARKIT_NAMES` with the four range numbers; a row with no range shows the default values (0, 1, 0, 1) and commits a range only when the user changes it; **Reset** on a row removes its range. The controls come from `@oshi-connect/ui`. Each commit sends one `setTrackingMapping`.

### Finger source (TRK-05)

R12. `AvatarTracking` gets an optional field `fingersSourceId: Id | null`. A missing field means `null`. The scene rule that each referenced source exists applies to it, and an `ifacialmocap` source cannot be a finger source (as for a body source).
R13. In `evaluate`, when an avatar has a finger source with a live input, the 30 finger bones (`leftThumbMetacarpal` to `rightLittleDistal`) come from the finger source with its weight, and the body source's finger bones are removed. When the finger source has no live input, the body source's finger bones apply, as today. Bones other than finger bones from the finger source are not used.
R14. The B5 rule (R12 of the B5 contract) covers the new slot: a `scenePatch` fails when its end state has a source that two avatars use as body, face, or finger source and its start state did not. One avatar can use one source in more than one slot.
R15. The character Inspector (`AvatarSourceFields`) gets a **Fingers source** select after Face source. It lists VMC and MediaPipe sources and disables a source that the other character uses, as B5 R13 does.

### MCP and documents

R16. The `scene_patch` tool description names `calibrateTracking`, `setTrackingCalibration`, `setTrackingMapping`, and `fingersSourceId` in `setAvatarTracking`. No tool is added.
R17. `ARCHITECTURE.md` **Tracking path** names the calibration and mapping step in the session composer, and says that the MediaPipe worker keeps no neutral. `docs/warudo-parity.md` records the Subset words with the verified checks only. TRK-04, TRK-05, and TRK-07 stay unchecked. The evidence file follows the change evidence rows of `docs/qa.md`.

## E — Entities

- `CalibrationBone = 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head'`.
- `TrackingCalibration = { bones: Partial<Record<CalibrationBone, { rotation: Quat; space: 'raw' | 'normalized' }>> }` (1 to 6 entries).
- `TrackingMapping` and `BlendShapeRange` as in R8; `DEFAULT_TRACKING_MAPPING`.
- Tracking source entity: adds optional `calibration` and `mapping`.
- `AvatarTracking`: adds optional `fingersSourceId`.
- `ScenePatch` operations: adds `calibrateTracking { entityId }`, `setTrackingCalibration { entityId, calibration | null }`, `setTrackingMapping { entityId, mapping }`. Rust `PatchOp` gets the same three variants.
- Session (pure): `applyCalibration(sample, calibration)`, `applyMapping(sample, mapping)`, `captureCalibration(sample) → TrackingCalibration | null`, and the composer accessor `currentSample(sourceId, nowMs)`.
- No change to `TrackingConfig`, `TrackingSample`, `TrackingStatus`, or `AvatarPose`.

## A — Approach

Add the schemas in TypeScript and Rust first, with round-trip tests. Then the pure calibration and mapping functions with unit tests. Then the composer order (calibration, mapping, mixing, fade) and the finger slot. Then the session resolution of `calibrateTracking`. Then remove the MediaPipe worker neutral. Then the editor controls, then MCP. Leave the physical phone, the physical camera, and OBS to the owner.

## S — Structure

- `packages/contracts/src/tracking.ts` (calibration, mapping, `fingersSourceId`), `schema.ts` (entity fields, patch operations, the source reference rule), and their tests.
- `crates/contracts/src/lib.rs` and `tracking.rs` (entity fields, `PatchOp` variants, validation), `crates/contracts/tests/tracking.rs`. `apps/desktop/src-tauri/src/tracking/mod.rs` sets the new fields to `None` where it builds entities.
- `packages/session/src/tracking-calibration.ts` (new, pure: capture and apply), `tracking-mapping.ts` (new, pure), `tracking.ts` (composer order, finger slot, `currentSample`), `scene-ops.ts` (`setTrackingCalibration`, `setTrackingMapping`, the B5 share rule with the finger slot), `session.ts` (`calibrateTracking` resolution); tests in `packages/session/test/`.
- `apps/desktop/src/tracking/retarget.ts`, `mediapipe-worker.ts`, `mediapipe.ts` (remove the neutral); `apps/desktop/test/tracking-retarget.test.ts`.
- `apps/desktop/src/components/TrackingSourceFields.svelte` (Calibrate, Reset), `TrackingAdvanced.svelte` (Face group), `AvatarSourceFields.svelte` (Fingers source); `apps/desktop/src/editor/live-fields.ts` (pure draft parsing for the mapping); desktop tests.
- `apps/mcp/src/server.ts` (descriptions); an MCP test.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/calibration-tracking-overrides.md` (new).

## O — Operations

1. Contracts: TypeScript and Rust tests that accept a source with `calibration` and `mapping` and an avatar with `fingersSourceId`; reject 0 or 7 calibration entries, a bone outside the set, a non-unit quaternion, each mapping limit (intensity 2.01, offset 91, sensitivity 3.01, `inputMin = inputMax`, `outputMin > outputMax`, a non-ARKit key), and an iFacialMocap finger source; accept an old show without the fields. A JSON fixture round-trips through both languages unchanged.
2. Calibration (unit): capture takes only the six bones with their spaces; capture of a sample with no such bone returns null; apply makes the captured rotation identity; apply skips a bone with another space; apply leaves other bones unchanged; a head turned 30° after calibration at 10° reads 20°.
3. Mapping (unit): intensity 0, 0.5, 1, and 2 on a 40° head turn (0°, 20°, 40°, 80°); offset `[0, 15, 0]` on identity gives a 15° yaw with the B5 sign; eye intensity; a range (input 0.2..0.8, output 0..1: 0.5 → 0.5, 0.1 → 0, 0.9 → 1); output max 0 disables; sensitivity 2 clamps at 1; `eyeBlink_L` and `eyeBlinkLeft` both find the `eyeBlinkLeft` range and keep their own name; linked blink gives both the larger value; the default mapping is identity on a sample.
4. Composer (unit): order (calibration before mapping before fade); a stale source fades the mapped value; the MediaPipe head and chest composition still holds with a calibrated chest; the finger source replaces finger bones only; a finger source with no live input falls back to the body source; two avatars with their own finger sources stay independent.
5. Session (unit): `calibrateTracking` on a receiving source writes the calibration and one revision; it fails on a disabled source, a stale sample, a sample of an old generation, and a sample without calibration bones; undo restores the previous calibration; `setTrackingConfig` keeps it; a patch that gives the finger slot of one avatar to the body source of the other fails; one source in the body and finger slots of one avatar passes.
6. MediaPipe (unit): the retargeter test sends a face matrix turned 30° as the first frame and reads 30° (it read 0° before, so the test fails on the old code); the face along the camera axis reads identity.
7. Editor: unit tests for the mapping draft parse and for the Fingers source options. Headless Chromium check of the editor flow with a mock source: Calibrate is disabled while the source waits; a mock iFacialMocap stream over the dev clock makes it enabled; Calibrate then Reset change the scene revision; a Face group change commits one `setTrackingMapping`; the Fingers source select disables the other character's source.
8. MCP: a test that `scene_patch` with `calibrateTracking` on a source with no sample returns the R3 error, and the descriptions name the operations.
9. Documents: the evidence file with the commit, platform, backend, each check and its raw result, and the gaps; parity notes (R17); `ARCHITECTURE.md` (R17).

## N — Norms

- Unit tests for the schemas, calibration, mapping, composer order, and session rules. No new integration test: this slice adds no process, network, file, or protocol boundary.
- UI copy is the control label only (constitution principle 1). Calibrate has no instruction sentence; the Warudo step ("look straight ahead") stays in the handbook-style docs, not in the Inspector. Controls come from `@oshi-connect/ui`.
- Functional TypeScript and plain data. Calibration and mapping are pure functions on a sample.
- Mock samples prove the math. They do not prove the look with a real phone or camera.

## S — Safeguards

- Do not change `TrackingSample`, `TrackingStatus`, `AvatarPose`, the source limit (4), or the avatar limit (2).
- Do not make an old show fail to load. The new fields are optional.
- Do not keep a calibration or a neutral outside the scene state.
- Do not add a dependency, a CI job, or a vendor service.
- Do not claim a macOS, OBS, phone, or camera result. These stay for the owner: Calibrate with an iPhone (iFacialMocap) on macOS makes a straight-ahead head neutral, and it stays after a restart of the app with the saved show; Calibrate with a physical webcam (MediaPipe) does the same for the head and the upper body; head intensity, head offset, a blend shape range, sensitivity, and linked blink look correct on a perfect sync VRM in the preview and in OBS with alpha; MediaPipe fingers with a VMC body on one character; continued motion while the editor is minimized.
