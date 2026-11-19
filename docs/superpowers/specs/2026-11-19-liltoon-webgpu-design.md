# lilToon on WebGPU design

Date: 2026-11-19. Issues: #269 (spike), #74 (MAT-02), #75 (MAT-03, later). Status: design, for owner approval.

## Intent

Many VTuber avatars are made with the lilToon shader in Unity (VRChat and Booth models). In Unity and in Warudo, these avatars have a specified look: toon shadow bands, rim light, matcap, and outline. A VRM export with UniVRM changes these materials to MToon and the look is lost. All eight VRM files in the owner's library are MToon only for this reason.

The owner wants lilToon avatars in OpenSekai to look like the user expects from Unity or Warudo. This project is the first step. It adds a WebGPU lilToon material and loads it from a glTF or VRM file that keeps the lilToon data.

## Goals

1. Make one lilToon sample avatar: Catboy with lilToon materials, exported with the lilToon data.
2. Fork `mochiya-labs/three-liltoon` and add a WebGPU entry: a TSL node material for the core lilToon features, and a glTF plugin that makes it.
3. Load a VRM avatar with `MOCHIYA_materials_liltoon` in OpenSekai. The avatar uses the new material, the OpenSekai lights, and the room fill.
4. Compare the look with two references and record the result. Close the #269 spike with a decision.

This is MAT-02 slice 1, and it merges to `main` with the full spec-first rules. The #269 decision is about the next slices (more features, `.warudo`), not about this one. (Designer's call.)

## Non-goals

