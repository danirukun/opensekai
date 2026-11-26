# Snow

Date: 2026-11-26. Status: design approved by the owner; not implemented. Related: [ENV-10 / #48](https://github.com/danirukun/opensekai/issues/48) particle effects, [ENV-09 / #47](https://github.com/danirukun/opensekai/issues/47) wind, [quality profile effects budget](./2026-11-22-quality-profile-effects-budget-design.md), [spring bones](./2026-11-18-spring-bones-design.md), [benchmark contract](../../evaluation/benchmark-contract.md).

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
| Approach | A compute pass and a storage buffer for each skinned mesh (WebGPU). WebGL 2 falls back to the static cap. |

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
| `snow-sky.ts` | The sky depth pass: one orthographic camera at the top of the box that looks down, and one depth target. It gives the depth texture and the world-to-sky matrix as uniforms. | scene layers |
| `snow-flakes.ts` | One instanced mesh on its own layer. A flake below the sky depth is not drawn. | `snow-sky` |
| `snow-build-up.ts` | For each skinned mesh of an avatar: one storage buffer and one compute node. | `snow-sky`, the spring clock |
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

Each skinned mesh has one storage buffer with one record for each vertex: the previous world position and the amount (16 bytes). The compute node skins the vertex, reads the sky depth, and updates the amount. three.js 0.187 has `computeSkinning` and the bone matrices of the previous frame.

The step for each vertex, for one tick:

| Term | Rule |
| --- | --- |
| `up` | How much the skinned normal faces up: 0 below 0.35, then a smooth ramp to 1 at straight up |
| `sky` | 1 when the vertex is at the sky depth surface, 0 when it is more than 2 cm below that surface, with a soft step between. 0 outside the box. |
| Grow | `rate / buildUpSeconds × up × sky` |
| Slide | While `up` is 0, the amount decays with a time constant of 0.5 s |
| Shed | From the vertex speed: no loss below 0.6 m/s, and above 2 m/s the amount decays with a time constant of 0.25 s, with a smooth step between |
| Melt | `1 / meltSeconds` while `rate` is 0 |

The amount stays in 0 to 1.

- The six constants (0.35, 2 cm, 0.5 s, 0.6 m/s, 2 m/s, 0.25 s) are in `snow-math.ts`. They are start values, not settings. The spike tunes them on the Catboy avatar.
- On the first frame of a renderer, after a reload, and for an avatar that loads while snow is on, each vertex starts at `cover × up × sky`.
- The step follows the spring reset rules. On a frame where the spring stage resets (a teleport, a new session, more than 15 steps due), the speed term is 0 and the previous position is set again. A teleport does not shed snow.
- A mesh in `hiddenMeshes` runs no compute.
- When `visible` goes off, each amount is set to 0.
- With `settleOnCharacters` off, the amount of each vertex is 0 and no compute runs.

### Static cap on props and the environment

The amount is a function in the shader: `up × cover × inside`, where `up` has the same ramp as above and `inside` is 1 in the box. It has no shelter test and no memory. The flag `settleOnProps` or `settleOnEnvironment` multiplies it.

### Surface look

`snow-surface.ts` has one function. A character material gives it the amount from the storage buffer as a vertex attribute. A prop or environment material gives it the static cap.

- **Edge.** The mask is the amount compared against a small tiling noise texture. A character uses rest-pose space, so the pattern stays fixed on the body. A prop or the environment uses world space. Snow arrives as patches with a ragged edge.
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

These are start values. The spike measures them, and this table then gets the final values with the measured cost.

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
6. **Tiers, the WebGL 2 fallback, and the full evidence run.**

Slice 1 is sequential, because it changes shared contracts. Slice 2 lands its frame field next. After that, slices 3, 4, and 5 touch different packages and can run in separate worktrees.

## Documents to update

- `ARCHITECTURE.md`: a short Snow paragraph in the Output path, in the commit that adds the modules.
- `docs/warudo-parity.md`: a partial note on ENV-10 that claims only the verified behavior. ENV-09 stays open.
- `docs/evaluation/snow.md`: the evidence.
- `docs/handbook/stage.md` or a new handbook page: how to use the Snow asset.

## Open questions

None. The spike can change the tier table and the six build-up constants; record each change here.
