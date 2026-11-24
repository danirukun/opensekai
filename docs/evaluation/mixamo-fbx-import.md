# Mixamo-format FBX import — evaluation (#268 / CHR-04 slice 4)

Date: 2026-11-24. Contract: [mixamo-fbx-import](../../spdd/prompt/2026-11-24-mixamo-fbx-import.md). Plan: [implementation](../superpowers/plans/2026-11-24-mixamo-fbx-import.md).

## License

| Source | Status | Action |
| --- | --- | --- |
| User-downloaded Mixamo FBX | User supplied | Import only; `licenseLabel` = `User supplied` |
| AnimeVRM Motions / similar public packs | Unknown redistribution | Do not bundle |
| `fixtures/animation/mixamo-chest-sway.fbx` | Synthetic Blender export with Mixamo bone names | Test only; not a motion pack |

**Bundling decision:** user-import only while third-party terms are unknown.

## Code evidence

- Unit tests: name normalize, bone map, retarget identity case, prepare accept on synthetic fixture, reject garbage bytes (`assets/mixamo.rs`).
- Schema: `format: 'fbx'` animation records accepted (`packages/contracts/test/idle.test.ts`).
- Session / Inspector accept `vrma` and `fbx` as animation assets.

## Visual / skeleton notes

- Synthetic fixture prepare succeeds in CI (mapped humanoid rotation tracks).
- Operator UI check with a real Mixamo download on the default VRM: **not yet recorded** (OBS + joint quality). Quality is skeleton-dependent (#22).
- No hips translation in this slice; foot sliding may remain on real clips.

## Decision for #268

**Continue** toward #10: the import/retarget path exists and feeds the same idle / overlay / one-shot pipeline. Narrow follow-up: OBS evidence on a user-supplied Mixamo idle, and optional rest-pose polish shared with VRMA.
