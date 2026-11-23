# CHR-04 — Idle animation and override clips (dependency plan)

**Parity:** [CHR-04](../../warudo-parity.md) · **Issue:** [#10](https://github.com/danirukun/opensekai/issues/10)  
**Done so far:** built-in procedural idle (`packages/session/src/idle.ts`), `AvatarIdle {kind:'builtin'}`, tracking blend over `baseBones`, macOS OBS check ([evidence](../../evaluation/default-avatar-idle.md)); VRMA clip-backed idle (slice 1); pose-preset overlays (#296); VRMA clip overlay entries in `overlayingPoses` (slice 2 code + unit tests; OBS evidence still open); Blueprint transient one-shot overlays with blend in/out (slice 3 code + unit tests; OBS evidence still open).  
**Related:** [#268](https://github.com/danirukun/opensekai/issues/268) Mixamo FBX experiment · [#296](https://github.com/danirukun/opensekai/issues/296) pose presets · karaoke/dance examples need clip profiles and one-shots.

Warudo’s Character → Animation model (idle clip, overlay layers with mask/weight/speed, transient one-shots) is larger than one implementation task. This plan splits the remaining gap into bounded slices. Each slice gets its own SPDD analysis and REASONS contract before code. A checked subset does not complete CHR-04.

## Slices

| # | Slice | Contract | Needs | Gives |
| --- | --- | --- | --- | --- |
| 1 | VRMA clip asset and clip-backed idle | [contract](../../../spdd/prompt/2026-11-22-vrma-clip-idle.md), [analysis](../../../spdd/analysis/2026-11-22-vrma-clip-idle.md), [plan](2026-11-22-vrma-clip-idle.md) | built-in idle path | `animation` asset kind, `.vrma` import, `AvatarIdle` clip variant that samples into the same `baseBones` path, inspector idle source choice |
| 2 | Overlay (override) clip layers | after slice 1 merges | 1 | ordered overlay list on the avatar (clip asset, body-part mask, weight, speed); lower priority than tracking; Warudo “Overlaying Animations” |
| 3 | Transient one-shot overlays | after slice 2 | 2 | Blueprint-triggered one-shot play with blend in/out; unlocks dance-style examples that cite CHR-04 |
| 4 | Mixamo-format FBX import (experiment) | can start after slice 1 has a clip pipeline | 1 | user-supplied Mixamo FBX → retarget into the same clip asset; license note; decision for #268. No third-party pack in the repo |

Out of this plan (separate issues): pose presets (#296), hand IK / manual posing (#12), breathing/sway as separate Warudo toggles (already covered by the procedural builtin), environment mesh clips (#246).

## Order

```
1 ──┬── 2 ── 3
    └── 4 (#268)
```

- Slice 1 is sequential. It extends shared contracts (`AssetSummary.kind`, `AvatarIdle`, import commands, Rust mirror). Integrator owns the contract change.
- Slice 2 and 4 can run in parallel worktrees after slice 1 merges (different files: overlays vs FBX import/retarget).
- Slice 3 waits for the overlay data model from slice 2.

## Why VRMA first (not Mixamo FBX)

- OpenSekai already uses `@pixiv/three-vrm` and the idle path already mirrors the ThreeVRM animation adapter for VRM0 axes. VRMA is the VRM Animation extension that that stack samples.
- Mixamo FBX needs an import/retarget path that does not exist yet (#268). Putting FBX first blocks on retarget quality and license policy before any clip-backed idle exists.
- Slice 1 keeps evaluation in the session (same authority as the builtin loop). The renderer still consumes `baseBones`; no per-frame image IPC and no renderer-local mixer as the source of truth.

## Shared contracts and owners

Integrator owns, one change at a time:

- `AssetSummary.kind` adds `animation` (TypeScript + Rust).
- `AvatarIdle` discriminated union: keep `{kind:'builtin',enabled}` and add `{kind:'clip',enabled,assetId}`.
- Native `import_animation` (or equivalent) for `.vrma` only in slice 1.
- Validated `setAvatarIdle` already exists; extend validation for the clip variant (asset exists, kind is animation).

Session owns clip evaluation into `baseBones`. Renderer keeps the current baseline blend. Editor owns the idle source control and import entry. MCP uses the same patch API.

## Rules for every slice

- Spec first: analysis + REASONS contract before code. Record behavior in the design/parity notes for that slice.
- Preserve the builtin idle and existing scenes without a clip setting.
- Unit tests for sampling, timing, and composition; integration at import/registry; OBS evidence for visual acceptance on macOS.
- Unknown timing stays unknown. Do not claim Windows from macOS evidence.
- Update `docs/warudo-parity.md` with verified behavior only. Do not check CHR-04 until slices 1–2 (idle + overlays) meet the handbook scope; note remaining gaps (transients, Mixamo) on the line until done.
- User-imported clips only until a license permits bundling. No bundled AnimeVRM / Mixamo packs.

## First slice DoD (preview)

Operator can import a `.vrma` file, assign it as the character’s idle, see the loop in preview and transparent OBS, toggle enable, and keep tracking takeover/fade over the clip baseline. Builtin idle remains the default for new characters. Mixamo, overlays, and one-shots stay out of slice 1.
