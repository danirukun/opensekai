# Overlay clip layers analysis (CHR-04 slice 2)

Date: 2026-11-23. Parent: [#10](https://github.com/danirukun/opensekai/issues/10) CHR-04. Plan: [CHR-04 dependency plan](../../docs/superpowers/plans/2026-11-22-chr04-idle-override-clips.md). Slice 1: [VRMA clip idle](2026-11-22-vrma-clip-idle.md). Related: [#296](https://github.com/danirukun/opensekai/issues/296) pose presets (built-in overlay poses already ship).

## Original business requirement

From the CHR-04 dependency plan slice 2: after VRMA clip-backed idle merges, add ordered overlay (override) clip layers on the avatar — each entry selects a clip asset, a body-part mask, weight, and speed; lower priority than tracking; matches Warudo “Overlaying Animations” for imported clips. Transient one-shots and Mixamo FBX stay out of this slice. Pose-preset overlays from #296 already cover rest/selfie/wave/mic/controller; this slice adds clip assets into the same ordered list.

## Domain Concept Identification

### Existing Concepts (from codebase)

- **AvatarAnimation.overlayingPoses**: ordered list (max 8) of overlay entries with pose id, mask, weight, optional speed; composed after tracking into `AvatarPose.bones`; transition blend between list keys; Face-Only writers skip bones covered by active overlays.
- **Overlay pose presets**: procedural/held arm poses (`rest`, `selfie`, `wave`, `mic`, `controller`) evaluated in session; not clip assets.
- **Animation asset / AssetAnimation**: VRMA import prepares humanoid rotation tracks; clip idle samples them into `baseBones` via `evaluateAvatarClipIdle`.
- **BODY_PARTS / maskOverlayBones**: body-part mask already used by pose overlays.
- **setAvatarAnimation**: patch + Inspector “Overlaying Animations” UI + Blueprint character nodes for pose entries.

### New Concepts Required

- **Clip overlay entry**: same list slot as a pose overlay, but content is an animation asset id. Session samples the clip (looped, speed-scaled) into masked bones, then slerps by weight over prior overlay result, same as pose overlays.
- **Source choice per overlay row**: operator picks a built-in pose or an imported animation clip for that row.

### Key Business Rules

- Tracking still wins on bones that already have `space:'raw'` (or Face-Only skip via mask set); overlays fill / blend normalized bones.
- Ordered list: later entries blend over earlier ones at their weight (existing compose order).
- Missing or unloadable clip asset for a clip entry: skip that entry (no throw); do not clear other overlays.
- Existing pose-only entries and saved shows keep working without migration fields beyond additive clip shape.
- One-shots, Mixamo FBX, expression tracks, hips translation stay out of scope.
- Session remains the authority; no renderer-local mixer.

## Strategic Approach

### Solution Direction

Extend `OverlayPoseEntry` to a union: keep the current pose shape for presets; add a clip variant (`kind:'clip'`, `assetId`) that reuses `evaluateAvatarClipIdle` + `maskOverlayBones` inside `composeAvatarAnimation`. Pass the asset record lookup into compose (same lookup idle already uses). Extend Inspector overlay row to select Pose vs Clip (and which clip). Validate clip assets on `setAvatarAnimation` when present (same class of error as idle clip).

### Key Design Decisions

- **Same list, not a second array**: Warudo one “Overlaying Animations” list; pose presets and clips are content kinds in one ordered stack.
- **Additive clip variant**: existing JSON with `pose` and no `kind` stays valid; clip rows use `kind:'clip'` + `assetId` and omit `pose`.
- **Reuse clip sampler**: do not duplicate keyframe math; scale time by `speed` before sampling.
- **Skip missing clip at evaluate**: soft at tick; hard reject on patch when asset id is set but record is not an animation (matches idle).

### Alternatives Considered

- **Separate `overlayingClips` array**: rejected — duplicates UI/order/transition semantics and drifts from Warudo’s single list.
- **Replace pose presets with clips only**: rejected — #296 presets are verified and used by Blueprint/hotkeys.
- **Renderer AnimationMixer for overlays**: rejected — breaks session authority.

## Risk & Gap Analysis

### Requirement Ambiguities

- Whether clip overlays should default the mask to full body vs arms: keep the same default mask as pose overlays (`leftArm`/`rightArm`/`leftFingers`/`rightFingers`) unless the operator widens it.
- Speed UI: pose rows already have optional speed (wave); expose speed for clip rows; keep optional for pose rows as today.

### Edge Cases

- Clip entry with empty mask: existing rule — empty mask means default arm/finger parts in compose (same as pose path).
- Weight 0: skip evaluation (existing).
- Two entries same asset: allowed; unique entry `id` only.
- Transition when switching a row from pose to clip: existing overlay key string already includes content identity; extend key for `assetId` / kind.

### Technical Risks

- Compose currently lacks asset records — must thread `record` lookup from session tick.
- Rust `OverlayPoseEntry` must accept the untagged/union shape without breaking pose-only vectors.
- Type narrowing in editor helpers (`plainOverlay`, `withOverlayPose`) must not assume every entry has `pose`.

### Acceptance Criteria Coverage

| AC | Addressable? | Notes |
| --- | --- | --- |
| Ordered overlay clip layers with mask/weight/speed | Yes | Core of this slice |
| Lower priority than tracking | Yes | Existing compose order |
| Pose presets unchanged | Yes | Additive union |
| Transient one-shots | No | Slice 3 |
| Mixamo FBX | No | Slice 4 / #268 |
| CHR-04 checkbox | No | Still partial until handbook scope + evidence |

## Next step

REASONS contract: [overlay-clip-layers](../prompt/2026-11-23-overlay-clip-layers.md). Implementation plan: [overlay-clip-layers plan](../../docs/superpowers/plans/2026-11-23-overlay-clip-layers.md).
