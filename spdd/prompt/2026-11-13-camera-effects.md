# REASONS: Camera effects

Date: 2026-11-13. Scope: bundle B37 (#172 CAM-15). Analysis: [camera effects](../analysis/2026-11-13-camera-effects.md). Depends on: [camera grading](2026-11-10-camera-grading.md), [stage beams](2026-11-13-stage-beams.md). Changes: the camera grading chain (the bloom and the grade become two steps); stage beams R13 (one more trailing parameter).

The owner approved D1 to D6 on 2026-11-13. The integrator set D7 to D10. D11 and V1 to V9 are reversible choices of this contract; the owner can change each one in review.

## Decisions

| # | Decided | Rejected alternative |
| --- | --- | --- |
| D1 | One "Effects" section in the camera Inspector, after Grading. Lens Dirt is an image picker, and None is off. The four other effects each have a checkbox, and each shows its settings only while it is checked | One section for each effect; an Enabled checkbox for Lens Dirt |
| D2 | Vignetting changes only the pixels that the scene covers. Alpha does not change | Add coverage at the frame corners |
| D3 | No default dirt texture. The user picks an imported image | Ship a CC0 texture |
| D4 | Labels, defaults, and ranges come from Warudo 0.15.1. The math is an OpenSekai choice in one pure module | OpenSekai names and ranges (the draft had Lens Dirt 0–4) |
| D5 | No Blueprint or hotkey target. A follow-up issue covers it | Property registry keys in this bundle |
| D6 | A headless proof of the alpha math of each effect opens the pull request. The owner judges the look in review. The orchestrator runs the macOS app only if the headless check cannot build the chain | A full macOS and OBS check before the pull request |
| D7 | The chain order: scene pass, haze, beams, bloom, lens dirt, grade, blur, night vision, pixelate, vignetting, output transform, FXAA | Another order |
| D8 | One optional camera group `effects` with one optional key for each effect. One patch operation `setCameraEffects`; `null` removes the group | One operation for each effect; fields directly on the camera |
| D9 | The quality profiles do not change. The benchmark fixture has no `effects` group | An effect in a profile |
| D10 | One pull request. The first commit holds the analysis and this contract | A contract pull request first |
| D11 | A Warudo RGBA colour is two fields: `color` (`#rrggbb`) and `alpha` (0–1). The Inspector shows a Color field and an Alpha slider | One `#rrggbbaa` field and a new colour control with alpha |

### Interpretations (reversible)

| # | Chosen | Alternative |
| --- | --- | --- |
| V1 | Vignetting `alpha` is the strength at the frame corner | A fixed strength, with the alpha as the opacity of the colour only |
| V2 | Fade Out is the width of the soft edge (R14) | A fade of the vignette toward the centre over time |
| V3 | Blink is a lid from the top and the bottom edges, in the Vignetting RGB at full strength (R14) | A periodic blink animation |
| V4 | Night Vision `alpha` is the mix amount (R12) | A gain on the tinted image |
| V5 | Night Vision has no noise | A fixed grain from the frame time |
| V6 | Blur Intensity sets the sigma in pixels of a 1080-line frame (R11) | A sigma in pixels of the drawing buffer |
| V7 | Pixelate Intensity is the block size in pixels of a 1080-line frame (R13) | The number of blocks across the frame |
| V8 | Lens Dirt light is a blurred bright pass of its own (R10) | The bloom texture (absent without grading) |
| V9 | Lens Dirt adds coverage with the bloom rule (R10) | Dirt only on covered pixels |

## Labels and ranges

This table is the one place for each label and range. A requirement refers to a row by its ID. Each row from L2 to L15 is inside a group that has the effect name as its accessible name (R26).

| ID | Label | Control | Data (`camera.effects.`) | Range, step, default |
| --- | --- | --- | --- | --- |
| L0 | Effects | Inspector section | — | after Grading |
| L1 | Lens Dirt | image select | `lensDirt.assetId` | None, the image records, Missing image, Import file…; default None (`null`) |
| L2 | Intensity | live slider with number field | `lensDirt.intensity` | 0–1, step 0.01, default 0.9. Shows only while L1 is not None |
| L3 | Threshold | live slider with number field | `lensDirt.threshold` | 0–1, step 0.01, default 0.5. Shows only while L1 is not None |
| L4 | Vignetting | checkbox | `vignetting.enabled` | default off |
| L5 | Color | colour field | `vignetting.color` | `#rrggbb`, default `#4c4c4c` |
| L6 | Alpha | live slider with number field | `vignetting.alpha` | 0–1, step 0.001, default 0.051 |
| L7 | Fade Out | live slider with number field | `vignetting.fadeOut` | 0–1, step 0.01, default 0 |
| L8 | Blink | live slider with number field | `vignetting.blink` | 0–1, step 0.01, default 0 |
| L9 | Night Vision | checkbox | `nightVision.enabled` | default off |
| L10 | Color | colour field | `nightVision.color` | `#rrggbb`, default `#80ff80` |
| L11 | Alpha | live slider with number field | `nightVision.alpha` | 0–1, step 0.001, default 0.502 |
| L12 | Blur | checkbox | `blur.enabled` | default off |
| L13 | Intensity | live slider with number field | `blur.intensity` | 0–4, step 0.01, default 1 |
| L14 | Pixelate | checkbox | `pixelate.enabled` | default off |
| L15 | Intensity | live slider with number field | `pixelate.intensity` | 1–256, step 1, whole numbers, default 16 |

L5 to L8 show only while L4 is checked. L10 and L11 show only while L9 is checked. L13 shows only while L12 is checked. L15 shows only while L14 is checked. The Warudo colours (0.298, 0.298, 0.298) and (0.502, 1, 0.502) are 8-bit sRGB values 76 and 128, so `#4c4c4c` and `#80ff80`.

## Constants

| Name | Value | Use |
| --- | --- | --- |
| `EFFECTS_REFERENCE_HEIGHT` | 1080 | The frame height in which Blur and Pixelate units are given |
| `LUMA` | (0.2126, 0.7152, 0.0722) | Linear luminance weights |
| `DIRT_RESOLUTION` | 0.25 | The size of the dirt light pass as a part of the drawing buffer |
| `DIRT_SIGMA` | 6 | The Gaussian sigma of the dirt light, in texels of its pass |
| `DIRT_KNEE` | 0.25 | The width of the soft start above Threshold |
| `BLUR_RESOLUTION` | 0.5 | The size of the blur pass as a part of the drawing buffer |
| `BLUR_SIGMA` | 4 | The fixed kernel sigma of the blur (11 taps), in texels of its pass |
| `BLUR_PIXELS_PER_INTENSITY` | 3 | The sigma in pixels of a 1080-line frame for Intensity 1 |
| `VIGNETTE_INNER` | 0.5 | The start of the vignette for Fade Out 0, as a part of the centre-to-corner distance |
| `BLINK_EDGE` | 0.05 | The soft edge of the Blink lid, as a part of the half frame height |

## R — Requirements

### Schema

R1. `CameraEffectsSchema` is a strict object with five optional strict groups:
- `lensDirt: { assetId: Id | null, intensity: 0..1, threshold: 0..1 }`;
- `vignetting: { enabled: boolean, color: '#rrggbb', alpha: 0..1, fadeOut: 0..1, blink: 0..1 }`;
- `nightVision: { enabled: boolean, color: '#rrggbb', alpha: 0..1 }`;
- `blur: { enabled: boolean, intensity: 0..4 }`;
- `pixelate: { enabled: boolean, intensity: integer 1..256 }`.

Each colour uses the light colour rule (lower-case `#rrggbb`). An unknown key or a missing field is rejected. Each field of a present group is required.
R2. The camera entity gets `effects?: CameraEffects`. A missing group, a missing key, `enabled: false`, and `lensDirt.assetId: null` each mean "off" for that effect.
R3. `PatchOp` gets `setCameraEffects { entityId, effects: CameraEffects | null }`. `null` removes the group. On an entity that is not a camera it fails with `INVALID_INPUT`, and the scene does not change. It accepts the live flag as `setCameraGrading` does.
R4. TypeScript (zod) and Rust accept and reject the same shapes, with shared vectors:
- accept: a camera without `effects`; `effects: {}`; each group at its L-table default; Pixelate 1 and 256; `lensDirt.assetId: null`;
- reject: an unknown key in `effects`; an unknown field in a group; a missing field in a group; Vignetting alpha 1.01; Fade Out −0.01; Lens Dirt Intensity 1.01; Threshold −0.01; Blur 4.01; Pixelate 0, 257, and 16.5; colour `#4C4C4C` and `#4c4c4c80`.
R5. Rust omits the group when it is missing, so a show without effects saves with the same bytes as before. The show file version does not change.
R6. The limits, the quality profiles, the property registry, and the benchmark fixture do not change. The benchmark fixture has no `effects` group.
R7. `lensDirt.assetId` follows the screen image rule: any ID is valid data. An ID that is not a loaded image draws no dirt (R20).

### Effect math (pure functions)

R8. `activeEffects(effects, dirtReady)` gives five flags:
- lens dirt: `assetId !== null`, `intensity > 0`, and `dirtReady`;
- blur: `enabled` and `intensity > 0`;
- night vision: `enabled` and `alpha > 0`;
- pixelate: `enabled` and `intensity > 1`;
- vignetting: `enabled` and (`alpha > 0` or `blink > 0`).

R9. `effectsKey(active, dirtAssetId)` is `''` when no flag is on. Otherwise it is the names of the active effects in chain order, plus the dirt asset ID when lens dirt is active. A change of a number does not change the key.
R10. Lens dirt, on premultiplied RGBA `c` at screen UV `uv`:
- `lum = dot(c.rgb, LUMA)`; `w = smoothstep(threshold, threshold + DIRT_KNEE, lum)`; `bright = c.rgb × w`;
- `glow` is a Gaussian of `bright` at `DIRT_RESOLUTION` with sigma `DIRT_SIGMA`;
- `k = frameAspect / dirtAspect`; `dirtUv = (uv − 0.5) × (min(k, 1), min(1 / k, 1)) + 0.5` (cover fit, centred);
- `add = dirt.rgb × dirt.a × glow × intensity`, with the dirt image in linear colour and straight alpha;
- the result uses the bloom composite rule: `rgb' = c.rgb + add`, `a' = c.a + (1 − c.a) × saturate(max(add))`.

R11. Blur: the sigma in drawing-buffer pixels is `BLUR_PIXELS_PER_INTENSITY × intensity × height / EFFECTS_REFERENCE_HEIGHT`. The pass is a two-direction Gaussian of premultiplied RGBA at `BLUR_RESOLUTION`, with the fixed kernel `BLUR_SIGMA`. The direction scale `blurStep(intensity, height) = sigmaPixels × BLUR_RESOLUTION / BLUR_SIGMA` is a uniform. The blur does not premultiply again.
R12. Night vision: `rgb' = mix(c.rgb, dot(c.rgb, LUMA) × tint, alpha)`, `a' = c.a`. `tint` is the linear value of `color`.
R13. Pixelate: `block = max(1, round(intensity × height / EFFECTS_REFERENCE_HEIGHT))` drawing-buffer pixels. `uv' = (floor(uv × size / block) + 0.5) × block / size`, clamped into the frame. The result is the colour at `uv'`.
R14. Vignetting, with `aspect = width / height`:
- `d = length((uv − 0.5) × (aspect, 1)) / length((aspect, 1) × 0.5)` (0 at the centre, 1 at a corner);
- `shape = smoothstep(VIGNETTE_INNER × (1 − fadeOut), 1, d)`;
- `lid = blink > 0 ? smoothstep(1 − blink − BLINK_EDGE, 1 − blink, |2 × uv.y − 1|) : 0`;
- `s = max(alpha × shape, lid)`;
- `rgb' = c.rgb × (1 − s) + tint × c.a × s`, `a' = c.a`.

R15. Night vision, pixelate, and vignetting give (0, 0, 0, 0) for (0, 0, 0, 0), keep the alpha of their input sample, and keep `rgb ≤ a` when the input has it and the tint is at most 1. Blur keeps `rgb ≤ a` for inputs that have it. Lens dirt changes a pixel only where `add > 0`.
R16. One pure module (`camera-effects-math.ts`, no three.js import) holds the constants and the CPU reference of R8 to R14. The nodes use its constants.

### Renderer

R17. `camera-effects.ts` makes the effect nodes and their uniforms. A change of a number in `effects` or of the drawing-buffer size changes uniforms only. It does not build the chain again and does not compile.
R18. The chain order is D7. The bloom and the grade become two steps, and lens dirt goes between them. Without grading, lens dirt comes after the beams. With all effects off, the chain nodes are the same as before.
R19. `needsChain` and `chainKey` take the effects key (R9) as their last parameter, after the B34 beam flag, with the default `''`. With `''` each result is the result before this change. The chain is built again when the key changes.
R20. The renderer gets the dirt texture from the image pool of the screens, with one lease for each active dirt asset ID. Until the image loads, no dirt draws. A change of the ID releases the old lease. If the load fails, no dirt draws, and the frame acknowledgment has one warning with the image load failure message of `screen.ts` while the camera keeps that ID.
R21. The screenshot path draws the same effects in the same order on 1920 × 1080 targets, each intermediate target with an explicit size. A camera screenshot shows the effects. It uses the dirt texture when it is loaded.
R22. Blur and Pixelate scale with the drawing-buffer height (R11, R13), so the frame looks the same at `preview_v1` and `production_v1`.
R23. The effects stay on the GPU. No image readback, no JPEG or PNG encode, and no image through Tauri IPC is added to the output path.
R24. The effects apply where the grading of the camera applies. The editor viewport helpers do not change.

### Editor

R25. `sectionsFor` gives the camera section `effects` with label L0, directly after `grading`.
R26. The section shows L1 to L15 in table order, with the visibility rules under the table. Each effect is one group element with the effect label (Lens Dirt, Vignetting, Night Vision, Blur, Pixelate) as its accessible name, because "Intensity", "Color", and "Alpha" repeat.
R27. L1 options: "None" (value `''`) first, then the image records, then "Missing image" when the ID is not an image record, then "Import file…". None sets `assetId: null` and keeps Intensity and Threshold. Import file… imports one image and sets it on the camera that asked, and only on that camera.
R28. A first check of L4, L9, L12, or L14 on a camera without that key writes the L-table defaults with `enabled: true`. An uncheck changes only `enabled`. A first image on a camera without `lensDirt` writes Intensity 0.9 and Threshold 0.5.
R29. The sliders are live sliders as in the grading section (live edits during a drag, one commit at the end). The colour fields work as the light colour field.
R30. Reset marks: `lensDirt`, `lensDirtIntensity`, `lensDirtThreshold`, `vignetting`, `vignettingColor`, `vignettingAlpha`, `vignettingFadeOut`, `vignettingBlink`, `nightVision`, `nightVisionColor`, `nightVisionAlpha`, `blur`, `blurIntensity`, `pixelate`, `pixelateIntensity`. The defaults are the L-table defaults. A checkbox or L1 is a reset field of each camera. A value field is a reset field only while it shows. A reset is one `setCameraEffects`. The accessible name of a reset mark includes the effect name (for example "Blur Intensity").
R31. A rejected change shows the scene value again, as the grading fields do.
R32. UI copy is the labels and the option texts only. No helper text, no badge, and no empty state. Each label is in one constant.

### MCP and chat tools

R33. The MCP `scene_patch` description names `setCameraEffects`, the five groups, their fields, and their ranges. No tool is added. `scene_inspect` returns the group, and `camera_screenshot` shows the effects.
R34. `packages/assist` does not change.

### Documents and evidence

R35. `ARCHITECTURE.md` (Output path) describes the `effects` group, the effect steps and their place in the chain, the dirt image lease, and the screenshot. `docs/warudo-parity.md` (CAM-15) records only the verified subset, the look as "Approximate", and as "Different": no built-in dirt images, no images folder button, a separate Alpha slider.
R36. `docs/evaluation/camera-effects/headless-check.mjs` and `editor-check.mjs` are committed checks on the built pages, in the form of `docs/evaluation/image-screens/`. They prove HC0 to HC8 (section O). `docs/evaluation/camera-effects.md` records their raw results, the backend of each, the commit, and one image for each effect for the owner.
R37. The implementation run claims no macOS, WebKit, OBS, cost, or look result.

## E — Entities

- `CameraEffects`, `CameraLensDirt`, `CameraVignetting`, `CameraNightVision`, `CameraBlur`, `CameraPixelate` (TypeScript types and zod schemas in `packages/contracts/src/camera-effects.ts`; Rust structs with the `object!` macro). `DEFAULT_CAMERA_EFFECTS` (frozen, one default group for each key, `enabled: false`, `assetId: null`).
- `Camera.effects?: CameraEffects`; Rust `effects: Option<CameraEffects>` with `skip_serializing_if`.
- `PatchOp` `setCameraEffects`; Rust `PatchOp::SetCameraEffects`.
- `camera-effects-math.ts`: the constants, `activeEffects`, `effectsKey`, `dirtWeight`, `dirtUv`, `dirtCompositePixel`, `blurSigmaPixels`, `blurStep`, `nightVisionPixel`, `blockSize`, `pixelateUv`, `vignetteShape`, `blinkLid`, `vignettingPixel`.
- `camera-effects.ts`: `createCameraEffects()` with `update(effects, size, dirt)`, `lensDirt(color, size?)`, `stylize(color, active, size?)`, and `dispose()`; `createDirtSource(pool)` with `texture(assetId)` → `ScreenImage | null | 'failed'` and `dispose()`.
- `post-chain.ts`: `needsChain(mode, haze, grading, beams = false, effects = '')`, `chainKey(mode, haze, grading, beams = false, effects = '')`, `render(..., beams = null, effects = null)`.
- `screenshot.ts`: `ScreenshotRender.effects?`.
- Editor: `editor/camera-effects.ts` (`EFFECT_LABELS`, the defaults, `effectValues`, `withEffect`, `withLensDirt`); `CameraEffectsFields.svelte`; `model.setCameraEffects`; `SLIDERS` entries; the reset field IDs of R30; `imageSourceOptions` with an empty-row label.
- No new `PropertyKey`, `AddKind`, entity kind, quality profile, or MCP tool.

## A — Approach

Contracts first in TypeScript and Rust with shared vectors. Then the session operation. Then the pure math with its tests. Then the renderer module, the chain, the dirt lease, and the screenshot, with the smallest change to `post-chain.ts`, `renderer.ts`, and `screenshot.ts` on top of B34. Then the editor, the MCP description, the headless checks, and the documents. The headless checks are the evidence of D6.

## S — Structure

- `packages/contracts/src/camera-effects.ts` (new), `schema.ts`, `types.ts`, the package index; `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`; `packages/contracts/test/camera-effects.test.ts` (new); `crates/contracts/tests/camera_effects.rs` (new).
- `packages/session/src/scene-ops.ts`; `packages/session/test/camera-effects-patch.test.ts` (new).
- `packages/renderer/src/camera-effects-math.ts` (new), `camera-effects.ts` (new), `post-chain.ts`, `renderer.ts`, `screenshot.ts`; `packages/renderer/test/camera-effects-math.test.ts` (new), `camera-effects.test.ts` (new).
- `apps/desktop/src/editor/camera-effects.ts` (new), `components/CameraEffectsFields.svelte` (new), `components/Inspector.svelte`, `EditorApp.svelte`, `editor/inspector-sections.ts`, `editor/model.ts`, `editor/property-defaults.ts`, `editor/slider.ts`, `editor/screen.ts`; `apps/desktop/test/camera-effects.test.ts` (new).
- `apps/mcp/src/server.ts`; an MCP stdio integration test.
- `docs/evaluation/camera-effects/headless-check.mjs`, `editor-check.mjs` (new); `docs/evaluation/camera-effects.md` (new); `ARCHITECTURE.md`; `docs/warudo-parity.md`.

## O — Operations

1. Contracts and vectors (R1 to R7).
2. Session operation (R3).
3. Effect math (R8 to R16).
4. Renderer: nodes, chain, dirt lease, screenshot (R17 to R24).
5. Editor (R25 to R32).
6. MCP description and test (R33).
7. Headless checks (R36). Scene: no environment; one camera; one image screen with a generated opaque `#808080` image in the middle of the frame; transparent space around it. Dirt image: a generated PNG with an opaque white top-left quadrant and alpha 0 elsewhere. The OBS page runs with `?backend=webgl2`, because the headless WebGPU canvas gives an empty image. The Editor check reads the WebGPU camera screenshot.
   - HC0, baseline: no `effects`. Each pixel outside the screen is (0, 0, 0, 0).
   - HC1, Vignetting `#000000`, alpha 1, Fade Out 0, Blink 0: outside pixels stay alpha 0; each covered pixel keeps its baseline alpha (±1); covered pixels near the frame corners are darker than the baseline; the frame centre is equal (±2). Then Blink 1 with `#4c4c4c`: each covered pixel is 76 (±3) in each channel with its baseline alpha; outside pixels stay alpha 0.
   - HC2, Night Vision at its defaults: alpha equals the baseline everywhere (±1); on covered pixels G > R and G > B; outside pixels stay alpha 0.
   - HC3, Blur 4: at the screen edge there is a run of pixels with alpha between 1 and 254; their straight colour is within ±8 of the screen colour (no fringe); pixels far from the screen stay alpha 0.
   - HC4, Pixelate 64 at 1080 lines: each 64 × 64 block from the frame origin has one colour. Record the origin corner.
   - HC5, Lens Dirt with the dirt image, Intensity 1, Threshold 0: covered pixels in the top-left quadrant are brighter than the baseline; the three other quadrants equal the baseline (±2); outside pixels change only in the top-left quadrant. This also proves the image orientation.
   - HC6, all five effects on: the chain builds, and the frame acknowledgment has no `Pipeline compile failed` warning.
   - HC7, all effects off again: equal to the baseline (±1).
   - HC8, Editor window: the camera screenshot (WebGPU) with Vignetting Blink 1 and with Pixelate 64 passes the HC1 and HC4 tests; the Effects section comes after Grading; a checkbox shows its settings; L1 lists None first; Import file… sets the image on that camera only.
8. Local checks for the orchestrator, only what the headless checks cannot prove:
   - LC1 (only if HC6 or HC8 cannot build the chain on a backend): on macOS with the dev build and OBS, run HC1 to HC5 on OBS source screenshots for that backend.
   - LC2 (owner, in review): the look of each effect, from the HC images.
   - LC3 (only on owner request): the WebKit preview compiles each effect; `app_status` has no pipeline warning.
   - LC4 (only on owner request): OBS alpha over dark, light, and checker backgrounds with all five effects on.
   - LC5 (only on owner request): cost with all five effects on at `production_v1`, and continued output with the Editor minimized. GPU time is unknown.

## N — Norms

- Unit tests for the schemas, the Rust mirror, the session operation, the pure math, the chain key, the dirt lease, and the editor model functions. One integration test at the MCP stdio boundary. Committed headless checks on the built pages for the alpha math on the GPU. No test for static copy.
- Functional TypeScript and plain data. Controls come from `@oshi-connect/ui` and the existing field components.
- Long prose is Simplified Technical English. UI copy is the label only.

## S — Safeguards

- Do not change the show file version, the limits, the quality profiles, the benchmark fixture, the property registry, a Blueprint node, or `packages/assist`.
- Do not change how a camera without effects draws: with the key `''`, the chain rule and the chain are the same as before B37.
- Do not move the B34 beam pass.
- Do not read images back in the output path.
- Do not add helper text, a badge, or an empty state.
- Do not write a macOS, WebKit, OBS, cost, or look result that was not measured. Write an unavailable measurement as unknown.
- Keep each label and each constant in one place in the code, so that a correction is one edit.
