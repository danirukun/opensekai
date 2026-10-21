# FPS counter check

Date: 2026-10-21. Scope: SHOW-06, bundle B19 ([#175](https://github.com/danirukun/opensekai/issues/175)). Contract: [FPS counter](../../spdd/prompt/2026-10-21-fps-counter.md). Base commit: ca737c2 plus the B19 implementation branch changes.

Platform: Linux cloud container (Ubuntu, x86_64, no GPU, no OBS). Node 26.10.0, pnpm 12.8.1, rustc 1.93.1, Playwright Chromium (headless) from `/opt/pw-browsers` with `chromiumGpuArgs`. WebGPU adapter: SwiftShader. WebGL 2: ANGLE on Vulkan (llvmpipe). A software adapter proves that the code runs. It does not prove OBS alpha, the look of the text in OBS, or the value at 60 FPS on macOS.

## OBS page (headless Chromium, verified)

Method. The check script serves the built OBS page (`apps/output/dist`) and is a stand-in for the host. It answers the renderer WebSocket and sends frames from a real `@opensekai/session` about each 16 ms. The scene is the smoke scene with only the box meshes and the cameras, plus one FPS counter. The viewport is 960 × 540, so `k = 0.5`. The page uses `?quality=production_v1`. The script runs once with the default backend (WebGPU on SwiftShader) and once with `?backend=webgl2`.

Script: [headless-check.mjs](fps-counter/headless-check.mjs). Raw output: [headless-check.txt](fps-counter/headless-check.txt). Result: 21 pass, 0 fail.

| Check | WebGPU (SwiftShader) | WebGL 2 (llvmpipe) |
| --- | --- | --- |
| "-- FPS" before one full window (R8) | Pass | Pass |
| `aria-hidden`, no pointer events, `tabular-nums`, 16 px font at 540 pixels (R9) | Pass | Pass |
| A whole number above 0 after 1000 ms (R8) | Pass (65) | Pass (182, see below) |
| Top right with an 8 px margin (R9) | Pass | Pass |
| `setFpsCounter` moves it to the bottom left with a 16 px margin, a 32 px font, and the color (R9) | Pass | Pass |
| The element goes away when the scene has no counter (R7) | Pass | Pass |
| A `captureFrame` with a visible counter equals one without a counter (R10) | Unknown (skipped) | Pass (1920 × 1080, 0 different bytes) |
| A hidden counter shows no element (R7) | Pass | Pass |
| A new visible counter starts a new window with "-- FPS" (R8) | Pass | Pass |
| After more than 1000 ms without frames the counter shows "0 FPS" (R8) | Pass | Pass |
| No page error | Pass | Pass |

Notes.

- The first WebGL 2 value was 182. The WebGL 2 renderer starts more slowly, the frames that arrive during the start wait in the WebSocket, and the page applies them in a burst. The counter counts the completed `applyFrame` calls (R8), so 182 is the true count for that window. The value 3 s later was 59.
- An early run found a defect: the CSS `font` shorthand reset `font-variant-numeric` after each update. The overlay now sets `fontSize` only on each update and the other font properties once. The unit test and the headless check cover it.
- Headless SwiftShader WebGPU stops drawing after about 390 frames. A probe without a counter in the scene stopped at the same frame count, so this is a limit of the software adapter, not of the counter. The WebGPU run stays inside that budget. It skips the steady reading and the captures.
- `captureFrame` has the 2 s RPC limit. SwiftShader WebGPU missed it with and without a counter. On WebGL 2 the first try can also miss it, so the script tries up to 3 times. R10 is also true by construction: `screenshot.ts` and `capture.ts` read the canvas only, and the renderer makes no scene object for the kind (unit test in `renderer-loading.test.ts`).
- A page screenshot timed out while the software adapter drew each frame, so there is no image of the OBS page.

## Editor window (headless Chromium, verified)

Method. The `vite preview` build of `apps/desktop` at `http://127.0.0.1:4173/?view=editor`, with the stand-in host of the [B18 check](hidden-tracker-cameras.md): the operator WebSocket goes to a real `@opensekai/session`.

Script: [editor-check.mjs](fps-counter/editor-check.mjs). Raw output: [editor-check.txt](fps-counter/editor-check.txt). Result: 11 pass, 0 fail.

| Check | Result |
| --- | --- |
| Add › FPS Counter is in the menu and enabled (R4) | Pass |
| The new entity has the add defaults (R4) | Pass |
| The Hierarchy shows an Overlays group with the counter (R6) | Pass |
| The Inspector has the FPS Counter section and no Transform section (R5) | Pass |
| Corner › Bottom Left sends `setFpsCounter` (R5) | Pass |
| Size 48 sends `setFpsCounter` (R5) | Pass |
| Color `#ff8800` sends `setFpsCounter` (R5) | Pass |
| Reset Size sets 32 and keeps the other values (R5) | Pass |
| Duplicate is disabled with "Scene asset limit reached" (R4) | Pass |
| Add › FPS Counter is disabled at the limit (R4) | Pass |
| No page error | Pass |

Screenshots: [added](fps-counter/editor-added.png), [changed](fps-counter/editor-changed.png).

## Not checked

- The Scene window preview text. The Scene window needs the Tauri host (`bootstrap_session`), so the cloud did not run it. The same overlay module runs there; `bootstrap.ts` calls it on the success path of the preview pump.
- OBS: alpha around the text, the text shadow on a dark and a light background, and the value at 60 FPS.
- macOS and Windows.
