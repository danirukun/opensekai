# Mixamo-format FBX import — evaluation (#268 / CHR-04 slice 4)

Date: 2026-11-24. Contract: [mixamo-fbx-import](../../spdd/prompt/2026-11-24-mixamo-fbx-import.md). Plan: [implementation](../superpowers/plans/2026-11-24-mixamo-fbx-import.md). Commit: `1ee18c38`.

## License

| Source | Status | Action |
| --- | --- | --- |
| User-downloaded Mixamo FBX (`Excited Mixamo.fbx` from Downloads) | User supplied | Import only; `licenseLabel` = `User supplied` |
| milady-ai `Breathing Idle.fbx` / `Happy Idle.fbx` (Mixamo naming) | Used as local QA imports only | Do not commit binary packs into the repo |
| FreeMotionPack1 (CC0) | Tried; bone names are not Mixamo `mixamorig*` → prepare reject | Not used |
| AnimeVRM Motions / similar public packs | Unknown redistribution | Do not bundle |
| `fixtures/animation/mixamo-chest-sway.fbx` | Synthetic Blender export with Mixamo bone names | Test only |

**Bundling decision:** user-import only while third-party terms are unknown.

## Code evidence

- Unit tests: name normalize, bone map, retarget identity case, prepare accept on synthetic fixture, reject garbage bytes, stage smoke (`assets/mixamo.rs`).
- Schema: `format: 'fbx'` animation records accepted (`packages/contracts/test/idle.test.ts`).
- Session / Inspector accept `vrma` and `fbx` as animation assets.

## macOS OBS run (2026-11-24)

| Field | Value |
| --- | --- |
| Platform | macOS 27.2 (darwin 27.2.0), Apple Silicon |
| Commit | `1ee18c38` on `feat/chr04-idle-override-clips` |
| Backend | WebGPU (`output_main`, OBS QA scene) |
| OBS | 33.0.2, WebSocket 5.7.6, 1920×1080@60, isolated QA scene |
| Avatar | Nina (`avatar_07d241…`) |
| Clips (library) | `Breathing-Idle` `animation_7379…`, `Happy-Idle` `animation_68d2…`, `Excited-Mixamo` `animation_a1c9…` (plus existing VRMA `idle-subtle`) |
| Assign | MCP `setAvatarIdle` `{kind:clip,enabled:true,assetId}`; overlay via `setAvatarAnimation` clip entry |

### Verified

- Prepare + stage of three real Mixamo-named FBX files into the asset library (52 humanoid bones each).
- Transparent OBS output connected; gray composite for review.
- Clip idle switches change the pose on Nina (builtin standing vs Breathing Idle vs Happy Idle vs Excited).
- Within-clip motion: absolute error on non-transparent pixels between frames ~1.2–1.5 s apart ([ae.txt](mixamo-fbx-import/ae.txt)): Breathing a→b **40%**, Happy a→b **32%**, Excited a→b **30%**.
- Cross-clip: Breathing→Happy **18%**, Happy→Excited **38%**, Builtin→Excited **21%**.
- Clip overlay: Breathing Idle + Excited Mixamo arm overlay applied (`revision` 6); [obs-overlay-excited-comp.png](mixamo-fbx-import/obs-overlay-excited-comp.png).

### Frames

| Shot | File |
| --- | --- |
| Builtin idle | [obs-builtin-comp.png](mixamo-fbx-import/obs-builtin-comp.png) |
| Breathing Idle | [obs-breathing-a-comp.png](mixamo-fbx-import/obs-breathing-a-comp.png), [obs-breathing-b-comp.png](mixamo-fbx-import/obs-breathing-b-comp.png) |
| Happy Idle | [obs-happy-a-comp.png](mixamo-fbx-import/obs-happy-a-comp.png) |
| Excited Mixamo | [obs-excited-a-comp.png](mixamo-fbx-import/obs-excited-a-comp.png), [obs-excited-b-comp.png](mixamo-fbx-import/obs-excited-b-comp.png); raw alpha [obs-excited-a.png](mixamo-fbx-import/obs-excited-a.png) |
| Overlay Excited on Breathing | [obs-overlay-excited-comp.png](mixamo-fbx-import/obs-overlay-excited-comp.png) |

### Skeleton / quality notes

- **Acceptable for smoke:** Breathing Idle and Happy Idle read as standing idles; Excited drives a clearly different upper-body pose (arms out) through the same path.
- **Quality gaps:** Excited can read close to a T-pose on this VRM; retarget is Mixamo rest→VRM normalized without hips translation. Foot sliding / proportion issues remain skeleton-dependent (#22). Face over-bright on Nina is unrelated to Mixamo.
- FreeMotionPack1 FBX (non-`mixamorig` names) correctly rejects at prepare.

## Decision for #268

**Continue** toward #10: import/retarget works on real Mixamo-named FBX through idle and overlay on macOS WebGPU OBS. Narrow follow-up: polish retarget quality, optional one-shot OBS with FBX, native file-dialog import evidence.

## Not verified

- Native Tauri file-dialog `import_animation` end to end (library stage + MCP assign used here).
- One-shot Blueprint play of an FBX clip on OBS.
- Windows.
