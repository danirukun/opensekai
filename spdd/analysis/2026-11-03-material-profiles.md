# Material profiles analysis

Issue: [#73](https://github.com/danirukun/opensekai/issues/73) (MAT-01). Queue bundle B27. Mode: contract-first. This is slice 1 of MAT-01. It covers a material report for each loaded model, MToon UV animation on the session clock, and a fixture check of the two first profiles on both backends. Visual parity on a real GPU and in OBS stays an owner check.

## Problem

MAT-01 is "VRM MToon and glTF PBR". OpenSekai already draws VRM 1.0 MToon, VRM 0.x MToon, and glTF PBR with three.js and three-vrm (see the recorded evidence in the parity checklist). The item stays unchecked because three things are not true:

1. The architecture design asks for "an explicit capability report" and says: "Never silently replace a failed material with an apparently successful import." The renderer does not do this. A material that three.js cannot read becomes a default material with no warning to the operator.
2. MToon UV animation (scroll and rotation) never moves. The renderer does not advance the animated UV values of an MToon material.
3. No repeatable check shows the first profiles on the fixtures with both backends. The evidence is a set of historical macOS runs.

The issue is a roadmap issue, not a task contract, so it needs a bounded slice first.

## Handbook recheck

The handbook was read on 2026-11-03.

- [Character asset](https://docs.warudo.app/docs/assets/character): the page does not name MToon, Standard, or another shader. It names material properties only in Expressions: "The Target Material Properties list contains the Unity material properties controlled by this expression", and "Default Material Properties" for the values when no expression is active. "You need to know the material name and the property name in advance; you can inspect these in Unity." Material property control is MAT-08 and CHR-07, not MAT-01.
- [Warudo Pro](https://docs.warudo.app/docs/pro): Warudo is a Unity URP application. A model looks as its Unity shaders make it look. OpenSekai cannot load Unity shaders (architecture, "Renderer and material strategy"), so the parity target is the result of the VRM MToon and glTF PBR specifications, not the Unity shader code.
- Parity checklist workshop study: the built-in Standard shader is in 11 of 28 items and VRM MToon in 2. A Unity Standard material arrives in OpenSekai as glTF PBR after a UniVRM or glTF export.

## Existing material

- `packages/renderer/src/assets.ts`: `GLTFLoader` with `VRMLoaderPlugin` and `MToonMaterialLoaderPlugin` (`materialType: MToonNodeMaterial`). three 0.180.0 and @pixiv/three-vrm 3.5.5. VRM 0.x MToon goes through the v0compat plugin. `inspectContainer` reads `extensionsUsed` and the image count. It adds an `UNSUPPORTED` load warning only for `VRMC_springBone` and `VRMC_node_constraint`. Load warnings go with the instance (`Ready.warnings`) into the frame acknowledgment warnings.
- three 0.180 `GLTFLoader` reads these extensions: `KHR_materials_*` (anisotropy, clearcoat, dispersion, emissive_strength, ior, iridescence, sheen, specular, transmission, unlit, volume), `EXT_materials_bump`, `KHR_texture_transform`, `KHR_mesh_quantization`, `EXT_mesh_gpu_instancing`, `EXT_texture_webp`, `EXT_texture_avif`, `KHR_lights_punctual`. `KHR_draco_mesh_compression`, `KHR_texture_basisu`, and `EXT_meshopt_compression` need a decoder that this renderer does not give. For each other extension, the loader writes only `console.warn('Unknown extension')`. So `KHR_materials_pbrSpecularGlossiness` and `KHR_materials_diffuse_transmission` on a material, and root `KHR_materials_variants`, become a silent fallback. A `KHR_texture_basisu` texture with a core `source` falls back to that image; without one it has no image.
- `apps/desktop/src-tauri/src/assets/scene_import.rs` rejects an environment GLB whose `extensionsRequired` has a name outside `SUPPORTED_REQUIRED`. The VRM import (`vrm.rs`) has no such check, so an avatar with a required Draco extension imports and then fails in the renderer with a generic load error.
- VRM 0.x materials: `extensions.VRM.materialProperties[i].shader` names the Unity shader. three-vrm (v0compat) reads `VRM/MToon` as MToon and each shader name that starts with `VRM/Unlit` as unlit. During the parse it replaces those entries of `parser.json.materials`, so a report must read the JSON of the stored bytes. Another name (for example `Standard` or a custom shader) falls back to the glTF material of the same index. No warning names it.
- `MToonNodeMaterial.update(delta)` adds `delta × speed` to `uvAnimationScrollXOffset`, `uvAnimationScrollYOffset`, and `uvAnimationRotationPhase`. The shader reads the rotation phase in radians. No code in the renderer calls it, and `VRM.update` is not called (spring bones are off, CHR-08).
- `RuntimeFrame.elapsedMs` is the session clock. The haze uses it (`haze.update(hazeEntity, frame.elapsedMs / 1000)`), so the OBS page and the preview show the same haze state for the same frame.
- `scene_import.rs` `SUPPORTED_REQUIRED` does not list `EXT_materials_bump` and `EXT_texture_avif`, which the loader reads.
- `scene-lights.ts` treats MToon node materials as lit and gives them the `lightsNode` of their group. The outline material is a second material group of the same mesh.
- Fixtures (`fixtures/local`, read with a script on 2026-11-03):
  - `fixture_vrm_1` (VRM 1.0): 13 materials, all `VRMC_materials_mtoon` with `KHR_materials_unlit`, opaque, double sided; 7 have an outline.
  - `fixture_vrm0_arkit` (VRM 0.x): 16 materials, all `VRM/MToon`; 10 cutout and 6 blend; 14 normal maps, 16 sphere-add (matcap) maps, 15 emission maps; world and screen outline widths. No material has UV animation.
  - `fixture_glb_stage`: 25 PBR materials with `KHR_materials_specular`, 4 with `KHR_materials_emissive_strength`, 2 blend.
  - `fixture_test_stage`: 12 materials, `KHR_materials_specular` and one `KHR_materials_unlit`.
  - No fixture uses UV animation or an unsupported material extension. The tests for those must build a small glTF in the test.

## Findings

1. The capability report can be a pure function of the glTF JSON. It needs no GPU and no asset record change. The renderer already has the JSON (`gltf.parser.json`) and a warning path to the frame acknowledgment.
2. A material falls into one profile: `mtoon` (VRM 1.0 `VRMC_materials_mtoon`, or VRM 0.x shader `VRM/MToon`), `unlit` (`KHR_materials_unlit` without MToon, or a VRM 0.x unlit shader), or `pbr` (the glTF core material). A profile can carry unsupported features: a material extension that the loader does not read, a VRM 0.x shader name that three-vrm does not map, or a texture that needs a decoder that the renderer does not have.
3. A silent fallback is the defect. The model must still load: an operator wants a model with one unknown material on stream, with a warning, not a refused model. The warning must name the asset, the material, and the feature, so the operator can fix the export.
4. The VRM import should reject a required extension that the renderer cannot load, as the scene import already does. This moves a late generic renderer failure to a clear import error. It does not change a stored asset.
5. UV animation must use the session clock, not the renderer wall clock. Then the OBS page, the Scene preview, the editor viewport, and a screenshot show the same UV state for the same frame, and the motion continues when the editor is minimized. Absolute values (speed × elapsed time) are deterministic; a sum of deltas drifts between clients that skip frames.
6. A long session makes `speed × elapsed` large, and a 32-bit float loses UV precision. The scroll can wrap by 2 with no visible change only when each texture that reads the animated UV repeats with a whole period after its texture transform. The rotation phase wraps by 2π with no change. With a UV animation mask, the shader multiplies the value by the mask after the wrap, so no value can wrap.
7. A headless render on the software adapter can prove that each fixture material compiles and draws on WebGPU and WebGL2 with no pipeline failure. It cannot prove the look. The look on a real GPU and in OBS with alpha needs the owner on macOS.

## Questions resolved without the owner (reversible)

- **Slice scope.** Slice 1 is the report, the UV animation, the VRM required-extension check, and the fixture check. Alternative: also a versioned material descriptor stored with the asset (architecture "material descriptor"). Rejected for this slice, because no consumer reads it yet (MAT-02 and MAT-08 are later) and it would change the asset record in Rust and TypeScript.
- **Where the report runs.** In the renderer at load, from the glTF JSON, as TypeScript in `packages/contracts` so that MCP and a later importer can use it. Alternative: in Rust at import, stored on the record. Rejected for now, because records from before this slice would need a backfill and the renderer would still need its own check for the fallback it makes.
- **Fallback behavior.** Keep the three.js fallback and add one `UNSUPPORTED` warning per asset with each material and feature, as the springBone warning does. Alternative: refuse the asset. Rejected, because one wrong material would remove a whole model from a show.
- **Warning size.** One warning per asset, with at most 16 material entries and a count of the rest, so the frame acknowledgment stays small. Alternative: one warning per material. Rejected, because a 57-mesh model could fill the acknowledgment.
- **VRM required extensions.** The VRM import uses the same supported list as the scene import, plus the VRM extensions. Alternative: no check. Rejected (finding 4).
- **UV time source.** `RuntimeFrame.elapsedMs`. Alternative: renderer `performance.now()`. Rejected (finding 5).
- **Wrap rule.** No wrap with a mask texture. Otherwise rotation wraps at 2π, and scroll wraps at 2 only when each texture that the animated UV feeds keeps a whole period (contract R6). Alternative: always wrap at 1. Rejected, because it changes a clamped, mirrored, or transformed texture.
- **MCP.** No new tool. The warnings reach MCP through the existing `app_status` tool: `outputs[].lastFrame.warnings` carries the frame acknowledgment warnings. Alternative: a `material_report` tool. Rejected for this slice; the report is small and already visible.
- **Parity status.** MAT-01 stays unchecked after this slice. The look on macOS, OBS alpha with blend and cutout MToon, and outlines under render scale are owner checks.

## Risks

- A model that worked before can now fail at import when it has a required extension outside the list. Such a model failed in the renderer before, so the user-visible result is an earlier and clearer error. An already stored model is not checked again.
- The VRM 0.x shader names that three-vrm maps can change in a later three-vrm version. The list is pinned with the three-vrm version, and a test reads it.
- The software adapter can compile a pipeline that a real GPU rejects, or the opposite. The headless check is functional only.
- The report trusts `extensionsUsed` on the material. A file that uses a material extension without a material entry is still reported from `extensionsUsed` at the root.
