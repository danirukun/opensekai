# Character lighting analysis

Date: 2026-11-19. Scope: [#73](https://github.com/danirukun/opensekai/issues/73) MAT-01 and [#45](https://github.com/danirukun/opensekai/issues/45) ENV-07, in one slice set. Context: [#298](https://github.com/danirukun/opensekai/issues/298). The lilToon work (part 2, [#269](https://github.com/danirukun/opensekai/issues/269), #74, #75) follows and has its own design. Source: [design](../../docs/superpowers/specs/2026-11-19-character-lighting-design.md), [plan](../../docs/superpowers/plans/2026-11-19-character-lighting.md).

## Problem

1. **Avatars look flat.** Users expect the look of a Unity or Warudo VTubing app: a clear rim light and a cinematic 3D look. An avatar in OpenSekai gets one white ambient light and one directional light. It gets no environment light, and its shadows go to black.
2. **A shadow turns an MToon pixel black.** In Unity MToon, a shadow lowers the toon shading term, so the pixel goes to the shade color. In OpenSekai, the shadow goes into the light color, so the pixel goes to black. A face with a nose shadow shows a hard dark band.
3. **There is no rim from the lights.** The authored MToon rim is view-based and does not follow a light. All eight avatars of the owner test set have a black parametric rim color, so they have no rim.
4. **There is no control.** An operator cannot set the rim, the shadow, or the fill for one character.
5. **The result must be right on the OBS output.** The output is a transparent premultiplied image. A rim must not make a halo or a gray veil, and the background alpha must stay 0.

## Current state

- `scene-lights.ts` makes a fixed `AmbientLight(1)` and a built-in `DirectionalLight(3)` when the scene has no light entity. Light entities go into one node set for each light group (characters, props, environment, haze). The shadow flags are on each mesh when a shadow light exists.
- `environment-light.ts` gives props and environments a PMREM room map through `RoomStandardMaterial` and `RoomPhysicalMaterial`. `scene.environment` stays null, so an avatar gets no environment light.
- three-vrm 3.5.5 `MToonLightingModel`:
  - `getShading` sets `shadow = 1`. three r187 `AnalyticLightNode.setupShadow` multiplies the shadow into the light color, unless the lighting context supplies `getShadow`.
  - The constructor deletes `giEqualizationFactor`. Indirect diffuse is `irradiance × Lambert(diffuse)`, with no equalization.
  - The rim is `parametricRim + matcap`. In `direct()` it is multiplied by each light color, without the light direction.
- The patch `patches/@pixiv__three-vrm@3.5.5.patch` uses `normalView` instead of `transformedNormalView` in `direct()` and in the parametric rim.
- Tone mapping is off unless a camera has a grading group (CAM-06).
- Light limits (B34b): 8 lit lights and 2 shadow lights. Each time you add a lit light, the Editor stops for 8 to 10 s while the lit materials compile. Metal failed one time at 8 lights with `bracket nesting level exceeded maximum of 256`.
- All eight test avatars are VRM 0.x with only MToon materials. Thus this work changes the look of each avatar that OpenSekai loads today.

## Decisions

- **One MToon subclass.** `CharacterMToonMaterial` extends three-vrm `MToonNodeMaterial`. Its `type` is `'CharacterMToonMaterial'`, so the shader cache keeps it apart from the stock class (the `RoomStandardMaterial` pattern). `isMToonNodeMaterial` stays true. The VRM loader plugin gets it through `materialType`, so an outline clone has the same type. No new package patch.
- **Approach A (owner).** The rim, the shadow, and the fill are in the MToon shader.
  - Approach B is rejected. It is a screen-space rim in the post chain. The rim must follow the real lights. Edge glows gave gray veils on the OBS output before.
  - Approach C is rejected. It uses light presets only. MToon turns a back light into a wide band, not a thin rim. Its defaults are part of A.
- **Shadow goes into the shading term.** The lighting context supplies `getShadow`. `shading = linearstep(−f, f, dotNL + shift) × mix(1, s, shadowStrength)`, with `f = 1 − toony`. With `shadowStrength = 0` the avatar receives no shadow.
- **Rim from each light behind the avatar.** `rim = rimStrength × pow(1 − N·V, p(width)) × smoothstep(a, b, −L·V) × lightColor × rimTint`. The rim is added to `directSpecular`, after the authored rim. It never replaces the authored rim. It is in `direct()`, so only the lights of the character group make it, and Affect Characters controls it. The shadow does not remove the rim, unless the builder finds a case that looks wrong. An outline material gets no added rim.
- **Fill from the room map, flattened.** The environment node evaluates the L2 SH irradiance of the room (nine coefficients, read back one time for each renderer) and mixes it toward its average with the MToon equalization factor. The default factor is the authored `giEqualizationFactor`, read before the parent constructor deletes it. The result is scaled by `environmentFill` and by a fill color. There is no specular reflection of the room map on an avatar. An outline material gets no fill.
- **Fill color follows the Ambient light (owner, 2026-11-19).** The fill color is white when the scene uses the fixed ambient. Otherwise it is the sum of color × intensity of the visible Ambient light entities with Affect Characters on. A dark stage thus also darkens the avatar fill. Today `roomLight()` gives a fill share of 0 or 1, and 0 when any ambient entity exists. That would remove the fill in each new scene, so the avatar does not use it.
- **One share object for each renderer.** The fill color and the room SH are one `CharacterShare = {fill, sh, average}` object for each renderer. The renderer sets it on each `CharacterMToonMaterial` of its avatars (the `RoomStandardMaterial.roomShare` pattern). There is no module-level state, because a PMREM texture belongs to one renderer, and one page can have more than one renderer.
- **The fixed ambient share is lowered.** The fixed `AmbientLight(1)` stays for a scene without an Ambient entity. Its share in the character group is lowered, so that ambient plus fill keeps the current face brightness under the built-in light. The builder measures this and records the values.
- **Per-character controls, optional group.** An avatar entity gets an optional `lighting` group: `rimStrength` 0 to 2, `rimWidth` 0 to 1, `rimTint` `#rrggbb`, `shadowStrength` 0 to 1, and `environmentFill` 0 to 2. A missing group means the default values (owner: existing shows get the new look). The group is one JSON object in the show (constitution principle VII). One patch operation, `setAvatarLighting`, sets the full group or removes it (`null`), as `setCameraGrading` does. A schema change for a new optional field is backward compatible.
- **Numbers are uniforms.** A value change is a uniform write. A light-set change is the only recompile trigger, as today.
- **Default rig.** A new scene gets a key directional light (warm, shadow, soft), a back directional light (cool, no shadow), and a fill Ambient light. That is 3 lit lights and 1 shadow light, under the limit of 8 and 2. Existing scenes keep their lights. The built-in light gets a rim from the camera-relative back direction only if the builder can do this without a second light.
- **Demo show.** A headless Blender script builds a dim stage (CC0, one GLB). The GLB goes to the private `opensekai-fixtures` bucket. The show `fixtures/shows/lighting-demo.osekai` has the stage, Catboy, a warm key light, two colored back lights, a haze, and two cameras (`Wide` and `Face`).
- **Initial defaults, then tuning.** The initial values are `rimStrength 1`, `rimWidth 0.5`, `rimTint #ffffff`, `shadowStrength 0.6`, and `environmentFill 1`. The builder tunes them on the eight avatars, and the owner checks the look. The face under the built-in light must not get darker than before by more than about 10 % in mean luminance of a face patch.
- **One branch, one PR.** The shadow fix alone can make a face look worse before the fill and the rim exist. The slices stay on one branch and merge to main together, after the owner look check. The order with B38 (material parameter control, #80) and the more-lights work (#316, B43) is set by the integrator. These bundles must not run in parallel on the same files.

## Effects

- An avatar shows a soft fill, a thin rim from each back light, and a shadow that goes to the shade color.
- An operator can set the five lighting fields for each avatar in the Inspector, with MCP `scene_patch`, in the show, and with Blueprint Set Property.
- The wire API gets one optional avatar field and one patch operation. An old show loads without change and gets the default values.
- A new scene starts with three lights. A new demo show shows the look in the preview and in OBS with alpha.

## Risks

- **A face can look worse.** The shadow fix and the default values change each avatar that exists. The before and after capture of the eight test avatars, and the owner look check, are the gate.
- **Compile cost.** The rim adds a term for each light. A stall that is more than 20 % longer when you add a lit light at 8 lit lights is a failure. Then the rim term must get cheaper before the work ships. A light set at the limit must not fail with `Pipeline compile failed`.
- **Transparent and cutout MToon materials** (hair cards) can show a bright halo at the rim on the OBS output. This needs the check on dark, light, and checker backgrounds.
- **GPU time is unknown** until #305. The cloud run has only software adapters, so a look claim needs the owner check on macOS.
- **Three-vrm internals.** The subclass depends on the `direct()` and `getShadow` interfaces of the pinned versions. A version change must run the renderer tests again.

## Out of scope

lilToon materials (part 2), and `.warudo` import (#187, a candidate with a selection gate). Screen-space rim and depth-based edge effects. A change of props and environments other than the demo stage. More lit lights (#316), the window-shadow preset (#298), HDR sky light (#148), and lightmaps (#271). A light map rendered from the loaded stage (it goes with #148). A change of grading on existing cameras. NDI. Reads of the VRM 0.x `_ReceiveShadowRate` and `_ShadingGradeRate`.
