# Stage lights analysis

Date: 2026-10-18. Scope: bundle B13 (#45 ENV-07 rest, #46 ENV-08 first subset, #40 ENV-02 ambient part). Contract: [stage lights](../prompt/2026-10-18-stage-lights.md). Depends on: [live light editing](2026-10-18-live-light-editing.md) (B12: sliders, the color field, live edits).

## Sources

- [Warudo Lights](https://docs.warudo.app/docs/assets/lights), read 2026-10-18. Three light types: Directional Light, Point Light, and Volumetric Light ("a spotlight that illuminates the scene from a specific point, with volumetric lighting effects"). Each light has Color, Intensity, Shadow, and the three affect settings. The page gives no spot angle, range, or volumetric settings.
- The three.js r180 example [`webgpu_volume_lighting`](https://threejs.org/examples/webgpu_volume_lighting.html), named by the owner as the model for volumetric light. It has:
  - A box with `VolumeNodeMaterial` (12 steps, `bayer16(screenCoordinate)` offset, and a `scatteringNode` with three samples of a 128³ Perlin `Data3DTexture`, scaled by a smoke uniform).
  - A point light and a spot light, both with shadows, on a dedicated volumetric layer.
  - A scene pass with depth. The volume material uses that depth for occlusion.
  - A second pass of the volume layer only, at 0.25 resolution, blurred with `gaussianBlur`, and added to the scene pass with an intensity uniform.
- three.js r180 source (`VolumeNodeMaterial.js`, `VolumetricLightingModel.js`):
  - The material is transparent, back-sided, has `depthTest: false`, and ray-marches from the camera to the back face.
  - Lights without a `distance` property (directional, ambient, hemisphere) do not scatter.
  - Shadows reach the volume through `lightNode.shadowNode`.
  - The output is `1 − transmittance`, from 0 to 1 per channel.
  - `material.lightsNode` sets the lights, as for other node materials.
- Workshop research (`docs/superpowers/specs/2026-10-17-warudo-workshop-research.md`): the Livehouse Stage has 2 spot lights and 1 directional light. Imported stages depend on lights for their look.
- Owner decisions, 2026-10-18: a Warudo-style stage with lights and real shadows; volumetric light as in the three.js example; B13 includes Spot Light, Haze, and Ambient Light; Spot cookies are bundle B14.

## Current state (after B12)

- Light types are directional and point, at most 8 lights and at most 2 with a shadow. `scene-lights.ts` builds one `lights([...])` node set for each material group (characters, props, environment), with one fixed `AmbientLight` (white, intensity 1) in each set.
- The fixed ambient light lights every material at full strength, so a dark stage is not possible.
- There is no volumetric effect and no fog.
- The post chain (`anti-aliasing.ts`) exists only for FXAA, and the OBS page keeps alpha through it.
- Live sliders and the native color field exist (B12).

## Decisions

These decisions are reversible.

1. **Spot light is a light type.** `type: 'spot'` adds a `cone` group: `{ angleDegrees, penumbra }`. `angleDegrees` is the full cone angle from 1 to 170 (Unity and Warudo show a full angle; three.js uses half of it). `penumbra` is from 0 to 1. Range and decay 2 work as for a point light. A spot shadow is a 1024 px perspective map and counts toward the 2 shadow lights. Alternative: a separate entity kind. That duplicates the light code and the affect groups.
2. **Ambient light is a light type.** `type: 'ambient'` uses Color, Intensity, and the affect flags. It has no transform effect, no range, and no shadow. When a scene has an ambient entity, it replaces the fixed ambient light in each group, by its affect flags. A scene with lights and no ambient entity keeps the fixed ambient, so B9 scenes look the same. Alternative: a scene-level ambient setting. That needs a new scene field and a new patch op, and Warudo has no such setting.
2a. **An ambient entity also sets the room map of the environment.** Finding (owner, 2026-10-18): on an imported stage (one standard material, roughness 0.3, not metallic, black emissive map), the spot shadows did not show. With Reflections Intensity 0, the spot pools and the shadows showed. The PMREM room map (environment import R17) adds a diffuse fill and reflections of a bright white room, and neither has shadows. At intensity 1.43 the fill was stronger than the spot lights. With the fill removed, the floor still mirrored the bright room at a low camera angle, and the shadows stayed faint. In Unity and Warudo, the ambient source sets the fill, and the reflections show the surroundings. On a dark stage the surroundings are dark. So when a scene has an ambient entity, the environment materials lose the diffuse part of the map, and its reflections are multiplied by the ambient light on the environment. A white ambient entity at intensity 1 gives the B9 reflections, and a scene without an ambient entity looks as before. Alternatives: remove the diffuse part in each scene (this changes how each B9 environment looks, because the fill is about 3 times the fixed ambient), or a separate fill setting on the environment (a new field and a new patch op).
3. **Haze is a scene entity.** A new kind `haze` is a box volume: its transform places and sizes it (scale = size in meters, default 20 × 8 × 20). Its settings are Density, Smoke, Intensity, and Drift. There is at most 1 haze in a scene. Point and spot lights with `volumetric: true` scatter light in it; their shadows make light shafts. Directional and ambient lights cannot scatter (three.js r180 ignores lights without a distance). Reason: stage beams need haze, as on a real stage, and the example uses one volume for all lights. Alternative: a cone volume for each light. That gives beams without haze, but each light then costs one more volume draw, and overlapping beams need their own blend rule.
4. **Haze render path.** The renderer draws the haze in a second pass of the haze layer only, at 0.25 of the output resolution, with 12 steps. It blurs it and adds it to the scene pass, as in the example. The volume material uses the scene depth, so a character in front of a beam hides it. The resolution and the step count are fixed constants. The quality profiles do not change, because a profile is a frozen measurement setting; a haze quality setting is a later profile ID.
5. **OBS alpha.** The output keeps premultiplied alpha. The composite is `rgb = scene.rgb + haze.rgb` and `alpha = scene.alpha + (1 − scene.alpha) × min(1, max(haze.r, haze.g, haze.b))`. Each pixel is then a valid premultiplied pixel. Over a dark OBS background a beam looks additive; over a light background it shows as a light veil. This is Approximate (ENV-08).
6. **Editor helpers.** A spot light shows its cone (lines from the light to a circle at its range, or at 5 m when the range is 0). The haze shows a wire box and a small center handle. A click on the handle or an edge selects the haze; a click inside the box does not, so the character inside stays pickable. OBS draws neither.
7. **Defaults.** A new Spot Light is at (0, 3, 2), aimed at (0, 1, 0), with intensity 60, range 15, angle 40°, penumbra 0.3, and `volumetric: true`. A new Ambient Light is white at intensity 0.3. A new Haze is at (0, 4, 0), size 20 × 8 × 20, with density 1, smoke 1, intensity 2.5 (owner choice after the macOS check), and drift 0.2 m/s.
8. **Blueprints.** `intensity` already works for every light type. Haze gets `position`, `rotation`, `scale`, `visible`, and `hazeDensity` (0 to 2).

## Effects

- An operator can build a dark stage with an ambient fill, colored spot lights, and visible beams with shadow shafts in haze, live in OBS.

## Risks

- **Cost.** Each haze pixel marches 12 steps through each volumetric light. A shadow light then samples its shadow map at each step. The macOS check measures the frame time with 2 shadow spot lights and haze at `production_v1`.
- **WebKit.** The Scene and Editor windows use the system WebKit, which had pipeline compile problems in B9. A failed haze pipeline must not stop the scene: the renderer drops the haze and reports the existing `Pipeline compile failed` warning.
- **WebGL 2 fallback.** `Data3DTexture` and the volume loop must work there; the check records the result.
