# REASONS: Camera color grading, tone mapping, and bloom

Date: 2026-11-10. Scope: #54 CAM-06, slice 1. Analysis: [camera grading](../analysis/2026-11-10-camera-grading.md). Related: [quality controls](2026-10-16-quality-controls.md) (the post-processing chain), [stage lights](2026-10-18-stage-lights.md) (haze composite, B13 R8).

## R — Requirements

R1. `@opensekai/contracts` exports `CameraToneMappingSchema` (`none`, `aces`, `neutral`), `CameraBloomSchema`, `CameraGradingSchema`, `DEFAULT_CAMERA_GRADING`, `isNeutralGrading(grading)`, and `gradingChainKey(grading)`.
R2. `CameraGrading` is a strict object: `toneMapping`; `exposure` −4 to 4 (stops); `brightness`, `contrast`, and `vibrance` −1 to 1; `tint` `#rrggbb` (lower case); `bloom` with `intensity` 0 to 4, `threshold` 0 to 4, and `radius` 0 to 1. Each field is necessary.
R3. `DEFAULT_CAMERA_GRADING` is: `none`, exposure 0, brightness 0, contrast 0, vibrance 0, tint `#ffffff`, bloom intensity 0, threshold 0.8, radius 0.4. It is frozen.
R4. A camera entity has an optional `grading`. TypeScript and Rust accept the field, check its ranges, and omit it when it is missing. Shows without the field load without change.
R5. The patch operation `{ kind: 'setCameraGrading', entityId, grading }` sets the group on a camera; `grading: null` removes it. It fails with `INVALID_INPUT` for an entity that is not a camera and with `NOT_FOUND` for an unknown entity. It goes through the normal patch route and the live patch route. MCP reaches it through `scene_patch`.
R6. `isNeutralGrading` is true for a missing group and for a group that changes no pixel: tone mapping `none`, exposure, brightness, contrast, and vibrance 0, tint white, and bloom intensity 0. The bloom threshold and radius do not count.
R7. With a neutral grading, no FXAA, and no haze, the renderer draws directly and holds no chain, as before this slice.
R8. With a grading that is not neutral, the chain is: scene pass, haze composite (when on), bloom composite (when the bloom intensity is above 0), grade, output color transform, FXAA (when on).
R9. Bloom composite: `rgb = scene.rgb + bloom.rgb`, `alpha = a + (1 − a) · saturate(max(bloom.r, bloom.g, bloom.b))`. The bloom input is the color after the haze composite. Bloom strength, radius, and threshold are the group values.
R10. Grade, on the color without alpha premultiplication (a pixel with alpha 0 stays `0, 0, 0, 0`): multiply by 2^exposure; apply the tone mapping curve (`none`: no curve; `aces`: three.js `acesFilmicToneMapping`; `neutral`: three.js `neutralToneMapping`); multiply by 1 + brightness; contrast `0.18 · (c / 0.18)^(1 + contrast)`; three.js `vibrance(c, vibrance)`; multiply by the tint in the working color space; clamp at 0; premultiply again.
R11. A change of a number of the group (exposure, brightness, contrast, vibrance, tint, bloom values above 0) does not build the chain again. The chain key has the anti-aliasing mode, the haze flag, and `gradingChainKey`: `off` for a neutral group, otherwise the tone mapping mode and `bloom` or `clear`.
R12. `camera_screenshot` and Take Screenshot apply the grading of the screenshot camera with the same grade and bloom functions as the output.
R13. A transparent pixel far from geometry and glow stays at alpha 0 with each grading.
R14. `packages/renderer/src/grading-math.ts` has a CPU reference of R9 and R10 for one pixel (`gradePixel`, `bloomCompositePixel`). Its tone mapping curves are the three.js 0.187 formulas.
R15. The editor Inspector shows a Grading section for a camera: Tone Mapping (None, ACES, Neutral), Exposure, Brightness, Contrast, Vibrance, Tint, and Bloom Intensity, Bloom Threshold, and Bloom Radius. Sliders change the look live and commit on release. A missing group shows the default values, and the first change writes the full group. Each field has the reset mark of B17 when it differs from the default.
R16. `docs/warudo-parity.md` records only the verified subset. CAM-06 stays unchecked.

## E — Entities

