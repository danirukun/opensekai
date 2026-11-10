# REASONS: Tracked body parts and body movement intensity

Date: 2026-11-10. Scope: #22 TRK-05, slice 2. Analysis: [tracked body parts](../analysis/2026-11-10-tracked-body-parts.md). Related: [calibration and tracking overrides](2026-10-18-calibration-tracking-overrides.md).

## R — Requirements

R1. `@opensekai/contracts` exports `BODY_PARTS` (`head`, `body`, `leftArm`, `rightArm`, `leftFingers`, `rightFingers`, `leftLeg`, `rightLeg`), `BodyPart`, `AvatarBodyTracking`, `AvatarBodyTrackingSchema`, `DEFAULT_AVATAR_BODY_TRACKING` (intensity 1, all parts, frozen), `bodyPartOf(bone)`, and `normalizeBodyTracking(body)`.
R2. `bodyPartOf` gives the part of each of the 55 humanoid bones: `head` for neck, head, leftEye, rightEye, and jaw; `body` for hips, spine, chest, and upperChest; `leftArm` and `rightArm` for shoulder, upper arm, lower arm, and hand; `leftFingers` and `rightFingers` for the 15 finger bones of the side; `leftLeg` and `rightLeg` for upper leg, lower leg, foot, and toes. Another name gives `null`.
R3. `AvatarTracking` has an optional `body: { movementIntensity, trackedParts }`. `movementIntensity` is 0 to 2. `trackedParts` is a list of at most 8 parts with no duplicate. TypeScript and Rust accept the group, check it, and omit it when it is missing. Shows without it load without change.
R4. `normalizeBodyTracking` gives `undefined` for a missing group and for a group with intensity 1 and all 8 parts. Otherwise it gives the group with `trackedParts` in the `BODY_PARTS` order. `setAvatarTracking` and `createEntity` store the normal form.
R5. For a character with a `body` group, the composer drops each bone whose part is not in `trackedParts`, from each source, and drops `root` when `body` is not in the list. Expressions do not change. `baseBones` do not change.
R6. For a character with a `body` group, the composer scales the rotation of each remaining bone of the `body` part by `movementIntensity` with `scaleRotation`. An intensity of 1 changes nothing. Positions, the root, and the bone weight do not change.
R7. A character without the group gets the same pose as before this slice.
R8. The editor Tracking section of a character shows Body Movement Intensity (slider, 0 to 2) and Tracked Body Parts (one checkbox for each part: Head, Body, Left Arm, Right Arm, Left Fingers, Right Fingers, Left Leg, Right Leg). A change sends one `setAvatarTracking` patch that keeps the source IDs. A change of a source select keeps the group. Each of the two fields has the reset mark of B17.
R9. The tracking guide keeps the `body` group of a character when it connects a source and when it restores the earlier tracking on a close.
R10. `docs/warudo-parity.md` records only the verified subset. TRK-05 stays unchecked.

## E — Entities

- `BodyPart`, `AvatarBodyTracking = { movementIntensity: number; trackedParts: BodyPart[] }`, `AvatarTracking.body?`.
- Rust: `BodyPart`, `AvatarBodyTracking` with `Validate`, `AvatarTracking { body: Option<AvatarBodyTracking> }`.

## A — Approach

Contracts first in TypeScript and Rust with shared vectors. Then the session normal form and the composer. Then the editor fields and the guide. Check the pose with mock samples at the composer interface and the editor in headless Chromium.

## S — Structure

- `packages/contracts/src/tracking.ts`; `packages/contracts/test/body-tracking.test.ts` (new).
- `crates/contracts/src/tracking.rs`, `lib.rs`; `crates/contracts/tests/body_tracking.rs` (new); `fixtures/protocol/validation-vectors.json`.
- `packages/session/src/scene-ops.ts`, `tracking.ts`; `packages/session/test/tracking-body-parts.test.ts` (new).
- `apps/desktop/src/components/AvatarSourceFields.svelte`, `editor/live-fields.ts`, `editor/tracking-guide-plan.ts`, `editor/property-defaults.ts`, `editor/slider.ts`; desktop tests.
- `ARCHITECTURE.md` (tracking path, step 3), `docs/warudo-parity.md`, `docs/evaluation/tracked-body-parts.md` (new).

## O — Operations

1. Contracts: the part list, the bone map, the schema, the default, the normal form. Rust mirror with the range and duplicate checks. Vectors: a character with the group (valid), an intensity out of range, a duplicate part, an unknown part (rejected).
2. Session: `scene-ops.ts` stores the normal form in `setAvatarTracking` and `createEntity`. `tracking.ts` applies R5 and R6 to the mixed bone list.
3. Editor: `withSource` keeps the group; `withBodyTracking(tracking, change)` makes the next `AvatarTracking`; the two fields; reset values.
4. Documents: parity, architecture, evidence.

## N — Norms

- Unit tests: the bone map covers each humanoid bone one time; the schemas and the Rust mirror with shared vectors; the normal form; the composer with mock samples (a part off drops its bones from body, face, and finger sources; `body` off drops the root; intensity 0, 0.5, and 2 on a known rotation; expressions and weights stay; no group gives the old pose); the editor helpers.
- A headless Chromium check of the real Inspector on a real session for R8.
- UI copy is the control label only (constitution principle I).

## S — Safeguards

- Do not change the pose of a character without the group.
- Do not add a patch operation or change the show file version.
- Do not scale positions.
- Do not claim a result with a physical tracker, macOS, or OBS.
