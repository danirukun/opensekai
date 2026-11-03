# REASONS: Material profiles

Analysis: [material profiles](../analysis/2026-11-03-material-profiles.md). Issue: [#73](https://github.com/danirukun/opensekai/issues/73) (MAT-01, slice 1). Queue bundle B27.

Status: contract. Not implemented.

## R — Requirements

1. **Material report.** `materialReport(json)` in `packages/contracts/src/materials.ts` reads a glTF JSON object and returns one entry for each entry of `json.materials`, in index order: `{index, name, profile, unsupported}`.
   - `name` is the trimmed material name, or `Material <index>` when the name is empty or missing.
   - `profile` is `mtoon` when the material has `VRMC_materials_mtoon`, or when the file has `extensions.VRM.materialProperties[index].shader === 'VRM/MToon'`. It is `unlit` when the material is not `mtoon` and has `KHR_materials_unlit`, or when its VRM 0.x shader is one of `VRM/UnlitTexture`, `VRM/UnlitCutout`, `VRM/UnlitTransparent`, `VRM/UnlitTransparentZWrite`. Otherwise it is `pbr`.
   - `unsupported` is a sorted list of unique feature names, each one of:
     - each key of `material.extensions` that is not in `MATERIAL_EXTENSIONS` (R2);
     - `shader:<name>` when the file has a VRM 0.x material property for this index whose `shader` is not `VRM/MToon`, a VRM 0.x unlit shader above, or `VRM_USE_GLTFSHADER`;
     - each texture extension in `TEXTURE_DECODERS_MISSING` (`KHR_texture_basisu`) that a texture of this material uses (base color, metallic roughness, normal, occlusion, emissive, and the textures of each material extension object, found by `index` keys inside a `*Texture` object).
   - The function does not throw on a malformed shape. A missing or wrong-typed field counts as absent.
2. **Supported lists.** `MATERIAL_EXTENSIONS` holds the material extensions that the pinned three 0.180.0 `GLTFLoader` and three-vrm 3.5.5 read: `KHR_materials_anisotropy`, `KHR_materials_clearcoat`, `KHR_materials_dispersion`, `KHR_materials_emissive_strength`, `KHR_materials_ior`, `KHR_materials_iridescence`, `KHR_materials_sheen`, `KHR_materials_specular`, `KHR_materials_transmission`, `KHR_materials_unlit`, `KHR_materials_volume`, `EXT_materials_bump`, `VRMC_materials_mtoon`, `VRMC_materials_hdr_emissiveMultiplier`. A test pins the list to the extension names in the installed `GLTFLoader.js` and three-vrm, so a version change that adds or removes one fails the test.
3. **Load warning.** At each asset load (avatar, prop, and environment), `assets.ts` runs `materialReport(gltf.parser.json)`. When at least one entry has a non-empty `unsupported`, the load result gets one warning `{code: 'UNSUPPORTED', message, ids: [assetId]}`. The message is `Unsupported material features: ` followed by `<material name> (<features joined by ', '>)` for each such entry, joined by `; `, at most 16 entries, then `; and <n> more` when more exist. The model still loads, and three.js keeps its fallback for each such material. The warning goes with the other load warnings into each frame acknowledgment of each client that draws the asset, so `app_status` shows it in `outputs[].lastFrame.warnings`. The renderer does not change a material because of the report.
4. **VRM required extensions.** `import_avatar` rejects a VRM whose `extensionsRequired` names an extension that is not in the scene import `SUPPORTED_REQUIRED` list, `VRMC_vrm`, `VRMC_springBone`, `VRMC_node_constraint`, `VRMC_materials_mtoon`, `VRMC_materials_hdr_emissiveMultiplier`, or `VRM`. The error is `Unsupported required extension: <name>`, the same text as the scene import. The two importers use one list in Rust. A record that is already stored is not checked again.
5. **MToon UV animation.** Each renderer client sets the UV animation values of each MToon material of each loaded avatar from the frame time, on each applied frame, before it draws: with `t = frame.elapsedMs / 1000`, `uvAnimationScrollXOffset = sx × t`, `uvAnimationScrollYOffset = sy × t`, `uvAnimationRotationPhase = r × t`, where `sx`, `sy`, `r` are the speed factors of the material. Each value then wraps (R6). The values are absolute, not a sum of deltas, so two clients that apply the same frame have the same values. The outline material of a mesh gets the same values as its surface material. A material whose three speeds are 0 is not changed. The renderer does not call `VRM.update` (spring bones stay off, CHR-08).
6. **Wrap rule.** The rotation phase wraps into [0, 2π). A scroll value wraps into [0, 2) only when each texture that the material samples through the animated UV has `RepeatWrapping` or `MirroredRepeatWrapping` on that axis; otherwise it does not wrap. The function `uvAnimationValues(speeds, wraps, t)` in `packages/renderer/src/mtoon-uv.ts` gives the three values and is pure.
7. **Fixture check.** A headless check loads `fixture_vrm_1`, `fixture_vrm0_arkit`, `fixture_glb_stage`, and `fixture_test_stage` with the real renderer in Chromium, once with WebGPU and once with WebGL2 on the software adapter (`chromiumGpuArgs`), and draws one frame of each with a transparent clear. For each run it records the backend, the adapter, the material count by profile, the `UNSUPPORTED` warnings, and the pipeline compile failures (`pipeline-diagnostics.ts`). It passes when each fixture loads, each run has no pipeline compile failure, the counts by profile are `fixture_vrm_1` 13 `mtoon`, `fixture_vrm0_arkit` 16 `mtoon`, `fixture_glb_stage` 25 `pbr`, `fixture_test_stage` 11 `pbr` and 1 `unlit`, and no fixture has an `UNSUPPORTED` material warning. It writes one PNG for each fixture and backend into `docs/evaluation/material-profiles/` as functional evidence only. Without the fixtures, the check reports each missing fixture as skipped, not passed.
8. **Known gaps**, not in this slice: a versioned material descriptor on the asset record; MToon look parity on a real GPU and in OBS with alpha (blend and cutout); outline width under render scale and output sizes; MToon with shadows; `KHR_texture_basisu`, Draco, and meshopt decoders; `KHR_materials_variants`; `KHR_materials_pbrSpecularGlossiness`; lilToon and NiloToon (MAT-02 to MAT-06); material property control (MAT-08, CHR-07); spring bones (CHR-08).

## E — Entities

- `MaterialProfile = 'mtoon' | 'unlit' | 'pbr'`.
- `MaterialReportEntry = {index: number, name: string, profile: MaterialProfile, unsupported: string[]}`.
- `MATERIAL_EXTENSIONS: ReadonlySet<string>` and `TEXTURE_DECODERS_MISSING: ReadonlySet<string>` in `materials.ts`.
- `UvSpeeds = {x: number, y: number, rotation: number}`, `UvWraps = {x: boolean, y: boolean}`, `UvValues = {scrollX: number, scrollY: number, rotation: number}` in `mtoon-uv.ts`.
- Rust: one `const SUPPORTED_REQUIRED` and a VRM extension list in `assets/`, used by `scene_import.rs` and `vrm.rs`.
- No change to the scene, show, patch, frame, or asset record schemas.

## A — Approach

- Contracts: `materials.ts` with `materialReport` and the lists; export from `index.ts`.
- Renderer: `assets.ts` runs the report after `parseAsync` and adds the warning (R3). `mtoon-uv.ts` gives the pure values (R6). The avatar binding in `renderer.ts` collects the MToon node materials of the VRM (surface and outline) and their wraps once at load, and sets the values on each applied frame from `frame.elapsedMs` (R5), next to the haze update.
- Host: move `SUPPORTED_REQUIRED` to a shared place in `assets/`; `vrm.rs` checks `extensionsRequired` in the VRM import path before the humanoid check (R4).
- Evaluation: a headless script under `tools/evaluation` (or `scripts/`) that serves the renderer bundle and the fixture files, as the earlier headless evidence scripts do, and writes the record and the PNGs (R7).

## S — Structure

- New: `packages/contracts/src/materials.ts`; `packages/contracts/test/materials.test.ts`; `packages/renderer/src/mtoon-uv.ts`; `packages/renderer/test/mtoon-uv.test.ts`; `packages/renderer/test/material-report.test.ts` (load path with a glTF built in the test); the headless check script; `docs/evaluation/material-profiles.md` and `docs/evaluation/material-profiles/`.
- Changed: `packages/contracts/src/index.ts`; `packages/renderer/src/assets.ts`, `renderer.ts`; `apps/desktop/src-tauri/src/assets/scene_import.rs`, `vrm.rs` (and the module that holds the shared list); `docs/warudo-parity.md` (MAT-01 evidence row, unchecked); `ARCHITECTURE.md` (asset path: the material report warning and the VRM required-extension check; output path: MToon UV animation from the frame time).
- No change: schema versions, the frame format, the OBS page code, Tauri IPC for images.

## O — Operations

1. Add `materials.ts` with unit tests on glTF JSON built in the test: a VRM 1.0 MToon material; a VRM 0.x `VRM/MToon` material; a VRM 0.x `VRM/UnlitCutout` material; a VRM 0.x `Standard` shader (gives `shader:Standard`); `VRM_USE_GLTFSHADER` (no entry); a PBR material with `KHR_materials_specular` (supported); a material with `KHR_materials_pbrSpecularGlossiness` and `KHR_materials_variants` (both listed, sorted); a texture with `KHR_texture_basisu` used by the base color and one used inside `KHR_materials_clearcoat`; an empty name; a malformed `materials` value. Add the test that pins `MATERIAL_EXTENSIONS` to the installed loader sources.
2. Add the load warning with a renderer test that loads a small GLB built in the test with one unsupported material through `createAssetLoader`: the model loads, the warning has the asset ID and the material name and feature, and 20 such materials give 16 entries and `and 4 more`. A model with no unsupported feature has no material warning.
3. Add `uvAnimationValues` with unit tests: values at t = 0, 1.5 s, and 3600 s; rotation wrap; scroll wrap only with repeat or mirrored repeat; negative speeds wrap into the range; zero speeds give zero.
4. Add the per-frame UV values with a renderer test (no GPU draw): a VRM-like binding with one MToon node material and its outline; two applied frames with the same `elapsedMs` give the same values; a frame with a later `elapsedMs` moves them; the outline equals the surface.
5. Add the shared Rust list and the VRM check, with Rust tests: a VRM with a required `KHR_draco_mesh_compression` fails with `Unsupported required extension: KHR_draco_mesh_compression`; a VRM with required `KHR_texture_transform` and `VRMC_materials_mtoon` imports; the scene import tests still pass.
6. Run the headless fixture check (R7) on WebGPU and WebGL2. Record the `fixtures:` and `gpu:` lines of setup, the commit, and the result in `docs/evaluation/material-profiles.md`.
7. Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo fmt --check`, `cargo clippy`, and `cargo test --workspace`.
8. Ask a reviewer on a different model for defects against these requirements.
9. Update the MAT-01 evidence row with the commit, the platform, the tests and the headless record, and the remaining gaps. Update `ARCHITECTURE.md`.

## N — Norms

Functional TypeScript and plain data. Match the compact style of `assets.ts`, `mtoon-binds.ts`, and `scene_import.rs`. No new UI and no UI copy; the warning text is diagnostic data (constitution principle 1). Unit tests for the pure report and the UV values; renderer tests at the real loader; a Rust test at the import boundary; no test of static copy. Prose follows ASD-STE100.

## S — Safeguards

- Do not refuse to load a stored model because of the report. Do not replace or edit a material because of the report.
- Do not drive UV animation from the renderer wall clock or a delta sum. Use `frame.elapsedMs`.
- Do not call `VRM.update` or turn on spring bones or constraints.
- Do not send image data through Tauri IPC on the output path.
- Do not add a decoder (Draco, Basis, meshopt) or a new dependency in this slice.
- Do not claim MAT-01 or a look on macOS, a real GPU, or OBS from the cloud run. The MToon look on the OBS output with alpha, the outlines, and a UV-animated model need an owner check on macOS (`accept:local`). MAT-01 stays unchecked.
