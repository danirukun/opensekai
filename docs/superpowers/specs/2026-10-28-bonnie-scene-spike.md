# Bonnie scene spike inventory and mapping

Date: 2026-10-28. Issue: [#240](https://github.com/danirukun/opensekai/issues/240). Status. The inventory, the mapping, and a first rebuild are done. The maintainer answered the blockers on 2026-10-28. See [Decisions](#decisions) and [Rebuild result](#rebuild-result).

The input is one Warudo sceneshare file from the maintainer (`Ben 3D Test.sceneshare`, 277,114,964 bytes, SHA-256 `8620791d475992ac1b056a475bdc24b35e236cfc61dfa4420645d9233d0c56a6`). The file and its extracted models, textures, and scene stay local. This document records structure, counts, and settings only. The earlier [Workshop research](2026-10-17-warudo-workshop-research.md) describes the `.warudo` (uMod) archive. This document adds the sceneshare container and the scene JSON.

## Tool

`scripts/warudo-sceneshare.ts` reads the container. It does not run code from the file.

```sh
pnpm exec tsx scripts/warudo-sceneshare.ts list <file.sceneshare>
pnpm exec tsx scripts/warudo-sceneshare.ts inventory <file.sceneshare> > artifacts/bonnie/inventory.json
pnpm exec tsx scripts/warudo-sceneshare.ts unpack <file.sceneshare> artifacts/bonnie/raw
```

`unpack` writes each entry under the target folder and refuses a path that is absolute or contains `..`. Put the output in a git-ignored folder (`artifacts/` or `fixtures/local/`). The Unity bundle counts below came from UnityPy 1.25.4 on Python, as in the Workshop study.

## Sceneshare format

The Warudo SceneShare plugin (`com.veasu.exporter` 0.1.0 in the 0.15.1 test VM) writes the file. It is a sequence of entries, with no header and no index:

| Field | Encoding |
| --- | --- |
| Tag length, tag | Little-endian `i32`, then UTF-8 bytes |
| Path length, path | Little-endian `i32`, then UTF-8 bytes. The path is relative to the Warudo data folder. |
| Data length | Little-endian `i64` |
| Data | The bytes of the entry |

Tags in the sample:

- `LOCAL_ASSET`. A `.warudo` uMod archive. The path starts with `Characters/`, `Props/`, or `Environments/`.
- `SCENE_JSON`. The Warudo scene file (`Scenes/<name>.scene`).

The file does not contain Steam Workshop items. The scene lists them in `requiredPlugins`, with a Steam ID, and the receiver must subscribe to them.

### Scene JSON

Top-level keys: `name`, `appVersion` (`0.14.3`), `requiredPlugins`, `requiredLocalAssets`, `selectedAssetId`, `selectedGraphId`, `assets`, `assetHierarchy`, `graphs`, `graphHierarchy`, `plugins` (settings for each plugin, by plugin ID).

An asset is `{typeId, name, active, id, version, dataInputs, triggers}`. `typeId` is a GUID from the Warudo type list (Camera is `6a05ecf3-…`), or a class name for some plugin types (`Feline.ParticleProp`).

Each data input is `{type, typeKind, defaultValue, value, properties}`:

- `type` is the .NET type name, for example `float` or `UnityEngine.Vector3`.
- `value` and `defaultValue` are JSON-encoded strings.
- An enum value is `{"label","value","description","icon"}`.
- A reference to another asset is `{"id","name"}`.
- A structured input (for example `Transform`) holds a nested `{id, dataInputs, triggers}` object.
- An input whose `value` equals its `defaultValue` is unchanged. The inventory reports only the changed inputs.

A transform has `Position`, `Rotation`, and `Scale`, in Unity coordinates. Unity uses a left-handed system with Y up, and `Rotation` is Euler angles in degrees, applied Z, then X, then Y. A conversion to glTF must change the handedness.

A graph is `{id, name, enabled, nodes, dataConnections, flowConnections}`. A node has a type GUID and a type name such as `ON_UPDATE`.

## Inventory

### Local assets

| Entry | Unity | Shaders | Content |
| --- | --- | --- | --- |
| Character (`.warudo`, 256 MB) | 2021.3.18f1, SDK 0.9.0 | NiloToon Character (13 materials) | 11 skinned meshes, 25 textures, a humanoid Avatar, UniVRM 0.x components (`VRMMetaObject`, `BlendShapeAvatar`, `BlendShapeClip`), 42 rotation constraints, a NiloToon character volume |
| Environment (2.7 MB) | 2021.3.45f2, SDK 0.14.3 | NiloToon Environment, URP Lit, procedural skybox | 365 GameObjects, 332 mesh renderers, 8 skinned mesh renderers, 57 meshes, 27 materials, 8 DXT1 textures, 3 animation clips (gears and propellers), 1 directional light, 1 BC6H cubemap, a URP Volume with 5 NiloToon volume types (anime post-process, bloom, character rendering, cinematic rim light, shadow control) |
| Prop, airship (13.7 MB) | 2021.3.45f2 | NiloToon Environment, URP Lit | 3 meshes, 7 materials, 8 textures, colliders |
| Prop, stage walls (0.7 MB) | 2021.3.45f2 | NiloToon Environment | 1 mesh, 1 material |
| Prop, stage ceiling (0.9 MB) | 2021.3.45f2 | NiloToon Environment | 4 meshes, 3 materials |
| Prop, mascot figure (1.1 MB) | 2021.3.45f2 | NiloToon Character | 17 meshes, 4 materials, capsule colliders |
| Prop, shadow catcher (0.1 MB) | 2021.3.45f2 | A custom surface shader | A plane with a mesh collider. It shows shadows and occludes other assets in point-light illumination. |

The environment has no baked lightmaps. No renderer has a lightmap index, and the lightmap list is empty. This differs from most Workshop environments, and it makes a static mesh conversion simpler. The environment's render settings have fog off, a procedural skybox, and ambient light from the sky (spherical harmonics).

Every material uses NiloToon or URP Lit. No material uses MToon. The issue text assumes MToon, but the character and the stage need NiloToon for the author's appearance.

### Scene assets

31 assets:

| Type | Count | Settings that differ from the defaults |
| --- | --- | --- |
| Camera | 6 | 4 cameras use Orbit Character on the visible character, with an orbit offset. 1 wide camera and 1 default camera use Free Look. 5 have camera noise. 2 send Spout output to screens. |
| Character | 2 | The same `.warudo` character. One is hidden (scale 0, disabled) and has VMC tracking. The other is visible at (1.84, 17.12, 0) and has no tracking. |
| Environment | 1 | Lights affect characters and props. Overrides on the environment lighting source and the reflection intensity. |
| Directional Light | 1 | Color (1, 0.97, 0.92). Rotation (45.2, 178.0, 0). |
| Post Processing Volume | 1 | Bloom on (threshold 0.76, intensity 0.98). Gaussian depth of field with autofocus on the visible character. This type is not in the free 0.15.1 type list. |
| Prop | 7 | The 5 local props, a mirror plane from the Workshop, and a second shadow catcher. The airship is at scale 1.5. |
| Screen | 5 | 3 Spout screens that show 2 camera outputs (1 screen is disabled). 2 browser screens that show live chat pages. |
| DMX fixture group (plugin) | 3 | A row of 5 RGB moving heads, a grid of 12, and 28 LED pars. Each listens on its own Art-Net universe. |
| Art-Net DMX receiver (plugin) | 1 | UDP port 6454 |
| Particle prop (plugin) | 1 | Attached to the hips of the hidden character |
| VMC Receiver | 1 | Port 39539. It drives the hidden character. |
| FPS Counter, Onboarding Assistant | 2 | None |

The visible character stands on the airship deck, about 17 m above the stage floor. Four cameras frame it there. The wide camera frames the stage at floor level.

### Blueprints

| Graph | Enabled | Nodes | Purpose |
| --- | --- | --- | --- |
| Face Tracking - VMC | No | 18 | The default VMC face graph |
| Pose Tracking - VMC | No | 14 | The default VMC pose graph |
| Expression Key Bindings | Yes | 2 | A key exits all expressions |
| ISMINE Transitions | Yes | 40 | A Stream Deck trigger and plugin triggers scale, move, and toggle assets |
| New Blueprint | Yes | 2 | Ragdoll and prop throw |

### Plugins

The scene requires 3 Workshop items. They are a MegaFX props plugin, a particle prop plugin, and a planar mirror prop (URP). The plugin settings also name an Art-Net DMX plugin (`com.vtoku.artnetdmx`), a material properties plugin, an animator trigger plugin, an OSC plugin, the SceneShare exporter, and the built-in `Warudo.NiloToon` plugin. NiloToon rendering in Warudo needs Warudo Pro ([NiloToon research](2026-10-17-nilotoon-research.md)).

## Mapping to OpenSekai

| Element | OpenSekai today | Parity | Result for this scene |
| --- | --- | --- | --- |
| Environment meshes and transforms | One GLB environment for each scene | ENV-01 Partial | Possible after a conversion to GLB. No product import path exists (ENV-12 is a candidate). |
| Stage props (airship, walls, ceiling, mascot) | Props from the scene model library, each a mesh entity with a model and its own transform | ENV-03 Partial | Mapped. Each prop is a GLB record. The mascot is one record. |
| Gear and propeller animation | No animation on environment or prop meshes | ENV-01, ENV-03 | Gap. Imported scene assets have no animation clips. |
| NiloToon Environment and URP Lit materials | glTF PBR on environment materials, MToon on VRM | MAT-01, MAT-04 | Blocked by question 2 |
| Character | VRM 0 or 1 with MToon | CHR-01, MAT-01 | Blocked by question 1 |
| Spring bones and rotation constraints | Not simulated | CHR-08 | Gap |
| Directional light | Directional light with color, intensity, and shadow | ENV-07 Partial | Direct mapping. Warudo intensity units need a calibration. |
| Ambient light from the procedural sky | Ambient light entity, static room environment map on environment materials only | ENV-02, ENV-07 | Approximate with an ambient light. A procedural sky is a gap. |
| Procedural skybox | No sky. Output is transparent. | ENV-02 (sky subset First) | Gap |
| Bloom | None | CAM-06 Later | Gap |
| Depth of field with autofocus | None | CAM-07 Later | Gap |
| NiloToon volumes (anime post-process, rim light, shadow control) | None | MAT-05 Later | Gap. Parked with the NiloToon work. |
| Cameras (6), lens, orbit on a character | 8 cameras, Free Look and Orbit Character, field of view | CAM-01, CAM-02 Partial | Direct mapping of transforms and field of view. The orbit offset and camera noise need a check. |
| Camera noise | None | CAM-12 Later | Gap |
| Spout screens that show other cameras | None | MED-06 Later, CAM-09 Later | Gap. A same-app camera-to-screen texture is a different API. |
| Browser chat screens | None | MED-03 Later | Gap |
| Mirror plane | None | [#221](https://github.com/danirukun/opensekai/issues/221) | Gap |
| Shadow catcher planes | None | ENV-07 | Gap. OpenSekai has no shadow-only material. The generator reports them as not bound. |
| DMX fixture groups and the Art-Net receiver | Spot lights with volumetric beams in a haze box. No DMX input. | ENV-08 Partial, EXT-12 Later | Approximate the fixture positions with static spot lights. DMX input is a gap. |
| Particle prop | None | ENV-10 Later | Gap |
| VMC receiver on the hidden character | VMC receive | TRK-01 Partial | Not visible in the reference. Out of scope for the visual benchmark. |
| Blueprints | Blueprint graphs with a different node set | BP | Out of scope for the visual benchmark. The ISMINE transitions and Stream Deck trigger need EXT-11. |
| Scene file import | None | SCN-03 Later, ENV-12 Candidate | Gap. This spike converts with local scripts only. |

## Rebuild plan

1. Convert the environment and the 4 stage props to GLB with UnityPy. Keep the meshes, the transform hierarchy, the base color and emission textures, and the gear animation clips. Keep the output in `fixtures/local/`.
2. Generate an `.osekai` show from the inventory. It has the environment, the props at their transforms, the directional light, an ambient light, and the 6 cameras. Convert the coordinates from Unity to glTF.
3. Capture each camera in OpenSekai with MCP `camera_screenshot` and in OBS.
4. Capture the same cameras in Warudo.
5. Put the image pairs in `docs/evaluation/` and attach them to the PR.
6. File one issue for each gap that no parity issue covers.

## Rebuild result

Checked on 2026-10-28 on macOS with the ENV-03 branch (`feat/env-03-props`, [#242](https://github.com/danirukun/opensekai/pull/242)) and the free Warudo 0.15.1 in the test VM.

### Show generator

`scripts/warudo-show.ts` writes an `.osekai` show from the sceneshare and a bindings file. The bindings file maps each Warudo `Source` URI to an OpenSekai library ID. It stays local, because the IDs come from the local library.

```sh
pnpm exec tsx scripts/warudo-show.ts <file.sceneshare> <bindings.json> <out.osekai>
```

The generator makes 13 entities from the Bonnie scene: the environment, the character, 6 cameras, the directional light, and 4 props (walls, ceiling, mascot, airship). It reports 18 assets that it does not map, each with a reason. The two shadow catchers and the mirror plane have no bound model.

### Captures

The agent loaded the show into the running app with MCP `scene_replace` and captured each camera with MCP `camera_screenshot`. It captured Warudo through the VM screen and the camera Take Screenshot trigger. The captures stay local, because they show third-party models.

| Camera | OpenSekai | Free Warudo | Result |
| --- | --- | --- | --- |
| CU_FOLLOW | The character face, the mast and the rail on the left, sky on the right | The character in magenta, the mast and the rail on the left, a rail at the lower right, sky | The framing agrees. Free Warudo shows NiloToon materials as magenta, so the character side cannot be compared. |
| FIXED_WIDE | The stage at floor level: the banner, the steps, the chat panel, the gears, the right panel | Almost all magenta (the NiloToon stage). The right panel shows the CU_FOLLOW camera | The camera agrees. The right panel in Warudo is a Spout screen. OpenSekai has no screens, so it shows the stage texture. |
| Camera | The deck from above, the character and the mascot | The deck from above, in magenta | Not compared. The Warudo camera moved after the sceneshare export (live position (-1.12, 21.30, 6.16), file position (-0.22, 19.79, 3.35)). |
| FULL_BODY_FOLLOW, MCU_FOLLOW_LEFT, MCU_FOLLOW_RIGHT | Captured | Not captured | Open. See below. |

### Airship placement

The airship is correct at the Warudo transform. The character (y 17.12) stands on the deck inside the rails, and the mascot (y 17.62) stands on the deck next to it. The airship GLB has no root offset (the converter report shows an identity prefab root).

FULL_BODY_FOLLOW in OpenSekai looks through the hull at the character. The Warudo capture for this camera was not made. An Orbit Character camera in Warudo also stores `OrbitRotation` and `OrbitOffset`. The generator uses the stored transform only. It is not known if Warudo frames this camera from the transform or from the orbit values.

### Stream reference

The stream frames show the stage at floor level. They do not show the airship. The stream camera positions are not in the sceneshare, so the stream frames are a reference for the look of the stage only, not for the camera angles.

### Open items

- Capture FULL_BODY_FOLLOW, MCU_FOLLOW_LEFT, and MCU_FOLLOW_RIGHT in Warudo. An automated capture of all cameras in one script was not permitted in this session. The maintainer can switch the main camera in the Warudo editor (the camera icon in the asset list) and take a screenshot.
- Decide if the PR can carry renders of the third-party models. The constraint forbids commits of the assets. The issue asks for screenshots in the PR. This document does not include them.

## Blockers

The spike recorded these questions before the rebuild.


1. **Character source.** OpenSekai loads a VRM. The sceneshare has only the Unity build of the character, with NiloToon materials. Is a VRM export of this character (VRM 0 or 1, with MToon) available? If not, should the spike use the QA avatar in its place? A conversion of the Unity character to VRM recreates the rig, the expressions, and the materials, and the result is not the author's appearance. Recommended default. Use a VRM export when one exists. Otherwise put the QA avatar at the character's position, and mark the character comparison as not done.
2. **Material policy.** Every material uses NiloToon or URP Lit. The NiloToon work is parked for license reasons. May the spike map NiloToon Environment and URP Lit materials to glTF PBR (base color, base map, emission) and label the result as an approximation? Or must those materials wait for MAT-04? Recommended default. Map to PBR, mark each mapped material as approximate in the evidence, and do not claim NiloToon appearance.
3. **Warudo reference.** NiloToon materials render only in Warudo Pro. The test VM has free Warudo 0.15.1 without the NiloToon plugin or the post-processing volume type. Where do the Warudo reference captures come from? There are three options. The maintainer captures the 6 cameras on a Warudo Pro machine. The VM gets a Warudo Pro license. Or the spike uses free Warudo captures that show the fallback materials. Recommended default. The maintainer captures from Warudo Pro, at 1920 × 1080.
4. **Conversion tool in the repository.** The converter needs UnityPy (Python). The repository has TypeScript tools and one Blender Python script. Should the spike commit the converter under `scripts/`, or keep it local? Recommended default. Keep it local until ENV-12 passes its selection gate, and record its steps in this document.

## Decisions

The maintainer answered blockers 1 to 3 on 2026-10-28. Blocker 4 uses its recommended default.

1. **Character.** The QA avatar (a VRM 0 ARKit model) stands at the character's position. The comparison does not include the character's appearance.
2. **Materials.** NiloToon Environment, NiloToon Character, and URP Lit materials map to glTF PBR with base color, base map, and emission. The evidence labels each mapped material as approximate. OpenSekai does not claim NiloToon appearance.
3. **Warudo reference.** The reference captures come from free Warudo 0.15.1 in the test VM. These captures show the fallback materials of free Warudo, without bloom and depth of field. They are not the author's appearance.
4. **Converter.** The UnityPy converter stays local. This document records its steps.
