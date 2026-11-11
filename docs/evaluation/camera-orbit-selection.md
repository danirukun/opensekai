# Camera orbit node and main camera selection check (B32)

Date: 2026-11-10. Bundle B32, the rest of CAM-01 (#49) and CAM-02 (#50). Contract: [camera orbit and selection](../../spdd/prompt/2026-11-07-camera-orbit-selection.md). Base: `main` at a78b27a. The pull request names the branch commit.

Platform: Linux cloud (Ubuntu, x86_64, no GPU). Node 26.10.0, pnpm 12.8.1. Fixtures: `fixture_vrm_1`, `fixture_vrm0_arkit`, `fixture_glb_stage`, and `fixture_test_stage` are ready. GPU probe: WebGPU on SwiftShader, WebGL 2 on ANGLE llvmpipe. This file has no macOS, OBS, or GPU result.

## Checks

| Check | Requirement | Result |
| --- | --- | --- |
| `packages/contracts/test/camera-orbit.test.ts` | R2: the round trip at Yaw 0, 90, 180, and −90 and Pitch −60, 0, and 60; Yaw 0 on the +Z side; Yaw 90 on the +X side; a positive Pitch above the pivot; the clamps; the short-way Yaw | 6 pass |
| `packages/renderer/test/camera-navigation.test.ts`, unchanged | O1: the orbit math moved to `packages/contracts` with no behavior change | 12 pass |
| `packages/session/test/camera-orbit-node.test.ts` | R3–R8, R11: the immediate write and its end; a 1 s InOutSine move at 250, 500, and 750 ms and the exact end; the short way; a chain through On Transition End; a pivot that a Blueprint override moves; continuity across the end and the idle commit while the character walks; one revision after the end; join and replace; each stop rule, with no end after a stop; a removed Focus Character stops the move; Move Entity on an orbit camera keeps the follow; `NOT_FOUND`, the mode rule, and non-finite values with no change; Switch Camera on `output_main` and on `preview_main` | 21 pass |
| The `output_main` Switch Camera test on the old `scene-ops.ts` | R11: the test fails on the old code | 1 fail (expected), 1 pass |
| `apps/desktop/test/blueprint-templates.test.ts` | R9: the values of Use current value, a wired input, and the disabled states | 6 pass |
| [Headless render](camera-orbit-selection/headless-check.mjs) ([log](camera-orbit-selection/headless-check.txt), [data](camera-orbit-selection/headless-check.json)) | O6: the built OBS page with the real renderer, `fixture_vrm0_arkit`, WebGL 2 on llvmpipe. A Blueprint runs Camera Orbit Character at Yaw 0, 90, 180, and 270 (Pitch 10, Distance 2.2) | 19 of 19 pass. The character shows in each frame: front at Yaw 0 ([frame](camera-orbit-selection/orbit-yaw-0.png)), side at Yaw 90 ([frame](camera-orbit-selection/orbit-yaw-90.png)), back at Yaw 180 ([frame](camera-orbit-selection/orbit-yaw-180.png)), other side at Yaw 270 ([frame](camera-orbit-selection/orbit-yaw-270.png)). Each pair of frames differs in 5.6 % to 10.3 % of the pixels |
| [Headless Editor](camera-orbit-selection/editor-check.mjs) ([log](camera-orbit-selection/editor-check.txt)) | R1, R9, R11: the built Editor window with the session in the page | 9 of 9 pass: the Yaw (°), Pitch (°), and Distance (m) labels and On Transition End; Use current value sends one edit with three `setNodeInput` operations and shows 0, −1.9, and 3 for a camera at (0, 1.2, 3) ([screenshot](camera-orbit-selection/orbit-use-current-value.png)); one undo restores the three values; the button is disabled after a change to Free Look; Switch Camera on `output_main` sets both outputs in one revision |
| `pnpm check` | All packages | Pass |
| `pnpm test:unit` | All | 230 files, 2005 tests pass |
| `pnpm test:integration` | All | 38 files, 81 tests pass |

The functional render is a check of the angle convention only. It says nothing about the visual quality or the timing on a real GPU.

The Editor check found one defect, which this slice fixes: the button state of Use current value did not follow a scene change until the node was drawn again. The panel now draws a node with the button again when a scene change changes its button values. The same harness also showed that the Editor reloads the scene only when the status revision changes, so the harness status gives the live revision.

## Owner QA finding (2026-11-11)

The owner's macOS QA of 7744d47 found that a viewport drag that stops an orbit move made the camera jump back to its transform before the move. The cause: an Orbit Character gesture with a Focus Character started from the saved camera, not from the camera that the Blueprint orbit showed. The gesture now starts from the shown camera minus the follow offset. `packages/renderer/test/viewport-orbit-start.test.ts` fails on the old code and passes now. After the fix: `pnpm check` pass, `pnpm test:unit` 237 files and 2067 tests pass, and `pnpm test:integration` 38 files and 81 tests pass. The macOS check of the drag is in [macOS local check](#macos-local-check). It found that this first fix made a drag without a move drift, and it changed the fix.

## Gaps

These need the owner on macOS with `pnpm dev:desktop` and OBS connected (contract R14):

1. The B7 checks that are still open: the feel of Free Look and Orbit Character, OBS following a gesture at about 10 Hz, Tab and Ctrl+Tab in the macOS WebView, and a camera cut in OBS with continued motion while the editor is minimized.
2. A Camera Orbit Character chain (two nodes through On Transition End, 3 s, InOutSine) moves the camera around the character in the preview and in OBS, and a viewport drag stops it.
3. A Switch Camera hotkey on `output_main` cuts the preview and OBS together.
4. The pivot candidate: one orbit of the same character in Warudo and in OpenSekai, compared side by side.

Windows is not checked.

## macOS local check

Date: 2026-11-11. Commit 7744d47 for the checks, then the fix below. macOS 27.2 (Apple M3 Pro), OBS 33.0.1, `pnpm dev:desktop`, backend webgpu, quality `production_v1`. Scene: the Catboy VRM0 (the `fixture_vrm0_arkit` hash), the OpenSekai Test Stage as a prop, and three cameras. The input was synthetic mouse and key events.

| Gap | Result |
| --- | --- |
| 1. Free Look and Orbit Character | The controls work at the contract rates (20.0° for a 100 px right drag, 1.97 m for W in 1 s, 90° for a 300 px orbit drag, wheel zoom). The feel needs the owner |
| 1. OBS follows a gesture at about 10 Hz | Pass: 19 revisions in 1.90 s, and the OBS frame revision was the same or 1 behind |
| 1. Tab and Ctrl+Tab in the macOS WebView | Pass: both directions through three cameras, with wrap, on both outputs |
| 1. A camera cut in OBS and continued motion while the editor is minimized | Pass: the chain and a Switch Camera cut showed in OBS; `output_main` gave 59.5 frames for each second minimized and 60.1 shown |
| 2. The chain in the preview and in OBS, and a drag that stops it | Pass, with one defect, which this slice fixes (below) |
| 3. A Switch Camera hotkey on `output_main` | Pass: Ctrl+Alt+F9 and Ctrl+Alt+F10 each changed both outputs in one revision, and the preview and OBS showed the same camera |
| 4. The pivot candidate | Not checked. It needs the owner |

The defect: a viewport drag that stopped a move started from the scene value of the camera, which is the transform from before the move. The camera jumped back (from about Yaw −40 to Yaw −93 in the check). The first fix (af3e118) started each gesture from the evaluated camera minus the follow offset. On macOS that made a drag without a move drift: two 100 px drags changed the Pitch from 10.0 to 10.22 and 10.87 and the Distance from 2.50 to 2.537 and 2.493, because the evaluated root of the idle character was up to 3 cm from its scene position. The gesture now starts from the evaluated camera only when it is not the scene value (`persistentCamera` in `orbit-follow.ts`, with a unit test). After the fix, a 10 px drag during the first move left the camera at Yaw −31.1, Pitch 6.9, Distance 2.50, and the second node did not run. A drag without a move is unchanged: 100 px gave 30.0° two times at Pitch 10.0 and Distance 2.50. The full chain still ends at Yaw 90, Pitch 10, Distance 2.5.

A known limit of the fix: the evaluated root of an idle character moves a few centimeters from its scene position, and the session does not add this motion to the camera. A gesture that stops a move can thus start up to that distance from the place that the camera shows.
