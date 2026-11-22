# REASONS: Overlay clip layers (CHR-04 slice 2)

Date: 2026-11-23. Scope: CHR-04 overlay clips. Analysis: [overlay clip layers](../analysis/2026-11-23-overlay-clip-layers.md). Plans: [CHR-04 dependency](../../docs/superpowers/plans/2026-11-22-chr04-idle-override-clips.md), [this slice](../../docs/superpowers/plans/2026-11-23-overlay-clip-layers.md). Slice 1: [VRMA clip idle](2026-11-22-vrma-clip-idle.md). Parent: [#10](https://github.com/danirukun/opensekai/issues/10).

## R — Requirements

R1. `OverlayPoseEntry` is a union of (a) pose preset entry: `{id, pose, maskedBodyParts, weight, speed?}` with no `kind` (existing shows stay valid) and (b) clip entry: `{id, kind:'clip', assetId, maskedBodyParts, weight, speed?}`. TypeScript zod and Rust mirrors accept both. Max 8 entries; unique `id`s unchanged.
R2. Clip `assetId` is a non-empty id. On `setAvatarAnimation`, each clip entry’s asset must exist, have format `vrma`, and carry `animation` data (same failure class as idle clip). Pose entries need no asset check.
R3. `composeAvatarAnimation` evaluates pose entries with `evaluateOverlayPose` as today. For clip entries, look up the record; if missing/`animation` absent, skip the entry. Otherwise sample with `evaluateAvatarClipIdle(animation, elapsedMs * (speed ?? 1))`, then `maskOverlayBones` with the entry mask (empty mask → same default arm/finger parts as pose path), then slerp into the running overlay bone map by `weight`.
R4. Overlay transition key includes kind and clip `assetId` (or pose id) so switching content restarts the transition blend. Hand overrides, hand pin, and Face-Only mask set include bones from active clip overlays the same way as pose overlays.
R5. Session tick passes the asset record lookup into `composeAvatarAnimation`. Renderer path unchanged.
R6. Inspector Overlaying Animations row: source select Builtin pose vs each animation asset (or a Pose/Clip control + content select). Weight, mask, up/down/remove unchanged. Clip rows expose Speed (0–4). Add still defaults to a pose `rest` entry. Import animation remains on the Idle / asset path from slice 1; Animation panel may reuse the same asset list.
R7. Blueprint nodes that create pose overlay entries stay pose-only in this slice (no new clip Blueprint node required). MCP uses `setAvatarAnimation`.
R8. Evidence: unit tests for schema union, compose clip sample/mask/weight/missing asset, transition key change, Rust parse vectors; UI check of overlay clip row; macOS preview + OBS optional if a clip overlay is visible with face-only tracking. Update parity CHR-04 line (still unchecked); note clip overlays when verified. Update `ARCHITECTURE.md` if the compose signature / entry union is mapped there.
R9. Do not add one-shots, Mixamo, expression tracks, or hips translation.

## E — Entities

- `OverlayPoseEntry` union (pose | clip).
- `isOverlayClipEntry` / type guards in contracts or session.
- `composeAvatarAnimation(..., record?)` record lookup parameter.
- Editor helpers: `plainOverlay`, `newOverlayClipEntry`, `withOverlayClip`, source switchers.

## A — Approach

Contracts + Rust first. Then compose + tests with fixture `AssetAnimation`. Then patch validation in session. Then Inspector row + editor helpers. Then docs/parity. Keep pose presets and transition/hand logic intact.

## S — Structure

- `packages/contracts/src/avatar-animation.ts` (+ exports); contracts tests; `crates/contracts/src/avatar_animation.rs` (+ tests).
- `packages/session/src/avatar-animation-compose.ts`, `session.ts` call site; session compose tests.
- `apps/desktop/src/editor/avatar-animation.ts`, `AvatarAnimationFields.svelte`.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, optional `docs/evaluation/overlay-clip-layers.md`.

## O — Operations

1. Contracts: entry union, guards, Rust mirror + vectors.
2. Session: compose clip path + record arg; setAvatarAnimation clip validation; unit tests.
3. Editor: overlay source/clip select, speed for clips, helpers; UI check.
4. Docs/parity/evidence (R8).

## N — Norms

- Functional TypeScript; comments only when narrowing is hard to follow.
- UI labels only (no helper narration).
- pnpm; `direnv exec .` for Rust; shared Cargo target.
- STE100 for long prose.

## S — Safeguards

- Do not break existing pose-only `overlayingPoses` JSON.
- Do not drive overlays from a renderer-local mixer.
- Do not implement one-shots or Mixamo in this slice.
- Do not check the CHR-04 box; record remaining gaps (transients, Mixamo).
- Missing clip at evaluate: skip entry; never throw from compose.
