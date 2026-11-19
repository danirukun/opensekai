# lilToon sample avatar

These Unity editor scripts make the lilToon test avatar for the lilToon on WebGPU slice. The input is the MToon Catboy VRM. The output is a VRM 1.0 file. Each material of the output carries the glTF extension `MOCHIYA_materials_liltoon` (spec 1.3).

The Unity project, the avatar copy, and the export stay outside the repository in `~/opensekai-liltoon-sample/`. Do not add an avatar file or a Unity project to the repository.

## Tool versions

| Tool | Version | Source |
| --- | --- | --- |
| Unity | 6000.0.71f1 | `/Applications/Unity/Hub/Editor/6000.0.71f1` |
| UniGLTF | 0.131.4 | `https://github.com/vrm-c/UniVRM.git?path=/Packages/UniGLTF#v0.131.4` (commit `efd20f62f1bf0ac3fcc34de1e497324c5197d146`) |
| UniVRM (VRM10) | 0.131.4 | `https://github.com/vrm-c/UniVRM.git?path=/Packages/VRM10#v0.131.4` (commit `efd20f62f1bf0ac3fcc34de1e497324c5197d146`) |
| lilToon | 2.4.1 | `https://github.com/lilxyzw/lilToon.git?path=Assets/lilToon#2.4.1` (commit `e698a2f791bd28dd1aabf227c74f14bedeca3587`) |
| Mochiya Avatar Tools | 0.1.7 | `https://github.com/mochiya-labs/unity-avatar-tools.git#c3745f3c01d43777fee6f877779b09f8ddec2f03` |

`Export/versions.json` records the versions that Unity resolved for the export.

## Make the project

1. Create the project:

   ```sh
   UNITY=/Applications/Unity/Hub/Editor/6000.0.71f1/Unity.app/Contents/MacOS/Unity
   "$UNITY" -batchmode -quit -nographics -createProject ~/opensekai-liltoon-sample
   ```

2. Add the four packages above to `dependencies` in `~/opensekai-liltoon-sample/Packages/manifest.json`. The keys are `com.vrmc.gltf`, `com.vrmc.vrm`, `jp.lilxyzw.liltoon`, and `org.mochiya.avatar-tools`.
3. Set `m_ActiveColorSpace: 1` (Linear) in `ProjectSettings/ProjectSettings.asset`. A project from `-createProject` starts in Gamma. The WebGPU renderer works in linear space, so the reference capture must too.
4. Copy `Editor/*.cs` from this folder to `~/opensekai-liltoon-sample/Assets/Editor/`.
5. The lilToon editor assembly is not auto-referenced. Add `Assets/Editor/OpenSekai.LilToonSample.Editor.asmdef` with this content:

   ```json
   {
     "name": "OpenSekai.LilToonSample.Editor",
     "references": ["lilToon.Editor", "Mochiya.AvatarTools.Editor", "UniGLTF", "UniGLTF.Editor", "VRM10", "VRM10.Editor"],
     "includePlatforms": ["Editor"],
     "autoReferenced": true
   }
   ```

6. Copy `DaniruKun - Catboy - ARKit.vrm` to `~/opensekai-liltoon-sample/Assets/Catboy/`. Do not change the original file.

The UniVRM scripted importer migrates the VRM 0.x file to VRM 1.0 on import. The imported materials use the `VRM10/MToon10` shader. The convert script reads the MToon10 property names and also accepts the VRM 0.x `VRM/MToon` names.

On the first project open, the VRM can import before the MToon10 shader exists, and the import fails with `ArgumentNullException: Shader`. The convert script imports the file again when the prefab is missing.

## Run the scripts

Run each step without `-nographics`. The alpha check, the texture export, and the capture need a graphics device.

```sh
UNITY=/Applications/Unity/Hub/Editor/6000.0.71f1/Unity.app/Contents/MacOS/Unity
P=~/opensekai-liltoon-sample
"$UNITY" -batchmode -quit -projectPath "$P" -executeMethod LilToonSampleConvert.Run -logFile "$P-logs/convert.log"
"$UNITY" -batchmode -quit -projectPath "$P" -executeMethod LilToonSampleExport.Run -logFile "$P-logs/export.log"
"$UNITY" -batchmode -quit -projectPath "$P" -executeMethod LilToonSampleExport.Capture -logFile "$P-logs/capture.log"
```

