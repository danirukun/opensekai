# Quality controls and production quality profiles analysis

Date: 2026-10-16. Scope: bundle B8 (#56 CAM-08 first subset, #72 SHOW-05 first subset).

## Problem

1. **Anti-aliasing (#56).** Each renderer is made with `antialias: true`. Thus every output uses 4× MSAA, and the operator cannot change it. A Warudo camera has an anti-aliasing setting. Warudo uses Unity URP, where a camera selects a post-process anti-aliasing mode (None, FXAA, SMAA, or TAA) and the pipeline quality sets the MSAA sample count. OpenSekai has no post-process anti-aliasing. MSAA does not smooth edges inside alpha-tested materials (for example hair cards), so a camera-level post filter is the first useful control.
2. **Quality profiles (#72).** The benchmark contract asks for "a versioned quality profile with explicit shadows, resolution scale, effects, LOD, and preview rate". Each run record must name the profile. Today the code has no profile. The Scene preview passes `resolutionScale: 0.5`, and the renderer derives a texture limit from that scale. The OBS page reads an unused `?scale=0.5` parameter. The evaluation records say "No quality profile was selected" or describe the values by hand.

## Decisions

- **Quality profile is a renderer-client setting, not a show setting.** One show feeds the Scene preview and the OBS page at the same time, and these need different quality. A profile is chosen when a renderer client starts. It is not in the `.osekai` file. The show format does not change.
- **Profiles are versioned constants in `@opensekai/contracts`.** Each profile has an ID with a version suffix and explicit values: `resolutionScale`, `maxTextureSize`, and `msaaSamples`. A changed value needs a new ID. The first set:
  - `preview_v1`: scale 0.5, textures at most 1024 pixels, MSAA 4. This is the current Scene preview.
  - `production_v1`: scale 1, textures at most 2048 pixels, MSAA 4. This is the current OBS output and the default.
  - `performance_v1`: scale 1, textures at most 1024 pixels, MSAA off. This is for a lower hardware tier. It keeps the 1920 × 1080 output size so that OBS does not scale the source.
- Shadows, LOD, effects, and preview rate are not in a profile yet. The renderer has no shadows, no LOD, and no effects to control. Add a field when the renderer gets the feature, under a new profile version.
- **The OBS page reads `?quality=<id>`.** A missing or unknown value gives `production_v1`. The editor Output panel has a Quality select. It changes only the copied OBS URL. `production_v1` adds no parameter, so the URL of an existing OBS source stays valid. The unused `?scale` parameter is removed.
- **Each frame acknowledgment names the profile.** `FrameApplied` gets an optional `qualityProfile`. Thus `appStatus` (editor and MCP) and capture metadata show the profile of the connected output. Old renderers that do not send it stay valid.
- **Anti-aliasing is a camera setting, as in Warudo.** The camera gets an optional `antiAliasing: 'none' | 'fxaa'`. A missing value is `none`, which is the current look. The patch operation `setCameraAntiAliasing` changes it. The editor Inspector shows an Anti-aliasing select for a camera. MCP uses `scene_patch` with the same operation.
- **The renderer applies the output camera's mode with three.js TSL post-processing.** For `fxaa`, it renders the scene pass, applies the output color transform, then the filter (as in the three.js FXAA example). For `none`, it renders directly as today. FXAA samples RGBA, so the transparent background stays transparent and the alpha edge is smoothed too.
- **SMAA is not in this slice.** The first implementation had SMAA. The headless Chromium check showed that the three.js r180 `SMAANode` makes the whole output opaque (alpha 255 at every pixel). Its `updateBefore` resets the renderer clear color to opaque black, and the scene pass that feeds it renders in that state. Two workarounds (alpha from the unfiltered pass, and SMAA on the pass texture before the color transform) gave the same opaque result. A transparent OBS output is an acceptance requirement, so the mode is removed. Add it back when a three.js release or a local filter keeps alpha.
- **TAA is deferred.** It needs motion vectors and history, and it can ghost on fast avatar motion.

## Effects

- An operator can choose FXAA per camera, and the choice goes into the show with the camera. A camera cut changes the mode with the camera.
- An OBS source can use a lower-cost profile without a code change, and each run record can name the profile from `appStatus`.
- The wire API gets one optional camera field, one patch operation, and one optional acknowledgment field. Old shows load without change.

## Risks

- FXAA finds edges from color luminance. An edge between a dark surface and the transparent background (RGB 0) has low contrast, so the filter can leave it aliased. MSAA still covers geometry edges.
- The post-processing pass adds one full-screen render target. The cost on macOS and in OBS is not measured here. It stays unknown until the owner runs the local checks.
- The filter is checked only on WebGL 2 with a software rasterizer in the cloud. WebGPU behavior is not checked.

## Out of scope

SMAA, TAA, bloom and other post effects (MAT-07), shadows, LOD, preview rate control, a persisted editor profile choice, and benchmark profile IDs (`webgpu_smoke_v1`), which name a backend and a fixture, not a quality profile.
