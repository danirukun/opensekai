---
name: liltoon-convert
description: Use when the user wants an MToon VRM avatar converted to lilToon, a VRM with MOCHIYA_materials_liltoon for OpenSekai, or a new lilToon test avatar or fixture, for example "convert my RORO avatar to lilToon" or "make a lilToon version of this VRM".
---

# Convert an MToon VRM to lilToon

The Unity tool in `tools/liltoon-sample` converts each MToon material to a lilToon material and exports a VRM 1.0 file with `MOCHIYA_materials_liltoon`. OpenSekai draws that file with the lilToon renderer. Read `tools/liltoon-sample/README.md` for the material mapping, the capture rig, and the project setup. This skill gives the order of work and the checks.

**Core rule: the converted avatar keeps the look of the original MToon avatar.** The owner judges the result against the original, not against the Unity lilToon render. Do not add features that the source does not have (extra shadow bands, shadow masks, texture tiling, emission, tints). Change a value only when the owner asks for that change.

## Rules

- Run every command from the repository root (`<repo>`, the worktree). Give each path as an absolute path. Do not `cd`.
- Do not change the source file. Work on a copy.
- Do not commit a `.vrm`, an avatar `.glb`, the Unity project, or a capture. Each of the owner's VRMs has the license `Redistribution_Prohibited`. Only tool and doc changes go into the repository.
- Use `-preset none` (the default for every avatar except `Catboy`). The `catboy` preset adds the Catboy test-coverage features by material name. A VRoid avatar has the same material names, so `catboy` changes its look.
- Use one Unity project, `~/opensekai-liltoon-sample`, for all avatars. Each avatar gets its own `Assets/<Avatar>/` folder and `Export/<Avatar>/` folder.
- Use the Fable model for the look comparisons (a subagent with `model: fable`).

## Workflow

1. **Inventory the source.**
   ```sh
   python3 -I <repo>/.agents/skills/liltoon-convert/scripts/vrm-inventory.py "<source.vrm>"
   ```
   It prints the VRM version, the material count, the shader count, and the license. Every material must be `VRM/MToon` (VRM 0.x) or `MToon10` (VRM 1.0). If a material has another shader (unlit, PBR, Standard), stop and ask the owner. The convert step refuses such a file.

2. **Get the project ready.** If `~/opensekai-liltoon-sample` does not exist, make it with "Make the project" in the tool README. Close the Unity Editor on that project. Batch mode cannot open a project that is open.

3. **Copy the source.** Choose a short `<Avatar>` name with no spaces (for example `RORO`). Copy the file into `~/opensekai-liltoon-sample/Assets/<Avatar>/`. The folder must hold exactly one `.vrm` file.

4. **Convert, export, and capture.**
   ```sh
   bash <repo>/.agents/skills/liltoon-convert/scripts/convert.sh <repo> <Avatar>
   ```
   The script copies the editor scripts from `<repo>/tools/liltoon-sample/Editor` into `Assets/Editor/` of the project and replaces the files there. Then it runs the four Unity steps. Each step takes about 5 to 10 seconds. The first import of a new avatar adds about a minute.

   On import, UniVRM migrates a VRM 0.x file to VRM 1.0, so the source materials show as `VRM10/MToon10` in `material-map.txt`. The converter reads the MToon10 values. These log lines are normal: `vrm0: migrated`, a UniGLTF warning from the scripted importer, and `[Licensing::Module] Error: Access token is unavailable`.

   The outputs are in `~/opensekai-liltoon-sample/Export/<Avatar>/`: `<Avatar>-lilToon.vrm`, `material-map.txt`, `versions.json`, `unity-reference.png` (lilToon), and `unity-mtoon-original.png` (the original MToon with the same rig). On a failure the script prints the error lines and the log path. The logs are in `~/opensekai-liltoon-sample-logs/<Avatar>-<step>.log`.

5. **Check the file.** Both checks must exit 0.
   ```sh
   python3 -I <repo>/tools/liltoon-sample/check_sample.py ~/opensekai-liltoon-sample/Export/<Avatar>/<Avatar>-lilToon.vrm
   node <repo>/tools/liltoon-sample/validate_schema.cjs \
     ~/ghq/github.com/danirukun/three-liltoon/schema/MOCHIYA_materials_liltoon.schema.json \
     ~/opensekai-liltoon-sample/Export/<Avatar>/<Avatar>-lilToon.vrm all \
     ~/ghq/github.com/danirukun/three-liltoon/node_modules/ajv
   ```
   Read `material-map.txt`. Each source material must have one line with a lilToon shader variant, its queue, and its features (`cutout`, `transparent`, `outline`, `shadowColorTex`, and so on). The material count must be the same as in the inventory.

