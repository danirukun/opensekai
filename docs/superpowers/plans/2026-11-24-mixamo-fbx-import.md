# Mixamo-format FBX import — implementation plan

Date: 2026-11-24. Contract: [mixamo-fbx-import REASONS](../../../spdd/prompt/2026-11-24-mixamo-fbx-import.md). Analysis: [mixamo-fbx-import](../../../spdd/analysis/2026-11-24-mixamo-fbx-import.md). Parent plan: [CHR-04](2026-11-22-chr04-idle-override-clips.md). Issue: [#268](https://github.com/danirukun/opensekai/issues/268).

## Goal

User-supplied Mixamo-format `.fbx` imports into the same `AssetAnimation` pipeline as VRMA, with rest-pose retarget into VRM normalized humanoid bones, and plays through idle / overlay / one-shot without bundling third-party packs.

## Steps

1. **Contracts** — Add `fbx` to animation formats (TS schema + Rust `AssetFormat`). Keep validation: animation field required, `animation_` id prefix.
2. **Map + retarget** — Pure helpers: normalize Mixamo bone names; map to `HUMANOID_BONES`; retarget quaternion with rest world math. Unit tests.
3. **Prepare** — `prepare_mixamo_fbx` via `ufbx`: first usable take, rotation keys only, limits, reject empty map. Synthetic Mixamo-named FBX fixture in tests (not a third-party pack).
4. **Stage + dialog** — `stage_animation` branches on `.vrma` / `.fbx`; store `{id}.fbx`; dialog filter includes `fbx`.
5. **Docs** — `ARCHITECTURE.md`, parity CHR-04 line, dependency plan Done so far, `evaluation/mixamo-fbx-import.md` (license: user-import only; decision: continue; skeleton notes).

## Out of scope

Hips translation, non-Mixamo FBX, bundled packs, breathing-strength UX, claiming universal Mixamo quality, checking CHR-04 Done.

## Verify

- Unit: map, retarget, prepare accept/reject, schema `fbx`.
- UI: import FBX → assign idle or overlay → motion on default VRM (user-supplied or synthetic).
- No third-party motion files committed.
