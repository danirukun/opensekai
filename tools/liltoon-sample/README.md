# lilToon sample avatar

These Unity editor scripts convert an MToon VRM avatar to lilToon. They made the lilToon test avatar for the lilToon on WebGPU slice from the MToon Catboy VRM, and they convert other MToon avatars the same way. The output is a VRM 1.0 file. Each material of the output carries the glTF extension `MOCHIYA_materials_liltoon` (spec 1.3).

The `.agents/skills/liltoon-convert` skill gives the full workflow for a new avatar, from the source file to the owner look check in OpenSekai.

The Unity project, the avatar copy, and the export stay outside the repository in `~/opensekai-liltoon-sample/`. Do not add an avatar file or a Unity project to the repository.

## Tool versions

| Tool | Version | Source |
| --- | --- | --- |
| Unity | 6000.0.71f1 | `/Applications/Unity/Hub/Editor/6000.0.71f1` |
| UniGLTF | 0.131.4 | `https://github.com/vrm-c/UniVRM.git?path=/Packages/UniGLTF#v0.131.4` (commit `efd20f62f1bf0ac3fcc34de1e497324c5197d146`) |
| UniVRM (VRM10) | 0.131.4 | `https://github.com/vrm-c/UniVRM.git?path=/Packages/VRM10#v0.131.4` (commit `efd20f62f1bf0ac3fcc34de1e497324c5197d146`) |
| lilToon | 2.4.1 | `https://github.com/lilxyzw/lilToon.git?path=Assets/lilToon#2.4.1` (commit `e698a2f791bd28dd1aabf227c74f14bedeca3587`) |
| Mochiya Avatar Tools | 0.1.7 | `https://github.com/mochiya-labs/unity-avatar-tools.git#c3745f3c01d43777fee6f877779b09f8ddec2f03` |

`Export/<Avatar>/versions.json` records the versions that Unity resolved for the export.

## Make the project

1. Create the project:

   ```sh
   UNITY=/Applications/Unity/Hub/Editor/6000.0.71f1/Unity.app/Contents/MacOS/Unity
   "$UNITY" -batchmode -quit -nographics -createProject ~/opensekai-liltoon-sample
   ```

2. Add the four packages above to `dependencies` in `~/opensekai-liltoon-sample/Packages/manifest.json`. The keys are `com.vrmc.gltf`, `com.vrmc.vrm`, `jp.lilxyzw.liltoon`, and `org.mochiya.avatar-tools`.
3. Set `m_ActiveColorSpace: 1` (Linear) in `ProjectSettings/ProjectSettings.asset`. A project from `-createProject` starts in Gamma. The WebGPU renderer works in linear space, so the reference capture must too.
4. Copy `Editor/*.cs` and `Editor/OpenSekai.LilToonSample.Editor.asmdef` from this folder to `~/opensekai-liltoon-sample/Assets/Editor/`. The lilToon editor assembly is not auto-referenced, so the scripts need the assembly definition.
5. Copy the source VRM to `~/opensekai-liltoon-sample/Assets/<Avatar>/`, where `<Avatar>` is a short name with no spaces. The folder must hold exactly one `.vrm` file. For the Catboy, copy `DaniruKun - Catboy - ARKit.vrm` to `Assets/Catboy/`. The source file is the owner's Catboy avatar in iCloud Drive: `~/Library/Mobile Documents/com~apple~CloudDocs/VTuber Avatars/DaniruKun - Catboy - ARKit.vrm` (VRM 0.x, all materials `VRM/MToon`). Do not change the original file.
6. Make the log directory: `mkdir -p ~/opensekai-liltoon-sample-logs`.

The UniVRM scripted importer migrates the VRM 0.x file to VRM 1.0 on import. The imported materials use the `VRM10/MToon10` shader. The convert script reads the MToon10 property names and also accepts the VRM 0.x `VRM/MToon` names.

On the first project open, the VRM can import before the MToon10 shader exists, and the import fails with `ArgumentNullException: Shader`. The convert script imports the file again when the prefab is missing.

