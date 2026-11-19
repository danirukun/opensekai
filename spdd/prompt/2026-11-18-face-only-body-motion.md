# REASONS: Face-only body motion

Date: 2026-11-18. Scope: TRK-06 (first subset), BP-11. Analysis: [face-only body motion](../analysis/2026-11-18-face-only-body-motion.md). Design: [face-only body motion](../../docs/superpowers/specs/2026-11-18-face-only-body-motion-design.md).

## R — Requirements

R1. `TrackingSample` and `AvatarPose` have an optional `headPosition: Vec3` (meters, pose frame). TypeScript and Rust accept it and omit it when it is missing. The renderer and the VMC send pose do not use it.
R2. The iFacialMocap decoder sets `headPosition` from the head translation (values 4 to 6 of `head#`), in meters, with the same axis signs as the head rotation conversion. The MediaPipe face path sets `headPosition` from the face matrix translation, in meters, with the same frame as the face rotation.
R3. `TrackingCalibration` has an optional `headPosition: Vec3`. Calibrate stores the sample `headPosition` when the sample has one. The compose step gives `headPosition − neutral` when both exist, and no `headPosition` otherwise. A show without the field loads without change.
R4. The compose step copies the face source `headPosition` into the `AvatarPose` of the character, scaled by the face weight (the stale fade).
R5. `tracking.getHeadPose` (data; settings `entityId`). Outputs from the previous pose of the character: `rotation` (vector3: the same value as `character.getBoneRotation` on `head`), `position` (vector3: `headPosition`, else zero), `tracked` (number: the `weight` of the pose `head` bone, else 1 when the bone has no weight, else 0 with no `head` bone).
R6. `tracking.pendulum` (data, stateful; settings `entityId`, `inputs` 1 to 8, `inputSmoothing` 0 to 5 s, `arms` 0 to 4). An input has `kind` (`headPitch`, `headYaw`, `headRoll`, `headPositionX`, `headPositionY`, `headPositionZ`, `blendShape`), `blendShape` (ARKit name, for `blendShape` only), `weight`, `scale`, `absolute`, `clamp` [min, max]. An arm has `length`, `mass`, `drag`, `spring`, `damping`, `gravity`. Output `value` (number). The `rows` field kind gives each list a `newRow` default for the add button. When the arm count changes, the chain state starts again from rest. The evaluator gives the model at most 1 s of delta for each tick, and uses 0 for a mix that is not finite.
R7. Pendulum step: the mix is the sum over inputs of `weight × clamp(abs?(reading × unit × scale))`, where `unit` is `PENDULUM_ROTATION_UNIT` for a rotation input and 1 for the others. The node smooths the mix with Smooth Damp over `inputSmoothing` (0 means no smoothing), then drives the chain. The output is the last link angle, or the smoothed mix with no arms. The node steps once for each session tick, in steps of at most 16 ms. A step of 0 keeps the state. With a constant input and `gravity` 0, the output settles to the mix. Each link step is backward Euler in the spring, damping, drag (at the current speed), and gravity terms, with a mass of at least 0.01 and a negative gravity used as 0. The output stays finite at each schema value. From rest, with the Warudo arm values and one of drag, spring, damping, or gravity at 100 (mass 0 or 0.25), or the length at 0 or 100, a 4-arm chain stays at most 2 × the largest mix for 10 s at 60 Hz and at 30 Hz. With damping 0 and drag 0, only the step dissipation limits the chain resonance.
R8. `character.offsetBones` (flow; settings `entityId`, `bones` 1 to 32 humanoid bones, `axis` `x`/`y`/`z`, `intensity` −360..360, `offset` −360..360; inputs `value`, `weight` default 1). For each bone it emits an `offsetBone` effect with angle `clamp(weight × (value × intensity + offset), −360, 360)` on the axis. The node emits its effects with one `FlowContext.emitEach` call, which counts as one effect of the tick budget (64 for each tick) when the list has an effect that is not a debug effect.
R9. `character.offsetBones` skips a bone when the character has a body source and `bodyPartOf(bone)` is in `trackedParts` (no `body` group counts as all parts), or when the bone is a finger bone and the character has a fingers source or a body source.
R10. The "Face-Only Body Motion" template (one character) has the chains of the design: fade (`tracked` through Smooth Damp 2 s), body follows head (direction 0.5, 1, 0.5; intensity 0.5; signs +1, +1, −1; spine 0.5, chest 0.25, hips 0; neck −0.75), Body Lean, Arm Movements, Finger Movements, with the values of the Warudo reference. The body-follows-head factors (intensity, direction, spine, chest, neck) are graph variables. The Arm Movements and Finger Movements inputs use the node clamp limit (−100..100), because Warudo applies a pendulum input clamp only when Clamp Override is on (measured 2026-11-19). It has at most 128 nodes and 256 connections.
R11. The Templates menu lists "Face-Only Body Motion" and does not list "Upper Body Rotation". `upperBodyRotationTemplate` stays exported.
R12. MCP `blueprint_import` accepts `{ sceneId, template: 'face-only-body-motion', avatarId }` as an alternative to `file`, and builds the graph with the same builder and `importBlueprint`. The input schema is one flat strict object (no top-level `anyOf`, `oneOf`, or `allOf`); a refinement requires exactly one of `file` and `template`, and `avatarId` when, and only when, `template` is given.
R13. The tracking guide creates the template graph after a successful connect when the plan gives the character a face source and no body source, the show has fewer than 8 graphs, and no graph named "Face-Only Body Motion" targets the character. Cancel removes the graph that the guide created.
R14. `docs/warudo-parity.md` records only the verified subset. TRK-06 stays unchecked.

