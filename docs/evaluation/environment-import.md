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

## Linux cloud gap check (B23)

Checked 2026-10-25 in the Linux cloud container (Ubuntu, x86_64, no GPU, no OBS), on the branch `claude/b23-environment-import` from `main` at `86686e0`. Node 26.10.0, pnpm 12.8.1, rustc 1.93.1. Contract: [environment import gaps](../../spdd/prompt/2026-10-25-environment-import-gaps.md) (G1–G11). This check adds automated evidence for each requirement of the parent contract. It does not change product behavior, and it does not replace the macOS check above.

Editor check: the `vite preview` build of `apps/desktop` in headless Chromium, with the stand-in host of the [B18 check](hidden-tracker-cameras.md) and a real `@opensekai/session`. No renderer runs. Script: [editor-check.mjs](environment-import/editor-check.mjs). Raw output: [editor-check.txt](environment-import/editor-check.txt). Result: 18 pass, 0 fail. Captures: [Source and credits](environment-import/editor-environment.png), [Missing model](environment-import/editor-missing-model.png), [Render Environment](environment-import/editor-camera-flag.png).

| R | Evidence | Kind |
| --- | --- | --- |
| R1–R2 | `environment.test.ts` (contracts), `crates/contracts/tests/environment.rs`, validation vectors | Unit |
| R3–R4 | `environment-patch.test.ts` (session) | Unit |
| R5 | validation vectors; `stores_scene_with_credits_and_reloads_it` | Unit |
| R6 | `rejects_a_file_that_is_not_a_scene`; `editor_commands_and_owner_commands_reject_other_window_labels`. No filter on macOS (R6 changed) | Unit |
| R7 | `packs_sketchfab_zip_at_root_and_one_folder_down`, `rejects_a_zip_without_a_root_near_the_top`, `rejects_bad_zip_archives` | Unit |
| R8 | `rejects_unsafe_or_missing_references`, `rejects_symlink_outside_the_folder`, `rejects_an_external_uri_outside_buffers_and_images_and_names_it` | Unit |
| R9 | `rejects_bad_zip_archives`, `reads_only_the_zip_entries_that_the_root_refers_to` (a broken unreferenced entry does not stop the pack) | Unit |
| R10–R11 | `rejects_core_texture_source_that_is_not_png_jpeg_or_webp`, `keeps_images_that_only_an_optional_extension_uses`, `rejects_unsupported_images_and_required_extensions` | Unit |
| R12 | `packs_multi_file_gltf`; `prepared_fixture_stages_pack_with_the_same_counts`: `fixture_glb_stage` 4,075,316 bytes in, 4,075,308 packed; `fixture_test_stage` 15,387,580 in, 15,387,580 packed; counts the same, no `uri` | Unit, real files |
| R13 | `rejects_output_over_budget` | Unit |
| R14 | `same_scene_returns_the_existing_record`, `storing_again_repairs_a_missing_scene_file`, `storing_again_repairs_a_scene_file_of_the_wrong_length`, `scene_name_keeps_a_title_of_128_code_units`, `bounds_credits` | Unit |
| R15 | `shutdown_does_not_wait_for_a_running_scene_import`; `imported_scene_folder_is_packed_served_and_survives_restart` (the source files have the same bytes after the import) | Unit, integration |
| Issue item 2 | `imported_scene_folder_is_packed_served_and_survives_restart` compares the bytes from `GET /assets/{id}` with `fixtures/scene-import/packed-room.glb`; `scene-import.test.ts` (renderer) loads that file with `inspectContainer` and `GLTFLoader` | Integration (HTTP, file) |
| R16–R18 | `environment.test.ts` (renderer), with the new `draws nothing for a hidden environment` | Unit, fake loader |
| R19 | `does not pick environment roots` (editor viewport) | Unit |
| R20–R21 | `disables Add › Environment while the scene has an environment`; editor check | Unit, headless |
| R22 | `lists scene assets…`, `shows the scene import error, cut to 160 characters…`; editor check (select, cancel, import error, Choose model…, Missing model for an unknown asset ID) | Unit, headless |
| R23 | `writes the CC credit line…`; editor check (credits block, clipboard text) | Unit, headless |
| R24 | `shows the scene value again when the Render Environment change fails`; editor check (off, rejected change, on) | Unit, headless |
| R25 | `asset-list.integration.test.ts` (MCP) | Integration |
| R26 | `round_trip_keeps_an_environment_with_an_unknown_model_and_the_camera_flag` (Save As and Open of the file). The editor check shows `Missing model` after a window reload; the session stays the same, so it does not read a show file | Unit, headless |

Not proved in the cloud: the native dialog, a physical click, OBS output and alpha, the WebKit memory footprint, the WebGPU and WebGL 2 render of a packed environment on a real GPU, a release build, and Windows. The editor check has no renderer, so the load status row and the failed-load row under Source were not seen (unknown).
