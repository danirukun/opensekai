# Shadowed beams analysis

Date: 2026-11-21. Status: **sketch, candidate only**. This record is not an implementation contract. It applies to ENV-08 ([#46](https://github.com/danirukun/opensekai/issues/46), closed as a first subset), the laser fixture ([#337](https://github.com/danirukun/opensekai/issues/337)), the concert demo ([#338](https://github.com/danirukun/opensekai/issues/338)), more shadow lights ([#316](https://github.com/danirukun/opensekai/issues/316)), and GPU time ([#305](https://github.com/danirukun/opensekai/issues/305)).

[V] = verified in the repository at `fd4fe09` or in the three.js r187 source. [I] = inferred. [E] = estimate, not measured.

## Question

A stage beam goes through the avatar today. Can a raymarch inside each beam cone let the avatar block the beam (a shadow shaft) for every beam, not only for the 2 shadow lights? What does it cost?

## Sources

- [Stage beams analysis](2026-11-13-stage-beams.md) and [contract](../prompt/2026-11-13-stage-beams.md): the cone approach, the rejected options, the composite rule, R10 to R15.
- [Light limits contract](../prompt/2026-11-17-light-limits.md): 32 lights, 8 lit lights, 2 shadow lights, 1 haze.
- `packages/renderer/src/beam.ts`, `beam-math.ts`, `haze.ts`, `post-chain.ts`, `scene-lights.ts`.
- three.js r187 `VolumeNodeMaterial` and `VolumetricLightingModel`.

## Current state

1. [V] **The haze is already a raymarch.** `haze.ts` uses `VolumeNodeMaterial` with `HAZE_STEPS = 12`, a Bayer offset against banding, and the scene depth. `VolumetricLightingModel` walks the ray through the haze box. At each step it evaluates each light of the `haze` set, multiplies the light by `lightNode.shadowNode` when the light has a shadow, and adds the result with Beer's law. Thus a "Scatter In Haze" spot light with Shadow on already gives a shadow shaft behind the avatar.
2. [V] **That shaft is limited.** Only 2 lights can have a shadow. The haze needs a haze entity. A narrow beam is under-sampled by 12 steps across the whole box (stage beams analysis).
3. [V] **A beam is a cone mesh with no march.** `beam.ts` draws an open cone on `BEAM_LAYER` in a pass at half resolution (`BEAM_RESOLUTION = 0.5`). The fragment colour is an analytic product: axis fade × view-dependent edge fade × near fade × depth fade × `BEAM_BASE`. It is additive, with no depth test. It does not receive a shadow (R10). One material and one pipeline serve all beams; a value or count change does not recompile (R11).
4. [V] **Beam count.** Beams draw for visible spot lights with `beam.enabled`, up to `LIMITS.lights` (32). A beam-only light counts toward the 32 lights, not toward the 8 lit lights.
5. [V] **Composite.** `hazeComposite` adds the beam light and turns its brightest channel into coverage, so the OBS output stays valid premultiplied alpha.

## Proposal: march inside each cone, with an avatar proxy for occlusion

### 1. The view ray inside the cone

- Draw the cone with `BackSide` only, as `VolumeNodeMaterial` does. A back face fragment exists when the camera is outside or inside the cone. The fragment gives the exit point.
- Work in the cone's local space, where the surface is x² + y² = z² for −1 ≤ z ≤ 0 (`beamGeometry`). Transform the camera position with the inverse model matrix.
- Find the entry point analytically: the first root of the ray–cone quadratic in the valid z range, or the hit on the open base plane z = −1, or the camera position when the camera is inside.
- Clip the exit to the scene depth (the existing `setDepth` texture), so the beam stops at a wall or the floor.

### 2. The march

- Walk `BEAM_STEPS` fixed steps (first value 12) from entry to exit, with the Bayer offset of `haze.ts` against banding.
- At each step point p (local coordinates, t = −z along the axis, ρ = radial position / cone radius at that z):
  - density = `axisFade(t)` × radial falloff(ρ, softness) × `BEAM_BASE`.
  - visibility = occlusion from p to the cone apex (section 3).
  - light += density × visibility × step length in metres.
- The colour is the beam colour × light. Keep the additive blend and the existing composite.
- Calibrate the radial falloff so that an unoccluded beam looks the same as today. The owner checks the look.

[I] The march also removes the known artefact of the cone approach "a view along the axis or from inside the cone can look wrong", because the thickness now comes from the real chord length through the cone.

### 3. Occlusion: an avatar proxy made of capsules

A shadow map for each beam does not scale: 32 beams need 32 extra depth passes of each skinned avatar each frame, and a shadow node for each light gives a pipeline for each light (this breaks R11). Instead:

- **Proxy.** For each avatar, a fixed set of capsules on the humanoid bones: hips–spine, spine–chest, chest–neck, neck–head, a head sphere, and for each side upper arm, lower arm, hand, upper leg, lower leg. That is 16 capsules [I].
- **Radii.** At load, fit each radius from the vertices whose largest skin weight is on that bone (for example the 80th percentile of their distance to the bone segment). A fallback scales default radii by the avatar height.
- **Data path.** The renderer reads the evaluated humanoid pose each frame and writes the capsules to one uniform array of fixed size (avatar limit × 16). An unused slot has radius 0. A pose change is a uniform write, not a recompile. The renderer uses the evaluated state, so a minimized editor does not stop the update.
- **Test at each step.** For the segment from p to the apex, compute the closest distance d to each capsule axis (segment–segment distance). visibility = min over capsules of smoothstep(r, r + w, d), where w is a small penumbra width that grows with the distance from the capsule to p.
- **Early-out.** First test one bounding sphere per avatar. Most steps skip the capsule loop.

This is the same "test against a distance field" idea as sphere tracing, but the shapes are simple enough for an exact closest-distance formula, so no inner march is necessary.

### 4. Limits of the proxy

- Hair, skirts, ears, and held props do not block a beam. [I] For a soft beam in haze this is acceptable. A later slice can add a prop occluder (a capsule or a box on a prop entity).
- Capsules are an approximation of the silhouette. A sharp beam (softness 0) shows the capsule shape most.

## Cost

[E] Pass size: 960 × 540 = 518 400 pixels at half of 1080p. Assume the beams cover the pass one time on average (a concert view with overlap). With 12 steps that is about 6.2 million steps. With the bounding-sphere early-out, assume 10 % of the steps run the 16-capsule loop at about 40 operations each, and the other steps run one test at about 20 operations. That is about 0.5 billion operations each frame. On an Apple M3 Pro at 10 % of the peak rate, this is about 0.7 ms. The real value can be 0.3 to 1.5 ms or outside this range. It stays unknown until #305 gives `gpuMs`.

[I] Compared with today: the cone fragment shader becomes a loop, so beam cost grows with the step count and the coverage, not with the light count. The haze cost does not change.

## Alternatives

| Option | Result | Reason |
| --- | --- | --- |
| A. March in the cone with a capsule proxy (this sketch) | Recommended | Works for each beam, one pipeline, uniform updates only |
| B. Use the spot light's shadow map when the light has Shadow on | Later, optional | Exact silhouette, and it matches the haze shafts. Only 2 lights, and a shadow node for each light gives a pipeline for each light. Two looks in one rig |
| C. A small extra shadow map for each beam (avatar layer only) | Rejected | 32 extra skinned depth passes each frame; CPU and memory cost |
| D. Screen-space light shafts (`GodraysNode`) | Rejected | No spot lights, needs a shadow light (stage beams analysis) |
| E. Make each beam light "Scatter In Haze" | Unchanged | Needs a haze and a shadow light; under-samples narrow beams |

## Owner decisions needed

1. Proxy only (A), or A plus B for shadow lights?
2. A per-light switch (for example `beam.shadows`) or always on? A switch adds a field to the strict `beam` group, with TypeScript and Rust vectors.
3. A fixed step count, or a step count in the quality profiles? A profile change needs new profile IDs (`preview_v2` and so on).
4. Do props block beams in the first slice?

## Selection gate

- The owner selects this candidate.
- The beam look of today is the reference: record a capture of the stage-beams fixture before the change.
- [I] #305 (`gpuMs`) is not required to start, but the cost evidence states GPU time as unknown until it lands.

## Evidence plan (for the contract)

- **Unit tests** (pure CPU reference in `beam-math.ts`, as today): ray–cone entry and exit (outside, inside, through the open base); segment–segment distance; capsule visibility and penumbra; the march integral of an unoccluded beam against the current analytic look within a tolerance; the capsule radius fit from vertices.
- **Integration test** (renderer frame path, headless, real loader): with a fixture avatar between a spot beam and the camera, the beam pixels behind the avatar are darker than the pixels beside it; with the avatar moved out, they match.
- **macOS and OBS**: the stage-beams fixture with an avatar; alpha correct over black, white, and checker; the shadow follows a tracked pose; the minimized editor keeps the update.
- **Cost**: the four cases of stage beams LC7 plus "8 beams with occlusion" and "32 beam-only lights with occlusion": frame rate, sampled CPU time, and OBS render-skipped frames, after 30 s, for 120 s. GPU time unknown unless #305 has landed.
