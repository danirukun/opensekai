# Camera animation example check

Date: 2026-10-27. Scope: BP-09 slice 1 (camera example), bundle B24 ([#89](https://github.com/danirukun/opensekai/issues/89)). Contract: [camera animation example](../../spdd/prompt/2026-10-27-camera-animation-example.md). Base commit: b4178af plus the B24 implementation branch changes.

Platform: Linux cloud container (Ubuntu, x86_64, no GPU, no OBS). Node 26.10.0, Playwright Chromium (headless) from `/opt/pw-browsers`. The setup `gpu:` line named WebGPU on SwiftShader and WebGL 2 on llvmpipe. No check in this file uses the renderer. This file proves the session, MCP, and Editor window behavior. It does not prove the camera move in OBS.

## Session and contracts (unit tests, verified)

- `packages/session/test/transition-end.test.ts`: the R6 loop compiles and a loop through `exit` is still an immediate cycle; the end runs on the clock step after the tween ends and not before; an immediate write, a 0 s transition, a boolean property, and a write to the current value run the end on the next clock step; a scene patch, an immediate write from another graph, a new target, and a disable stop the tween with no end; a pending end is dropped by a disable or a logic change and kept for an inline input change; a node joins a tween once, and the ninth distinct end fails the run with no state change; the 65th pending end fails; a failed run records no end; manual and event steps run no end; a 0 s loop runs one end on each clock step.
- `packages/session/test/camera-sway.test.ts`: the Camera Sway graph on the smoke camera. In the evaluated frames the camera is at the sway pose at 3 s, back at 6 s, and at the sway pose at 9 s, with the Field of View 5° lower at the sway pose. The scene revision stays 0 during the loop (R5b). A `setTransform` patch on the camera stops the loop, and the patch position stays for 7 s.
- `packages/contracts/test/blueprint-templates.test.ts`: the template file validates; a camera turned 90° about Y moves along its own right axis (−Z); a Field of View of 3 gives 1; the import has no `Missing` entry; an export and an import into a scene with a new camera ID remap the camera by name.
- `apps/desktop/test/blueprint-templates.test.ts`: a scene without an avatar offers Camera Sway only; Camera Sway targets the selected camera, else the camera of `output_main`; Use current value reads the committed value and is disabled for a wire, a missing entity, or no scene.

## MCP (integration test, verified)

`apps/mcp/test/transition-end.integration.test.ts` starts the stdio MCP server with a real session on a 20 ms wall clock. It builds a loop of two camera Position moves (0.5 s, InOutSine) with a Log node on each `transitionEnd` through `blueprint_edit`. `blueprint_debug_log` shows the Log lines `a`, `b`, `a` in turn, 480 ms to 600 ms apart in session time. `blueprint_inspect` shows no error. The scene revision stays 0. A `scene_patch` on the camera transform during a move stops the loop: no Log line comes in the next 1.2 s. The test passed in three runs in a row.

## Editor window (headless Chromium, verified)

Method. The check script runs the built Editor window in Chromium. A stand-in for the Tauri host routes the operator WebSocket to a real `@opensekai/session` in the same process, which advances on a 20 ms clock. The scene is the empty authoring scene (one camera, one light, no character).

Script: [headless-check.mjs](camera-animation-example/headless-check.mjs). Raw output: [headless-check.txt](camera-animation-example/headless-check.txt). Result: 10 pass, 0 fail.

| Check | Result |
| --- | --- |
| The Templates menu offers Camera Sway only (no character in the scene) (R9) | Pass |
| Camera Sway imports enabled on the main camera (R8) | Pass |
| Each Position node `transitionEnd` starts the other Position node (R8) | Pass |
| The canvas shows `On Transition End` on the four Set Asset Property nodes (R1) | Pass |
| The camera position moves in the evaluated scene after the import | Pass |
| The scene revision stays 0 while the loop runs (R5b) | Pass |
| Each node with an unwired value shows Use current value (R7) | Pass |
| The button sends one `setNodeInput` with the committed Field of View (R7) | Pass |
| The inline value shows the committed value | Pass |
| One undo restores the previous value | Pass |

Screenshots: [graph](camera-animation-example/camera-sway-graph.png), [after Use current value](camera-animation-example/use-current-value.png).

Defects found by this check and fixed:

- The button was inside the input row and covered the `On Transition End` label. It is now on its own row under the ports.
- A pointer press on the button did not reach it. The node captures the pointer on pointer down, and the delegated Svelte handler stopped the event too late. The action row now stops the event with a native listener.
- The first template layout let the nodes overlap. The node positions are wider now.

## Not checked (owner on macOS, `accept:local`)

1. Start the app. Open the Blueprints panel, then Templates › Camera Sway. In OBS, the camera slides about 0.5 m to its right and narrows the view by 5°, over 3 s with a smooth start and end (InOutSine), then goes back, and repeats.
2. Minimize the Editor window for 10 s. The OBS output keeps moving.
3. Drag the camera in the Scene viewport during a move. The loop stops, and the camera stays where the drag put it. Disable and enable the graph: the loop starts again.
4. Select a Set Asset Property node, move the camera in the viewport, then press Use current value. The inline value shows the new pose. Undo restores the old value.

Record the backend, the quality profile, and the commit with the result.

## Gaps

Karaoke (needs audio playback, CHR-04 animation clips and profiles, and a prop on a hand bone), dance (needs B25 streaming triggers, CHR-04 one-shot overlays, audio, and particles), Camera Orbit Character (Camera Sway is a line move: Approximate), Switch Main Camera with a fade, Blueprint functions, and an end output on the other transition nodes.
