# REASONS: Bouncy Live2D motion

Date: 2026-11-21. Scope: VPoyo gap 2 ([#294](https://github.com/danirukun/opensekai/issues/294)). Analysis: [bouncy Live2D motion](../analysis/2026-11-21-bouncy-live2d-motion.md). Design: [bouncy Live2D motion](../../docs/superpowers/specs/2026-11-21-bouncy-live2d-motion-design.md). Plan: [bouncy Live2D motion plan](../../docs/superpowers/plans/2026-11-21-bouncy-live2d-motion.md).

## R — Requirements

R1. The bouncy spring is a pure module (`packages/session/src/bouncy-spring.ts`). The drive is `−(clamp(pitch × pitchScale) × pitchWeight + clamp(jawOpen × jawScale) × jawWeight)`. The pitch is the head pitch in degrees times `BOUNCY_ROTATION_UNIT` (1/180). The pitch clamp is −1 to 1. The jaw clamp is 0 to 1. A chin-down pitch and a jaw open give a negative drive.
R2. The spring state is `mix`, `mixVelocity`, `position`, and `velocity`. Smooth Damp smooths the drive over `inputSmoothing` (0 means no smoothing). The spring is a backward Euler step with a mass of 0.25. The spring term is 44 × `spring`, and the damping term is 2.8 × `damping`. The output is `position`. Intensity is not in the spring.
R3. `stepBouncySpring` splits the delta into steps of at most 16 ms. A delta of 0 or less keeps the state. A state that is not finite starts again from the drive. The output stays finite for a delta of 1 s (unit test). The node gives the spring at most 1 s of delta. The design target is a stable step for deltas from 1 ms to 100 ms; the unit tests do not cover that range yet.
R4. `tracking.bouncySpring` (data, stateful; category Tracking). Settings: `entityId`, `pitchWeight`, `pitchScale`, `jawWeight`, `jawScale` (−100..100), `spring`, `damping` (0..100), `inputSmoothing` (0..5 s). Defaults: 1, 1, 0.5, 1, 0.5, 0.5, 0.05. Output `value` (number). It reads the head rotation and `jawOpen` from the previous pose. The first read starts at the drive. It steps once for each session tick. A second read in the same tick gives the stored value. It gives at most 1 s of delta to the spring. A missing character is an error ("Character is unavailable").
R5. `AvatarPose` has optional `boneTranslations` (humanoid bone to `Vec3`, meters, at most 55 bones) and `boneScales` (humanoid bone to a number from 0.5 to 1.5, at most 55 bones). TypeScript and Rust accept them and omit them when they are missing.
R6. The bone offset layer keeps, for each bone, a rotation, an added translation, and an assigned scale. `character.offsetBoneRotation` and `character.offsetBones` write the rotation as before. A translation write adds component by component and must be finite and at most 2 m on each axis. A scale write replaces an earlier scale of the same bone in the tick and must be finite. A bone that has only the rest value in a field does not put that field in the pose.
R7. `character.offsetBoneTranslation` (flow; settings `entityId`, `bones` 1 to 32, `axis`, `intensity` −2..2, `offset` −2..2; inputs `value`, `weight` default 1). For each bone it emits an `offsetBoneTranslation` effect with `weight × (value × intensity + offset)` meters on the axis.
R8. `character.offsetBoneScale` (flow; settings `entityId`, `bones` 1 to 32, `intensity` −1..1, `offset` −1..1; inputs `value`, `weight` default 1). For each bone it emits an `offsetBoneScale` effect with the scale `clamp(1 + weight × (value × intensity + offset), 0.5, 1.5)`.
R9. Both writers skip a bone with the rule of `character.offsetBones` (`offsetBonesSkipped`): a bone that a body source tracks, and a finger bone that a fingers or body source covers. A character with a face source only is not skipped. Each node call emits its effects with `emitEach` and counts as one effect of the graph tick budget.
R10. The renderer applies `boneTranslations` and `boneScales` on the raw bone nodes after the rotation offsets. The translation adds to the position with the sign change of a VRM 0 model on x and z. The scale multiplies the raw scale. The raw scale of each bone returns to rest on each frame. A rig without a chest carries the chest translation and scale on the spine.
R11. The VMC send pose adds `boneTranslations` to the raw bone positions, with the same VRM 0 sign rule and the chest fold. It does not send `boneScales`, because the VMC pose has no scale. A VMC receiver shows the moved position and not the squash. This is a known difference.
R12. The Face-Only Body Motion template has two more graph variables: `Bouncy Motion` (boolean, default false) and `Bouncy Intensity` (number, default 0.5). The template has the nodes `bouncy` (Bouncy Spring with the default settings of R4), `bouncy-scaled` (Multiply of `bouncy` and `Bouncy Intensity`), `bouncy-gated` (a number select: `bouncy-scaled` when `Bouncy Motion` is true, else 0), `bouncy-y` (Offset Bone Translation on the spine and the chest, axis `y`, intensity 0.08, offset 0), and `bouncy-scale` (Offset Bone Scale on the spine and the chest, intensity 0.05, offset 0). Both writers take `bouncy-gated` as `value` and the `fade` result as `weight`. The two writers follow the last finger writer in the flow chain. The graph stays at 128 nodes or fewer and 256 connections or fewer.
R13. A template run counts 24 effects of the graph tick budget (limit 64), also when `Bouncy Motion` is off. With `Bouncy Motion` off, the pose has no bounce translation and no bounce scale. The other outputs of the template do not change.
R14. A saved graph of the earlier template stays valid and has no bounce. The tracking guide, the Templates menu, and MCP `blueprint_import` with `template: "face-only-body-motion"` build the new graph, with the bounce off.
R15. Do not claim the OBS result. The evidence is pending: a macOS check of a face-only character with `Bouncy Motion` on, OBS at 60 FPS, and no visible jitter ([check](../../docs/evaluation/bouncy-live2d-motion.md)). The gap row in `docs/vpoyo-gaps.md` says "In progress" until that check is done.

## E — Entities

- `BouncySpringState`, `BouncyDrive`, `BOUNCY_ROTATION_UNIT`, `BOUNCY_MAX_STEP_SECONDS` (`bouncy-spring.ts`).
- Node types `tracking.bouncySpring`, `character.offsetBoneTranslation`, `character.offsetBoneScale`.
- `AvatarPose.boneTranslations?`, `AvatarPose.boneScales?`; the Rust mirror (`bone_translations`, `bone_scales`).
- `BoneLayerEntry` (rotation, translation, scale), `BoneLayerEffect`, `DEFAULT_BONE_ENTRY`, `writeBoneTranslation`, `writeBoneScale` (`bone-offsets.ts`).
- The graph variables `Bouncy Motion` and `Bouncy Intensity`.

## A — Approach

Pure spring first, then the pose fields, the bone layer, the renderer and the VMC send, the node definitions, the evaluators, and then the template. The graph owns the controls, so the user can see and change every part. Check the result on macOS with OBS at 60 FPS after the code is complete.

## S — Structure

- `packages/session/src/{bouncy-spring,bone-offsets,session,blueprint,vmc-send}.ts`, `blueprint-eval/{tracking,character}.ts`; session tests `bouncy-spring`, `bouncy-motion-nodes`, `bone-offsets`, `vmc-send`.
- `packages/contracts/src/{tracking.ts,blueprint-nodes/tracking.ts,blueprint-nodes/character.ts}`, `blueprint-templates/face-only-body-motion.json`; contracts tests.
- `crates/contracts/src/tracking.rs`; Rust tests.
- `packages/renderer/src/avatar-pose.ts`; renderer test.
- `ARCHITECTURE.md`, `docs/vpoyo-gaps.md`, `docs/evaluation/bouncy-live2d-motion.md` (new).

## O — Operations

1. Spring module with unit tests (R1 to R3).
2. Pose fields in TypeScript and Rust (R5).
3. Bone layer and renderer apply step (R6, R10).
4. VMC send translation (R11).
5. Node definitions and evaluators (R4, R7 to R9).
6. Template variables and chain (R12 to R14).
7. Documents (this file, the analysis, the architecture map, the gap row).
8. macOS and OBS check (R15).

## N — Norms

- Unit tests for the spring response (sink, rise, damping, substep stability, intensity outside the spring), the layer writers, the two evaluators, the skip rule, and the template wiring. Contract tests for the node definitions and the template variables. A browser and OBS check for the look.
- Functional TypeScript. Plain data in node state.
- UI copy: field labels only (constitution principle 1).
- Long prose in ASD-STE100.

## S — Safeguards

- One authoritative simulation: the session owns the spring state. No renderer runs a spring for this effect.
- Editor preview, OBS, and VMC send read the same pose, except for the known scale difference of R11.
- Do not change the tracking compose path. Do not change the Face-Only Body Motion evidence.
- A scale never leaves 0.5 to 1.5, so a bad graph cannot invert a mesh.
- Do not change the show file version. Old shows and old template graphs load and run.
- Do not lower the concert benchmark.
- Do not claim an OBS, 60 FPS, or look result that was not checked.