The same methods are in the Unity menu: `OpenSekai > Convert Catboy to lilToon`, `OpenSekai > Export lilToon sample`, and `OpenSekai > Capture lilToon reference`.

Outputs:

| File | Content |
| --- | --- |
| `Assets/Catboy/Sample.unity` | The scene with the converted avatar, the reference light, and the reference camera. |
| `Assets/Catboy/lilToon/*.mat` | One lilToon material for each source material. |
| `Export/Catboy-lilToon.vrm` | The VRM 1.0 export with `MOCHIYA_materials_liltoon`. |
| `Export/versions.json` | `unity`, `univrm`, `liltoon`, `mochiyaAvatarTools` (commit), `exportPath`. |
| `Export/material-map.txt` | The material to feature table from the convert step. |
| `Export/unity-reference.png` | The reference capture. |

## Material mapping

`LilToonSampleConvert.Run` makes one lilToon material for each MToon material.

| MToon10 | lilToon |
| --- | --- |
| `_Color`, `_MainTex`, main scale and offset | `_Color`, `_MainTex`, `_MainTex_ST` |
| `_AlphaMode` opaque, cutout, transparent | `lilToon`, `Hidden/lilToonCutout`, `Hidden/lilToonTransparent`; the `...Outline` variant when the outline is on |
| `_Cutoff`, `_DoubleSided` | `_Cutoff`, `_Cull` (0 when double-sided) |
| `_ShadeColor` | `_ShadowColor`, `_UseShadow` = 1 |
| `_ShadeTex` | `_ShadowColorTex` only when it is not the main texture |
| `_ShadingShiftFactor` s, `_ShadingToonyFactor` t | `_ShadowBorder` = 0.5 - 0.5 s, `_ShadowBlur` = 1 - t |
| `_BumpMap`, `_BumpScale` | `_BumpMap`, `_BumpScale`, `_UseBumpMap` = 1 |
| `_RimColor`, `_RimFresnelPower` | `_RimColor`, `_RimFresnelPower`, `_UseRim` = 1 when the color is not black |
| `_MatcapTex`, `_MatcapColor` | `_MatCapTex`, `_MatCapColor`, `_MatCapBlendMode` = 1 (add), `_UseMatCap` = 1 |
| `_EmissionColor`, `_EmissionMap` | `_EmissionColor`, `_EmissionMap`, `_UseEmission` = 1 when the color is not black |
| `_OutlineWidthMode`, `_OutlineWidth` (m), `_OutlineColor`, `_OutlineWidthTex`, `_OutlineLightingMix` | outline shader variant, `_OutlineWidth` = width x 100, `_OutlineColor`, `_OutlineWidthMask`, `_OutlineEnableLighting` |
| render queue | render queue (kept so that the face layers keep their order) |

Notes on the mapping:

- The shadow border and blur come from the two shading models. MToon10 shades with `linearstep(-1 + t, 1 - t, NdotL + s)`. lilToon shades on the half-Lambert value with the window `[border - blur / 2, border + blur / 2]`.
- The outline is on only when `_OutlineWidthMode` is not `none` and the width is above 0. Eight Catboy materials carry a width of 0.08 with mode `none`; they get no outline.
- A cutout material whose main texture has no alpha below 1 becomes an opaque material. The check reads the texture through a render texture.
- VRoid fills unused texture slots with 1x1 `Shader_None*` textures. Those slots count as empty.

### Extra features by material name

| Material | Extra features |
| --- | --- |
| `*_SKIN` (face, body) | second and third shadow band with distinct colors, backlight, a visible rim |
| `*_HAIR` | second and third shadow band with distinct colors, a visible rim; the matcap comes from the source |
| `Accessory_CatEar_01_CLOTH` | emission, cyan, with `_EmissionMainStrength` = 1 |

lilToon has no `_UseShadow2nd` or `_UseShadow3rd` property. The alpha of `_Shadow2ndColor` and `_Shadow3rdColor` turns the band on. The convert script sets that alpha to 0 on every other material, because lilToon turns the second band on by default.

### Result for the Catboy export

