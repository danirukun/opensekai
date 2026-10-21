# REASONS: FPS counter

Analysis: [FPS counter](../analysis/2026-10-21-fps-counter.md). Issue: [#175](https://github.com/danirukun/opensekai/issues/175) (SHOW-06). Queue bundle B19.

## R — Requirements

1. A scene can hold at most 1 entity of kind `fpsCounter`. It has the entity base (`id`, `name`, `visible`, `transform`) and `fpsCounter: {corner, size, color}`. `corner` is `topLeft`, `topRight`, `bottomLeft`, or `bottomRight`. `size` is an integer from 8 to 128. `color` is a `#rrggbb` string (the light color rule).
2. The patch operation `setFpsCounter {entityId, fpsCounter}` replaces the settings. It fails with `INVALID_INPUT` and the entity ID when the entity is not an FPS counter. `createEntity`, `renameEntity`, `removeEntity`, and `setVisibility` work as for the other kinds. `setTransform` on a counter is accepted and stores the transform, which has no effect (the generic operation stays generic). A second counter makes the scene fail validation.
3. TypeScript and Rust validate the same shape and the same limit. The validation vectors (target `scene`) have a valid counter, a second counter, a size of 7, a size of 129, a size that is not an integer, a bad corner, and a bad color. Target `call` has a valid and a wrong-shape `setFpsCounter` patch.
4. The Add Asset menu has "FPS Counter". The new entity is named "FPS Counter", visible, with the identity transform, `topRight`, size 32, and `#ffffff`. One helper `fpsCounterLimitReached(entities)` disables the menu item and the Hierarchy Duplicate action at the limit, with the existing "Scene asset limit reached" title.
5. The Inspector of a counter shows Corner (`Select`), Size (slider), and Color (the existing color field). It has no Transform section. Reset to default (B17) uses the values in requirement 4.
6. The Hierarchy shows the counter in a new group "Overlays", with one icon from the existing icon set.
7. Each renderer client that draws a frame into a page (the OBS page and the Scene window preview) shows one text element over its canvas when the scene has a visible counter. The element is in the DOM, not in the canvas. It is absent when the scene has no counter or the counter is hidden. The three.js renderer makes no scene object for the kind, also in the editor viewport (no pick target, no helper).
8. The value is the count of successful `applyFrame` calls of that client in the last 1000 ms, timed with `performance.now()`. The text is `<n> FPS`. The meter starts when the client first applies a frame whose scene has a visible counter. Until 1000 ms have passed since that start, the text is `-- FPS`. When a frame has no visible counter, the element goes away and the meter clears, so the next visible counter starts a new 1000 ms window. The interval reads the meter each 500 ms, also when no frame arrives, so a stall shows `0 FPS` after 1000 ms without frames. A rejected or cancelled `applyFrame` does not count: the call to the overlay is on the success path only, after `await applyFrame` and before `sendApplied`.
9. The text is in the corner that the settings give. With `k = canvas.clientHeight / 1080`, read at each update, the font size is `Math.round(size × k)` CSS pixels and the margin is `Math.round(size × k / 2)` pixels, so a 1920 × 1080 output shows `size` pixels. The text uses `color`, `font-variant-numeric: tabular-nums`, and a dark text shadow for contrast. The element has `pointer-events: none` and `aria-hidden="true"`.
10. The counter is not in camera screenshots, `captureFrame` results, or benchmark captures. This is true by construction because `screenshot.ts` and `capture.ts` read the canvas only and the renderer makes no object for the kind (requirement 7); the screenshot `show` set excludes the kind.
11. The interval runs only while a counter is visible in that client. Page close or Scene teardown stops it and removes the element.
12. The Blueprint property registry gives the counter the `visible` target only: `visible` gets its own kinds list (`lit` plus `fpsCounter`), and position and rotation keep `lit`. The existing `setVisibility` case in `session/src/overrides.ts` covers it. `blueprint-file.ts` adds `fpsCounter` to `REFERENCE_KINDS`; a counter can match an `entity` field like other kinds.
13. MCP `scene_patch` documents `createEntity` with kind `fpsCounter`, `setFpsCounter`, the fields, and the limit. The tool input schema comes from `ParamSchemas`, so no second list changes. No new MCP tool.
14. Known gaps, not in this slice: the Editor window has no own preview of the counter; a free position; other metrics (frame time, GPU time).

## E — Entities

- `FpsCounterSettings`: `{corner: FpsCounterCorner, size: number, color: string}` (zod `FpsCounterSettingsSchema`, Rust `FpsCounterSettings`).
- `FpsCounterCorner`: `'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'`.
- `SceneEntity` gains `{kind: 'fpsCounter', fpsCounter: FpsCounterSettings}` on the entity base. `LIMITS.fpsCounters = 1`.
- `PatchOp` gains `{kind: 'setFpsCounter', entityId, fpsCounter}`.
- `FpsMeter` (renderer, plain data): `{start: number | null, times: number[]}`. Pure functions `recordFrame(meter, now)`, `readFps(meter, now): number | null`. `null` means unknown.
- `FpsCounterView`: `{text: string, corner, fontPx: number, marginPx: number, color}`, derived from the settings, the meter, and the canvas height.

## A — Approach

- Contracts: add the schema, the limit check in the `SceneViewSchema` refine, the patch operation, the Rust mirror, and the vectors.
- Session: one `setFpsCounter` case in `scene-ops.ts`, as `setHaze`.
- Renderer: `packages/renderer/src/fps-counter.ts` holds the pure meter functions, `counterView(settings, fps, canvasHeight)`, and `createFpsCounterOverlay({host, canvas, now, setInterval, clearInterval})`. The overlay takes each successful frame (`frameApplied(scene)`), finds the visible counter, records the time, and owns one `<div>` in `host` and one interval. It creates the element on the first frame with a visible counter, not from the timer. It does not import Svelte. `createRenderer` does not change.
- `renderer.ts`: add `fpsCounter` to the kinds without a scene object in the `wanted` filter (also in the editor viewport), to the `continue` with `tracking` in the entity loop, and to the exclusions of the screenshot `show` set. Without these the loop reads `entity.source` of a counter.
- OBS page (`apps/output/src/main.ts`, `index.html`): the host is a new empty `<div>` after the canvas, `position: absolute; inset: 0; pointer-events: none`, in a `position: relative` body box.
- Scene window: `App.svelte` adds one empty host `<div>` in `.preview-surface`, after `GuideOverlay` and before `LoadOverlay`, so the counter is above the guides and below the load overlay. Svelte owns the host; the overlay owns only its child. `bootstrap.ts` gets the host as an option, creates the overlay, calls it in the pump on the success path, and disposes it in `closePreview`.
- Editor: add the kind to `live-fields.ts` (`AddKind`), `authoring.ts`, `model.ts` (`setFpsCounter`), `lights.ts` or a new small helper for `fpsCounterLimitReached`, `property-defaults.ts`, `inspector-sections.ts`, `asset-groups.ts` (the "Overlays" group), `Hierarchy.svelte` (Add menu, Duplicate limit, icon), `Inspector.svelte`, and a new `FpsCounterFields.svelte` that uses `Select`, `SliderField`, and `ColorField`.
- Rust mirror (`crates/contracts/src/lib.rs`): the `FpsCounterSettings` object and its validation, the entity variant and its `id`, `name`, and `transform` accessors, the scene limit check, the patch operation and its validation, and the entity validation. `types.ts` exports `FpsCounterSettings` and `FpsCounterCorner`.

## S — Structure

- New: `packages/renderer/src/fps-counter.ts`, `packages/renderer/test/fps-counter.test.ts`, `apps/desktop/src/components/FpsCounterFields.svelte`, `packages/session/test/fps-counter-patch.test.ts`, `apps/mcp/test/fps-counter.integration.test.ts`, `crates/contracts/tests/fps_counter.rs`.
- Changed: `packages/contracts/src/schema.ts`, `types.ts`, `property-registry.ts`, `blueprint-file.ts`, and their tests (the registry test expects `fpsCounter` on `visible` only); `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`; `packages/session/src/scene-ops.ts`; `packages/renderer/src/index.ts` and `renderer.ts`; `apps/output/src/main.ts` and `index.html`; `apps/desktop/src/bootstrap.ts` and `App.svelte`; the editor files in the approach and the `asset-groups` test; `apps/mcp/src/server.ts`.
- Changed: `ARCHITECTURE.md` (Output path: the counter is a DOM overlay, never in the canvas or a capture).
- Changed: `docs/warudo-parity.md` SHOW-06 with only the verified behavior.
- No change: the host service and router, the asset registry, Tauri IPC.

## O — Operations

1. Add the contract shape, the Rust mirror, and the vectors. Run the vector tests on both sides.
2. Add `setFpsCounter` to the session with a unit test for the replace, the wrong-kind failure, and the second-counter rejection.
3. Add `fps-counter.ts` with unit tests: unknown before 1000 ms, the count in a window, old times drop out, a stall gives 0 from the interval without a frame, a hidden counter clears the meter and a new one starts a new window, the view size at 1080 and at 540 pixels, each corner. Add a renderer test that a scene with a counter applies without a scene object.
4. Wire the overlay in the OBS page and the Scene window. Do not count a rejected `applyFrame`.
5. Add the editor kind, the Inspector fields, the Hierarchy icon, and the reset defaults.
6. Add the MCP integration test: `createEntity` of a counter, `setFpsCounter`, a second counter fails, `removeEntity`.
7. Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo fmt --check`, `cargo clippy`, and `cargo test --workspace`.
8. Run the OBS page headless on the software adapter with a scene that has a visible counter: the element shows `-- FPS`, then a number above 0; it moves with the corner; it is absent after `setVisibility false`; a `captureFrame` has no text pixels where an empty scene has none.
9. Run the Editor flow headless where WebGL works: Add › FPS Counter, change the Corner, Size, and Color, reset Size, Duplicate is disabled, and see the Scene preview text follow. If the flow cannot run headless, the parity line stays partial and names the flow that is not checked.
10. Ask a reviewer on a different model for defects against these requirements.
11. Update the parity line with the source commit, the platform, the renderer backend that ran (for example SwiftShader WebGPU or llvmpipe WebGL 2), the tests and captures, and the remaining gaps. Update `ARCHITECTURE.md`.

## N — Norms

Functional TypeScript and plain data. Match the compact style of the haze and light files. Controls come from `@oshi-connect/ui`. UI copy is the menu item, the three field labels, the corner names, and the counter text, with no helper text (constitution principle 1). No pill, badge, or card for the counter (principle 2). Prose follows ASD-STE100.

## S — Safeguards

- Do not send the measured value to the session, the host, a frame acknowledgment, or the show.
- Do not draw the counter into the canvas, a screenshot, or a capture.
- Do not show 0 for an unknown value.
- Do not add a render loop or a second `requestAnimationFrame` loop. The counter uses the existing frame path and one interval.
- Do not claim SHOW-06 on macOS, in OBS, or on Windows from the cloud run. OBS alpha around the text and the value at 60 FPS need an owner check (`accept:local`).
