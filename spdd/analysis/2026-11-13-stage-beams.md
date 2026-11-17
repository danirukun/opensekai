# Stage beams analysis

Date: 2026-11-13. Scope: bundle B34 (#46 ENV-08, second subset). Contract: [stage beams](../prompt/2026-11-13-stage-beams.md). Depends on: [stage lights](2026-10-18-stage-lights.md) (spot lights, the haze, and the post chain).

A note on names: the stage lights contract calls itself "bundle B13". That was a local bundle. It is not the queue row B13 (Blueprint depth). This file uses "stage lights" for it.

## Sources

- [Warudo Lights](https://docs.warudo.app/docs/assets/lights), read 2026-11-13. Three light types: Directional Light, Point Light, and Volumetric Light ("a spotlight that illuminates the scene from a specific point, with volumetric lighting effects"). Each light has Color, Intensity, Shadow, and the three affect settings. The page gives no beam, range, angle, or fog setting. It warns that many lights cause performance problems.
- [Warudo Environment](https://docs.warudo.app/docs/assets/environment), read 2026-11-13. It has no fog or volumetric text.
- UI audit 0.15.1 ([follow-up](../../docs/superpowers/plans/2026-10-17-warudo-ui-audit-follow-up.md)). The repository has no audit line for the Volumetric Light controls. The controls and the look of the Warudo Volumetric Light are **not confirmed by a source**. A check in the Warudo test VM runs on 2026-11-13; its result can correct the labels and the ranges in the contract.
- [Bonnie scene spike](../../docs/superpowers/specs/2026-10-28-bonnie-scene-spike.md). A real concert scene has DMX fixture groups of 5 moving heads, a grid of 12, and 28 LED pars. Its beams come from a third-party plugin, not from the Volumetric Light.
- [Benchmark contract](../../docs/evaluation/benchmark-contract.md). The hall fixture needs "beam effects". The contract gives no fixture name and no beam count. Its proposed gates are a p95 GPU time below 16.67 ms when the measurement is available, a p95 CPU work below 12 ms, and fewer than 0.1 % OBS render-skipped frames, at 1920 × 1080 and 60 FPS, after a 30 s warm-up, for 120 s.
- three.js r187 source: `GodraysNode` supports only point and directional lights and needs a light that casts a shadow.
- Owner decisions, 2026-11-13: a cone beam on each spot light in its own pass; a target of 8 beams; explicit controls; the label "Scatter In Haze"; Beam off for a new Spot Light; no GPU time in this bundle.

## Current state

- **First subset (stage lights).** `docs/warudo-parity.md` records ENV-08 as Partial. A spot or point light with `volumetric: true` scatters in the one `haze` entity. The haze is a box with a `VolumeNodeMaterial`: 12 steps, a pass at 0.25 of the resolution, a blur, and a premultiplied-alpha composite (`packages/renderer/src/haze.ts`, `post-chain.ts`).
- **No beam without a haze.** The haze mesh exists only when the scene has a haze entity (`renderer.ts`). A new Spot Light has `volumetric: true` and shows no beam until the user adds a Haze. In Warudo one Volumetric Light asset shows its beam. The parity line records this as Different.
- **Cost.** Each haze pixel runs 12 steps for each volumetric light, with one shadow sample for each step of a shadow light. The only measurement is 2 shadow spot lights on macOS: 60 frames each second, CPU 4–5 ms, GPU time unknown. No measurement exists for more lights.
- **Limits.** A scene holds at most 8 lights, at most 2 with a shadow, and at most 1 haze.
- **Quality profiles.** A profile sets the resolution scale, the texture limit, and MSAA. No feature has a cost setting in a profile. The haze constants are the same in each profile.
- **Benchmark tool.** `benchmarkStart` accepts only the fixture `smoke_v1`. `FrameApplied.gpuMs` exists and is nullable; the renderer always sends `null`. `app_status` gives only the last frame acknowledgment of each output.
- **Alpha.** The haze composite makes each pixel a valid premultiplied pixel: `rgb = scene + beam` and `alpha = scene.a + (1 − scene.a) × max(r, g, b)`. This is verified in OBS. Over a light OBS background a beam shows as a veil, because OBS blends a premultiplied sRGB source in linear light.

## Options for the beam

| Option | Cost | Look | Transparent OBS output |
| --- | --- | --- | --- |
| Ray-marched haze (exists) | Grows with the steps, the light count, and the shadow samples. | Soft and physical, with shadow shafts and smoke. A narrow beam is under-sampled. | Verified. A veil over a light background. |
| Cone mesh with a scatter approximation | One draw for each beam, no loop, no shadow sample. The cost is the overdraw of the cone area in a pass at half resolution. Not measured. | The usual concert beam: a clear cone with soft edges that fades along its length. No shadow shafts. | The same composite rule applies when the cone draws in its own pass. Not verified. |
| Screen-space light shafts (`GodraysNode`) | One ray-marched pass for each light. | Shafts from the shadow map. | Needs the same composite. Not suitable: no spot lights, and each light must cast a shadow. |

## Decisions

Decisions 1 to 8 are owner decisions of 2026-11-13. Decisions 9 to 12 are integrator decisions. Decisions 13 to 16 are reversible choices of this analysis.

1. **Scope.** A cone beam on a spot light, drawn in its own pass at half resolution, with a beam fixture show and cost evidence. Rejected: evidence only for the existing haze (it does not remove the difference to Warudo), and beams above the light limit in this bundle.
2. **Beam count.** The target is 8 beams, which is the light limit. A rig with more beams (for example 17 moving heads) is a follow-up issue. Rejected: a change of the light limit or a new beam entity kind in this bundle.
3. **Explicit controls.** The Light section of a spot light gets a Beam checkbox, Beam Intensity (0–4, default 1), and Beam Softness (0–1, default 0.5), after Penumbra. The sliders show only while Beam is on. Rejected: no new control, with the Volumetric switch drawing a cone when no haze exists. That gives no separate beam brightness, and the technique would change when a haze appears.
4. **Brightness.** The beam follows the color and the Intensity of its light. Thus the existing Blueprint `intensity` target and the Visible switch dim the beam, and no new Blueprint key is necessary. Rejected: a beam brightness that does not depend on the light.
5. **Label.** The existing Volumetric checkbox gets the label "Scatter In Haze". The data field `volumetric` does not change. Rejected: keep "Volumetric" (after this slice it does not say which of the two beam features it controls).
6. **Add default.** Add › Spot Light makes a light with Beam off and `volumetric: true`, as before. The fixture show has all 8 beams on. Rejected: Beam on for a new Spot Light (the recommendation of the first draft).
7. **GPU time.** Not in this bundle. `gpuMs` stays `null` and gets a follow-up issue. The pull request reports CPU time, frame rate, and OBS skipped frames, and states GPU time as unknown. Rejected: GPU timestamp queries in this bundle.
8. **Evidence owners.** The orchestrator runs the macOS and OBS checks (the cost of 8 beams and the alpha captures). The owner judges the look in review. The implementation claims neither.
9. **Profiles.** Haze quality and beam quality stay out of the quality profiles. The beam pass resolution is a constant.
10. **Chat tools.** `packages/assist` keeps the haze rig. It writes no beam.
11. **One pull request.** The first commit holds this analysis and the contract. The implementation follows on the same branch. Rejected: a contract pull request first, as the queue mode says.
12. **Order.** B33 merges before B34. B37 (camera effects) changes the post chain after B34 and rebases on it. Thus B34 keeps its change to `post-chain.ts`, `renderer.ts`, and `screenshot.ts` small.
13. **Data shape.** The beam is an optional group `beam: { enabled, intensity, softness }` in `LightSettings`, as `shadow` has an `enabled` switch. The first switch-on writes the defaults; a switch-off keeps the values. `setLight` replaces the light group, so no new patch operation is necessary. Alternative: three flat optional fields.
14. **Geometry.** The cone has its apex at the light, its axis along local −Z, and its length equal to the Range (5 m when the Range is 0, as the editor helper). The cone angle is the spot Angle, with a limit of 120°. Without the limit, an Angle of 170° gives a cone 11 times wider than it is long, which covers the screen with added light. Alternative: a separate Beam Length control.
15. **Shading.** The beam value is the product of an axis fade, an edge fade, a fade near the camera, and a fade against the scene depth. The functions and their constants are in one pure module, which is the CPU reference for the GPU material (as `grading-math.ts`). The constants are OpenSekai choices; the owner judges the look.
16. **Pass.** The beam meshes are on their own layer. The beam pass comes after the haze composite and before the bloom, with no blur, and uses the haze composite function with intensity 1. Thus the alpha rule is the same, and a bright beam can get a glow from a camera bloom. Alternative: draw the cones in the haze pass. That pass is at a quarter of the resolution, has a blur, is multiplied by the haze Intensity, and exists only with a haze.

## Effects

- An operator can show a beam from a spot light with one checkbox, without a Haze, and can set its brightness and its edge.
- The show format gets one optional group. The call API does not change. An older show loads and draws without change.
- A light can have a cone beam and scatter in a haze at the same time. Then both add their light.
- A scene with a beam draws through the post chain, as a scene with a haze or FXAA does.

## Risks

- **Look.** The cone is an approximation. It has no shadow shafts, and a view along the axis or from inside the cone can look wrong. Only the owner can accept the look.
- **WebKit.** A new pipeline can fail to compile in WKWebView. The beam then stops, the existing warning shows, and the scene still draws. No unit test can prove that the material compiles on a real GPU.
- **Cost.** The cost of 8 beams is not known. GPU time has no measurement. `app_status` gives sampled CPU values only, so a p95 value is not available.
- **OBS alpha.** The same composite function is used, but the result with a beam is not verified until the orchestrator captures it. The veil over a light background stays.
- **Preview resolution.** The beam pass is half of the drawing buffer. With `preview_v1` (scale 0.5) it is a quarter of the logical output, so a narrow beam can look coarse in the preview.
- **Parallel work.** B36 and B37 change the same chain and screenshot path, and B36 can use three.js layers. The integrator must keep the layer numbers apart.
- **Labels.** The Warudo check can change a label or a range. The contract keeps them in one table.

## Out of scope

More than 8 beams, a beam entity that is not a light, moving-head motion, DMX (EXT-12), spot cookies (gobos), a beam for point lights, Blueprint targets for the beam values and the light color, haze or beam quality in a profile, GPU time, a `benchmarkStart` run with a beam fixture, a beam in the bundled Stage Lights template, Windows, and the WebGL 2 avatar defect (its vertex uniform block is too large; it is not a beam defect).
