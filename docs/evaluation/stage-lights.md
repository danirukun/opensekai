# Stage lights check (B13)

Date: 2026-10-18. Contract: [stage lights](../../spdd/prompt/2026-10-18-stage-lights.md). Issues: #45 (ENV-07), #46 (ENV-08 first subset), #40 (ENV-02 ambient part).

## Setup

- **Platform.** macOS (Darwin 27.0.0, Apple silicon), debug build from `pnpm dev:desktop`, commit `f087d92`. WebGPU in WKWebView (Scene window, `preview_v1`).
- **OBS.** OBS 32.2.2 Browser Source (WebGPU, `production_v1`), with an isolated QA scene that was on program only during captures. Teardown restored the program scene. Streaming and recording stayed off.
- **Debugging only.** The output page also ran in Playwright Chromium (WebGPU and WebGL 2) to read its console. That run is not evidence for the look.
- **three.js.** 0.180.0.
- **Fixture.** The library avatar "Nina" on an 8 m box floor. Directional light at 0.2. Ambient light `#8090ff` at 0.15. Spot light `#ffd2a0`, intensity 80, range 15, cone 40° with penumbra 0.3, shadow on, Volumetric on, at (2.2, 3.6, −0.6) aimed at (0, 0.9, 0). Haze at (0, 2.5, 0), size 8 × 5 × 8, density 1, smoke 1, intensity 1, drift 0.2.
- **Method.** The scene was made with MCP `scene_patch`. Slider drags used real mouse events, read through the accessibility tree. MCP `scene_inspect` and `app_status` were read while the mouse button was still down.

## Probe (O3) and findings

The first macOS run drew the stage, the spot light, the cone helper, and the haze box, but no haze in the preview or in OBS. With the haze pass shown alone, it was black. A minimal three.js r180 page with one `VolumeNodeMaterial` box and one spot light, read back through a render target, isolated the causes.

| Case | Mean red of the volume (0–255) |
| --- | --- |
| Red `MeshBasicNodeMaterial` control | 239 |
| Spot light, no shadow, default scene lights | 0 |
| Spot light with a shadow | 33 |
| Same, with an explicit `lightsNode` | 33 |
| Same, camera on the haze layer only | 0 |
| Same, light also on the haze layer | 33 |
| Light without a shadow, haze layer, patched lighting model | 33 |

Three changes followed (contract R7a, commit `f087d92`):
- **Light layers.** Point and spot lights also enable the haze layer.
- **Shadow cameras.** Each shadow camera keeps layer 0 and the haze layer, so a shadow map drawn during the haze pass keeps its casters.
- **Lighting model.** The haze material uses a subclass of the internal r180 `VolumetricLightingModel` that skips the shadow factor for a light without a shadow.

A fourth defect was in the depth node: `texture().sample()` made a clone that the depth swap missed. Unit tests cover all four (`haze.test.ts`, `scene-lights.test.ts`).

## Results

