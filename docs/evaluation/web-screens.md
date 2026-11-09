# Web page screens check

Date: 2026-11-09. Scope: MED-03 slice 1, bundle B30 ([#61](https://github.com/danirukun/opensekai/issues/61)). Contract: [web page screens](../../spdd/prompt/2026-11-08-web-screens.md). Base commit: bbb27e0 plus the B30 implementation branch changes.

Platform: Linux cloud container (Ubuntu, x86_64, no GPU, no OBS). pnpm 12.8.1, Playwright Chromium (headless) from `/opt/pw-browsers`. Setup `gpu:` line: WebGPU on SwiftShader (device true), WebGL 2 on ANGLE Mesa llvmpipe. Quality profile: `production_v1` (OBS page), `preview_v1` (scene pane).

A screenshot or a capture is not valid evidence for page content: page pixels are never in the canvas, a screenshot, or a capture (R11). The page checks below read the composited page from Playwright, which includes the DOM layers. The canvas checks read the drawn frame through the renderer capture path (`captureRequest`).

This check proves the URL rule, the scene and patch rules, the session operation, the host frame headers, the Editor flow, MCP, and on WebGL 2 the hole, the page placement, and the frame rules in headless Chromium. It does not prove the Editor window on WebKit, the OBS Browser Source (CEF), OBS Interact, page sound, visual quality on a real GPU, or Windows.

## Contracts, session, host (verified)

| Check | Test | Result |
| --- | --- | --- |
| The URL rule against 43 shared vectors (`fixtures/protocol/web-urls.json`) on each side (R2) | `packages/contracts/test/web-screen.test.ts`, `crates/contracts/tests/web_screen.rs` | Pass |
| 4 web screens inside the 16-screen limit, the fifth fails; size ranges; no extra field; `setScreenWeb`; a show round trip (R1, R3, R16) | same files | Pass |
| Image to web and back, null URL, `NOT_FOUND`, `INVALID_INPUT` for a non-screen and a bad URL, the fifth web screen by `setScreenWeb` and by `createEntity` (R1, R3) | `packages/session/test/screen-patch.test.ts` | Pass |
| Save As and Open keep a web screen (R16) | `show` `round_trip_keeps_a_web_screen` | Pass |
| Each host route (`/renderer/`, a missing file, `/assets`, `/diagnostics`, `/evidence`, `/ws`) answers with `x-frame-options: DENY` and `content-security-policy: frame-ancestors 'none'` (R12) | `service_integration` `service_routes_deny_framing` | Pass |
| MCP over real stdio: the description, `createEntity` with a web screen, `setScreenWeb`, and a refused loopback URL (R15) | `apps/mcp/test/screen.integration.test.ts` | Pass |
| Renderer unit tests: the plan (null, failing, a parsed href over 2048 characters, hidden, layer, limit), the near-plane check, the iframe attributes in each mode, the hole and pick materials, the quad size, and the projection in the scaled CSS world (R6 to R8) | `packages/renderer/test/web-screen.test.ts` | Pass |
| Editor unit tests: the Content options at the limit, the URL parse, the size clamp (also a number from a bound input), and the reset values (R13) | `apps/desktop/test/screen.test.ts` | Pass |

## Output (headless Chromium, OBS page)

`web-screens/headless-check.mjs` runs the built OBS page with a stand-in host and a real session ([WebGL 2 output](web-screens/headless-check-webgl2.txt): 118 pass, 0 fail, 0 unknown; [WebGPU output](web-screens/headless-check-webgpu.txt): 31 pass, 0 fail, 85 unknown). Each test page comes from Playwright `route` on `https://screen.test.invalid/`.

### Operation 3.1 spike: go

| Case | Hole: canvas RGBA (0, 0, 0, 0) 3 px inside each corner and at the center | Page red 3 px inside each corner | Largest gap of the 50 % red crossing from the projected edge (20 points) |
| --- | --- | --- | --- |
| Straight on | Pass ([canvas](web-screens/straight-canvas-webgl2.png)) | Pass ([page](web-screens/straight-page-webgl2.png)) | 0.56 px |
| 30° yaw | Pass | Pass ([page](web-screens/yaw-30-page-webgl2.png)) | 0.59 px |
| 20° pitch | Pass | Pass | 0.77 px |
| 16:9 output in a 4:3 CSS box (stretched canvas) | Pass | Pass ([page](web-screens/16-9-output-in-a-4-3-box-page-webgl2.png)) | 0.53 px |
| 960 × 540 output | Pass | Pass | 0.52 px |

All values are WebGL 2. On WebGPU each frame applies without a warning or a page error, but the capture is one flat color or times out, and headless Chromium does not put a WebGPU canvas in a page capture (as in the B28 check). So WebGPU hole and placement pixels are unknown.

The first run found a defect: with two cross-origin pages in one layer, headless Chromium painted only one. A minimal page without OpenSekai code shows the same result when an iframe has a CSS scale of 1 / 720. The renderer now draws the CSS scenes in a world scaled by 1000 (contract R7, CSS world scale), and both pages paint.

### Operation 3.3

| Case | WebGL 2 |
| --- | --- |
| `onTop: false`: a box in front covers the page; a box behind does not show | Pass ([page](web-screens/occlusion-page-webgl2.png)) |
| `onTop: true`: the page covers the box in front; the canvas has no hole | Pass ([page](web-screens/on-top-page-webgl2.png)) |
| Transparent page body with a red square: alpha 0 outside the square in both modes; with `onTop: true` the box behind shows through | Pass ([page](web-screens/transparent-light-over-a-box-page-webgl2.png)) |
| The same page with `color-scheme: dark` | Recorded: the area outside the square is opaque RGB (18, 18, 18) in both modes. Chromium paints an opaque backdrop for a page whose color scheme differs from the embedder ([page](web-screens/transparent-dark-true-page-webgl2.png)). |
| Two overlapping `onTop: false` screens: the nearer page shows in the overlap | Pass ([page](web-screens/two-screens-page-webgl2.png)) |
| FXAA, and a visible haze: the hole keeps RGBA 0 3 px inside each corner (canvas capture) | Pass. A run during a parallel Rust build gave unknown here: the capture took longer than the 2 s handler limit. |
| Frame barrier: a page that navigates itself to the host origin and a page that answers with a 302 to it load an error page; no frame request reaches the host; a page cannot read the OBS page storage; each iframe has the sandbox, `no-referrer`, and `allow="autoplay"`; the canvas takes no pointer events; the meta CSP is `frame-src https:` only | Pass |
| A URL change replaces the iframe; a width change keeps it; `onTop` moves it to the front layer; a hidden screen keeps it with `visibility: hidden`; a null URL removes it | Pass |
| A camera that moves through the screen plane: the iframe shows in front and hides at the plane and behind; no error | Pass |

## Editor (headless Chromium)

`web-screens/editor-check.mjs` runs the built Editor window with a stand-in host ([raw output](web-screens/editor-check.txt)). 21 of 21 pass:

- Add Screen still makes image content (R14). The Content select has Image and Web page. Web page sends `setScreenWeb` with no URL, 1280 × 720, and On top off. The fields are URL, Width, Height, and On top (R13).
- `http://example.com/` does not commit and shows `Enter an https URL`; a valid URL commits with the other values unchanged. Width 5000 clamps to 3840 (R13).
- The scene pane has a page layer behind and in front of `canvas#preview`. Its iframe has no `allow`, `tabindex="-1"`, and no pointer events. On top moves it to the front layer, and the selected screen page is at opacity 0.4 (R5 to R7). [Inspector](web-screens/inspector-web.png).
- Reset marks show for Content, URL, Width, and On top; the Content reset sends `setScreenImage` with null (R13).
- At 4 web screens, Web page is disabled on an image screen and enabled on a web screen; Duplicate is disabled for a web screen and enabled for an image screen (R13).
- A camera screenshot of an `onTop: false` screen in front of a box has alpha 0 at the screen center and 255 on the box (R11). [Screenshot](web-screens/camera-screenshot.png).

The first run of this check found a defect: a number input bound with `bind:value` gives a number, and the size clamp failed on it. The clamp now takes a number or a string, with a unit test.

## Not verified here (owner on macOS)

- The trust check of Operation 7 in the Editor window (WebKit) and the OBS page: no `__TAURI_INTERNALS__` or `__TAURI__` in a frame, failed `ipc://` and `http://ipc.localhost` requests, and blocked frame navigations to `tauri://localhost/`, `ipc://localhost/`, `http://ipc.localhost/`, and the host renderer route.
- The page on the screen in the Editor window and in OBS (CEF), the edge during an orbit and a gizmo drag, a camera switch, and a fast camera move.
- OBS Interact (scroll and click), page sound in OBS only, which services allow a frame (StreamElements, Streamlabs, YouTube chat popout), a minimized Editor window for 30 s, and Save As and Open in the app.
- WebGPU pixels, visual quality on a real GPU, and Windows.
- An old build does not open a show with a web screen (the scene schema rejects the `web` content kind).