## Run the scripts

Run each step without `-nographics`. The texture export and the capture need a graphics device. Each step takes about 5 to 10 seconds after the first project open. Close the Unity Editor on this project first; batch mode cannot open a project that is open.

```sh
UNITY=/Applications/Unity/Hub/Editor/6000.0.71f1/Unity.app/Contents/MacOS/Unity
P=~/opensekai-liltoon-sample
A=Catboy   # the folder name under Assets
mkdir -p "$P-logs"
"$UNITY" -batchmode -quit -projectPath "$P" -executeMethod LilToonSampleConvert.Run -avatar "$A" -logFile "$P-logs/$A-convert.log"
"$UNITY" -batchmode -quit -projectPath "$P" -executeMethod LilToonSampleExport.Run -avatar "$A" -logFile "$P-logs/$A-export.log"
"$UNITY" -batchmode -quit -projectPath "$P" -executeMethod LilToonSampleExport.Capture -avatar "$A" -logFile "$P-logs/$A-capture.log"
"$UNITY" -batchmode -quit -projectPath "$P" -executeMethod LilToonSampleExport.CaptureOriginal -avatar "$A" -logFile "$P-logs/$A-capture-original.log"
```

Arguments of each method:

| Argument | Default | Effect |
| --- | --- | --- |
| `-avatar <Avatar>` | `Catboy` | The folder under `Assets` that holds the source `.vrm`. |
| `-preset catboy\|none` | `catboy` for `Catboy`, else `none` | `none` maps the MToon values only (see Material mapping) and frames the camera on the head bone. `catboy` adds the slice features by material name (see Extra features by material name) and uses the fixed reference rig of the recorded evidence. Do not use `catboy` for another avatar. |

Pass the same arguments to each of the four methods. The menu items (`OpenSekai > Convert avatar to lilToon`, `OpenSekai > Export lilToon sample`, `OpenSekai > Capture lilToon reference`, `OpenSekai > Capture MToon original`) use the defaults, so they convert the Catboy.

The convert step stops with an error that lists each material whose shader is not MToon. The mapping reads MToon properties only, so another shader would convert with default values.

The convert step deletes and makes each material asset again, so no value from an old run stays in the assets. The convert step and the MToon capture open a new scene in place of the open scene; save your work before you run them from the menu.

Outputs:

| File | Content |
| --- | --- |
| `Assets/<Avatar>/Sample.unity` | The scene with the converted avatar, the reference light, and the reference camera. |
| `Assets/<Avatar>/lilToon/*.mat` | One lilToon material for each source material. |
| `Export/<Avatar>/<Avatar>-lilToon.vrm` | The VRM 1.0 export with `MOCHIYA_materials_liltoon`. |
| `Export/<Avatar>/versions.json` | `unity`, `univrm`, `liltoon`, `mochiyaAvatarTools` (commit), `exportPath`, `avatar`, `preset`. |
| `Export/<Avatar>/material-map.txt` | The material to feature table from the convert step. |
| `Export/<Avatar>/unity-reference.png` | The reference capture. |
| `Export/<Avatar>/unity-mtoon-original.png` | The capture of the unconverted MToon avatar with the same rig. The conversion must keep this look. |

Before the `-avatar` argument, the outputs were in `Export/` with no avatar folder. The scripts with the argument make the third Catboy export again with the same sha256 (`2cd7340b…`).

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
- The `none` preset changes four lilToon defaults that do not agree with MToon. The `catboy` preset keeps the defaults, so the recorded Catboy export does not change.
  - `_ShadowBorderColor` = black. MToon has no shadow border gradient. The default (1, 0.1, 0) moves the red channel of the shade toward the lit color near each shadow edge. With a black MToon shade, this gives red edges on the face, the hair, and the clothes.
  - `_ShadowEnvStrength` = 1. MToon adds albedo x ambient to the shade (`shade x light + albedo x GI`). lilToon adds it only with this strength (`lerp(shade, albedo, ambient x strength)`), so with the default 0 a black shade stays black.
  - `_AAStrength` = 0. MToon shades with a hard `linearstep` and no anti-aliasing. lilToon widens the shadow border by the screen derivative of the half-Lambert value, so thin and curved parts (eyelashes, the nose tip) go into the shade.
  - `_FlipNormal` = 1. MToon turns the normal of a back face toward the camera (`MTOON_IS_FRONT_VFACE`). lilToon does that only with this flag, so with the default 0 the inner side of a double-sided part (a jacket lining) is in the shade.
