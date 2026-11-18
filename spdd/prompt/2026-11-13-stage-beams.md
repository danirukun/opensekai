# REASONS: Stage beams

Date: 2026-11-13. Scope: bundle B34 (#46 ENV-08, second subset). Analysis: [stage beams](../analysis/2026-11-13-stage-beams.md). Depends on: [stage lights](2026-10-18-stage-lights.md). Changes: stage lights R8 (the chain), R10 (the screenshot), R12 (one label).

The owner approved the decisions below on 2026-11-13. "Stage lights" is the contract of 2026-10-18, which calls itself bundle B13; it is not the queue row B13.

## Decisions

| # | Decided | Rejected alternative |
| --- | --- | --- |
| D1 | A cone beam on each spot light, in its own pass at half resolution, with a fixture show and cost evidence | Evidence only for the haze; beams above the light limit |
| D2 | The target is 8 beams, the light limit. A larger rig is a follow-up issue. (Changed by [light limits](2026-11-17-light-limits.md) R2, R12: at most 32 beams; the beam pool grows on demand.) | A higher limit or a beam entity kind in this bundle |
| D3 | Explicit controls (labels L1 to L3) in the Light section, after Penumbra; the sliders show only while the beam is on | No control: the `volumetric` switch draws a cone when no haze exists |
| D4 | The beam follows the color and the Intensity of its light | A brightness that does not depend on the light |
| D5 | The existing checkbox gets label L4. The data field `volumetric` does not change | Keep the label "Volumetric" |
| D6 | Add › Spot Light makes a light with the beam off. The fixture show has 8 beams on | Beam on for a new Spot Light |
| D7 | No GPU time in this bundle. `gpuMs` stays unknown and gets a follow-up issue | GPU timestamp queries in this bundle |
| D8 | The orchestrator runs the macOS and OBS checks (LC1 to LC10). The owner judges the look in review | The implementation run claims them |
| D9 | The quality profiles do not change. The chat tools keep the haze rig | A beam setting in a profile; a beam from `light_set` |
| D10 | One pull request. The first commit holds the analysis and this contract | A contract pull request first |

## Labels and ranges

This table is the one place for each label and range. A requirement refers to a row by its ID.

| ID | Label | Control | Data | Range, step, default |
| --- | --- | --- | --- | --- |
| L1 | Beam | checkbox | `light.beam.enabled` | default off |
| L2 | Beam Intensity | live slider with number field | `light.beam.intensity` | 0–4, step 0.01, default 1 |
| L3 | Beam Softness | live slider with number field | `light.beam.softness` | 0–1, step 0.01, default 0.5 |
| L4 | Scatter In Haze | checkbox (exists) | `light.volumetric` | no change |

## Constants

| Name | Value | Use |
| --- | --- | --- |
| `BEAM_LAYER` | 11 | The three.js layer of the beam meshes (`HAZE_LAYER` is 10) |
| `BEAM_RESOLUTION` | 0.5 | The beam pass size as a part of the drawing buffer |
| `BEAM_REFERENCE_INTENSITY` | 60 | The light Intensity at which the gain equals L2 (the default spot Intensity) |
| `BEAM_MAX_GAIN` | 4 | The gain limit |
| `BEAM_DEFAULT_LENGTH` | 5 m | The length when the Range is 0 (equal to `SPOT_HELPER_LENGTH`) |
| `BEAM_MAX_ANGLE` | 120° | The largest full cone angle of the beam |
| `BEAM_BASE` | 0.5 | The factor of the beam value |
| `BEAM_NEAR_FADE` | 0.5 m | The distance from the camera at which the near fade is 1 |
| `BEAM_DEPTH_FADE` | 0.3 m | The distance in front of a surface at which the depth fade is 1 |

## R — Requirements

### Schema

R1. `LightSettings` gets one optional group `beam: { enabled: boolean, intensity: 0..4, softness: 0..1 }`. The group is strict: an unknown field is rejected. `beam.enabled: true` is valid only when the type is `spot`. A group with `enabled: false` is valid for each type and draws nothing. A missing group means no beam.
R2. TypeScript (zod) and Rust accept and reject the same shapes, with shared vectors: a spot light with a beam (accept), a spot light with `enabled: false` (accept), a point light with `enabled: true` (reject), an intensity of 4.01 (reject), a softness of −0.01 (reject), an unknown field in the group (reject), and a stage lights spot light without the group (accept).
R3. Rust omits the group when it is missing, so a show without a beam saves with the same bytes as before. The show file version does not change.
R4. No new patch operation. `setLight` replaces the light group. A `setLight` that gives a point light `beam.enabled: true` fails with `INVALID_INPUT` and does not change the scene.
R5. The limits do not change (8 lights, 2 shadow lights, 1 haze). A beam is not a light and is not a haze. The quality profiles do not change.
(Changed by [light limits](2026-11-17-light-limits.md) R2: 32 lights, 8 lit lights, 2 shadow lights, and 1 haze.)

### Beam values (pure functions)

R6. A beam draws for a light when the entity is visible, the type is `spot`, `beam.enabled` is true, and the gain is more than 0.
R7. The cone: the apex is at the light position, and the axis is the local −Z axis. The length is the Range, or `BEAM_DEFAULT_LENGTH` when the Range is 0. The cone angle is the smaller of `cone.angleDegrees` and `BEAM_MAX_ANGLE`. The end radius is `length × tan(angle / 2)`.
R8. The gain is `min(BEAM_MAX_GAIN, beam.intensity × light.intensity / BEAM_REFERENCE_INTENSITY)`. The beam color is the linear light color × the gain.
R9. The beam value at a point of the cone surface is `color × BEAM_BASE × axis × edge × near × depth`, where:
- `axis = (1 − t)²`, and `t` is the distance along the axis divided by the length (0 at the light, 1 at the end);
- `edge = c ^ (0.25 + 3.75 × softness)`, and `c` is the absolute cosine of the angle between the surface normal and the view direction;
- `near = saturate(d / BEAM_NEAR_FADE)`, and `d` is the distance from the camera in meters;
- `depth = saturate(g / BEAM_DEPTH_FADE)`, and `g` is the distance in meters from the point to the scene surface behind it along the view ray. A point behind a scene surface has `depth = 0`.

One pure module (`beam-math.ts`) holds these functions and constants. It is the CPU reference of the material, and the material uses its constants.

R9a. The surface normal of R9 `edge` is the exact normal of the cone surface. The material calculates it in each fragment from the local position, `normalize(x, y, √(x² + y²))` in the cone space of R7 (`beamConeNormal`). It then transforms it to view space with the normal matrix. The interpolated vertex normal is not used.

Cause (the 2026-11-17 macOS check, `docs/evaluation/stage-beams/banding-obs.png`): the beam showed vertical bands in OBS. three.js r187 makes a cone with a top radius of 0 from one triangle per segment, and the apex vertex of that triangle has the normal of the next segment. The interpolated normal is therefore discontinuous at each segment edge, and the step increases toward the apex. The capture agrees with this cause, not with 8-bit quantization. On a row of the capture, the values are flat for 10 to 28 px, and adjacent flat runs differ by 3 to 8 levels, not by 1. The row nearer the apex has 83 runs, and the row farther from the apex has 39. A row has about 24 bands, which is 48 segments / 2, because a front segment edge and a back segment edge project to the same place. The center band is 26 px wide; the 7.5° segment angle predicts about 28 px.

R9b. A beam has no visible banding. Check: in the OBS output, the bands of the capture above are gone at the Wide camera of the fixture show (LC4), and a row through a beam has no flat runs with steps of more than 2 levels. The unit test of `beamConeNormal` makes sure that the normal is perpendicular to the cone surface and is continuous across a segment edge.

### Renderer

R10. Each drawn beam is an open cone mesh on `BEAM_LAYER` only. Both faces draw. The material is unlit and additive, with no depth test and no depth write. A beam mesh does not cast or receive a shadow. The scene pass, the haze pass, and each shadow pass do not draw it. It is not a pick target in the editor viewport.
R11. A change of the beam values, the light color, the Intensity, the Range, the Angle, the transform, the visibility, or the number of drawn beams changes uniforms, attributes, or object visibility only. It does not build the light node sets again (`lightSignature` does not include the beam) and does not recompile a material.
R12. When at least one beam draws, the renderer draws through the post chain. The beam pass comes after the haze composite and before the bloom:
- a pass of `BEAM_LAYER` at `BEAM_RESOLUTION` of the drawing buffer, with no depth buffer, no MSAA, and no blur;
- the composite of stage lights R8 (`hazeComposite`) with intensity 1.

The order of the full chain is: scene pass, haze, beams, bloom, grade, output transform, FXAA.
R13. `needsChain` and `chainKey` take a beam flag as their last parameter, with the default `false`. With the flag `false` each result equals the result before this change. The chain is built again when the flag changes, and not when a beam value changes.
R14. The beam material reads the scene pass depth (R9 `depth`). An object in front of a beam hides it, and a beam has no hard line where it meets a surface.
R15. If a render pipeline fails to compile on WebGPU while a beam draws, the renderer stops the beams until the next light node-set rebuild. The frame acknowledgment carries the existing `UNSUPPORTED Pipeline compile failed` warning. The scene, the lights, the shadows, and the haze still draw.
R15a. The renderer finds the pass that failed from each failure report one time only, in the first frame after the report arrives (`pipeline-blame.ts`). The `Pipeline compile failed` warning stays until the rebuild, as before. The rules:
- A report that arrived before the frame does not stop a pass. An earlier failure (for example, an avatar material on WebKit) therefore does not stop a beam that the user switches on later.
- A report with a pipeline label that failed before does not stop a pass.
- A report whose pipeline label names the beam material (`renderPipeline_beam_`) stops the beams only.
- Each other new report goes to the passes (haze, beams) that drew in that frame or in the frame before. If both drew, it goes to the pass that started to draw later. If both started in the same frame, it goes to both.

Reason: the report does not always tell which pass failed. The chain composite is one pipeline for the haze and the beams, and its label names neither. The pass that started later made the new pipelines. A beam that fails while a haze draws without failure stops only the beams. This rule also applies to the haze of B13. A haze stops only for a new failure.
R16. The screenshot path draws the same beam pass at `BEAM_RESOLUTION` of 1920 × 1080, in the same order, so a camera screenshot shows the beam.
R17. The editor viewport helpers do not change. No helper and no beam draws that the output does not draw.
R18. The beam stays on the GPU. No image readback, no JPEG or PNG encode, and no image through Tauri IPC is added to the output path.

### Editor

R19. The Light section of the Inspector shows, for a spot light only, after Penumbra and before L4: the checkbox L1, and, only while `beam.enabled` is true, the sliders L2 and L3. The sliders are live sliders as the other light sliders (live edit during a drag, one commit at the end).
R20. The first switch-on of L1 on a light without the group writes `{ enabled: true, intensity: 1, softness: 0.5 }`. A later change of L1 changes only `enabled` and keeps the other values.
R21. The existing checkbox for point and spot lights has the label L4. Its data field, its default, and its reset behavior do not change.
R22. Add › Spot Light makes a light without a `beam` group, with `volumetric: true` as before.
R23. A type change away from Spot removes the `beam` group. A type change to Spot gives no `beam` group.
R24. Reset marks: `beam` (default off), `beamIntensity` (default 1), and `beamSoftness` (default 0.5). `beam` is a reset field of each spot light. The other two are reset fields only while the beam is on. A reset is one `setLight`.
R25. A rejected change shows the scene value again, as the other light fields do.
R26. UI copy is the four labels only. No helper text, no badge, and no empty state.

### MCP and chat tools

R27. The MCP `scene_patch` description names the `beam` group, its three fields, their ranges, and the spot-only rule. No tool is added. A `scene_patch` with `setLight` sets a beam, and `scene_inspect` returns it.
R28. `packages/assist` does not change.

### Fixture show

R29. `fixtures/shows/stage-beams.osekai` is a valid show on both sides (the TypeScript `ShowDocumentSchema` and the Rust show-open path). It has:
- the environment `stage` with the test stage library ID (`scene_6eb170021aa3c791a7f1665b25076754f9d2c2262568f9fdd720b6c4f381d1ee`);
- no directional light and no ambient light, because the 8 spot lights use all of the light limit (`LIMITS.lights` is 8), and a show with 10 lights is not valid;
- 8 spot lights, each with `beam: { enabled: true, intensity: 1, softness: 0.5 }`, no `volumetric` field, Range 12, Angle 14°, Penumbra 0.4; 2 of them have a shadow;
- the cameras Wide (output), Stage, and Close;
- no character, no haze, and no Blueprint.

The positions, the aim points, and the colors are in the plan. The −Z axis of each spot light passes within 0.05 m of its aim point.
(Changed by [light limits](2026-11-17-light-limits.md) R18: the show gets `light_main` and `stage_ambient`, and the four `beam_back_*` spot lights have all affect flags off.)

### Documents and evidence

R30. `ARCHITECTURE.md` (output path) describes the beam group, the beam layer, the beam pass and its place in the chain, and the screenshot. `docs/warudo-parity.md` (ENV-08) records only the verified subset and names the label change.
R31. `docs/evaluation/stage-beams.md` records the source checks with raw counts, and one row for each local check LC1 to LC10 with the result "not checked" until the orchestrator fills it. GPU time is written as unknown, never as 0.
R32. The implementation run claims no macOS, OBS, cost, alpha, or look result.

## E — Entities

- `LightBeam = { enabled: boolean; intensity: number; softness: number }`. `LightSettings.beam?: LightBeam`. zod: `LightBeamSchema`. Rust: `LightBeam`, and `LightSettings { beam: Option<LightBeam> }`.
- `beam-math.ts` (renderer, no three.js import): the constants, `beamDraws(entity)`, `beamShape(light) → { length, radius }`, `beamGain(light)`, `axisFade(t)`, `edgeFade(c, softness)`, `nearFade(d)`, `depthFade(g)`.
- `beam.ts` (renderer): `BEAM_LAYER`, `beamLayers()`, and `createBeams() → Beams`, with `root`, `update(entities) → boolean` (true when at least one beam draws), `setDepth(texture)`, and `dispose()`.
- `post-chain.ts`: `needsChain(mode, haze, grading, beams = false)`, `chainKey(mode, haze, grading, beams = false)`, and `render(scene, camera, mode, haze, grading, beams = null)`.
- `screenshot.ts`: `ScreenshotRender.beams?: Beams | null`.
- Editor: `BEAM` (the default group) in `editor/lights.ts`; `SLIDERS.beamIntensity` and `SLIDERS.beamSoftness`; the reset field IDs `beam`, `beamIntensity`, `beamSoftness`.
- No new `PatchOp`, `PropertyKey`, `AddKind`, entity kind, or MCP tool.

## A — Approach

Contracts first in TypeScript and Rust with shared vectors. Then the pure beam functions with their tests. Then the renderer module, the chain pass, and the screenshot pass, with the smallest possible change to `post-chain.ts`, `renderer.ts`, and `screenshot.ts`, because B37 rebases on them. Then the editor, the MCP description, the fixture show, and the documents. The orchestrator runs the local checks on macOS after the renderer commit (LC1 to LC3 as an early probe) and after the last commit (all).

## S — Structure

- `packages/contracts/src/schema.ts`, `types.ts`; `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`; `packages/contracts/test/stage-beams.test.ts` (new); `crates/contracts/tests/stage_beams.rs` (new).
- `packages/session/test/beam-patch.test.ts` (new). No session source change is expected.
- `packages/renderer/src/beam-math.ts` (new), `beam.ts` (new), `post-chain.ts`, `renderer.ts`, `screenshot.ts`; `packages/renderer/test/beam-math.test.ts` (new), `beam.test.ts` (new).
- `apps/desktop/src/components/LightFields.svelte`, `editor/lights.ts`, `editor/slider.ts`, `editor/property-defaults.ts`; `apps/desktop/test/stage-beams.test.ts` (new).
- `apps/mcp/src/server.ts`; `apps/mcp/test/stage-lights.integration.test.ts`.
- `fixtures/shows/stage-beams.osekai` (new); `apps/desktop/src-tauri/src/show.rs` (the show-open test list).
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/stage-beams.md` (new).

## O — Operations

1. Contracts and vectors (R1 to R5).
2. Session test (R4).
3. Beam functions (R6 to R9).
4. Renderer: `beam.ts`, the chain, the failure rule, the screenshot (R10 to R18).
5. Editor (R19 to R26).
6. MCP description and test (R27).
7. Fixture show and its tests (R29).
8. Documents (R30 to R32).
9. Local checks by the orchestrator on macOS with MCP and OBS, at `production_v1` and 1920 × 1080 at 60 FPS:
   - LC1: one beam shows in the preview (WebKit, WebGPU) and in OBS, and `app_status` has no pipeline warning (R10, R12, R15).
   - LC2: an object in front of a beam hides it, and a beam has no hard line at the floor (R14).
   - LC3: OBS alpha over dark, light, and checker backgrounds: alpha 0 outside the scene, and no channel above the alpha in a beam pixel (R12). One capture with the OBS blending method "SRGB Off".
   - LC4: the fixture show: 8 beams show from the Wide, Stage, and Close cameras.
   - LC5: the Inspector: L1 to L4, live drags with real input, the reset marks, and a type change (R19 to R25).
   - LC6: MCP `scene_patch` sets a beam, `scene_inspect` returns it, and `camera_screenshot` shows it (R16, R27).
   - LC7: cost for four cases (no beam; 8 beams; 8 lights that scatter in a haze, 2 with a shadow; both): frame rate, sampled CPU time, and OBS render-skipped frames, after 30 s, for 120 s. GPU time: unknown.
   - LC8: the output continues with the Editor minimized.
   - LC9: Save As, close, and Open keep the beam group (R3).
   - LC10: WebGL 2 (`?backend=webgl2`): record if the beam draws.

## N — Norms

- Unit tests for the schemas, the Rust mirror, the pure beam functions, the chain rule, the editor model functions, and the fixture show. One integration test at the MCP stdio boundary. No test for static copy.
- The look, the cost, WebKit, and OBS are checked in the running build on macOS by the orchestrator (owner rule: no scratch harness page).
- Functional TypeScript and plain data. Controls come from `@oshi-connect/ui`, with the existing slider and checkbox patterns of the light fields.
- Long prose is Simplified Technical English. UI copy is the label only.

## S — Safeguards

- Do not change the show file version, the limits, the quality profiles, the haze constants, or the show templates in `apps/desktop/src-tauri/resources/templates/`.
- Do not change how a scene without a beam draws: with the beam flag `false`, the chain rule and the chain are the same as before.
- Do not put the beam in `lightSignature` or in a light node set.
- Do not read images back in the output path. The beam pass stays on the GPU.
- Do not draw a beam in a shadow map or make it a pick target.
- Do not change `packages/assist`, the property registry, or a Blueprint node.
- Do not fill `gpuMs`. Do not write a GPU time, a frame time, an OBS result, or a look result that was not measured.
- Keep each label in one place in the code, so that a correction from the Warudo check is one edit.
