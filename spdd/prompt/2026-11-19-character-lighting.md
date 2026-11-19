# REASONS: Character lighting

Date: 2026-11-19. Analysis: [character lighting](../analysis/2026-11-19-character-lighting.md). Design: [character lighting design](../../docs/superpowers/specs/2026-11-19-character-lighting-design.md). Plan: [character lighting plan](../../docs/superpowers/plans/2026-11-19-character-lighting.md). Issues: [#73](https://github.com/danirukun/opensekai/issues/73) (MAT-01), [#45](https://github.com/danirukun/opensekai/issues/45) (ENV-07). Related: [camera grading](2026-11-10-camera-grading.md) (the template of the entity group and the patch operation), [material profiles](2026-11-03-material-profiles.md) (the MToon UV animation and the headless fixture check).

Status: contract; not implemented.

## R — Requirements

1. **Avatar lighting group** (plan Task 1). `@opensekai/contracts` exports `AvatarLightingSchema`, `type AvatarLighting`, `DEFAULT_AVATAR_LIGHTING`, and `avatarLighting(entity)`.
   - `AvatarLighting` is a strict object. Each field is necessary: `rimStrength` 0 to 2, `rimWidth` 0 to 1, `rimTint` `#rrggbb` (`LightColorSchema`), `shadowStrength` 0 to 1, `environmentFill` 0 to 2. The limits are inclusive.
   - `DEFAULT_AVATAR_LIGHTING` is frozen. The initial values are `rimStrength 1`, `rimWidth 0.5`, `rimTint '#ffffff'`, `shadowStrength 0.6`, `environmentFill 1`. R8 tunes them.
   - An avatar entity has an optional `lighting`. TypeScript and Rust accept the field, check its ranges, and omit it when it is missing. A show without the field loads without change. `avatarLighting(entity)` returns the group, or `DEFAULT_AVATAR_LIGHTING` when the group is missing.
   - The patch operation `{kind: 'setAvatarLighting', entityId, lighting}` sets the group on an avatar. `lighting: null` removes the group. It fails with `INVALID_INPUT` and the message `Entity is not an avatar` for an entity that is not an avatar. It goes through the normal patch route and the live patch route. MCP reaches it through `scene_patch`.
   - The Rust crate `opensekai-contracts` has the same struct, ranges, field, and operation. `fixtures/protocol/validation-vectors.json` has the vectors `set-avatar-lighting-ok`, `set-avatar-lighting-null`, `set-avatar-lighting-rim-over` (`rimStrength 2.01`, `INVALID_INPUT`), and `avatar-lighting-extra-key`.
2. **Lighting math** (plan Task 2). `packages/renderer/src/character-lighting-math.ts` has pure functions on plain numbers. The shader of R3 uses the same constants, exported as `RIM` and `EXPONENT`.
   - `toonShading(dotNL, shift, toony, shadow, shadowStrength)` = `linearstep(−f, f, dotNL + shift) × mix(1, shadow, shadowStrength)`, with `f = 1 − toony`.
   - `rimExponent(width)` = `mix(EXPONENT.narrow, EXPONENT.wide, width)`. The start values are `narrow 8` and `wide 1.5`.
   - `rimFactor(nDotV, lDotV, width)` = `pow(clamp(1 − nDotV), rimExponent(width)) × smoothstep(RIM.backStart, RIM.backEnd, −lDotV)`. The start values are `backStart −0.1` and `backEnd 0.6`.
   - `equalize(sample, average, factor)` = `mix(sample, average, factor)`, on `Vec3`.
   - `normalizeFill(sample, average)` = `sample / max(luminance(average), 1e-4)`, on `Vec3`, with the Rec. 709 coefficients `LUMINANCE` `[0.2126, 0.7152, 0.0722]`. A uniform room gives `[1, 1, 1]` at any level. `CHARACTER_FILL` is `0.5`: the fill level at `environmentFill 1` and a white fill color, in the units of an ambient light intensity.
   - `characterFill(entities)` returns a `Vec3` in linear values. It is `[1, 1, 1]` when `usesFixedAmbient(entities)` is true. Otherwise it is the sum of color × intensity of the visible Ambient light entities with `affectCharacters` on. It reuses `usesFixedAmbient` and `isLight` of `scene-lights.ts`.
3. **Character material** (plan Task 3). `packages/renderer/src/character-mtoon.ts` has `class CharacterMToonMaterial extends MToonNodeMaterial` and `CharacterLightingModel extends MToonLightingModel`.
   - The class has the numeric properties `rimStrength`, `rimWidth`, `shadowStrength`, `environmentFill`, and `giEqualizationFactor`, and `rimTint` as a `Color`. `isCharacterMToonMaterial` is true. `type` is `'CharacterMToonMaterial'`. `isMToonNodeMaterial` stays true.
   - `characterShare?: CharacterShare`. `type CharacterShare = {fill: UniformNode<'color'>; map: Texture | null}` is one object for each renderer. The renderer sets it on each material (R4). There is no module-level state. A PMREM texture belongs to one renderer, and one page can have more than one renderer.
   - The constructor reads `parameters.giEqualizationFactor` before `super()` deletes it. `copy()` and `clone()` keep `rimStrength`, `rimWidth`, `shadowStrength`, `environmentFill`, and `giEqualizationFactor`, and `rimTint`.
   - `setupLighting(builder)` returns the parent lighting node in a context node with `getShadow: lightNode => lightNode.baseColorNode`. This keeps the shadow out of the light color. In r187 the light nodes build after `setupLighting` returns, so a value set on `builder.context` and restored before the return has no effect. The context node merges the hook into the builder context only while the lighting builds (the `builtinShadowContext` pattern of r187 `ContextNode.js`). The hook records each light for which it runs.
   - `direct({lightDirection, lightColor, lightNode, reflectedLight})` reads `shadow = lightNode.shadowNode` only for a light for which the hook ran in this build, else `float(1)`. r187 calls the hook only when the light casts a shadow, the object receives it, and the shadow map is on; a `shadowNode` from an other build is not used.
     - The shading is `toonShading` (R2).
     - The diffuse is as the parent: `mix(shadeColor, diffuseColor, shading)`.
     - The authored rim is as the parent.
     - When the material is not `isOutline`, it adds `rimFactor(N·V, L·V, rimWidth) × rimStrength × rimTint × lightColor` to `directSpecular`.
     - The shadow does not remove the added rim. The rim is not multiplied by the shadow, because a back light is behind the shadow casters.
     - It uses `normalView`, not `transformedNormalView`. The patch `patches/@pixiv__three-vrm@3.5.5.patch` stays.
     - It reads `rimStrength`, `rimWidth`, `shadowStrength`, `environmentFill`, and `giEqualizationFactor` through `materialReference`. Each build makes one reference node of each value, and all lights of the build share it.
   - `indirectDiffuse` is the parent term. When the material is not `isOutline`, it adds `normalizeFill(equalize(sample, average, giEqualizationFactor), average) × characterShare.fill × environmentFill × CHARACTER_FILL × BRDF_Lambert(diffuseColor)`. `sample` is the room irradiance at the world normal. `average` is the mean of the room irradiance at world up and world down (two samples). The environment node does the equalization and the normalization and writes the result to `iblIrradiance`; the lighting model multiplies it. The room map gives direction and tint, not level: the raw room irradiance is far brighter than the ambient light it partly replaces, and it washed out the face on the GPU check. The term has the units that `AmbientLightNode` adds to `irradiance`, with no extra π.
   - The lighting model uses its own copies of the MToon variants (shade color, shading shift, toony, rim mix, rim multiply, matcap, parametric rim). three-vrm 3.5.5 does not export its module variants, so `setupVariants` makes them from the private `_setup*Node` methods of the parent.
   - `setupEnvironment` returns an environment node for `characterShare.map`, with no specular part (the `RoomEnvironmentNode` pattern of `environment-light.ts`). It returns none when the share or the map is missing, or for an outline.
   - The VRM loader plugin in `assets.ts` gets `materialType: CharacterMToonMaterial`, so an outline clone has the same type.
   - A VRM 0.x material with `_IndirectLightIntensity` 0.3 gives `giEqualizationFactor 0.7`. The v0compat plugin writes `1 − _IndirectLightIntensity`. A material without the property gives `0.9`.
   - The class does not change `isLitMaterial`, `mtoon-binds.ts`, or `mtoon-uv.ts` results.
4. **Renderer wiring** (plan Task 4). Each renderer client applies the lighting values on each applied frame.
   - The avatar binding of `avatar-pose.ts` gets `lighting(values: AvatarLighting): void`. `renderer.ts` calls it near the UV call (`value.avatar?.uv(...)`) with `avatarLighting(entity)`, for the loop over installed avatars and for an avatar installed in the same frame. The call writes the four numeric lighting values (`rimStrength`, `rimWidth`, `shadowStrength`, `environmentFill`) and `rimTint` on each `CharacterMToonMaterial` of the avatar. `giEqualizationFactor` comes from the VRM and is not written per frame.
   - `renderer.ts` makes one `CharacterShare` for each renderer. It sets `fill` from `characterFill(entities)` where `sceneLights.apply` runs. It sets `map` from the room map that `createEnvironmentLight` makes. It sets `characterShare` on each `CharacterMToonMaterial` of an avatar when the avatar is installed. `environment-light.ts` exposes the map texture. The behavior of props and environments does not change.
   - An avatar without `lighting` gets `DEFAULT_AVATAR_LIGHTING`. A `setAvatarLighting` change is a property write: the material `version` does not change, so there is no recompile. A light-set change is the only recompile trigger, as today.
   - Two avatar entities of the same asset keep their own values. A scene with no light entity gives the fill `[1, 1, 1]`, white, and the shadow fix, with no `Pipeline compile failed`. An Ambient `#336699` with intensity 1 gives a fill equal to that color in linear values. A hidden Ambient light removes its share of the fill.
   - The fixed `AmbientLight(1)` of a scene without an Ambient entity stays. Its share in the character group is lowered. Then ambient plus fill keeps the current face brightness under the built-in light: the ambient share plus `CHARACTER_FILL` at `environmentFill 1` is about the former `AmbientLight(1)`. R8 measures and records the values.
5. **Editor, MCP, and Blueprint** (plan Task 5). The group is available through the same validated command API.
   - `model.ts` has `setAvatarLighting(entityId, lighting | null, expectedRevision?, live = false)`. It sends one `setAvatarLighting` operation and refuses an entity that is not an avatar.
   - An avatar has a `lighting` Inspector section, built like `CameraGradingFields.svelte`: sliders with number fields, the native color swatch for Rim Tint, and live sliders. The UI copy is the labels only: Lighting, Rim Strength, Rim Width, Rim Tint, Shadow Strength, and Environment Fill. The reset mark shows for a value that differs from `DEFAULT_AVATAR_LIGHTING`.
   - `apps/mcp/src/server.ts` lists `setAvatarLighting` in the `scene_patch` description. A call with a valid group changes the revision. An out-of-range value fails with `INVALID_INPUT`.
   - `property-registry.ts` has `rimStrength` with kind `avatar` and range 0 to 2. A Blueprint Set Property reads the default and writes through `setAvatarLighting`. `packages/session/src/overrides.ts` carries the change.
6. **Default light rig** (plan Task 6). A new scene gets these light entities, with ids `light_key`, `light_back`, and `light_fill`, next to `camera_main`.
   - `KEY_LIGHT`: directional, `#fff1e0`, intensity 3, shadow on, soft. It keeps `lightTransform('directional')`.
   - `BACK_LIGHT`: directional, `#cfe0ff`, intensity 2, no shadow.
   - `FILL_LIGHT`: ambient, `#ffffff`, intensity 0.4.
   - `BACK_LIGHT_ROTATION` is a `Quat`. Its −Z axis points from `[-1.5, 3, -3]` toward `[0, 1.2, 0]`, that is, along the normalized `[1.5, -1.8, 3]` within 1e-5.
   - A new scene has 3 lit lights and 1 shadow light. It passes `ShowSceneSchema`. An existing scene keeps its lights.
7. **Demo stage and show** (plan Task 7).
   - `scripts/lighting-stage/build_lighting_stage.py` is built like `scripts/test-stage/build_test_stage.py`. It uses headless Blender, CC0 credits, and glTF coordinates. It downloads nothing.
   - The stage has:
     - a 12 × 12 m dark floor (roughness 0.35);
     - a back wall with 5 vertical emissive strips (2 cool, 2 warm, 1 magenta);
     - a 0.2 m high round platform of radius 1.5 m at the origin;
     - two shadow-catching boxes at ±2.5 m.
   - The script runs in a background Blender process. It never runs in the open Blender session. `package.json` gets `build:lighting-stage`.
   - The output is one GLB. `pnpm exec tsx scripts/gltf-validate.ts <file>` reports no error. The GLB goes to the private `opensekai-fixtures` bucket under `sha256/<hash>.glb` as `fixture_lighting_stage`. Add an entry in `fixtures/cloud/manifest.json`. Add a row in the Fixtures table of `docs/testing.md`. The upload needs the approval of the owner. `scripts/prepare-fixtures.ts` downloads and verifies it.
   - `fixtures/shows/lighting-demo.osekai` follows the structure of `stage-beams.osekai`. It has:
     - the stage;
     - Catboy (`fixture_vrm0_arkit`) on the platform;
     - a warm key directional light with soft shadow;
     - two point back lights behind the avatar (`#5ab4ff` left, `#ff5ad2` right);
     - an Ambient light `#1a2240` with intensity 0.6;
     - a haze with 2 beam spot lights;
     - the camera `Wide` with ACES grading and bloom (intensity 0.4, threshold 1.0);
     - the camera `Face`, a close-up.
   - The show has at most 6 lit lights and 1 shadow light. It passes `ShowSchema`.
8. **Tuning and macOS evidence** (plan Task 8). The owner can see the look in the preview and in OBS.
   - The builder loads each of the eight VRM files of the owner test set under the default rig. The builder captures a before image (main) and an after image. The builder tunes the defaults, `RIM`, and `EXPONENT`. The mean luminance of a face patch under the built-in light does not fall by more than about 10 %. The avatar files are never committed.
   - Check the demo show in the preview and in OBS. Use the local WebSocket and an isolated test source. Do not start a stream. Do not publish. The check has these parts:
     - Each back light gives a rim.
     - On the `Face` camera, the key shadow goes to the shade color.
     - Over dark, light, and checker backgrounds, the hair edges have no halo, and the background alpha is 0.
     - With the editor minimized, the output continues.
   - Cost: measure the Editor stall when you add a lit light at 1, 3, and 8 lit lights, on main and on this branch.
     - A stall more than 20 % longer at 8 lit lights is a failure. Then the rim term must get cheaper before the work ships.
     - 30 light-set changes at 8 lit lights give no `Pipeline compile failed`.
     - Record the output CPU frame time. GPU time is unknown until #305.
     - An unavailable measurement is unknown, never zero.
   - `docs/evaluation/character-lighting.md` records the backend, the quality profile, the fixture revision, the commit, the results, and the unknowns. `docs/warudo-parity.md` gets MAT-01 and ENV-07 evidence for only what was verified. `ARCHITECTURE.md` already has the character lighting data path from the commits of operations 3 and 4. Task 8 corrects it only where its text became false. This contract gets its new status.
9. **Known gaps**, not in this slice:
   - The VRM 0.x `_ReceiveShadowRate` and `_ShadingGradeRate` are dropped by v0compat. This slice does not read them. The per-character Shadow Strength covers the main case. They never worked in OpenSekai, so this is not a regression.
   - lilToon materials (part 2: #269, #74, #75) and `.warudo` import (#187).
   - More lit lights (#316), the window-shadow preset (#298), HDR sky light (#148), lightmaps (#271), and a fill map rendered from the loaded stage.
   - A rim for the built-in light (a scene with no light entity) through the camera-relative back direction, unless it needs a second light.
   - Look on Windows, on WebGL 2, and GPU time (#305).
   - B38 material parameter control (#80): if it lands first, this slice adds a test that its bindings still apply to `CharacterMToonMaterial`; if this slice lands first, B38 adopts the class.

## E — Entities

- `AvatarLighting = {rimStrength: number; rimWidth: number; rimTint: string; shadowStrength: number; environmentFill: number}`, `AvatarLightingSchema`, and `DEFAULT_AVATAR_LIGHTING` in `packages/contracts/src/avatar-lighting.ts`. The avatar entity gets `lighting?: AvatarLighting`. `LivePatchOp` and `PatchOpSchema` get `{kind: 'setAvatarLighting'; entityId: Id; lighting: AvatarLighting | null}`.
- `RIM`, `EXPONENT`, `CHARACTER_FILL`, `LUMINANCE`, and the functions of R2 in `character-lighting-math.ts`. `Vec3 = [number, number, number]`.
- `CharacterMToonMaterial`, `CharacterLightingModel`, and `CharacterShare = {fill: UniformNode<'color'>; map: Texture | null}` in `character-mtoon.ts`.
- The avatar binding method `lighting(values: AvatarLighting): void`.
- Rust: `AvatarLighting` in `crates/contracts/src/lib.rs`, with `impl Validate`, the avatar field, and the patch operation.
- `KEY_LIGHT`, `BACK_LIGHT`, `FILL_LIGHT`, and `BACK_LIGHT_ROTATION` in `apps/desktop/src/editor/lights.ts`.
- The fixture `fixture_lighting_stage` and the show `lighting-demo.osekai`.
- No change to the frame format, the asset record schema, or the show schema version. The new field is optional.

## A — Approach

- Contracts and session: `avatar-lighting.ts`, the avatar field, the patch operation, and `scene-ops.ts`, as camera grading did (`git show --stat af0af92` lists each place an entity group must reach). Rust mirrors the TypeScript schema, and the shared validation vectors check both.
- Renderer: the math first (R2), as pure functions with the constants. Then the material subclass (R3) with the same constants. Then the wiring (R4). The values are uniforms read through `materialReference`. The fill color and the room map are one share object for each renderer.
- Shader: an MToon subclass of the pinned three-vrm and three versions. No new pass and no new light.
- Desktop and MCP: the Inspector section, the model method, the property registry, and the `scene_patch` description (R5).
- Default rig and demo: the light constants (R6), then the stage script, the fixture, and the show (R7).
- Evidence: a before and after capture, the demo show in the preview and in OBS, and the cost measurement (R8).

## S — Structure

- New: `packages/contracts/src/avatar-lighting.ts`; `packages/contracts/test/avatar-lighting.test.ts`; `packages/session/test/avatar-lighting-patch.test.ts`; `crates/contracts/tests/avatar_lighting.rs`; `packages/renderer/src/character-lighting-math.ts`; `packages/renderer/test/character-lighting-math.test.ts`; `packages/renderer/src/character-mtoon.ts`; `packages/renderer/test/character-mtoon.test.ts`; `packages/renderer/test/character-lighting-frame.test.ts`; `apps/desktop/src/components/AvatarLightingFields.svelte`; `apps/desktop/src/editor/avatar-lighting.ts`; `apps/mcp/test/avatar-lighting.integration.test.ts`; `scripts/lighting-stage/build_lighting_stage.py`; `fixtures/shows/lighting-demo.osekai`; `docs/evaluation/character-lighting.md` and its images.
- Changed: `packages/contracts/src/index.ts`, `schema.ts`, `types.ts`, `property-registry.ts`; `packages/session/src/scene-ops.ts`, `overrides.ts`; `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`; `packages/renderer/src/assets.ts`, `avatar-pose.ts`, `renderer.ts`, `environment-light.ts`, `scene-lights.ts` (R4 lowers the fixed-ambient share there); `apps/desktop/src/editor/model.ts`, `lights.ts`, `authoring.ts`, `inspector-sections.ts`, `property-defaults.ts`, `live-fields.ts`, `slider.ts`; `apps/desktop/src/components/Inspector.svelte`; `apps/mcp/src/server.ts`; the tests `apps/desktop/test/editor-model.test.ts`, `inspector-sections.test.ts`, `property-defaults.test.ts`, `authoring.test.ts`, and `packages/contracts/test/property-registry.test.ts`; `fixtures/cloud/manifest.json`; `docs/testing.md`; `package.json`; `docs/warudo-parity.md` (MAT-01 and ENV-07 rows); `ARCHITECTURE.md` (the character lighting data path on the output path).
- No change: three and three-vrm versions, `patches/@pixiv__three-vrm@3.5.5.patch`, the frame format, the OBS page code, Tauri IPC for images, props and environment materials.

## O — Operations

1. Add the group (R1). Write the failing contract tests first:
   - An avatar with and without `lighting` parses.
   - Each field at its minimum and its maximum parses.
   - `rimStrength 2.01`, `rimWidth -0.01`, `shadowStrength 1.01`, `environmentFill 2.01`, `rimTint 'red'`, and an extra key fail.
   - `setAvatarLighting` with a group and with `null` parses.
   - `avatarLighting` of an avatar without a group equals `DEFAULT_AVATAR_LIGHTING`.

   Then write the session test. The operation sets the group. `null` deletes it. The operation on a camera fails with `INVALID_INPUT` and `Entity is not an avatar`. Then add the Rust struct, the ranges, the field, the operation, and the vectors. Run `pnpm vitest run packages/contracts packages/session` and `direnv exec . cargo test -p opensekai-contracts`. Commit: `Add the avatar lighting group and its patch operation.`
2. Add the math (R2) with unit tests:
   - `toonShading(0.5, 0, 0.9, 0, 1) === 0`; `toonShading(0.5, 0, 0.9, 0, 0) === 1`; `toonShading(0.5, 0, 0.9, 0, 0.6) ≈ 0.4`; `toonShading(-0.5, 0, 0.9, 1, 1) === 0`.
   - `rimFactor(0.05, -1, 0.5) > 0.5`; `rimFactor(0.05, 1, 0.5) === 0` (light in front); `rimFactor(1, -1, 0.5) === 0` (face center); `rimFactor(0.5, -1, 1) > rimFactor(0.5, -1, 0)`.
   - `equalize([1, 0, 0], [0, 0, 1], 1)` equals `[0, 0, 1]`; factor 0 returns the sample.
   - `characterFill`:
     - No light entity gives `[1, 1, 1]`.
     - One Ambient `#ff0000` with intensity 0.5 gives `[0.5, 0, 0]`.
     - The same light hidden gives `[0, 0, 0]`.
     - The same light with `affectCharacters` false gives `[0, 0, 0]`.
     - Two Ambient lights add.
   - Commit: `Add the character lighting math.`
3. Add the material (R3) with renderer tests and no GPU draw:
   - A small VRM 0.x MToon GLB built in the test, loaded through `createAssetLoader`, gives `CharacterMToonMaterial` for the surface and for its outline clone. `isMToonNodeMaterial` is true. `isLitMaterial` is true.
   - `_IndirectLightIntensity` 0.3 gives `giEqualizationFactor 0.7`. A missing property gives `0.9`.
   - `clone()` keeps `rimStrength`, `rimWidth`, `shadowStrength`, `environmentFill`, and `giEqualizationFactor`, and `rimTint`.
   - The outline clone does not get the added rim and does not get the environment fill. Test that the outline code path does not add either term.
   - A rim term scales with the light color, so a hidden light (intensity 0) adds no rim.
   - The `mtoon-uv` per-frame test still passes with the new class.
   - Run `pnpm vitest run packages/renderer`. Run the material profiles headless check `docs/evaluation/material-profiles/headless-check.mjs` on WebGPU and WebGL 2: each fixture loads and no run has a pipeline compile failure. Update `ARCHITECTURE.md` in this commit: the material, the shader terms, and the loader `materialType`. CLAUDE.md requires the update in the commit that adds the data path, not only in operation 8. Commit: `Light MToon avatars with shadows to the shade color, a back-light rim, and an environment fill.`
4. Add the wiring (R4) with tests through the renderer frame path, as the MAT-01 UV test does:
   - An avatar without `lighting` gets the default values on each `CharacterMToonMaterial`.
   - `setAvatarLighting` with `rimStrength 2` changes the property, and the material `version` does not change.
   - Two avatar entities of the same asset with different values keep their own values.
   - A scene with no light entity gives the fill uniform `[1, 1, 1]`. An Ambient `#336699` with intensity 1 gives that color in linear values. A hidden Ambient light removes its share.
   - A scene with no light entity gives no `Pipeline compile failed`.
   - Run `pnpm vitest run packages/renderer`. Update `ARCHITECTURE.md` in this commit: the per-renderer `CharacterShare`, the fill color, and the per-frame lighting values. CLAUDE.md requires the update in the commit that adds the data path, not only in operation 8. Commit: `Apply each character's lighting values and the scene fill on each frame.`
5. Add the editor, MCP, and Blueprint parts (R5) with tests:
   - `model.setAvatarLighting` sends one operation and refuses a non-avatar.
   - An avatar has a `lighting` Inspector section.
   - The reset mark shows for a value that differs from the default.
   - MCP stdio `scene_patch` with `setAvatarLighting` changes the revision. An out-of-range value fails with `INVALID_INPUT`.
   - Blueprint `rimStrength` reads the default and writes through `setAvatarLighting`.
   - Run `pnpm vitest run apps/desktop apps/mcp packages/contracts packages/session` and `pnpm check`. Commit: `Add character lighting controls to the Inspector, MCP, and Blueprints.`
6. Add the default rig (R6). The test checks that a new scene has `camera_main`, `light_key`, `light_back`, and `light_fill`. It has 3 lit lights and 1 shadow light. The −Z axis of `BACK_LIGHT_ROTATION` equals the normalized `[1.5, -1.8, 3]` within 1e-5. The scene passes `ShowSceneSchema`. Commit: `Start a new scene with a key, back, and fill light.`
7. Add the demo stage and show (R7). Build the GLB with `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/lighting-stage/build_lighting_stage.py -- --out <scratchpad>/lighting-stage.glb`, then validate it. Ask the owner before the upload. Add the manifest entry and run `pnpm exec tsx scripts/prepare-fixtures.ts`. Write the show. Add it to the fixture show parse test if one exists. Commit: `Add the lighting demo stage and show.`
8. Tune and record the evidence (R8). Build from this worktree and launch the dev app (check `pgrep` first). Capture before and after for the eight avatars. Tune the defaults and the constants. Check the demo show in the preview and in OBS. Measure the cost. Write `docs/evaluation/character-lighting.md`. Update the parity rows, `ARCHITECTURE.md`, and the status of this contract. Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `direnv exec . cargo fmt --check`, `direnv exec . cargo clippy`, and `direnv exec . cargo test --workspace`. Then run `direnv exec . cargo sweep --time 7`. Commit: `Record the character lighting evidence.`
9. After the owner look check, push and open one PR for the branch. Name the schema change in the PR summary and in the test plan: the field is optional, so there is no migration file.

## N — Norms

- Use functional TypeScript and plain data. Match the compact style of the files you touch (`grading.ts`, `environment-light.ts`, `scene-lights.ts`, `mtoon-uv.ts`).
- Add a comment only when the shader logic is hard to follow.
- Use `pnpm` and `direnv exec .` for each command that compiles Rust.
- Rendering and simulation stay independent of Svelte. The desktop UI uses `@oshi-connect/ui`. It has no new UI copy except the labels of R5.
- Tests:
  - Unit tests cover the pure math, the schema defaults, and the range checks.
  - Renderer tests run at the real loader and the frame path.
  - One MCP integration test runs at the process boundary.
  - No test covers static copy.
  - A browser or OBS check covers the look.
- Prose follows ASD-STE100. Commit messages are short, imperative, full sentences, with no agent attribution.

## S — Safeguards

- Do not make an avatar in an existing show look worse. Do not give a face hard, dark shadow bands. Do not make a rim glow on all edges at all times. Do not wash out a face.
- Do not stop an authored MToon value (shade color, shading shift, toony, parametric rim, matcap, outline) from working. Do not overwrite it. The added rim never replaces the authored rim.
- Do not give an outline material the added rim or the environment fill.
- Do not give the OBS output a gray veil, a bright fringe, or a background alpha that is not 0.
- Do not make the Editor stall for a light change longer by a large amount. A stall more than 20 % longer at 8 lit lights is a failure. Do not let a light set at the limit fail with `Pipeline compile failed`.
- Do not let the preview and the OBS client draw the same frame differently. Each value is a property of the applied frame, with no wall-clock input.
- Do not recompile for a value change. A light-set change is the only recompile trigger.
- Do not change the three or three-vrm version. Do not add a package patch. Keep `patches/@pixiv__three-vrm@3.5.5.patch`, and use `normalView` in the overridden `direct()`.
- Do not use module-level state for the fill color or the room map. Use one `CharacterShare` for each renderer.
- Do not add specular reflection of the room map on an avatar. Props and environments keep `RoomStandardMaterial`.
- Do not send image data through Tauri IPC on the output path.
- Do not add UI copy other than the labels of R5. Do not add a card grid, a gradient, or a badge.
- Do not commit an avatar file. A render of the private `fixture_vrm0_arkit` is permitted as evidence (docs/testing.md, Fixtures).
- Do not commit another agent's unfinished work. Do not attribute a commit to an agent.
- Do not claim MAT-01, ENV-07, or a look on macOS, WebGL 2, Windows, a real GPU, or OBS from the cloud run. The look, the rim, the shadow color, the alpha on the OBS output, and the cost need the owner check on macOS (`accept:local`). MAT-01 and ENV-07 stay unchecked until then. An unavailable measurement is unknown, never zero.
- Do not push or open the PR before the owner look check.
