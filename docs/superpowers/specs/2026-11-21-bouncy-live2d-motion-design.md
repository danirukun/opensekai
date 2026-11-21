# Bouncy Live2D-style motion design

Date: 2026-11-21. Status: approved by the owner on 2026-11-21. Issue: [#294](https://github.com/danirukun/opensekai/issues/294). Related: Face-Only Body Motion ([design](2026-11-18-face-only-body-motion-design.md)), VPoyo gap 2 ([gaps](../../vpoyo-gaps.md)).

## Intent

VPoyo moves a VRM like a Live2D model: the upper body sinks when the chin drops and bounces up when it rises. OpenSekai must give the same look for face-only tracking, as an explicit Blueprint chain the user can see and tune. The effect must stay smooth at the OBS frame rate.

## Goals

- G1. A Blueprint-owned bouncy chain on the Face-Only Body Motion template: head pitch and jaw open drive a damped spring; the spring drives spine and chest local Y and a small uniform scale.
- G2. Controls are graph variables: `Bouncy Motion` (boolean, default off) and `Bouncy Intensity` (number). Node settings expose weights, spring, and damping. Everything saves with the show.
- G3. The effect is additive with the existing Face-Only lean, body-follows-head, and arm/finger sway.
- G4. When the character has a body source, the bouncy writers skip covered bones (same rule as `character.offsetBones`).
- G5. Unit tests cover the spring response. A macOS OBS check at 60 FPS shows no jitter.

## Non-goals

- N1. New avatar schema fields or character Inspector rows in v1. Variables on the Face-Only graph are the controls (Issue AC said "on the character"; this design maps that to Blueprint variables, optionally mirrored in the Inspector later).
- N2. Bounce with a body source (VMC / MediaPipe body). Face-only only.
- N3. Eye jiggle (#295), spring-bone controls (#14 remainder), root or hips Y bounce.
- N4. A one-node black box that hides the spring and the writers.

## Anti-goals

- Do not run a second spring in each renderer. The session owns the spring state.
- Do not diverge editor preview, OBS, and VMC send for the same session frames.
- Do not change the tracking compose path or invalidate Face-Only Body Motion evidence.
- Do not lower the concert benchmark.

## Decisions with the owner

| # | Decision | Rejected alternative | Date |
| --- | --- | --- | --- |
| O1 | Face-only only (no body source) | Always-on with face; always when toggle on | 2026-11-21 |
| O2 | Spine and chest local Y (hips stay) | Hips Y; whole avatar root Y | 2026-11-21 |
| O3 | Uniform scale on spine and chest, same spring as Y | Y-only scale; defer squash | 2026-11-21 |
| O4 | Weighted sum of head pitch and jaw open | Pitch primary + small jaw; max of sinks | 2026-11-21 |
| O5 | Additive with Face-Only Body Motion offsets | Exclusive; split template ownership | 2026-11-21 |
| O6 | Blueprint nodes + template (Approach 2) | Session character motion layer; renderer-only spring | 2026-11-21 |

## Constraints

- Session worker is the one authority (`ARCHITECTURE.md`). Graphs run on the session clock.
- Today `AvatarPose.boneOffsets` and `offsetBone` effects are rotation-only. This slice extends the bone-offset layer with translation and uniform scale.
- Stateful nodes keep plain data in `RunState.nodes`. Substeps at most 16 ms (same pattern as Pendulum).
- MCP uses the same command API; `blueprint_import` template `face-only-body-motion` returns the updated graph.
- Motion continues when the editor is minimized.
- STE for long prose; short UI copy.

## Approaches (summary)

1. Session spring on character settings. Rejected by owner: less explicit, harder to rewire.
2. **Blueprint nodes + Face-Only template (selected).** New spring node and translation/scale writers; template variables for enable and intensity.
3. Renderer-only post-process. Rejected: breaks one authoritative simulation.

## Design

### Pure spring

Module in `packages/session` (unit-tested):

- Drive: weighted sum of head pitch (degrees, Pendulum rotation unit `1/180`) and `jawOpen` (0..1), each with weight, scale, absolute, and clamp (same shape as Pendulum inputs where practical).
- State: one damped spring (`position`, `velocity`). Max substep 16 ms. Stable for session deltas from 1 ms to 100 ms.
- Output: scalar `bounce` (0 = rest; negative = sink; positive = rise). Intensity multiplies after the spring in the graph, not inside the spring.

Default node settings (tunable in the Blueprint editor; template pins starting values):

| Setting | Default (v1) |
| --- | --- |
| Pitch weight / scale / clamp | 1 / 1 / −1..1 (after unit) |
| Jaw weight / scale / clamp | 0.5 / 1 / 0..1 |
| Spring / damping / input smoothing | Fixed defaults chosen so a chin dip settles in under ~0.5 s without sustained jitter at 60 Hz |
| Sign | Chin down and jaw open drive negative `bounce` (sink); chin up drives positive (rise) |

Exact numeric spring gains are a builder choice validated by unit tests and the OBS check; they are not Warudo ports (Warudo has no this feature).

### New nodes

All appear in the palette and work in any graph.

1. `tracking.bouncySpring` (data, stateful; category Tracking)
   - Settings: character; pitch and jaw input rows (or fixed fields with the same numbers); spring; damping; input smoothing.
   - Reads the composed pose of the previous tick (same path as `tracking.pendulum` / `tracking.getHeadPose`): head rotation and `jawOpen` from expressions.
   - Output: `value` (number).
   - Step uses session `deltaSeconds` with the pure spring module.

2. `character.offsetBoneTranslation` (flow)
   - Settings: character; `bones` (humanoid list); `axis` (x/y/z); `intensity`; `offset`.
   - Inputs: `value`, `weight` (default 1).
   - For each bone not skipped by `offsetBonesSkipped`, emits a translation offset effect: `weight × (value × intensity + offset)` on the axis.
   - Template: bones `spine`, `chest`; axis `y`.

3. `character.offsetBoneScale` (flow)
   - Settings: character; `bones`; `intensity`; `offset` (added after the product; rest scale is 1).
   - Inputs: `value`, `weight` (default 1).
   - Uniform scale per bone: `1 + weight × (value × intensity + offset)`, clamped to a safe range (for example 0.5..1.5) so a bad graph cannot invert the mesh.
   - Template: bones `spine`, `chest`.

### Bone-offset layer and pose

- Extend the session bone-offset layer so each bone can hold rotation (as today), optional local translation (`Vec3`), and optional uniform scale (`number`).
- Compose into `AvatarPose` after the Blueprint tick (same moment as today's rotation offsets). Schema and Rust contracts grow with the TypeScript types.
- Renderer (`avatar-pose.ts`): after rotation offsets, apply translation then scale on those bones in the parent frame.
- VMC send composition applies the same translation and scale so external apps match OBS.
- Spring bones still run after pose apply; no change to the spring-bone path.
- `previousPose` used by graph readers does not include offsets (no feedback loop), same as today.

### Template changes

Update `face-only-body-motion.json` / `faceOnlyBodyMotionTemplate`:

1. Variables: `Bouncy Motion` (boolean, default `false`); `Bouncy Intensity` (number, default `0.5`, range suited to the writers, about 0..2).
2. On the existing On Update chain (after fade is available), add a branch:
   - `tracking.bouncySpring` → Multiply by `Bouncy Intensity` → Multiply by `Bouncy Motion` (0/1) → `character.offsetBoneTranslation` (spine+chest, Y) and `character.offsetBoneScale` (spine+chest).
   - Use the same `fade` weight as other Face-Only outputs so loss of tracking eases the bounce out.
3. Existing body-follows-head, lean, arms, and fingers stay unchanged and remain additive with the new writers.

Tracking guide, Templates menu, and MCP `blueprint_import` with `template: "face-only-body-motion"` keep working; new graphs get bounce off by default. A saved show with an older Face-Only graph without the chain stays valid; the user can re-import the template or add the nodes by hand to get bounce.

### UI and MCP

- Primary controls: Blueprint Variables drawer (`Bouncy Motion`, `Bouncy Intensity`). Advanced tuning on node settings.
- No new character Inspector fields in v1.
- No new MCP tool. Variable edits use existing Blueprint edit ops. Template import returns the new graph shape.

### Testing and evidence

- Unit: spring step (sink on chin-down + jaw, rise on chin-up, damping, substep stability, intensity outside the spring).
- Unit: translation and scale writers; skip when a body source covers the bone.
- Contract: node definitions, schema limits, template variables and defaults.
- Session integration: one graph tick writes spine/chest Y and scale into the composed pose.
- macOS evidence: face-only character, Bouncy on, OBS ~60 FPS, no visible jitter; record commit, backend, quality profile. Update `docs/vpoyo-gaps.md` gap 2 when verified. Parity / evaluation note as needed (no Warudo row for this feature).

## Architecture map

Same commit that lands the feature updates `ARCHITECTURE.md`: Blueprint bone offsets may include translation and scale; Face-Only Body Motion includes the optional bouncy chain; session owns the spring state.

## Open builder choices (not owner blockers)

- Exact spring and damping gains (pick under unit tests + OBS feel).
- Exact pitch/jaw default weights in the template.
- Clamp range for uniform scale.
- Whether translation/scale share one `offsetBoneTransform` effect kind or two effect kinds (implementation detail; pose result is the same).