6. **Compare the two Unity captures.** Copy `unity-mtoon-original.png` and `unity-reference.png` to a new folder `<scratch>` in the scratchpad, so that a later `convert.sh` run does not change them while an agent reads them. Make a side-by-side image and a face crop at 2× there. With the `none` rig, the face is near the top center of the frame; move the crop if the avatar is very tall or small.
   ```sh
   magick <scratch>/unity-mtoon-original.png <scratch>/unity-reference.png +append -resize 50% <scratch>/compare-side.png
   magick \( <scratch>/unity-mtoon-original.png -crop 440x440+740+120 +repage \) \
     \( <scratch>/unity-reference.png -crop 440x440+740+120 +repage \) +append -resize 200% <scratch>/compare-face.png
   ```
   To measure a difference, compare the pixels of one column in the two full-size captures (for example across a sleeve shade). The lit colors of a correct conversion agree within about 2 percent.

   Give the images to a Fable subagent, and tell it to write its crops only in `<scratch>`. Ask for each difference in color, shadow, shadow edge color, outline, and transparency, with the part of the body. A small change in the shadow edge position is expected, because lilToon shades on half-Lambert. A different color on a part, a colored shadow edge, a missing part, a wrong draw order of the face layers, or a dark or white part is a conversion defect. Find the material in `material-map.txt` and the cause in the mapping table of the tool README. Fix a general mapping defect in `LilToonSampleConvert.cs` for all avatars, and run steps 4 to 6 again. Then run the Catboy regression (see Common mistakes).

7. **Load it in OpenSekai.**
   - Owner use: in the Editor, add a character and choose the model. The file picker imports the VRM into the asset library.
   - QA or evidence: copy the file to `<repo>/fixtures/local/` and add an entry to `fixtures/local/manifest.json`, with the same shape as the `fixture_vrm_liltoon` entry and the file's `sha256` and `bytes`. The path must be in the manifest folder. A path elsewhere (iCloud, a symlink to it) gives `Resource unavailable: 400` and an empty avatar. Launch with `OPENSEKAI_EVALUATION=1 OPENSEKAI_FIXTURE_MANIFEST=<repo>/fixtures/local/manifest.json direnv exec . pnpm dev:desktop`. Then use `node <repo>/.agents/skills/local-qa-e2e/scripts/mcp-call.mjs material_list '{}'` and check that each material of the avatar has the profile `liltoon` and that no load warning names a lilToon property.

8. **Owner look check.** Show the owner the avatar in the running app next to the original MToon avatar, under the same light. Ship nothing before the owner passes the look. Record what the owner says.

9. **Deliver.** When the owner approves, copy the export to the owner's avatar folder as `<source name without .vrm> - lilToon.vrm` (for example `ARKit RORO - lilToon.vrm`). The folder is `~/Library/Mobile Documents/com~apple~CloudDocs/VTuber Avatars/`. Do not overwrite a file that is already there.

## Common mistakes

| Mistake | Result | Do this |
| --- | --- | --- |
| `-preset catboy`, or the default when the folder is named `Catboy`, on another avatar | Pink skin bands, backlight, red shadow edges, and grey ear shade on an avatar that does not have them | Use `-preset none` and a folder name other than `Catboy` |
| A per-avatar look change made without the owner's request | The owner rejects the look | Keep the mapping faithful; ask before you change a value |
| A comparison with `unity-reference.png` only | The Unity lilToon render agrees with OpenSekai, but both differ from the original | Compare with `unity-mtoon-original.png` |
| A shade that is black, lit, or too soft in only one capture | A wrong lilToon default, or a rig fault, taken for a mapping fault | Read "Notes on the mapping" and the note below the reference capture table in the tool README. Test one property in a throwaway editor script in the project (not in the repository), and delete the script after the test |
| A part that shows only in `unity-reference.png`, on a cutout material with `_Cutoff` 1 | A change of the cutoff to match the Unity MToon capture | Keep the source value. UniVRM MToon10 and three remove all of the part, the Unity lilToon cutout keeps alpha 1. OpenSekai draws both avatars the same (see the README note) |
| `convert.sh` run while a comparison agent reads `Export/<Avatar>/` | The agent reports a mix of two versions | Compare copies in a scratch folder |
| A batch run while the Unity Editor has the project open | The run fails at once | Close the Editor first |
| Local edits in `Assets/Editor/` of the project | `convert.sh` replaces them | Change the scripts in `<repo>/tools/liltoon-sample/Editor` |
| The manifest points to the iCloud file | HTTP 400, empty avatar, measurements of an empty scene | Copy the file into `fixtures/local/` |
| `pnpm dev:desktop` without `direnv exec .` | A build into a per-worktree `target/` | Use `direnv exec .` |
| A change to `LilToonSampleConvert.cs` with no regression run | A changed Catboy test avatar | Run `bash <repo>/.agents/skills/liltoon-convert/scripts/convert.sh <repo> Catboy` and compare the sha256 of `Export/Catboy/Catboy-lilToon.vrm` with the `fixture_vrm_liltoon` entry. Keep the recorded file when they differ, unless the change is meant to change the Catboy. |
| An `ArgumentNullException: Shader` in the first import log | None; the convert step imports the file again | Read the convert log for the final result |