- A cutout material with `_Cutoff` 1 has a different result in each renderer. UniVRM MToon10 clips `(alpha - cutoff) / fwidth(alpha) + 0.5 - cutoff`, and three discards `alpha <= alphaTest`, so both remove all the pixels. The Unity lilToon cutout keeps the pixels with alpha 1 (`saturate((alpha - cutoff) / fwidth(alpha) + 0.5)` is 0.5). The converter keeps the source value. Thus `unity-reference.png` shows the part and `unity-mtoon-original.png` does not, but in OpenSekai the MToon avatar and the lilToon avatar agree. The RORO eyelash mesh has this value.
- `_ShadowReceive` stays at the lilToon default 0. MToon 1.0 receives cast shadows, but the reference rig has no shadows, so a capture cannot check a change. Check it in OpenSekai with cast shadows on before you change it.
- The outline is on only when `_OutlineWidthMode` is not `none` and the width is above 0. Eight Catboy materials carry a width of 0.08 with mode `none`; they get no outline.
- With the `catboy` preset, four cutout materials become opaque by name (`N00_000_00_EyeWhite_00_EYE`, `Accessory_GlassesHiFrame_01_MATCAP`, `Accessory_CatEar_01_CLOTH`, `N00_004_01_Shoes_01_CLOTH`). Their main textures have no alpha below 1, so the look is the same, and the export keeps the opaque and the opaque+outline variants next to the cutout ones. The other cutout materials stay cutout, with `Hidden/lilToonCutout` on the mouth and `Hidden/lilToonCutoutOutline` on the face, body, tops, bottoms, and hair.
- VRoid fills unused texture slots with 1x1 `Shader_None*` textures. Those slots count as empty.
- The exporter writes `_MainTex_ST` in glTF UV space, with the V axis flipped: a Unity scale (sx, sy) and offset (ox, oy) becomes `[sx, sy, ox, oy - sy + 1]`, the same values as the `KHR_texture_transform` of the base color texture. A port must read it that way. Every Catboy material has the identity transform, so the export carries `[1, 1, 0, 0]`.

### Extra features by material name

Only the `catboy` preset adds these features. They are coverage choices for the Catboy test avatar, not a part of the mapping.

| Material | Extra features |
| --- | --- |
| `*_SKIN` (face, body) | second and third shadow band with distinct colors, backlight, a visible rim |
| `N00_000_00_Body_00_SKIN` | `_ShadowStrengthMask` = the body main texture (its red channel varies) |
| `*_HAIR` | second and third shadow band with distinct colors, a visible rim; the matcap and the emission come from the source hair MToon material |
| `*_CatEar_*` | a neutral grey `_ShadowColor` (sRGB 0.84) in place of the white source shade |

The extra features keep the look of the MToon avatar; `Export/Catboy/unity-mtoon-original.png` is the look to compare against. The face gets no shadow mask, because a mask from the face outline width texture puts the skin around the eyes and the mouth into the second and third band. The cat ear gets no extra emission and no main texture transform, because they change its grey. The source cat ear has a white shade, so a light does not shade it; at the owner's request it gets a grey shadow color with the brightness of the cloth shade (sRGB 0.81 / 0.84 / 0.97) but no blue.

lilToon has no `_UseShadow2nd` or `_UseShadow3rd` property. The alpha of `_Shadow2ndColor` and `_Shadow3rdColor` turns the band on. The convert script sets that alpha to 0 on every other material, because lilToon turns the second band on by default.

