# Bouncy Live2D Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Face-only characters get an optional Live2D-style vertical bounce (spine/chest Y + uniform scale) from head pitch and jaw open, owned by Blueprint nodes on the Face-Only Body Motion template, smooth at OBS 60 FPS.

**Architecture:** A pure damped spring in the session feeds new Blueprint writers for bone translation and uniform scale. Those writers extend the bone-offset layer (rotation stays as today; translation and scale are sibling fields on `AvatarPose`). The Face-Only Body Motion template wires the chain behind `Bouncy Motion` / `Bouncy Intensity` variables. Renderers and VMC send apply the same pose fields.

**Tech Stack:** TypeScript (zod contracts, session worker, three-vrm renderer), Rust contracts crate, vitest, cargo test, Svelte Blueprint Variables (existing).

**Spec:** [design](../specs/2026-11-21-bouncy-live2d-motion-design.md), Issue [#294](https://github.com/danirukun/opensekai/issues/294).

## Global Constraints

- Work only in the worktree `.worktrees/bouncy-motion-294` on branch `feat/bouncy-motion-294`. Verify `pwd` before Git. No `git -C`. No agent attribution. Do not push until asked.
- pnpm only. Compile Rust through `direnv exec . <command>`. Shared Cargo target: `$HOME/.cache/opensekai/target`.
- Functional TypeScript. Comments only when logic is hard to follow. UI: field labels only (constitution 1).
- Session owns spring state. Do not add a second spring in the renderer.
- Face-only gate: reuse `offsetBonesSkipped` (body source skips covered bones).
- Additive with existing Face-Only rotation offsets.
- Long prose in ASD-STE100.
- QA: OBS `ws://127.0.0.1:4455`, no stream. Catboy ARKit VRM when available.

## File map

| File | Role |
| --- | --- |
| `packages/session/src/bouncy-spring.ts` | Pure spring + drive mix (new) |
| `packages/session/test/bouncy-spring.test.ts` | Unit tests for spring (new) |
| `packages/contracts/src/tracking.ts` | `boneTranslations` / `boneScales` on `AvatarPose` |
| `crates/contracts/src/tracking.rs` | Rust mirrors |
| `packages/session/src/bone-offsets.ts` | Layer + writers for translation/scale |
| `packages/session/src/blueprint.ts` | Effect union / `isBoneOffsetEffect` |
| `packages/session/src/session.ts` | Apply new effect kinds (if dispatch changes) |
| `packages/contracts/src/blueprint-nodes/tracking.ts` | `tracking.bouncySpring` |
| `packages/contracts/src/blueprint-nodes/character.ts` | translation + scale nodes |
| `packages/session/src/blueprint-eval/tracking.ts` | Bouncy spring evaluator |
| `packages/session/src/blueprint-eval/character.ts` | Writer evaluators |
| `packages/renderer/src/avatar-pose.ts` | Apply translation + scale |
| `packages/session/src/vmc-send.ts` | Same composition |
| `packages/contracts/src/blueprint-templates/face-only-body-motion.json` | Wire bouncy chain |
| `ARCHITECTURE.md`, `docs/vpoyo-gaps.md`, SPDD, evaluation | Docs / evidence |

## Review focus

1. **Hidden window:** 1 s session tick must keep spring finite (cap delta like Pendulum, `Math.min(delta, 1)`).
2. **Double read:** two downstream nodes reading `bouncySpring.value` in one tick must step once (`stepMs` rule like Pendulum).
3. **Body source later:** writers must skip spine/chest when a body source tracks those parts.
4. **Toggle default off:** new Face-Only graphs have `Bouncy Motion` false; no bounce until enabled.
5. **Parity:** editor, OBS, and VMC send use the same translation/scale pose fields.

---

### Task 1: Pure bouncy spring module

**Files:**
- Create: `packages/session/src/bouncy-spring.ts`
- Create: `packages/session/test/bouncy-spring.test.ts`

**Interfaces:**
- Produces:
  - `BOUNCY_ROTATION_UNIT = 1/180` (same as `PENDULUM_ROTATION_UNIT`)
  - `BOUNCY_MAX_STEP_SECONDS = 0.016`
  - `BouncySpringState = { mix: number; mixVelocity: number; position: number; velocity: number }`
  - `BouncyDrive = { pitchWeight: number; pitchScale: number; jawWeight: number; jawScale: number; pitchClamp: [number, number]; jawClamp: [number, number] }`
  - `mixBouncyDrive(pitchDeg: number, jawOpen: number, drive: BouncyDrive): number` — pitch uses `pitchDeg * BOUNCY_ROTATION_UNIT`; jaw is 0..1; each term is `clamp(value * scale, clamp) * weight`; sum; **negate** so chin-down (positive pitch in pose frame) and jaw open give negative drive (sink).
  - `initialBouncySpringState(mix: number): BouncySpringState`
  - `stepBouncySpring(state, driveTarget: number, spring: number, damping: number, inputSmoothing: number, deltaSeconds: number): BouncySpringState` — smooth `mix` toward `driveTarget` when `inputSmoothing > 0` (reuse `smoothDampStep` from `blueprint-eval/math.ts`); spring toward mix with gains `SPRING_GAIN = 44`, `DAMPING_GAIN = 2.8` times settings (same family as Pendulum, no gravity term); substep ≤ 16 ms; non-finite → re-init at `driveTarget`.
  - `bouncySpringOutput(state): number` → `state.position`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  BOUNCY_MAX_STEP_SECONDS, mixBouncyDrive, initialBouncySpringState, stepBouncySpring, bouncySpringOutput, type BouncyDrive
} from '../src/bouncy-spring';

