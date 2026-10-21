# REASONS: Output size, render scale, and frame limit

Analysis: [output format](../analysis/2026-10-21-output-format.md). Issue: [#173](https://github.com/danirukun/opensekai/issues/173) (CAM-16, slice 1). Queue bundle B22.

## R — Requirements

1. `OutputSpec` becomes `{id, cameraId, width, height, fps, renderScale?}`. `width × height` is one of `960 × 540`, `1280 × 720`, `1600 × 900`, or `1920 × 1080`. `fps` is `30` or `60`. `renderScale` is `0.5`, `0.75`, or `1`; a missing value means 1. A show without `renderScale` loads without change, and the field is omitted when it is missing. `renderScale: null` is rejected on both sides (the Rust field rejects `null`, as zod `.optional()` does). `schemaVersion` stays 1.
2. `preview_main` must stay `1920 × 1080`, `60`, and `renderScale` missing or 1. A scene that breaks this fails validation.
3. The patch operation `setOutputFormat {outputId, width, height, fps, renderScale}` replaces those four fields of the output. It fails with `INVALID_INPUT` and the output ID when the output is not `output_main`, and with `NOT_FOUND` and the output ID when the scene has no such output. It goes through the normal patch route (revision check, whole-scene validation). It has no entity ID, so `scene-ops.ts` handles it before the entity lookup.
4. TypeScript and Rust validate the same shape. The validation vectors (target `scene`) have each preset, a `1920 × 720` pair, a `3840 × 2160` pair, `fps` 24, `renderScale` 2, a scene without `renderScale`, `renderScale: null`, and a `preview_main` at `1280 × 720`. Rust checks the same rule in the scene validation and in `impl Validate for OutputSpec` (both sites hard-code 1920, 1080, and 60 today), and the `PatchOp` match gets a `SetOutputFormat` arm. A valid `setOutputFormat` call is a `wireText` vector, and target `call` has a wrong-shape `setOutputFormat` patch.
5. The renderer sets the drawing buffer to `Math.round(width × (renderScale ?? 1) × quality.resolutionScale)` by `Math.round(height × (renderScale ?? 1) × quality.resolutionScale)`. `Math.round` is intended: `1600 × 900 × 0.75 × 0.5` gives `600 × 338`, and the small aspect error is accepted. The canvas CSS size does not change. `FrameApplied.width` and `.height` keep their meaning (the drawing buffer) and stay inside the current bounds. A capture is the drawing buffer size, as now.
6. The OBS page paces frames with a pure gate in `apps/output/src/frame-pacer.ts`. It reads `fps` of its own output from each frame. With 60, it applies each frame, as today. With 30, the interval is `1000 / 30` ms and the slack is 4 ms. A frame that arrives when at least `interval − slack` ms have passed since the start of the last applied frame is applied now. Another frame is held; a newer frame replaces the held frame. While a frame is held, one timer at `last start + interval` applies the newest held frame. The timer is necessary: the host sends a frame only while fewer than 2 frames are unacknowledged (`STATE_CAPACITY`), so with a held frame and one more early arrival the host stops sending until the page acknowledges a frame. While the host sends at 60, the mean applied rate is about 30 FPS, and one interval is from 29.3 ms to 33.3 ms plus the timer delay. The page acknowledges only the frames it applies. A held frame that a newer frame replaces is never applied or acknowledged. The frame delivery of the host does not change.
7. The gate keeps the current order: at most one `applyFrame` call starts for each due time, and a rejected or cancelled `applyFrame` does not move the last-applied time. Page close stops the timer.
8. The Scene preview, the editor viewport, and screenshots do not change. The preview pump stays at display rate. A screenshot stays 1920 × 1080.
9. The FPS counter (B19) on the OBS page counts the applied frames, so it shows about 30 at a 30 FPS limit. Its size stays relative to the canvas height.
10. `benchmarkStart` fails with `INVALID_INPUT` and `output_main` when the latest published scene has an `output_main` that is not `1920 × 1080`, `60`, and render scale 1. The message is `Benchmark needs the default output format`. The run record does not change.
11. The editor Output panel adds three `Select` controls from `@oshi-connect/ui`: Resolution (`1920 × 1080`, `1600 × 900`, `1280 × 720`, `960 × 540`), Render scale (`100%`, `75%`, `50%`), and Frame limit (`60 FPS`, `30 FPS`). Each change sends one `setOutputFormat` with the other current values. A rejected change shows the scene value again. The copied OBS URL does not change.
12. MCP `scene_patch` documents `setOutputFormat`, the presets, the values, and that only `output_main` changes. The tool input schema comes from `ParamSchemas`, so no second list changes. No new MCP tool.
13. Known gaps, not in this slice: a free width and height, sizes above 1920 × 1080, sizes that are not 16:9, a render scale above 1, frame limits other than 30 and 60, Pause Render and Render Next Frame (CAM-16 slice 2), and a size change for the Scene preview. V-Sync is not applicable to a browser output (analysis finding 6).

## E — Entities

- `OutputSize`: one of the four `{width, height}` presets. Exported as the frozen list `OUTPUT_SIZES` from `packages/contracts/src/quality.ts`, with `OUTPUT_FRAME_LIMITS = [30, 60]` and `OUTPUT_RENDER_SCALES = [0.5, 0.75, 1]`.
- `OutputSpec`: `{id, cameraId, width, height, fps: 30 | 60, renderScale?: 0.5 | 0.75 | 1}`. Rust `OutputSpec { render_scale: Option<f64> }` with `skip_serializing_if`.
- `PatchOp` gains `{kind: 'setOutputFormat', outputId, width, height, fps, renderScale}`. Rust `PatchOp::SetOutputFormat`.
- `FramePacer` (OBS page, plain data and closures; the fake clock tests also model the 2-frame cap of the host): `createFramePacer({apply, now, setTimeout, clearTimeout})` returns `{offer(frame), dispose()}`. `apply(frame)` returns a promise. The due rule is the pure function `isDue(lastStart: number | null, now: number, fps: 30 | 60): boolean`.

## A — Approach

- Contracts: relax the literals in `OutputSpecSchema`, add the preset refine and the `preview_main` rule to the `SceneViewSchema` refine, add the patch operation, mirror both in Rust, and add the vectors.
- Session: one `setOutputFormat` case in `scene-ops.ts` before the entity lookup, with the output checks of requirement 3. When `renderScale` is 1, the operation stores the value 1; it does not remove the field.
- Renderer: change the buffer size line in `renderer.ts` only.
- OBS page: `main.ts` sends each host frame to the pacer. The pacer calls the current apply path (`applyFrame`, then the FPS counter, then `sendApplied`, then diagnostics).
- Host: a new read-only method in `service/mod.rs` returns the `OutputSpec` of an output from the latest published scene (`inner.latest`), because `current_output` returns only a `FrameApplied`. `evaluation.rs` calls it at `benchmarkStart`. The host does not parse the scene again. The frame delivery and the acknowledgment rules do not change. At 30 FPS an acknowledgment comes each 34 ms at most, inside the 500 ms age check of `current_output`.
- Editor: `model.ts` gets `setOutputFormat`. `OutputControls.svelte` adds the three selects. The option lists come from the contract constants.
- MCP: one sentence in the `scene_patch` description.

## S — Structure

- New: `apps/output/src/frame-pacer.ts`, `apps/output/test/frame-pacer.test.ts`, `packages/session/test/output-format-patch.test.ts`, `crates/contracts/tests/output_format.rs`, `apps/mcp/test/output-format.integration.test.ts`, `apps/desktop/test/output-format.test.ts`, `docs/evaluation/output-format.md` and its check scripts.
- Changed: `packages/contracts/src/schema.ts`, `quality.ts`, `types.ts`, `index.ts`, and their tests; `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`; `packages/session/src/scene-ops.ts`; `packages/renderer/src/renderer.ts`; `apps/output/src/main.ts`; `apps/desktop/src-tauri/src/service/mod.rs` (the output spec read only) and `evaluation.rs` and their tests; `apps/desktop/src-tauri/src/show.rs` test (round trip of a show with the new values); `apps/desktop/src/editor/model.ts`; `apps/desktop/src/components/OutputControls.svelte`; `apps/mcp/src/server.ts`.
- Changed: `ARCHITECTURE.md` (Output path: the output size, the render scale, and the OBS page frame limit; the simulation stays at 60 Hz).
- Changed: `docs/warudo-parity.md` CAM-16 with only the verified behavior. CAM-16 stays unchecked.
- Changed: `docs/evaluation/benchmark-contract.md` (the benchmark needs the default output format).
- No change: `tools/evaluation/src/obs.ts` (the benchmark keeps the 1920 × 1080, 60 OBS source), the frame delivery and the router, the session tick, the preview pump, `screenshot.ts`, `capture.ts`, the FPS counter, Tauri IPC.

## O — Operations

1. Add the contract shape, the Rust mirror, and the vectors. Run the vector tests on both sides.
2. Add `setOutputFormat` to the session with unit tests: replace, a call without a change of value, `preview_main` refused, unknown output, a bad preset refused by scene validation, a missing `renderScale` kept missing on other patches.
3. Add the renderer buffer size with a unit test for each scale and profile pair (for example `1280 × 720 × 0.75 × 0.5` gives `480 × 270`).
4. Add `frame-pacer.ts` with unit tests on a fake clock: 60 applies each frame; 30 applies every second frame at a 16.7 ms arrival interval; the newest held frame wins; the timer applies a held frame when arrivals stop; a rejected apply does not move the last-applied time; a change from 30 to 60 applies the next frame at once; with jittered arrivals (for example 12 ms and 21 ms) and the 2-frame cap, the mean rate stays at about 30 and the pacer never waits for an arrival that the cap stops; dispose stops the timer.
5. Wire the pacer in the OBS page.
6. Add the output spec read and the benchmark check with a host test for a default and a non-default output. Add a show round trip test with `renderScale` and a non-default size.
7. Add the editor model call and the three selects.
8. Add the MCP integration test: `setOutputFormat` on `output_main` at `1280 × 720`, 30, 0.75 succeeds; on `preview_main` it fails; a `3840 × 2160` call fails.
9. Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo fmt --check`, `cargo clippy`, and `cargo test --workspace`.
10. Run the OBS page headless on the software adapter: at `1280 × 720` and 0.75 the canvas buffer is `960 × 540`; at 30 FPS the page acknowledges about 30 frames each second while the host sends 60 (count the acknowledgments for 5 s); at 60 it acknowledges each frame; the transparent clear keeps alpha 0 at a pixel far from geometry.
11. Run the Editor flow headless where WebGL works: change each select and see the scene revision and the OBS page buffer follow; a reload of the show keeps the values. If the flow cannot run headless, the parity line stays partial and names the flow that is not checked.
12. Ask a reviewer on a different model for defects against these requirements.
13. Update the parity line with the source commit, the platform, the renderer backend that ran, the tests and captures, and the remaining gaps. Update `ARCHITECTURE.md`.

## N — Norms

Functional TypeScript and plain data. Match the compact style of `quality.ts` and the B8 output controls. Controls come from `@oshi-connect/ui`. UI copy is the three labels and the option names, with no helper text (constitution principle 1). No pill or badge for the current format (principle 2). Unit tests for the pure gate, the buffer size, and the patch; an integration test at the MCP boundary; no test of static copy. Prose follows ASD-STE100.

## S — Safeguards

- Do not change the session tick or the host clock. The simulation stays at 60 Hz with a 30 FPS limit, and motion continues when the editor is minimized.
- Do not add a `requestAnimationFrame` loop to the OBS page. The pacer uses the frame arrivals and one timer.
- Do not let a buffer exceed 1920 × 1080, and do not change the `FrameApplied`, capture, evaluation, or PNG bounds.
- Do not save a pause state or any runtime state in the show.
- Do not change the look of an existing show: a show without the new values draws at 1920 × 1080, 60, and scale 1, as now.
- Do not claim CAM-16 on macOS, in OBS, or on Windows from the cloud run. The OBS frame rate at the 30 FPS limit, the image at each size and scale in OBS, and the GPU cost of each size need an owner check (`accept:local`).