| Check | Requirement | Result |
| --- | --- | --- |
| Spot light: cone, penumbra, range, shadow of the avatar on the floor; Spot and Ambient in the Add menu and the Inspector; cone and haze helpers in the editor only | R3, R11 to R13 | PASS |
| Ambient light replaces the fixed fill: a dark stage with a blue fill | R4 | PASS |
| Beams in the preview and in OBS; both agree when OBS is composited over the same light background as the preview checkerboard | R7, R8 | PASS. [Preview and OBS over light](stage-lights/preview-and-obs-over-light.png) |
| OBS alpha: 0 outside the scene, coverage from the haze where a beam is | R8 | PASS. Alpha histogram: 446 068 px at 0, 658 751 px at 255, the rest in between. Over a dark background a beam reads as light; over a light background it reads as a veil (Approximate). |
| Haze Intensity slider, live | R12 | PASS. 1 → 2.53 (mid-drag) → 3.76. OBS showed two clear cones during the drag. [OBS, two spots](stage-lights/obs-two-spots-haze.png) |
| Spot Angle slider, live | R12 | PASS. 40° → 9° while the thumb was down, and the warm beam narrowed in OBS. |
| Camera screenshot shows the haze | R10 | PASS. MCP `camera_screenshot` at revision 54 gave a 1920 × 1080 PNG with both beams. |
| Cost: 2 shadow spot lights, both Volumetric, and the haze | O6 | `output_main` (OBS, `production_v1`): about 60.1 frames each second, CPU 4.1 ms. `preview_main`: 60.0, CPU 5 ms. OBS render skipped frames did not change in 10 s. GPU time: not measured. |
| Continued motion with the Editor minimized | project rule | PASS. 325 frames on each output in 5.4 s. |
| WebGL 2 (Chromium, `?backend=webgl2`) | O6 | Partial. The floor, the spot shadow, and the haze draw. The avatar does not: its vertex shader uniform block exceeds `GL_MAX_UNIFORM_BLOCK_SIZE` (16 384). With the haze, the spot, and the ambient light removed, the same error stays, so this is not from B13. |
| A haze pipeline failure stops the haze until the next rebuild | R9 | Unit test only (`haze.test.ts`). |

## Example show and defaults (owner follow-up)

- The haze default intensity is now 2.5 (owner choice).
- `fixtures/shows/stage-lights.osekai` is an example stage without a character: a dim directional light, a blue ambient fill, a warm and a blue spot light (30°, shadow and Volumetric on), a haze at intensity 2.5, and a floor. The spot lights are in front at (±2.4, 3.4, 1.6) and aim at face height (0, 1.35, 0). A TS test and a Rust test (`show.rs`, the File › Open path) check that it opens.
- On macOS with OBS, with Nina added at the origin, the face is lit warm and blue, and both shadows fall behind her ([OBS](stage-lights/obs-example-show-face-lit.png)). The cones now come toward the camera, so they read as a veil in front of her more than as side beams.

## Imported stage shadows (owner follow-up, R4a)

- **Report.** On an imported Sketchfab stage (one standard material, roughness 0.3, not metallic, black emissive map), with the two spot lights of the example show and Reflections Intensity 1.43, no shadow showed on the stage floor.
- **Cause.** With Reflections Intensity 0, the spot pools and the hair and leg shadows showed, so the shadows were cast. The room map (environment import R17) added a diffuse fill and reflections of a bright white room, which hid them. With only the fill removed, the floor still mirrored the bright room at the low camera angle, and the shadows stayed faint.
- **Change.** With an ambient entity in the scene, the environment copies lose the diffuse fill of the room map, and its reflections are multiplied by the ambient light on the environment (contract R4a).
- **Result.** macOS, debug build, branch `opensekai/b13-stage-lights` after `a7b9d84`, OBS 32.2.2 (`production_v1`, isolated QA source) and the Scene preview (WebKit, `preview_v1`), both WebGPU. The owner's scene was saved with `scene_inspect` and restored with `scene_replace` after each app restart.
  - Both spot pools and their shadows show on the stage floor, under a dim blue sheen from the ambient fill `#8090ff` at 0.15 ([OBS, before and after](stage-lights/obs-imported-stage-shadows.png)). The preview matches OBS, and neither output reported a pipeline warning.
  - With the ambient entity removed, the stage floor has the bright look of before, so a scene without an ambient entity does not change.

## Open points

- **Shadow shafts.** They are hard to see with one character at these settings.
- **Not done.** Windows, a contract-length benchmark, and GPU time.
- **Dev build.** A Vite reload of the Scene window ends at "Session startup failed". Each renderer edit during this check needed a restart of the app (not new in B13).

## Tests

- `pnpm vitest run --project unit`: 982 passed. `pnpm vitest run --project integration`: 36 passed. `pnpm -r check`: no errors.
- `cargo test -p opensekai-contracts`: 62 passed, with 101 shared vectors.
- The MCP stdio integration test for spot and haze passes.