- `CameraToneMapping = 'none' | 'aces' | 'neutral'`.
- `CameraBloom = { intensity: number; threshold: number; radius: number }`.
- `CameraGrading = { toneMapping: CameraToneMapping; exposure: number; brightness: number; contrast: number; vibrance: number; tint: string; bloom: CameraBloom }`.
- Camera entity: `grading?: CameraGrading`. Patch operation `setCameraGrading`, also a `LivePatchOp`.
- Rust: `CameraToneMapping`, `CameraBloom`, `CameraGrading` with `Validate`, `SceneEntity::Camera { grading: Option<CameraGrading> }`, `PatchOp::SetCameraGrading { grading: Option<CameraGrading> }`.

## A — Approach

Add the contracts first in TypeScript and Rust with shared vectors. Then the session operation. Then the renderer: a `grading.ts` module with the TSL nodes and uniforms, the chain change, and the screenshot change. Then the editor section. Check the pixels in headless Chromium with the real renderer against the CPU reference.

## S — Structure

- `packages/contracts/src/grading.ts` (new), `schema.ts`, `types.ts`, `index.ts`; `packages/contracts/test/grading.test.ts` (new).
- `crates/contracts/src/lib.rs`; `crates/contracts/tests/grading.rs` (new); `fixtures/protocol/validation-vectors.json`.
- `packages/session/src/scene-ops.ts`; `packages/session/test/grading-patch.test.ts` (new). `packages/assist/src/compile-kit.ts` (the scene copy of the operation).
- `packages/renderer/src/grading.ts` (new), `grading-math.ts` (new), `post-chain.ts`, `renderer.ts`, `screenshot.ts`; `packages/renderer/test/grading.test.ts` (new), `quality.test.ts`.
- `apps/desktop/src/components/CameraGradingFields.svelte` (new), `Inspector.svelte`, `editor/model.ts`, `editor/inspector-sections.ts`, `editor/property-defaults.ts`, `editor/slider.ts`, `editor/live-fields.ts`; desktop tests.
- `ARCHITECTURE.md` (renderer row), `docs/warudo-parity.md`, `docs/evaluation/camera-grading.md` (new).

## O — Operations

1. Contracts: `grading.ts`, the camera field, the patch operation, the live operation type. Rust mirror with range checks. Vectors: a camera with a grading (valid), an exposure out of range, an unknown tone mapping, a tint in upper case, a missing bloom field (all rejected), and the patch operation with a group and with `null`.
2. Session: apply `setCameraGrading` in `scene-ops.ts`; `null` deletes the field.
3. Renderer: `createGrading()` returns the uniforms, `update(grading)`, `grade(color, toneMapping)`, and `bloom(color)`; `bloomComposite(scene, bloom)` is a pure node function. `createPostChain().render(scene, camera, mode, haze, grading)` builds the chain of R8 with the key of R11 and updates the uniforms on each frame. `renderScreenshot` takes `grading` and applies R8 on its targets.
4. Editor: `model.setCameraGrading(entityId, grading | null, expectedRevision, live)`, the Grading section, slider ranges, and reset defaults.
5. Documents: parity, architecture, evidence.

## N — Norms

- Unit tests: the schemas and the Rust mirror with shared vectors; `isNeutralGrading` and `gradingChainKey`; the patch operation; the CPU reference (identity at the defaults, the contrast pivot, exposure in stops, the curves at known points, the bloom alpha rule); `needsChain` and `chainKey`; the renderer passes the camera grading to the chain and to the screenshot.
- A headless Chromium check of the real renderer on a software adapter: render the smoke box with a set of gradings, read the pixels, and compare the box color with `gradePixel` within the 8-bit tolerance; check that the corner alpha stays 0, that bloom adds partial-alpha pixels outside the box, and that a return to a neutral group gives the first image again. Record the raw output in the evidence file.
- UI copy is the control label only (constitution principle I). Controls come from `@oshi-connect/ui` and the existing slider and color fields.

## S — Safeguards

- Do not change the show file version or require the new field.
- Do not change the look of an existing show: a missing or neutral `grading` draws without the grade and without bloom.
- Do not read images back in the production output path. The grading runs on the GPU.
- Do not set `renderer.toneMapping`. Materials and the diagnostic marker must not get a second curve.
- Do not claim a macOS, OBS, or GPU result. OBS alpha with bloom over dark, light, and checker backgrounds, the look of each curve on a VRM, and the frame cost stay unknown until the owner checks them locally.
