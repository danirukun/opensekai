# REASONS: Light scale

Date: 2026-11-21. Scope: bundle B43: #305 (Part A), #316 (Part B). Analysis: [light scale](../analysis/2026-11-21-light-scale.md). Depends on: [light limits](2026-11-17-light-limits.md), [stage beams](2026-11-13-stage-beams.md), [light entities](2026-10-17-light-entities.md). Changes: light limits R13 (the group node rule) for the three material groups; light limits M1 and M3 numbers in PR4.

## Decisions

| # | Decided | Rejected alternative |
| --- | --- | --- |
| D1 | #305 is PR1 of B43. #316 follows in PR2 to PR4 | #316 without GPU time |
| D2 | The first commit of PR1 holds the analysis and this contract. A pull request that selects a candidate changes this contract in its first commit | A separate contract pull request |
| D3 | PR1 GPU time; PR2 batched lit lights; PR3 shadow map cache; PR4 new limits | One pull request |
| D4 | The limits change only in PR4, after gate G2 (owner) | A limit change with the batching |
| D5 | The orchestrator runs all macOS, OBS, and Windows checks. GPU time is unknown where no timer exists, never 0 | The executors claim them |
| D6 | No new dependency | — |
| D7 | Owner, 2026-11-21: Q1 (a), Q2 (b), Q3 (b), Q4 (a), Q5 as recommended. The main shadow case is the avatar shadow on a flat floor | — |
| D8 | Owner, 2026-11-21, after the PR1 probe: a sample is the mean of the frame spans of a batch. A frame span is the time from the earliest pass begin to the latest pass end of one applied frame. The sum of the pass durations overstated the cost (Stage Rig case D: p50 24.4 ms while OBS ran at 59.7 FPS), because an Apple GPU runs passes at the same time | The sum of the pass durations |
| D9 | G-A1 (LC A1, 2026-11-22): pass. The Editor window and the OBS browser source on macOS have `timestamp-query`, so #316 continues with GPU time | #316 with GPU time unknown in OBS |
| D10 | G-A2 (LC A5, 2026-11-22): TA4 (a). The timer is on when the device has the feature. Light limits case B: output CPU median 5.7 ms with the timer and 5.8 ms without it; 59.95 FPS and 59.96 FPS | TA4 (b), the timer only on request |
| D11 | Owner, 2026-11-22: LC A3 is accepted for now with the low OBS samples (1 to 4 timestamp steps; less than 0.1 ms change of p95). Follow-up #349 | PR1 waits for the cause |

## Gates

| Gate | After | Selects |
| --- | --- | --- |
| G-A1 | PR1 LC A1 | Q1: whether #316 continues with GPU time unknown in OBS |
| G-A2 | PR1 LC A5 | TA4: timer always on, or on request |
| G-B2 | PR2 LC B2 | TB2: the scene-level lighting |
| G-B3 | Owner (Q2), PR2 LC B1 | TB3: directional lights per light or batched |
| G-B4 | PR3 LC S1 | PR3 merges, or the shadow cache stops |
| G2 | Owner (Q3, Q5), after PR2 and PR3 measurements | `N_lit`, `N_shadow`, and the point shadow rule of PR4 |

## Messages

Each message comes from `LIMITS` on each side. PR4 changes only the numbers.

| ID | Limit | Message |
| --- | --- | --- |
| M1 | `LIMITS.litLights` / `MAX_LIT_LIGHTS` (8 now, `N_lit` after G2) | `Scene has the maximum of {N_lit} lit lights` |
| M2 | `LIMITS.lights` / `MAX_LIGHTS` (32, no change) | `Scene has the maximum of 32 lights` |
| M3 | `LIMITS.shadowLights` / `MAX_SHADOW_LIGHTS` (2 now, `N_shadow` after G2) | `Scene has the maximum of {N_shadow} shadow lights` |
| M4 | Only if Q5 selects (c): at most 1 point light with a shadow | `Scene has the maximum of 1 point light shadow` |

