# Chat thin tools check

Date: 2026-11-08. Commit: `0840b7e` on `opensekai-chat-prototype-2b3d3523`. Contract: [Chat thin tools](../../spdd/prompt/2026-11-08-chat-thin-tools.md).

Machine: Apple M3 Pro, macOS 27.2. App: `OPENSEKAI_EVALUATION=1 pnpm dev:desktop`. Output `output_main`: backend `webgpu`, quality profile `production_v1`, 1920×1080 at 60 fps. OBS 33.0.1, obs-websocket 5.7.6, local endpoint without authentication. No stream was started.

Fixtures: avatar `avatar_7b7c689e…3e024373` (Catboy with black hoodie, VRM0 ARKit). Environment `scene_6eb17002…4f381d1ee` (OpenSekai Test Stage).

## Scope

This check covers the thin tools through the MCP server on the running app. One MCP stdio process made all the calls, so one reference table was used from start to end. It does not cover a local model, the Chat panel, Windows, or Linux.

## Tool calls

Scene `scene_smoke` started at revision 0 with only the default camera and directional light. A `scene_patch` (an existing tool) added the Catboy avatar at the origin (revision 1). All other changes came from the thin tools.

| # | Tool | Input (without `sceneId`) | Reply |
| --- | --- | --- | --- |
| 1 | `scene_summary` | prompt "concert on the test stage with purple lights" | `scene scene_smoke`, `@e1 Camera`, `@e2 Directional Light`, `@e3 Catboy`, `output @e1`, 12 assets. `@a2` is OpenSekai Test Stage. |
| 2 | `environment_set` | asset `@a2` | revision 2, created `@e4` |
| 3 | `light_setup` | key, target `@e3`, purple, bright, shadow, "Key" | revision 3, created `@e5` |
| 4 | `light_setup` | fill, target `@e3`, cool, soft, "Fill" | revision 4, created `@e6` |
| 5 | `light_setup` | rim, target `@e3`, blue, bright, "Rim" | revision 5, created `@e7` |
| 6 | `haze_set` | medium | revision 6, created `@e8` |
| 7 | `camera_add` | medium, target `@e3`, "Orbit cam" | revision 7, created `@e9` |
| 8 | `camera_move` | `@e9`, orbit, target `@e3`, 90°, right, slow, end framing closeUp, "Orbit push-in" | revision 8, created `@b1` |
| 9 | `output_camera` | `@e9` | revision 9 |
| 10 | `look_up` | `@e5` | `Key · light · visible · at -2.12, 2.6, 2.12 · spot · color #a02aff · intensity 320 · shadow on` |
| 11 | `look_up` | `@b1` | `Orbit push-in · enabled · nodes: event.manual 1, property.set 16` |
| 12 | `camera_add` | closeUp, target `@e999` | `INVALID_INPUT`, ids `["@e999"]` |

No call returned a note. Each change was one `proposalApply` with one new scene revision. After call 9, `scene_inspect` showed `output_main` on the new camera. `blueprint_inspect` showed one graph, "Orbit push-in": an `event.manual` trigger and 16 `property.set` nodes (3 for the start pose: position, rotation, and field of view; 12 for 6 orbit steps of 15°: position and rotation; 1 for the end field of view).

## Second run: replace, hotkey, and move direction

Date: 2026-11-08. Commit: `9f21a45` (after the final review fixes). The app was started again, and the first 8 calls above were made again with the same replies.

The Scene window reloaded one time during this run. The session ID changed, and `output_camera` returned `UNAVAILABLE` "Connection closed". The app restored the scene at revision 9 (the Play end pose write). A new MCP process continued the run. Its `scene_summary` gave the same references (`@e3` Catboy, `@e5` Key, `@e9` Orbit cam, `@b1` Orbit push-in), because the references come from the scene order.

