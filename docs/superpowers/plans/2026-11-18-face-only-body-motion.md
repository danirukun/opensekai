# Face-Only Body Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With only a face source, a visible and editable Blueprint graph moves the whole body (body follows the head, body lean, arm and finger sway, tracking-lost fade), as Warudo does.

**Architecture:** The compose step stays the one authority for tracking. It only passes a new `headPosition` field on. Three new nodes (`tracking.getHeadPose`, `tracking.pendulum`, `character.offsetBones`) read the previous pose and write bone offsets. The "Face-Only Body Motion" template wires them with the Warudo reference values. The Templates menu, MCP, and the tracking guide create that graph.

**Tech Stack:** TypeScript (zod contracts, session worker), Rust (Tauri decoder, contracts crate), Svelte 5 with `@oshi-connect/ui`, vitest, cargo test.

**Spec:** [design](../specs/2026-11-18-face-only-body-motion-design.md), [REASONS contract](../../../spdd/prompt/2026-11-18-face-only-body-motion.md) (R1 to R14), [analysis](../../../spdd/analysis/2026-11-18-face-only-body-motion.md), [Warudo reference](../../evaluation/warudo-face-reference/README.md).

## Global Constraints

- pnpm only. Run each cargo, pnpm, or Tauri command that compiles Rust through `direnv exec . <command>`. Do not build into a per-worktree `target/`.
- Verify `pwd` before Git. Do not use `git -C` or `cd … &&`. No agent attribution in commits. Do not push until the branch finish.
- Functional TypeScript; node state is plain data. Comments only where the logic is hard to follow.
- UI copy: field labels only (constitution principle 1). No helper text, no badges.
- Do not change the show file version. Old shows and old "Upper Body Rotation" graphs load and run (`upperBodyRotationTemplate` stays exported).
- The renderer and the VMC send pose do not read `headPosition`.
- Do not save or change the Warudo scene in the VM. Read it only, unless the owner agrees to a temporary change that is not saved.
- Do not copy Warudo code. The pendulum is OpenSekai's own model.
- Limits: 128 nodes and 256 connections per graph; 8 graphs per show.
- QA uses the Catboy ARKit VRM. OBS through ws://127.0.0.1:4455; do not stream.
- Long prose (docs, PR text) in ASD-STE100.

## Review Focus

1. **Hidden window (large tick).** A throttled editor gives a 1 s tick. The pendulum must stay finite and bounded. Test in Task 5: one 1 s step and a 5 s step give finite output with |output| ≤ max |mix| × 2.
2. **Pendulum read twice in one tick.** Two downstream nodes read the same pendulum `value`. It must step once for each tick (same `stepMs` rule as `damped()`). Test in Task 6.
3. **Body source added after the guide.** The user adds a body source later. The template must not double the body motion. Test in Task 7 (skip rule for body, partial body, and fingers).
4. **Character removed or replaced.** The template graph targets a removed character. Evaluators throw `Character is unavailable` like `character.getBoneRotation`, so the run fails cleanly and no offset is written. Test in Task 4 and Task 7.
5. **Old calibration and old samples.** A show calibrated before this change has no `headPosition` neutral. Compose must give no `headPosition` (not the raw value) and must not fail. Test in Task 3.

---

### Task 1: `headPosition` in contracts and the iFacialMocap decoder

**Files:**
- Modify: `packages/contracts/src/tracking.ts` (`TrackingSample`, `AvatarPose`, `TrackingCalibration` schemas)
- Modify: `crates/contracts/src/tracking.rs` (Rust mirrors)
- Modify: `apps/desktop/src-tauri/src/tracking/parser.rs` (`ifacial`, line 365; tests near line 566)
- Test: `packages/contracts/test/live-tracking.test.ts`, Rust tests in `parser.rs` and `crates/contracts/src/tracking.rs`

**Interfaces:**
- Produces: `headPosition?: Vec3` on `TrackingSample`, `AvatarPose`, and `TrackingCalibration` (TS); `head_position: Option<[f64; 3]>` with `#[serde(rename = "headPosition", skip_serializing_if = "Option::is_none", default)]` (Rust). Rust const `IFACIAL_POSITION_SCALE: f64 = 0.01` (centimeters to meters).

