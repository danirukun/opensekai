# Output format check

Date: 2026-10-27. Scope: CAM-16 slice 1, bundle B22 ([#173](https://github.com/danirukun/opensekai/issues/173)). Contract: [output format](../../spdd/prompt/2026-10-21-output-format.md). Base commit: 745b550 plus the B22 implementation branch changes.

Platform: Linux cloud container (Ubuntu, x86_64, no GPU, no OBS). Node 26.10.0, pnpm 12.8.1, rustc 1.93.1, Playwright Chromium (headless) from `/opt/pw-browsers` with `chromiumGpuArgs`. WebGL 2: ANGLE on Vulkan (llvmpipe). A software adapter proves that the code runs. It does not prove the OBS frame rate, the image in OBS, or the GPU cost of each size.

## OBS page (headless Chromium, WebGL 2, verified)

Method. The check script serves the built OBS page (`apps/output/dist`) and is a stand-in for the host. It answers the renderer WebSocket and sends frames from a real `@opensekai/session` on a 60 Hz clock with absolute due times. As the host does (`STATE_CAPACITY`), it sends a frame only while fewer than 2 frames are unacknowledged, and an acknowledgment of a newer frame releases the older frames. The scene is the smoke scene with only the box meshes and the cameras. The viewport is 960 × 540. The page uses `?quality=production_v1&backend=webgl2`. Each rate is counted over 5 s.

Script: [headless-check.mjs](output-format/headless-check.mjs). Raw output: [headless-check.txt](output-format/headless-check.txt). Result: 7 pass, 0 fail.

| Check | Result |
| --- | --- |
| The default output draws a 1920 × 1080 buffer (R5, R8) | Pass |
| At 60 FPS the page acknowledges each frame that the host sends (R6) | Pass: 60 ticks/s, 60 sent/s, 60.2 acknowledged/s |
| 1280 × 720 at render scale 0.75 draws a 960 × 540 buffer and keeps the CSS size (R5) | Pass |
| At 30 FPS the page acknowledges about 30 frames each second on a 60 Hz host clock (R6) | Pass: 60 ticks/s, 55.4 sent/s, 4.6 capped/s, 30.2 acknowledged/s |
| The capture is the 960 × 540 buffer and the transparent clear keeps alpha 0 far from geometry (R5, R8) | Pass (alpha 0 at pixel 10, 10) |
| After a change back to 60 FPS the page acknowledges each frame again (R6) | Pass: 60.2 acknowledged/s |
| No page error | Pass |

Notes.

- At 30 FPS the host model skipped 4.6 ticks each second because 2 frames were unacknowledged (a held frame plus one replaced frame). The pacer timer applied the held frame each time, so the rate stayed at 30.2. This is the stall case of analysis finding 5.
- The WebGPU backend was not run. Headless SwiftShader WebGPU stops drawing after about 390 frames ([B19 check](fps-counter.md)), and the three 5 s windows need about 900 frames. The pacer does not depend on the backend.
- The acknowledged rate is app timing. The OBS render rate at the 30 FPS limit is an owner check.

## Editor window (headless Chromium, verified)

Method. The `vite preview` build of `apps/desktop` at `http://127.0.0.1:4173/?view=editor`, with the stand-in host of the [B18 check](hidden-tracker-cameras.md): the operator WebSocket goes to a real `@opensekai/session`. The host can reject the next `scenePatch` on request.

Script: [editor-check.mjs](output-format/editor-check.mjs). Raw output: [editor-check.txt](output-format/editor-check.txt). Result: 10 pass, 0 fail.

| Check | Result |
| --- | --- |
| The Output panel shows Resolution, Render scale, and Frame limit with the scene values (R11) | Pass |
| Resolution lists the four presets (R11) | Pass |
| Resolution › 1280 × 720 sends one `setOutputFormat` and keeps the other values (R3, R11) | Pass |
| Render scale › 75% and Frame limit › 30 FPS change `output_main` only (R2, R11) | Pass |
| The Drag to OBS link has the OBS URL with the layer parameters of the output size (R12, R13) | Pass |
| A `dragstart` on the link sets `text/uri-list` and `text/plain` to that URL (R12) | Pass |
| A click on the link does not navigate the Editor window (R12) | Pass |
| A rejected change shows the scene value again (R11) | Pass |
| A reload of the Editor window reads the values from the scene (R11) | Pass |
| No page error | Pass |

Screenshot: [Output panel](output-format/editor-output-format.png).

A show file round trip with a non-default output is a Rust test (`show.rs`, `round_trip_keeps_the_output_format_and_rejects_a_preview_change`). The headless host has no show file, so the Editor flow did not save and open a show.

## Not checked

- A drag from the Editor window (WKWebView, Tauri drag-drop handler) into OBS on macOS, and the size of the new Browser Source.
- The OBS render rate at the 30 FPS limit, the image at each size and scale in OBS, and the GPU cost of each size.
- The Scene window preview (it keeps 1920 × 1080 at 60; the code path does not change).
- macOS and Windows.
