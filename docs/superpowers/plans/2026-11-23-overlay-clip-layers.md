# Overlay clip layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Operator adds an overlay row that plays an imported VRMA clip with mask, weight, and speed, stacked with existing pose presets, under tracking priority.

**Architecture:** Extend `OverlayPoseEntry` to pose | clip. Session compose samples clips via `evaluateAvatarClipIdle` + existing mask/weight/transition path. No new asset format.

**Tech Stack:** TypeScript (zod, session), Rust contracts, Svelte 5, vitest, cargo test.

**Spec:** [REASONS](../../../spdd/prompt/2026-11-23-overlay-clip-layers.md), [analysis](../../../spdd/analysis/2026-11-23-overlay-clip-layers.md), [CHR-04 plan](2026-11-22-chr04-idle-override-clips.md).

## Global Constraints

- `direnv exec .` for Rust. Shared `$HOME/.cache/opensekai/target`.
- Verify `pwd` before Git. No agent attribution. Do not push unless asked.
- Pose-only JSON stays valid. No one-shots / Mixamo in this slice.

## Review Focus

1. **Missing clip:** clip entry with unknown asset → skip that entry, no throw.
2. **Pose regression:** existing selfie/wave compose tests still pass.
3. **Patch reject:** setAvatarAnimation with bad clip assetId fails INVALID_INPUT.
4. **Union parse:** Rust + zod accept both shapes; reject clip without assetId.

---

### Task 1: Contracts

**Files:** `packages/contracts/src/avatar-animation.ts`, contracts tests, `crates/contracts/src/avatar_animation.rs`, `crates/contracts/tests/avatar_animation.rs`.

- [x] Failing tests: clip entry accept; pose entry without kind still accept; clip without assetId reject.
- [x] Implement union + `isOverlayClipEntry` guard; Rust untagged enum (Clip first).
- [x] `pnpm --filter @opensekai/contracts test` / focused cargo test.

### Task 2: Session compose + patch

**Files:** `packages/session/src/{avatar-animation-compose,session}.ts`, session tests.

- [x] Failing tests: clip overlay sample/mask/weight; missing asset skip; pose regression; patch validation.
- [x] Thread `record` into compose; validate clip entries on scene patch.

### Task 3: Editor UI

**Files:** `apps/desktop/src/editor/avatar-animation.ts`, `AvatarAnimationFields.svelte`.

- [x] Source select pose vs clip; clip asset list; speed for clips; plain/helpers updated.
- [x] UI check of overlay row.

### Task 4: Docs

- [x] Update CHR-04 plan “Done so far”; parity line; ARCHITECTURE if compose/entry mapped; optional evaluation note.
