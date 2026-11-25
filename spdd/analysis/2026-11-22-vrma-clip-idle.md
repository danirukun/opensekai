# VRMA clip-backed idle analysis (CHR-04 slice 1)

Date: 2026-11-22. Parent: [#10](https://github.com/danirukun/opensekai/issues/10) CHR-04. Plan: [CHR-04 dependency plan](../../docs/superpowers/plans/2026-11-22-chr04-idle-override-clips.md). Built-in idle contract: [default avatar idle](2026-10-04-default-avatar-idle.md). Related experiment (later): [#268](https://github.com/danirukun/opensekai/issues/268).

## Original business requirement

From #10 and the parity line: finish idle animation and override clips. Partial today — built-in default idle verified on macOS; imported Mixamo/VRMA and override clips remain later. Delivery rules require a bounded slice before implementation. Warudo Character → Animation supports selecting an idle animation clip that loops under motion capture; overlays and transient one-shots are separate.

This slice covers only: import a user-supplied `.vrma` clip, assign it as the character idle, and play it through the existing session `baseBones` path with the same tracking priority rules as the builtin idle. Overlay layers, Mixamo FBX, and Blueprint one-shots are out of scope.

## Domain Concept Identification

### Existing Concepts (from codebase)

- **AvatarIdle**: `{kind:'builtin', enabled:boolean}` on the avatar entity; `setAvatarIdle` patch. Session evaluates a procedural loop into `AvatarPose.baseBones`; tracking overrides by bone weight; renderer blends from that baseline.
- **Asset registry**: kinds `avatar | scene | image | video | hdr | fixture`. Native import for VRM, scene GLB, image, video, HDR. Frontend never sends a file path; Tauri opens the dialog.
- **Session authority**: one simulation tick; idle and tracking compose there; renderers consume evaluated poses. No renderer-local mixer as source of truth.
- **BODY_PARTS / trackedParts**: already define body-part masks for tracking; reusable later for overlay masks (slice 2), not required here.

### New Concepts Required

- **Animation asset**: registry kind for a stored VRMA (or prepared animation package). Stable asset id referenced by the scene. Missing asset stays a repairable reference, same as other assets.
- **Clip-backed idle**: `AvatarIdle` variant that points at an animation asset and enable flag. When enabled and the asset is loadable, session samples the clip at animation elapsed time into normalized `baseBones`. When disabled or missing, no baseline (same as disabled builtin).
- **Idle source choice**: operator picks builtin vs clip (and which clip). New characters keep builtin enabled by default.

### Key Business Rules

- Tracking still wins per supplied bone; sparse packets leave other idle bones active; stale tracking fades back to the clip (or builtin) baseline.
- No default root motion, facial expression, or leg requirement from the builtin path unless the clip supplies those bones; do not invent extra channels the clip does not have.
- User-imported clips only; do not bundle third-party motion packs.
- Existing scenes with `{kind:'builtin'}` keep working without migration.
- Evaluation stays in the session; do not add continuous image readback or a second authority clock in the renderer.

## Strategic Approach

### Solution Direction

Extend the asset registry and `AvatarIdle` contract so a VRMA file becomes an animation asset. On each session tick, when idle is a clip and enabled, sample humanoid bone rotations (normalized VRM1 space, with the existing VRM0 renderer conversion) into `baseBones`, reusing the tracking composer and renderer blend from the builtin slice. Import follows the same Tauri dialog + registry pattern as `import_avatar` / `import_hdr`.

Sampling library candidate: `@pixiv/three-vrm-animation` (createVRMAnimationClip / VRMA loader) inside a session-safe or host-assisted decode path. Prefer a pure evaluation of prepared keyframes in the session if the loader must stay in the renderer process — selection gate: if Three.js loaders cannot run in the session worker, prepare a keyframe package at import or first load and let the session sample plain data.

### Key Design Decisions

- **VRMA before Mixamo FBX**: VRMA matches the VRM humanoid and the existing axis adapter; FBX retarget and license policy stay in #268 / slice 4.
- **Session samples into `baseBones`**: keeps one authority and the verified tracking blend; avoids a renderer-only AnimationMixer as truth.
- **Discriminated `AvatarIdle`**: additive clip variant; no breaking change to builtin.
- **`.vrma` only in this slice**: one format, one import command, clear acceptance.

### Alternatives Considered

- **Renderer-local mixer drives the avatar directly**: rejected — breaks session authority and minimized-editor continuity requirements.
- **Ship a bundled Mixamo idle**: rejected — license unknown; #268 forbids bundling until terms are clear.
- **Full Warudo overlay UI in the same slice**: rejected — needs-slice rule; overlays are slice 2.

## Risk & Gap Analysis

### Requirement Ambiguities

- Exact Warudo idle picker UX is not required for parity of the first clip path; OpenSekai may use a short idle source control without helper narration.
- Whether a clip may include root/hips translation: prefer applying only humanoid bone rotations that map to `HUMANOID_BONES` unless a later contract adds root motion.

### Edge Cases

- Missing or unloadable clip asset while idle kind is `clip`: no baseline; surface the same class of repairable missing-asset state as other assets.
- Clip with no mapped humanoid bones: enable produces no baseline (or a validated import reject) — decide in the REASONS contract.
- Very long elapsed time: keep phase bounded like the builtin idle.
- Two characters each with a different clip: stay within the existing two-avatar scene budget.

### Technical Risks

- Session worker may not host Three.js GLTFLoader; need a prepare-at-import or prepare-on-load path for keyframe data.
- VRM0 vs VRM1 axis handling must stay consistent with the builtin baseline conversion.
- Large VRMA files and memory: cap or stream; reject oversized imports with a clear error.

### Acceptance Criteria Coverage

| AC (from #10 / slice DoD) | Addressable? | Notes |
| --- | --- | --- |
| Implement and verify full CHR-04 | Partial | This slice only; overlays/Mixamo/transients remain |
| Record commit, platform, backend, gaps | Yes | Evidence doc for this slice |
| Update parity checklist | Yes | Keep CHR-04 unchecked; note clip idle verified, overlays later |
| Import VRMA, assign idle, loop under tracking | Yes | Core of this slice |
| Mixamo / override clips | No | Slices 2 and 4 |

## Next step

REASONS contract: [vrma-clip-idle](../prompt/2026-11-22-vrma-clip-idle.md). Implementation plan: [vrma-clip-idle plan](../../docs/superpowers/plans/2026-11-22-vrma-clip-idle.md).
