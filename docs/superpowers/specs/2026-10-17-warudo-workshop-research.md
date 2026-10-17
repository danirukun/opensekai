# Warudo Workshop research findings

Date: 2026-10-17. Design: [2026-10-17-warudo-workshop-research-design.md](2026-10-17-warudo-workshop-research-design.md). The raw downloads, reports, and notes stay in the git-ignored `artifacts/warudo-workshop/` folder. This document has aggregate data only.

## Summary

1. A `.warudo` file is a uMod 2.0 archive: a 12-byte `UMOD` header, then a zip file. The zip holds a metadata entry, one or two Unity AssetBundles, and, for a plugin, compiled .NET assemblies.
2. All 28 sampled items parsed without an error. UnityPy reads every bundle. Thus the content is readable outside Unity, but the shaders are compiled Unity programs and do not transfer.
3. Content items (props, environments, characters, animations) have no author code. Plugins have author code: .NET DLLs that run with full process rights in Warudo.
4. Most environments use the built-in Standard shader and baked lightmaps. Many are ports of VRChat worlds or asset-store scenes, with Poiyomi, lilToon, or store shaders.
5. One sampled item (3817817029) is malware. It is a plugin that pretends to be an environment, with a loose DLL and a PowerShell loader.
6. Workshop items give almost no license data. The only signal is the "Attribution required" or "Attribution not required" tag.
7. For OpenSekai, the most important lessons are package content scans and a capability model for code. A `.warudo` import is possible, but it stays a candidate with a selection gate.

## Sample

The Workshop for app 2079120 had 1,691 items on 2026-10-17: Props 877, Environments 310, Plugins 216, Characters 192, and Miscellaneous 91. The type tags are only these five. Animations and effects use Miscellaneous or Characters.

The sample has 28 items: for each type, the 3 items with the most subscribers and the 2 most recent items, plus 3 items that the user downloaded first. The selection used the item tags from the Steam `GetPublishedFileDetails` API, not the browse page links. steamcmd downloaded each item on macOS. The tools used UnityPy 1.25.4 on Python 3.12. No item was skipped. No file from an item was run.

Lifetime subscriptions in the sample: minimum 2, median 3,295, maximum 9,016.

## Format

**Outer file.** `UMOD` (4 bytes), a little-endian `u32` payload length (the file size minus 12), a `u32` zero, then a zip archive with deflate entries.

**Zip entries.**

| Entry | Content | Found in |
| --- | --- | --- |
| `modinfo.dat` | Metadata (below) | All |
| `sharedassets.bin` | Unity `UnityFS` AssetBundle: prefabs, meshes, materials, textures, lightmaps | All except one plugin |
| `sharedassets.meta` | Root folder and the source asset paths | With `sharedassets.bin` |
| `sceneassets.bin` | Unity `UnityFS` AssetBundle with one scene, `Environment.unity` | Environments, one prop |
| `sceneassets.meta` | Root folder and the scene path | With `sceneassets.bin` |
| `assemblymodules.dat` | Compiled .NET assemblies | Plugins |

**`modinfo.dat`.** `UMOD`, 8 bytes of unknown encoding (possibly a time stamp), three `u32` values (the first is always 3; the others are unknown), then seven .NET `BinaryWriter` strings: uMod version, Unity version, Warudo SDK version, name, version, description, and author. An optional block follows: a `u32` marker and three strings, the developer (`TigerHix`), the game (`Warudo`), and a game GUID. Then two unknown bytes, a `u32` image length, and a PNG preview. Items made with SDK 0.14.3 and later can omit the optional block and the preview.

**`.meta`.** A 7-bit-length string (the root folder), a `u32` count, and that number of path strings.

**`assemblymodules.dat`.** A `u32` module count. For each module: the assembly name (often `umod-compiled-<GUID>`), the file name (`<Unknown>` or a `.dll` name), a `u32` flag (1 or 3; with 3, a second PE image follows), one zero byte, a `u32` length, and a .NET PE image.

**Versions.** Unity 2021.3.18f1 (SDK 0.9.0) is in most items. Unity 2021.3.45f2 (SDK 0.14.3 to 0.14.5) is in newer items. Some bundles have the Unity China suffix `c1`.

## Content shape

