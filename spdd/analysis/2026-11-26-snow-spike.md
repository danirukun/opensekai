# Analysis: Snow feasibility spike

Date: 2026-11-26. Scope: slice 1 of the snow design (ENV-10, issue #48, first subset). Contract: [snow feasibility slice](../prompt/2026-11-26-snow-spike.md). Design: [snow design](../../docs/superpowers/specs/2026-11-26-snow-design.md). Plan: [implementation plan](../../docs/superpowers/plans/2026-11-26-snow-spike.md).

## Request

The owner wants a snow effect that the operator can turn on and off. Snow falls in a region of the scene. It collects on the characters in a realistic way: it builds up on surfaces that face up and see the sky, it stays off sheltered surfaces, it falls off when a body part tilts or moves fast, and it melts when the snowfall stops. The effect must fit in a fixed share of the frame budget on a Mac.

The design is approved. This slice does not build the full feature. It is a feasibility spike with a gate. It must show, on the running app, that one compute pass for each avatar can keep a snow amount for each vertex of an MToon character, and that the whole effect costs at most 2 ms of p95 GPU time. If the compute path or the budget fails, the work stops and the owner selects the approach again.

## Sources

| Source | What it gives | Status |
| --- | --- | --- |
| [Snow design](../../docs/superpowers/specs/2026-11-26-snow-design.md) | Goals, the owner decisions, the changes after approval, the settings, the renderer modules, the build-up rule, the tiers, the budget gate, and the acceptance evidence | Approved by the owner on 2026-11-26 |
| [Implementation plan](../../docs/superpowers/plans/2026-11-26-snow-spike.md) | Scope of this slice, Review Focus, and Tasks 1 to 10 | Written on 2026-11-26 |
| `@pixiv/three-vrm-materials-mtoon` 3.5.5 source (`lib/nodes/index.module.js`) | The node setup methods of `MToonNodeMaterial` | Read on 2026-11-26 |
| Owner QA notes on the Catboy avatar | The mesh names of the QA avatar | Not checked in code. See Current state. |
| SnowSystemThreeJS, snowflow_demo, and the three.js example `webgpu_compute_particles_snow` | The flake method, the persistent state idea, and the colour target for the sky pass | Cited by the design. This analysis did not read them again. |

## Current state

Each fact below was read in the code on 2026-11-26, unless the text says that it comes from another source.

### Haze is the model for a singleton entity

- `LIMITS.hazes` is 1 (`packages/contracts/src/schema.ts:42`). The scene refinement rejects a second haze (`schema.ts:326`). The Rust mirror has `MAX_HAZES` with the value 1 and the same check (`crates/contracts/src/lib.rs:25`, `:3225`).
- The entity has `kind: "haze"` and a `haze` group that `HazeSettingsSchema` validates (`schema.ts:206`, `:281`). The patch operation `setHaze` carries the whole group (`schema.ts:374`). Rust has `SetHaze` and a `haze.validate()` call (`lib.rs:1158`, `:3412`).
- `scene-ops.ts` handles `setHaze` in one line. It fails with `INVALID_INPUT` when the entity is not a haze. Otherwise it replaces the group with a `structuredClone` (`packages/session/src/scene-ops.ts:83`).
- `createHaze()` in `packages/renderer/src/haze.ts` returns an object with `update`, `setLights`, `setDepth`, and `dispose`. `update` places the volume from the entity transform, sets the uniforms, and sets `mesh.visible` from `entity.visible`. It does not recompile.
- `renderer.ts` creates the haze when the scene has a haze entity and disposes it when the entity is gone (`renderer.ts:537-542`). A `hazeFailed` flag stops the haze after a pipeline failure until the next rebuild (`renderer.ts:110`, `:608`).
- The editor has compile sites for each entity kind. `help.ts` has a `Record<SceneEntity['kind'], HelpTopic>`, so a new kind must have an entry. `asset-groups.ts` and `inspector-sections.ts` also name `haze`.

### The spring clock gives the tick grid

- `packages/renderer/src/spring-grid.ts` sets `SPRING_STEP_SECONDS` to 1/60 and `SPRING_MAX_STEPS` to 15. Step k is at k × 1000/60 ms of session time. `planSpringSteps` returns a reset when the previous clock is missing, when the `sessionId` changes, when the tick goes back, when more than 15 steps are due, or when the reset count changes.
- `renderer.ts` calls `advanceSprings(springClock(frame, id))` for each avatar after `apply` and the placement (`renderer.ts:494`, `:515`). The build-up compute must use the same grid and the same reset rules.

### The character material

- `CharacterMToonMaterial` extends `MToonNodeMaterial` (`packages/renderer/src/character-mtoon.ts`). It overrides `setupVariants`, `setupLighting`, `setupLightingModel`, `setupEnvironment`, and `copy`. It does not override `setupPosition`, `setupDiffuseColor`, or `customProgramCacheKey`. The class inherits these three from `MToonNodeMaterial` 3.5.5.
- In 3.5.5, `customProgramCacheKey` adds only `isOutline` to the key of the base class (`index.module.js:222`). A material with snow nodes and a material without them would share one program key unless the snow hook adds a term.
- In 3.5.5, `setupDiffuseColor` sets `colorNode` for the call when it is null, calls the base method, and then sets it to null again (`index.module.js:299-322`).
- In 3.5.5, `setupPosition` sets `positionNode` only for an outline, calls the base method, and then puts the old `positionNode` back (`index.module.js:382-410`). A vertex push must set `positionNode` before the base call.
- `setupVariants` of `CharacterMToonMaterial` builds seven `toVar` nodes from the private setup methods of the base class.

### Frame, timing, and measurement

- `renderer.ts` sets `gpuMs` to `gpuTimer.take()` for an applied frame. For a render outside an applied frame (a capture), `gpuMs` is null, and the batch is tainted (`renderer.ts:92`, `:333`, `:636`). The timer reads both the render pool and the compute pool (`packages/renderer/src/gpu-timer.ts:47`). The sky pass and the compute pass must run inside the applied frame, or the budget gate has no measurement.
- `crates/evaluation/src/runs.rs` counts acknowledgments from 30,000 ms to 150,000 ms of the run (30 s of warm-up, then 120 s measured). It gives p50, p95, p99, and max for `cpuMs` and for `gpuMs`. An acknowledgment with a null `gpuMs` is not a sample. It adds to `gpuUnknownCount` (`runs.rs:132-142`, `:222-236`).
- The MCP tool `benchmark_start` (`apps/mcp/src/tools.ts`) starts such a run. So the budget gate reads p95 `gpuMs` and p95 `cpuMs` from the summary of `benchmark_status` and `evidence_read`.

### Hidden meshes

- `applyHiddenMeshes` in `packages/renderer/src/assets.ts` sets `object.visible` for each mesh of an avatar. A hidden mesh is not drawn by any pass that respects `visible`.

### The test avatar

- The Catboy avatar has 57 meshes: Face, Body, and Hair001 to Hair055. This fact comes from the owner QA notes. This analysis did not check it in the model file. The count is the reason for the change after approval: one compute pass for each avatar, not for each mesh.

## Known state of main

The baseline of `main` is red. The failures were present before any snow change. This slice does not fix them.

| Group | Failure |
| --- | --- |
| `pnpm check` | `apps/mcp` fails at `src/assist-tools.ts(13,7)`. `sky_set` is a tool in `packages/assist`, and the `INTENT_DESCRIPTIONS` record of `assist-tools.ts` has no entry for it. The recursive run stops at this package. |
| `pnpm test:unit` | 11 tests fail: 2 in `apps/desktop` (`dark-tokens`, `property-defaults`) and 9 in `packages/renderer` (4 in `asset-lifecycle`, 4 in `prop`, 1 in `renderer-dispose`). The names are in `.superpowers/sdd/2026-11-26-snow-spike/baseline-failures.txt`. |

The gate of each task is "no new failure". A task checks one package at a time with `pnpm --filter <package name> check`, and compares the failing test names with the baseline file.

## Decisions

The owner decisions and the changes after approval are in the design. The [contract](../prompt/2026-11-26-snow-spike.md) copies them. This analysis adds none.

### Slice boundaries (from the plan)

| Item | Boundary of this slice | Alternative |
| --- | --- | --- |
| Build-up in this slice | The step uses `rate` from the entity directly. The session `cover` value and the warm start are slice 2 | Add `snow-cover.ts` in this slice |
| Avatar buffers | The buffers of an avatar are built on its first frame with snow. The load job builds them in slice 6 | Build them in the load job now |
| WebGL 2 | A WebGL 2 client draws flakes and no build-up. The static cap and the warning are slice 6 | Add the static cap now |
| Outline copies | The outline copy of `CharacterMToonMaterial` gets no snow in this slice (slice 3) | Add the vertex push to the outline now |

## Cost

- The budget is at most 2 ms of p95 `gpuMs` and at most 0.5 ms of p95 `cpuMs` for snow on minus snow off. The scene is the OBS output on WebGPU at `production_v1`, 1920 × 1080 at 60 FPS, with two performers and snow at rate 1.
- The full tier starts at 12,000 flakes and a 512 × 512 sky target. These are start values.
- One compute pass for each avatar replaces one pass for each mesh. For Catboy this is one pipeline and one dispatch, not 57. A new pipeline costs about 0.4 s in WebKit, from the design.
- Each avatar adds 80 bytes for each vertex of its skinned meshes (16 for the state, 64 for the bind data), and one buffer of bone matrices.
- No cost is measured yet. An unavailable measurement is unknown, never zero.

## Risks

- **Compute path.** The compute pass may not run in the Editor window or in the OBS browser source. This is the first thing that the spike must show. If it fails, the work stops.
- **Mirrored sky lookup.** The render-target UV origin differs between conventions. A prop above the left shoulder could clean the right shoulder.
- **Shared material.** Two avatars from one asset can share one material object. The second share then replaces the first.
- **Steep surfaces.** A sky texel is about 1.2 cm at a 6 m box. A slope that faces up can read as sheltered, in bands.
- **Program cache key.** A material with snow nodes and a material without them must not share a compiled program (see the character material above).
- **Long session.** A flake position that loses precision at 4 hours would leave the box.
- **Baseline.** The red baseline can hide a new failure in the same file. Each task must compare names, not counts.

## Out of scope

- The session `cover` value, the frame field, and the warm start (slice 2).
- lilToon characters and outline copies (slice 3).
- The static cap on props and environments, and the effect of the settle flags on them (slice 4).
- Add › Snow, the Inspector section, the viewport helper, the `snowRate` Blueprint key, and the handbook page (slice 5).
- The tier adapter, the WebGL 2 static cap and its warning, `pipeline-blame.ts`, the headless WebGPU integration test, and the load-job buffers (slice 6).
- A Wind asset, footprints, clumps, sound, a hidden trigger, and chat intents for snow.
- A fix for the red baseline of `main`.
