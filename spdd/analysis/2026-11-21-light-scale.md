# Light scale analysis (B43)

Date: 2026-11-21. Scope: bundle B43: #305 (GPU time) first, then #316 (more lit lights and shadow lights). Contract: [light scale](../prompt/2026-11-21-light-scale.md). Depends on: [light limits](../prompt/2026-11-17-light-limits.md) (#304, PR #314, merge `66cbbe35`), [stage beams](../prompt/2026-11-13-stage-beams.md), [light entities](../prompt/2026-10-17-light-entities.md). Code base: `main` at `7aec77e5`.

## Sources

- Issue #316. Its acceptance asks for the B34b cost method (LC7, LC8) on macOS with OBS, with GPU time from #305, no `Pipeline compile failed` after 30 light-set changes at the new limits, and a Windows check before a limit increase ships.
- Issue #305. Its acceptance asks for a probe of `timestamp-query` (WebGPU) and of the timer query (WebGL 2) in the Editor window and in the OBS browser source. It also asks for `gpuMs` where the timer exists, `null` where it does not, GPU percentiles in the benchmark summary, unit tests, no image readback, and a new measurement of the stage lights and stage beams cost cases.
- Orchestrator decision of 2026-11-21: #305 is the first pull request of B43.
- [Light limits check](../../docs/evaluation/light-limits.md), local checks of 2026-11-18 (macOS 27.2.1, Apple silicon, OBS 33.0.1, WebGPU, `production_v1`). These are the recorded results:
  - Each Add of a lit light stops the Editor for about 8 to 10 s while the lit materials compile again. An Add of an unlit light does not.
  - LC7 case D (32 scattering lights in a haze) is GPU-bound: output at about 42 FPS, with the output CPU time near 5 ms. Up to 16 scattering lights kept 60 FPS. The owner accepted this cost.
  - LC8 passed: 30 changes gave no `Pipeline compile failed`.
  - GPU time: unknown.
- [Light entities check](../../docs/evaluation/light-entities.md), lines 65–93. The Metal failure `bracket nesting level exceeded maximum of 256` came from WebKit, which adds a bounds clamp each time a pipeline uses the same shader module again. `webkit-shader-modules.ts` (R9b) fixes it. Thus the shader size is not the known cause of that failure.
- Orchestrator note of 2026-11-20 (liltoon-webgpu stall measurement): in WKWebView each new render pipeline costs about 0.35 to 0.4 s of Metal compile time in the WebKit GPU process. Identical WGSL is a cache hit (about 5 ms). Thus the stall is proportional to the number of pipelines that change with the light set. The JS-blocked time does not show the stall; GPU completion (`queue.onSubmittedWorkDone()`) shows it.
- three.js 0.187.0 source (`node_modules/.pnpm/three@0.187.0`) and `@pixiv/three-vrm` 3.5.5 with the local patch. See "three.js facts".
- [Benchmark contract](../../docs/evaluation/benchmark-contract.md): "p95 measured GPU duration below 16.67 ms when available; report unsupported measurement".

## Current state

### GPU time (#305)

- `FrameAppliedSchema.gpuMs` is `n.nonnegative().nullable()` (`packages/contracts/src/schema.ts` lines 504–516). Rust `FrameApplied.gpu_ms: Option<f64>` (`crates/contracts/src/lib.rs` lines 1565–1578), and `validate` accepts a finite value ≥ 0 or `None` (line 3165).
- The renderer always sends `gpuMs: null` (`packages/renderer/src/renderer.ts` line 528).
- `initializeBackend` makes `new WebGPURenderer({ canvas, alpha, antialias, samples, forceWebGL })` with no `trackTimestamp` (`packages/renderer/src/backend.ts` line 4).
- The benchmark run counts `gpu_unknown` (`crates/evaluation/src/runs.rs` line 132). The summary always writes `"gpuMs": null` (line 227).
- `RendererDiagnostics.videoDecoder` (B31 R14) is an optional capability that a renderer reports. The host keeps it per output (`apps/desktop/src-tauri/src/service/mod.rs` lines 1606–1610) and `app_status` shows it (`router.rs` line 316). This is the model for a GPU timer capability.
- The OBS page selects WebGL 2 with `?backend=webgl2` (`apps/output/src/main.ts` line 17).