Check order: M2, M1, M3, then M4.

## R — Requirements

### Part A: GPU time (PR1, #305)

R1. On WebGPU the renderer is made with `trackTimestamp: true`, so three writes timestamps only when the device has `timestamp-query`. On WebGL 2 (forced or fallback) the renderer makes no timer query: `trackTimestamp` is false before the first render.
R2. Each renderer reports `gpuTimer`: `supported` when (WebGPU) timestamps are on after `init`, or (WebGL 2) the context has `EXT_disjoint_timer_query_webgl2`; else `unsupported`. It is an optional field of `RendererDiagnostics` and of each `app_status` output, in TypeScript and Rust, and the host keeps it per output as it keeps `videoDecoder` (B31 R14).
R3. After the last render call of each applied frame, the renderer starts one resolve of the render and compute queries recorded since the previous resolve (one batch), when no resolve is in progress. It does not wait for it. After each applied frame it records the query index of each pool (a frame boundary), so it knows the queries of each frame of the batch.
R4. A batch that holds a render outside an applied frame (a screenshot, a capture, the room irradiance render, or another render that is not part of `applyFrame`) gives no sample.
R5. Two pure functions. `frameSpan(pairs): number | null` gets the begin and end timestamps (ns) of the passes of one applied frame and gives the time in ms from the earliest begin to the latest end. It gives `null` when there is no pair, when a timestamp is 0 (WebGPU resolves a query that no pass wrote to 0), or when an end is before its begin. `gpuSample(spans): number | null` gives the mean of the frame spans of a batch when: there are 1 to 4 spans; each span is not `null`, is finite, is above 0, and is at most 1000 ms. Else it gives `null`.
R6. The first acknowledgment after a batch resolves carries its sample in `gpuMs`. Each sample is on exactly one acknowledgment. All other acknowledgments carry `null`. A failed resolve gives no sample. A disposed renderer drops a pending sample. A value is never 0 for an unknown measurement.
R7. A frame span covers every render pass and compute pass that three records for the frame: the scene pass, the shadow passes, the haze pass, the beam pass, the post chain, the diagnostic marker, and, in the preview, the editor viewport. Passes that run at the same time count one time. A gap between two passes of the frame is in the span. Work before the first pass, after the last pass, copies outside a pass, and the canvas present are not in it. Documents call it "the GPU time span of a frame", not the frame time and not a sum of pass durations.
R8. One module, `packages/renderer/src/gpu-timer.ts`, reads the three 0.187 timestamp pools. three keeps only a duration for each pass, so the module resolves the query set of each pool itself, into its own resolve buffer and result buffer, and then resets the pool as three does (`currentQueryIndex` 0, `queryOffsets` cleared). It does not patch a three prototype or a three method, and it does not call `resolveTimestampsAsync`. A batch gives no sample when three reset a pool itself (a boundary lower than the previous boundary, or `pendingResolve` set). A unit test with the real pool class of three pins each field that the module reads or writes (`backend.device`, `trackTimestamp`, `timestampQueryPool`, `querySet`, `currentQueryIndex`, `queryOffsets`, `maxQueries`, `pendingResolve`, `isDisposed`).
R9. Benchmark summary (`crates/evaluation/src/runs.rs`): `gpuMs` has `p50`, `p95`, `p99`, and `max` of the samples in the measured window when at least one exists, else `null`. `gpuUnknownCount` counts the measured acknowledgments with `null`, as now. A new `gpuSampleCount` counts the samples.
R10. `FrameApplied` does not change. Shared vectors: `applied-gpu-ms` (valid, `gpuMs` 4.25), `applied-negative-gpu-ms` (invalid), `diagnostics-gpu-timer` (valid), `diagnostics-unknown-gpu-timer` (invalid). Both harnesses check them.
R11. No image readback, no image encode, no new stream, and no new Tauri IPC. The only readback is the query result buffer of the timer (8 bytes for each query) in the renderer client.
R12. Documents: `docs/evaluation/gpu-time.md` (the probe table, with "not checked" until the orchestrator fills it), one sentence in `ARCHITECTURE.md` (Output path, frame acknowledgments), and one sentence in the MCP `app_status` description ("Each output has gpuTimer (supported or unsupported) when its renderer reported it"). The parity lines of ENV-08, CAM-08, and SHOW-05 change only after LC A6.

