# REASONS: VRMA clip-backed idle (CHR-04 slice 1)

Date: 2026-11-22. Scope: CHR-04 first remaining subset. Analysis: [VRMA clip idle](../analysis/2026-11-22-vrma-clip-idle.md). Plan: [CHR-04 dependency plan](../../docs/superpowers/plans/2026-11-22-chr04-idle-override-clips.md). Built-in idle: [default avatar idle](2026-10-04-default-avatar-idle.md). Parent: [#10](https://github.com/danirukun/opensekai/issues/10).

## R — Requirements

R1. `AssetSummary.kind` and `AssetRecord` accept kind/format for an animation asset. Format is `vrma`. Id prefix is `animation_`. TypeScript and Rust agree. `AssetList` / `AssetSummary.of` classify `animation_*` as `animation`.
R2. `AssetRecord` has optional `animation: AssetAnimation`. `AssetAnimation` is `{ durationMs: number, bones: Record<humanoidBone, { times: number[], rotations: number[] }> }`. `times` is non-decreasing finite seconds from 0; `rotations` is flat unit quaternions (xyzw) with `rotations.length === times.length * 4`. At least one bone. Duration is the clip length in ms (at least 1, at most 600_000). At most 64 bones; each track at most 4096 keys. Bones are names from `HUMANOID_BONES`. Values are canonical VRM1 normalized space (same as builtin idle `baseBones`).
R3. Native `import_animation` opens a dialog for `.vrma` only. The frontend never sends a path. Import validates a self-contained GLB whose `extensionsUsed` contains `VRMC_vrm_animation`, extracts humanoid rotation tracks into `AssetAnimation` on the record, stores `{id}.vrma`, and returns the record like other imports. Reject a file with no mapped humanoid rotation track, oversize bytes (same import budget as VRM), or invalid GLB. Do not store expression or look-at tracks in this slice. Do not apply hips translation in this slice.
R4. `AvatarIdle` is a discriminated union: `{kind:'builtin', enabled:boolean}` | `{kind:'clip', enabled:boolean, assetId:Id}`. `AvatarIdleSchema` and the Rust mirror accept both. Existing shows with builtin keep working. `setAvatarIdle` validation: for `clip`, `assetId` must be non-empty; the session rejects a patch when the asset is missing or not an animation record (same class of error as other invalid inputs).
R5. When `idleAnimation` is `{kind:'builtin', enabled:true}`, session behavior is unchanged (`evaluateAvatarIdle`). When it is `{kind:'clip', enabled:true, assetId}` and the record has `animation`, session samples the clip at `animationElapsedMs` (looped with `t = (elapsedMs % durationMs) / 1000` seconds) into `baseBones` with spherical linear interpolation between keys (step to the last key when past the last time). Missing asset, missing `animation`, or `enabled:false` gives no baseline.
R6. Sampling uses only rotation tracks. Output bones use `space:'normalized'`. Finite nonnegative `elapsedMs` only (same throw as builtin on bad time). Tracking compose, renderer blend, VRM0 axis conversion, and stale fade stay as in the builtin slice.
R7. New characters still default to `{kind:'builtin', enabled:true}`. The Tracking inspector Idle control: enable checkbox; when animation assets exist, a source select for Builtin vs each animation asset name. Changing the source or enable writes one `setAvatarIdle`. Reset Idle animation restores the add default (builtin on). No helper text.
R8. MCP and Editor use the same `setAvatarIdle` / asset list path. No new Blueprint nodes in this slice.
R9. Evidence: unit tests for schema, import reject/accept vectors, and pure sampling/composition; integration for import registry and patch; macOS preview + transparent OBS loop with a user-supplied or fixture VRMA, tracking takeover/fade, editor minimized continuity sample. Record commit, backend, platform, and remaining gaps (overlays, Mixamo, one-shots).
R10. `docs/warudo-parity.md` CHR-04 stays unchecked. Update the line to note clip-backed VRMA idle verified when R9 passes; overlays and Mixamo remain later. Update `ARCHITECTURE.md` for the new import, asset kind, and session sampling path.

## E — Entities

- `AssetKind` / summary kind: add `animation`.
- `AssetFormat`: add `vrma`.
- `AssetAnimation` on `AssetRecord` (optional).
- `AvatarIdle`: `builtin` | `clip` (+ `assetId` on clip).
- Pure `evaluateAvatarClipIdle(animation: AssetAnimation, elapsedMs: number): Record<string, IdleBone>` in session (or contracts) next to `evaluateAvatarIdle`.
- Tauri `import_animation` command and registry staging for `.vrma`.

## A — Approach

Contracts first (kinds, `AssetAnimation`, `AvatarIdle` union, validation). Then Rust/TS import that prepares keyframes onto the record so the session worker never loads Three.js. Then session compose switches on idle kind. Then inspector Idle source. Then fixture + tests + macOS OBS evidence. Keep one session authority; renderer still only consumes `baseBones`.

## S — Structure

- `packages/contracts/src/{tracking,types,schema}.ts`; contracts tests; `crates/contracts` mirrors and `AssetSummary::of`.
- `apps/desktop/src-tauri/src/assets/` import + prepare humanoid tracks from VRMA GLB; `lib.rs` / service ports command.
- `packages/session/src/{idle,tracking,scene-ops}.ts`; session tests.
- `apps/desktop/src/{components/AvatarSourceFields.svelte,editor/{model,property-defaults}.ts}` and import chooser wiring.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/vrma-clip-idle.md` (new), handbook Characters line if the Idle control changes.
- Fixture: small synthetic or licensed-free VRMA under `fixtures/` for automated tests (not a third-party motion pack).

## O — Operations

1. Contracts: `animation` kind/format, `AssetAnimation`, `AvatarIdle` union, record refinements, Rust mirrors; unit tests.
2. Import: `import_animation`, prepare tracks, registry tests; reject empty/invalid.
3. Session: `evaluateAvatarClipIdle`, compose branch, patch validation against records; unit tests (loop, lerp, missing asset, builtin unchanged).
4. Editor: Idle source select + enable; import entry; property defaults / reset; UI check.
5. macOS + OBS evidence; docs and parity line (R9–R10).

## N — Norms

- Functional TypeScript; comments only when the sample/lerp logic is hard to follow.
- UI copy restraint: labels only (Idle animation, Builtin, clip name).
- pnpm; `direnv exec .` for Rust/Tauri builds; shared `$HOME/.cache/opensekai/target`.
- No bundled Mixamo/AnimeVRM packs; user-supplied or test fixture only.
- STE100 for long prose.

## S — Safeguards

- Do not change builtin idle math or default for new characters.
- Do not drive the avatar from a renderer-local AnimationMixer as authority.
- Do not add overlay layers, Mixamo FBX, expression tracks, look-at tracks, or hips translation in this slice.
- Do not check the CHR-04 box; record remaining gaps on the line.
- Unknown timing stays unknown. macOS evidence does not claim Windows.
- Reject oversize or bone-less VRMA at import; never throw from compose on a missing clip (no baseline).