### Lights (#316)

- Limits: `LIMITS.lights` 32, `litLights` 8, `shadowLights` 2 (`schema.ts` lines 36–38); messages from `LIMITS` (lines 49–51). Rust `MAX_LIGHTS` 32, `MAX_LIT_LIGHTS` 8, `MAX_SHADOW_LIGHTS` 2 (`lib.rs` lines 18–20, check at 294–298).
- `scene-lights.ts`: one three.js light for each entity. Each group (characters, props, environment, haze) has a `lights([...])` node (lines 206–211). A group gets a new node object when its key changes: the fixed-ambient flag, the built-in flag, and `[id, type, shadow.enabled]` of each member (light limits R13). `assign` gives each lit material the new node and disposes the material, so it compiles again (lines 218–240).
- Thus each lit light that joins a group changes the key, and each lit material of that group compiles a new program. This is the 8 to 10 s stall of the light limits check.
- The haze material takes the `haze` node (`haze.ts` lines 93–97).
- `CharacterLightingModel.direct` (`character-mtoon.ts` lines 46–60) reads `lightDirection`, `lightColor`, `reflectedLight`, and `lightNode` (only to find a received shadow). It adds the back-light rim for each light.
- The lilToon fork (`@mochiya/three-liltoon/dist/webgpu.js` lines 1760–1789) picks a main light: the first directional analytic light node, else the first light node that `direct` receives. Other lights are "added lights" (albedo × light).
- Each shadow light draws its map in each frame (`shadow.autoUpdate` is true by default). No code sets `autoUpdate` or `needsUpdate`.

## three.js facts (0.187)

1. **`DynamicLightsNode`** (`examples/jsm/tsl/lighting/DynamicLightsNode.js`) is a subclass of `LightsNode`. It can be the `lightsNode` of one material. It is not tied to `renderer.lighting`. Thus #316's premise "both replace `renderer.lighting` for the whole renderer" is true for `DynamicLighting` and `ClusteredLighting`, but not for the node. One node for each group keeps the three groups.
2. `DynamicLightsNode` batches a light only when the light is not a node, has `castShadow` false, is not a spot light with `map` or `colorNode`, and its constructor is exactly `AmbientLight`, `DirectionalLight`, `PointLight`, `SpotLight`, or `HemisphereLight` (`canBatchLight`). A subclass of `DirectionalLight` is therefore not batched. All other lights keep the per-light path.
3. Its `customCacheKey` holds the per-light (builtin) lights and the names of the batched types. The batched lights and their count are not in it. The data nodes keep fixed-size uniform arrays (`renderGroup`) and a count uniform, and each shader loops to the count. A data node, once made for a type, is never removed (`_dataNodes`).
4. Each data node calls `lightingModel.direct({ lightDirection, lightColor, lightNode: { light: {}, shadowNode: null }, reflectedLight })` once inside a `Loop`. Thus one shared `lightNode` object stands for all lights of that type.
   - MToon (three-vrm and `CharacterLightingModel`): `direct` uses only the direction, the color, and the reflected light. No received shadow applies (not in `shadowed`). Statically compatible. Not verified on a GPU.
   - lilToon: when no per-light directional light exists, the first `direct` call sets the main light. If that call is a data node, all lights of that type become the main light. This changes the look.