### Part B: batched lit lights (PR2, #316)

R13. Each of the characters, props, and environment groups uses one `DynamicLightsNode` (`three/addons/tsl/lighting/DynamicLightsNode.js`) as its `lightsNode`. Point, spot, and ambient lights without a shadow are batched. Directional lights (TB3 (b), pending G-B3) and lights with a shadow stay on the per-light path. The fixed ambient light is batched. The built-in directional light is per light.
R14. The point and spot capacity of each node is `LIMITS.litLights`. No batched light is ever dropped: a group never holds more batched lights of one type than the capacity.
R15. Each node has its point, spot, and ambient data nodes from the time it is made (TB4 (a)).
R16. A group keeps its node object while its per-light members stay the same: the built-in flag and `[id, type]` of each per-light member, in scene order. Another member change (add, remove, type change between batched types, affect flag) calls `setLights` on the same node, makes no new node, and does not change `generation()`. A change of the per-light members makes a new node, as now. A change of `lightSignature` still resets the pass failure state. (Changes light limits R13 for the three material groups.)
R17. The haze group keeps the per-light `lights()` node and the light limits R13 rule, because the volumetric lighting model ignores batched lights.
R18. `renderer.lighting` stays the three default (TB2 (a)), unless G-B2 selects (b). The selection goes into this contract before the code.
R19. With the same scene, a lit material looks the same with the batched path as with the per-light path (LC B1). No unit test claims a look.
R20. `CharacterLightingModel` builds a batched light with no received shadow and with the rim. The lilToon main light stays the first directional light (TB3 (b)). Unit tests show both with the node builder stub of `character-mtoon.test.ts` and `character-liltoon.test.ts`.
R21. A spike build is a local branch with one commit that changes only the limit constants (TypeScript and Rust). It is not pushed and not merged (TB7).

### Part B: shadow map cache (PR3, #316)

R22. Each light with a shadow has `shadow.autoUpdate` false. The renderer sets `shadow.needsUpdate` true for a frame when R23 marks the light dirty.
R23. A shadow light is dirty in a frame when one of these is true:
- it is new, its shadow was turned on, or the light set was rebuilt (`apply` returned true);
- its type, position, rotation (with a gizmo draft), range, cone, or shadow settings changed;
- a character sphere (R25) intersects its shadow volume;
- a prop or environment sphere that intersects its shadow volume now, or did at its last draw, was added, removed, moved, scaled, hidden, shown, or got a new model;
- the output camera `renderEnvironment` changed;
- the frame comes after a screenshot or a capture render (R26).
R24. `shadowVolumeHits(light, sphere): boolean` is a pure function. Point: the sphere is within `range` + radius of the light, or `range` is 0. Spot: the sphere is within the cone half angle plus `asin(radius / distance)` and within `range` + radius (`SPOT_SHADOW_FAR` when `range` is 0). Directional: the sphere intersects the shadow box (half side `SHADOW_BOX`, depth from near to far along the light).
R25. Character sphere: centered at the world position of the character root in each frame, with the radius of its rest-pose box (half the diagonal, measured one time at install) plus 1 m (TB6 (a)). A character counts as moved in each frame. Prop and environment sphere: the world bounding sphere, measured again only when the entity transform, model, or visibility changes.
R26. Before a screenshot or capture render, each shadow light is dirty. The first applied frame after it, each shadow light is dirty again.
R27. With a dirty light in each frame, the shadow looks as it does now (LC S1).

### Part B: new limits (PR4, #316)