| Type | Median size | `.warudo` files for each item | Median meshes | Median vertices | Largest texture | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Props | 4.6 MB | 1 to 4 (color variants) | 4 | 8,712 | 8192 | One prop has a full scene. |
| Environments | 164 MB | 1 to 3 (variants) | 207 | 464,315 | 8192 | Scene bundle in each. |
| Characters | 42 MB | 0 to 2 | 17 | 56,393 | 2048 | 2 of 5 are a plain `.vrm` file with no `.warudo`. |
| Plugins | 0.1 MB | 1 | 0 | 0 | 512 | Code in `assemblymodules.dat`. |
| Miscellaneous | 1.0 MB | 1 to 17 | 2 | 28,374 | 4096 | Animation clips and small effects. |

Environment details (5 Environments items and 2 environment seeds):

| Measure | Result |
| --- | --- |
| Renderers with a baked lightmap index | 5 of 7 environments |
| Lights in the scene | 1 to 312 |
| Reflection probes | 4 of 7 |
| Post Processing Stack v2 resources | 6 of 7 |
| Skybox (an item can have more than one) | Procedural 5, panoramic 3, cubemap or cloud dome 1 |
| Terrain | 1 of 7 |
| Video player, audio clip, UI canvas | 1 of 7 |
| Largest | 864 MB and 8.2 million vertices |

Texture formats are all desktop block compression: DXT1, DXT5, BC6H (HDR lightmaps and cubemaps), BC7, and 237 Crunch-compressed DXT textures. A converter needs a Crunch decoder and a BC6H decoder.

## Materials and shaders

Items that use each shader family:

| Family | Items | OpenSekai status |
| --- | --- | --- |
| Unity Standard (built-in render pipeline) | 11 | glTF PBR is in MAT-01. A converter can map the main parameters. |
| Unlit/Texture (9) and legacy shaders (3) | 10 | Unlit and simple transparent materials map directly. |
| lilToon (with its pass, outline, and fur shaders) | 8 | MAT-02 (selected profiles) and MAT-03 (full coverage) are planned. |
| VRM MToon | 2 | MAT-01. |
| Poiyomi Toon (locked) | 1 | None. Locked shaders have no editable source in the bundle. |
| Asset-store and custom shaders (TidalFlask, MK Glass, MomomaShader, water) | 4 | None. Approximate only. |
| URP Shader Graph | 1 | None. |
| Particle shaders | 6 | ENV-10. |

The shader names (Standard, Post Processing Stack v2, legacy shaders) show the built-in render pipeline in most content. Two items reference URP light data and one plugin targets URP. A shader in a bundle is a compiled Direct3D program. OpenSekai cannot use it. Each material must map to an OpenSekai material profile by its shader name and its saved properties.

Several environments are ports of VRChat worlds (MomomaShader mirrors and video screens, Poiyomi). This content expects mirror, video, and screen behavior that a static mesh conversion loses.

## Behavior and code

**Content items.** No content item has author code. The scripts in content bundles come from known libraries only: the uMod linker (15 items), Post Processing Stack v2 (6), Unity UI and TextMeshPro (2), UniVRM (1), Magica Cloth (2), and Dynamic Bone (1). Warudo supplies these libraries.

**Plugins.** All 5 plugins have .NET assemblies. A static scan of the assembly strings shows:

| Reference | Plugins |
| --- | --- |
| Warudo plugin API | 5 |
| Warudo blueprint nodes | 4 |
| Warudo assets | 4 |
| Network sockets | 2 (a VTube Studio receiver and a remote input receiver) |
| URP rendering | 1 |
| Process start, OpenURL, or file APIs | 0 |

A Warudo plugin is a native .NET assembly with the rights of the Warudo process. The Workshop shows no capability list.

**Other loose files.** Two character items are a plain `.vrm` file. One prop has a blueprint example as a loose JSON file.

**Malware case: item 3817817029, "American Highway Cafe Day".** The user reports it to Steam.

- Published and last updated 2026-10-11. 131 lifetime subscriptions on 2026-10-17. Not banned. Tag `Environment`, which is not one of the official type tags (`Environments`).
- The description says to subscribe, start Warudo, and "enable the plugin if asked".
- The item has a loose `plugin.json` (`"kind": "environment"`, `"entry": "DesktopOverlay.dll"`), a loose .NET DLL, and two copies of a 20.8 MB batch file. Its `.warudo` file has the author field "Hakuya Labs" (the Warudo developer) and the name "American Highway Cafe Night". It is probably a copy of an existing environment, used as bait.
- The DLL (SHA-256 `d7f059f49dc0558ecfcbd9a11d469ef281dcd335e31fd3adbb8bea3d34e660c2`) has the Warudo plugin attributes. Its `OnCreate` finds the batch file and opens it through `Application.OpenURL`.
- The batch file (SHA-256 `c590f0feedd7fa631f903d234f4e09a3e9bd17f5a372a7f4e74bed0f59db66eb`) starts PowerShell with no profile, a hidden window, and the execution policy bypassed. The script reads lines with a marker prefix from the batch file, decodes them from Base64, applies an XOR key, and runs the result. The study did not decode or run the payload.
- The study did not verify that Warudo loads a loose DLL from a Workshop folder. If Warudo does not load it, the item depends on a user who runs the batch file.

