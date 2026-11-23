# REASONS: Transient one-shot overlays (CHR-04 slice 3)

Date: 2026-11-23. Scope: CHR-04 transient one-shots. Analysis: [transient one-shot overlays](../analysis/2026-11-23-transient-one-shot-overlays.md). Plans: [CHR-04 dependency](../../docs/superpowers/plans/2026-11-22-chr04-idle-override-clips.md), [this slice](../../docs/superpowers/plans/2026-11-23-transient-one-shot-overlays.md). Slice 2: [overlay clip layers](2026-11-23-overlay-clip-layers.md). Parent: [#10](https://github.com/danirukun/opensekai/issues/10). Warudo: Play Character One Shot Overlay Animation.

## R — Requirements

R1. Add Blueprint node `character.playOneShotOverlay` (label: Play One Shot Overlay). Settings: `entityId` (avatar), `assetId` (animation string, may be empty until picked), `weight` (0–1, default 1), `speed` (0.01–4, default 1), `blendInSeconds` / `blendOutSeconds` (0–5, default 0.2). Ports: flow Enter → exit. Defaults require an avatar id. Mask uses the default arm/finger parts (same as Set Overlay Pose); no mask field in this slice.
R2. Flow emit is a runtime effect `{kind:'playOneShotOverlay', entityId, assetId, maskedBodyParts, weight, speed, blendInSeconds, blendOutSeconds}` — not a scene effect. Session applies it like expressions: no revision bump, not in show save.
R3. On apply: avatar must exist; `assetId` must resolve to a `vrma` record with `animation`. Otherwise `INVALID_INPUT`. Replace any active one-shot on that avatar. Store `startedAtMs` from the session clock.
R4. Pure sample helper clamps time to `[0, durationMs]` (no modulo). Effective play length is `durationMs / speed`. Envelope weight: linear blend-in from 0→1 over `blendInSeconds`, hold 1, linear blend-out 1→0 over `blendOutSeconds` ending at play end. If in+out ≥ length, compress so in and out share the length without a hold (in proportion to requested in/out, or equal if both 0 length edge). Contribution bone weight = `weight * envelope`. When local time ≥ length (and envelope done), drop the play.
R5. Each tick, after persistent `composeAvatarAnimation` overlay/hand/pin pass (or integrated as a final overlay bone pass before hand overrides — prefer: apply one-shot bones onto the pose after persistent overlays and before hand overrides, same tracking skip for `space:'raw'`). `animationMaskedBones` includes active one-shot masked bones while envelope contribution > 0.
R6. Reconcile: drop plays for removed avatars. Soft-skip sampling if the asset disappears mid-play; drop when finished or unrecoverable.
R7. Evidence: unit tests for clamp sampler, envelope (in/hold/out, compressed), replace-on-retrigger, missing asset reject, compose apply + tracking skip, Blueprint node schema/defaults, evaluator emit; UI check that the node appears in the Character palette and a Manual Trigger / keystroke graph can start a play with an imported VRMA. Update parity CHR-04 line (still unchecked); note one-shots in code. Update `ARCHITECTURE.md` for the runtime one-shot layer.
R8. Do not add Mixamo, Get Random Character Animation, streaming redeem nodes, expression tracks, hips translation, or multiple concurrent one-shots per avatar.

## E — Entities

- `PlayOneShotOverlayEffect` / one-shot runtime entry (`assetId`, mask, weight, speed, blendIn/Out, `startedAtMs`).
- `OneShotStates` map avatarId → entry (or none).
- `sampleAvatarClip` (clamp) vs existing looped `evaluateAvatarClipIdle`.
- `character.playOneShotOverlay` node definition + evaluator.
- Compose / `animationMaskedBones` hooks for active plays.

## A — Approach

Contracts node first (TypeScript catalog + tests; Rust mirror if node settings are validated there). Session module for start/advance/reconcile + clamp sample. Wire effect in `blueprint.ts` / session apply path. Extend compose (or a thin `applyOneShotOverlay` after compose). Tests. Docs/parity. No Inspector persistent list for one-shots.

## S — Structure

- `packages/contracts/src/blueprint-nodes/character.ts` (+ definitions tests).
- `crates/contracts` node catalog mirror if required by existing pattern.
- `packages/session/src/one-shot-overlays.ts` (new), `idle.ts` or sample helper, `avatar-animation-compose.ts` / `session.ts`, `blueprint.ts`, `blueprint-eval/character.ts`.
- Session unit tests; optional MCP note (Blueprint / same effect path only).
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, CHR-04 dependency plan “Done so far”.

## O — Operations

1. Clamp sample + envelope pure functions + unit tests.
2. One-shot runtime start/reconcile/advance + effect typing + session wire.
3. Compose apply + masked bones + tests (incl. tracking skip).
4. Blueprint node + evaluator + catalog tests.
5. Docs/parity; UI check palette + trigger.

## N — Norms

- Functional TypeScript; comments only when envelope compression is hard to follow.
- UI: node label only; no helper narration.
- pnpm; `direnv exec .` for Rust; shared Cargo target.
- STE100 for long prose.

## S — Safeguards

- Do not persist one-shots on `AvatarAnimation` or show files.
- Do not loop the one-shot sampler.
- Do not drive from a renderer-local mixer.
- Do not check the CHR-04 box; record remaining gaps (OBS evidence, Mixamo).
- Do not treat a failed play as a scene commit failure for unrelated effects in the same run (same class as expression apply failures for that graph).