R28. After G2, `LIMITS.litLights` and `MAX_LIT_LIGHTS` become `N_lit`, and `LIMITS.shadowLights` and `MAX_SHADOW_LIGHTS` become `N_shadow`. If Q5 selects (c), both sides add the point shadow check and M4 in the check order. The shared vectors move to the new edges (valid at `N_lit` and `N_shadow`, invalid at one more), each with its message.
R29. The session, `validateCall`, Rust `validate_show`, assist `light_setup`, the Editor Add and Duplicate rules, and the MCP `scene_patch` description use the new numbers through the constants. Their tests change to the new edges.
R30. The orchestrator runs the Windows check (LC W) before PR4 merges.

### Documents and evidence

R31. `ARCHITECTURE.md` changes with each pull request that changes a sentence of the Output path (PR1 acknowledgments; PR2 group nodes; PR3 shadow maps; PR4 limits). `docs/warudo-parity.md` ENV-07 and ENV-08 record only verified results. `docs/evaluation/light-scale.md` has one row for each local check of PR2 to PR4, with "not checked" until the orchestrator fills it.
R32. No pull request claims a GPU, OBS, look, cost, or Windows result that was not measured. GPU time is unknown, never 0, where no timer exists.

### Acceptance

| Criterion | Requirements | Checks |
| --- | --- | --- |
| #305: probe in the Editor window and OBS on macOS, recorded | R2, R12 | LC A1 |
| #305: `gpuMs` where available, `null` otherwise, never 0 for unknown | R1, R3–R7 | `gpu-timer.test.ts`; LC A1, A3 |
| #305: summary percentiles, `gpuUnknownCount` kept | R9 | `runs.rs` tests; LC A4 |
| #305: unit tests for the mapping and the unknown case; Rust accepts both | R5, R10 | contracts and renderer tests |
| #305: no readback or stream | R11 | review |
| #305: stage lights and stage beams cost again with GPU time; ENV-08, CAM-08, SHOW-05 | R12 | LC A6 |
| #316: batched lit lights with groups and MToon; cost and shader size at 8, 16, 32 | R13–R21 | scene-lights, MToon, lilToon tests; LC B1–B5 |
| #316: shadow map cache, 4 shadow lights, point shadow rule | R22–R27 | shadow-cache tests; LC S1–S3 |
| #316: new limits in TypeScript, Rust, vectors, messages | R28, R29 | contracts, session, assist, desktop, MCP tests; LC L1, L2 |
| #316: LC7 and LC8 cost method with GPU time; no `Pipeline compile failed` after 30 changes at the new limits | R16, R32 | LC L3, L4 |
| #316: Windows before a limit increase ships | R30 | LC W |

## E — Entities

- Contracts: `GpuTimerSupportSchema = z.enum(['supported', 'unsupported'])`; `RendererDiagnostics.gpuTimer?`; `app_status` output `gpuTimer?`. Rust `GpuTimerSupport` (`supported`, `unsupported`), `gpu_timer: Option<GpuTimerSupport>` with `skip_serializing_if`.
- Renderer: `initializeBackend` returns `gpuTimer`. `createGpuTimer(backend)` → `{ frameDone(): void; taint(): void; take(): number | null; support: GpuTimerSupport; dispose(): void }`. `framePairs(times, boundaries)`, `frameSpan(pairs)`, `gpuSample(spans)`.
- Evaluation: `Entry.gpu: Vec<f64>`; summary `gpuMs`, `gpuSampleCount`.
- Renderer lights: `SceneLights` keeps its interface. A directional light is a `GroupDirectionalLight` (an empty subclass of `DirectionalLight`, TB3 (b)). New `shadow-cache.ts`: `ShadowVolume`, `Sphere`, `shadowVolumeHits`, `shadowDirty(previous, next)`.
- No new `PatchOp`, entity kind, show field, MCP tool, or show version.

## A — Approach

