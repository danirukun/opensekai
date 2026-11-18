# Analysis: Camera effects

Date: 2026-11-13. Scope: bundle B37, issue #172 (CAM-15). Contract: [camera effects](../prompt/2026-11-13-camera-effects.md). Depends on: [camera grading](../prompt/2026-11-10-camera-grading.md), [stage beams](../prompt/2026-11-13-stage-beams.md) (B34), and the `AppStatus.sceneId` change of B33.

## Request

Issue #172 asks for the Warudo camera effects that OpenSekai does not have: Lens Dirt, Vignetting, Night Vision, Blur, and Pixelate. Each effect must keep the transparent OBS output correct.

## Sources

| Source | What it gives | Status |
| --- | --- | --- |
| Warudo 0.15.1 in the QA VM (`warudo-vm/findings.md`, section B, images 12 and 13) | The section order, each label, each default, each range, and the Lens Dirt texture list | Read on 2026-11-13 |
| Warudo handbook, camera page (`docs.warudo.app`) | Lens Dirt "simulates dirt and specks on the lens". Threshold "controls the lower limit of the brightness of the image that will emit a lens dirt effect". An image of "Vignetting enabled with blink" | Read on 2026-11-13. No formula |
| Parity audit of 2026-10-17 (`docs/warudo-parity.md`, CAM-15) | The row is "Missing" | Read |
| three.js 0.187.0 source (`examples/jsm/tsl/display/`) | `gaussianBlur`; `lensDirt.js` (only its UV fit rule is useful, because it returns alpha 1); `CRT.js` (its vignette is RGB only); `PixelationPassNode` (a scene pass with edge lines, not a screen effect) | Read |

### Warudo values (owner decision 4)

| Effect | Setting | Default | Range | Note |
| --- | --- | --- | --- | --- |
| Lens Dirt | Texture | None | None, local files, built-in images | None is off. No Enabled toggle |
| Lens Dirt | Intensity | 0.9 | 0–1 | Shows only while a texture is set |
| Lens Dirt | Threshold | 0.5 | 0–1 | Shows only while a texture is set |
| Vignetting | Enabled | off | — | |
| Vignetting | Color | RGBA (0.298, 0.298, 0.298, 0.051) | not HDR | The alpha sets the strength |
| Vignetting | Fade Out | 0 | 0–1 | No description |
| Vignetting | Blink | 0 | 0–1 | No description |
| Night Vision | Enabled | off | — | |
| Night Vision | Color | RGBA (0.502, 1, 0.502, 0.502) | not HDR | The alpha has no description |
| Blur | Enabled | off | — | |
| Blur | Intensity | 1 | 0–4 | |
| Pixelate | Enabled | off | — | |
| Pixelate | Intensity | 16 | 1–256, whole numbers | |

Warudo also has an "Open Images Folder" button and built-in images (for example `Icons/Arrow.png`) in the Texture list. OpenSekai has no images folder and no built-in images (owner decision 3).

## Current state

- **Post chain.** `packages/renderer/src/post-chain.ts` builds one three.js TSL `PostProcessing` chain. The colour is premultiplied half-float RGBA. After B34 the order is: scene pass, haze, beams, bloom, grade, output transform, FXAA. `needsChain(mode, haze, grading, beams)` decides if the chain draws. `chainKey(...)` decides when the chain is built again. A change of a mode builds the chain again and compiles; a change of a number sets only a uniform.
- **Alpha rules in use.**
  - Additive light with coverage (haze, beams, bloom): `a' = a + (1 − a) · saturate(max(add.rgb))`, `rgb' = rgb + add.rgb`.
  - The grade (`grading.ts`): unpremultiply, change, clamp 0–1, premultiply. A pixel with alpha 0 stays (0, 0, 0, 0).
  - Known limit: a pixel with partial alpha shows darker over a light OBS background with the default blending.
