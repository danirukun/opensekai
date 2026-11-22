# Pose presets (Warudo-like) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Face-only characters get Warudo-like Animation controls — a full overlaying-pose list (rest, selfie, wave loop, mic, controller), Override Hand Poses, and Hand Pin — switchable from Inspector / hotkey / Blueprint, blended, saved in the show.

**Architecture:** Session owns evaluation. Avatar stores overlay list + hand overrides + hand pin. Overlays and hand shapes are built-in normalized bone libraries (no `.anim` import). Compose: idle → tracking → overlays (list priority) → hand poses → hand pin → Blueprint `boneOffsets`. Active overlays suppress Face-Only arm/finger pendulum on covered bones. Wave is a short procedural loop; other overlays are held poses.

**Tech Stack:** TypeScript (zod contracts, session, Svelte inspector), Rust contracts crate, vitest, cargo test, existing Blueprint/hotkey paths.

**Spec:** [design](../specs/2026-11-22-pose-presets-face-only-design.md), Issue [#296](https://github.com/danirukun/opensekai/issues/296).

## Global Constraints

- Worktree: `.worktrees/pose-presets-296`, branch `feat/pose-presets-296`. Verify `pwd` before Git. No `git -C`. No agent attribution. Do not push until asked.
- pnpm only. Rust: `direnv exec . <command>`. Shared Cargo target `$HOME/.cache/opensekai/target`.
- Functional TypeScript. UI labels only (constitution 1). No second UI kit.
- Spec first: keep SPDD analysis/prompt, design, `ARCHITECTURE.md`, `docs/vpoyo-gaps.md`, `docs/warudo-parity.md` in sync.
- No Mixamo/AGIA import (CHR-04 later). No full Look At / foot IK (CHR-06 later beyond Hand Pin).
- Long prose ASD-STE100. Unit tests for blend / wave loop / pin; headless editor for Inspector round-trip; OBS evidence later, never claim as zero.

## File map

| File | Role |
| --- | --- |
| `packages/contracts/src/avatar-animation.ts` (new) | Overlay / hand pose / hand pin schemas, ids, defaults |
| `packages/contracts/src/schema.ts`, `types.ts` | Avatar fields + patch ops |
| `crates/contracts/src/*.rs` | Rust mirrors + round-trip |
| `packages/session/src/overlay-poses.ts` (new) | Built-in overlay bone libraries + wave loop eval |
| `packages/session/src/hand-poses.ts` (new) | Built-in finger shape libraries |
| `packages/session/src/hand-pin.ts` (new) | Pin state + arm chain toward wrist target |
| `packages/session/src/avatar-animation-compose.ts` (new) | Blend overlays + hands + pin onto poses |
| `packages/session/src/tracking.ts` / `session.ts` | Hook compose after tracking, before blueprints |
| `packages/session/src/scene-ops.ts` | Patch ops |
| `packages/contracts/src/blueprint-nodes/character.ts` | Set Overlay Pose / Set Hand Pose / Set Hand Pin nodes |
| `packages/session/src/blueprint-eval/character.ts` | Node evaluators → patch effects or direct animation layer |
| `apps/desktop/src/components/` Animation inspector fields | Warudo-shaped UI |
| `apps/desktop/src/editor/model.ts` | Commit helpers |
| `ARCHITECTURE.md`, SPDD, parity, `docs/vpoyo-gaps.md`, evaluation | Docs |

## Review focus

1. **Pose switch mid-stream:** A→B over `overlayTransitionSeconds` must be continuous; no snap when list order changes only non-overlapping bones.
2. **Face-only + overlay:** Head/chest still move from face; arms follow overlay; arm pendulum from Face-Only template does not fight overlay bones.
3. **High Priority hand pose:** With fingers tracked, `highPriority: true` replaces fingers; `false` leaves tracking.
4. **Hand pin + head yaw:** Wrists stay near pin targets while head yaw changes ±30°.
5. **Wave loop clock:** Uses session animation elapsed (like idle), not wall clock; minimized editor keeps motion.

---

### Task 1: SPDD + contracts for avatar Animation

**Files:**
- Create: `spdd/analysis/2026-11-22-pose-presets-face-only.md`, `spdd/prompt/2026-11-22-pose-presets-face-only.md` (REASONS from design)
- Create: `packages/contracts/src/avatar-animation.ts`
- Modify: `packages/contracts/src/schema.ts`, `types.ts`, `index.ts` (export)
- Modify: `crates/contracts` mirrors
- Test: `packages/contracts/test/avatar-animation.test.ts`, Rust round-trip

**Interfaces:**
- Produces:
  - `OVERLAY_POSE_IDS = ['rest','selfie','wave','mic','controller'] as const`
  - `HAND_POSE_IDS` — at least `open|fist|grab|hold1|hold2|peace|idle` (extend toward Warudo names as data allows)
  - `OverlayPoseEntry = { id: Id; pose: OverlayPoseId; maskedBodyParts: BodyPart[]; weight: number; speed?: number }`
  - `HandOverride = { enabled: boolean; pose: HandPoseId; weight: number; highPriority: boolean }`
  - `HandPin = { enabled: boolean; mode: 'preset'|'hold' }`
  - `AvatarAnimation = { overlayingPoses: OverlayPoseEntry[]; overlayTransitionSeconds: number; overrideHandPoses: { left?: HandOverride; right?: HandOverride }; handPin: { left?: HandPin; right?: HandPin } }`
  - Avatar optional `animation?: AvatarAnimation`
  - Patches: `setAvatarAnimation` (full replace of `AvatarAnimation`) — keep one op to avoid patch explosion; Blueprint/Inspector send full group
  - Defaults: empty overlays, `overlayTransitionSeconds: 1`, hands disabled, pins disabled
  - Caps: max 8 overlay entries; weight 0..1; transition 0..5 s

- [ ] **Step 1:** Failing schema tests — valid animation round-trip; reject unknown pose id; reject >8 overlays; accept patch on avatar only.
- [ ] **Step 2:** Run `pnpm vitest run --project unit packages/contracts/test/avatar-animation.test.ts` → FAIL
- [ ] **Step 3:** Implement schemas + avatar field + patch; Rust mirror; export
- [ ] **Step 4:** TS + `direnv exec . cargo test -p contracts` → PASS
- [ ] **Step 5:** Commit contracts + SPDD stubs

---

### Task 2: Built-in overlay libraries + wave loop

**Files:**
- Create: `packages/session/src/overlay-poses.ts`
- Create: `packages/session/test/overlay-poses.test.ts`

**Interfaces:**
- Consumes: `OVERLAY_POSE_IDS`
- Produces:
  - `evaluateOverlayPose(pose: OverlayPoseId, elapsedMs: number, speed: number): Readonly<Record<string, { rotation: Quat; space: 'normalized' }>>` — bones for arms/hands/(optional shoulders); `wave` varies with `elapsedMs * speed`; others ignore time (held)
  - `blendOverlayBones(from, to, t: number): ...` — slerp each bone; `t` in 0..1
  - Mask helper: drop bones not in `maskedBodyParts` via existing `bodyPartOf`

- [ ] **Step 1:** Tests — rest ≠ selfie; wave at t0 ≠ wave at t0+250ms; blend t=0/1 endpoints; non-wave stable across elapsed
- [ ] **Step 2:** Run unit test → FAIL
- [ ] **Step 3:** Implement libraries (tune later on fixture VRM; values must be finite normalized quats)
- [ ] **Step 4:** PASS
- [ ] **Step 5:** Commit

---

### Task 3: Hand pose libraries

**Files:**
- Create: `packages/session/src/hand-poses.ts`
- Create: `packages/session/test/hand-poses.test.ts`

**Interfaces:**
- Produces: `evaluateHandPose(side: 'left'|'right', pose: HandPoseId): Record<fingerBone, { rotation; space: 'normalized' }>` — only finger bones for that side

- [ ] **Step 1:** Tests — open ≠ fist; left/right mirrored as expected; only finger keys
- [ ] **Step 2–5:** TDD implement, commit

---

### Task 4: Hand pin

**Files:**
- Create: `packages/session/src/hand-pin.ts`
- Create: `packages/session/test/hand-pin.test.ts`

**Interfaces:**
- Produces:
  - `HandPinRuntime` state map avatarId → side → `{ mode; targetWristLocal: Vec3; captured: boolean }`
  - `stepHandPin(prev, animation.handPin, overlayWristTargets, currentArmBones, deltaSeconds): { runtime; armBones }` — `preset` uses overlay wrist; `hold` captures once on enable; writes upper/lower/hand rotations toward target (analytic two-bone or fixed preset chain — document choice in code only if non-obvious)
  - Unit: enable hold → change head-irrelevant inputs → wrist stays within epsilon; disable clears

- [ ] **Step 1–5:** TDD implement, commit

---

### Task 5: Compose layer + session hook

**Files:**
- Create: `packages/session/src/avatar-animation-compose.ts`
- Create: `packages/session/test/avatar-animation-compose.test.ts`
- Modify: `packages/session/src/tracking.ts` and/or `session.ts` (after tracking evaluate, before blueprint offsets)
- Modify: `packages/session/src/scene-ops.ts` for `setAvatarAnimation`
- Test: session integration with face-only mock tracking

**Interfaces:**
- Produces: `composeAvatarAnimation(poses, scene, elapsedMs, deltaSeconds, runtime): { poses; runtime }`
- Rules:
  - Apply overlays in list order; later entry wins on same bone; weight scales blend from pre-overlay bone
  - Transition: when an entry’s `pose` or membership changes, blend over `overlayTransitionSeconds` (per-avatar transition state in runtime)
  - Hand overrides after overlays; honor `highPriority` vs existing finger keys in `pose.bones`
  - Hand pin last among animation layers
  - Export flag or bone set so Face-Only `offsetBones` writers skip arm/finger bones covered by active overlays (reuse `offsetBonesSkipped` pattern if present; else add `animationMaskedBones(avatar): Set<string>`)

- [ ] **Step 1:** Tests for Review focus items 1–5 (blend, face+overlay, highPriority, pin+yaw, wave clock)
- [ ] **Step 2–4:** Implement compose + wire session + patch
- [ ] **Step 5:** Commit

---

### Task 6: Blueprint nodes + hotkey path

**Files:**
- Modify: `packages/contracts/src/blueprint-nodes/character.ts` (+ catalog export)
- Modify: `packages/session/src/blueprint-eval/character.ts`, effect/dispatch as needed
- Create: optional template `packages/contracts/src/blueprint-templates/pose-hotkeys.json` — On Keystroke → Set Overlay Pose for 1..5
- Tests: node schema + session graph sets animation via effect/patch

**Interfaces:**
- Nodes: `character.setOverlayPose` (character, pose id, optional slot id / add-or-replace entry), `character.setHandPose` (side, HandOverride fields), `character.setHandPin` (side, HandPin fields)
- Effects call same scene-ops as Inspector (one authority)

- [ ] **Step 1–5:** TDD nodes + one hotkey template import test; commit

---

### Task 7: Inspector Animation UI

**Files:**
- Create: `apps/desktop/src/components/AvatarAnimationFields.svelte` (or section in existing inspector)
- Modify: `Inspector.svelte`, `model.ts`, `property-defaults.ts`, `live-fields` as needed
- Test: headless editor check (follow `docs/testing.md` / existing Inspector patterns)

**Interfaces:**
- Labels: Overlaying Animations, Overlaying Animations Transition Time, Override Hand Poses, Left Hand / Right Hand, Enabled, Pose, Weight, High Priority, Hand Pin (Warudo-aligned; no extra helper copy)
- List editor for overlays: add/remove/reorder; pose select; weight; masked parts (reuse body-part control pattern from tracked parts)
- Commits full `AvatarAnimation` through `setAvatarAnimation`

- [ ] **Step 1:** Headless or component test — change pose → patch → reload scene keeps values
- [ ] **Step 2–4:** Implement UI; autofix Svelte via Svelte MCP when editing `.svelte`
- [ ] **Step 5:** Commit

---

### Task 8: Docs, parity, evaluation stub

**Files:**
- Modify: `ARCHITECTURE.md` (compose step bullet for animation layers)
- Modify: `docs/vpoyo-gaps.md` gap 3 → In progress
- Modify: `docs/warudo-parity.md` CHR-04 / CHR-06 Partial notes
- Create: `docs/evaluation/pose-presets-face-only.md` (pending OBS checklist)
- Sync SPDD prompt REASONS if requirements drifted

- [ ] **Step 1:** Update docs in same commit as feature-complete code checkpoint
- [ ] **Step 2:** Commit
- [ ] **Step 3:** Do not mark gap Done until macOS OBS check exists

---

## Spec coverage check

| Spec item | Task |
| --- | --- |
| Full overlay list | 1, 2, 5, 7 |
| Wave short loop | 2, 5 |
| Hand Pin in first PR | 4, 5, 7 |
| Override Hand Poses | 3, 5, 7 |
| Inspector / hotkey / Blueprint | 6, 7 |
| Blend + unit tests | 2, 5 |
| Saved in show | 1, 5, 7 |
| Face torso + fixed hands | 5 |
| No clip import / no full IK | Global + non-goals |

## Execution

After plan approval: prefer **subagent-driven** (many sequential contract→session→UI gates). Native is OK if one agent owns the whole branch.
