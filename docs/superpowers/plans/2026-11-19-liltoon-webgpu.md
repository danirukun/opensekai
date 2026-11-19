# lilToon on WebGPU Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load a VRM avatar whose materials carry `MOCHIYA_materials_liltoon` in OpenSekai and draw it with a TSL lilToon material on the WebGPU renderer (and its WebGL 2 fallback).

**Architecture:** A fork of `mochiya-labs/three-liltoon` gets a `webgpu` entry: `LilToonNodeMaterial` (a `NodeMaterial` with a lilToon lighting model), a glTF plugin, and a VRM hook. OpenSekai subclasses the material as `CharacterLilToonMaterial` (as `CharacterMToonMaterial` subclasses `MToonNodeMaterial`) to connect the room fill and the avatar Lighting values, adds a `liltoon` material profile, and depends on the fork at a fixed commit.

**Tech Stack:** three r187 (`three/webgpu`, `three/tsl`), `@pixiv/three-vrm` 3.5.5, TypeScript, tsup (fork), vitest, Rust (contracts and asset import), Unity 6000.0.71f1 with UniVRM 0.131.4, lilToon 2.4.1, Mochiya Avatar Tools.

**Spec:** `docs/superpowers/specs/2026-11-19-liltoon-webgpu-design.md`

## Global Constraints

- Never commit an avatar file (`.vrm`, `.glb` of an avatar, `.warudo`, Unity project). Only Catboy images go into the repository.
- No agent attribution in commits or pull requests. No `Co-Authored-By` agent trailer.
- Run each cargo and each Rust-compiling pnpm command through `direnv exec . <command>`. Run `direnv allow` once in this worktree first.
- Do not use `git -C` or a compound `cd`. Verify `pwd` before Git operations. No bare `git stash`.
- OpenSekai uses pnpm. The fork keeps upstream's npm.
- three is `0.187.0` and `@pixiv/three-vrm` is `3.5.5` in OpenSekai. The fork's peer range stays `three >=0.180.0 <0.190.0`.
- All OpenSekai material compiles go through the existing `compileOnce` queue.
- The fork keeps `LICENSE` (MIT, Mochiya) and `THIRD_PARTY_NOTICES.md` (lilToon MIT). Each new TSL file that ports lilToon HLSL starts with one comment line that names the source file in lilToon 2.3.4 (`vendor/lilToon` at `72fc096`).
- The fork's `webgpu` entry imports only `three`, `three/webgpu`, `three/tsl`, `three/examples/jsm/*`, `@pixiv/three-vrm` (VRM hook only), and pure-data modules of the fork. It never imports `LilToonMaterial`, `src/generated/shaders.ts`, or `src/renderer/*`.
- Slice 1 features (exact list): main color and texture with `_MainTex_ST`; light limits (`_LightMinLimit`, `_LightMaxLimit`, `_MonochromeLighting`, `_ShadowEnvStrength`, `_AsUnlit`); first, second, third shadow; normal map (first); rim; backlight; matcap (first); emission (first); opaque, cutout, transparent (normal and one-pass) variants; outline variants. Every other enabled feature gives an `unsupported-feature` warning.
- Avatar Lighting group on a lilToon material: Environment Fill scales the room fill; Shadow Strength scales only the cast shadow (`mix(1, shadow, shadowStrength)`); Rim Strength, Rim Width, Rim Tint have no effect.
- Light unit: the lilToon light color is the three light color times `UNITY_LIGHT_SCALE`. Its start value is `1 / Math.PI`. Task 10 calibrates it against the Unity reference and records the final value.
- Long prose (docs, spec, PR) is ASD-STE100. ARCHITECTURE.md changes in the same commit as the new dependency and the new data path.
- Sample tool versions: Unity 6000.0.71f1, UniGLTF and UniVRM (VRM10) 0.131.4 from the UPM Git URLs at tag `v0.131.4`, lilToon 2.4.1, Mochiya Avatar Tools at the latest commit of `mochiya-labs/unity-avatar-tools`.

## Review Focus

1. A VRM material with both `MOCHIYA_materials_liltoon` and MToon data: the lilToon material wins, and no MToon material is made for it.
2. An avatar with lilToon and MToon materials mixed: both kinds get the room fill and the per-frame Lighting values.
3. A `shaderVariant` outside slice 1 (`Fur`, `Gem`, `Refraction`, an unknown name): the material loads as the opaque core with a warning; the load does not fail.
4. A lilToon texture entry with a missing or bad index: a neutral default texture is used, with a warning; the load does not fail.
5. Two instances of the same lilToon avatar, then a remove: the instances do not share material state, and the remove disposes the outline materials.

Each item has a test in the task that owns the code (Tasks 4, 6, 8).

## File Structure

Fork (`~/ghq/github.com/danirukun/three-liltoon`, branch `webgpu`):

