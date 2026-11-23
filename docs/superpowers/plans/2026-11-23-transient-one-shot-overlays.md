# Transient one-shot overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Blueprint starts a one-shot VRMA overlay with blend in/out; it plays once on the avatar and clears without a scene revision.

**Architecture:** Runtime state (like expressions). Effect `playOneShotOverlay` from `character.playOneShotOverlay`. Session clamps clip samples, applies envelope weight, layers bones after persistent overlays and before hand overrides. Tracking still wins on `raw` bones.

**Tech Stack:** TypeScript (zod, session, vitest), Svelte Blueprint palette (catalog only), cargo only if Rust node catalog requires the new type.

**Spec:** [REASONS](../../../spdd/prompt/2026-11-23-transient-one-shot-overlays.md), [analysis](../../../spdd/analysis/2026-11-23-transient-one-shot-overlays.md), [CHR-04 plan](2026-11-22-chr04-idle-override-clips.md).

## Global Constraints

- `direnv exec .` for Rust. Shared `$HOME/.cache/opensekai/target`.
- Verify `pwd` before Git. No agent attribution. Do not push unless asked.
- No Mixamo / random clip picker / multi one-shots per avatar.

## Review Focus

1. **No loop:** sampler clamps; play ends.
2. **No persist:** effect is not a scene effect; show JSON unchanged.
3. **Replace:** second play replaces the first.
4. **Tracking:** raw bones unchanged.

---

### Task 1: Clamp sample + envelope

**Files:** `packages/session/src/idle.ts` (or `one-shot-overlays.ts`), `packages/session/test/one-shot-overlays.test.ts`.

- [x] `evaluateAvatarClipOnce(animation, elapsedMs)` — clamp to duration, no modulo.
- [x] `oneShotEnvelope(localMs, lengthMs, blendInMs, blendOutMs)` → 0..1.
- [x] Unit tests for clamp, envelope hold, compressed in+out.

### Task 2: Runtime + session wire

**Files:** `packages/session/src/one-shot-overlays.ts`, `blueprint.ts`, `session.ts`, tests.

- [x] Types: effect, states map, `startOneShot`, `reconcileOneShots`.
- [x] Apply in Blueprint run path (non-scene); reject bad asset.
- [x] Drop finished plays when local time ≥ length.

### Task 3: Compose apply

**Files:** `avatar-animation-compose.ts`, compose tests, `animationMaskedBones`.

- [x] After persistent overlays, before hands: sample active one-shot, mask, slerp by `weight * envelope`.
- [x] Masked bones include one-shot while contribution > 0.
- [x] Tracking skip on raw bones.

### Task 4: Blueprint node

**Files:** `packages/contracts/src/blueprint-nodes/character.ts`, definitions tests, `blueprint-eval/character.ts`.

- [x] `character.playOneShotOverlay` settings/ports/defaults/fields.
- [x] Evaluator emits the effect.
- [x] Catalog test.

### Task 5: Docs + UI check

- [x] Update CHR-04 plan “Done so far”; parity line; ARCHITECTURE runtime note.
- [x] Palette / Manual Trigger flow check: node in catalog (Vite loads `Play One Shot Overlay`); Character palette section needs a character with a model (same refs gate as other Character nodes).