- `.warudo` import. It is the next project. The [workshop study](2026-10-17-warudo-workshop-research.md) gate (rights review first) still applies.
- Fur, gem, refraction, refraction blur, the two-pass transparent mode, and the lilToon "Lite" and "Multi" variants beyond the material modes in this slice. These are MAT-03.
- Pixel parity with Unity. The result is approximate.
- A change to the MToon path. A VRM without the lilToon extension loads as it does now.
- A publish of the fork to npm, or a pull request to upstream. Both are possible later.
- lilToon on a GLB prop or environment. The slice is for VRM avatars. A GLB material with the extension loads on the PBR path as now, and the load warning names the extension. (Designer's call.)
- Editable lilToon parameters in the Inspector, MCP `material_list`, and Blueprint (B38, MAT-08). See Part C. (Designer's call.)

## Anti-goals

- A lilToon avatar that looks much less like the Unity reference than necessary. When the Unity reference and the MToon version of the same avatar differ, the Unity reference decides, because the owner wants the look that users expect from Unity or Warudo. The MToon comparison is recorded but does not fail the check.
- A frame stall on a light change that is much longer than the MToon path. The character lighting gate applies: not more than 20 % longer than MToon for the same avatar.
- Any regression of the MToon avatars, OBS alpha, or the minimized-Editor output.

## Constraints

- three r187 `WebGPURenderer`, TSL, `@pixiv/three-vrm` 3.5.5. The material must compile on the WebGPU backend and on the WebGL 2 fallback of `WebGPURenderer`.
- All material compiles go through the existing serialized `compileOnce` queue.
- lilToon and three-liltoon are MIT. The fork and the TSL port keep both license notices.
- Avatar files are never committed. The sample avatar stays local. Only Catboy images go into the repository.
- Unity 6000.0.71f1 is installed on the owner's Mac. lilToon and `mochiya-labs/unity-avatar-tools` (MIT) are public. The exporter needs UniGLTF and UniVRM 0.131.2 or newer, so the sample project uses that version, not the 0.115.0 package in Downloads.
- The spec-first rules of `CLAUDE.md` apply: a slice contract in `spdd/`, ARCHITECTURE.md in the same commit as a new dependency or data path, the parity checklist for MAT-02, and OBS evidence for the material change.

## Approaches

1. **Port core lilToon to TSL in a fork (selected).** A new `LilToonNodeMaterial` uses the property names, defaults, and texture rules of three-liltoon. TSL compiles on both backends. The material uses the OpenSekai lights and room fill. The cost: the equations are ported by hand and can drift from upstream. Fur, gem, and refraction come later.
2. **Compile WGSL from the fork's shader build.** The SPIR-V build gets a WGSL output. This keeps the upstream equations for all features. But `WebGPURenderer` accepts only node materials, so this needs a backend patch. It loses the WebGL 2 fallback and the OpenSekai light rig.
3. **Map lilToon onto `CharacterMToonMaterial`.** No fork. This loses the second and third shadow bands, matcap, and most of the lilToon look.

The owner selected approach 1 on 2026-11-19.

## Design

### Part A: the sample avatar

- Make a Unity project outside the repository with UniVRM 0.131.2 or newer, lilToon (latest release), and Mochiya Avatar Tools.
- Import `DaniruKun - Catboy - ARKit.vrm`. Change each MToon material to lilToon with an editor script. The script maps the MToon values to lilToon: main texture and color, shade color to the first shadow color, shading shift and toony to the first shadow border and blur, rim, matcap, emission, normal map, outline width and color.
- Then set values by hand so that the sample uses each feature of the slice: a second and third shadow band on the skin and the hair, a matcap on the hair, a rim and backlight, emission on one part, a cutout material, a transparent material, and an outline.
- Export with Mochiya Avatar Tools to VRM (the VRM 0 or VRM 1 form that the exporter writes) with `MOCHIYA_materials_liltoon` on each material. Record the versions of Unity, lilToon, UniVRM, and the exporter.
- The exporter is documented for VRChat and Modular Avatar prefabs. If it does not accept the re-imported Catboy, the fallback is a UniVRM export plus a small script that adds `MOCHIYA_materials_liltoon` from the material values in the form of the extension schema. The evidence records which path made the sample.
- Keep the Unity project and the export outside the repository. Take a Unity Game view capture of the sample under one directional light as reference 1.

### Part B: the fork

- Fork to `danirukun/three-liltoon`. Work on a `webgpu` branch.
- Add an entry `@mochiya/three-liltoon/webgpu`. It imports only `three/webgpu` and `three/tsl`. It does not import the WebGL `LilToonMaterial` or the generated GLSL.
- `LilToonNodeMaterial` extends `NodeMaterial`. It reads the lilToon property names from a plain property object, so that the material state is the same data as the glTF extension. A scalar change is a uniform write. A feature toggle or a texture assignment changes the material cache key and causes a recompile, as in the WebGL material.
- Its lighting model is a TSL `LightingModel`:
  - `direct()` runs for each light. It computes the lilToon shadow factor from N·L, the light shadow, and the first, second, and third shadow border, blur, and color. This differs from Unity lilToon, which uses toon shading only for the main light and adds the other lights more simply. OpenSekai has many lights of the same kind, and the MToon path treats each light the same way. The difference goes into the compatibility matrix.
  - `indirect()` adds the ambient as lilToon does with Unity SH: the material color times the irradiance. In OpenSekai the irradiance is the room spherical-harmonics fill and the Ambient light.
  - Rim, backlight, matcap, and emission are added in the output node from the authored values.
- The first feature set (MAT-02 slice 1):

  | Feature | lilToon properties (examples) |
  | --- | --- |
  | Main color and texture, main UV transform | `_Color`, `_MainTex`, `_MainTex_ST` |
  | Light limits | `_LightMinLimit`, `_LightMaxLimit`, `_MonochromeLighting`, `_ShadowEnvStrength`, `_AsUnlit` |
  | First, second, third shadow | `_UseShadow`, `_ShadowBorder`, `_ShadowBlur`, `_ShadowColor`, `_Shadow2ndBorder`, `_Shadow3rdColor`, the shadow masks |
  | Normal map | `_UseBumpMap`, `_BumpMap`, `_BumpScale` |
  | Rim and backlight | `_UseRim`, `_RimColor`, `_RimBorder`, `_RimBlur`, `_UseBacklight` and its values |
  | MatCap (first only) | `_UseMatCap`, `_MatCapTex`, `_MatCapBlend` and its mask |
  | Emission (first only) | `_UseEmission`, `_EmissionColor`, `_EmissionMap` |
  | Opaque, cutout, transparent | the shader variant, `_Cutoff` |
  | Outline | outline variants, `_OutlineWidth`, `_OutlineColor`, `_OutlineWidthMask` |

- The light limits set most of the lilToon brightness: they clamp the light color. OpenSekai light intensities are not Unity units, so the port must define the light color that the clamp sees. Calibrate it so that one OpenSekai directional light at the default intensity gives the same face level as the Unity reference under one directional light of intensity 1. Record the factor.
- The outline is a second draw of the mesh with the vertices moved along the normal and front faces culled. Use the same geometry-group method as the three-vrm MToon outline in WebGPU.
- Each enabled feature that is not in the slice gives a warning. Reuse the warning data of three-liltoon (`materialWarnings`) so that the report names the lilToon property.
- A `GLTFLilToonNodeExtension` glTF plugin makes `LilToonNodeMaterial` for each material that has `MOCHIYA_materials_liltoon`. Other materials go to the next plugin. It reuses the existing texture, tangent, and version code of the fork.
- Commit the built `dist/` in the fork, as upstream does, so that OpenSekai can use a git dependency without the fork's shader tools.
- The fork's own browser tests run the new entry on the WebGPU backend.

### Part C: OpenSekai

- Add the fork as a pnpm git dependency at a fixed commit in `packages/renderer`.
- In `createAssetLoader` (`packages/renderer/src/assets.ts`), the VRM plugin uses the lilToon node plugin for materials with the extension and `CharacterMToonMaterial` for the other materials.
- A lilToon material on an avatar joins the `characters` light group and gets the `characterShare` (room SH fill), as `CharacterMToonMaterial` does now. `avatar-pose.ts` collects both material kinds.
- The avatar Lighting group (Rim Strength, Rim Width, Rim Tint, Shadow Strength, Environment Fill) applies to a lilToon material as follows:
  - Environment Fill scales the room fill, as on MToon.
  - Shadow Strength scales only the cast shadow from the shadow map, as on MToon (`mix(1, shadow, shadowStrength)`). It does not change the authored shadow bands, so the default 0.6 keeps the band contrast of the Unity material.
  - The authored lilToon rim and backlight stay. The OpenSekai back-light rim is not added, because a lilToon material has its own rim settings. Rim Strength, Rim Width, and Rim Tint have no effect on a lilToon material.
- Material parameter control (B38): add a `liltoon` material profile to `materialReport` and to its Rust copy. `MOCHIYA_materials_liltoon` becomes a known extension for a VRM avatar material. A `liltoon` material is in `material_list` and in the Inspector with no editable parameters in this slice, and `setMaterialValues` does not write PBR or MToon values to it. Editable lilToon colors are a later slice.
- The material report and the load warnings name the lilToon features that are not supported.
- The Rust import check accepts `MOCHIYA_materials_liltoon` in `extensionsUsed`. If the exporter puts it in `extensionsRequired`, the check also accepts it there.

### Evidence

- A compatibility matrix in `docs/evaluation/`: each three-liltoon feature, then the WebGL state upstream, the TSL state in this slice, and the source.
- Captures of the sample with one directional light and the same camera:
  1. Unity Game view (reference 1).
  2. The upstream three-liltoon WebGL viewer (reference 2).
  3. OpenSekai on WebGPU.
- OBS output: alpha over dark, light, and checker; output continues with the Editor minimized; frame times.
- The light-add stall at 1, 3, and 8 lit lights with the stall script, for the lilToon sample and for the MToon Catboy.
- A #269 comment with the decision: continue with a next slice, defer, or stop.

## Left to the builder

- The exact TSL form of each lilToon equation. Port from the lilToon HLSL (`lil_common_frag.hlsl` and related files).
- The editor-script mapping details for Part A, and which parts of Catboy get the extra features.
- The test split between the fork (unit and browser tests) and OpenSekai (loader and frame tests), within the test rules of `CLAUDE.md`.
- The plan order. A reasonable order is the sample first, then the fork material without lights, then the light model, then the OpenSekai integration and evidence.
