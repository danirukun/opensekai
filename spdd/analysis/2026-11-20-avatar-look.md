# Avatar look analysis

Date: 2026-11-20. Status: **candidates only**. This record is not an implementation contract. It applies to MAT-01 ([#73](https://github.com/danirukun/opensekai/issues/73)), MAT-02 ([#74](https://github.com/danirukun/opensekai/issues/74)), MAT-03 ([#75](https://github.com/danirukun/opensekai/issues/75)), MAT-04 ([#76](https://github.com/danirukun/opensekai/issues/76)), MAT-07 ([#79](https://github.com/danirukun/opensekai/issues/79)), MAT-08 ([#80](https://github.com/danirukun/opensekai/issues/80)), lilToon part 2 ([#269](https://github.com/danirukun/opensekai/issues/269)), and CAM-06.

[V] = verified in the repository at `fd4fe09`. [I] = inferred. [U] = unknown.

## Question

OpenSekai ships first as a desktop app. NiloToon is parked. Which other ways can a user make a VRM look good in OpenSekai, and in which order should we build them?

## Sources

- [NiloToon research](../../docs/superpowers/specs/2026-10-17-nilotoon-research.md): license terms, options A to C, and the resume gate.
- [Character lighting design](../../docs/superpowers/specs/2026-11-19-character-lighting-design.md) and [contract](../prompt/2026-11-19-character-lighting.md): merged in PR #319.
- [Material parameter control analysis](2026-11-16-material-parameter-control.md) and [contract](../prompt/2026-11-16-material-parameter-control.md) (B38).
- [Warudo workshop findings](../../docs/superpowers/specs/2026-10-17-warudo-workshop-research.md): shader families in 28 Workshop items.
- [Parity checklist](../../docs/warudo-parity.md): rows MAT-01 to MAT-08 and CAM-06.
- [Architecture design](../../docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md): renderer and material strategy.

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
| Material parameter overrides | [V] The material list with model values exists, and MCP `material_list` reads it. Saved values, the renderer override, the Inspector, and the Blueprint nodes remain. | MAT-08 partial, tests only |
| Camera grading | [V] Tone mapping, exposure, brightness, contrast, vibrance, tint, and bloom on each camera, with transparent output. | CAM-06 partial |
| Look presets | [V] None. A user sets each value one by one. | — |
| lilToon | [V] No profile. A VRM never contains lilToon. 8 of 28 Workshop items use lilToon. | MAT-02, MAT-03 open |
| NiloToon | [V] Parked. | MAT-04 to MAT-06 |

## Problem

1. A user who has an MToon VRM can make it look good today only with many separate controls (lights, the Lighting group, grading, and later material overrides). No single choice gives a known good look.
2. A user whose avatar was made for VRChat has lilToon materials in a Unity package. The VRM export of that avatar loses the lilToon look, or the author made a separate MToon version by hand.
3. MToon has no data for some features of the anime concert look: face shading that does not use the face mesh normals, outlines that stay correct on hard mesh edges, and hair shadow on the face. No standard glTF extension holds them.

## Candidates

Each candidate has a selection gate. Do not start a candidate until its gate is true. Record the owner decision in this file before a slice contract is written.

### C1. Look presets

A look preset is a named set of plain data: the avatar Lighting group, material overrides (after MAT-08), a light rig, and camera grading. The user selects one preset for an avatar or a scene. The preset writes normal patch operations. After that, each value stays editable.

- [I] It needs no new renderer feature. The editor, MCP, and Blueprints get it through the same command API.
- [I] Built-in presets are versioned constants, as the quality profiles are (`preview_v1`). A changed value needs a new ID.
- Open choices:
  1. Does a preset apply to one avatar, to a scene, or to both (avatar values and scene lights in two parts)?
  2. Does the show keep a reference to the preset, or only the values that it wrote? A reference lets a later preset version change old shows. Values only keep shows stable.
  3. Can a user save their own preset? Where is it stored (show file or app data)?
- **Selection gate:** the owner look check of character lighting passes, and MAT-08 saved values and the renderer override are merged. Without MAT-08 a preset can hold only lighting and grading.

### C2. lilToon import from the creator's Unity source

Read lilToon material values from the creator's own Unity source and map them to `CharacterMToonMaterial` values plus OpenSekai extras (C3, if selected). The VRM file gives the mesh, the rig, and the expressions. The Unity source gives the material values.

- [V] A `.unitypackage` is a gzip tar archive. Each asset is in a folder named by its GUID, with `asset`, `asset.meta`, and `pathname`. [V] A Unity `.mat` file is YAML text with the shader reference and the saved properties.
- [I] The lilToon property names (`_Color`, `_MainTex`, `_ShadowColor`, `_ShadowBorder`, `_ShadowBlur`, `_RimColor`, `_MatCapTex`, `_OutlineColor`, `_OutlineWidth`, `_EmissionColor`) map to MToon fields for the first profile. Verify each name against the lilToon source at a pinned version before the contract.
- [V] lilToon is MIT. A clean-room wall is not necessary. Attribute any code or formula that we port.
- [I] The user must match each VRM material to a `.mat` file. The material name is the first key. A mismatch is a visible import diagnostic, never a silent fallback.
- [V] A `.warudo` bundle holds compiled shaders and saved properties by shader name. The character lighting design names this as a second source for #269. `.warudo` import (#187) keeps its own rights gate.
- Open choices:
  1. Which sources are first: a `.unitypackage`, a Unity project folder, or both?
  2. Is the result a new prepared asset, or a material sidecar next to the original VRM?
  3. Which lilToon features are in the first profile (MAT-02)? Recommended: main color and texture, two shadow layers, rim, matcap, outline, and emission.
- **Selection gate:** MAT-08 material state exists (C2 writes into it), and the owner confirms that VRChat creators are the first target group. Before the gate, choose the test avatars and check that their licenses permit a test fixture or a local-only check.

### C3. OpenSekai toon extension (option A of the NiloToon research)

An OpenSekai TSL material on `CharacterMToonMaterial` that adds the features in problem 3. It is built clean-room, without NiloToon source.

Feature candidates, in the recommended order:

1. **Face shading.** Shade the face from the head bone direction and a face shadow map (an SDF texture), not from the face mesh normals. A model without a face shadow map uses normals derived from the head bone.
2. **Outline from smoothed normals.** At import, bake smoothed normals into a vertex attribute. The outline uses them, so hard edges do not split the outline. Keep the MToon world and screen width modes.
3. **Hair shadow on the face.** An extra pass that offsets the hair depth toward the light and darkens the face. This needs the extra-pass design.
4. **Depth rim.** Rejected for now. The character lighting design rejected a screen-space rim (approach B), because the rim must follow the real lights and edge glows gave gray veils on the OBS output.

Data:

- The extension values are OpenSekai data, not part of the VRM. They live in the material state of MAT-08 (a JSON group, constitution principle 7), or in a custom glTF extension that a small Unity exporter writes. A user who has no Unity can author them in the Inspector.
- A face shadow map is a texture asset that the show references, as other local assets are.

Rules:

- Clean-room wall: a person who has read NiloToon source does not write this code (requirement 3 of the NiloToon research).
- Do not name or market the result as NiloToon or as compatible with NiloToon.
- Each feature needs evidence on both backends and on the OBS output with alpha.

- **Selection gate:** the NiloToon research gate for option A is true (MAT-01 is checked, and the renderer has a design for extra render passes), and the owner selects C3 over C2 as the first feature beyond MToon. Feature 3 also needs the extra-pass design and a GPU time budget from the benchmark contract.

### Rejected or unchanged

- **NiloToon port or plugin (options B and C).** Unchanged. Desktop shipping does not satisfy the license condition.
- **Run compiled Unity shaders (the Warudo Pro approach).** Rejected. OpenSekai has no Unity runtime, and the architecture does not require Unity to run the app.
- **Poiyomi profiles.** Rejected. Locked Poiyomi shaders have no general property set.

## Recommended order

1. Finish MAT-01 (owner look check) and MAT-08 (saved values, renderer override, Inspector, Blueprints).
2. C1 look presets. It is the cheapest change that every MToon VRM gets.
3. C2 or C3 as the first feature beyond MToon. Select C2 if VRChat creators are the first target group. Select C3 if a signature OpenSekai look is the goal. Do not start both before one is verified.
4. The other of C2 and C3. C2 can map lilToon values into C3 features when both exist.

## Owner decisions needed

1. C1: scope (avatar, scene, or both), preset reference or values only, and user presets (yes or no, and where).
2. Which of C2 and C3 is first.
3. C2: first source format and the result form (new prepared asset or sidecar).
4. C3: is a Unity exporter in scope, or only Inspector authoring?

## Effects on other documents

- The [architecture design](../../docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md) lists C1 to C3 as candidates with these gates.
- The parity checklist does not change. No behavior is verified.
- When the owner selects a candidate, write its slice contract in `spdd/prompt/` before code.