5. `VolumetricLightingModel.direct` returns at once when `lightNode.isAnalyticLightNode !== true` (`nodes/functions/VolumetricLightingModel.js` line 177). Thus the haze must keep the per-light `lights()` node.
6. `ClusteredLighting` / `ClusteredLightsNode` runs a compute pass in each render, uses a screen-size cluster grid, and holds the id and version of the node in its cache key. It skips shadow lights. It is a candidate for many more lights (> 32), not for B43.
7. The scene-level `renderer.lighting` (default `Lighting`) gives each render object a lights node with all scene lights. `NodeManager.getCacheKey` puts its cache key into the dynamic cache key of each render object (`RenderObject.getDynamicCacheKey`). Materials without their own `lightsNode` (basic materials: screens, helpers, the marker) take this node.
8. **Timestamps.** `WebGPUBackend` keeps `trackTimestamp` only when the device has `timestamp-query` (`WebGPUBackend.js` line 298). three requests every adapter feature at device creation. Each render pass and compute pass then gets two timestamp writes. `renderer.resolveTimestampsAsync(type)` resolves all recorded queries into a buffer, maps it (`mapAsync`), and fills `pool.timestamps` (query id → ms). It keeps only the duration of each pass (end − begin) and drops the begin and end times.
9. three groups the query durations by `info.frame`. Only three's internal `requestAnimationFrame` loop (`Animation.js` lines 83–87) sets `info.frame`. OpenSekai renders through its own queue and the OBS page paces frames with a timer. Thus three's "last frame" value is not the GPU time of an OpenSekai frame.
10. `resolveQueriesAsync` returns `lastValue` (0 at start) when the result buffer is mapped or when nothing is recorded. The WebGL 2 pool returns `lastValue` when the timer reports a disjoint result. Thus a returned value can be a stale value or 0 for an unknown measurement.
11. Shadows: `ShadowNode.updateBefore` draws a map when `shadow.needsUpdate || shadow.autoUpdate`, at most one time for each camera in each node frame (`ShadowNode.js` lines 798–826). A second camera in one frame (the haze pass, a screenshot) can draw the map again. A point light shadow draws 6 cube faces (`PointShadowNode.js` line 311).
12. **Query slots.** `allocateQueriesForContext` gives each pass two slots (begin, end) from `currentQueryIndex` and adds 2. When the next pair does not fit in `maxQueries` (2048), it starts its own resolve and sets `currentQueryIndex` to 0, so the queries before the reset are lost to a caller that did not resolve them. All passes share one `GPURenderPassTimestampWrites` object (`WebGPUBackend.js` line 42). `copyFramebufferToTexture` ends a pass and begins it again with the same descriptor (line 3226), so the second part writes the slots that the shared object holds at that time, which can be the slots of a pass that started later (for example a shadow pass). A query that no pass wrote resolves to 0.

## Client support (unknown until the PR1 probe)