- **Bloom and grade.** The bloom and the grade are one block in `build` (`if (grading) { bloom; grade }`).
- **Screenshot.** `packages/renderer/src/screenshot.ts` repeats the chain on 1920 × 1080 offscreen targets. Each intermediate target needs an explicit size, as the bloom does (`grading.bloom(color, size)`).
- **Camera data.** The camera entity has `lens`, `renderEnvironment?`, `antiAliasing?`, `grading?`, `navigation?` (`schema.ts:239-246`, `lib.rs:560-572`). Rust omits each missing optional group, so an old show saves with the same bytes.
- **Image assets.** An imported image has an `image_` ID. The renderer loads it through `createScreenImagePool` and `loadScreenImage` (`renderer.ts:92`, `screen.ts:142`): an sRGB texture with straight alpha, `flipY = false`, limited to `maxTextureSize`. The Editor picks an image with `imageSourceOptions` (`editor/screen.ts:5`) and imports one with `chooseImage` (`EditorApp.svelte:134`), which today always calls `setScreenImage`.
- **Editor.** The camera Inspector sections are Transform, Rendering, Grading, Lens, Control, Screenshot (`inspector-sections.ts:10`). `CameraGradingFields.svelte` is the model for a group of live sliders with reset marks. `ColorField.svelte` accepts `#rrggbb` only. It has no alpha.
- **Quality profiles.** `quality.ts` sets the resolution scale, the texture limit, and MSAA. A frozen profile needs a new ID for a change. No profile has an effect.
- **MCP.** The `scene_patch` description (`apps/mcp/src/server.ts:7`) does not name `setCameraGrading` or `setCameraAntiAliasing`.
- **Blueprint.** `PROPERTY_KEYS` has no camera effect key.

## Decisions

### Owner (2026-11-13)

1. One "Effects" section in the camera Inspector, after Grading. Lens Dirt is an image picker, and None is off. Vignetting, Night Vision, Blur, and Pixelate each have a checkbox, and each shows its settings only while it is checked.
2. Vignetting darkens only the pixels that the scene covers. Alpha does not change. Rejected: add coverage at the corners.
3. No default lens dirt texture. The user picks an imported image. Rejected: ship a CC0 texture.
4. Labels, defaults, and ranges come from Warudo 0.15.1 (the table above). OpenSekai defines the math and marks it as its own choice. A setting without a clear meaning gets a reversible interpretation with its alternative. The parity row can say "Approximate" for the look.
5. No Blueprint target in this slice. A follow-up issue covers hotkey and graph control.
6. A headless proof of the alpha math of each effect is enough to open the pull request. The owner judges the look in review. The orchestrator runs the macOS app only if the headless render cannot build the chain.

### Integrator (2026-11-13)

- The chain order is fixed: lens dirt, grade, blur, night vision, pixelate, vignetting, FXAA.
- One optional camera group `effects`, with one optional key for each effect. One patch operation `setCameraEffects`, mirrored in Rust.
- The quality profiles do not change. The benchmark fixture keeps each effect off.
- One pull request on `claude/b37-camera-effects`. The first commit holds this analysis and the contract.
- B33 and B34 merge first. B37 rebases on both.
- B35 and B36 are deferred. The camera schema change is the `effects` group only.

### The order with B34

B34 puts the beam pass after the haze and before the bloom (B34 R12). The bloom is inside the grading block. Lens dirt must use the bloomed colour and come before the grade, so B37 splits the grading block in two: the bloom, then the lens dirt, then the grade. The full order is:

scene pass, haze, beams, bloom, **lens dirt**, grade, **blur**, **night vision**, **pixelate**, **vignetting**, output transform, FXAA.

The integrator order holds. The beam pass does not move.

### Interpretations (reversible)

Warudo gives no formula. These are OpenSekai choices. The contract lists each one with its alternative.