Contract first. PR1 adds the timer, the capability, and the summary, and the orchestrator probes the clients (G-A1, G-A2). PR2 adds the batched groups at the current limit of 8, and a spike build at 16 and 32 lit lights gives the cost. PR3 adds the shadow cache, and a spike build at 4 shadow lights gives the cost. The owner sets the new limits at G2, and PR4 changes them, with the Windows check last.

## S — Structure

- PR1: `packages/contracts/src/schema.ts`, `types.ts`, `crates/contracts/src/lib.rs`, `fixtures/protocol/validation-vectors.json`; `packages/renderer/src/backend.ts`, `gpu-timer.ts` (new), `renderer.ts` (ack, diagnostics, `taint` calls), `screenshot.ts` or `capture.ts` only if a `taint` call must be there; `packages/renderer/test/gpu-timer.test.ts` (new); `crates/evaluation/src/runs.rs`; `apps/desktop/src-tauri/src/service/mod.rs`, `router.rs`; `apps/mcp/src/server.ts` (`app_status` sentence); `docs/evaluation/gpu-time.md` (new); `ARCHITECTURE.md`.
- PR2: `packages/renderer/src/scene-lights.ts`; `packages/renderer/test/scene-lights.test.ts`, `character-mtoon.test.ts`, `character-liltoon.test.ts`; `ARCHITECTURE.md`; `docs/evaluation/light-scale.md` (new); a note in `spdd/prompt/2026-11-17-light-limits.md` R13.
- PR3: `packages/renderer/src/shadow-cache.ts` (new), `scene-lights.ts` (`autoUpdate`, a `markShadows` call), `renderer.ts` (sphere tracking and dirty marks); `packages/renderer/test/shadow-cache.test.ts` (new); `ARCHITECTURE.md`; `docs/evaluation/light-scale.md`.
- PR4: the B34b files of the limits (`schema.ts`, `lib.rs`, vectors, session, assist, Editor tests, `server.ts`), `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/light-scale.md`, notes in the light limits contract.

## O — Operations

1. PR1: documents commit; contracts and vectors (R2, R10); timer and acknowledgment (R1, R3–R8, R11); evaluation summary (R9); host and MCP sentence (R2); documents (R12).
2. Orchestrator: LC A1 to A7. G-A1, G-A2.
3. PR2: contract selection commit (G-B3 result); group nodes (R13–R18, R20); spike branch (R21); documents (R31).
4. Orchestrator: LC B1 to B6. G-B2.
5. PR3: shadow cache (R22–R27); spike branch; documents.
6. Orchestrator: LC S1 to S4. G-B4.
7. Owner: G2 (Q3, Q5).
8. PR4: contract update with `N_lit`, `N_shadow`, and the point rule; limits (R28, R29); documents.
9. Orchestrator: LC L1 to L5 and LC W (R30).

## N — Norms

- Unit tests for each pure function: `framePairs`, `frameSpan`, `gpuSample`, the timer batch logic with a fake backend, the summary, the group node identity, the MToon and lilToon builds with a batched light, `shadowVolumeHits`, `shadowDirty`, and the limit edges. No test of static copy.
- Integration tests only at a real boundary that changes: the Rust service test for the `gpuTimer` pass-through (as the `videoDecoder` test), and, in PR4, the MCP stdio light limits test at the new edges.
- GPU, look, cost, WebKit, CEF, Metal, OBS, and Windows results come only from the orchestrator in the running build.
- Functional TypeScript and plain data. Long prose in Simplified Technical English. UI copy is M1 to M4 only.

## S — Safeguards

- Do not change `FrameApplied`, the show format, `schemaVersion`, the quality profiles, the haze constants, or the beam constants.
- Do not put a batched light into the haze node.
- Do not read images back, add a stream, or add IPC for GPU time.
- Do not change a limit before G2. Do not merge or push a spike branch.
- Do not use the value that `resolveTimestampsAsync` returns as a sample. Do not patch a three prototype or method.
- Do not write a GPU time, a frame time, an OBS result, or a look result that was not measured. Unknown is never 0.