lilToon mixes the second and the third band into the first shadow region only (`lil_common_frag.hlsl`: the final `lerp(indirectCol, directCol, lns.x)` uses the first band factor). A second or third border above the first border gives one merged region, not three bands. The script sets the second border to 0.75 x the mapped first border and the third border to 0.45 x, with blur 0.02. The Catboy face has a first border near 0.15, so its bands are narrow and sit only on the shadow-side edge of the face. Read the second and third bands on the neck and the body skin (first border 0.525), and on the hair (first border 0.6), not on the face proper.

### Result for the Catboy export

| Material | `shaderVariant` | Features in the export |
| --- | --- | --- |
| `N00_000_00_FaceMouth_00_FACE` | `Hidden/lilToonCutout` | shadow 1 |
| `N00_000_00_EyeIris_00_EYE` | `Hidden/lilToonTransparent` | shadow 1 |
| `N00_000_00_EyeHighlight_00_EYE` | `Hidden/lilToonTransparent` | shadow 1 |
| `N00_000_00_Face_00_SKIN` | `Hidden/lilToonCutoutOutline` | shadow 1, 2, 3; normal map; rim; backlight; matcap; outline with width mask |
| `N00_000_00_EyeWhite_00_EYE` | `lilToon` | shadow 1 |
| `N00_000_00_FaceBrow_00_FACE` | `Hidden/lilToonTransparent` | shadow 1; matcap |
| `N00_000_00_FaceEyelash_00_FACE` | `Hidden/lilToonTransparent` | shadow 1; matcap |
| `N00_000_00_FaceEyeline_00_FACE` | `Hidden/lilToonTransparent` | shadow 1; matcap |
| `N00_000_00_Body_00_SKIN` | `Hidden/lilToonCutoutOutline` | shadow 1, 2, 3; shadow strength mask; normal map; rim; backlight; matcap; outline |
| `Accessory_GlassesHiFrame_01_MATCAP` | `Hidden/lilToonOutline` | shadow 1; rim; matcap; outline |
| `Accessory_GlassesHiLens_01_MATCAP` | `Hidden/lilToonTransparent` | shadow 1; rim; matcap |
| `Accessory_CatEar_01_CLOTH` | `Hidden/lilToonOutline` | shadow 1 (grey shadow color); rim; matcap; outline |
| `N00_004_01_Shoes_01_CLOTH` | `Hidden/lilToonOutline` | shadow 1; rim; matcap; outline |
| `N00_005_01_Tops_01_CLOTH` | `Hidden/lilToonCutoutOutline` | shadow 1; rim; matcap; outline |
| `N00_001_01_Bottoms_01_CLOTH` | `Hidden/lilToonCutoutOutline` | shadow 1; rim; matcap; outline |
| `N00_000_Hair_00_HAIR` | `Hidden/lilToonCutoutOutline` | shadow 1, 2, 3; normal map; rim; matcap; emission; outline |

Variants in the export (16 materials, `check_sample.py`): opaque (1), opaque with outline (3), cutout (1), cutout with outline (5), transparent (6). Only transparent with outline is absent; the source has no such material. The matcap on most parts is the VRoid `MatcapWarp_01` texture of the source. The transparent face layers keep the migrated render queues 2996 to 3000, so the eye line, iris, highlight, brow, and eyelash draw in the source order.

## Export

`LilToonSampleExport.Run` exports with `MochiyaAvatarWorkflow.Export`. The scene root has a `Vrm10Instance` and a humanoid `Animator`, so the exporter takes it as a prepared avatar and writes it with the UniVRM `Vrm10Exporter` and the Mochiya material exporter. The export profile uses the VRM metadata of the source file.

`versions.json` records `"exportPath": "mochiya"`. The fallback path (`inject`: a plain UniVRM export plus a script that adds the extension) was not needed.

## Reference capture