| Setting | Chosen meaning | Alternative |
| --- | --- | --- |
| Vignetting Color, RGB | The colour that the frame edge goes to | — |
| Vignetting Color, alpha | The strength at the frame corner. 0.051 gives a light effect | A fixed strength, with the alpha as the opacity of the colour only |
| Vignetting Fade Out | The width of the soft edge: 0 starts the darkening at half of the distance to the corner; 1 starts it at the centre | A fade of the vignette toward the centre over time |
| Vignetting Blink | A lid that closes from the top and the bottom edges: 0 is open, 1 is closed. The lid uses the RGB at full strength | A periodic blink animation |
| Night Vision Color, RGB | The tint of the luminance | — |
| Night Vision Color, alpha | The mix between the original image and the tinted image. 0.502 gives about a half mix | A gain on the tinted image |
| Night Vision noise | No noise. Warudo has no noise control | A fixed grain |
| Blur Intensity | A Gaussian sigma of `3 × Intensity` pixels of a 1080-line frame, so the look does not depend on the profile | A sigma in pixels of the drawing buffer |
| Pixelate Intensity | The block size in pixels of a 1080-line frame. 1 is no change | The number of blocks across the frame |
| Lens Dirt Threshold | The luminance where the dirt starts to show, with a soft knee of 0.25 | A hard cut |
| Lens Dirt Intensity | A gain on the dirt light | — |
| Lens Dirt light | A blurred bright pass at a quarter of the resolution, multiplied by the dirt image | The bloom texture of the grading block (it is absent when no grading exists) |
| RGBA colour in the data | Two fields: `color` (`#rrggbb`, as a light) and `alpha` (0–1). The Inspector shows "Color" and "Alpha" | One `#rrggbbaa` field and a new colour control with alpha |

## Alpha behaviour

| Effect | Colour | Alpha |
| --- | --- | --- |
| Lens Dirt | Adds light | The coverage rule of the bloom. Dirt light can cover a transparent pixel near a bright area |
| Blur | A Gaussian sum of premultiplied RGBA | Blurs. An edge gets a soft alpha without a dark or a light fringe |
| Night Vision | A mix with `lum(rgb) × tint` on premultiplied values | No change |
| Pixelate | Each block takes the premultiplied RGBA of its centre pixel | Blocks. Each pixel stays a valid premultiplied colour |
| Vignetting | `rgb · (1 − s) + tint · a · s` | No change. A pixel with alpha 0 stays (0, 0, 0, 0) |

Night Vision, Pixelate, and Vignetting keep `rgb ≤ a` for a colour that had it, and keep (0, 0, 0, 0) for a transparent pixel. Lens Dirt and Blur spread light or coverage on purpose.

## Cost

- Lens Dirt: one bright pass and a two-direction Gaussian at a quarter of the resolution.
- Blur: a two-direction Gaussian at half of the resolution with a fixed 11-tap kernel. The strength changes the tap distance, not the kernel, so a slider drag does not compile again.
- Night Vision and Vignetting: arithmetic in one pass.
- Pixelate: one texture read at a snapped UV.
- With each effect off, the chain is the same as before. The benchmark fixture has no `effects` group, so the benchmark does not change.
- A checkbox change builds the chain again and compiles. That can cause one slow frame. The follow-up issue for Blueprint control must deal with it.

## Risks

- **WebKit and WebGPU compile.** Headless Chromium proves the WebGL 2 OBS page and the WebGPU screenshot path. It cannot prove the Tauri WebKit preview. The orchestrator checks it only if the owner asks or the headless check cannot build the chain.
- **Texture orientation.** The dirt image has `flipY = false`. The headless check uses an image with one bright quadrant to prove the orientation on both backends.
- **Blur steps.** At Intensity 4 the tap distance is 1.5 texels of the half-resolution target. This can show bands. The owner judges the look.
- **Image change.** The dirt asset ID is in the chain key, so a new image builds the chain again. This avoids the texture binding problem that `screen.ts` describes.

## Out of scope

- Blueprint, hotkey, or graph control of the effects (follow-up issue).
- Built-in dirt images and an images folder button.
- A colour control with alpha.
- Chromatic Aberration and the other Warudo camera sections.
- A change of the quality profiles, the benchmark fixture, or the property registry.
- B35 and B36 camera fields.