- [ ] **Step 1: Write the failing tests**

TS (`live-tracking.test.ts`): `it('accepts and omits headPosition on sample, pose, and calibration')` parses a sample with `headPosition: [0, 0.02, 0.05]` and one without; the first keeps the value, the second has no key. A non-finite value fails.

Rust (`parser.rs`): `ifacial_keeps_head_translation` decodes `b"=head#0,0,0,1,2,5|"` and asserts `head_position == Some([x, y, z])` where each value is raw × `IFACIAL_POSITION_SCALE` with the same axis sign flips that `euler()` applies to the rotation axes. Assert that the `head` bone `position` stays `None`. Extend `ifacial_v2_legacy_degree_and_bounds` to assert `head_position` is `Some(..)` for `head#0,90,0,1,2,3`.

Rust (`crates/contracts`): a serde round trip omits `headPosition` when `None`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit packages/contracts/test/live-tracking.test.ts` → FAIL (unknown key).
Run: `direnv exec . cargo test -p opensekai-desktop ifacial` → FAIL (no field `head_position`).

- [ ] **Step 3: Implement**

Add the optional fields. In `ifacial`, set `next.head_position` from values 3 to 5 of `head`. Copy the sign flips from `euler()` so the position frame matches the rotation frame.

- [ ] **Step 4: Run the tests to verify they pass**

Run the two commands of Step 2, plus `direnv exec . cargo test -p opensekai-contracts`. Expected: PASS.

- [ ] **Step 5: Commit** — `Add the head position to tracking samples and decode it from iFacialMocap.`

### Task 2: MediaPipe head position

**Files:**
- Modify: `apps/desktop/src/tracking/retarget.ts` (`createRetargeter`, face branch near line 38)
- Test: `apps/desktop/test/tracking-retarget.test.ts`

**Interfaces:**
- Consumes: `TrackingSample.headPosition` (Task 1).
- Produces: `faceTranslation(matrix: number[] | undefined): Vec3 | null` exported from `retarget.ts`. `MEDIAPIPE_POSITION_SCALE = 0.01` (MediaPipe face geometry is in centimeters).

- [ ] **Step 1: Write the failing test**

`it('keeps the face matrix translation as headPosition in meters')`: a column-major 4×4 matrix with translation (2, −3, −40) gives `headPosition` equal to that translation × 0.01, in the same frame (and the same mirror rule) as `faceRotation`. A matrix with fewer than 16 values gives no `headPosition`. With `mirror` on, X changes sign.

- [ ] **Step 2: Run** `pnpm vitest run --project unit apps/desktop/test/tracking-retarget.test.ts` → FAIL.

- [ ] **Step 3: Implement** `faceTranslation` (matrix elements 12 to 14) and set `headPosition` on the face sample when it is not null.

- [ ] **Step 4: Run** the same command → PASS.

- [ ] **Step 5: Commit** — `Keep the MediaPipe face translation as the head position.`

### Task 3: Calibration neutral and compose

**Files:**
- Modify: `packages/session/src/tracking-calibration.ts` (`captureCalibration`, `applyCalibration`)
- Modify: `packages/session/src/tracking.ts` (`createTrackingComposer`: face source to `AvatarPose`)
- Test: `packages/session/test/tracking-calibration.test.ts` (create), `packages/session/test/tracking-overrides.test.ts` (compose cases)

**Interfaces:**
- Consumes: Task 1 fields.
- Produces: `AvatarPose.headPosition` = (sample `headPosition` − calibration neutral) × face weight. No field when the sample or the neutral has none.

- [ ] **Step 1: Write the failing tests**

- `captureCalibration` keeps `headPosition` when the sample has one, and has no key otherwise.
- `applyCalibration` gives `[0.01, 0, 0.03]` for sample `[0.02, 0.1, 0.05]` and neutral `[0.01, 0.1, 0.02]`.
- Old calibration (no `headPosition`) and a sample with one: the result has no `headPosition` (Review Focus 5).
- Compose: a face-only character gets `headPosition` on its pose. At stale age 625 ms (weight 0.5), the value is half. A character with no face source has no key. The bones and expressions of the pose do not change compared with today (snapshot of an existing case).

- [ ] **Step 2: Run** `pnpm vitest run --project unit packages/session/test/tracking-calibration.test.ts packages/session/test/tracking-overrides.test.ts` → FAIL.

- [ ] **Step 3: Implement** in the two files. Scale by the same face weight the compose step already uses for the stale fade.

- [ ] **Step 4: Run** the same command → PASS. Also run `pnpm test:unit` to see no other pose test changed.

- [ ] **Step 5: Commit** — `Calibrate the head position and pass it to the avatar pose.`

### Task 4: `tracking.getHeadPose`

**Files:**
- Modify: `packages/contracts/src/blueprint-nodes/tracking.ts` (definition), `packages/session/src/blueprint-eval/tracking.ts` (evaluator)
- Test: `packages/session/test/tracking-nodes.test.ts`, `packages/contracts/test/blueprint-definitions.test.ts`

**Interfaces:**
- Consumes: `AvatarPose.headPosition`, `boneEuler(pose, 'head')` from `bone-offsets.ts`.
- Produces: node type `tracking.getHeadPose`, label "Get Head Pose", category Tracking, settings `{ entityId }`, data outputs `rotation` (vector3, degrees), `position` (vector3, meters), `tracked` (number).

- [ ] **Step 1: Write the failing tests** (style of the existing `tracking.getBlendShape` tests)

- `rotation` equals `boneEuler(pose, 'head')`; `position` equals `headPosition`, else `[0, 0, 0]`.
- `tracked`: head bone `weight: 0.4` → 0.4; head bone without `weight` → 1; no `head` bone → 0; no pose → 0.
- A removed character throws `Character is unavailable` (Review Focus 4).
- Default settings parse; the definition has the label and category above.

- [ ] **Step 2: Run** `pnpm vitest run --project unit packages/session/test/tracking-nodes.test.ts packages/contracts/test/blueprint-definitions.test.ts` → FAIL.

- [ ] **Step 3: Implement** the definition with `defineNode` and the evaluator (one `data` function that switches on `output`).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `Add the Get Head Pose node.`

### Task 5: Pendulum model

**Files:**
- Create: `packages/session/src/pendulum.ts`
- Test: `packages/session/test/pendulum.test.ts`

**Interfaces:**
- Produces:
  - `type PendulumInputKind = 'headPitch' | 'headYaw' | 'headRoll' | 'headPositionX' | 'headPositionY' | 'headPositionZ' | 'blendShape'`
  - `interface PendulumInput { kind: PendulumInputKind; blendShape: string | null; weight: number; scale: number; absolute: boolean; clamp: [number, number] }`
  - `interface PendulumArm { length: number; mass: number; drag: number; spring: number; damping: number; gravity: number }`
  - `interface PendulumReading { rotation: Vec3; position: Vec3; blendShape: (name: string) => number }`
  - `interface PendulumState { mix: number; mixVelocity: number; angles: number[]; velocities: number[] }`
  - `PENDULUM_ROTATION_UNIT = 1 / 180` (degrees to the input unit; Task 8 measures it)
  - `PENDULUM_MAX_STEP_SECONDS = 0.016`
  - `mixPendulumInputs(inputs: readonly PendulumInput[], reading: PendulumReading): number`
  - `initialPendulumState(arms: number, mix: number): PendulumState`
  - `stepPendulum(state: PendulumState, arms: readonly PendulumArm[], mix: number, inputSmoothing: number, deltaSeconds: number): PendulumState`
  - `pendulumOutput(state: PendulumState): number` (last angle, or `state.mix` with no arms)

`mixPendulumInputs` follows R7: for each input, `reading` is pitch / yaw / roll = `rotation` x / y / z, position x / y / z, or the blend shape. Rotation inputs multiply by `PENDULUM_ROTATION_UNIT`. Then `× scale`, then `abs` when `absolute`, then clamp, then `× weight`. Sum.

`stepPendulum` splits `deltaSeconds` into equal substeps of at most 0.016 s. In each substep it smooths the mix with `smoothDampStep(state.mix, mix, state.mixVelocity, inputSmoothing, h)` (with `inputSmoothing` 0, the mix is the target at once). Then it moves each arm i toward its target (the smoothed mix for arm 0, the angle of arm i−1 for the others) with semi-implicit Euler:

```
a = (SPRING_GAIN·spring·(target − θ) − DAMPING_GAIN·damping·ω − drag·ω·|ω| − GRAVITY_GAIN·gravity·θ / length) / max(mass, 0.01)
ω += a·h;  θ += ω·h
```

Start values: `SPRING_GAIN = 44`, `DAMPING_GAIN = 2.8`, `GRAVITY_GAIN = 10` (about 1.5 Hz and damping ratio 0.3 for the Warudo arm values; tuned in Task 11). A non-finite result resets the state to `initialPendulumState(arms.length, mix)`. `deltaSeconds <= 0` returns the same state.

- [ ] **Step 1: Write the failing tests**

- `mixPendulumInputs`: the Arm Movements inputs (0.33 pitch ×20, 0.33 yaw ×20 abs, 0.5 posZ ×20, clamp −1..1) with rotation `[9, −4.5, 0]` and position `[0, 0, 0.01]` give `0.33·clamp(9/180·20) + 0.33·clamp(|−4.5/180·20|) + 0.5·clamp(0.2)` = `0.33 + 0.165 + 0.1`.
- A `blendShape` input reads `reading.blendShape(name)`.
- `stepPendulum` with step 0 returns an equal state.
- With constant mix 0.5, `gravity` 0, and the Warudo arm values, 10 s of 1/60 s steps give `pendulumOutput` within 0.01 of 0.5.
- With no arms, the output is the smoothed mix; with `inputSmoothing` 0.1, after one 1/60 s step it is between 0 and the target.
- One 1 s step and one 5 s step with mix 1 give a finite output with |output| ≤ 2 (Review Focus 1).
- A step of 1/30 s gives the same result (within 1e−9) as two steps of 1/60 s, because both use the same substeps.

- [ ] **Step 2: Run** `pnpm vitest run --project unit packages/session/test/pendulum.test.ts` → FAIL.

- [ ] **Step 3: Implement** `pendulum.ts` as above.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `Add the pendulum chain model.`

### Task 6: `tracking.pendulum` node and the `rows` field editor

**Files:**
- Modify: `packages/contracts/src/blueprint-nodes/define.ts` (field kind `rows`), `packages/contracts/src/blueprint-nodes/tracking.ts` (definition)
- Modify: `packages/session/src/blueprint-eval/tracking.ts` (evaluator)
- Modify: `apps/desktop/src/components/BlueprintNodeFields.svelte` (rows editor)
- Test: `packages/session/test/tracking-nodes.test.ts`, `packages/contracts/test/blueprint-definitions.test.ts`, `apps/desktop/test/blueprint-fields.test.ts`

**Interfaces:**
- Consumes: Task 5 exports; `RunEnv.tickMs`, `getNodeState` / `setNodeState`.
- Produces: node type `tracking.pendulum`, label "Pendulum", category Tracking. Settings `{ entityId, inputs: PendulumInput[] (1..8), inputSmoothing: number (0..5), arms: PendulumArm[] (0..4) }`. Data output `value` (number). Field kind `rows` with `columns: { key, label, kind: 'number' | 'boolean' | 'choice' | 'range', options? }[]`, `min`, `max`.
- Node state: `PendulumState & { stepMs: number | null }`.

- [ ] **Step 1: Write the failing tests**

- Default settings: one `headYaw` input (weight 1, scale 1, clamp −1..1) and no arms; they parse. 9 inputs or 5 arms fail.
- The node steps once for each `tickMs`: two reads of `value` in one tick give the same number and one state change (Review Focus 2). A new `tickMs` steps again.
- `deltaSeconds` 0 keeps the state.
- A removed character throws `Character is unavailable`.
- The desktop field test: a `rows` field adds a row up to `max`, removes one down to `min`, and edits a number cell, and gives the new settings value.

- [ ] **Step 2: Run** `pnpm vitest run --project unit packages/session/test/tracking-nodes.test.ts packages/contracts/test/blueprint-definitions.test.ts apps/desktop/test/blueprint-fields.test.ts` → FAIL.

- [ ] **Step 3: Implement.** The evaluator builds `PendulumReading` from `previousPose` (`boneEuler(pose, 'head')`, `headPosition` or zero, `trackedBlendShape`) and uses the same due rule as `damped()` in `blueprint-eval/math.ts`. The rows editor uses `@oshi-connect/ui` inputs, one row for each item, with add and remove buttons.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `Add the Pendulum node and a rows field.`

### Task 7: `character.offsetBones` and the skip rule

**Files:**
- Modify: `packages/contracts/src/blueprint-nodes/define.ts` (field kind `bones`), `packages/contracts/src/blueprint-nodes/character.ts`
- Modify: `packages/session/src/blueprint-eval/character.ts`
- Modify: `apps/desktop/src/components/BlueprintNodeFields.svelte` (bones editor, like `meshes`)
- Test: `packages/session/test/bone-offsets.test.ts`, `packages/contracts/test/blueprint-definitions.test.ts`, `apps/desktop/test/blueprint-fields.test.ts`

**Interfaces:**
- Consumes: `BoneOffsetEffect`, `bodyPartOf(bone)`, the character `tracking` assignment (body source, `trackedParts`, fingers source).
- Produces: node type `character.offsetBones`, label "Offset Bones", category Character. Settings `{ entityId, bones: HumanoidBone[] (1..32), axis: 'x' | 'y' | 'z', intensity: number (−360..360), offset: number (−360..360) }`. Flow inputs `value` (number, default 0), `weight` (number, default 1). Exported pure `offsetBonesSkipped(scene: SceneView, entityId: Id, bone: string): boolean`.

- [ ] **Step 1: Write the failing tests**

- Bones `['leftUpperArm', 'rightUpperArm']`, axis z, intensity 2, offset 5, value 3, weight 0.5 → two `offsetBone` effects with euler `[0, 0, 5.5]`.
- value 1000, intensity 360 → angle 360 (clamp).
- Skip rule (R9): a body source with no `body` group skips all body bones; a body source with `trackedParts: ['head']` skips only head-part bones and emits the arm; a fingers source skips finger bones and emits the arm; a face source only skips nothing (Review Focus 3).
- A removed character throws `Character is unavailable`.
- The bones field adds and removes humanoid bones and keeps 1..32.

- [ ] **Step 2: Run** `pnpm vitest run --project unit packages/session/test/bone-offsets.test.ts packages/contracts/test/blueprint-definitions.test.ts apps/desktop/test/blueprint-fields.test.ts` → FAIL.

- [ ] **Step 3: Implement** the definition, the evaluator (one effect for each bone that `offsetBonesSkipped` does not skip), and the field.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `Add the Offset Bones node with the tracked-part skip rule.`

### Task 8: Measure the Warudo pendulum input unit

**Files:**
- Modify: `packages/session/src/pendulum.ts` (`PENDULUM_ROTATION_UNIT`, if the measurement differs)
- Modify: `docs/evaluation/warudo-face-reference/README.md` (the measurement)

This task has no unit test. It sets one constant from evidence.

- [ ] **Step 1: Ask the owner** for consent to turn on pendulum physics in the VM scene for the measurement, with no save.
- [ ] **Step 2: Measure.** In the iFacialMocap Receiver, read the "Arm Movements" input label (`33% Head Rotation Y a → b`) through `GET /api/openedScene` while the head is at a known yaw (from the receiver head rotation). Record pairs (head degrees, input value) for at least three angles.
- [ ] **Step 3: Set** `PENDULUM_ROTATION_UNIT` to the fitted ratio. Run `pnpm vitest run --project unit packages/session/test/pendulum.test.ts`; update the expected mix of the Task 5 test only if the constant changed.
- [ ] **Step 4: Restore** the Warudo setting. Do not save the scene.
- [ ] **Step 5: Commit** — `Record the Warudo pendulum input unit.`

If the owner does not agree, keep 1/180, record "not measured" in the README, and continue.

### Task 9: Template, Templates menu, and MCP

**Files:**
- Create: `packages/contracts/src/blueprint-templates/face-only-body-motion.json`
- Modify: `packages/contracts/src/blueprint-templates/index.ts`
- Modify: `apps/desktop/src/blueprints/templates.ts` (`TEMPLATES`, the two exports that use `TEMPLATES[0]` and `TEMPLATES[1]`)
- Modify: `apps/mcp/src/blueprint-files.ts` (`BlueprintImportParams`)
- Test: `packages/contracts/test/blueprint-templates.test.ts`, `apps/desktop/test/blueprint-templates.test.ts`, `apps/mcp/test/blueprint-files.integration.test.ts`, `packages/session/test/blueprint-session.test.ts`

**Interfaces:**
- Consumes: the three node types (Tasks 4, 6, 7), `math.smoothDamp`, existing math and vector3 nodes.
- Produces: `faceOnlyBodyMotionTemplate(avatar: { id: string; name: string }): BlueprintFile` (graph name "Face-Only Body Motion"). Desktop export `faceOnlyBodyMotion`. MCP `BlueprintImportParams = { sceneId, file } | { sceneId, template: 'face-only-body-motion', avatarId }`.

Template chains (R10, values from the Warudo reference):
- Fade: `getHeadPose.tracked` → `math.smoothDamp` (smoothTime 2) → `weight` of every Offset Bones node.
- Body follows head: for each axis, the body angle is head rotation × direction (0.5, 1, 0.5) × intensity 0.5 × sign (+1, +1, −1). Offset Bones on spine (body angle × 0.5) and chest (× 0.25); hips (× 0) is left out. The neck gets −0.75 × (spine + chest share), so the head keeps most of its tracked direction. One Offset Bones node for each bone and axis; the factor goes in `intensity`.
- Body Lean: one pendulum (input `headPositionZ`, weight 1, scale 5, clamp 0..1.5, smoothing 0.4, no arms) → spine X +45, neck X −15, head X −40.
- Arm Movements: one pendulum (the Task 5 inputs, smoothing 0.1, four arms 10 / 0.25 / 0.25 / 0.5 / 0.5 / 1) → right shoulder Z +2 offset +5, left shoulder Z −2 offset −5, upper arms Z ±2, lower arms Z ±2, hands Z ±10 (signs from `pendulum-presets.txt`).
- Finger Movements: one pendulum (the same inputs and arms) → 12 finger bones Z ±10, 3 thumb bones Y ±10 for each hand (bones and signs from `pendulum-presets.txt`).

- [ ] **Step 1: Write the failing tests**

- Contracts: the template parses as a `BlueprintFile`, has ≤ 128 nodes and ≤ 256 connections, every node targets `avatar.id`, and the arm pendulum settings equal the reference values.
- Desktop: `availableTemplates(scene).map(t => t.label)` equals `['Face-Only Body Motion', 'Camera Sway']`. `upperBodyRotationTemplate` is still exported from contracts. Update the existing Upper Body Rotation menu test to the new label.
- Session (`blueprint-session.test.ts`): import the template for the smoke avatar, give a face-only pose with head yaw 20° and `headPosition [0, 0, 0.05]` for 2 s of ticks; the offset layer has a non-zero spine Y rotation, a non-zero spine X rotation, and non-zero arm offsets. With the head bone weight 0 for 3 s, all offsets fall below 1°.
- MCP integration: `blueprint_import` with `{ sceneId, template: 'face-only-body-motion', avatarId }` creates a graph named "Face-Only Body Motion"; an unknown avatar gives a validation error; a call with both `file` and `template` fails.

- [ ] **Step 2: Run** `pnpm vitest run --project unit packages/contracts/test/blueprint-templates.test.ts apps/desktop/test/blueprint-templates.test.ts packages/session/test/blueprint-session.test.ts` and `pnpm vitest run --project integration apps/mcp/test/blueprint-files.integration.test.ts` → FAIL.

- [ ] **Step 3: Implement.** Write the JSON with a placeholder character id that the builder replaces, as `upper-body-rotation.json` does. Replace the menu entry. Add the MCP union and call the same builder and `importBlueprint`.

- [ ] **Step 4: Run** the Step 2 commands → PASS.

- [ ] **Step 5: Commit** — `Add the Face-Only Body Motion template to the menu and MCP.`

### Task 10: Tracking guide creates and removes the graph

**Files:**
- Modify: `apps/desktop/src/editor/tracking-guide-plan.ts` (`GuideSnapshot`, a new pure function)
- Modify: `apps/desktop/src/components/TrackingGuide.svelte` (after connect, and Cancel)
- Test: `apps/desktop/test/tracking-guide-plan.test.ts`, `apps/desktop/test/tracking-guide-setup.integration.test.ts`

**Interfaces:**
- Consumes: `faceOnlyBodyMotionTemplate`, `importBlueprint`, `BlueprintSync.edit(ops)` with `createGraph` and `removeGraph`.
- Produces: `GuideSnapshot.graphId?: Id`. `faceOnlyMotionNeeded(scene: SceneView, avatarId: Id, plan: Extract<SetupPlan, { ops: PatchOp[] }>, graphs: readonly BlueprintGraph[]): boolean`.

- [ ] **Step 1: Write the failing tests**

- `faceOnlyMotionNeeded` is true for a plan with a face part and no body part, fewer than 8 graphs, and no graph named "Face-Only Body Motion" that targets the character. It is false with a body part, with 8 graphs, or with that graph present.
- Integration: a guide run with a face-only plan calls `edit` with one `createGraph` op and stores `graphId`. Cancel calls `edit` with `removeGraph` for `graphId`. A failed connect creates no graph.

- [ ] **Step 2: Run** `pnpm vitest run --project unit apps/desktop/test/tracking-guide-plan.test.ts` and `pnpm vitest run --project integration apps/desktop/test/tracking-guide-setup.integration.test.ts` → FAIL.

- [ ] **Step 3: Implement.** Create the graph only after a successful connect. Keep the scene patch and the graph edit as two separate operations (they use different channels).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `Add Face-Only Body Motion from the tracking guide and remove it on Cancel.`

### Task 11: macOS and OBS check, tuning, and documents

**Files:**
- Create: `docs/evaluation/face-only-body-motion.md`
- Modify: `docs/warudo-parity.md` (TRK-06 note, BP-11), `ARCHITECTURE.md` (the `headPosition` data path and the three nodes), the design doc "Verification" status
- Modify (tuning only): `packages/session/src/pendulum.ts` gains constants

- [ ] **Step 1: Build from this worktree** immediately before the run: `direnv exec . pnpm tauri dev` (see the memory notes on the shared target and the running dev app; check `pgrep` first).
- [ ] **Step 2: Live check** with the Catboy avatar and a real iFacialMocap source (and MediaPipe if a camera is available): the tracking guide adds the graph; head yaw turns the body; a lean toward the camera leans the spine; arms and fingers sway and settle; covering the camera fades the motion out in about 2 s; the editor minimized keeps the motion (OBS output).
- [ ] **Step 3: Confirm the head position units and signs.** A 5 cm lean toward the camera gives `headPosition` Z of about +0.05 (read through MCP). Fix the scale constant or sign of Task 1 or Task 2 if not, with a test change.
- [ ] **Step 4: Compare with Warudo** side by side (same motion, both recorded). Tune `SPRING_GAIN`, `DAMPING_GAIN`, `GRAVITY_GAIN` only. Re-run `pnpm vitest run --project unit packages/session/test/pendulum.test.ts`.
- [ ] **Step 5: OBS evidence.** Record a short local test recording and screenshots through ws://127.0.0.1:4455 with isolated OpenSekai test sources. Do not stream. Record backend, quality profile, fixture revision, and commit in the evaluation doc.
- [ ] **Step 6: Owner look review.** Ask the owner to look at the recording. Record the result. Do not claim the look until the owner agrees.
- [ ] **Step 7: Documents.** Parity: record only the verified subset; TRK-06 stays unchecked. ARCHITECTURE.md: the new data path and nodes. Run `pnpm test:unit`, `pnpm test:integration`, and `direnv exec . cargo test -p opensekai-desktop -p opensekai-contracts`.
- [ ] **Step 8: Commit** — `Record the face-only body motion check.` Then `direnv exec . cargo sweep --time 7`.
