# Environment import check

Checked 2026-10-13 on macOS with the code at commit `74971b1` (branch `opensekai/environment-import`); the app was built from that commit, and the later commit that adds this record changes only documentation. Contract: [environment import](../../spdd/prompt/2026-10-13-environment-import.md). The app ran with `pnpm dev:desktop` (debug build, WKWebView). The Scene preview reported the `webgpu` backend. The quality profile was the default (preview textures at most 1024 pixels, output textures at most 2048 pixels). OBS was 32.2.2 with obs-websocket 5.7.4; the OBS browser source renderer backend was not recorded.

The agent drove the editor with synthetic macOS pointer and key events (CGEvent and System Events), read and changed the scene through the MCP stdio server (`scene_inspect`, `scene_patch`), and captured OBS output through the evaluation OBS adapter in an isolated owned scene. The adapter restored the prior OBS program scene and removed its test sources. OBS did not stream or record.

The sample was "Anime stylized room free" by CG Lads, CC-BY-4.0 ([source](https://sketchfab.com/3d-models/anime-stylized-room-free-223df82515de41e684720e2eaa02e93d)): `scene.gltf`, `scene.bin`, and 37 PNG textures, 138 MB on disk. The character was the library VRM "Rem Kanashibari" (78.7 MB).

The raw outputs (window captures, OBS logs, alpha samples, `footprint` output, and the clipboard text) are not committed. The committed images below are downscaled copies of the captures.

## Automated checks

At commit `74971b1`: `pnpm check` passed with 0 errors. `pnpm test:unit`: 667 tests in 100 files passed; the run prints 16 unhandled errors from `rete-editor.test.ts`, which also occur on the base commit. `pnpm test:integration`: 23 tests in 7 files passed. `cargo test --workspace`: 197 tests passed, 1 was ignored, 0 failed. `cargo clippy -p opensekai-desktop --all-targets -- -D warnings` reports one error in `src/input/monitor.rs:373`, which this branch does not change.

## Result of each step

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Add › Environment | PASS. The menu lists Environment after Character. An Environment group appears before Cameras. The Inspector shows Visible, Transform, and Source with `Choose model…` | [add](environment-import-add.png) |
| 2. Source › Import file… with `scene.gltf` | PASS. The native Open dialog accepted the file. The record was written about 1.5 s after the dialog closed. The packed GLB is 144,388,220 bytes with ID `scene_071d95e5…`. The Inspector shows the title, the author, the license, and Copy credit | [credits](environment-import-credits.png) |
| 3. Copy credit | PASS. The clipboard holds the CC line of the sample `license.txt` exactly | — |
| 4. Preview load | PASS. The overlay showed `Loading Environment` with the Downloading stage. The room appeared within about 9 s after the Scene window came to the front (an upper bound; the preview does not render while it is covered). The preview kept 52–60 FPS during and after the load | — |
| 5. Room appearance with a character | PASS. Textures, the lamp, and the glossy music player render with the neutral environment map. The open sides of the room stay transparent. The character looks the same as without the room. The preview showed 60 FPS | [preview](environment-import-preview.png) |
| 6. Zip import (`ditto -c -k --sequesterRsrc`, so the archive has a `__MACOSX` folder) | PASS. The import returned the same `scene_071d95e5…` record. The library files were not written again | — |
| 7. Render Environment off through MCP `scene_patch` | PASS. The editor camera switch followed (unchecked). OBS output: 90.2% of sampled pixels have alpha 0, and only the character is opaque | [switch](environment-import-camera-switch.png), [OBS off](environment-import-obs-off.png) |
| 8. Render Environment on through the editor switch | PASS. `scene_inspect` shows `renderEnvironment: true`. OBS output: 8.3% of sampled pixels have alpha 0 (the open side of the room), the same as before step 7. No editor gizmo is in the output | [OBS on](environment-import-obs-on.png) |
| 9. Save As and Open | PASS. The `.osekai` file holds the environment asset ID and the camera flag. After an app restart, Open restored the environment, the camera, and the character | — |
| 10. Missing model | PASS. With the room files moved out of the library before the restart, the reopened show keeps the environment and the Source select shows `Missing model`. The frame warnings carry `UNAVAILABLE`. The scene continues with the character only | [missing](environment-import-missing.png) |
| 11. Editor minimized | PASS. With the Editor window minimized, two OBS frames 2 s apart differ (idle motion), and OBS rendered 360 frames in 6 s with 0 skipped | — |

## Measurements

| Measurement | Value |
| --- | --- |
| Packed GLB size | 144,388,220 bytes (source folder 138 MB) |
| Folder import, dialog close to record write | about 1.5 s (debug build) |
| Preview install after the preview started | at most about 9 s |
| Scene WebContent footprint, character and room loaded | 1415 MB (`footprint <pid>`) |
| Editor WebContent footprint | 150 MB |
| Preview frame rate after load (stats.js) | 55–60 FPS |
| OBS render frames, 5 s windows, room on / off / on | 304 / 302 / 302 frames, 0 skipped |
| OBS render frames, 6 s window, Editor minimized | 360 frames, 0 skipped |
| OBS output frames | 0 (OBS did not stream or record) |
| App frame time and GPU time for the room | unknown (not measured) |

The footprint values are WebKit process samples, not whole-app or GPU totals. App timing and OBS timing are separate rows.

## Limits

- Input events were synthetic. No physical click, no Windows run, and no release build.
- The renderer backend of the OBS browser source was not recorded. The WebGL 2 fallback was not checked.
- Only one sample environment was checked. Draco, meshopt, and KTX2 files are rejected by design and were not tried live.
- Import has no cancel control. The packed GLB, the source on disk, and the WebKit footprint of larger environments were not measured.
- The default camera at (0, 1.2, 3) is outside this room. The check moved the camera to (1.7, 1.3, 1.9) with a 60° field of view through MCP. The slice adds no automatic placement.
- On macOS the dialog shows no file-type filter (the project-wide workaround for rfd), so the importer checks the extension instead. This is different from R6.
- `setEnvironmentModel` through MCP was not exercised live, because no MCP reply lists asset records.
- The failed-load overlay row for the missing model was not seen; the warning is in the frame warnings only.
