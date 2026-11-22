# VRMA clip-backed idle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Operator imports a `.vrma` file, assigns it as character idle, and sees a looping clip through the same `baseBones` + tracking path as the builtin idle.

**Architecture:** Import prepares humanoid rotation keyframes onto `AssetRecord.animation`. Session samples them into `baseBones`. Renderer blend unchanged. No Three.js in the session worker.

**Tech Stack:** TypeScript (zod, session), Rust (Tauri import, contracts), Svelte 5, vitest, cargo test.

**Spec:** [REASONS](../../../spdd/prompt/2026-11-22-vrma-clip-idle.md), [analysis](../../../spdd/analysis/2026-11-22-vrma-clip-idle.md), [CHR-04 plan](2026-11-22-chr04-idle-override-clips.md).

## Global Constraints

- `direnv exec .` for Rust/Tauri. Shared Cargo target `$HOME/.cache/opensekai/target`.
- Verify `pwd` before Git. No agent attribution. Do not push unless asked.
- Functional TypeScript. UI labels only.
- Builtin idle and new-character default unchanged.
- No Mixamo, overlays, expression/look-at/hips translation in this slice.

## Review Focus

1. **Missing clip:** `kind:'clip'` with unknown `assetId` → no baseline, no throw.
2. **Loop / long elapsedMs:** sampling uses modulo duration; stays finite.
3. **Builtin regression:** `{kind:'builtin',enabled:true}` still matches prior `evaluateAvatarIdle` tests.
4. **Import reject:** GLB without `VRMC_vrm_animation` or without humanoid rotation tracks fails cleanly.

---

### Task 1: Contracts

**Files:** `packages/contracts/src/{tracking,types,schema}.ts`, `crates/contracts/src/lib.rs` (+ tracking if AvatarIdle lives there), contract tests.

- [ ] Failing tests: AvatarIdle clip variant; AssetAnimation bounds; AssetSummary kind `animation`; record refine for `vrma` + `animation_*`.
- [ ] Implement schemas and Rust mirrors.
- [ ] `pnpm --filter @opensekai/contracts test` / focused cargo test.

### Task 2: Import + prepare

**Files:** `apps/desktop/src-tauri/src/assets/`, service ports, `lib.rs` command `import_animation`.

- [ ] Failing registry test: valid minimal VRMA imports; invalid rejects.
- [ ] Implement GLB validate, extract humanoid rotation tracks → `AssetAnimation`, stage `{id}.vrma`.
- [ ] Wire Tauri command like `import_hdr`.

### Task 3: Session sampling

**Files:** `packages/session/src/{idle,tracking,scene-ops}.ts`, session tests.

- [ ] Failing tests: sample loop, slerp, missing asset, builtin unchanged, setAvatarIdle clip validation.
- [ ] `evaluateAvatarClipIdle`; compose branch on idle kind; patch checks animation record.

### Task 4: Editor UI

**Files:** `AvatarSourceFields.svelte`, editor model / property-defaults, import chooser.

- [ ] Idle enable + source select (Builtin / clips).
- [ ] Import animation entry; assets list includes animation kind.
- [ ] Browser/UI check of the control.

### Task 5: Evidence and docs

- [ ] Fixture VRMA for automated tests.
- [ ] macOS OBS check; `docs/evaluation/vrma-clip-idle.md`.
- [ ] Update `ARCHITECTURE.md`, `docs/warudo-parity.md` (CHR-04 unchecked, note progress), handbook if needed.