| # | Tool | Input (without `sceneId`) | Reply |
| --- | --- | --- | --- |
| 1 | `output_camera` | `@e9` | revision 10 |
| 2 | `scene_patch` (existing tool) | move Fill 0.5 m on X | revision 11 |
| 3 | `light_setup` | key, target `@e3`, purple, normal, shadow, "Key", replace `@e5` | revision 12, note `replacedExisting @e5` |
| 4 | `look_up` | `@e5` | `… spot · color #a02aff · intensity 160 · shadow on` (it was 320) |
| 5 | `blueprint_build` | "Orbit cam hotkey", hotkey `Alt+1`, switchCamera `@e9` | revision 13, created `@b2` |
| 6 | `blueprint_build` | the same with hotkey `Alt+2`, replace `@b2` | revision 14, note `replacedExisting @b2` |
| 7 | `camera_add` | closeUp, target `@e3`, "Close" | revision 15, created `@e10` |
| 8 | `camera_move` | `@e10`, pushIn, target `@e3`, end framing closeUp | `INVALID_INPUT` "Camera is already nearer than closeUp", ids `["@e10"]` |

Calls 3 and 6 sent non-null expectations (the key light and the stored hotkey graph) through the Rust router. Both applied. The edit to the fill light in call 2 did not block call 3. After call 6, `blueprint_inspect` listed the keystroke `Alt+Digit2` and no `Alt+Digit1`.

## OBS recording

An isolated QA scene with one browser source showed `output_main`. The script switched the program scene to it, started a local test recording, and 2 s later ran Play with `blueprint_run` (`triggerNodeId: play`). It then stopped the recording and restored the prior program scene. OBS removed the QA scene and source. The final OBS state was: program scene "Scene", not streaming, not recording.

- Recording: `~/Movies/2026-11-08 22-37-28.mov`. 11.9 s, 1920×1080, 60 fps. OBS output skipped 0 of 721 frames.
- Frames: [orbit frames](chat-thin-tools-orbit-frames.jpg) (every third source capture, 0.77 s apart).
- End pose: [OBS end frame](chat-thin-tools-obs-end.png).

The camera snapped to the medium front pose at 2.6 s. It then turned 90° to the right of the avatar and moved in to a close-up, until 10.5 s. This agrees with `slow` (8 s).

### Stepped or smooth

The script took source captures every 257 ms on average and measured the mean change between consecutive frames (luma difference, 0–255). It was 0.5–1.1 before Play and 0.6–0.7 after the move. During the move it stayed between 3.7 and 16.3. No interval went near the still level, so the camera did not stop at a step boundary at this sample rate. The speed changes during the move (from 3.7 to 16.3), so the 15° steps can be visible as small changes in speed. A sample rate of 4 Hz cannot show a short slowdown at each boundary. **The owner must look at the recording and decide.** This decision is the gate for the single orbit node candidate in the design.

## Findings

- **Exposure.** At the end pose, the face and hair are white with no detail ([OBS end frame](chat-thin-tools-obs-end.png)). The `bright` key spot is 320 with purple. The `bright` rim is blue. With `medium` haze, this is too bright for the test stage. The word values are the builder's choice (`words.ts`). Change them before slice 2 measures prompts against the scene result.
- **Scene ID.** No MCP tool gives the current scene ID. This check used `scene_smoke` from the editor default. A small model must get the ID from the harness, or `scene_summary` must not need it.
- **Play moves the persistent camera.** When the move ends, the revision goes from 9 to 10. The Blueprint writes the end pose to the scene. A later `camera_move` on the same camera starts from the snap pose, so the result is the same.

## Not verified

- A local model, the Chat panel, and Accept or Reject in the editor (slices 2 to 4).
- `CONFLICT` on the running app. No MCP tool sends `proposalApply` with a stale expectation. The session tests and the MCP integration test cover it.
- A key press of the hotkey. The check did not press `Alt+2`.
- Smoothness as a person sees it (see above). Windows and Linux.
