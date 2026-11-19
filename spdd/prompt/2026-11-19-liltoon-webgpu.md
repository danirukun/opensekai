# REASONS: lilToon on WebGPU

Date: 2026-11-19. Analysis: [lilToon on WebGPU](../analysis/2026-11-19-liltoon-webgpu.md). Design: [lilToon on WebGPU design](../../docs/superpowers/specs/2026-11-19-liltoon-webgpu-design.md). Plan: [lilToon on WebGPU plan](../../docs/superpowers/plans/2026-11-19-liltoon-webgpu.md). Issues: [#269](https://github.com/danirukun/opensekai/issues/269) (spike), [#74](https://github.com/danirukun/opensekai/issues/74) (MAT-02, slice 1), [#75](https://github.com/danirukun/opensekai/issues/75) (MAT-03, later). Related: [character lighting](2026-11-19-character-lighting.md) (the template of the material subclass and the room fill), [material parameter control](2026-11-16-material-parameter-control.md) (B38, the `materialReport` read side), [material profiles](2026-11-03-material-profiles.md).

Status: planned. Not implemented. Each requirement R1 to R10 is open. The owner look check is open. Not verified: all behavior, WebGL 2, Windows, and GPU time.

## R — Requirements

1. **Sample avatar and versions** (plan Task 2). A lilToon sample avatar exists on the owner machine. It is Catboy with lilToon materials, exported with `MOCHIYA_materials_liltoon`.
   - The tool versions are Unity 6000.0.71f1 (Unity 6.0 LTS), UniGLTF and UniVRM (VRM10) 0.131.4 from the UPM Git URLs at tag `v0.131.4`, lilToon 2.4.1, and Mochiya Avatar Tools at the latest commit of `mochiya-labs/unity-avatar-tools` (the commit is recorded). The package 0.115.0 in Downloads is not used.
   - The sample uses each feature of the slice: a second and a third shadow band on the skin and the hair, a matcap on the hair, a rim and a backlight, emission on one part, one cutout material, one transparent material, and an outline.
   - `versions.json` has the keys `unity`, `univrm`, `liltoon`, `mochiyaAvatarTools` (the commit), and `exportPath` (`"mochiya"` or `"inject"`). When the exporter refuses the avatar, a UniVRM export plus a script writes the extension (`"inject"`), and the evidence says which path made the sample.
   - Test: the glTF JSON of the file shows, for each converted material, the extension with `specVersion` `"1.3"`, a `shaderVariant`, and texture indices that resolve. One material object passes `schema/MOCHIYA_materials_liltoon.schema.json` of the fork. Each property of lilToon 2.4.1 that the fork does not know is recorded.
   - The Unity project and the export stay outside the repository. Reference 1 is a Unity Game view capture under one directional light (intensity 1, rotation (50, −30, 0)), ambient (0.2, 0.2, 0.2), camera (0, 1.3, 1.6) to (0, 1.3, 0), field of view 35°, 1920 × 1080. The README records these values.
2. **Fork `webgpu` entry and import rule** (plan Task 3). The fork `danirukun/three-liltoon`, branch `webgpu`, has the entry `@mochiya/three-liltoon/webgpu` that resolves to `dist/webgpu.js` and `dist/webgpu.d.ts`.
   - `npm run build:webgpu` is `npm run generate && tsup --config tsup.webgpu.config.ts`. The entry is ESM. It does not change `dist/index.js` (`git diff --stat dist/index.js` is empty).
   - The entry imports only `three`, `three/webgpu`, `three/tsl`, `three/examples/jsm/*`, `@pixiv/three-vrm` (the VRM hook only), and pure-data modules of the fork. It never imports `LilToonMaterial`, `src/generated/shaders.ts`, or `src/renderer/*`.
   - The entry exports `LilToonNodeMaterial`, `GLTFLilToonNodeExtension`, `enableLilToonNodeVRM`, and `LILTOON_NODE_FEATURES`.
   - Test (fork): a source scan of `src/webgpu.ts` and `src/webgpu/**` finds no import of `LilToonMaterial`, `generated/shaders`, or `renderer/`. The fork keeps `LICENSE` (MIT, Mochiya) and `THIRD_PARTY_NOTICES.md` (lilToon MIT). The fork commits the built `dist/`. The peer range stays `three >=0.180.0 <0.190.0`.
3. **Slice-1 feature list and warnings** (plan Tasks 4 and 6). `LilToonNodeMaterial` extends `NodeMaterial` and reads lilToon property names from a plain property object. The data is the same as the glTF extension.
   - The slice-1 features are: main color and texture with `_MainTex_ST`; light limits (`_LightMinLimit`, `_LightMaxLimit`, `_MonochromeLighting`, `_ShadowEnvStrength`, `_AsUnlit`); first, second, and third shadow; normal map (first); rim; backlight; matcap (first); emission (first); opaque, cutout, and transparent (normal and one-pass) variants; outline variants. `LILTOON_NODE_FEATURES` is `shadow`, `shadow3rd`, `normal1st`, `matcap`, `rim`, `emission1st`, `backlight`, and `outline`.
   - `nodeWarnings(name, properties, textures)` gives one `unsupported-feature` warning for each enabled feature outside the list. The warning names the lilToon property. `{_UseMain2ndTex: 1}` gives one warning with `property` `_UseMain2ndTex`. `{_UseShadow: 1, _UseRim: 1}` gives none.
   - A `shaderVariant` outside the slice (`Fur`, `Gem`, `Refraction`, or an unknown name) loads as the opaque core with a warning. The load does not fail.
   - A texture entry with a missing or bad index uses a neutral default texture and gives a warning. The load does not fail.
   - A scalar property change is a uniform write and does not change the material `version`. A change of a `_Use*` toggle or of a texture presence changes `customProgramCacheKey()` and recompiles.
   - A cutout variant sets `alphaTest` to `_Cutoff` and `transparent` to false. A transparent variant sets `transparent` to true and `depthWrite` to false. `_BumpMap` has linear color space and `_MainTex` has sRGB.
   - `clone()` gives a material with its own property values. A `setProperty` on the clone does not change the source.
4. **Lighting model** (plan Task 5). `LilToonLightingModel` is a TSL `LightingModel`.
   - `direct()` runs for each light. It computes the band of each enabled shadow (first, second, third) from N·L with the light shadow folded in, and the first, second, and third border, blur, and color. It adds the light color times `UNITY_LIGHT_SCALE` to a summed light and to a weight for each band.
   - `finish()` applies the light limit (`lilLimitLight`) to the summed light color, not to each light. It mixes the albedo and the shadow colors by the bands (`_ShadowColor`, `_Shadow2ndColor`, `_Shadow3rdColor`, their textures, `_ShadowStrength`). `_AsUnlit` mixes toward the unlit albedo.
   - `indirect()` adds the albedo times the irradiance, with `_ShadowEnvStrength`. The irradiance comes from the hook `roomIrradiance()` or, when the hook returns `null`, from the builder. The hook `receivedShadow(shadow)` returns `shadow` by default.
   - `UNITY_LIGHT_SCALE` is a constant. The start value is `1 / Math.PI`. The calibration (R9) sets the final value.
   - Pure functions have unit tests with values that are evaluated by hand from the lilToon HLSL. The line of the HLSL is in a test comment. `lilBand(0.5, 0.5, 0.1)` is `0.5`, `lilBand(1, 0.5, 0.1)` is `1`, `lilBand(0, 0.5, 0.1)` is `0`, and with blur `0` the band is a step at the border. `lilLimitLight([3, 3, 3], 0.05, 1, 0)` is `[1, 1, 1]`, `lilLimitLight([0, 0, 0], 0.05, 1, 0)` is `[0.05, 0.05, 0.05]`, and with monochrome `1` the three channels are equal.
   - Each TSL function mirrors one pure function. The GPU result is checked in R9, not in a unit test.
   - The light model differs from Unity lilToon for lights other than the main light. The compatibility matrix records the difference.
5. **Outline** (plan Task 6). The outline is a second draw of the mesh with the vertices moved along the normal and front faces culled.
   - `generateLilToonOutlines(root)` sets `mesh.material = [surface, outline]` for each mesh whose material is a `LilToonNodeMaterial` with an outline variant. The outline is `surface.clone()` with `isOutline = true` and `side = BackSide`. It adds the geometry groups `(0, count, 0)` and `(0, count, 1)`, as the three-vrm 3.5.5 MToon outline does.
   - The call is idempotent. A second call keeps two materials. A mesh with a non-outline variant, or with a `MeshBasicMaterial`, does not change.
   - An outline material moves `positionLocal` along `normalLocal` by `_OutlineWidth × 0.01` times the red channel of `_OutlineWidthMask`. The color is `_OutlineColor` (times `_OutlineTex` when set), with the same light limit.
   - Rim, backlight, matcap, emission, and normal map apply only when their `_Use*` toggle is on. A `_MatCapBlendMode` outside 0 to 3 gives a warning and uses 0.
6. **glTF and VRM plugins** (plan Task 7). `GLTFLilToonNodeExtension` (name `MOCHIYA_materials_liltoon`) makes a `LilToonNodeMaterial` for each material that has the extension. Other materials go to the next plugin.
   - `enableLilToonNodeVRM(plugin, options)` wraps `loadMaterial` first, then the original, and chains `afterRoot` after the original.
   - lilToon wins over MToon. A VRM 0 material with both `materialProperties` MToon data and the extension gives a `LilToonNodeMaterial`. The MToon plugin is not called for that index, and no MToon material is made.
   - Spec versions `1.0` to `1.3` are read. Another version gives `spec-version-mismatch` and the material still loads.
   - `afterRoot` makes tangents (`generateIndexedTangents`) for meshes whose lilToon material uses `_BumpMap`, calls `generateLilToonOutlines(gltf.scene)`, and sets `gltf.userData.lilToonWarnings`.
   - A VRM material color bind on a lilToon material gives a warning. Slice 1 has no expression binds.
   - A GLB that is not a VRM and has the extension is not changed by this plugin in OpenSekai. It loads on the PBR path, and the load warning names `MOCHIYA_materials_liltoon`.
   - Test (fork): `GLTFLoader.parse` on in-memory glTF JSON with an embedded buffer and no images. A material with the extension gives `LilToonNodeMaterial`. A material without it gives `MeshStandardMaterial`. `materialType` gives the subclass.
7. **`liltoon` profile, known extension, import check** (plan Task 8). `MaterialProfile` is `'mtoon' | 'unlit' | 'pbr' | 'liltoon'` in TypeScript and in Rust.
   - A material in a VRM file (`extensionsUsed` has `VRMC_vrm` or `VRM`) with `MOCHIYA_materials_liltoon` has the profile `liltoon`, before `mtoon`. The same material with `VRMC_materials_mtoon` next to it reports `liltoon` with `unsupported: []`.
   - A GLB material that is not in a VRM file and has the extension reports `pbr` and lists `MOCHIYA_materials_liltoon` as unsupported.
   - `MOCHIYA_materials_liltoon` is in `MATERIAL_EXTENSIONS`. No parameter applies to a `liltoon` material: `appliedParameters` is `[]`, the model is empty, and `outline` is false. `AssetMaterialSchema` rejects `liltoon` with `outline: true`. Rust rejects `liltoon` with `baseColor`.
   - Rust and TypeScript give the same lists for the shared vectors. `fixtures/protocol/material-names.json` has a `liltoon` case.
   - The Rust import check accepts `MOCHIYA_materials_liltoon` in `extensionsUsed` (it reads only `extensionsRequired`, so a name there passes today) and in `extensionsRequired`: `VRM_REQUIRED` includes it. `registry.rs` accepts a VRM that has it in `extensionsRequired`.
   - `setMaterialValues` does not exist. The slice does not add it. A `liltoon` material is in `material_list` and in the Inspector with no editable parameter.
8. **`CharacterLilToonMaterial`** (plan Task 9). `class CharacterLilToonMaterial extends LilToonNodeMaterial` is in `packages/renderer/src/character-liltoon.ts`.
   - It has `isCharacterLilToonMaterial` true, `characterShare: CharacterShare | null`, `shadowStrength` (default `DEFAULT_AVATAR_LIGHTING.shadowStrength`), and `environmentFill` (default `DEFAULT_AVATAR_LIGHTING.environmentFill`).
   - Fill: `roomIrradiance()` returns the share SH irradiance at `normalWorld` times `environmentFill`, plus the share `fill` times `CHARACTER_AMBIENT`. The indirect terms mirror `CharacterMToonMaterial` exactly, with the same constants and no new numbers. An outline gets no fill.
   - Shadow Strength: `receivedShadow(s)` returns `mix(1, s, shadowStrength)`, read through `materialReference`. It scales only the cast shadow from the shadow map. It does not change the authored bands. The default 0.6 keeps the band contrast of the Unity material.
   - Environment Fill scales the room fill. Rim Strength, Rim Width, and Rim Tint have no effect. The OpenSekai back-light rim is not added. The authored lilToon rim and backlight stay.
   - A lilToon material joins the `characters` light group and gets the `characterShare`. In `assets.ts`, the VRM plugin is `enableLilToonNodeVRM(new VRMLoaderPlugin(...), {materialType: CharacterLilToonMaterial, onWarning})` and uses `CharacterMToonMaterial` for the other materials. Each warning goes to the load warnings as `UNSUPPORTED` with the material name and the lilToon property.
   - `avatar-pose.ts` collects both material kinds in `characters`. `lighting(values)` writes `shadowStrength` and `environmentFill` to both kinds, and `rimStrength`, `rimWidth`, and `rimTint` only to MToon. A write does not change the material `version`. `renderer.ts` sets `characterShare` on both kinds.
   - An avatar with lilToon and MToon materials gets the room fill and the per-frame Lighting values on both kinds.
   - Two loads of the same bytes give distinct material objects. `dispose()` disposes the outline materials. `disposeObject` disposes material arrays.
   - A `Hidden/lilToonFur` material gives one `UNSUPPORTED` load warning.
   - All material compiles go through the existing `compileOnce` queue. The material compiles on the WebGPU backend and on the WebGL 2 fallback of `WebGPURenderer`.
   - The fork is a pnpm git dependency at a fixed commit in `packages/renderer`. `ARCHITECTURE.md` and `docs/dependencies.md` change in the same commit as the dependency.
9. **Evidence** (plan Task 10). `docs/evaluation/liltoon-webgpu.md` records the evidence with the backend, the quality profile, the fixture revision, and the commit of both repositories.
   - Calibration: with one directional light at the Unity rotation, Ambient (0.2, 0.2, 0.2), and the camera of R1, the ratio of the mean luminance of the face band to `unity-reference.png` is within 0.95 to 1.05 at the default OpenSekai directional intensity. The final `UNITY_LIGHT_SCALE` and the ratio are recorded.
   - Three captures of the sample with one directional light and the same camera: 1, the Unity Game view; 2, the upstream three-liltoon WebGL viewer; 3, OpenSekai on WebGPU. The default new-scene rig and `fixtures/shows/lighting-demo.osekai` with the sample are also captured.
   - OBS output on an isolated test scene, with no stream and no recording: alpha over black, white, and checker; two screenshots 4 s apart with the Editor minimized differ; the output CPU time and `outputSkippedFrames`.
   - Stall gate: the Editor stall for a spot light add at 1, 3, and 8 lit lights, for the lilToon sample and for the MToon Catboy, after a Metal shader cache clear and an app restart. The add at 8 lit lights is not more than 20 % longer for the sample than for the MToon Catboy. A longer stall is a failure. Then the shader must get cheaper before the work ships.
   - WebGL 2: the headless check on both backends gives no `Pipeline compile failed`.
   - A compatibility matrix in `docs/evaluation/`: each row of the `FEATURE_MATRIX` of three-liltoon with the WebGL state upstream, the TSL state in this slice, and the source. It lists the differences from Unity (a band for each light, no expression binds, no UV scroll).
   - `docs/warudo-parity.md` MAT-02 becomes partial and claims only what was verified. An unavailable measurement is unknown, never zero.
10. **#269 decision** (plan Task 10). A comment on #269 states one decision for the next slices: continue with slice 2, defer, or stop. It gives the reason from the evidence. The decision is about the next slices, not about this slice. It is posted after the owner approves the look.

## E — Entities

- Fork `danirukun/three-liltoon`, branch `webgpu`: `src/webgpu.ts`, `src/webgpu/properties.ts`, `LilToonNodeMaterial.ts`, `lilToonMath.ts`, `LilToonLightingModel.ts`, `lilToonShading.ts`, `outlines.ts`, `GLTFLilToonNodeExtension.ts`, `vrm.ts`, `tsup.webgpu.config.ts`, and the built `dist/webgpu.*`.
- `LILTOON_NODE_FEATURES`, `LILTOON_NODE_VARIANTS`, `nodeVariant`, `nodeProperties`, and `nodeWarnings`. `LilToonNodeMaterial` with `isLilToonNodeMaterial`, `variant`, `isOutline`, `setProperty`, `getProperty`, `setTexture`, `getWarnings`, and the hooks `receivedShadow` and `roomIrradiance`.
- `lilBand`, `lilLimitLight`, `UNITY_LIGHT_SCALE`, and `LilToonLightingModel`.
- `generateLilToonOutlines`, `GLTFLilToonNodeExtension`, and `enableLilToonNodeVRM`.
- The glTF extension `MOCHIYA_materials_liltoon` (spec 1.3): `specVersion`, `lilToonVersion`, `shaderVariant`, `properties`, `textures`, `cubeTextures`.
- OpenSekai: `CharacterLilToonMaterial` in `character-liltoon.ts`; the existing `CharacterShare`, `createCharacterShare`, `CHARACTER_AMBIENT`, and `AvatarLighting` as inputs; the `characters` union in `avatar-pose.ts`.
- `MaterialProfile` with the value `liltoon`, and `MATERIAL_EXTENSIONS` with `MOCHIYA_materials_liltoon`, in `packages/contracts` and in `crates/contracts`; `profile()` in `apps/desktop/src-tauri/src/assets/materials.rs`; `VRM_REQUIRED` in `apps/desktop/src-tauri/src/assets/mod.rs`.
- The local fixture `fixture_vrm_liltoon` in `fixtures/local/manifest.json` (git-ignored). The sample files `Catboy-lilToon.vrm`, `versions.json`, and `unity-reference.png`.
- No change to the frame format, the show schema version, the asset record schema, or the wire API. No new patch operation.

## A — Approach

- **Sample first.** The sample avatar and reference 1 come first (R1), because the fork and the calibration need them.
- **Fork material without lights, then the light model.** Entry and build (R2), then the properties and the base material (R3), then the light model (R4), then rim, backlight, matcap, emission, normal map, and outline (R3, R5), then the plugins and the pushed commit (R6).
- **OpenSekai integration.** The profile and the import check (R7) need no fork code and can run before the integration. The renderer integration (R8) uses the pinned commit of the fork.
- **Port from the HLSL.** Each equation comes from lilToon 2.3.4 `lil_common_frag.hlsl` and `lil_common_functions.hlsl` (`vendor/lilToon` at `72fc096`). Each new TSL file that ports HLSL starts with one comment line that names the source file.
- **Pure math first.** Each equation is a pure function with a unit test. The TSL function mirrors it.
- **Mirror the MToon character material.** `CharacterLilToonMaterial` uses the share, the constants, and the per-frame binding of `CharacterMToonMaterial`. It overrides two hooks and adds no new light term.
- **Uniforms for values.** A value change is a uniform write. A feature toggle, a texture presence, and a light-set change are the recompile triggers.
- **Evidence last.** Calibration, three captures, OBS, stall, and WebGL 2 (R9). The owner looks at the captures before the push.

## S — Structure

- New (fork): `src/webgpu.ts`; `src/webgpu/properties.ts`, `LilToonNodeMaterial.ts`, `lilToonMath.ts`, `LilToonLightingModel.ts`, `lilToonShading.ts`, `outlines.ts`, `GLTFLilToonNodeExtension.ts`, `vrm.ts`; `tsup.webgpu.config.ts`; `test/webgpu/entry.test.ts`, `properties.test.ts`, `material.test.ts`, `math.test.ts`, `lighting.test.ts`, `shading.test.ts`, `outlines.test.ts`, `gltf.test.ts`; `dist/webgpu.js` and `dist/webgpu.d.ts`.
- Changed (fork): `package.json` (export `./webgpu`, script `build:webgpu`, dev dependency `three` 0.187.0 and the matching `@types/three`), `package-lock.json`, `README.md` (a WebGPU section).
- New (OpenSekai): `packages/renderer/src/character-liltoon.ts`; `packages/renderer/test/character-liltoon.test.ts`; `packages/renderer/test/liltoon-avatar.integration.test.ts`; `tools/liltoon-sample/README.md`, `Editor/LilToonSampleConvert.cs`, `Editor/LilToonSampleExport.cs`; `docs/evaluation/liltoon-webgpu.md` and `docs/evaluation/liltoon-webgpu/` (Catboy images only); `spdd/analysis/2026-11-19-liltoon-webgpu.md` and this file.
- Changed (OpenSekai): `packages/contracts/src/materials.ts`, `material-parameters.ts`; `crates/contracts/src/lib.rs`; `apps/desktop/src-tauri/src/assets/materials.rs`, `mod.rs`; `fixtures/protocol/material-names.json`; `packages/renderer/package.json`, `pnpm-lock.yaml`, `src/assets.ts`, `src/avatar-pose.ts`, `src/renderer.ts`; `ARCHITECTURE.md`; `docs/dependencies.md`; `docs/warudo-parity.md`; the tests `packages/contracts/test/materials.test.ts`, `material-parameters.test.ts`, `crates/contracts/tests/material_list.rs`, and the Rust tests in `materials.rs` and `registry.rs`.
- Local only, never committed: the Unity project, `Catboy-lilToon.vrm`, and `fixtures/local/manifest.json`.
- No change: three (0.187.0) and three-vrm (3.5.5) versions, `patches/@pixiv__three-vrm@3.5.5.patch`, the MToon path, `character-mtoon.ts`, the frame format, the OBS page code, and Tauri IPC for images.

## O — Operations

1. Make the sample (R1). Make the Unity project, convert Catboy with `LilToonSampleConvert.Run()`, export with `LilToonSampleExport.Run()`, check the file JSON with `python3 -I`, and capture reference 1. Commit the README and the scripts: `Add the Unity scripts that make the lilToon sample avatar.`
2. Make the fork entry (R2). Fork and clone, switch to `webgpu`, run `npm run generate`. Write the failing entry test, then the placeholder exports, the tsup config, and the `package.json` changes. Commit in the fork: `Add the webgpu entry.`
3. Add the properties and the base material (R3). Write the failing tests (`nodeVariant`, `nodeProperties`, `nodeWarnings`, the alpha modes, the uniform rule, the clone rule), then the code. Commit in the fork.
4. Add the lighting model (R4). Write the failing math tests, then `lilToonMath.ts` and the TSL model. Commit in the fork.
5. Add rim, backlight, matcap, emission, normal map, and outline (R3, R5). Write the failing outline and cache-key tests, then the code. Commit in the fork.
6. Add the plugins, build, and push (R6). Write the failing `GLTFLoader.parse` tests, including the lilToon-over-MToon case. Run `npx vitest run`, `npm run build:webgpu`, and `npx tsc --noEmit -p .`. Commit `src`, `test`, `README.md`, `package.json`, `package-lock.json`, `tsup.webgpu.config.ts`, and `dist/webgpu.*`. Push `webgpu` to the fork. Record the commit.
7. Add the profile and the import check (R7). Write the failing TypeScript and Rust tests and the shared vector first. Then change contracts, the Rust crate, `profile()`, and `VRM_REQUIRED`. Run `pnpm test:unit -- packages/contracts` and, through `direnv exec .`, the Rust tests. Commit: `Report lilToon avatar materials as the liltoon profile.`
8. Integrate the renderer (R8). Add the pinned git dependency and run `pnpm install`. Write the failing renderer tests (the five review cases in the Safeguards, and the warning test). Add `CharacterLilToonMaterial`, the loader plugin order, the `avatar-pose.ts` union, and the `renderer.ts` share. Run `pnpm check`, `pnpm test:unit`, and `pnpm test:integration`. Update `ARCHITECTURE.md` and `docs/dependencies.md`. Commit everything in one commit: `Draw lilToon avatars with a WebGPU node material.`
9. Calibrate and record the evidence (R9). Run the app from this worktree (`direnv exec . pnpm dev:desktop`) and use MCP `scene_replace`. Calibrate `UNITY_LIGHT_SCALE`. Capture references 2 and 3, run the OBS check, the stall script, and the WebGL 2 check. Write the evidence page and the compatibility matrix. Update `docs/warudo-parity.md` and the Status of this contract. Commit: `Record the lilToon on WebGPU evidence.`
10. Owner look check and finish (R9, R10). Show the three captures to the owner. After approval, push the branch, open the pull request, post the #269 decision comment, and run `direnv exec . cargo sweep --time 7`.

## N — Norms

- Use functional TypeScript and plain data. Add a comment only when the logic is hard to follow. Each TSL file that ports lilToon HLSL starts with one comment line that names the lilToon 2.3.4 source file.
- Use pnpm in OpenSekai. The fork keeps the npm of upstream. Run each cargo and each Rust-compiling pnpm command through `direnv exec . <command>`.
- Use `@oshi-connect/ui` for Svelte UI. This slice adds no UI and no UI copy.
- Tests:
  - Unit tests cover pure math, the property and warning functions, and the profile rules.
  - The renderer tests run at the real loader and the frame path.
  - A browser or OBS check covers the look.
  - No test covers static copy.
  - A unit test of a GPU result is not written. The GPU result comes from the running app.
- The fork keeps the MIT license notices of three-liltoon and lilToon.
- Prose follows ASD-STE100. Commit messages are short, imperative, full sentences, with no agent attribution and no `Co-Authored-By` trailer.
- Verify `pwd` before Git operations. Do not use `git -C` or a compound `cd`. Do not use a bare `git stash`.

## S — Safeguards

- Do not commit an avatar file (`.vrm`, an avatar `.glb`, `.warudo`) or a Unity project. Only Catboy images go into the repository.
- Do not change the MToon path. A VRM without the extension loads as it does now. Do not change the three or three-vrm version. Do not add a package patch.
- Do not make a lilToon avatar look much less like the Unity reference than necessary. When the Unity reference and the MToon version differ, the Unity reference decides. The MToon comparison is recorded and does not fail the check.
- Do not stall the Editor on a light change by more than 20 % over the MToon Catboy at 8 lit lights. Do not let a light set at the limit fail with `Pipeline compile failed`.
- Do not regress an MToon avatar, the OBS alpha, or the output with the Editor minimized.
- Do not give the OBS output a gray veil, a bright fringe, or a background alpha that is not 0.
- Do not let an enabled feature outside the slice fail the load. It gives a warning that names the lilToon property.
- Review cases, each with a test:
  1. A VRM material with the extension and MToon data gets the lilToon material and no MToon material.
  2. An avatar with lilToon and MToon materials gets the room fill and the per-frame Lighting values on both kinds.
  3. A `shaderVariant` outside the slice loads as the opaque core with a warning.
  4. A bad texture index uses a neutral default texture with a warning.
  5. Two instances of the same lilToon avatar do not share material state, and a remove disposes the outline materials.
- Do not apply Rim Strength, Rim Width, or Rim Tint to a lilToon material. Do not add the OpenSekai back-light rim to it. Do not let Shadow Strength change the authored bands.
- Do not give an outline material the room fill.
- Do not add a continuous image readback, a JPEG encode, or an image stream through Tauri IPC on the output path. Do not use module-level state for the fill. Use the `CharacterShare` of the renderer.
- Do not recompile for a scalar value change.
- Do not add `setMaterialValues`, or write PBR or MToon values to a `liltoon` material. Editable lilToon values are a later slice.
- Do not make a GLB prop use the lilToon material. It loads on the PBR path, and the warning names the extension.
- Do not import `LilToonMaterial`, the generated GLSL, or `src/renderer/*` in the fork `webgpu` entry.
- Do not start `.warudo` import in this slice. The rights review of the [workshop study](../../docs/superpowers/specs/2026-10-17-warudo-workshop-research.md) gates it.
- Do not claim MAT-02, a look on macOS, WebGL 2, Windows, a real GPU, or OBS from the cloud run. The look, the alpha, and the cost need the owner check on macOS. An unavailable measurement is unknown, never zero.
- Do not publish the fork to npm or open a pull request on upstream. Do not push or open the pull request in OpenSekai before the owner look check. Do not start a live stream for a check.
- Do not commit another agent's unfinished work. Do not attribute a commit or a pull request to an agent.
