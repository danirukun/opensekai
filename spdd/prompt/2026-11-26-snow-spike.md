# REASONS: Snow feasibility spike

Date: 2026-11-26. Scope: slice 1 of the snow design (ENV-10, issue #48, first subset). Analysis: [snow feasibility spike](../analysis/2026-11-26-snow-spike.md). Design: [snow design](../../docs/superpowers/specs/2026-11-26-snow-design.md). Plan: [implementation plan](../../docs/superpowers/plans/2026-11-26-snow-spike.md). Evidence: `docs/evaluation/snow.md` (acceptance evidence 1, 2, and 6; Task 10 creates the file). Changes: none to the architecture design.

The owner approved the Decisions table and the changes after approval on 2026-11-26. The tier table and the six build-up constants are start values. Task 10 can change them. Each change goes into the design with the measured reason.

## Decisions

### Owner (2026-11-26)

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

### Slice boundaries (from the plan)

| # | Chosen | Alternative |
| --- | --- | --- |
| V1 | The build-up step uses `rate` from the entity. The session `cover` value and the warm start are slice 2 | Add `snow-cover.ts` in this slice |
| V2 | The buffers of an avatar are built on its first frame with snow | Build them in the load job (slice 6) |
| V3 | A WebGL 2 client draws flakes and no build-up in this slice | Add the static cap and the warning now |
| V4 | The outline copy of `CharacterMToonMaterial` gets no snow in this slice | Add the vertex push to the outline now |

## Constants

| Name | Value | Use |
| --- | --- | --- |
| `LIMITS.snows` | 1 | The number of snow entities in a scene |
| Up ramp start | 0.35 | `up` is 0 below this normal value, then a smooth ramp to 1 at straight up |
| Sky band (`skyBand`) | 0.02 m | A vertex more than this below the sky depth surface is sheltered |
| Slide | 0.5 s | Time constant of the decay while `up` is 0 |
| Shed start | 0.6 m/s | No loss below this vertex speed |
| Shed full | 2 m/s | Full shed above this vertex speed |
| Shed | 0.25 s | Time constant of the decay above the full shed speed |
| Flakes, full tier | 12,000 at rate 1 | The flake count |
| Sky target, full tier | 512 × 512 | The sky depth target size |
| Tick | 1/60 s | The build-up step, on the grid of `spring-grid.ts` |
| Note (Task 10, 2026-11-27) | Shed start 0.15 m/s, shed full 0.6 m/s, noise scale 3 for each metre | The spike tuned the two shed speeds and the noise scale of the edge mask. The rows above keep the first values. The [design](../../docs/superpowers/specs/2026-11-26-snow-design.md#changes-from-the-spike-slice-1-2026-11-27) has the reasons, and the shed speeds are an open question there. |

The six build-up constants are in `snow-math.ts`. They are start values, not settings.

### Setting ranges and defaults

| Field | Range | Default |
| --- | --- | --- |
| `rate` | 0 to 1 | 0.5 |
| `fallSpeed` | 0.2 to 3 m/s | 1 |
| `flakeSize` | 0.5 to 2 | 1 |
| `flutter` | 0 to 2 | 1 |
| `windDirection` | 0 to 360° | 0 |
| `windSpeed` | 0 to 5 m/s | 0 |
| `buildUpSeconds` | 5 to 600 | 45 |
| `meltSeconds` | 5 to 600 | 20 |
| `thickness` | 0 to 0.05 m | 0.015 |
| `settleOnCharacters` | boolean | true |
| `settleOnProps` | boolean | true |
| `settleOnEnvironment` | boolean | true |

## Scope of this slice

In: the entity and `setSnow` in both contracts, the session operation, the sky pass, the flakes, the build-up compute, the snow surface on `CharacterMToonMaterial` (not its outline copy), renderer wiring on WebGPU, and evidence items 1, 2, and 6 of the spec.

Out (later slices of the spec): the session `cover` value and the warm start (slice 2), lilToon and outlines (slice 3), the static cap on props and environments and the effect of the settle flags on them (slice 4), Add › Snow, the Inspector section, the viewport helper, `snowRate`, and the handbook (slice 5), the tier adapter, the sparkle, the WebGL 2 static cap and its warning, `pipeline-blame`, the headless WebGPU integration test, and building the buffers in the load job (slice 6). In this slice a WebGL 2 client draws flakes and no build-up, and the buffers of an avatar are built on its first frame with snow.

## Review Focus

1. **Sky lookup is mirrored.** A prop above the left shoulder must keep the left shoulder clean, not the right one. Render-target UV origin differs between conventions. Test: Task 5 pins the camera against `skyMatrix`; Task 10 step 4 checks the side on the GPU.
2. **Two performers from one asset.** Each avatar needs its own state buffer. If two avatar instances share one material object, the second share replaces the first. Test: Task 9 asserts that two avatars get two shares and that no material holds the share of another avatar; Task 10 step 6 shakes one head only.
3. **An avatar with no skinned mesh, or a mesh with `bindMode` not `attached`.** Expected: no build-up for that mesh, no error, flakes still draw. Test: Task 7.
4. **The Snow entity or an avatar leaves the scene, or an avatar reloads, while snow is on.** Expected: buffers and targets are disposed, materials lose the snow nodes, and no stale offset reads another buffer. Test: Task 9.
5. **A long session.** At `elapsedMs` of 4 hours the flake position must stay in the box and finite. Test: Task 4.
6. **A steep surface that faces up.** The sky texel is about 1.2 cm at a 6 m box, so a slope can read as sheltered in bands. Expected: no visible stripes on the shoulders at the default box. Check: Task 10 step 3; tune `skyBand` there and record the value in the spec.

## R — Requirements

### R1. The entity, its limit, and `setSnow` (Tasks 2 and 3)

R1.1. A scene entity of kind `snow` has `transform`, `visible`, and a `snow` group. The transform is a box, as for Haze. Snow falls along world down, so only the yaw of the rotation has an effect.

R1.2. A scene has at most 1 snow entity (`LIMITS.snows = 1`). TypeScript (zod) and Rust reject a scene with 2.

R1.3. The `snow` group has the 12 fields, ranges, and defaults of the table above. `DEFAULT_SNOW` in `packages/contracts/src/snow.ts` holds the defaults. A field outside its range fails validation. An unknown field fails validation.

R1.4. The patch operation `setSnow` carries `entityId` and a whole `snow` group, and replaces the group of the entity, as `setHaze` does. It fails with `INVALID_INPUT` when the entity is not a snow entity.

R1.5. `crates/contracts` mirrors the shape. `fixtures/protocol/validation-vectors.json` holds five snow vectors, and TypeScript and Rust give the same accept or reject result for each.

R1.6. The editor compile sites (`help.ts`, `asset-groups.ts`, `inspector-sections.ts`) accept the new kind, and the Hierarchy shows a snow entity in the Environment group. This slice adds no Add menu entry and no Inspector section.

R1.7. MCP adds and changes a snow entity with the existing `scene_patch` tool (`createEntity` and `setSnow`). No new tool and no new edit path.

### R2. The pure math (Task 4)

R2.1. `snow-math.ts` has no three.js import. It holds the CPU reference of the flake position, the build-up step, and the six constants.

R2.2. The flake position is a pure function of the seed, `frame.elapsedMs`, and the settings. For the same input it gives the same output. It stays inside the box and stays finite at an `elapsedMs` of 4 hours (Review Focus 5).

R2.3. The build-up step for one tick follows the design: Grow is `rate / buildUpSeconds × up × sky`. Slide, Shed, and Melt follow the rules of the design. The amount stays in 0 to 1. Under open sky the amount grows. Under shelter it stays 0. While `up` is 0 it slides off. Above the shed speed it sheds. While `rate` is 0 it melts.

R2.4. On a reset step, the speed term is 0, so a teleport does not shed snow.

### R3. The sky pass (Task 5)

R3.1. One orthographic camera sits at the top of the box and looks down. One colour target holds the height of the first surface under the sky. The pass gives the height texture and the world-to-sky matrix (`skyMatrix`) as uniforms.

R3.2. The pass draws avatars, props, and the environment with a depth-only material. It does not draw the flakes, the haze, or the beams.

R3.3. A mesh that is not visible (`hiddenMeshes`) is not in the pass, so it gives no shelter.

R3.4. A unit test pins the camera against `skyMatrix`, so the left side of the scene reads the left side of the target (Review Focus 1). Task 10 step 4 checks the side on the GPU.

R3.5. The full tier uses a 512 × 512 target that updates each frame.

### R4. The flakes (Task 6)

R4.1. One instanced sprite on its own layer draws all flakes. The position of each flake comes from the pure function of R2.2. No flake has state.

R4.2. A flake wraps inside the box. A flake below the sky depth surface is not drawn.

R4.3. Flakes are soft round billboards, premultiplied, with a depth test and no depth write. They draw in the scene pass and do not make the renderer use the post chain. They do not cast a shadow, and the shadow passes do not draw them.

R4.4. The flake motion continues while the editor is minimized, because it depends on `frame.elapsedMs` only.

R4.5. The full tier has 12,000 flakes at rate 1.

### R5. The build-up for each avatar (Task 7)

R5.1. Each avatar has one state buffer, with a record for each vertex of its skinned meshes (the previous world position and the amount, 16 bytes), the bind-space position, the bind-space normal, the skin indices, the skin weights, and one buffer for the bone matrices of its skeletons.

R5.2. One compute node for each avatar skins each vertex, reads the sky height, and updates the amount. It runs on the 1/60 s tick grid of `spring-grid.ts`. It follows the reset rules of `planSpringSteps`.

R5.3. An avatar with no skinned mesh, and a mesh with a `bindMode` that is not `attached`, get no build-up for that mesh. There is no error, and the flakes still draw (Review Focus 3).

R5.4. The vertices of a mesh in `hiddenMeshes` stay in the compute pass. The mesh gives no shelter (R3.3).

R5.5. When `visible` goes off, each amount is set to 0. With `settleOnCharacters` off, each amount is 0 and no compute runs.

R5.6. Two avatars from one asset get two separate state buffers (Review Focus 2).

R5.7. The buffers of an avatar are built on its first frame with snow (V2).

### R6. The surface on MToon and the compile rule (Task 8)

R6.1. `snow-surface.ts` has the TSL nodes that turn an amount into a vertex push and a snow colour. It has no dependency on the other snow modules.

R6.2. The edge mask compares the amount with a small tiling noise texture, in rest-pose space for a character. The vertex moves out along its normal by `thickness × amount`, scaled by the scale of the entity. The base colour mixes to snow white and the shade colour to a cool blue-grey, before the toon lighting. The mask lowers the rim and matcap terms.

R6.3. `CharacterMToonMaterial` reads the amount from the state buffer in the vertex stage, at the vertex index plus the offset of its mesh. The hook takes the 3.5.5 facts into account: the base `setupPosition` restores `positionNode`, the base `setupDiffuseColor` restores `colorNode`, and `customProgramCacheKey` adds only `isOutline`. The cache key of a material with snow nodes differs from the key of a material without them.

R6.4. The outline copy of the material gets no snow in this slice (V4). A material with blended transparency gets no snow.

R6.5. The snow nodes are in a material only while the scene has a Snow entity. To add or remove the entity is the one compile step, and it occurs at edit time. Each setting and `visible` is a uniform write.

### R7. The frame order and disposal (Task 9)

R7.1. `snow.ts` is the facade: `createSnow()`, `update(entity, frame)`, and `dispose()`. `renderer.ts` has the wiring only, as for Haze.

R7.2. The order in one applied frame is: (1) poses and spring bones, (2) the sky depth pass, (3) the build-up compute on the tick grid, (4) the main render with the flakes. Steps 2 and 3 run inside the applied frame, so `gpuMs` includes them.

R7.3. A scene without a Snow entity has no snow node, pass, or buffer. A Snow entity with `visible` off skips the sky pass, the compute, and the flake draw.

R7.4. When the Snow entity or an avatar leaves the scene, its buffers and targets are disposed, the materials lose the snow nodes, and no stale offset reads another buffer. An avatar that reloads while snow is on gets new buffers on its first frame (Review Focus 4).

R7.5. On WebGL 2, the facade draws the flakes and runs no compute (V3).

R7.6. `ARCHITECTURE.md` gets a short Snow paragraph in the Output path, in the same commit that adds the facade and the renderer wiring.

### R8. The gate (Task 10)

R8.1. The checks run on the running app, with MCP and the local OBS, on WebGPU, with the Catboy avatar, in the Editor window and in OBS. Each result records the backend, the quality profile, the fixture revision, and the commit.

R8.2. Evidence 1: snow collects on the head, the shoulders, and a held-out arm, and not under the fringe or under a raised arm. The sky side check shows that the left shoulder stays clean under a prop on the left (Review Focus 1). The shoulders show no stripes (Review Focus 6).

R8.3. Evidence 2: a head shake sheds the snow of the head. `rate` 0 melts it. `visible` off clears it. With two performers, only the shaken head loses its snow (Review Focus 2).

R8.4. Evidence 6: the budget gate. The setup is OBS output, WebGPU, `production_v1`, 1920 × 1080 at 60 FPS, two performers, snow at rate 1 with all settle flags on. Snow on minus snow off, with the same scene and camera, is at most 2 ms p95 `gpuMs` and at most 0.5 ms p95 `cpuMs`. There are three runs, each with a 30 s warm-up and 120 s measured, from `benchmark_start`. The host is an Apple M3 Pro, and the report labels debug and release builds. The M1 tier is unknown.

R8.5. If the gate fails, the order of the levers is: the flake count first, then the sky depth size, then the build-up step rate. If the gate still fails, or the compute path does not run in the Editor window or in OBS, the work stops. `docs/evaluation/snow.md` records the result, and the owner selects the approach again. Slice 2 does not start.

R8.6. `docs/evaluation/snow.md` records the evidence. The design gets the measured tier table, the constants, and the status. `docs/warudo-parity.md` gets a partial note on ENV-10 that claims only the verified behavior. ENV-09 stays open.

R8.7. The slice claims no result that it did not measure. An unavailable measurement is unknown, never zero. App timing and OBS timing stay separate.

## E — Entities

- Contracts: `SnowSettingsSchema`, `SnowSettings`, the `snow` member of `SceneEntitySchema`, the `setSnow` patch operation, `LIMITS.snows`, `DEFAULT_SNOW` (`packages/contracts/src/snow.ts`). Rust: `SnowSettings`, `SceneEntity::Snow`, `PatchOp::SetSnow`, `MAX_SNOWS`.
- Session: the `setSnow` case of `scene-ops.ts`.
- Editor: the new kind in `help.ts`, `asset-groups.ts`, and `inspector-sections.ts`.
- Renderer: `snow-math.ts` (flake position, build-up step, constants), `snow-sky.ts` (`skyMatrix`, the height target), `snow-flakes.ts`, `snow-build-up.ts` (the buffers and the compute node of one avatar), `snow-surface.ts`, `snow.ts` (`createSnow`), and the snow hook of `CharacterMToonMaterial`.
- No frame field, no Blueprint property key, no quality profile field, and no MCP tool in this slice.

## A — Approach

Documents first. Then the contracts in TypeScript and Rust with shared vectors, because the two sides must agree on the shape. Then the session operation, the editor compile sites, and the MCP test, so MCP can add the entity in the running app. Then the pure math, because the later parts follow it. Then the sky pass, the flakes, and the build-up, each behind its own module. Then the surface and the MToon hook. Then the facade and the renderer wiring. Last, the gate on the running app. If the gate fails, the spike stops and the owner selects the approach again.

## S — Structure

- `spdd/analysis/2026-11-26-snow-spike.md`, `spdd/prompt/2026-11-26-snow-spike.md` (this file).
- `packages/contracts/src/snow.ts` (new), `schema.ts`, `types.ts`, `index.ts`; `packages/contracts/test/snow.test.ts` (new); `fixtures/protocol/validation-vectors.json`; `crates/contracts/src/lib.rs`; `crates/contracts/tests/snow.rs` (new).
- `packages/session/src/scene-ops.ts`; `packages/session/test/snow-patch.test.ts` (new).
- `apps/desktop/src/editor/help.ts`, `asset-groups.ts`, `inspector-sections.ts`; `apps/mcp/test/snow.integration.test.ts` (new).
- `packages/renderer/src/snow-math.ts`, `snow-sky.ts`, `snow-flakes.ts`, `snow-build-up.ts`, `snow-surface.ts`, `snow.ts` (new); `character-mtoon.ts`, `renderer.ts`.
- `docs/evaluation/snow.md` (new), `docs/superpowers/specs/2026-11-26-snow-design.md`, `docs/warudo-parity.md`, `ARCHITECTURE.md`.

## O — Operations

1. Slice contract: this file and the analysis (Task 1).
2. Contracts, TypeScript and Rust, with the five vectors (R1.1 to R1.5; Task 2).
3. Session operation, editor compile sites, and the MCP test (R1.4, R1.6, R1.7; Task 3).
4. `snow-math.ts` (R2; Task 4).
5. `snow-sky.ts` (R3; Task 5).
6. `snow-flakes.ts` (R4; Task 6).
7. `snow-build-up.ts` (R5; Task 7).
8. `snow-surface.ts` and the MToon hook (R6; Task 8).
9. The facade, the renderer wiring, and the `ARCHITECTURE.md` paragraph (R7; Task 9).
10. The gate on the running app, the evidence, and the parity row (R8; Task 10).

## N — Norms

- Unit tests for the pure logic: the schema ranges and the limit, the session operation, `snow-math.ts`, the sky camera and `skyMatrix`, and the buffer layout. An integration test where a real process, protocol, or GPU boundary matters. No test for static copy. The browser and OBS checks of Task 10 are the acceptance evidence. A running editor preview alone is not enough.
- Functional TypeScript and plain data. Svelte is not in the renderer modules. No new dependency.
- All snow code is in `packages/renderer`. `renderer.ts` has the wiring only.
- The change goes through the existing command route. No edit path skips it.
- Each cargo, pnpm, or Tauri command that compiles Rust runs through `direnv exec . <command>`. Check one package at a time with `pnpm --filter <package name> check`.
- The gate of each task is "no new failure" against `.superpowers/sdd/2026-11-26-snow-spike/baseline-failures.txt` and the `apps/mcp` check error of `main`.
- Long prose is Simplified Technical English. UI copy stays short. A commit has no agent credit and no `Co-Authored-By` trailer.
- Each task is one small verified commit.

## S — Safeguards

- Flake motion comes from `frame.elapsedMs` only. No flake has state.
- The sky pass and the compute pass run inside the applied frame, so `gpuMs` includes them. A render outside the frame makes `gpuMs` null, and a null value is not a sample.
- No snow node, pass, or buffer exists in a scene without a Snow entity.
- Do not add a continuous image readback, JPEG encode, or image stream through Tauri IPC.
- Do not change the limits other than `LIMITS.snows`, the quality profiles, the benchmark fixture, the show file version, or the property registry in this slice.
- Do not change how a scene without a Snow entity draws.
- Do not fix the red baseline of `main` in this slice. Do not hide a new failure behind it.
- Do not start a live stream. Use local test recording and screenshots only. Do not change existing OBS settings.
- Do not save a show with the test entities. Remove them at the end of Task 10.
- Do not write a cost, OBS, or look result that was not measured. Write an unavailable measurement as unknown.
- Do not start slice 2 when the gate fails.