| File | Responsibility |
| --- | --- |
| `src/webgpu.ts` | Entry: re-exports the public WebGPU API. |
| `src/webgpu/properties.ts` | Pure data: property defaults for a variant, the variant modes, the slice-1 feature set, warnings. |
| `src/webgpu/LilToonNodeMaterial.ts` | The node material: uniforms from properties, textures, alpha modes, outline position, output. |
| `src/webgpu/LilToonLightingModel.ts` | TSL lighting model: shadow bands, light limits, indirect. |
| `src/webgpu/lilToonShading.ts` | TSL functions for rim, backlight, matcap, emission, normal map. |
| `src/webgpu/lilToonMath.ts` | Pure TypeScript copies of the band and limit equations, for unit tests. |
| `src/webgpu/GLTFLilToonNodeExtension.ts` | glTF plugin: makes the node material, tangents, outlines. |
| `src/webgpu/outlines.ts` | Geometry-group outline clones. |
| `src/webgpu/vrm.ts` | `enableLilToonNodeVRM`. |
| `tsup.webgpu.config.ts` | Builds only `dist/webgpu.*`, with `clean: false`. |
| `test/webgpu/*.test.ts` | vitest (node environment). |

OpenSekai:

| File | Responsibility |
| --- | --- |
| `spdd/analysis/2026-11-19-liltoon-webgpu.md`, `spdd/prompt/2026-11-19-liltoon-webgpu.md` | Slice contract. |
| `tools/liltoon-sample/` | Unity editor scripts and README for the sample (no avatar data). |
| `packages/contracts/src/materials.ts`, `material-parameters.ts`, `crates/contracts/src/lib.rs`, `apps/desktop/src-tauri/src/assets/materials.rs`, `apps/desktop/src-tauri/src/assets/mod.rs`, `fixtures/protocol/material-names.json` | `liltoon` profile and the import check. |
| `packages/renderer/src/character-liltoon.ts` | `CharacterLilToonMaterial`. |
| `packages/renderer/src/assets.ts`, `avatar-pose.ts`, `renderer.ts` | Loader and lighting integration. |
| `docs/evaluation/liltoon-webgpu.md` and `docs/evaluation/liltoon-webgpu/` | Evidence and compatibility matrix. |

---

### Task 1: Slice contract

**Files:**
- Create: `spdd/analysis/2026-11-19-liltoon-webgpu.md`
- Create: `spdd/prompt/2026-11-19-liltoon-webgpu.md`

**Interfaces:**
- Produces: requirement IDs R1–R10 that later tasks and the evidence page cite.

- [ ] **Step 1: Write the analysis** from the design: problem, owner intent, the library scan (eight MToon-only VRMs, one `.warudo` with lilToon), the three-liltoon facts (WebGL 2 only, `RawShaderMaterial`, extension format 1.3, committed `dist/`, generated files gitignored), and the B38 state (read side only; `setMaterialValues` does not exist).
- [ ] **Step 2: Write the prompt** with the headings `# REASONS: lilToon on WebGPU`, the Date line linking analysis, design, and this plan, a Status line, then `## R — Requirements`, `## E — Entities`, `## A — Approach`, `## S — Structure`, `## O — Operations`, `## N — Norms`, `## S — Safeguards`. Requirements, one each:
  - R1 sample avatar and its versions;
  - R2 fork `webgpu` entry and its import rule;
  - R3 slice-1 feature list and warnings for the rest;
  - R4 lighting model (per-light bands, clamp on the summed direct light, `UNITY_LIGHT_SCALE`);
  - R5 outline;
  - R6 glTF and VRM plugins (lilToon wins over MToon);
  - R7 `liltoon` profile, known extension, import check;
  - R8 `CharacterLilToonMaterial` (fill, Environment Fill, Shadow Strength, no OpenSekai rim);
  - R9 evidence (three captures, OBS, stall gate ≤ 20 % over MToon Catboy at 8 lit lights, compatibility matrix);
  - R10 #269 decision.
- [ ] **Step 3: Commit** `git add spdd && git commit -m "Add the lilToon on WebGPU slice contract."`

### Task 2: lilToon sample avatar

Owner machine. No repository code except the editor scripts.

**Files:**
- Create: `tools/liltoon-sample/README.md`
- Create: `tools/liltoon-sample/Editor/LilToonSampleConvert.cs`
- Create: `tools/liltoon-sample/Editor/LilToonSampleExport.cs`
- Output (local only): `~/opensekai-liltoon-sample/` (Unity project), `~/opensekai-liltoon-sample/Export/Catboy-lilToon.vrm`, `~/opensekai-liltoon-sample/Export/versions.json`, `~/opensekai-liltoon-sample/Export/unity-reference.png`

**Interfaces:**
- Produces: the sample file path and `versions.json` with keys `unity`, `univrm`, `liltoon`, `mochiyaAvatarTools` (commit), `exportPath` (`"mochiya"` or `"inject"`).

