# Material list: macOS check

Date: 2026-11-17. Contract: [material parameter control](../../spdd/prompt/2026-11-16-material-parameter-control.md) (B38 PR 3, R13–R18). Code commit: `09e479b`. Platform: macOS 27.2 (arm64), Node v26.13.0, three 0.187.0, `@pixiv/three-vrm` 3.5.5. The checks ran in Node without a GPU. The desktop app, OBS, and a renderer did not run.

## What changed

- The VRM import and the scene import write `materials` on the record: each glTF material in material order (at most 256), with a unique name (1–64 UTF-16 units, the mesh name rule), the profile, `blend`, `outline`, and the model value of each parameter that applies (R13–R15).
- At startup the registry reads `materials` for an older VRM or GLB record from its stored file and writes the record one time. A file that it cannot read gives no list and no write. A fixture record gets the list in memory only (R16).
- `materialList { entityId }` and the MCP tool `material_list` return the list of a character or a prop (R18).

## Fixture test

`packages/renderer/test/material-values.integration.test.ts` reads the JSON chunk of each fixture file with `materialEntries`. It then loads the same file with the loader plugins of `createAssetLoader` (`VRMLoaderPlugin` with `MToonMaterialLoaderPlugin` and `MToonNodeMaterial`). A test plugin replaces each texture, because Node has no image decoder. The test finds each loaded surface material by `parser.associations` and compares the profile, `blend` with `transparent`, `outline` with an outline material on the same mesh, and each model value. A color can differ by 1 in each byte (`Color.getHexString`). A number can differ by 1e-6.

The test skips each model whose file is not in `fixtures/local` (the files are private and not in Git). A CI run without these files does not run it. The shared rule below is the check that runs everywhere.

| Model | SHA-256 (first 12) | Materials | Profiles | Blend | Outline | Loaded surfaces checked | Differences |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fixture_vrm_1` (VRM 1) | `12c2b97e95e7` | 13 | 13 MToon | 0 | 7 | 13 | 0 |
| `fixture_vrm0_arkit` (VRM 0.x) | `7b7c689e4e2a` | 16 | 16 MToon | 6 | 8 | 74 | 0 |
| `fixture_glb_stage` (GLB) | `9bf356c4929e` | 25 | 25 PBR | 2 | 0 | 25 | 0 |

Output:

```text
fixture_vrm_1: 13 materials, 13 loaded surfaces checked, 7 with outline
fixture_vrm0_arkit: 16 materials, 74 loaded surfaces checked, 8 with outline
fixture_glb_stage: 25 materials, 25 loaded surfaces checked, 0 with outline
 ✓ |integration| packages/renderer/test/material-values.integration.test.ts > material model values > match the loaded materials of fixture_vrm_1 40ms
 ✓ |integration| packages/renderer/test/material-values.integration.test.ts > material model values > match the loaded materials of fixture_vrm0_arkit 48ms
 ✓ |integration| packages/renderer/test/material-values.integration.test.ts > material model values > match the loaded materials of fixture_glb_stage 7ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## Shared rule

`fixtures/protocol/material-names.json` has 14 cases. Rust (`assets/materials.rs`, `model_materials`) and TypeScript (`materialEntries`) give the same list for each case. The expected colors come from three.js `Color` (`setRGB` in the linear working space, then `getHexString`), so the vectors pin the three.js transfer and rounding. The cases include glTF PBR, unlit, BLEND, and MASK materials, the emissive strength and the HDR multiplier (alone and together), VRM 1 MToon with and without an outline, the VRM 0.x MToon and Unlit forms, a VRM 0.x MToon material with `KHR_materials_emissive_strength`, a VRM 0.x Unlit alpha below 0 and above 1, `_OutlineWidthMode` as a number, a numeric string, and another value, `VRM_USE_GLTFSHADER`, the defaults of a material without factors, values out of range, repeated and empty names, the 64-unit cut at a surrogate pair, 257 materials, and a document without materials.

## three-vrm and three.js facts

The rule follows the installed libraries. The line numbers are in the `lib/*.module.js` files of each package.

| Fact | Source |
| --- | --- |
| A VRM 0.x color gets `pow(v, 2.2)` (`gammaEOTF`) | v0compat l.53–55 |
| A VRM 0.x MToon material blends when `keywordMap._ALPHABLEND_ON` is truthy | v0compat l.107, l.112 |
| The MToon base color alpha stays linear | v0compat l.117–120 |
| VRM 0.x MToon defaults: emission `[0,0,0]`, shade `[0.97,0.81,0.86]`, outline color `[0,0,0]`, outline width `0.01 × _OutlineWidth` (default 0) | v0compat l.133, l.141, l.172–173, l.179 |
| `_OutlineWidthMode` indexes `["none", "worldCoordinates", "screenCoordinates"]` with the raw value (default 0). So 0, 1, 2 and the strings `"0"`, `"1"`, `"2"` give a mode, and another value gives no mode | v0compat l.171 |
| The VRM 0.x MToon form keeps only `VRMC_materials_mtoon`, so `KHR_materials_emissive_strength` has no effect | v0compat l.232–235 |
| A VRM 0.x Unlit material blends for `VRM/UnlitTransparent` and `VRM/UnlitTransparentZWrite` | v0compat l.240–241 |
| The Unlit form applies the gamma to all four channels, the alpha too. A negative alpha gives NaN there, so the importer clamps the alpha to 0–1 before the gamma | v0compat l.247 |
| A VRM 0.x Unlit material loads as MToon, with `shadeColorFactor` equal to the base color | v0compat l.253–270 |
| An outline exists when the mode is a string other than `none` and the width is a number above 0; the outline is a clone with `isOutline` | mtoon l.792–794, l.800–818 |
| `MToonNodeMaterial` defaults: emissive black, emissive intensity 1, shade black, rim black, outline width 0, outline color black | mtoon `lib/nodes` l.246–267 |
| The HDR emissive multiplier sets `emissiveIntensity` after the GLTFLoader strength plugin, so the multiplier wins | hdr multiplier l.38–49; GLTFLoader l.877–891 |
| GLTFLoader reads the base color, the opacity, `alphaMode` BLEND, and the emissive factor; a `KHR_materials_unlit` material is a `MeshBasicMaterial` | GLTFLoader l.3703–3711, l.3751–3758, l.3800–3804, l.821, l.831–843 |

## Other checks

| Check | Result |
| --- | --- |
| `pnpm check` | exit 0 |
| `pnpm test:unit` | 252 files, 2222 tests passed |
| `pnpm test:integration` | 43 of 44 files, 101 passed, 4 failed (the known `prepare-tracking` baseline) |
| `cargo test --workspace --no-fail-fast` | 599 passed, 0 failed, 2 ignored |

## Not checked

- No fixture has a glTF `KHR_materials_unlit` material, a VRM 0.x Unlit material, `KHR_materials_emissive_strength`, or the HDR multiplier. The shared vectors cover these forms; the fixture test does not.
- The list in the desktop app: a real import, the startup backfill of the library records on this Mac, and `material_list` through the app MCP server.
- Windows.