const drive: BouncyDrive = {
  pitchWeight: 1, pitchScale: 1, jawWeight: 0.5, jawScale: 1,
  pitchClamp: [-1, 1], jawClamp: [0, 1]
};

describe('mixBouncyDrive', () => {
  it('sinks on chin-down pitch and jaw open, rises on chin-up', () => {
    expect(mixBouncyDrive(90, 0, drive)).toBeLessThan(0);
    expect(mixBouncyDrive(-90, 0, drive)).toBeGreaterThan(0);
    expect(mixBouncyDrive(0, 1, drive)).toBeLessThan(mixBouncyDrive(0, 0, drive));
  });
});

describe('stepBouncySpring', () => {
  it('moves toward a sink target and settles', () => {
    let state = initialBouncySpringState(0);
    for (let i = 0; i < 120; i++) state = stepBouncySpring(state, -0.5, 0.5, 0.5, 0.05, 1 / 60);
    expect(bouncySpringOutput(state)).toBeLessThan(-0.2);
    expect(Math.abs(state.velocity)).toBeLessThan(0.05);
  });
  it('stays finite on a 1 s step', () => {
    const state = stepBouncySpring(initialBouncySpringState(0), -1, 0.5, 0.5, 0.05, 1);
    expect(Number.isFinite(bouncySpringOutput(state))).toBe(true);
  });
  it('uses substeps at most 16 ms', () => {
    expect(BOUNCY_MAX_STEP_SECONDS).toBe(0.016);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm vitest run --project unit packages/session/test/bouncy-spring.test.ts`  
Expected: FAIL (module missing)

- [ ] **Step 3: Implement** `bouncy-spring.ts` as specified in Interfaces.

- [ ] **Step 4: Run to verify pass** — same command → PASS

- [ ] **Step 5: Commit**

```bash
git add packages/session/src/bouncy-spring.ts packages/session/test/bouncy-spring.test.ts
git commit -m "$(cat <<'EOF'
Add the pure bouncy spring drive for Live2D-style motion.

EOF
)"
```

---

### Task 2: Pose fields for bone translation and scale

**Files:**
- Modify: `packages/contracts/src/tracking.ts` (`AvatarPose`, `AvatarPoseSchema`)
- Modify: `crates/contracts/src/tracking.rs` (`AvatarPose`, `Validate`)
- Modify: `crates/contracts/tests/tracking.rs`
- Modify: `packages/contracts/test/live-tracking.test.ts` (accept/omit new keys)

**Interfaces:**
- Produces on `AvatarPose`:
  - `boneTranslations?: Record<string, Vec3>` — local meters, humanoid bones, ≤55 keys
  - `boneScales?: Record<string, number>` — uniform scale, finite, clamp validate 0.5..1.5 inclusive
- Keep `boneOffsets?: Record<string, Quat>` unchanged (rotation only).
- Rust: `bone_translations: Option<BTreeMap<String, [f64; 3]>>`, `bone_scales: Option<BTreeMap<String, f64>>` with serde rename camelCase, skip if none.

- [ ] **Step 1: Write failing tests**

TS: parse pose with `boneTranslations: { spine: [0, -0.02, 0] }` and `boneScales: { chest: 0.95 }`; omit when absent; reject scale `0.4` and non-humanoid bone name.

Rust: `validate_value` accepts the same JSON; rejects bad scale / unknown bone.

- [ ] **Step 2: Run**

`pnpm vitest run --project unit packages/contracts/test/live-tracking.test.ts` → FAIL  
`direnv exec . cargo test -p opensekai-contracts --test tracking` → FAIL (or the crate’s tracking tests)

- [ ] **Step 3: Implement** schema + Rust mirrors + validation.

- [ ] **Step 4: Run** same commands → PASS

- [ ] **Step 5: Commit** — `Add bone translation and scale fields to avatar poses.`

---

### Task 3: Session bone-offset layer writers

**Files:**
- Modify: `packages/session/src/bone-offsets.ts`
- Modify: `packages/session/src/blueprint.ts` (`isBoneOffsetEffect`)
- Modify: `packages/session/src/session.ts` only if effect filter needs updating
- Test: `packages/session/test/bone-offsets.test.ts`

**Interfaces:**
- Extend effects:
  - Existing: `BoneOffsetEffect = { kind: 'offsetBone'; entityId; bone; euler }`
  - `BoneTranslationEffect = { kind: 'offsetBoneTranslation'; entityId: Id; bone: string; translation: Vec3 }`
  - `BoneScaleEffect = { kind: 'offsetBoneScale'; entityId: Id; bone: string; scale: number }`
  - `BoneLayerEffect = BoneOffsetEffect | BoneTranslationEffect | BoneScaleEffect`
- Layer entry per bone: `{ rotation: Quat; translation: Vec3; scale: number }` with defaults `IDENTITY`, `[0,0,0]`, `1`.
- `BoneOffsets = ReadonlyMap<Id, ReadonlyMap<string, BoneLayerEntry>>`
- `writeBoneOffset` keeps multiplying rotation (migrate internal map to store full entry).
- `writeBoneTranslation(layer, scene, effect)`: adds translation component-wise; reject non-finite or |component| > 2.
- `writeBoneScale(layer, scene, effect)`: sets `scale = clamp(current * effect.scale, 0.5, 1.5)` **or** absolute assign of `effect.scale` already clamped by the evaluator — prefer **assign** the evaluated scale (1 + delta) so multiple writers on the same bone in one tick: later write wins (document in test). Simpler: **multiply** relative factors from 1: `next = clamp(current * factor, 0.5, 1.5)` where factor is the effect’s scale value.
  - Spec: evaluator emits absolute uniform scale `1 + weight*(value*intensity+offset)`. Writer **assigns** that absolute scale (last write wins). Tests cover assign.
- `composeBoneOffsets(poses, layer)`: write `boneOffsets` (rotation only, omit identity), `boneTranslations` (omit zero), `boneScales` (omit 1).
- `isBoneOffsetEffect`: `kind === 'offsetBone' || kind === 'offsetBoneTranslation' || kind === 'offsetBoneScale'`
- Session loop: dispatch `writeBoneOffset` / `writeBoneTranslation` / `writeBoneScale` by kind (small switch).

- [ ] **Step 1: Failing tests** in `bone-offsets.test.ts` for translation add, scale assign, compose fields, skip invalid entity.

- [ ] **Step 2: Run** `pnpm vitest run --project unit packages/session/test/bone-offsets.test.ts` → FAIL

- [ ] **Step 3: Implement** layer + writers + compose + session dispatch + blueprint type union.

- [ ] **Step 4: Run** same + existing bone-offset / upper-body-rotation session tests → PASS

- [ ] **Step 5: Commit** — `Extend the bone offset layer with translation and scale.`

---

### Task 4: Renderer and VMC send apply translation and scale

**Files:**
- Modify: `packages/renderer/src/avatar-pose.ts`
- Modify: `packages/session/src/vmc-send.ts`
- Test: `packages/renderer/test/avatar-pose.test.ts`
- Test: `packages/session/test/vmc-send.test.ts`
- Integration if present: `packages/renderer/test/vmc-send-parity.integration.test.ts` (extend only if cheap)

**Interfaces:**
- After rotation offsets on a bone, add `boneTranslations[name]` to the normalized (or raw) local position; multiply local scale by `boneScales[name]` (default 1).
- VRM 0 sign: translation X and Z follow the same `sign` as position tracking (`x*sign`, `y`, `z*sign`).
- Chestless rig: merge chest translation/scale into spine the same way rotation/chest merge works today (add translation through chest rotation if needed; for v1, if chest maps to spine, **add** translations and **multiply** scales onto spine).
- VMC send: apply the same translation into raw bone `position` and note scale is **not** in VMC protocol — document in test comment that scale is renderer-only on the wire; still apply translation so bounce Y is sent. (If VMC has no scale, OBS still shows squash; VMC receivers see Y only. Record as Known difference in evaluation later.)

- [ ] **Step 1: Failing renderer test** — pose with `boneTranslations.spine = [0, -0.05, 0]` and `boneScales.spine = 0.9` moves/scales the spine node vs baseline.

- [ ] **Step 2: Run** renderer unit test → FAIL

- [ ] **Step 3: Implement** renderer + VMC translation parity.

- [ ] **Step 4: Run** renderer + vmc-send unit tests → PASS

- [ ] **Step 5: Commit** — `Apply bone translation and scale in the renderer and VMC send.`

---

### Task 5: Blueprint node definitions

**Files:**
- Modify: `packages/contracts/src/blueprint-nodes/tracking.ts`
- Modify: `packages/contracts/src/blueprint-nodes/character.ts`
- Test: `packages/contracts/test/blueprint-definitions.test.ts`

**Interfaces:**
- `tracking.bouncySpring` (data):
  - Settings: `entityId`, `pitchWeight`, `pitchScale`, `jawWeight`, `jawScale`, `spring` (0..100), `damping` (0..100), `inputSmoothing` (0..5)
  - Ports: outputs `{ value: 'number' }`
  - Defaults when `avatarId`: `{ entityId, pitchWeight: 1, pitchScale: 1, jawWeight: 0.5, jawScale: 1, spring: 0.5, damping: 0.5, inputSmoothing: 0.05 }`
  - Fields: Character + number fields with labels `Pitch weight`, `Pitch scale`, `Jaw weight`, `Jaw scale`, `Spring`, `Damping`, `Input smoothing (s)`
- `character.offsetBoneTranslation` (flow): same shape as `offsetBones` but intensity/offset in meters (−2..2); keywords include `translation`, `bounce`, `position`
- `character.offsetBoneScale` (flow): settings `entityId`, `bones`, `intensity` (−1..1), `offset` (−1..1); no axis; scale formula in evaluator
- Export types via existing `CHARACTER_NODES` / `TRACKING_NODES` registration (ensure catalog picks them up automatically).

- [ ] **Step 1: Failing definition tests** — catalog contains the three types; defaults and required settings match.

- [ ] **Step 2: Run** `pnpm vitest run --project unit packages/contracts/test/blueprint-definitions.test.ts` → FAIL

- [ ] **Step 3: Implement** node defs.

- [ ] **Step 4: Run** → PASS

- [ ] **Step 5: Commit** — `Define Blueprint nodes for bouncy spring and bone transform offsets.`

---

### Task 6: Evaluators

**Files:**
- Modify: `packages/session/src/blueprint-eval/tracking.ts`
- Modify: `packages/session/src/blueprint-eval/character.ts`
- Test: `packages/session/test/bone-offsets.test.ts` (Offset Bones-style graph cases) or new `packages/session/test/bouncy-motion-nodes.test.ts`

**Interfaces:**
- `tracking.bouncySpring` data evaluator: mirror Pendulum `stepMs` due rule; `characterPose`; `mixBouncyDrive(boneEuler(pose,'head')[0], trackedBlendShape(pose,'jawOpen'), …settings)`; `stepBouncySpring`; return `bouncySpringOutput`. Cap `deltaSeconds` with `Math.min(env.deltaSeconds, 1)`.
- `character.offsetBoneTranslation`: `delta = weight * (value * intensity + offset)` on axis; `emitEach` non-skipped bones with `{ kind: 'offsetBoneTranslation', translation }`.
- `character.offsetBoneScale`: `scale = clamp(1 + weight * (value * intensity + offset), 0.5, 1.5)`; emit `{ kind: 'offsetBoneScale', scale }`.
- Both writers call `offsetBonesSkipped` like `character.offsetBones`.

- [ ] **Step 1: Failing tests**
  - Spring node sinks after many 60 Hz ticks with fixed head pitch 45° and jaw 0.
  - Translation writer emits Y on spine; skipped when body source present.
  - Scale writer emits ~0.95 for negative value.
  - Double read same tick: one step only (spy via equal outputs / stable state).

- [ ] **Step 2: Run** unit tests → FAIL

- [ ] **Step 3: Implement** evaluators.

- [ ] **Step 4: Run** → PASS

- [ ] **Step 5: Commit** — `Evaluate bouncy spring and bone translation and scale nodes.`

---

### Task 7: Face-Only Body Motion template

**Files:**
- Modify: `packages/contracts/src/blueprint-templates/face-only-body-motion.json`
- Modify: `packages/contracts/test/blueprint-templates.test.ts`
- Keep `faceOnlyBodyMotionTemplate` remap as today (entity ids).

**Interfaces / graph shape to add:**

Variables (append):
- `{ id: "bouncy-motion", name: "Bouncy Motion", type: "boolean", default: false }`
- `{ id: "bouncy-intensity", name: "Bouncy Intensity", type: "number", default: 0.5 }`

Nodes (new ids; keep under 128 total — check current count first):
- `bouncy` — `tracking.bouncySpring` with template defaults (entityId `character`)
- `bouncy-intensity` — `variable.getNumber` → variableId `bouncy-intensity`
- `bouncy-enabled` — `variable.getBoolean` → `bouncy-motion`
- `bouncy-scaled` — `math.multiply` (a=bouncy.value, b=intensity)
- `bouncy-gated` — `flow.select` type `number`, condition=enabled, ifTrue=scaled, ifFalse literal `0` (unconnected or `value.number` node `bouncy-zero` with value 0)
- `bouncy-y` — `character.offsetBoneTranslation` bones `["spine","chest"]`, axis `y`, intensity `0.08`, offset `0`
- `bouncy-scale` — `character.offsetBoneScale` bones `["spine","chest"]`, intensity `0.05`, offset `0`

Connections:
- Flow: extend the On Update chain so after the last existing offset (or a dedicated branch from the same update spine) both `bouncy-y` and `bouncy-scale` receive flow (sequence: … → `bouncy-y` → `bouncy-scale`, or parallel from a `flow.sequence` / existing exit chain — **match the template’s current pattern**: one linear flow through all offset nodes; append `bouncy-y` then `bouncy-scale` at the end of the offset flow chain).
- Data: `bouncy`→`bouncy-scaled`→`bouncy-gated`→ value into both writers; `fade.result` → weight on both writers (same as other offsets).

- [ ] **Step 1: Failing template tests** — variables include Bouncy Motion false and Bouncy Intensity 0.5; nodes/types present; writers use fade weight; gated select present; connection types valid; node/connection counts ≤ limits.

- [ ] **Step 2: Run** `pnpm vitest run --project unit packages/contracts/test/blueprint-templates.test.ts` → FAIL

- [ ] **Step 3: Edit JSON** carefully (preserve existing ids). Re-run template test; fix until PASS. If node limit is tight, remove no existing features — only add the minimal chain.

- [ ] **Step 4: Run** template + definition tests → PASS

- [ ] **Step 5: Commit** — `Wire bouncy Live2D motion into the Face-Only Body Motion template.`

---

### Task 8: Docs, SPDD, architecture map

**Files:**
- Modify: `ARCHITECTURE.md` (Blueprint bone offsets may include translation and scale; Face-Only template optional bouncy chain; session owns spring)
- Modify: `docs/vpoyo-gaps.md` gap 2 — status “In progress” or leave Missing until evidence; after Task 9 set Partial/Done with link
- Create: `spdd/analysis/2026-11-21-bouncy-live2d-motion.md` (short requirements)
- Create: `spdd/prompt/2026-11-21-bouncy-live2d-motion.md` (seven REASONS R1–Rn matching this plan)
- Create: `docs/evaluation/bouncy-live2d-motion.md` stub (checklist empty until Task 9)
- Mark design status approved in the spec header if not already

- [ ] **Step 1: Write SPDD analysis + REASONS** covering spring, nodes, pose fields, template variables, face-only skip, OBS evidence.

- [ ] **Step 2: Update ARCHITECTURE.md** in the same change as the feature landing commits if not already — this task may ride with Task 7 or be its own commit.

- [ ] **Step 3: Commit** — `Document bouncy Live2D motion contracts and architecture.`

---

### Task 9: macOS OBS evidence

**Files:**
- Modify: `docs/evaluation/bouncy-live2d-motion.md`
- Modify: `docs/vpoyo-gaps.md` gap 2 when verified

**Steps:**
- [ ] Build and run desktop from this worktree: `direnv exec .` + project’s usual Tauri/dev command (see `docs/qa.md` / handbook).
- [ ] Face-only character + Face-Only Body Motion graph; enable `Bouncy Motion`; set Intensity ~0.5–1.
- [ ] Confirm sink on chin-down / jaw, rise on chin-up in editor and OBS; no visible jitter at ~60 FPS; motion continues if editor minimized.
- [ ] Record commit, backend (WebGPU/WebGL), quality profile, asset id in evaluation doc.
- [ ] Commit evidence — `Record the bouncy Live2D motion OBS check.`

---

## Self-review (plan vs spec)

| Spec item | Task |
| --- | --- |
| Pure spring, pitch+jaw weighted sum, sink/rise signs | Task 1 |
| `tracking.bouncySpring` | Tasks 5–6 |
| Translation + scale writers | Tasks 5–6 |
| Pose translation/scale fields; renderer + VMC | Tasks 2–4 |
| Face-Only template + variables default off | Task 7 |
| Additive + `offsetBonesSkipped` | Tasks 6–7 |
| Unit tests spring | Task 1 |
| OBS 60 FPS evidence | Task 9 |
| ARCHITECTURE / vpoyo-gaps | Tasks 8–9 |
| No character Inspector v1 | (no task — intentional) |
| Worktree | Global constraints |

No TBD placeholders. Types: `boneTranslations` / `boneScales` sibling fields; effect kinds `offsetBoneTranslation` / `offsetBoneScale`; spring API as Task 1.