## E — Entities

- `TrackingSample.headPosition?`, `AvatarPose.headPosition?`, `TrackingCalibration.headPosition?`; Rust mirrors.
- `PendulumInput`, `PendulumArm`, `PendulumState` (`packages/session/src/pendulum.ts`), `PENDULUM_ROTATION_UNIT`.
- Node types `tracking.getHeadPose`, `tracking.pendulum`, `character.offsetBones`. Field kinds `rows` (with `newRow`) and `bones`.
- `FlowContext.emitEach(effects)` in `packages/session/src/blueprint.ts`.
- `faceOnlyBodyMotionTemplate(avatar)`; `GuideSnapshot.graphId?`.

## A — Approach

Data first (contracts, decoders, compose), then the pure pendulum model with unit tests, then the nodes, then the template, menu, MCP, and guide. Measure the Warudo pendulum input unit before the template values are final. Check the result on macOS with a real face source and OBS.

## S — Structure

- `packages/contracts/src/tracking.ts`, `blueprint-nodes/{tracking,character,define}.ts`, `blueprint-templates/{index.ts,face-only-body-motion.json}`; contracts tests.
- `crates/contracts/src/tracking.rs`; `apps/desktop/src-tauri/src/tracking/parser.rs`.
- `apps/desktop/src/tracking/retarget.ts`.
- `packages/session/src/{tracking,tracking-calibration,pendulum}.ts`, `blueprint-eval/{tracking,character}.ts`; session tests.
- `apps/desktop/src/components/BlueprintNodeFields.svelte`, `blueprints/templates.ts`, `components/TrackingGuide.svelte`, `editor/tracking-guide-plan.ts`.
- `apps/mcp/src/blueprint-files.ts`.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/face-only-body-motion.md` (new).

## O — Operations

1. Head position data (R1 to R4).
2. Pendulum model (R7).
3. Nodes (R5, R6, R8, R9) and field editors.
4. Warudo unit measurement; set `PENDULUM_ROTATION_UNIT`.
5. Template, menu, MCP, guide (R10 to R13).
6. macOS and OBS check; documents (R14).

## N — Norms

- Unit tests for the decoders, the calibration offset, the pendulum model, each evaluator, the skip rule, the template limits, and the guide plan. Integration tests for MCP and the editor template import. A headless editor check of the template on a mock face sample.
- Functional TypeScript; plain data in node state.
- UI copy: field labels only (constitution principle 1).
- Do not copy Warudo code.

## S — Safeguards

- Do not change the pose of a character without the template, except for the new `headPosition` field.
- Do not apply `headPosition` in the renderer or in the VMC send pose.
- Do not change the show file version. Old shows and old Upper Body Rotation graphs load and run.
- Do not claim a macOS, OBS, or look result that was not checked.