- [ ] **Step 1: Make the project.** `/Applications/Unity/Hub/Editor/6000.0.71f1/Unity.app/Contents/MacOS/Unity -batchmode -quit -createProject ~/opensekai-liltoon-sample`. Add to `Packages/manifest.json`:
  - `com.vrmc.gltf`: `https://github.com/vrm-c/UniVRM.git?path=/Packages/UniGLTF#v0.131.4`
  - `com.vrmc.vrm`: `https://github.com/vrm-c/UniVRM.git?path=/Packages/VRM10#v0.131.4`
  - `jp.lilxyzw.liltoon`: `https://github.com/lilxyzw/lilToon.git?path=Assets/lilToon#2.4.1`
  - Mochiya Avatar Tools: the UPM Git URL from its README, at its latest commit hash.
  Copy `tools/liltoon-sample/Editor/*.cs` to `Assets/Editor/`. Copy `DaniruKun - Catboy - ARKit.vrm` to `Assets/Catboy/`.
- [ ] **Step 2: Write `LilToonSampleConvert.Run()`** (static, `[MenuItem("OpenSekai/Convert Catboy to lilToon")]`, also callable with `-executeMethod`). It finds the imported Catboy prefab, makes a lilToon copy of each MToon material (shader `lilToon`, or `Hidden/lilToonOutline` when the MToon outline width is above 0), and maps: `_MainTex`/`_Color`; shade color → `_ShadowColor`; shading shift and toony → `_ShadowBorder`/`_ShadowBlur`; rim color → `_RimColor`, `_UseRim`; `_SphereAdd` → `_MatCapTex`, `_UseMatCap`; emission → `_EmissionMap`/`_EmissionColor`, `_UseEmission`; `_BumpMap`; outline width and color → `_OutlineWidth`, `_OutlineColor`. Then it sets the extra features by material name: `_UseShadow2nd`/`_UseShadow3rd` with distinct colors on the skin and hair materials, a matcap on the hair, `_UseBacklight` on the skin, emission on one accessory, one cutout material (`lilToonCutout`), and one transparent material (`lilToonTransparent`). It logs the material → feature map.
- [ ] **Step 3: Run it.** `... -batchmode -quit -projectPath ~/opensekai-liltoon-sample -executeMethod LilToonSampleConvert.Run -logFile -`. Expected: the log lists each material with its features and no error.
- [ ] **Step 4: Write and run `LilToonSampleExport.Run()`.** It exports through the Mochiya Avatar Tools API to `Export/Catboy-lilToon.vrm`. If the exporter refuses the prefab, it exports with UniVRM `Vrm10Exporter`, then adds `MOCHIYA_materials_liltoon` to each material from the material values in the 1.3 schema form (`specVersion`, `lilToonVersion`, `shaderVariant`, `properties`, `textures`), and adds the name to `extensionsUsed`. It writes `versions.json`.
- [ ] **Step 5: Check the file.** `python3 -I` reads the GLB JSON: each converted material has the extension with `specVersion` `"1.3"`, the `shaderVariant` set, and textures that resolve to valid indices. Validate one material object against the fork's `schema/MOCHIYA_materials_liltoon.schema.json`.
- [ ] **Step 6: Unity reference capture.** A scene with one directional light (intensity 1, rotation (50, -30, 0)), ambient color (0.2, 0.2, 0.2), camera at (0, 1.3, 1.6) looking at (0, 1.3, 0), FOV 35°, 1920×1080, written with `ScreenCapture` from the Game view to `Export/unity-reference.png`. Record these values in the README; Task 10 uses the same values.
- [ ] **Step 7: Commit** the README and scripts: `git add tools/liltoon-sample && git commit -m "Add the Unity scripts that make the lilToon sample avatar."`

### Task 3: Fork and build setup

**Files (fork):**
- Create: `src/webgpu.ts`, `tsup.webgpu.config.ts`, `test/webgpu/entry.test.ts`
- Modify: `package.json` (exports `./webgpu`, script `build:webgpu`, devDependency `three` `0.187.0`, `@types/three` matching r187)

**Interfaces:**
- Produces: `@mochiya/three-liltoon/webgpu` resolves to `dist/webgpu.js` and `dist/webgpu.d.ts`; `npm run build:webgpu` = `npm run generate && tsup --config tsup.webgpu.config.ts`.

