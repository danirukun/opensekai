# Transient one-shot overlays analysis (CHR-04 slice 3)

Date: 2026-11-23. Parent: [#10](https://github.com/danirukun/opensekai/issues/10) CHR-04. Plan: [CHR-04 dependency plan](../../docs/superpowers/plans/2026-11-22-chr04-idle-override-clips.md). Slice 2: [overlay clip layers](2026-11-23-overlay-clip-layers.md). Warudo: Character → Animation “Transient animations”; Blueprint node **Play Character One Shot Overlay Animation** ([dance tutorial](https://docs.warudo.app/docs/blueprints/tutorials/dance)).

## Original business requirement

From the CHR-04 dependency plan slice 3: after overlay clip layers exist, add Blueprint-triggered one-shot overlay play with blend in/out. The one-shot plays on top of idle (and persistent overlays), then ends and returns control without leaving a permanent scene entry. This unlocks dance-style examples that cite CHR-04. Mixamo FBX stays out of this slice.

## Domain Concept Identification

### Existing Concepts (from codebase)

- **AvatarAnimation.overlayingPoses**: persistent ordered overlays (pose presets or VRMA clip entries) saved on the avatar and composed each tick by `composeAvatarAnimation`.
- **Animation asset / evaluateAvatarClipIdle**: VRMA clip sampling into normalized bone rotations (currently loops via modulo).
- **Expression runtime layer**: Blueprint effects (`setExpression` / `toggleExpression`) change session-only state; no scene revision; advanced on the session clock with fade.
- **Blueprint character nodes**: `character.setOverlayPose` writes a persistent overlay via `setAvatarAnimation` (scene effect). Flow Enter is the operator test path.
- **Tracking priority**: bones with `space:'raw'` stay tracking-owned; overlays fill normalized bones.

### New Concepts Required

- **One-shot overlay play**: a transient runtime clip on an avatar — asset id, body-part mask, weight, speed, blend-in and blend-out durations — started by a Blueprint effect, not stored on the scene entity.
- **One-shot envelope**: local playback time from start; sample the clip once (clamp at end, no loop); scale contribution by a blend-in then hold then blend-out weight curve; remove the play when finished.
- **Play Character One Shot Overlay Animation node**: Character flow node that emits the play effect (Warudo parity name shortened to OpenSekai node type `character.playOneShotOverlay`).

### Key Business Rules

- Transient plays do not change scene revision and do not appear in show save / `AvatarAnimation` JSON.
- Session remains the authority; no renderer-local mixer.
- Tracking still wins on raw bones; one-shot bones use the same normalized overlay apply path as persistent overlays.
- Persistent overlays keep composing; one-shots layer on top of that result (higher than persistent overlays, lower than tracking).
- Missing or non-animation asset: reject on play effect (hard), or skip at tick if the asset disappears mid-play (soft).
- A new play on the same avatar replaces the active one-shot (one concurrent play per avatar in this slice).
- Clip duration comes from the asset; effective length is `durationMs / speed` (speed ≤ 0 is invalid at the node / effect).
- Mixamo, random-animation picker, streaming redeem nodes, expression tracks, and hips translation stay out of scope.

## Strategic Approach

### Solution Direction

Mirror the expression pattern: a Blueprint effect starts runtime state; each tick advances local time, samples the clip without looping, multiplies by the blend envelope and weight, masks bones, and slerps onto the composed pose after persistent overlays. Add `character.playOneShotOverlay` to the node catalog and character evaluators. Reuse `evaluateAvatarClipIdle` math with a clamp-at-end sampler (new pure helper) so idle/overlay loops stay unchanged.

### Key Design Decisions

- **Runtime-only state (not scene)**: Warudo one-shots are triggered and auto-clear; persisting them would dirty revision and fight show save.
- **One play per avatar**: replace-on-retrigger matches dance/redeem UX and keeps Face-Only mask accounting simple.
- **Compose after persistent overlays**: one-shots are the transient top of the animation stack under tracking.
- **Blend in/out on the effect**: defaults (e.g. 0.2 s in / 0.2 s out) with node settings; envelope uses local play time and clip length.
- **Asset id in node settings**: same as idle/overlay clip selection; Get Random Character Animation stays later.

### Alternatives Considered

- **Inject a temporary row into `overlayingPoses`**: rejected — revises the scene, needs auto-remove patches, races with Inspector edits.
- **Renderer AnimationMixer one-shot**: rejected — breaks session authority.
- **Multiple stacked one-shots**: deferred — Warudo dance examples use one play; add later if needed.
- **Loop until stopped**: rejected — handbook one-shot ends and returns to idle.

## Risk & Gap Analysis

### Requirement Ambiguities

- Exact Warudo blend defaults are not published; use small defaults (0.2 s) and expose settings.
- Whether one-shots should affect the Face-Only skip set: yes for masked bones while weight > 0 (same as overlays).
- Priority vs hand pin / hand override: apply one-shot in the overlay bone pass before hand overrides (same order as persistent overlays relative to hands today — hands after overlays). Document that hand overrides still apply after the one-shot bone write unless a later slice changes order.

### Edge Cases

- Zero-length clip or missing tracks: play ends immediately / contributes nothing.
- blendIn + blendOut ≥ duration: envelope still reaches peak by compressing hold to zero (normalize phases).
- Avatar removed or model/asset cleared mid-play: drop runtime entry on reconcile.
- Graph disabled mid-play: play continues (started state is not owned by the graph after emit), matching expression target after the effect.

### Technical Risks

- Must not loop: a modulo bug would never end the play.
- Compose signature / runtime map must carry one-shot state beside overlay transition/pins.
- Blueprint effect must be classified like expressions (not a scene effect) so revision stays stable.
- Rust contracts: node settings schema + any shared play payload if mirrored; session logic stays TypeScript.

### Acceptance Criteria Coverage

| AC | Addressable? | Notes |
| --- | --- | --- |
| Blueprint-triggered one-shot overlay | Yes | Core of this slice |
| Blend in/out | Yes | Envelope on play |
| Auto-end / return without persistent entry | Yes | Runtime clear |
| Uses VRMA clip pipeline | Yes | Slice 1–2 assets |
| Persistent overlays unchanged | Yes | Additive compose step |
| Mixamo / random clip picker | No | Out of scope |
| CHR-04 checkbox | No | Still partial (OBS evidence, Mixamo) |

## Next step

REASONS contract: [transient-one-shot-overlays](../prompt/2026-11-23-transient-one-shot-overlays.md). Implementation plan: [transient-one-shot-overlays plan](../../docs/superpowers/plans/2026-11-23-transient-one-shot-overlays.md).
