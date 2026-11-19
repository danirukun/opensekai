# Character lighting design

Date: 2026-11-19. Status: implemented on liltoon-avatar-lighting-f03807ca; owner look check open. Issues: [#73](https://github.com/danirukun/opensekai/issues/73) (MAT-01), [#45](https://github.com/danirukun/opensekai/issues/45) (ENV-07), [#298](https://github.com/danirukun/opensekai/issues/298) (context). Part 2 (lilToon, [#269](https://github.com/danirukun/opensekai/issues/269), #74, #75) follows this work and has its own design.

## Intent

Avatars in OpenSekai must look the way users expect from a Unity or Warudo VTubing app. The current trend (VPoyo testers praise its lighting) is a clear rim light and a cinematic 3D look. Today an avatar looks flat: it gets one white ambient light and one directional light, no environment light, and its shadows go to black.

The owner selected approach A: a character lighting model in the MToon shader. The owner also decided that the new look applies to all avatars, also in existing shows (2026-11-19).

All eight avatars in the owner's test set (iCloud Drive › VTuber Avatars) are VRM 0.x with only MToon materials. Thus this work changes the look of each avatar that OpenSekai loads today.

## Current state

- `scene-lights.ts`: a fixed `AmbientLight(1)` and a built-in `DirectionalLight(3)` when the scene has no light entity. Light entities go into one node set for each light group (characters, props, environment, haze). Shadow flags are on each mesh when a shadow light exists.
- `environment-light.ts`: props and environments get a PMREM room map through `RoomStandardMaterial` / `RoomPhysicalMaterial`, which scale the diffuse fill and the reflections (B13 R4a). `scene.environment` stays null, so avatars get no environment light.
- three-vrm 3.5.5 `MToonLightingModel` (node material):
  - `getShading` sets `shadow = 1`. three r187 `AnalyticLightNode.setupShadow` multiplies the shadow into the light color (`colorNode.mul(shadowNode)`), unless the lighting context supplies `getShadow`. Thus a shadowed MToon pixel goes to black, not to the shade color. In Unity MToon, the shadow goes into the shading term, and the pixel goes to the shade color.
  - The constructor deletes `giEqualizationFactor`. Indirect diffuse is `irradiance × Lambert(diffuse)` with no equalization.
  - The rim is `parametricRim + matcap`, view-based. In `direct()` it is multiplied by each light color, without the light direction. All eight test avatars have a black parametric rim color, so they have no rim.
- Tone mapping is off unless a camera has a Grading group (CAM-06).
- Light limits (B34b): 8 lit lights, 2 shadow lights. Each Add of a lit light stops the Editor for about 8 to 10 s while lit materials compile. Metal failed one time at 8 lights with `bracket nesting level exceeded maximum of 256`.

## Goals

1. **Shadows go to the shade color.** On an MToon material, a shadow lowers the toon shading term, so a shadowed area shows the authored shade color, as in Unity MToon.
2. **Light-driven rim.** Each light that affects characters adds a thin bright edge when the light is behind the avatar from the camera view. The rim is added to the authored MToon rim; it never replaces it.
3. **Environment fill on avatars.** Avatars get a soft, colored fill from the environment map, flattened so that a face does not get a gradient.
4. **Per-character controls.** Each avatar has a Lighting group: rim strength, rim width, rim tint, shadow strength, and environment fill. The defaults look good with no setup.
5. **A better default light rig** for a new scene, with at most 3 lit lights.
6. **A demo show** with a stage environment that shows the rim, the fill, and the shadows, in the preview and in OBS with alpha.

## Non-goals

- lilToon materials (part 2). The `.warudo` files in the test set hold compiled Unity shaders, so lilToon from them means a read of saved properties by shader name, not of shader code. `.warudo` import (#187) is a candidate with a selection gate.
- Screen-space rim or depth-based edge effects (approach B). Rejected: the rim must follow the real lights, and edge glows gave gray veils on the OBS output before.
- Changes to props and environments other than the demo stage. They keep `RoomStandardMaterial`.
- More lit lights (#316), the window-shadow preset (#298), HDR sky light (#148), lightmaps (#271).
- A light map rendered from the loaded stage, so that the avatar takes the colors of nearby emissive objects. The owner selected the Ambient light color as the fill color source (2026-11-19). A stage-derived map goes with #148.
- A change of grading on existing cameras.

## Anti-goals

The work fails, also when it runs, if one of these occurs:

- An avatar in an existing show looks worse: a face with hard, dark shadow bands, a rim that glows on all edges at all times, or a washed-out face.
- An authored MToon value (shade color, shading shift, toony, parametric rim, matcap, outline) stops working or is overwritten.
- The OBS output gets a gray veil, a bright fringe, or a background alpha that is not 0.
- The Editor stall for a light change becomes longer by a large amount, or a light set at the limit fails with `Pipeline compile failed`.
- Two clients (preview and OBS) draw the same frame differently.

## Constraints

- Rendering stays independent of Svelte. One authoritative simulation; renderers consume evaluated state.
- WebGPU first; WebGL 2 needs separate evidence. macOS first; Windows is not claimed.
- three 0.187.0 and three-vrm 3.5.5 are pinned. Subclass them; do not add a new package patch. The existing `patches/@pixiv__three-vrm@3.5.5.patch` (`normalView` instead of `transformedNormalView` in `direct()` and in the parametric rim) stays, and the overridden `direct()` uses `normalView` too.
- Classes that read `isMToonNodeMaterial` (`mtoon-binds.ts`, `mtoon-uv.ts`, `scene-lights.ts` `isLitMaterial`, B38 `material-parameters.ts`) must continue to work.
- Schema release rule: a new optional field is backward compatible; an old show opens with the defaults.
- B38 (material parameter control, renderer part, #80) and the more-lights work (#316, queue #156 B43) are queued. This work and those bundles must not run in parallel on the same files. The integrator orders them. If this work lands first, B38 adopts `CharacterMToonMaterial`; if B38 lands first, this work adds a test that the B38 bindings still apply to `CharacterMToonMaterial`.
- Long prose in ASD-STE100. No new UI copy except the control labels.

## Approaches

| | Approach | Trade-off | Result |
|---|---|---|---|
| A | A character lighting model in an MToon subclass: shadow into shading, a per-light rim term, flattened environment fill, per-character controls, and a default rig | Shader work on the three-vrm node material; a small cost for each light; no new pass and no new light | **Selected by the owner** |
| B | A screen-space rim from the depth buffer in the post chain, with bloom and grading defaults | Works on any material, also lilToon later; the rim does not follow the lights; edge glows gave gray veils on the OBS output | Rejected |
| C | Light presets and defaults only, no shader change | Cheapest; MToon turns a back light into a wide band, not a thin rim; each extra lit light stalls the Editor | Rejected; its defaults are part of A |

## Design

### Material

`CharacterMToonMaterial` extends three-vrm `MToonNodeMaterial`. The VRM loader plugin gets it as its material type (`MToonMaterialLoaderPlugin` `materialType`), so outline clones are also of this type. It has its own `type` string, so the shader cache keeps it apart from the stock class (the `RoomStandardMaterial` pattern). `isMToonNodeMaterial` stays true.

`setupLightingModel()` returns `CharacterLightingModel`, which extends `MToonLightingModel`:

- **Shadow.** The lighting context supplies `getShadow`, so the shadow does not go into the light color. `direct()` reads the shadow factor `s` of the light and computes `shading = linearstep(−feather, feather, dotNL + shadingShift) × mix(1, s, shadowStrength)`. The shade and diffuse mix then uses this term. With `shadowStrength = 0` the avatar receives no shadow.
- **Rim.** In `direct()`, for each light: `rim = rimStrength × pow(1 − N·V, p(width)) × smoothstep(a, b, −L·V) × smoothstep(SIDE.start, SIDE.end, N·L) × lightColor × rimTint`. In this formula, `N` is the normal, `L` the direction to the light, `V` the direction to the camera, and `p` comes from rim width. The `−L·V` term is large only when the light is behind the avatar. The `N·L` term is a light-side mask, with `SIDE = { start: −0.1, end: 0.4 }`: an edge that faces away from the light gets no rim. Without the mask, an edge under an arm or under the chin gets a rim from a back light, and the rim shows on all edges. An outline material gets no added rim and no fill, but it gets the ambient share (see Ambient). The term goes into `directSpecular`, after the authored MToon rim. Because it is in `direct()`, it uses only the lights of the character group, so Affect Characters controls it. Shadow does not remove the rim (a back light is behind the shadow casters) unless the builder finds a case that looks wrong; then record it.
- **Environment fill.** `setupEnvironment` returns an environment node that evaluates the room irradiance as L2 spherical harmonics (SH) and mixes it toward its average with an equalization factor (MToon GI equalization, which mixes `ShadeSH9(normal)` toward the SH average in Unity). Each renderer gets the nine coefficients one time: it renders the three.js `RoomEnvironment` into a small cube target and reads it back once (`LightProbeGenerator.fromCubeRenderTarget`). The material does not sample the PMREM map: three PMREM samples made each character pipeline compile about 2 s slower (Ruling 9). The default equalization is the authored `giEqualizationFactor` (VRM 0.x `_IndirectLightIntensity` through v0compat): the subclass reads it before the parent constructor deletes it. The result is scaled by `environmentFill` and by a character fill color: white when the scene uses the fixed ambient, otherwise the sum of color × intensity of the visible Ambient light entities with Affect Characters on (my call; today `roomLight()` gives a fill share of 0 or 1, and 0 when any ambient entity exists, which would remove the fill in each new scene). A dark stage thus also darkens the avatar fill. No specular reflection from the map goes onto the avatar.
- **Ambient.** The character group has no separate ambient light. It gets the same ambient as the props: the fixed `AmbientLight(1)`, or the Ambient light entities. `CharacterLightingModel` scales the parent indirect diffuse term (the irradiance of the lights, times Lambert) by `CHARACTER_AMBIENT` (0.5) on an avatar surface, a material with a `characterShare`, an outline too; an MToon prop or environment material has no share and keeps the full term. It adds the environment fill as before. At the defaults, the total ambient of an MToon avatar equals the scene ambient (0.5 plus the fill at `CHARACTER_FILL` 0.5), so the face brightness under the built-in light stays. A lit avatar material that is not MToon keeps the ambient of `main`, because only the MToon lighting model scales the term. An outline gets `CHARACTER_AMBIENT` × ambient, with no fill and no added rim.

### Controls and data

A new optional `lighting` group on the avatar entity:

| Field | Range | Default |
|---|---|---|
| `rimStrength` | 0 to 2 | builder tunes; on |
| `rimWidth` | 0 to 1 | builder tunes |
| `rimTint` | color | white |
| `shadowStrength` | 0 to 1 | builder tunes; below 1 |
| `environmentFill` | 0 to 2 | builder tunes |

A missing group gives the defaults, so existing shows get the new look (owner decision). The group is in the show, the Inspector (Lighting group on the character), MCP `scene_patch`, and Blueprint Set Property, through the same validated command API. The values are uniforms; a change does not recompile.

### Default rig

A new scene gets: a key directional light (warm, about 45° side and above, shadow on, soft), a back light (cool, behind and above the avatar, no shadow, for the rim), and an ambient light. That is 2 lit placed lights and 1 ambient. Existing scenes keep their lights. The built-in light (no light entity) also gets a rim from the camera-relative back direction only if the builder can do this without a second light; otherwise it stays one light.

### Demo show

- `scripts/lighting-stage/build_lighting_stage.py`, built like `scripts/test-stage/build_test_stage.py`: headless Blender, CC0, one GLB. A dim stage: a dark floor with some gloss, a back wall with emissive light strips, a low platform for the avatar, and props that catch a shadow. It runs in a background Blender process, not in the open Blender session.
- The GLB goes to the private `opensekai-fixtures` bucket as `fixture_lighting_stage`, with a manifest entry (docs/testing.md, Fixtures).
- `fixtures/shows/lighting-demo.osekai`: the stage, Catboy (`fixture_vrm0_arkit`), a warm key light with shadow, two colored back lights for the rim, a haze with a few beams, and a camera with ACES grading and soft bloom. A second camera has a close-up of the face, for the face shadow check.

### Verification

- Unit tests for pure parts: the rim mask function, the equalization mix, the schema defaults and the range checks.
- Renderer tests: the loader gives `CharacterMToonMaterial` for an MToon VRM and its outline; `isMToonNodeMaterial` stays true; UV animation and B38 bindings still work; a lighting change is a uniform write, not a recompile.
- Headless fixture check (WebGPU and WebGL 2 software adapters): the fixture avatars load with no pipeline compile failure.
- macOS with OBS (owner-authorized local OBS control): the demo show in the preview and in OBS with alpha over dark, light, and checker backgrounds; the rim from each back light; the shadow goes to the shade color on the face close-up; the editor minimized, output continues. Record the backend, the quality profile, the fixture revision, and the commit.
- Cost: shader compile time and the Editor stall at 1, 3, and 8 lit lights, before and after. A stall more than 20 % longer at 8 lit lights is a failure (my call); then the costly term must get cheaper before the work ships (measured: the PMREM fill was the cost, not the rim; Ruling 9); 30 light-set changes at 8 lit lights with no `Pipeline compile failed`; the output frame time. GPU time stays unknown until #305.
- A before and after capture of each of the eight avatars from the test set under the default rig, for the owner's look check. Avatar files are never committed.

## Process

This design does not replace the project process. The implementation plan breaks it into slice contracts in `spdd/analysis/` and `spdd/prompt/` (REASONS), each with its own evidence. A likely order: (1) the material subclass and the shadow fix, (2) the rim and the fill with the avatar lighting group, (3) the default rig and the demo show. The shadow fix alone can make a face look worse before the fill and the rim exist, so the three slices stay on one feature branch and merge to main together, after the owner's look check (my call). `ARCHITECTURE.md` gets the character lighting data path. `docs/warudo-parity.md` gets MAT-01 and ENV-07 evidence for only what was verified.

## Known gaps

- v0compat drops the VRM 0.x `_ReceiveShadowRate` and `_ShadingGradeRate`. This work does not read them; the per-character Shadow Strength covers the main case. They never worked in OpenSekai, so this is not a regression.

## Left to the builder

- The exact rim formula and the default values, tuned on the eight avatars and checked by the owner.
- How the shadow factor is read in `direct()` through `getShadow` in three r187.
- ~~The equalization method~~ Decided: SH average at world up and world down (Ruling 9).
- The ambient share values that keep the face brightness (measured).
- Fill level (decided after the GPU check): the fill is normalized to the luminance of the room average and scaled by `CHARACTER_FILL` (0.5), so the stage map gives direction and tint, not level.
- The demo stage layout details and materials.