| Client | WebGPU `timestamp-query` | WebGL 2 `EXT_disjoint_timer_query_webgl2` | Timestamp resolution |
| --- | --- | --- | --- |
| Editor window, macOS (WKWebView, system WebKit) | Unknown | Unknown | Unknown |
| OBS browser source, macOS (CEF in OBS 33.0.1) | Unknown | Unknown | Unknown. Chromium can quantize timestamps (#305) |
| Editor window, Windows (WebView2) | Unknown | Unknown | Unknown |
| OBS browser source, Windows | Unknown | Unknown | Unknown |

Apple GPUs sample Metal counters at pass boundaries. That is enough for timestamp writes at the start and end of a pass. Whether WebKit and the CEF build expose the feature is unknown.

## Decisions

1. **Order** (orchestrator). PR1 is #305. #316 follows in PR2 to PR4.
2. **Contract first** (integrator). The first commit of PR1 holds this analysis and the contract for all of B43. A later pull request that selects a candidate changes the contract in its first commit. Alternative: a contract pull request before PR1.
3. **Split** (integrator). PR1: GPU time (closes #305). PR2: batched lit lights, with a spike build for 16 and 32 lit lights (refs #316). PR3: shadow map cache, with a spike build for 4 shadow lights (refs #316). PR4: new limits after the owner gate G2 (closes #316). PR2 and PR3 can run in parallel worktrees after PR1 merges; their shared file is `scene-lights.ts` (see the plan).
4. **Limits** (issue). The limits change only in PR4, after the measurements and an owner decision.
5. **Evidence owners**. The orchestrator runs all macOS, OBS, and Windows checks. The executors claim no GPU, OBS, look, or cost result.
6. **Dependencies**. No new dependency. `DynamicLightsNode` is in three 0.187 and has types in `@types/three` 0.187.

## Technical choices

Each choice is reversible. The recommendation is in bold. A gate names the check that selects or reverses it.

### Part A, GPU time

- **TA1. Which frame.** (a) **No schema change. After each applied frame the renderer starts one resolve when none is in progress. The resolved batch gives one sample: the mean of the frame spans of its frames (decision D8; the first design used the total pass time divided by the frame count). The next acknowledgment carries it; other acknowledgments carry `null`.** (b) Add `gpuSequence` to `FrameApplied` (TypeScript, Rust, vectors). (c) Wait for the resolve before each acknowledgment. Reason: percentiles over a 120 s window do not need the exact frame, and (c) changes the timing that it measures. Gate: none.
- **TA2. Capability.** (a) **An optional `gpuTimer` (`supported` or `unsupported`) in the renderer diagnostics and in each `app_status` output, as `videoDecoder`.** (b) Infer it from `gpuMs`. Reason: #305 asks to record availability, also for WebGL 2, where `gpuMs` stays `null`.
- **TA3. WebGL 2.** (a) **No timer query on WebGL 2. `gpuMs` stays `null`. `gpuTimer` reports whether the extension exists.** (b) Use the three WebGL pool. Reason: that pool returns a stale value, or 0, for a disjoint result (fact 10).
- **TA4. Always on.** (a) **On whenever the device has the feature.** (b) On only with a query parameter or in evaluation mode. Gate G-A2: in LC A5, case B of the light limits check with PR1, compared with a local build with `trackTimestamp: false`. If the output CPU median grows by more than 0.3 ms, or the output frame rate falls by more than 0.5 FPS, select (b).
- **TA5. Reading three.** (a) **One adapter module (`gpu-timer.ts`) records the query index of each pool after each applied frame, resolves the query set of each pool itself into its own buffers, and resets the pool as three does. A unit test with the real pool class pins the fields it reads and writes.** (b) Read `pool.timestamps` after `resolveTimestampsAsync` (the first PR1 design). It gives only a duration for each pass (fact 8), so no frame span. (c) A subclass of the three pool that the timer puts into `timestampQueryPool` before the first pass and that overrides `_resolveQueries`. It depends on a private method and on a lazy creation order. (d) Wrap `allocateQueriesForContext` on the pool object. This patches three. Rejected. (e) Use the value that `resolveTimestampsAsync` returns. Rejected (facts 9 and 10). Reason for (a): it uses only fields and one public WebGPU call (`resolveQuerySet`), and a three update that changes a field fails the test. three is pinned at 0.187.0.

### Part B, lights

- **TB1. Batching.** (a) **One `DynamicLightsNode` for each material group (characters, props, environment).** (b) `renderer.lighting = new DynamicLighting()`: this drops the groups and the affect flags. Rejected. (c) `ClusteredLighting`: a later candidate for more than 32 lights (follow-up draft B).
- **TB2. Scene-level lighting.** (a) **Keep the default `renderer.lighting`.** (b) `DynamicLighting` with 32 for each type, so basic materials and the dynamic cache key do not change with a non-shadow light. Gate G-B2: in LC B2, if an Add of a lit light still stalls more than 1 s, or a basic material compiles again, select (b).
- **TB3. Directional lights.** (a) Batch them. A lilToon avatar with two or more directional lights without a shadow then has all of them as its main light (fact 4). (b) **Keep directional lights on the per-light path with a small subclass of `DirectionalLight` (fact 2). Batch point, spot, and ambient lights.** Reason: the lilToon and MToon look stays the same, and a concert rig adds mostly spot and point lights. Cost: the Add of a lit directional light still compiles. Gate G-B3: owner question Q2.
- **TB4. Data node types.** (a) **Make the point, spot, and ambient data nodes when the group node is made, so the program does not change when the first light of a type joins.** (b) Let the types grow (one compile at the first light of each type).
- **TB5. Shadow cache scope.** (a) **All shadow lights use the dirty rule.** (b) Only lights with Affect Characters off. Reason: the rule redraws a map that contains a character in any case, so (a) is equal for character lights and saves time for others.
- **TB6. Character bounds.** (a) **A sphere at the root position of the character, with the radius of its rest-pose box (half the diagonal) plus 1 m, and the map redraws in each frame while the sphere is in the shadow volume.** (b) Each character is in every shadow volume. Gate G-B4: LC S1 (no missing or stale shadow with tracking and spring motion).
- **TB7. Spike builds.** (a) **A local branch with one commit that raises only the limit constants. It is never pushed or merged. The orchestrator measures on it.** (b) An evaluation-mode override of the limits in product code. Reason: (b) adds a path to TypeScript and Rust validation that only the checks use.

## Effects

- PR1: frame acknowledgments carry GPU time where the WebGPU timer exists. Each OpenSekai check can then report GPU time. `app_status` shows whether each output has a GPU timer.
- PR2: an Add, a remove, or a type change of a lit point, spot, or ambient light without a shadow compiles no lit material. The stall of 8 to 10 s per Add should go away for those lights (to be measured). The shader of a lit material no longer grows with the batched light count. The per-pixel cost still grows with the count.
- PR3: a shadow map that no moving caster reaches is drawn only when something in it changes. This also stops a second draw of the map for the haze pass camera.
- PR4: more lit lights and shadow lights, with the same messages built from `LIMITS`.

## Risks

- **No GPU timer in OBS on macOS.** Then #316 cannot meet "with GPU time from #305" on its main client. Owner question Q1.
- **Quantized timestamps.** The OBS browser source rounds each timestamp to 0.065536 ms (the PR1 probe). A frame span has one rounding at each end, not one for each pass. A span of 0 gives no sample (contract R5).
- **Implausibly low samples.** In the PR1 probe, 4 % to 7 % of the OBS samples in the light cases were 0.13 ms to 0.2 ms, where the others were 4 ms to 20 ms. The cause is not known. Candidates in code: a query that no pass wrote reads 0, so its pair gives a duration of 0 (fact 12); a split pass writes the slots of another pass (fact 12); three resets a pool before the timer resolves it (fact 12). A frame span is `null` when a timestamp is 0 or an end is before its begin, and a batch is `null` after a reset by three. A split pass stays inside the frame, so it does not change the span. LC A3 checks again.
- **Batch attribution.** A batch that holds more than one frame gives a mean. A batch with a render outside an applied frame (screenshot, capture, room irradiance) gives no sample. A non-frame render that the executor does not find inflates a sample. LC A3 checks plausibility in a light case and in a GPU-bound case.
- **Batched look.** The data nodes use the same attenuation functions as the per-light nodes, but no image comparison exists. LC B1 compares images.
- **MToon in a loop.** `CharacterLightingModel.direct` builds inside a TSL `Loop` for the first time. A build error shows as `Pipeline compile failed` or a material error in LC B1.
- **Per-pixel cost.** 32 batched lights loop 32 times for each lit pixel of each group. The cost is unknown until LC B4.
- **Shadow cache staleness.** A missed change leaves a stale shadow. The rule redraws on each character frame in range, on any light or caster change, around each screenshot, and after each light-set rebuild. LC S1 checks it.
- **three internals.** `gpu-timer.ts` reads pool fields of three 0.187. A three update can change them. The pinning test fails then.
- **Windows.** The QA VM GPU is not representative. Owner question Q4.
- **Shared files.** `scene-lights.ts` (PR2, PR3), `renderer.ts` (PR1, PR3), `schema.ts` and `lib.rs` (PR1, PR4), `ARCHITECTURE.md`, `docs/warudo-parity.md`, and `apps/mcp/src/server.ts` (one long line).

## Out of scope

`ClusteredLighting`, more than 32 lights in total, a haze limit or a cheaper haze, WebGL 2 GPU time, GPU time of the Editor preview as a gate, NDI, DMX input, instanced beams, spot cookies, and changes to the quality profiles.
