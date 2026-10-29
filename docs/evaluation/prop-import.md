# Prop import check

Checked 2026-10-28 on macOS 27.0.1 with the code at commit `2d1f67c` (branch `feat/env-03-props`). The later commit that adds this record changes only documentation. Contract: [prop import](../../spdd/prompt/2026-10-28-prop-import.md). The app ran with `pnpm dev:desktop` in evaluation mode (debug build, WKWebView). The Scene preview reported the `webgpu` backend with the `preview_v1` profile. `output_main` reported `webgpu` with `production_v1`. OBS was 33.0.0 with obs-websocket 5.7.6. The OBS browser source renderer backend was not recorded.

The agent drove the Editor with System Events accessibility actions (menu items, buttons, the Source select, text fields, the native Open panel) and one synthetic CGEvent drag on the gizmo. It read and changed the scene through the MCP stdio server (`scene_inspect`, `scene_patch`, `scene_replace`, `camera_screenshot`, `blueprint_edit`, `blueprint_run`). It captured OBS output through the evaluation OBS adapter in an isolated owned scene. The adapter restored the prior OBS program scene and removed its test sources. OBS did not stream or record.

The scene was the Bonnie Warudo scene from the [Bonnie spike](https://github.com/danirukun/opensekai/issues/240): the Bonnie_Stage environment, the Catboy QA character, six cameras, one directional light, and the props Walls, Ceiling, and Barkaneer (the mascot). These are third-party models. The models and the renders of them are not committed. The committed images show the Editor only.

## Automated checks

At commit `2d1f67c`: `pnpm check` passed. `pnpm test:unit`: 1565 tests in 195 files passed. `pnpm test:integration`: 62 tests in 29 files passed. `cargo test -p opensekai-contracts`: the new `prop` tests passed (7 tests).

## Result of each step

| Step | Result | Evidence |
| --- | --- | --- |
| 1. MCP `createEntity` with four mesh props (Walls, Ceiling, Mascot, and a second Mascot) from three library records | PASS. All four props draw. The wide camera shows the walls behind the right truss. The main camera shows the ceiling plane under the character | — |
| 2. Two props from one record | PASS. Mascot and Mascot 2 (scale 0.6, rotated 30°) draw as two copies of the Barkaneer record at their own transforms | — |
| 3. Inspector of a prop (R7) | PASS. Name, Visible, Transform, and a Prop section with a Source select. The select shows the record title. No Reflections Intensity | [inspector](prop-import/inspector.png) |
| 4. Add › Prop (R6) | PASS. The menu lists Prop after Environment. Environment is disabled because the scene has one. The new prop is `Prop` with an identity transform and `Choose model…`. A second one is `Prop 2` | [add](prop-import/add.png) |
| 5. Source select (R7) | PASS. The options are `Choose model…`, the library records, and `Import file…`. Choosing `Barkaneer with collider` sent `setMeshModel`. Three props then used one record | — |
| 6. Transform fields | PASS. Position, Rotation Y −90°, and Scale 1.5 typed in the fields reached `scene_inspect` as `[4.5258, 13.0517, 0]`, `[0, −0.7071, 0, 0.7071]`, and `[1.5, 1.5, 1.5]` | — |
| 7. Gizmo (R5) | PASS. A drag on the X arrow moved Mascot Small from x −0.7 to x −0.31. Y and Z did not change | — |
| 8. Duplicate (R9) | PASS. The context menu Duplicate made `Mascot Small Copy` with the same record and transform | — |
| 9. Import file… (R8) | PASS. The native Open panel took `Bonnie_Airship.glb`. Prop 2 got the new record `scene_9cdbfbea…`. The environment kept `scene_9a4451fa…`. The other props did not change | [import](prop-import/import.png) |
| 10. Affect Props off (R5) | PASS. Mean RGB in the main camera: mascot regions 176.1 → 167.7 and 186.9 → 178.2, the Ceiling plane 77.0 → 67.8. The character head and torso did not change (167.6 and 54.2) | — |
| 11. Reflections Intensity 0 on the environment (R4) | PASS. Mascot regions 176.1 → 135.8 and 186.9 → 145.2, the Ceiling plane 77.0 → 39.7. The character torso did not change (54.2). Set back to 1 | — |
| 12. Missing model (R11) | PASS. A prop with an unknown `scene_…` ID shows `Missing model` and `Resource unavailable: 404`, the same as the environment | [missing](prop-import/missing.png) |
| 13. Blueprint Set Asset Property on a prop (R12) | PASS. A Manual Trigger with Set Asset Property (Position) moved the prop to y 18.3. `scene_inspect` showed the new position, and the frame changed in the prop region only | — |
| 14. OBS output | PASS. The OBS browser source showed the character, the mascots, and the airship deck. 15.5% of the pixels have alpha 0 (the sky), and the props are opaque | — |
| 15. Save As and Open (R11) | PASS. The maintainer saved the Bonnie scene with Save Show As… (13 entities, 4 props) and opened the file with Open Show…. MCP `scene_inspect` after Open was equal to the file for each entity and for the outputs. The Camera view showed the airship deck, the character, and the mascot. The FIXED_WIDE view showed the stage | — |

## Measurements

| Measurement | Value |
| --- | --- |
| `output_main` CPU time for each frame, seven props, the environment, and one VRM | 5.5 ms (one frame sample) |
| Preview CPU time for each frame | 7 to 10 ms (two samples) |
| GPU time | unknown (not reported) |
| OBS render and output frame counts | not measured |

App timing and OBS timing are separate. One frame sample is not a benchmark.

## Limits

- The maintainer did the Save As and Open panel steps by hand, because the agent could not send input to the native panels. The saved file had props with a model only. A file with a prop that has no model, or with an unknown model ID, was not opened live. The contract tests parse both.
- An older build does not open a show with a prop that has no model (`assetId: null`). A show whose props all have a model opens in an older build.
- Input was synthetic. No physical click, no Windows run, and no release build.
- The Warudo transform puts the airship deck around the character. The placement of the airship in the Bonnie scene is a spike task, not an ENV-03 result.
- Motion with the Editor minimized was not checked for this slice.
- Two faults were seen that are not in this slice:
  - After MCP `scene_replace` with a new `sceneId`, the Editor keeps the old scene ID and shows `NOT_FOUND`. A second `scene_replace` with the Editor's ID (`scene_smoke`) fixed the view.
  - `blueprint_run` sent at once after `createGraph` returns `ok` and does nothing. The same run 2 s later works.