`LilToonSampleExport.Capture` renders the reference camera to a 1920x1080 render texture and writes `Export/<Avatar>/unity-reference.png`. Batch mode has no Game view, so `ScreenCapture` is not used. The `catboy` preset uses these values, and Task 10 uses the same values. The `none` preset uses the same light and camera settings, with two changes. The camera looks at a point 0.15 m below the head bone from 1.6 m in front of it, so an avatar of a different height is framed the same way. The ambient is the same flat color plus an L1 term of 0.001 on +Y in each color channel (`AmbientMode.Custom`); see the note below the table.

| Setting | Value |
| --- | --- |
| Color space | Linear |
| Render pipeline | Built-in |
| Directional light | intensity 1, color white, rotation (50, 150, 0), world forward (0.3214, -0.7660, -0.5567), no shadows |
| Ambient | flat color (0.2, 0.2, 0.2) |
| Camera | position (0, 1.3, 1.6), looks at (0, 1.3, 0), vertical FOV 35 degrees, near 0.05, far 20 |
| Camera background | solid color (0.3, 0.3, 0.3), no HDR, camera MSAA off (`allowMSAA` = false; the render texture has no multisampling) |
| Output | 1920x1080 PNG |

The capture script re-asserts every value in this table before it renders, and saves the scene with them.

In the built-in pipeline, lilToon (OpenLit) gets the indirect light from the SH probe on the axis of the L1 term. A flat ambient has no L1 term, so the axis is not defined, and lilToon reads an indirect light of about 1 in place of 0.033. With `_ShadowEnvStrength` = 1 (the `none` preset), each shade then shows the lit color. With the L1 term of 0.001, a black shade on the RORO sleeve is sRGB (29, 34, 43) in lilToon and (29, 33, 43) in MToon. The MToon capture uses the same probe. The `catboy` preset keeps the flat ambient of the recorded evidence; its materials keep `_ShadowEnvStrength` = 0, which does not read the indirect light.

`LilToonSampleExport.CaptureOriginal` renders the unconverted MToon prefab with the same rig to `Export/<Avatar>/unity-mtoon-original.png`. It builds the light and the camera in a new scene that it does not save, and it writes the light forward vector to the log. Compare the two captures at the same pixels: the geometry, the pose, and the rig are the same, so a color difference between them comes from the conversion.

With this camera, the vertical field of view at the avatar is about 1.0 m. The capture shows the avatar from the hips up.

The light rotation (50, 150, 0) gives the world forward vector (0.3214, -0.7660, -0.5567): the light travels toward -Z and down. The avatar faces +Z, toward the camera, so the key light comes from above and in front of the avatar, from its left (the viewer's right), at three-quarter. The front of the face has a half-Lambert value near 0.78. Task 10 sets a directional light with the same forward vector in OpenSekai. The capture script writes the forward vector to the log (`Reference light forward`) and saves the scene with the re-asserted values.

## Check the file

`check_sample.py` reads the GLB JSON and checks each material: the extension is present, `specVersion` is `"1.3"`, `shaderVariant` is set, and each texture index points to a valid texture and image. It writes the first material's extension object to the optional second path.

```sh
python3 -I tools/liltoon-sample/check_sample.py ~/opensekai-liltoon-sample/Export/Catboy/Catboy-lilToon.vrm /tmp/first-material-ext.json
```

`validate_schema.cjs` validates the extension objects against `schema/MOCHIYA_materials_liltoon.schema.json` of the three-liltoon fork with `ajv` (draft-07, `strict: false`). The third argument is a material index or `all`. The fourth argument is the path of an `ajv` module when `ajv` is not on the Node module path, for example the fork's `node_modules/ajv`. The file is CommonJS (`.cjs`) because the repository `package.json` sets `"type": "module"`.

```sh
node tools/liltoon-sample/validate_schema.cjs \
  ~/ghq/github.com/danirukun/three-liltoon/schema/MOCHIYA_materials_liltoon.schema.json \
  ~/opensekai-liltoon-sample/Export/Catboy/Catboy-lilToon.vrm all \
  ~/ghq/github.com/danirukun/three-liltoon/node_modules/ajv
```

Both scripts exit with 1 on a failure.