- [ ] **Step 1:** `gh repo fork mochiya-labs/three-liltoon --clone=false`, then `git clone https://github.com/danirukun/three-liltoon ~/ghq/github.com/danirukun/three-liltoon`, `git submodule update --init vendor/lilToon`, `git switch -c webgpu`, `npm ci`.
- [ ] **Step 2:** Run `npm run generate`. Expected: `src/generated/defaults.ts`, `properties.ts`, `textureSemantics.ts`, `compatibility.ts` exist. If a generator needs the shader toolchain, run `npm run tools:setup` first and record that in the fork README.
- [ ] **Step 3: Write the failing test** `test/webgpu/entry.test.ts`: `import * as api from "../../src/webgpu"`; expects `api.LilToonNodeMaterial`, `api.GLTFLilToonNodeExtension`, `api.enableLilToonNodeVRM`, `api.LILTOON_NODE_FEATURES` to be defined; and a source scan of `src/webgpu.ts` and `src/webgpu/**` finds no import of `LilToonMaterial`, `generated/shaders`, or `renderer/`.
- [ ] **Step 4:** Run `npx vitest run test/webgpu`. Expected: FAIL (module not found).
- [ ] **Step 5:** Add `src/webgpu.ts` with placeholder exports (empty classes and an empty set; later tasks fill them), `tsup.webgpu.config.ts` (entry `{webgpu: "src/webgpu.ts"}`, `format: "esm"`, `dts: true`, `clean: false`, `splitting: false`, `external: ["three", /^three\//, "@pixiv/three-vrm"]`), and the `package.json` changes.
- [ ] **Step 6:** Run the test and `npm run build:webgpu`. Expected: PASS, and `dist/webgpu.js` exists while `dist/index.js` is unchanged (`git diff --stat dist/index.js` empty).
- [ ] **Step 7: Commit** in the fork: `git commit -am "Add the webgpu entry."` (with the new files added).

### Task 4: Properties, base material, alpha modes

**Files (fork):**
- Create: `src/webgpu/properties.ts`, `src/webgpu/LilToonNodeMaterial.ts`
- Test: `test/webgpu/properties.test.ts`, `test/webgpu/material.test.ts`

**Interfaces:**
- Consumes: `LILTOON_DEFAULTS`, `LILTOON_MODE_DEFAULTS`, `LILTOON_TEXTURE_SEMANTICS` (generated); `shaderVariants`, `isShaderVariant`, `LilToonShaderVariant` (`src/material/shaderVariants.ts`); `detectLilToonFeatures`, `LilToonFeatureSet` (`src/material/LilToonFeatureSet.ts`); `normalizeLilToonTexture` (`src/utils/texture.ts`); `getNeutralTexture`; `LilToonWarning` type.
- Produces:
  - `LILTOON_NODE_FEATURES: ReadonlySet<keyof LilToonFeatureSet>` = `shadow`, `shadow3rd`, `normal1st`, `matcap`, `rim`, `emission1st`, `backlight`, `outline`.
  - `LILTOON_NODE_VARIANTS: ReadonlySet<LilToonShaderVariant>` = `lilToon`, `Hidden/lilToonOutline`, `Hidden/lilToonCutout`, `Hidden/lilToonCutoutOutline`, `Hidden/lilToonTransparent`, `Hidden/lilToonTransparentOutline`, `Hidden/lilToonOnePassTransparent`, `Hidden/lilToonOnePassTransparentOutline` (use the exact keys of `shaderVariants`).
  - `nodeVariant(name: string | undefined): {variant: LilToonShaderVariant; mode: "opaque" | "cutout" | "transparent"; outline: boolean; warning: string | null}` — an unsupported or unknown name gives `lilToon` / opaque / `outline` from the source when known, and a warning.
  - `nodeProperties(variant, properties): Record<string, number | number[]>` — defaults for the mode merged with the given values; colors and vectors as arrays.
  - `nodeWarnings(name: string, properties, textures): LilToonWarning[]` — `unsupported-feature` for each enabled feature outside `LILTOON_NODE_FEATURES`, `unsupported-shader-variant` from `nodeVariant`.
  - `class LilToonNodeMaterial extends NodeMaterial`, constructor `(parameters?: LilToonNodeMaterialParameters)` with `LilToonNodeMaterialParameters = {name?: string; shaderVariant?: string; properties?: Record<string, LilToonScalarOrVector>; textures?: Record<string, Texture | null>}`. Members: `readonly isLilToonNodeMaterial = true`; `readonly variant`; `isOutline: boolean`; `setProperty(name: string, value: LilToonScalarOrVector): void`; `getProperty(name: string): number | number[] | undefined`; `setTexture(name: string, texture: Texture | null): void`; `getWarnings(): LilToonWarning[]`; `copy(source)` copies properties (own copies of arrays), textures, variant, `isOutline`.
  - Uniform rule: each property used by the shader is a uniform node read through the material (as `materialReference` in OpenSekai), so `setProperty` of a number changes no `version`. A change of a `_Use*` toggle or a texture presence calls `needsUpdate = true`, and `customProgramCacheKey()` returns the sorted enabled-feature list plus the texture-presence list.

