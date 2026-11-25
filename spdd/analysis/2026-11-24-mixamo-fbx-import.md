# Mixamo-format FBX import analysis (CHR-04 slice 4 / #268)

Date: 2026-11-24. Parent: [#10](https://github.com/danirukun/opensekai/issues/10) CHR-04. Experiment: [#268](https://github.com/danirukun/opensekai/issues/268). Plan: [CHR-04 dependency plan](../../docs/superpowers/plans/2026-11-22-chr04-idle-override-clips.md). Clip pipeline: [VRMA clip idle](2026-11-22-vrma-clip-idle.md). Overlays / one-shots: slices 2–3.

## Original business requirement

Operators need a path to bring Mixamo-format FBX pose and breathing idles into the existing idle / override / one-shot pipeline. Built-in idle and VRMA clip assets already feed `AssetAnimation` → session `baseBones` / overlays. Mixamo FBX uses a different skeleton naming and rest pose, so a raw file cannot play on a VRM without retarget. Do not bundle third-party motion packs. Document license status before any bundling decision.

## Domain Concept Identification

### Existing Concepts (from codebase)

- **Animation asset**: registry kind `animation`; formats today `vrma` only (`ANIMATION_FORMATS`). Import via Tauri `import_animation` → `stage_animation` → `prepare_animation` (GLB + `VRMC_vrm_animation`) → `AssetAnimation` bone rotation tracks keyed by `HUMANOID_BONES`.
- **Session evaluation**: `evaluateAvatarClipIdle` / overlay / one-shot samplers consume prepared `AssetAnimation` only. Source file format does not matter after prepare.
- **Idle / overlay / one-shot assignment**: already accept any animation asset id with a valid prepared package.
- **Retarget quality note**: VRMA prepare maps node → humanoid and copies local rotations; rest-pose world-matrix retarget (ThreeVRM style) is still a later quality step for VRMA.

### New Concepts Required

- **Mixamo-format FBX source**: user-supplied `.fbx` whose bone names follow Mixamo conventions (`mixamorigHips`, `mixamorig:Hips`, numbered prefixes, or bare `Hips` after strip). Not a general FBX scene importer.
- **Mixamo → VRM humanoid map**: fixed table from Mixamo rig names to `HUMANOID_BONES` (hips, spine, chest, upperChest, limbs, fingers, toes).
- **Rest-pose retarget into normalized space**: convert Mixamo local rotation keys so they drive VRM normalized humanoid bones (identity rest), using Mixamo bind/rest world quaternions: `q_out = parentRestWorld * q_anim * inverse(restWorld)`.
- **Animation format `fbx`**: same asset kind and prepared `animation` field as VRMA; format distinguishes source file and storage extension.

### Key Business Rules

- User-imported clips only; no AnimeVRM / Mixamo packs in the repo while redistribution terms are unknown or disallowed.
- Same `AssetAnimation` limits and session path as VRMA (duration, bone count, keys). Rotation tracks only; no hips translation / root motion in this experiment (parity with VRMA slice).
- Reject FBX with no mappable humanoid rotation tracks.
- Quality is skeleton-dependent; one success does not claim all Mixamo packs.
- License label remains “User supplied” for imports; evaluation doc records bundling decision: user-import only until terms are clear.

## Strategic Approach

### Solution Direction

Extend `import_animation` to accept `.vrma` or `.fbx`. For FBX, parse with the Rust `ufbx` crate in the host (same prepare-at-import authority as VRMA). Map Mixamo names, retarget rotations into VRM normalized space, emit `AssetAnimation`, store `format: 'fbx'` and the original bytes. Idle, overlay, and one-shot code keep using the prepared package without Mixamo-specific runtime branches.

### Key Design Decisions

- **Prepare in Rust at import**: keeps session free of FBX loaders and matches VRMA.
- **`ufbx` over Three.js FBXLoader**: import already runs in Tauri host; avoid a second prepare path in the webview.
- **Rest-pose retarget required for Mixamo**: name-only copy looks wrong across Mixamo vs VRM rest; experiment acceptance needs readable joints on the default VRM.
- **Add format `fbx`**: clear source identity; `isAnimationFormat` includes both `vrma` and `fbx`.
- **No bundled fixtures of third-party Mixamo packs**: tests use a synthetic Mixamo-named FBX (or curve fixtures) built in-repo for CI; operator verification uses a user-supplied clip.

### Alternatives Considered

- **Ask operators to convert FBX → VRMA offline**: rejected for the experiment — #268 asks for an in-app path.
- **Renderer-local FBXLoader + AnimationMixer**: rejected — breaks session authority.
- **Ship AnimeVRM Motions**: rejected — license unknown; stay user-import only.
- **Defer retarget and only name-map**: rejected for acceptance — broken joints fail the #268 evidence bar.

## Risk & Gap Analysis

### Requirement Ambiguities

- “Breathing strength” from external sites may not map to OpenSekai controls; use existing weight/speed only.
- Multi-take FBX: take the first animation stack / take with humanoid tracks (document; refine later if needed).

### Edge Cases

- Colon vs fused vs numbered Mixamo prefixes (`mixamorig:Hips`, `mixamorigHips`, `mixamorig1Hips`).
- FBX with mesh but no animation; animation with translation-only hips; empty map → reject.
- Oversized FBX → same import byte budget as VRMA.
- ASCII vs binary FBX: `ufbx` handles both.

### Technical Risks

- Retarget math / quaternion order bugs; need unit tests on pure map + retarget and one parse fixture.
- Foot sliding and proportion issues remain skeleton-dependent; record gaps vs #22.
- `ufbx` dependency size and build time on the shared Cargo target.

### Acceptance Criteria Coverage

| AC (from #268) | Addressable? | Notes |
| --- | --- | --- |
| User-supplied Mixamo FBX imports, retargets, loops on default VRM | Yes | Import + prepare + existing idle path |
| Idle / override assignment through existing character path | Yes | Same asset id |
| Record which skeletons looked acceptable vs poor | Yes | Evaluation note after UI check |
| License note; no bundling while unknown | Yes | Docs + licenseLabel |
| Decision: continue / narrow / stop | Yes | Prefer continue toward #10 after import works |

## Next step

REASONS contract: [mixamo-fbx-import](../prompt/2026-11-24-mixamo-fbx-import.md). Implementation plan: [mixamo-fbx-import plan](../../docs/superpowers/plans/2026-11-24-mixamo-fbx-import.md).
