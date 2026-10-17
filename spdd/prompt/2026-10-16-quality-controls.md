# REASONS: Quality controls and production quality profiles

Date: 2026-10-16. Scope: bundle B8 (#56 CAM-08 first subset, #72 SHOW-05 first subset). Analysis: [quality controls](../analysis/2026-10-16-quality-controls.md). Related: [benchmark contract](../../docs/evaluation/benchmark-contract.md).

## R — Requirements

R1. `@opensekai/contracts` exports `QualityProfileIdSchema` (`preview_v1`, `production_v1`, `performance_v1`), the frozen table `QUALITY_PROFILES`, `DEFAULT_QUALITY_PROFILE` (`production_v1`), and `qualityProfileFromQuery(value)`. A missing or unknown query value gives `production_v1`.
R2. A profile has `id`, `resolutionScale` (1 or 0.5), `maxTextureSize` (1024 or 2048), and `msaaSamples` (0 or 4). The values are: `preview_v1` 0.5 / 1024 / 4; `production_v1` 1 / 2048 / 4; `performance_v1` 1 / 1024 / 0. A changed value needs a new ID.
R3. `createRenderer` takes `quality: QualityProfile` in place of `resolutionScale`. The renderer uses the profile scale for the drawing buffer size, the profile texture limit for the asset loader, and the profile MSAA sample count for the backend (`antialias` is on only when `msaaSamples > 0`).
R4. The Scene preview uses `preview_v1`. The OBS page uses `qualityProfileFromQuery` on its `quality` query parameter. The `scale` query parameter is removed.
R5. `FrameApplied` has an optional `qualityProfile: QualityProfileId`. Each renderer sets it on each acknowledgment. TypeScript and Rust accept an acknowledgment with or without it and reject an unknown ID. Shared vectors cover both cases.
R6. The editor Output panel has a Quality select with the three profiles. The select changes only the copied OBS URL. `production_v1` adds no `quality` parameter. Another profile adds `quality=<id>`. The `backend=webgl2` parameter and the hash stay as today.
R7. A camera entity has an optional `antiAliasing: 'none' | 'fxaa'`. A missing value means `none`. TypeScript and Rust accept the field and omit it when it is missing. Shows without the field load without change.
R8. The patch operation `{ kind: 'setCameraAntiAliasing', entityId, antiAliasing }` sets the field on a camera. It fails with `INVALID_INPUT` for an entity that is not a camera and with `NOT_FOUND` for an unknown entity. It goes through the normal patch route (revision check, whole-scene validation). MCP reaches it through `scene_patch`.
R9. The editor Inspector shows an Anti-aliasing select (None, FXAA) for a camera. A rejected change shows the scene value again.
R10. When the output camera has `fxaa`, the renderer draws the scene through a TSL post-processing chain: scene pass, output color transform, then FXAA. With `none`, it draws the scene directly and releases the chain. The chain is disposed with the renderer. The diagnostic marker still draws on top of the result. Capture reads the filtered image.
R11. A transparent pixel far from geometry stays at alpha 0 with each mode.
R12. SMAA is not a mode. The three.js r180 `SMAANode` makes the output opaque (see the analysis), so it fails R11.
R13. `docs/warudo-parity.md` records only the verified subset. CAM-08 and SHOW-05 stay unchecked.

## E — Entities

- `QualityProfileId = 'preview_v1' | 'production_v1' | 'performance_v1'`.
- `QualityProfile = { id: QualityProfileId; resolutionScale: 1 | 0.5; maxTextureSize: 1024 | 2048; msaaSamples: 0 | 4 }`.
- `CameraAntiAliasing = 'none' | 'fxaa'`. Camera entity: `antiAliasing?: CameraAntiAliasing`.
- Patch operation `setCameraAntiAliasing`. Rust: `PatchOp::SetCameraAntiAliasing`, `SceneEntity::Camera { anti_aliasing: Option<CameraAntiAliasing> }`, `QualityProfileId`, `FrameApplied { quality_profile: Option<QualityProfileId> }`.

## A — Approach

Add the contracts first in TypeScript and Rust with vectors. Then add the session operation. Then change the renderer (profile option, MSAA, post-processing chain) and the two renderer clients. Then add the editor controls. Check the filter and the alpha in headless Chromium with the real renderer on WebGL 2.

## S — Structure

- `packages/contracts/src/quality.ts` (new), `schema.ts`, `types.ts`, `index.ts`; `packages/contracts/test/quality.test.ts` (new).
- `crates/contracts/src/lib.rs`; `crates/contracts/tests/quality.rs` (new); `fixtures/protocol/validation-vectors.json`.
- `packages/session/src/scene-ops.ts`; `packages/session/test/quality-patch.test.ts` (new).
- `packages/renderer/src/backend.ts`, `renderer.ts`, `anti-aliasing.ts` (new); renderer tests.
- `apps/output/src/main.ts`; `apps/desktop/src/bootstrap.ts`, `editor/output-url.ts`, `editor/model.ts`, `components/OutputControls.svelte`, `components/Inspector.svelte`, `EditorApp.svelte`; desktop tests.
- `ARCHITECTURE.md` (output path), `docs/warudo-parity.md`, `docs/evaluation/quality-controls.md` (new).

## O — Operations

1. Contracts: `quality.ts`, camera field, patch operation, `FrameApplied.qualityProfile`. Rust mirror. Vectors for a camera with and without the field, the patch operation, an acknowledgment with and without the profile, and an unknown profile and mode (reject).
2. Session: apply `setCameraAntiAliasing` in `scene-ops.ts`.
3. Renderer: `initializeBackend(canvas, mode, msaaSamples)`. `createAntiAliasing(renderer)` returns `render(scene, camera, mode)` and `dispose()`; it keeps one `PostProcessing` chain while the mode is `fxaa`. `createRenderer` uses it and sets `qualityProfile` on `FrameApplied`.
4. Clients: the Scene preview passes `QUALITY_PROFILES.preview_v1`. The OBS page passes the profile from `?quality`.
5. Editor: `makeOutputUrl(output, mode, quality)`, the Quality select, `model.setCameraAntiAliasing`, and the Inspector select.
6. Documents: parity, architecture, evidence.

## N — Norms

- Unit tests for the profile lookup, the URL builder, the patch operation, the schemas, and the Rust mirror. Shared vectors keep TypeScript and Rust equal.
- A headless Chromium check of the real renderer on WebGL 2: render one frame per mode, read the pixels, and check edge smoothing and alpha. Record the output in the evidence file.
- UI copy is the control label only (constitution principle 1). Controls come from `@oshi-connect/ui`.

## S — Safeguards

- Do not change the show file version or require the new fields.
- Do not change the look of an existing show: a missing `antiAliasing` draws without post-processing, and `production_v1` keeps 4× MSAA and the 2048 texture limit.
- Do not read images back in the production output path. The filter runs on the GPU.
- Do not claim a macOS, OBS, or GPU result. OBS alpha with each mode, the visual result over dark, light, and checker backgrounds, and the frame cost of each mode and profile stay unknown until the owner checks them locally.