- [ ] **Step 1: Write the failing tests.**
  - `properties.test.ts`: `nodeVariant("Hidden/lilToonCutoutOutline")` → `{mode: "cutout", outline: true, warning: null}`; `nodeVariant("Hidden/lilToonFur")` → mode `"opaque"`, warning matches `/Fur/`; `nodeVariant("Nope")` → variant `lilToon`, warning not null; `nodeProperties("lilToon", {_Color: [1, 0, 0, 1]})._Color` deep-equals `[1, 0, 0, 1]` and `_ShadowBorder` equals the generated default; `nodeWarnings` with `{_UseMain2ndTex: 1}` returns one `unsupported-feature` whose `property` is `_UseMain2ndTex`; with `{_UseShadow: 1, _UseRim: 1}` returns `[]`.
  - `material.test.ts`: a cutout variant sets `alphaTest` to `_Cutoff` and `transparent` false; a transparent variant sets `transparent` true and `depthWrite` false; `setProperty("_ShadowBorder", 0.3)` leaves `version` unchanged; `setProperty("_UseRim", 0)` changes `customProgramCacheKey()`; `setTexture("_MainTex", null)` uses the white neutral texture (not null); a texture entry for `_BumpMap` gets linear color space and `_MainTex` sRGB; `material.clone()` then `setProperty` on the clone leaves the source unchanged (Review Focus 5).
- [ ] **Step 2:** Run `npx vitest run test/webgpu`. Expected: FAIL.
- [ ] **Step 3: Implement** `properties.ts` and the material without lighting: `colorNode` = `_Color` × `_MainTex` sample at `uv() * _MainTex_ST.xy + _MainTex_ST.zw`; `opacityNode` from the same; `lights = true` but the lighting model comes in Task 5 (use a plain lambert model as a placeholder only inside this task, replaced in Task 5).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** in the fork.

### Task 5: Lighting model

**Files (fork):**
- Create: `src/webgpu/lilToonMath.ts`, `src/webgpu/LilToonLightingModel.ts`
- Modify: `src/webgpu/LilToonNodeMaterial.ts`
- Test: `test/webgpu/math.test.ts`, `test/webgpu/lighting.test.ts`

**Interfaces:**
- Produces:
  - `lilBand(nl: number, border: number, blur: number): number` — the lilToon shadow band (1 lit, 0 in shadow), as in `lil_common_frag.hlsl` `lilTooning`.
  - `lilLimitLight(color: [number, number, number], min: number, max: number, monochrome: number): [number, number, number]` — the clamp and the monochrome mix of lilToon `lilGetLightColor`.
  - `UNITY_LIGHT_SCALE` (exported `let`-free constant `1 / Math.PI`; Task 10 may change the value).
  - `class LilToonLightingModel extends LightingModel` with `direct()`, `indirect()`, `finish()`.
  - Hooks on `LilToonNodeMaterial` (overridable, used by OpenSekai in Task 9): `protected receivedShadow(shadow: Node<'float'>): Node<'float'>` (default returns `shadow`); `protected roomIrradiance(): Node<'vec3'> | null` (default `null`: use the renderer irradiance).
- Equations: port from lilToon 2.3.4 `lil_common_frag.hlsl` and `lil_common_functions.hlsl`. For each light, `direct()` computes the band of each enabled shadow (first, second, third) from N·L with `receivedShadow(lightShadow)` folded in as lilToon folds `attenuation`, and adds the light color times `UNITY_LIGHT_SCALE` into a summed light and a per-band weight. `finish()` applies `lilLimitLight` to the summed light color, then mixes albedo and the shadow colors (`_ShadowColor`, `_Shadow2ndColor`, `_Shadow3rdColor` and their textures, `_ShadowStrength`) by the bands, and adds the indirect term: albedo × (`roomIrradiance()` or the builder irradiance) with `_ShadowEnvStrength` as lilToon uses it. `_AsUnlit` mixes toward unlit albedo.

- [ ] **Step 1: Write the failing tests.** `math.test.ts`: `lilBand(0.5, 0.5, 0.1)` is `0.5`; `lilBand(1, 0.5, 0.1)` is `1`; `lilBand(0, 0.5, 0.1)` is `0`; `lilBand` with blur `0` is a step at `border`; `lilLimitLight([3, 3, 3], 0.05, 1, 0)` is `[1, 1, 1]`; `lilLimitLight([0, 0, 0], 0.05, 1, 0)` is `[0.05, 0.05, 0.05]`; `lilLimitLight([1, 0, 0], 0, 1, 1)` has three equal channels. Add each lilToon equation value from the HLSL by hand-evaluating it for two inputs; record the HLSL line in a test comment. `lighting.test.ts`: `material.setupLightingModel()` returns a `LilToonLightingModel` that holds the material, so a subclass hook is reachable from the model. The GPU result of the hooks is checked in Task 10.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement** the math and the TSL model. Each TSL function mirrors one `lilToonMath.ts` function, with the same name prefixed `tsl`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** in the fork.

### Task 6: Rim, backlight, matcap, emission, normal map, outline

**Files (fork):**
- Create: `src/webgpu/lilToonShading.ts`, `src/webgpu/outlines.ts`
- Modify: `src/webgpu/LilToonNodeMaterial.ts`
- Test: `test/webgpu/shading.test.ts`, `test/webgpu/outlines.test.ts`

