# REASONS: Mixamo-format FBX import (CHR-04 slice 4 / #268)

Date: 2026-11-24. Scope: CHR-04 Mixamo FBX experiment. Analysis: [mixamo-fbx-import](../analysis/2026-11-24-mixamo-fbx-import.md). Plans: [CHR-04 dependency](../../docs/superpowers/plans/2026-11-22-chr04-idle-override-clips.md), [this slice](../../docs/superpowers/plans/2026-11-24-mixamo-fbx-import.md). Clip idle: [vrma-clip-idle](2026-11-22-vrma-clip-idle.md). Parent: [#10](https://github.com/danirukun/opensekai/issues/10). Experiment: [#268](https://github.com/danirukun/opensekai/issues/268).

## R — Requirements

R1. Extend animation import so the operator can choose a `.vrma` or a Mixamo-format `.fbx`. One Tauri command (`import_animation`); branch on extension. Dialog filter includes both where the platform filter API allows it.
R2. Add asset format `fbx` as an animation format (`ANIMATION_FORMATS` = `vrma` | `fbx`). Same kind, id prefix `animation_`, prepared `animation` field, empty expressions / no mesh fields. Store original bytes as `{id}.fbx`.
R3. Parse FBX with `ufbx` in the host. Map Mixamo bone names (strip `mixamorig` / `mixamorig:` / numbered `mixamorigN` prefixes; accept fused names) to `HUMANOID_BONES` via a fixed table. Take the first animation take that yields at least one mapped humanoid rotation track.
R4. Retarget each rotation key into VRM normalized space: `q_out = normalize(parentRestWorld * q_anim * inverse(restWorld))` using Mixamo bind/rest world quaternions from the loaded scene. Ignore translation / scale tracks. Apply the same duration / bone / key limits as VRMA. Reject when no mapped rotation tracks remain.
R5. Prepared `AssetAnimation` plays through existing idle, overlay, and one-shot paths with no Mixamo-specific session or renderer branch.
R6. License: import `licenseLabel` stays `User supplied`. Do not add third-party Mixamo or AnimeVRM packs to the repo. Evaluation / parity note states redistribution: **user-import only** while terms are unknown; decision for #268: **continue** toward #10 (import path exists; quality remains skeleton-dependent; OBS / retarget polish stay open).
R7. Evidence: unit tests for name normalize + bone map, retarget quaternion math, prepare accept/reject on a synthetic Mixamo-named FBX fixture (in-repo, not a third-party pack), schema/`isAnimationRecord` for `fbx`. Integration or registry stage path for `.fbx` when practical. UI check: import dialog accepts FBX; assign as idle or overlay; preview motion on default VRM. Update `ARCHITECTURE.md`, CHR-04 plan Done so far, `docs/warudo-parity.md` (CHR-04 still unchecked; note Mixamo import in code + license).
R8. Do not add hips translation, general non-Mixamo FBX scenes, bundled motion libraries, breathing-strength UX, or claim all Mixamo skeletons look good.

## E — Entities

- `AssetFormat::Fbx` / TS `'fbx'` in `ANIMATION_FORMATS`.
- Mixamo bone name normalize + `MIXAMO_TO_HUMANOID` map.
- `prepare_mixamo_fbx(bytes) -> AssetAnimation` (Rust).
- Synthetic Mixamo-named FBX test fixture.
- Evaluation / license note for #268.

## A — Approach

Contracts first (format enum + schema). Pure map + retarget helpers with unit tests. `ufbx` prepare path + `stage_animation` branch. Dialog filter. Docs/parity/license. No session API changes beyond accepting `fbx` records as animation assets (existing `isAnimationRecord`).

## S — Structure

- `packages/contracts` + `crates/contracts` format / validation.
- `apps/desktop/src-tauri`: `Cargo.toml` (`ufbx`), `assets/mixamo.rs` (or `animation_fbx.rs`), `assets/animation.rs` / `registry.rs` stage branch, `lib.rs` dialog filter.
- Tests under the prepare module + optional registry test.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, CHR-04 plan, `evaluation/mixamo-fbx-import.md` (license + decision + gaps).

## O — Operations

1. Contracts: add `fbx` animation format (TS + Rust) + tests.
2. Pure Mixamo name map + retarget + unit tests.
3. `ufbx` prepare + synthetic fixture accept/reject tests.
4. Wire `stage_animation` / dialog; registry smoke if cheap.
5. Docs, parity, evaluation license note; UI check with a user-supplied or synthetic FBX.

## N — Norms

- Functional TypeScript; Rust prepare mirrors VRMA style.
- Comments only on retarget formula / name strip edge cases.
- pnpm; `direnv exec .` for Cargo; shared target dir.
- STE100 for long prose; short UI (dialog title / filters only).

## S — Safeguards

- Do not bundle AnimeVRM Motions or Mixamo packs.
- Do not drive Mixamo from a renderer mixer.
- Do not widen to arbitrary FBX character scenes.
- Do not check the CHR-04 box; record Mixamo import + remaining OBS / quality gaps.
- Do not treat unknown-license clips as redistributable.
