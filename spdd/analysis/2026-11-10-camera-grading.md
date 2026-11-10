# Camera color grading, tone mapping, and bloom analysis

Date: 2026-11-10. Scope: #54 CAM-06, slice 1 (tone mapping, exposure, brightness, contrast, vibrance, tint, and bloom). The LUT texture is slice 2.

## Problem

1. **No color control (#54).** A Warudo camera has a grading group: a LUT texture, ACES tonemapping, vibrance, contrast, brightness, and tint (UI audit 0.15.1), and a bloom effect. OpenSekai draws each camera with no tone mapping and no grading. An operator cannot match the look of a Warudo scene, and bright light sources clip to white.
2. **The visual benchmark needs bloom.** The Bonnie scene spike (#240, [findings](../../docs/superpowers/specs/2026-10-28-bonnie-scene-spike.md)) lists bloom (threshold 0.76, intensity 0.98) as a gap of the render path.
3. **The output is transparent.** The OBS source is a premultiplied-alpha image. A color operation on a premultiplied pixel changes the edge color, and a glow outside the geometry has no coverage. Each effect must keep a valid premultiplied pixel, and a pixel far from geometry and glow must stay at alpha 0.

## Current state

- `post-chain.ts` holds one TSL `PostProcessing` chain for FXAA and haze. Without FXAA and haze, the renderer draws directly to the canvas. `screenshot.ts` repeats the chain on offscreen targets.
- The scene pass is a half-float target, so values above 1 are available to a later pass.
- The renderer does not set `toneMapping`. The output transform converts the working color space to sRGB and nothing else. three.js 0.187 `RenderOutputNode` removes the alpha premultiplication before that conversion and applies it again after.
- three.js 0.187 has TSL nodes for bloom (`BloomNode`), the tone mapping curves, and vibrance.

## Decisions

- **Grading is a camera setting, as in Warudo.** The camera gets one optional group, `grading`. A camera cut changes the look with the camera. A missing group draws as today, with no change of a pixel and no extra pass.
- **One group, one patch operation.** `setCameraGrading` sets the full group or removes it (`null`). The group is one JSON object in the show (constitution principle VII). The editor sends the full group on each change, as it does for haze.
- **Tone mapping modes: `none`, `aces`, `neutral`.** `aces` is the Warudo option. `neutral` (Khronos PBR Neutral) keeps the base colors of a toon material, which ACES makes less saturated. Alternative: only `none` and `aces`. AgX is not offered: it changes saturated colors more than ACES, and no reference scene asks for it.
- **Exposure is in stops** (−4 to 4, default 0). The linear color is multiplied by 2^exposure before the tone mapping curve.
- **Grading order.** Bloom is added in linear light before exposure. Then exposure, the tone mapping curve, brightness, contrast, vibrance, and tint, in that order, on the color without the alpha premultiplication. Then the color is premultiplied again and goes to the existing output transform and FXAA.
  - Brightness multiplies the color by 1 + brightness (−1 to 1).
  - Contrast is a power curve about middle gray 0.18: `0.18 · (c / 0.18)^(1 + contrast)` (−1 to 1). The pivot does not move, and a value of 0 is the identity.
  - Vibrance uses the three.js function (−1 to 1). Tint multiplies by a color (`#rrggbb`, default white).
- **Bloom keeps the alpha valid.** The bloom color is added to the premultiplied scene color. Its brightest channel becomes coverage: `alpha = a + (1 − a) · max(bloom.rgb)`. This is the rule that the haze uses (B13 R8). A glow over the transparent background is then a valid premultiplied pixel, and OBS shows it over the layers below. Bloom has Intensity (0 to 4, default 0, which is off), Threshold (0 to 4, default 0.8), and Radius (0 to 1, default 0.4).
- **Numbers are uniforms.** A slider change sets a uniform and does not build the chain again. The chain is built again only when the tone mapping mode changes or the bloom or the grading goes on or off.
- **A neutral group needs no chain.** When each value is at its default, the renderer draws as for a missing group.
- **Screenshots use the same function** for the grading, so a screenshot and the output agree.
- **A CPU reference of the color math** (`grading-math.ts`) gives a unit-testable definition, and the headless render check compares GPU pixels with it.

## Effects

- An operator can set exposure, a tone mapping curve, brightness, contrast, vibrance, tint, and bloom for each camera, in the Inspector, with MCP `scene_patch`, and in the show.
- The wire API gets one optional camera field and one patch operation. Old shows load without change.

## Risks

- Bloom adds 12 small passes (one high pass, 10 blur passes, one composite). The cost on macOS and in OBS is not measured here.
- The bloom coverage rule makes a glow over a transparent background more opaque than a physically additive light. OBS has no additive alpha, so this is the accepted approximation, as for haze.
- A toon material gives colors at or below 1, so only a threshold below 1 makes it glow. The default threshold 0.8 follows the Bonnie scene value (0.76).
- The check runs on software adapters in the cloud. Visual quality and frame cost are unknown until the owner runs the local checks.

## Out of scope

The LUT texture (slice 2: it needs a decision on the LUT file format and the asset kind), white balance, vignette, film grain, ambient occlusion, depth of field, flares, chromatic effects (CAM-07), post-processing volumes (MAT-07), separate character and environment bloom (MAT-05), Blueprint property targets for the grading, and a grading for the editor viewport camera.