| Material | `shaderVariant` | Features in the export |
| --- | --- | --- |
| `N00_000_00_FaceMouth_00_FACE` | `lilToon` | shadow 1 |
| `N00_000_00_EyeIris_00_EYE` | `Hidden/lilToonTransparent` | shadow 1 |
| `N00_000_00_EyeHighlight_00_EYE` | `Hidden/lilToonTransparent` | shadow 1 |
| `N00_000_00_Face_00_SKIN` | `Hidden/lilToonOutline` | shadow 1, 2, 3; normal map; rim; backlight; matcap; outline with width mask |
| `N00_000_00_EyeWhite_00_EYE` | `lilToon` | shadow 1 |
| `N00_000_00_FaceBrow_00_FACE` | `Hidden/lilToonTransparent` | shadow 1; matcap |
| `N00_000_00_FaceEyelash_00_FACE` | `Hidden/lilToonTransparent` | shadow 1; matcap |
| `N00_000_00_FaceEyeline_00_FACE` | `Hidden/lilToonTransparent` | shadow 1; matcap |
| `N00_000_00_Body_00_SKIN` | `Hidden/lilToonCutoutOutline` | shadow 1, 2, 3; normal map; rim; backlight; matcap; outline |
| `Accessory_GlassesHiFrame_01_MATCAP` | `Hidden/lilToonOutline` | shadow 1; rim; matcap; outline |
| `Accessory_GlassesHiLens_01_MATCAP` | `Hidden/lilToonTransparent` | shadow 1; rim; matcap |
| `Accessory_CatEar_01_CLOTH` | `Hidden/lilToonOutline` | shadow 1; rim; matcap; emission; outline |
| `N00_004_01_Shoes_01_CLOTH` | `Hidden/lilToonOutline` | shadow 1; rim; matcap; outline |
| `N00_005_01_Tops_01_CLOTH` | `Hidden/lilToonCutoutOutline` | shadow 1; rim; matcap; outline |
| `N00_001_01_Bottoms_01_CLOTH` | `Hidden/lilToonCutoutOutline` | shadow 1; rim; matcap; outline |
| `N00_000_Hair_00_HAIR` | `Hidden/lilToonOutline` | shadow 1, 2, 3; normal map; rim; matcap; emission; outline |

The body, tops, and bottoms textures have alpha below 1, so they stay cutout. The matcap on most parts is the VRoid `MatcapWarp_01` texture of the source. The transparent face layers keep the migrated render queues 2996 to 3000, so the eye line, iris, highlight, brow, and eyelash draw in the source order.

## Export

`LilToonSampleExport.Run` exports with `MochiyaAvatarWorkflow.Export`. The scene root has a `Vrm10Instance` and a humanoid `Animator`, so the exporter takes it as a prepared avatar and writes it with the UniVRM `Vrm10Exporter` and the Mochiya material exporter. The export profile uses the VRM metadata of the source file.

`versions.json` records `"exportPath": "mochiya"`. The fallback path (`inject`: a plain UniVRM export plus a script that adds the extension) was not needed.

## Reference capture

`LilToonSampleExport.Capture` renders the reference camera to a 1920x1080 render texture and writes `Export/unity-reference.png`. Batch mode has no Game view, so `ScreenCapture` is not used. Task 10 uses the same values:

| Setting | Value |
| --- | --- |
| Color space | Linear |
| Render pipeline | Built-in |
| Directional light | intensity 1, color white, rotation (50, -30, 0), no shadows |
| Ambient | flat color (0.2, 0.2, 0.2) |
| Camera | position (0, 1.3, 1.6), looks at (0, 1.3, 0), vertical FOV 35 degrees, near 0.05, far 20 |
| Camera background | solid color (0.3, 0.3, 0.3), no HDR, no MSAA |
| Output | 1920x1080 PNG |

With this camera, the vertical field of view at the avatar is about 1.0 m. The capture shows the avatar from the hips up.

## Check the file

A Python script reads the GLB JSON and checks each material: the extension is present, `specVersion` is `"1.3"`, `shaderVariant` is set, and each texture index points to a valid texture and image. A Node script validates the extension objects against `schema/MOCHIYA_materials_liltoon.schema.json` of the three-liltoon fork with `ajv`.