**Interfaces:**
- Produces:
  - `generateLilToonOutlines(root: Object3D): void` — for each mesh whose material is a `LilToonNodeMaterial` with an outline variant, sets `mesh.material = [surface, outline]` where `outline = surface.clone()` with `isOutline = true`, `side = BackSide`, and adds geometry groups `(0, count, 0)` and `(0, count, 1)`, as three-vrm 3.5.5 `_generateOutline` does. Idempotent: a second call does nothing.
  - On the material: when `isOutline`, `positionNode` moves `positionLocal` along `normalLocal` by `_OutlineWidth * 0.01` (lilToon width is in centimetres) × `_OutlineWidthMask` red channel, and the output color is `_OutlineColor` (× `_OutlineTex` when set) with the same light limit.
  - Rim (`_RimColor`, `_RimBorder`, `_RimBlur`, `_RimFresnelPower`, `_RimShadowMask`, `_RimEnableLighting`), backlight (`_BacklightColor`, `_BacklightBorder`, `_BacklightBlur`, `_BacklightDirectivity`, `_BacklightViewStrength`, `_BacklightReceiveShadow`), matcap first (`_MatCapTex`, `_MatCapColor`, `_MatCapBlend`, `_MatCapBlendMask`, `_MatCapBlendMode`), emission first (`_EmissionColor`, `_EmissionMap`, `_EmissionBlend`, `_EmissionBlendMask`), normal map first (`_BumpMap`, `_BumpScale`) — each a TSL function in `lilToonShading.ts`, applied only when its `_Use*` toggle is on.

- [ ] **Step 1: Write the failing tests.** `outlines.test.ts`: a mesh with an outline-variant material gets two materials and two groups, and the second has `isOutline === true` and `side === BackSide`; a non-outline variant is unchanged; a second call keeps two materials; a mesh with a plain `MeshBasicMaterial` is unchanged. `shading.test.ts`: `_UseRim: 0` and `_UseRim: 1` give different `customProgramCacheKey()`; a `_MatCapBlendMode` outside 0–3 gives a warning and uses 0.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** in the fork.

### Task 7: glTF and VRM plugins, build, push

**Files (fork):**
- Create: `src/webgpu/GLTFLilToonNodeExtension.ts`, `src/webgpu/vrm.ts`
- Modify: `src/webgpu.ts`, `README.md` (a "WebGPU" section), `dist/webgpu.*`
- Test: `test/webgpu/gltf.test.ts`

**Interfaces:**
- Produces:
  - `type LilToonNodeMaterialType = new (parameters?: LilToonNodeMaterialParameters) => LilToonNodeMaterial`.
  - `class GLTFLilToonNodeExtension implements GLTFLoaderPlugin`, constructor `(parser: GLTFParser, options?: {materialType?: LilToonNodeMaterialType; onWarning?: (warning: LilToonWarning) => void})`; `name = "MOCHIYA_materials_liltoon"`; `loadMaterial(index): Promise<Material> | null`; `afterRoot(gltf): Promise<void>` (tangents with `generateIndexedTangents` for meshes whose lilToon material uses `_BumpMap`, then `generateLilToonOutlines(gltf.scene)`, then `gltf.userData.lilToonWarnings`).
  - `enableLilToonNodeVRM<T extends VRMLoaderPlugin>(plugin: T, options?): T` — same mechanism as `enableLilToonVRM` (wrap `loadMaterial` first, then the original; chain `afterRoot` after the original). No expression bindings in slice 1: a VRM material color bind on a lilToon material gives a warning.
  - Spec versions `1.0`–`1.3` read; another version gives `spec-version-mismatch` and loads.
