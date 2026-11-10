# REASONS: normalized tracking bones on a VRM 0 character

Date: 2026-11-10. Scope: a defect fix. Analysis: [VRM 0 tracking axes](../analysis/2026-11-10-vrm0-tracking-axes.md). This contract replaces one sentence of [default avatar idle](2026-10-04-default-avatar-idle.md) ("normalized tracking inputs retain their current rig-space semantics") and the normalized step of [VMC sender](2026-10-21-vmc-sender.md) R7 for tracked bones.

## R — Requirements

R1. A tracking bone with space `normalized` has the VRM 1 axes: the character looks to +Z, its left side is +X, and up is +Y. This is true for each source.
R2. For a VRM 0 model, the renderer (`avatar-pose.ts`) changes the rotation of each `normalized` tracking bone to `(−x, y, −z, w)` and its position to `(−x, y, −z)` before the blend with the base bone. For a VRM 1 model it changes nothing.
R3. `vmcSendPose` makes the same change for a rig with `metaVersion` `'0'`, so the sent pose stays equal to the pose of the renderer.
R4. A tracking bone with space `raw` does not change, for each VRM version.
R5. The base bones, the bone offsets, the weight blend, and the chest fallback of a rig without a chest do not change.
R6. A pose with the arms down in the `normalized` space (left upper arm about −Z, right upper arm about +Z) puts each hand below its shoulder on a VRM 0 and on a VRM 1 model.

## E — Entities

No new entity. `TrackingBone.space` keeps the values `raw` and `normalized`; R1 gives the meaning of `normalized`.

## A — Approach

Change the tests first, then the two functions. Check with a webcam on a VRM 0 and on a VRM 1 character in the desktop app and in OBS.

## S — Structure

- `packages/renderer/src/avatar-pose.ts`; `packages/renderer/test/avatar-pose.test.ts`.
- `packages/session/src/vmc-send.ts`; `packages/session/test/vmc-send.test.ts`.
- `apps/desktop/test/tracking-retarget.test.ts` (the retargeter output with the final pose).
- `spdd/prompt/2026-10-04-default-avatar-idle.md`, `spdd/prompt/2026-10-21-vmc-sender.md` (a pointer to this contract).
- `docs/evaluation/vrm0-tracking-axes.md` (new), `docs/warudo-parity.md`.

## O — Operations

1. Tests: a `normalized` tracking bone on a VRM 0 rig gets the sign in the renderer and in `vmcSendPose`; a VRM 1 rig and a `raw` bone get no change; the arms of R6; the MediaPipe retargeter with a pose that has the arms down gives hands below the shoulders in the sent pose of a VRM 0 and of a VRM 1 rig.
2. Renderer: apply the sign of the model to the rotation and the position of each `normalized` tracking bone.
3. Session: the same in `vmcSendPose`.
4. Documents: the two older contracts, the evidence file, the parity checklist.

## N — Norms

- Unit tests for the two pure paths. No test replaces the unit under test with a mock.
- A webcam check in the desktop app with OBS for a VRM 0 and a VRM 1 character: nod, tilt, turn, and arms.

## S — Safeguards

- Do not change the retargeter, the parsers, the calibration, or a wire contract.
- Do not change `raw` bones.
- Do not claim an iFacialMocap result without a phone check.