## Ecosystem

- **License.** No description in the sample states a license or terms of use (keyword count). 2 of 28 mention credit. The Workshop tag is the only structured signal: 7 items "Attribution required", 20 "Attribution not required", 1 with no tag. Totals on the Workshop: 289 required and 1,398 not required.
- **Sources.** 11 of 28 descriptions link to an outside store or site (for example Booth, an asset store, or a social profile). Some content is a port of a paid or third-party asset. The Workshop does not record the original license.
- **Dependencies and versions.** 1 of 28 states a dependency. 1 of 28 has a change log. The Workshop gives no dependency or version fields to the user.
- **Variants.** Props and stages often ship color or layout variants as separate `.warudo` files in one item.
- **Setup steps.** 4 of 28 descriptions give setup steps, for example a blueprint to import by hand.

## Spot check: Livehouse Stage

UnityPy read the two bundles of item 3783948202. AssetRipper was not used.

- The scene has 16 GameObjects in a flat hierarchy (depth 1), 9 mesh renderers, 3 lights (2 spot, 1 directional), a camera, a particle system, and a Post Processing Stack v2 volume (bloom and motion blur).
- The 3 materials use lilToon. The only texture slot in use is a matcap. Each material has 104 color and 397 float properties.
- One lightmap set: a 1024-pixel BC6H HDR light map, a BC7 directional map, and a shadow mask. Each renderer has a lightmap index and a scale and offset for its second UV set. three.js can use this with `lightMap` on the second UV set, after the importer applies the scale and offset to the UVs.
- A GLB conversion keeps the meshes, transforms, lightmaps, light positions and types, and fog color. It approximates lilToon (MAT-02), the light intensities (Unity units), and the sky. It loses the post-processing settings, the particle system, and the uMod linker scripts.

## Implications for OpenSekai

1. **Package content scan (EXT).** Before OpenSekai installs or opens a package, it lists every file. It refuses or flags executable and script files (`.exe`, `.dll`, `.bat`, `.cmd`, `.ps1`, `.sh`) that the runtime does not load. It shows the result to the user. The malware case shows that a sharing platform does not do this for us.
2. **Code is separate from content (EXT-01, EXT-05).** A content package must not be able to carry code. A code package must declare it. Warudo mixes both in one format, and a fake environment can carry a plugin.
3. **Capabilities for guest code (EXT-05, EXT-13).** 2 of 5 plugins need network sockets. None needs process or file access. The OpenSekai capability model fits this: network as a declared capability, no process start, and no native interop. Show the declared capabilities before a package runs.
4. **License and credit in the manifest (EXT-04).** The package manifest has license, credit, and source fields, as ENV-01 credits do. Warudo has only an attribution tag. Users cannot tell if a port of a paid asset is legal to use.
5. **Dependencies and versions (EXT-04).** The manifest has a version and dependency list. Warudo authors put this in free text, if at all.
6. **Variants in one package (EXT-01).** A package can hold named variants of one prop or stage.
7. **Environment import (ENV-01, ENV-02, ENV-07).** Baked lightmaps are common (5 of 7). Lightmap support on the second UV set, many lights (up to 312), reflection probes, and procedural or panoramic skies decide how imported stages look.
8. **Materials (MAT-01, MAT-02).** Standard PBR (11 items) and lilToon (8 items) cover most sampled content. Poiyomi, store shaders, and VRChat world shaders need a fallback with a clear warning.
9. **`.warudo` import candidate (ENV).** A read-only converter from a `.warudo` prop or environment to an OpenSekai GLB scene asset is technically possible. It must never load the assemblies. Selection gate: start only when (a) a rights review confirms that a user may convert Workshop content for use in another application, (b) MAT-02 lilToon profiles and lightmap support exist, and (c) a prototype keeps the meshes, lightmaps, and Standard materials for at least 5 of the 7 sampled environments, verified in OBS output. Until then, OpenSekai does not claim `.warudo` compatibility.