- [ ] **Step 1: Write the failing tests** with `GLTFLoader.parse` on in-memory glTF JSON with an embedded buffer and no images (node has no image decoder): a material with the extension yields a `LilToonNodeMaterial` and `parser.associations` maps it; a material without it falls through to `MeshStandardMaterial`; `materialType` gives the subclass; a texture index out of range gives the neutral texture and a warning (Review Focus 4); `specVersion: "9.9"` loads with a warning; `shaderVariant: "Hidden/lilToonGem"` loads opaque with a warning (Review Focus 3); with `enableLilToonNodeVRM`, a VRM 0 material that has both `materialProperties` MToon and the extension yields `LilToonNodeMaterial`, and the MToon plugin is not called for that index (Review Focus 1).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run all fork tests: `npx vitest run`. Expected: PASS, including the upstream tests that need no shader toolchain; record any upstream test that needs DXC and was not run.
- [ ] **Step 5:** `npm run build:webgpu` and `npx tsc --noEmit -p .` Expected: exit 0. Commit `src`, `test`, `README.md`, `package.json`, `package-lock.json`, `tsup.webgpu.config.ts`, `dist/webgpu.js`, `dist/webgpu.d.ts`.
- [ ] **Step 6:** `git push -u origin webgpu` (the owner's fork). Record the commit SHA for Task 9.

### Task 8: `liltoon` profile and the import check

**Files (OpenSekai):**
- Modify: `packages/contracts/src/materials.ts` (`MaterialProfile`, `MATERIAL_EXTENSIONS`, profile rule), `packages/contracts/src/material-parameters.ts` (`MaterialProfileSchema`, `applies`), `crates/contracts/src/lib.rs` (`MaterialProfile` `strings!`, `AssetMaterial::applies`), `apps/desktop/src-tauri/src/assets/materials.rs` (`profile()`), `apps/desktop/src-tauri/src/assets/mod.rs` (`VRM_REQUIRED`), `fixtures/protocol/material-names.json`
- Test: `packages/contracts/test/materials.test.ts`, `packages/contracts/test/material-parameters.test.ts`, `crates/contracts/tests/material_list.rs`, `materials.rs` tests, `registry.rs` tests

**Interfaces:**
- Produces: `MaterialProfile = 'mtoon' | 'unlit' | 'pbr' | 'liltoon'`. The rule: a material with `MOCHIYA_materials_liltoon` is `liltoon` first, before mtoon. `MOCHIYA_materials_liltoon` is in `MATERIAL_EXTENSIONS`. A `liltoon` material reports no unsupported extension for its own extension and for the MToon or unlit data next to it. No parameter applies to a `liltoon` material: `model` is empty and `outline` is false. Rust and TypeScript give the same lists for the shared vectors. `VRM_REQUIRED` includes `MOCHIYA_materials_liltoon`.

- [ ] **Step 1: Write the failing tests.** TypeScript: a VRM 1 material with the extension and `VRMC_materials_mtoon` reports `liltoon` with `unsupported: []`; a GLB (non-VRM) material with the extension reports `pbr` and lists `MOCHIYA_materials_liltoon` as unsupported (non-goal: props); `appliedParameters` of a `liltoon` shape is `[]`; `AssetMaterialSchema` rejects `liltoon` with `outline: true`. Add a `liltoon` case to `fixtures/protocol/material-names.json` (used by both languages). Rust: `material_list.rs` accepts `liltoon` with an empty model and rejects it with `baseColor`; `registry.rs` accepts a VRM with `MOCHIYA_materials_liltoon` in `extensionsRequired`.
- [ ] **Step 2:** Run `pnpm test:unit -- packages/contracts` and `direnv exec . cargo test -p opensekai-contracts --test material_list` (use the real package name from `crates/contracts/Cargo.toml`). Expected: FAIL.
- [ ] **Step 3: Implement.** The VRM-ness for the rule: the material is in a file whose `extensionsUsed` has `VRMC_vrm` or `VRM`.
- [ ] **Step 4:** Run the same commands plus `direnv exec . cargo test -p <desktop crate> materials registry`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Report lilToon avatar materials as the liltoon profile."`

### Task 9: Renderer integration

**Files (OpenSekai):**
- Modify: `packages/renderer/package.json` (`"@mochiya/three-liltoon": "github:danirukun/three-liltoon#<Task 7 SHA>"`), `pnpm-lock.yaml`
- Create: `packages/renderer/src/character-liltoon.ts`
- Modify: `packages/renderer/src/assets.ts`, `packages/renderer/src/avatar-pose.ts`, `packages/renderer/src/renderer.ts`, `ARCHITECTURE.md`, `docs/dependencies.md`
- Test: `packages/renderer/test/character-liltoon.test.ts`, `packages/renderer/test/liltoon-avatar.integration.test.ts`

**Interfaces:**
- Consumes: Task 7 exports; `CharacterShare`, `createCharacterShare` (`character-mtoon.ts`); `AvatarLighting`.
- Produces:
  - `class CharacterLilToonMaterial extends LilToonNodeMaterial` with `readonly isCharacterLilToonMaterial = true`, `characterShare: CharacterShare | null`, `shadowStrength: number` (default `DEFAULT_AVATAR_LIGHTING.shadowStrength`), `environmentFill: number` (default `DEFAULT_AVATAR_LIGHTING.environmentFill`). `receivedShadow(s)` returns `mix(1, s, shadowStrength)` read through `materialReference`; `roomIrradiance()` returns the share SH irradiance at `normalWorld` × `environmentFill` plus the share `fill` × `CHARACTER_AMBIENT`, the same terms as `CharacterMToonMaterial` uses.
  - In `assets.ts`, `enableLilToonNodeVRM(new VRMLoaderPlugin(...), {materialType: CharacterLilToonMaterial, onWarning})`; each warning goes to the load warnings as `UNSUPPORTED` with the material name and lilToon property.
  - In `avatar-pose.ts`, `characters` holds both `CharacterMToonMaterial` and `CharacterLilToonMaterial`. `lighting(values)` writes `shadowStrength` and `environmentFill` to both kinds, and `rimStrength`, `rimWidth`, `rimTint` only to MToon. The type of `characters` is a union; `renderer.ts` line 173 assigns `characterShare` to both.
  - `disposeObject` disposes material arrays (check it does; if not, fix and test it).

- [ ] **Step 1: Write the failing tests.** `character-liltoon.test.ts` (synthetic VRM through `createAssetLoader`, like `character-mtoon.test.ts`): a material with the extension is a `CharacterLilToonMaterial`; a mixed avatar has both kinds in `characters` (Review Focus 2); `lighting({...rimStrength: 0.2, shadowStrength: 0.1})` sets `shadowStrength` on the lilToon material and leaves it without `rimStrength`, with no `version` change; the outline mesh has two materials; loading the same bytes twice gives distinct material objects, and `dispose()` disposes both outline materials (spy on `dispose`) (Review Focus 5); a `Hidden/lilToonFur` material gives one `UNSUPPORTED` load warning. `liltoon-avatar.integration.test.ts`: loads the local sample through `fixtures/local/manifest.json` key `fixture_vrm_liltoon` (skipped when absent), expects each material whose glTF JSON has the extension to be a `CharacterLilToonMaterial`, and no load warning other than the ones the evidence page lists.
- [ ] **Step 2:** `pnpm install`, then run `pnpm test:unit -- packages/renderer/test/character-liltoon.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the key `fixture_vrm_liltoon` to `fixtures/local/manifest.json` on this machine only (`fixtures/local/` is git-ignored).
- [ ] **Step 4:** Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`. Expected: exit 0, except the known `meshes.test.ts` local-manifest failure, which is recorded.
- [ ] **Step 5:** Update `ARCHITECTURE.md` (the character material paragraph: the lilToon material, the fork dependency, the plugin order) and `docs/dependencies.md` (the fork, the commit, the reason, the license). Commit everything in one commit: `git commit -m "Draw lilToon avatars with a WebGPU node material."`

### Task 10: Calibration and evidence

**Files (OpenSekai):**
- Create: `docs/evaluation/liltoon-webgpu.md`, images under `docs/evaluation/liltoon-webgpu/` (Catboy only)
- Modify: `docs/warudo-parity.md` (MAT-02 partial line and evidence row), `spdd/prompt/2026-11-19-liltoon-webgpu.md` (Status)
- Fork: `src/webgpu/lilToonMath.ts` (`UNITY_LIGHT_SCALE` final value), `dist/webgpu.*`; OpenSekai `packages/renderer/package.json` pin update if the fork changes

- [ ] **Step 1: Calibrate.** Build and run the dev app from this worktree (`direnv exec . pnpm dev:desktop`). Through MCP `scene_replace`: the sample avatar, one directional light at the Unity rotation, an Ambient light (0.2, 0.2, 0.2), the camera of Task 2 Step 6. Compare the mean luminance of the face band with `unity-reference.png`. Change `UNITY_LIGHT_SCALE` until the ratio is within 0.95–1.05 at the default OpenSekai directional intensity. Record the value and the ratio. If the fork changes, rebuild `dist`, push, and update the pin.
- [ ] **Step 2: Reference 2.** Run the upstream viewer (`npm run example:viewer:dev` in the fork, upstream code path) with the sample, one directional light, the same camera. Capture.
- [ ] **Step 3: Reference 3.** OpenSekai preview capture, WebGPU, the same view. Also the default new-scene rig and the lighting demo show (`fixtures/shows/lighting-demo.osekai`) with the sample.
- [ ] **Step 4: OBS.** In an isolated OBS test scene (no stream, no recording): alpha over black, white, checker; two screenshots 4 s apart with the Editor minimized differ; output CPU time and `outputSkippedFrames`.
- [ ] **Step 5: Stall.** `node ~/.claude/orchestrate/opensekai/character-lighting/stall.mjs` with `CATBOY` set to the sample asset ID, then to the MToon Catboy, at counts 1, 3, 8, each after a Metal shader cache clear and an app restart. Gate: the spot add at 8 lit lights is not more than 20 % longer for the sample than for MToon Catboy.
- [ ] **Step 6: WebGL 2.** Run the headless check pattern of `docs/evaluation/material-profiles/headless-check.mjs` with the sample on both backends. Expected: no `Pipeline compile failed`.
- [ ] **Step 7: Write the evidence page:** setup (commits of both repos, backend, profile, versions from `versions.json`), the compatibility matrix (each `FEATURE_MATRIX.md` row: upstream WebGL state, slice-1 TSL state, source), the three captures side by side, the calibration, OBS, stall table, WebGL 2 result, the differences from Unity (per-light bands, no expression binds, no UV scroll), and "Not verified" (Windows, GPU time). Update MAT-02 to partial with only the verified claims, and set the contract Status.
- [ ] **Step 8: Commit** `git commit -m "Record the lilToon on WebGPU evidence."`
- [ ] **Step 9: Owner look check.** Show the three captures to the owner. Do not push before the owner approves the look.
- [ ] **Step 10: Finish.** After approval: push the branch, open the PR (ASD-STE100, no agent attribution, test plan with the commands and counts), post the #269 decision comment (continue with slice 2, defer, or stop, with the reason), and run `direnv exec . cargo sweep --time 7`.
