# Snow

Date: 2026-11-26. Status: design approved by the owner; slice 1 not verified (2026-11-27). The OBS checks of evidence 1 and 2 pass. The Editor window checks and the budget gate are unknown ([evidence](../../evaluation/snow.md)). Related: [ENV-10 / #48](https://github.com/danirukun/opensekai/issues/48) particle effects, [ENV-09 / #47](https://github.com/danirukun/opensekai/issues/47) wind, [quality profile effects budget](./2026-11-22-quality-profile-effects-budget-design.md), [spring bones](./2026-11-18-spring-bones-design.md), [benchmark contract](../../evaluation/benchmark-contract.md).

## Intent

Add a snow effect that the operator can turn on and off. Snow falls in a region of the scene and collects on the characters in a realistic way: it builds up over time on the surfaces that face up and can see the sky, it stays off sheltered surfaces, it falls off when a body part tilts or moves fast, and it melts when the snowfall stops. The effect must fit in a fixed share of the frame budget on a Mac.

## References

- [SnowSystemThreeJS](https://github.com/achrefelouafi/SnowSystemThreeJS) (MIT). Its flakes are instanced billboards whose position is a pure function of a seed and the time, wrapped around the camera. This design uses that method. Its snow on a model is a static cap: each surface that faces up gets snow, with noise and a vertex push. It has no build-up over time and no shelter. This design uses that method only for props and the environment.
- [snowflow_demo](https://github.com/Noniv/snowflow_demo) (MIT). It deforms the ground under the feet of a character with a persistent state buffer. It puts no snow on the character. This design does not use ground deformation. The idea of a persistent state that each frame updates is the same as the build-up buffer here.

Neither reference collects snow on a skinned character. That part of this design is new.

## Decisions (owner, 2026-11-26)

| Topic | Decision |
| --- | --- |
| Meaning of "collect realistically" | Each character vertex keeps a snow amount, with a sky test, shedding, and melt |
| Control surface | One Snow scene entity, in the Haze pattern. No easter egg in this design. |
| Surfaces | Characters get the full build-up. Props and the environment get a static cap. |
| Budget | At most 2 ms p95 GPU on the M3 Pro at `production_v1`. A cheap tier through `effectsQuality`. M1 is unknown until measured. |
| Approach | A compute pass and storage buffers for each avatar (WebGPU). WebGL 2 falls back to the static cap. |

### Changes after approval (planning, 2026-11-26)

The plan for slice 1 found two facts that change the mechanism, not the behavior.

| Change | Reason |
| --- | --- |
| One compute pass for each avatar, over the vertices of all its skinned meshes. The approved text said one pass for each skinned mesh. | The Catboy QA avatar has 57 meshes (Face, Body, Hair001 to Hair055). One pass for each mesh gives 57 pipelines, 57 dispatches, and 57 bone uploads on each frame. A new pipeline costs about 0.4 s in WebKit. |
| The sky pass writes the height of the first surface under the sky into a colour target. The approved text said a depth target. | The three.js example `webgpu_compute_particles_snow` uses this method, and a colour target has no depth-texture sampling rule in a vertex or compute stage. This document still calls that surface the sky depth surface. |

### Changes from the spike (slice 1, 2026-11-27)

The first run on a GPU changed these values and one mechanism. The [evidence page](../../evaluation/snow.md) has the measurements.

| Change | Reason |
| --- | --- |
| Shed start 0.15 m/s (was 0.6) and full shed 0.6 m/s (was 2) | A yaw head shake of ±30° at 2 Hz moves the ear tips at 0.66 m/s and the crown at almost 0 m/s. At 0.6 m/s the head kept all its snow. At the new values the shake clears the head, and the built-in idle keeps the snow. |
| Noise scale of the edge mask: 3 for each metre (was 6) | At 6, a build-up or a melt showed as a 5 mm speckle. At 3, the snow comes and goes as patches with a ragged edge. |
| Each avatar has its own node build of each MToon material with snow. The program cache key has the id of the state buffer. | three.js keeps one node build for each cache key, and a build holds the storage buffer of its first material. With one key, two avatars drew the amounts of one avatar. The WGSL is the same, so the GPU program is shared. |

Facts for the next decision:

- A shake around the vertical axis keeps a tuft of snow at the axis, because the shed rule uses the vertex speed.
- At `rate` 1 and `buildUpSeconds` 45, no snow shows in the first 15 to 20 s, and a slope has its full cover after about 60 s.
- An indicative sample (locked screen, battery power, not a benchmark summary) gave +2.29 ms p95 `gpuMs` and +1.7 ms p95 `cpuMs` for snow on against snow off. These values are above the budget gate. The `cpuMs` part does not depend on the flake count or the sky size.

## Goals

1. A `snow` entity that the editor, MCP, and Blueprints control through the existing command route.
2. Flakes that fall in the snow box, stop at the first surface under the sky, keep the OBS alpha correct, and continue while the editor is minimized.
3. Build-up on characters that agrees with the list in Intent.
4. A static cap on props and the environment that follows the snowfall.
5. The measured cost of snow is in the budget gate below.
6. A scene without a Snow entity has no snow cost.

## Non-goals

- A Wind asset. ENV-09 stays separate. A later Wind asset can replace the two wind fields of the Snow settings.
- Footprints and ground deformation.
- Clumps that fall when snow sheds. Shed snow disappears.
- Sound.
- A hidden trigger (winter easter egg). A later small slice can add one over the same entity.
- Build-up for each vertex on the WebGL 2 fallback.
- Chat intents for snow in `packages/assist`.

## Scene data

### Entity

A new entity kind `snow`, at most 1 in a scene (`LIMITS.snows = 1`).

- The transform is a box, as for Haze. The position and the scale give the region. Snow falls along world down, so only the yaw of the rotation has an effect.
- `visible` is the hard switch. When it is off, the flakes and all settled snow go away at once.
- `rate` is the soft control. At 0, the flakes thin out and the settled snow melts.

### Settings

The `snow` group of the entity. One patch operation, `setSnow`, replaces the group, as `setHaze` does.

| Field | Range | Default | Effect |
| --- | --- | --- | --- |
| `rate` | 0 to 1 | 0.5 | Flake density and build-up speed |
| `fallSpeed` | 0.2 to 3 m/s | 1 | Fall speed |
| `flakeSize` | 0.5 to 2 | 1 | Size multiplier |
| `flutter` | 0 to 2 | 1 | Sideways meander of each flake |
| `windDirection` | 0 to 360° | 0 | Direction of the horizontal drift |
| `windSpeed` | 0 to 5 m/s | 0 | Horizontal drift. It moves flakes only. The sky test stays vertical. |
| `buildUpSeconds` | 5 to 600 | 45 | Time to full cover at rate 1 on an open surface |
| `meltSeconds` | 5 to 600 | 20 | Time for full cover to melt at rate 0 |
| `thickness` | 0 to 0.05 m | 0.015 | Depth of the settled layer |
| `settleOnCharacters` | boolean | true | Characters collect snow |
| `settleOnProps` | boolean | true | Props collect snow |
| `settleOnEnvironment` | boolean | true | The environment collects snow |

The settle flags follow the Affect flags of a light. With `settleOnEnvironment` off, an indoor hall stays clean.

### Control paths

- **Editor.** Add › Snow. One Snow section in the Inspector, with kit sliders and the existing `visibility-control` checkbox pattern. A box helper and pick target in the editor viewport, as for Haze.
- **MCP.** `scene_patch` with `setSnow`. No new tool.
- **Blueprint.** The property registry gives a snow entity the `position`, `rotation`, `scale`, and `visible` targets, and one new key `snowRate` (number, 0 to 1). A transition on `snowRate` gives a fade. `snow` is a reference kind in a Blueprint file.
- **Rust.** `crates/contracts` mirrors the shape, and `fixtures/protocol/validation-vectors.json` keeps both sides equal.

### Runtime state on the frame

The session keeps one `cover` value (0 to 1) for the Snow entity (`packages/session`, a new `snow-cover.ts`):

- While `rate` is above 0, `cover` rises by `rate / buildUpSeconds` for each second.
- While `rate` is 0, `cover` falls by `1 / meltSeconds` for each second.
- When `visible` is off or the entity leaves the scene, `cover` is 0.
- A show open starts at 0. The value is never saved and does not change the revision.

Each frame carries `snow: { entityId, cover }` while a Snow entity exists. This is the `screenPlayback` pattern.

## Renderer

All snow code is in `packages/renderer`. `renderer.ts` gets the wiring only, as for Haze.

| Module | Job | Depends on |
| --- | --- | --- |
| `snow-math.ts` | Pure CPU reference: flake position, build-up step, static cap, tier table. No three.js. | nothing |
| `snow-sky.ts` | The sky pass: one orthographic camera at the top of the box that looks down, and one height target. It gives the height texture and the world-to-sky matrix as uniforms. | scene layers |
| `snow-flakes.ts` | One instanced sprite on its own layer. A flake below the sky depth surface is not drawn. | `snow-sky` |
| `snow-build-up.ts` | For each avatar: one set of storage buffers and one compute node over the vertices of all its skinned meshes. | `snow-sky`, the spring clock |
| `snow-surface.ts` | The TSL nodes that turn an amount into a vertex push and a snow colour. | nothing |
| `snow.ts` | The facade: `createSnow()`, `update(entity, frame)`, `dispose()`. | the modules above |

### Order in one applied frame

1. Poses and spring bones, as now.
2. The sky depth pass. It draws avatars, props, and the environment with a depth-only material. It does not draw the flakes, the haze, or the beams.
3. The build-up compute, on the 1/60 s session tick grid of the spring bones (`spring-grid.ts`).
4. The main render. Flakes draw here as premultiplied transparent quads with a depth test and no depth write.

Steps 2 and 3 run inside the applied frame, so `gpuMs` includes them. A render outside the frame makes `gpuMs` null, and then the budget gate has no measurement.

### Flakes

- The position of a flake is a pure function of its seed, `frame.elapsedMs`, and the settings. No flake has state. All clients agree for the same frame, and the motion continues while the editor is minimized.
- A flake wraps inside the box.
- A flake below the sky depth surface is not drawn. So no flake falls through a head, a prop, or a roof.
- Flakes are soft round billboards. The size and the opacity vary with the seed, and a far flake is smaller and fainter. Flakes take the ambient colour of the scene.
- Flakes draw in the scene pass. They do not make the renderer use the post chain, and a screenshot includes them.
- Flakes do not cast a shadow, and the shadow passes do not draw them.

### Build-up on characters

Each avatar has one state buffer with one record for each vertex of its skinned meshes: the previous world position and the amount (16 bytes). Four more buffers hold the bind-space position, the bind-space normal, the skin indices, and the skin weights (64 bytes for each vertex), and one buffer holds the bone matrices of its skeletons. One compute node skins each vertex, reads the sky height, and updates the amount. A character material reads the state buffer in the vertex stage at the vertex index plus the offset of its mesh. three.js 0.187 does the same skinning math in `computeSkinning`, for one mesh.

The step for each vertex, for one tick:

| Term | Rule |
| --- | --- |
| `up` | How much the skinned normal faces up: 0 below 0.35, then a smooth ramp to 1 at straight up |
| `sky` | 1 when the vertex is at the sky depth surface, 0 when it is more than 2 cm below that surface, with a soft step between. 0 outside the box. |
| Grow | `rate / buildUpSeconds × up × sky` |
| Slide | While `up` is 0, the amount decays with a time constant of 0.5 s |
| Shed | From the vertex speed: no loss below 0.15 m/s, and above 0.6 m/s the amount decays with a time constant of 0.25 s, with a smooth step between |
| Melt | `1 / meltSeconds` while `rate` is 0 |

The amount stays in 0 to 1.

- The six constants (0.35, 2 cm, 0.5 s, 0.15 m/s, 0.6 m/s, 0.25 s) are in `snow-math.ts`. They are not settings. The spike tuned the two shed speeds on the Catboy avatar (first values 0.6 m/s and 2 m/s); the other four are the first values.
- On the first frame of a renderer, after a reload, and for an avatar that loads while snow is on, each vertex starts at `cover × up × sky`.
- The step follows the spring reset rules. On a frame where the spring stage resets (a teleport, a new session, more than 15 steps due), the speed term is 0 and the previous position is set again. A teleport does not shed snow.
- A mesh in `hiddenMeshes` is not in the sky pass, so it gives no shelter. Its vertices stay in the compute pass, because one pass covers the avatar.
- When `visible` goes off, each amount is set to 0.
- With `settleOnCharacters` off, the amount of each vertex is 0 and no compute runs.

### Static cap on props and the environment

The amount is a function in the shader: `up × cover × inside`, where `up` has the same ramp as above and `inside` is 1 in the box. It has no shelter test and no memory. The flag `settleOnProps` or `settleOnEnvironment` multiplies it.

### Surface look

`snow-surface.ts` has one function. A character material gives it the amount from the storage buffer as a vertex attribute. A prop or environment material gives it the static cap.

- **Edge.** The mask is the amount compared against a small tiling noise texture, at 3 repeats for each metre. A character uses rest-pose space, so the pattern stays fixed on the body. A prop or the environment uses world space. Snow arrives as patches with a ragged edge.
- **Depth.** The vertex moves out along its normal by `thickness × amount`, scaled by the scale of the entity.
- **Colour.** The base colour mixes to snow white and the shade colour to a cool blue-grey, before the toon lighting. So snow takes the scene lights, the shadow bands, and the shade colour. The mask lowers the rim and matcap terms.
- **Sparkle.** Small view-dependent glints, in the full tier only.

### Material hooks and the compile rule

- `CharacterMToonMaterial` and `CharacterLilToonMaterial` get the surface nodes. Their outline copies get the vertex push also, so the outline follows the surface.
- The per-instance material copies of props and environments (`environment-light.ts`, `copyUnlitMaterials`) get the surface nodes where they get their light nodes.
- A material with blended transparency gets no snow.
- The nodes are in a material only while the scene has a Snow entity. To add or remove the entity is the one compile step, and it occurs at edit time. Each setting, `visible`, and `cover` is a uniform write.

## Quality tiers

One adapter, `snowTier(profileId)`, reads `QUALITY_PROFILES[id].effectsQuality`, as `lookQuality` does. There is no new profile field and no new profile ID.

| | Full (`production_v1`) | Cheap (`preview_v1`, `performance_v1`) |
| --- | --- | --- |
| Flakes at rate 1 | 12,000 | 4,000 |
| Sky depth target | 512 × 512, each frame | 256 × 256, each second frame |
| Build-up step | each tick | each second tick, with a doubled time step |
| Sparkle | on | off |

The spike did not change these values. The full tier (12,000 flakes, a 512 × 512 sky target each frame, a build-up step each tick) ran in OBS on WebGPU. Its measured cost against the budget gate is unknown: no valid run exists. An indicative sample gave +2.29 ms p95 `gpuMs` and +1.7 ms p95 `cpuMs` with two performers ([evidence](../../evaluation/snow.md#evidence-6-budget)). The cheap tier has no code and no measurement.

## Budget gate

- OBS output, WebGPU, `production_v1`, 1920 × 1080 at 60 FPS, two performers, snow at rate 1 with all settle flags on.
- Snow on minus snow off, same scene and camera: at most 2 ms p95 `gpuMs` and at most 0.5 ms of `cpuMs`.
- Three runs, each with a 30 s warm-up and 120 s measured.
- Host: Apple M3 Pro. Label debug and release builds. The M1 tier is unknown until a run on an M1 exists.
- If the full tier fails: lower the flake count first, then the sky depth size. The build-up step rate is the last lever.

A scene without a Snow entity has no snow nodes, passes, or buffers. A Snow entity with `visible` off skips the sky pass, the compute, and the flake draw.

## Fallback and failures

- **WebGL 2.** No compute pass. Characters get the static cap. Flakes and the sky depth work as on WebGPU. Each frame acknowledgment carries the warning `Snow build-up unavailable`, and the capability report shows the difference.
- **Pipeline failure.** A snow pipeline that fails to compile goes through `pipeline-blame.ts` as haze and beams do. Snow stops until the next rebuild, and the rest of the frame draws.
- **Avatar load.** An avatar that loads or reloads while snow is on gets its buffers in the load job, outside frame submission.
- **Release.** An avatar or a Snow entity that leaves the scene disposes its buffers and targets.

## Known limits

- Morph targets do not move the build-up test. The error is millimetres on a face.
- A flake does not land at the exact place where snow grows. The two share the sky depth, so they agree on where snow can reach.
- Shed snow disappears.
- Wind moves the flakes only. Snow does not collect more on the side that faces the wind.
- Props and the environment have no shelter test.
- The build-up state is local to each renderer. Two clients can differ for a few seconds after a reload, until the warm start and the same rule bring them together.

## Tests

| Level | What | Reason for the level |
| --- | --- | --- |
| Unit | `snow-math.ts`: the flake position is the same for the same seed and time, and wraps in the box; the build-up step grows under open sky, stays 0 under shelter, slides, sheds above the speed threshold, and melts; the warm start; the static cap; the tier table | Pure logic |
| Unit | Session `cover`: rises with `rate`, melts at 0, clamps, is 0 when `visible` is off, starts at 0 on a show open | State transition |
| Unit | Contracts: the `setSnow` ranges, the limit of 1, `snowRate` in the property registry. Rust and TypeScript agree through the validation vectors. | Wire shape |
| Integration | The renderer on the headless WebGPU baseline: a frame with a Snow entity applies with no pipeline failure, and the WebGL 2 run gives the fallback warning | A real GPU boundary. A unit test cannot find a WGSL compile error. |
| Browser and OBS | The running app with the Catboy avatar, driven through MCP | The acceptance evidence |

## Acceptance evidence

Record in `docs/evaluation/snow.md` with the backend, the quality profile, the fixture revision, and the commit.

1. Snow collects on the head, the shoulders, and a held-out arm, and not under the fringe or under a raised arm.
2. A head shake sheds it. `rate` 0 melts it. `visible` off clears it.
3. OBS capture over dark, light, and checker backgrounds: the flakes and the snow edge keep a correct alpha.
4. Flakes continue to move in OBS while the editor is minimized.
5. The preview and OBS show the same cover after an OBS source reload.
6. The budget gate.
7. A Blueprint hotkey starts a snowfall with a transition on `snowRate`.
8. The static cap shows on a prop and on an imported environment, and each settle flag removes its part.
9. The memory run of the benchmark contract with snow toggled and an avatar reloaded shows no continued growth.

## Slices

Each slice gets its analysis in `spdd/analysis/` and its REASONS contract in `spdd/prompt/` before code.

1. **Feasibility spike.** The minimum `snow` entity and `setSnow` in the TypeScript and Rust contracts, so MCP can add the entity in the running app. Then the sky depth, the flakes, and the build-up on MToon materials. Gate: evidence 1, 2, and 6 on WebGPU in the Editor window and in OBS. If the compute path or the budget fails, stop and select again.
2. **Session cover.** `snow-cover.ts`, the frame field, and the warm start.
3. **lilToon characters** and the outlines of both material types.
4. **Static cap** on props and environments, with the settle flags. It needs the frame field of slice 2.
5. **Editor.** Add › Snow, the Inspector section, the viewport helper, the `snowRate` Blueprint key, and a handbook page.
6. **Tiers, the sparkle, the WebGL 2 fallback, and the full evidence run.**

Slice 1 is sequential, because it changes shared contracts. Slice 2 lands its frame field next. After that, slices 3, 4, and 5 touch different packages and can run in separate worktrees.

## Documents to update

- `ARCHITECTURE.md`: a short Snow paragraph in the Output path, in the commit that adds the modules.
- `docs/warudo-parity.md`: a partial note on ENV-10 that claims only the verified behavior. ENV-09 stays open.
- `docs/evaluation/snow.md`: the evidence.
- `docs/handbook/stage.md` or a new handbook page: how to use the Snow asset.

## Open questions

- Does the full tier pass the budget gate in valid conditions (unlocked screen, mains power, a benchmark summary)? If the `cpuMs` difference stays above 0.5 ms, the owner selects again: the flake count and the sky size do not lower it.
- Is a tuft of snow at the turn axis after a head shake acceptable, or does the shed rule need a term for the turn rate?

The changes of the spike are in "Changes from the spike".
