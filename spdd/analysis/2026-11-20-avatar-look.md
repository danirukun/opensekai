# Avatar look analysis

Date: 2026-11-20. Status: **candidates only**. This record is not an implementation contract. It applies to MAT-01 ([#73](https://github.com/danirukun/opensekai/issues/73)), MAT-02 ([#74](https://github.com/danirukun/opensekai/issues/74)), MAT-03 ([#75](https://github.com/danirukun/opensekai/issues/75)), MAT-04 ([#76](https://github.com/danirukun/opensekai/issues/76)), MAT-08 ([#80](https://github.com/danirukun/opensekai/issues/80)), the lilToon spike ([#269](https://github.com/danirukun/opensekai/issues/269)), lighting presets ([#298](https://github.com/danirukun/opensekai/issues/298)), and CAM-06.

[V] = verified in the repository at `fd4fe09` or in PR #320 at `c3602fb`. [I] = inferred. [U] = unknown.

## Question

OpenSekai ships first as a desktop app. NiloToon is parked. Which other ways can a user make a VRM look good in OpenSekai, and in which order should we build them?

## Sources

- [NiloToon research](../../docs/superpowers/specs/2026-10-17-nilotoon-research.md): license terms, options A to C, and the resume gate.
- [Character lighting design](../../docs/superpowers/specs/2026-11-19-character-lighting-design.md) and [contract](../prompt/2026-11-19-character-lighting.md): merged in PR #319.
- PR [#320](https://github.com/danirukun/opensekai/pull/320) (open): lilToon on WebGPU, MAT-02 slice 1. Spec `docs/superpowers/specs/2026-11-19-liltoon-webgpu-design.md` on its branch. The decision comment on #269.
- [Material parameter control analysis](2026-11-16-material-parameter-control.md) and [contract](../prompt/2026-11-16-material-parameter-control.md) (B38).
- Issue #298: lighting effect presets (lights and grading), milestone MVP.
- [Warudo workshop findings](../../docs/superpowers/specs/2026-10-17-warudo-workshop-research.md): shader families in 28 Workshop items.
- [Parity checklist](../../docs/warudo-parity.md): rows MAT-01 to MAT-08 and CAM-06.

## Desktop shipping does not change the NiloToon result

1. [V] The desktop app is Tauri v2. The renderer is three.js with TSL in a WebView. The OBS page uses the same renderer code.
2. [I] A Tauri release build embeds the frontend assets in the app binary. A user can extract them. TSL makes the WGSL or GLSL text at run time from JavaScript in that bundle.
3. [V] The NiloToon license permits embedding only if "the receiver/user can't access NiloToon's source file". Items 1 and 2 do not satisfy this condition. A native renderer does not change this, because a port is a new implementation of HLSL for URP passes.
4. Thus the NiloToon resume gate stays as it is. This analysis does not change option A or option C.

## Current state

| Lever | State | Evidence |
| --- | --- | --- |
| VRM MToon and glTF PBR profiles | [V] Each MToon surface is a `CharacterMToonMaterial`. A material report flags unsupported features. | MAT-01 partial |
| Character lighting | [V] Shadow to the shade color, a rim from each back light on the lit side, a spherical-harmonics room fill, and a default key, back, and fill rig. An avatar has a Lighting group (Rim Strength, Rim Width, Rim Tint, Shadow Strength, Environment Fill). | MAT-01 partial, verified on macOS; owner look check open |
| lilToon | [V] PR #320 (open): a VRM with `MOCHIYA_materials_liltoon` draws with `LilToonNodeMaterial`, a TSL port of core lilToon in the fork `danirukun/three-liltoon`. The owner approved the look. The source of the values is the glTF extension that Mochiya Avatar Tools writes in Unity. The next source is `.warudo` bundles, after the rights review. | MAT-02 slice 1, not merged |
| Material parameter overrides | [V] The material list with model values exists, and MCP `material_list` reads it. Saved values, the renderer override, the Inspector, and the Blueprint nodes remain. | MAT-08 partial, tests only |
| Camera grading | [V] Tone mapping, exposure, brightness, contrast, vibrance, tint, and bloom on each camera, with transparent output. | CAM-06 partial |
| Scene lighting presets | [V] Issue #298: a preset list that sets lights and grading in one step, and a window-shadow effect. Not started. | — |
| Avatar look presets | [V] None. A user sets each avatar value one by one. | — |
| NiloToon | [V] Parked. | MAT-04 to MAT-06 |

## Problem

1. A user who has an MToon VRM can make it look good today only with many separate controls. #298 covers the scene part (lights and grading). Nothing covers the avatar part (the Lighting group and the material values).
2. A VRChat creator has lilToon materials in a `.unitypackage`. Today the only path to the lilToon look is a Unity export with Mochiya Avatar Tools. A creator without a Unity workflow gets the MToon or PBR version.
3. MToon has no data for some features of the anime concert look: face shading that does not use the face mesh normals, outlines that stay correct on hard mesh edges, and hair shadow on the face.

## Candidates

Each candidate has a selection gate. Do not start a candidate until its gate is true. Record the owner decision in this file before a slice contract is written.

### C1. Avatar look presets ([#321](https://github.com/danirukun/opensekai/issues/321))

A look preset for an avatar is a named set of plain data: the avatar Lighting group and material overrides (after MAT-08). It is the avatar part of the scene presets in #298. A combined preset can reference one scene preset of #298 and one avatar preset. The preset writes normal patch operations. After that, each value stays editable.

- [I] It needs no new renderer feature. The editor, MCP, and Blueprints get it through the same command API.
- [I] Built-in presets are versioned constants, as the quality profiles are (`preview_v1`). A changed value needs a new ID.
- [I] A material override targets a profile (`mtoon` or `liltoon`). A preset value for the other profile is skipped and reported.
- Open choices:
  1. One preset system with #298 (scene and avatar parts), or two lists?
  2. Does the show keep a reference to the preset, or only the values that it wrote? A reference lets a later preset version change old shows. Values only keep shows stable.
  3. Can a user save their own preset? Where is it stored (show file or app data)?
- **Selection gate:** the owner look check of character lighting passes, MAT-08 saved values and the renderer override are merged, and the #298 data shape is decided.

### C2. lilToon values from a `.unitypackage` ([#322](https://github.com/danirukun/opensekai/issues/322))

Read lilToon material values from the creator's `.unitypackage` and give them to `LilToonNodeMaterial`, as #320 does for `MOCHIYA_materials_liltoon`. This is a third source of lilToon values, beside the glTF extension and `.warudo`. The user needs no Unity.

- [V] A `.unitypackage` is a gzip tar archive. Each asset is in a folder named by its GUID, with `asset`, `asset.meta`, and `pathname`. [V] A Unity `.mat` file is YAML text with the shader reference and the saved properties.
- [I] The property names in a `.mat` file are the names that `MOCHIYA_materials_liltoon` carries, because the exporter reads the same material. Verify this on the Catboy and RORO samples before the contract.
- [V] lilToon is MIT. A clean-room wall is not necessary.
- [I] The user must match each VRM material to a `.mat` file. The material name is the first key. A mismatch is a visible import diagnostic, never a silent fallback.
- [I] Textures: a lilToon mask or matcap texture that the VRM does not contain comes from the package. The importer must read Unity texture import settings (color space, wrap) from `asset.meta`.
- Open choices:
  1. Is the result a new prepared asset, or a material sidecar next to the original VRM?
  2. Is a Unity project folder also a source, or only a `.unitypackage`?
- **Selection gate:** PR #320 is merged, and the shared property nodes of the #269 decision are done if the stall gate requires them. The owner confirms that creators without a Unity workflow are a target group.

### C3. OpenSekai toon extension for MToon ([#323](https://github.com/danirukun/opensekai/issues/323), option A of the NiloToon research)

An OpenSekai TSL material on `CharacterMToonMaterial` that adds the features in problem 3. It is built clean-room, without NiloToon source. lilToon avatars keep the lilToon features; C3 does not change `LilToonNodeMaterial`.

Feature candidates, in the recommended order:

1. **Face shading.** Shade the face from the head bone direction and a face shadow map (an SDF texture), not from the face mesh normals. A model without a face shadow map uses normals derived from the head bone.
2. **Outline from smoothed normals.** At import, bake smoothed normals into a vertex attribute. The outline uses them, so hard edges do not split the outline. Keep the MToon world and screen width modes. This also applies to the thin outline gap that #320 records, if the lilToon outline uses the same attribute.
3. **Hair shadow on the face.** An extra pass that offsets the hair depth toward the light and darkens the face. This needs the extra-pass design.
4. **Depth rim.** Rejected for now. The character lighting design rejected a screen-space rim (approach B), because the rim must follow the real lights and edge glows gave gray veils on the OBS output.

Data:

- The extension values are OpenSekai data, not part of the VRM. They live in the material state of MAT-08 (a JSON group, constitution principle 7), or in a custom glTF extension that a small Unity exporter writes. A user who has no Unity can author them in the Inspector.
- A face shadow map is a texture asset that the show references, as other local assets are.

Rules:

- Clean-room wall: a person who has read NiloToon source does not write this code (requirement 3 of the NiloToon research).
- Do not name or market the result as NiloToon or as compatible with NiloToon.
- Each feature needs evidence on both backends and on the OBS output with alpha.

- **Selection gate:** the NiloToon research gate for option A is true (MAT-01 is checked, and the renderer has a design for extra render passes), and the owner selects C3. Feature 3 also needs the extra-pass design and a GPU time budget from the benchmark contract.

### Rejected or unchanged

- **NiloToon port or plugin (options B and C).** Unchanged. Desktop shipping does not satisfy the license condition.
- **Run compiled Unity shaders (the Warudo Pro approach).** Rejected. OpenSekai has no Unity runtime, and the architecture does not require Unity to run the app.
- **Map lilToon values onto MToon.** Rejected. PR #320 shows that a TSL lilToon port is feasible and matches Unity within the calibration window.
- **Poiyomi profiles.** Rejected. Locked Poiyomi shaders have no general property set.

## Recommended order

1. Merge #320 and finish MAT-01 (owner look check) and MAT-08 (saved values, renderer override, Inspector, Blueprints).
2. #298 and C1 together, with one data shape for scene and avatar presets.
3. C2 or C3. Select C2 if VRChat creators without Unity are the next target group. Select C3 if MToon avatars need a stronger signature look.

## Owner decisions needed

1. C1: one preset system with #298 or two lists; preset reference or values only; user presets (yes or no, and where).
2. Which of C2 and C3 is next after C1.
3. C2: result form (new prepared asset or sidecar), and whether a Unity project folder is also a source.
4. C3: is a Unity exporter in scope, or only Inspector authoring?

## Effects on other documents

- The [architecture design](../../docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md) lists C1 to C3 as candidates with these gates.
- The parity checklist does not change. No behavior is verified.
- When the owner selects a candidate, write its slice contract in `spdd/prompt/` before code.
