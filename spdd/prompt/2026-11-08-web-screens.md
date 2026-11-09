# REASONS: Web page screens

Date: 2026-11-08. Scope: MED-03 slice 1. A Screen whose content is one `https:` web page. Each renderer instance shows the page in an `<iframe>` that a DOM layer places on the screen quad with CSS 3D transforms from the render camera. The canvas cuts a hole in the quad area, so 3D objects in front of the screen cover the page. OBS **Interact** works on the page. Analysis: [web page screens](../analysis/2026-11-08-web-screens.md). Issue: [GitHub #61](https://github.com/danirukun/opensekai/issues/61). Base: [image screens](2026-11-04-image-screens.md) (B28). Related: [video screens](2026-11-08-video-screens.md) (B29).

## R — Requirements

### Scene

R1. `ScreenContentSchema` adds `{ kind: 'web', url: string | null, width: integer, height: integer, onTop: boolean }` in TypeScript (zod) and the Rust `ScreenContent::Web`.
- `width` is 64 to 3840 and `height` is 64 to 2160 (CSS pixels of the page viewport).
- `url` is null or a string that passes the web URL rule (R2).
- A scene has at most 4 screens with web content (`LIMITS.webScreens` in the `SceneViewSchema` refine and `MAX_WEB_SCREENS` in the Rust `SceneView::validate`), inside the B28 limit of 16 screens. A patch that makes a fifth web screen (by `setScreenWeb`, `createEntity`, or Duplicate) fails the scene check with `INVALID_INPUT`.
- A show without a web screen validates without change.

R2. The web URL rule, one function on each side (`isWebScreenUrl` in `packages/contracts`, `is_web_screen_url` in `crates/contracts`):
- The string is 12 to 2048 characters (UTF-16 code units in TypeScript, bytes in Rust; the rule allows ASCII only, so both counts are equal).
- Each character is printable ASCII (0x21 to 0x7E). No space, no control character, and no non-ASCII character.
- It starts with `https://` (lowercase), and the next character is not `/`. (The WHATWG parser reads `https:///a.com/` as the host `a.com`, so the rule refuses the empty host before the parse.)
- It parses as a WHATWG URL (`new URL` in TypeScript, `url::Url::parse` in Rust) with the scheme `https`, a non-empty host, no user name, and no password.
- The host is not a local or private name or address (a name is compared without its trailing dots): not `localhost`, a name that ends in `.localhost` or `.local`, or an IP literal in `0.0.0.0/8`, `10.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `::`, `::1`, `fc00::/7`, `fe80::/10`, or an IPv4-mapped IPv6 address of one of these. This stops an MCP client or a show file from making the OBS page probe a service on this computer or the LAN. A public name that resolves to a private address (DNS rebinding) is not stopped; the CSP of R12 still keeps the host service origin out of a frame.
- The stored value is the string as the operator gave it. The renderer uses the parsed `href`.

`fixtures/protocol/web-urls.json` holds valid and invalid strings, and a test on each side reads it (as `image-records.json` does). It has at least: a plain `https` URL, a URL with a port, a query, and a fragment, an IP host, `http:`, `file:`, `javascript:`, `data:`, `HTTPS://` in uppercase, a user name, a user and password, a space, a tab, a non-ASCII host, an empty host (`https:///a`), 11 and 2049 characters, 2048 characters, `localhost`, `a.localhost`, `printer.local`, `127.0.0.1`, `10.1.2.3`, `192.168.0.10`, `172.20.0.1`, `169.254.1.1`, `[::1]`, `[fe80::1]`, `[::ffff:127.0.0.1]`, and a public IP literal (valid).

R3. The operation `setScreenWeb { entityId, web: { url, width, height, onTop } }` sets `content` to `{ kind: 'web', ...web }`. `setScreenImage` (B28 R9) and `setScreenVideo` (B29 R9, when it exists) set their content on a screen with web content. All fail with `NOT_FOUND` for an unknown entity and with `INVALID_INPUT` for an entity that is not a screen. The operation is in `PatchOpSchema`, `LivePatchOp`, and the Rust `PatchOp`. It commits like the other scene operations. The session keeps no runtime state for a web screen, and the frame does not change.

R4. The Blueprint property registry does not add a web property in this slice. Position, Rotation, Scale, and Visible already target a screen (B28 R10) and apply to a web screen without change.

### Renderer

R5. Each renderer instance owns two DOM layers next to its canvas, in this order from the back: the **back layer**, the canvas, the **front layer**. Each layer is an absolutely placed element with the same CSS box as the canvas, `overflow: hidden`, and `pointer-events: none`. Each layer has one `CSS3DRenderer` (`three/addons/renderers/CSS3DRenderer.js`) with its own `Scene`. The renderer creates the layers in `createRenderer` from a new optional option `webLayers: { back: HTMLElement; front: HTMLElement; interactive: boolean }`. Without the option, the instance shows no pages (R11 still applies). The OBS page and the scene pane give the option.
- OBS page (`apps/output/index.html`): `#web-back`, `#output`, `#web-front`, `#overlay`, in this order. The canvas gets `pointer-events: none`, so OBS Interact events reach the page. `interactive: true`. With `onTop: false`, a click on a 3D object that covers the page also reaches the page under it. This is accepted.
- Scene pane (`ScenePane.svelte`): the two layers are inside `.preview-surface`, behind and in front of `canvas#preview`, under the guide overlay, the FPS counter, and the load overlay. `interactive: false`.

R6. For each screen with web content and a non-null `url`, the instance keeps one `<iframe>` in a `CSS3DObject`:
- `src` is the parsed `href` of `url`.
- `sandbox="allow-scripts allow-same-origin allow-forms"`. No other sandbox token.
- `referrerpolicy="no-referrer"`.
- `allow="autoplay"` when `interactive` is true. No `allow` attribute when it is false.
- `pointer-events: auto` when `interactive` is true, and `none` when it is false. `tabindex="-1"` when it is false.
- CSS `width` and `height` are the content `width` and `height` in px. `border: 0`, `background: transparent`, and `color-scheme: normal` on the iframe and on both layers. (Chromium paints an opaque backdrop when the color scheme of the framed page differs from the embedder. Operation 3.3 records the result for a page with a dark color scheme.)
- The object is in the front layer scene when `onTop` is true, and in the back layer scene when it is false.
- A change of `url` replaces the iframe (the page loads again). A change of `width` or `height` keeps the iframe and its page and changes only the CSS size. A change of `onTop` moves the object to the other layer scene. This removes the element from the DOM and adds it again, so the page loads again and loses its scroll and sign-in state. This is accepted.
- The iframe is removed when the screen is deleted, its content is no longer web, or `url` becomes null.

R7. Placement. On each applied frame, after the canvas render, the instance renders each layer with the same camera that drew the canvas and with the CSS size of the canvas.
- The object world matrix is the screen entity world matrix times a scale of `1 / height` on X and Y, so the page is 1 m high and `width / height` m wide, centered on the entity origin, in the local XY plane, facing local +Z. The front of the page is upright and not mirrored (as B28 R11).
- The back of the screen shows the page mirrored (`backface-visibility: visible`), as the back of an image screen (B28 R11).
- When the screen is not visible (entity `visible` false), the iframe gets `visibility: hidden` and keeps its page.
- When any of the 4 quad corners is not in front of the camera near plane (clip space `w` at most the near distance), the iframe gets `visibility: hidden` for that frame. The hole of R8 stays.
- The editor viewport camera and the output camera use the same rule.
- CSS world scale. The CSS scenes are the scene scaled by 1000 (`CSS_WORLD_SCALE`): each object matrix is `scale(1000) × entity world matrix × scale(1 / height)`, and the CSS camera has the projection of the canvas camera and its view matrix with the translation times 1000. A uniform scale does not change the projection. It keeps the CSS scale of each iframe near 1. Headless Chromium does not paint a cross-origin iframe with a CSS scale of `1 / height` when a second one is in the same 3D context (found in Operation 3.3, two screens).
- Size match. `renderer.ts` sets `camera.aspect` from the logical output size (`width / height`), not from the canvas CSS box, and the browser stretches the canvas to its CSS box. So each layer element has the logical output size in CSS px and `transform: scale(cssWidth / width, cssHeight / height)` with `transform-origin: 0 0`, where `cssWidth` and `cssHeight` are the canvas CSS box. `CSS3DRenderer.setSize` gets the logical size. Then the layer stretches as the canvas does, and the page corners fall on the quad corners also when the output aspect is not the aspect of the CSS box.
- Order between pages. In one layer, the browser sorts the iframes in 3D (`preserve-3d` of `CSS3DRenderer`). Operation 3.3 checks two overlapping screens.
- Editor gizmo. The gizmo, the selection outline, and the helpers are in the canvas, so a front-layer page covers them. In the Editor preview (`interactive: false`), the iframe of the selected screen with `onTop: true` gets `opacity: 0.4`. The OBS page does not change.
- The pages keep running while the Editor preview is paused (the Preview toggle or the Assets tab). Only the layer transforms stop.

R8. The quad. Each instance draws one quad for each visible screen with web content and a non-null `url`, with the B28 R11 size rule (1 m high, `width / height` m wide) and `DoubleSide`.
- With `onTop: false`, the material is unlit (`MeshBasicNodeMaterial`) with the default `colorNode` (alpha 1), `outputNode = vec4(0, 0, 0, 0)`, `blending: NoBlending`, `transparent: false`, `depthWrite: true`, `depthTest: true`, `fog: false`, `toneMapped: false`. The color alpha must stay above 0: three 0.180 `NodeMaterial.setupDiffuseColor` discards a fragment with alpha 0 when the blending is not `NormalBlending`, and a discarded fragment writes no depth. `fog: false` keeps the RGB at 0, so the hole adds no light on the premultiplied canvas. So the canvas has alpha 0 where the front-most surface is the screen, and a 3D object in front of the screen draws over the hole. A transparent object in front blends over the hole as over a cleared pixel.
- With `onTop: true`, the material has `colorWrite: false` and `depthWrite: false`. It draws nothing, and it stays a pick target.
- The quad casts no shadow, receives no shadow, and is not in a light group (B28 R14).
- The hole rule applies on the direct canvas path and on the post chain (FXAA and a visible haze), for the pixels at least 2 px inside the hole edge. FXAA and MSAA blend the alpha at the edge. With the haze, a beam in front of the screen adds over the hole; a beam behind it is hidden by depth.
- A screen with `url: null` draws no quad and has no iframe.

R9. A web screen is a viewport pick target (with `url` null or a URL that fails R12, too: then the pick quad is the default 1280 × 720 aspect with `colorWrite: false`). The transform gizmo moves, rotates, and scales it (B28 R16). The iframe follows a gizmo draft on the same frame as the quad.

R10. The renderer reports no load status, no load warning, and no failure for a web screen. The asset ID branch in `renderer.ts` and the load jobs ignore a web screen. The web content type has no `assetId`, so the code narrows on `content.kind` before it reads `assetId`, and a web screen adds nothing to the `used` set or to `retainOnly`. A web screen is never read as an image, a video, or a mesh.

R11. `cameraScreenshot` and evaluation captures draw the canvas only. With `onTop: false` the screen area is alpha 0 in the PNG. With `onTop: true` the PNG does not show the page. The instance does not try to copy page pixels.

R12. Security rules for each iframe, in each instance:
- The renderer builds the iframe only from a `url` that passes `isWebScreenUrl` again, and whose parsed `href` also passes it (the parser percent-encodes some characters, so the `href` can be over 2048 characters). A failing value gives no iframe and no quad, and the renderer does not throw.
- The renderer never reads or writes the iframe document, never sends a message to it, and ignores each `message` event from it.
- The Editor window CSP (`tauri.conf.json`) adds `frame-src https:`. No other CSP directive changes.
- The OBS page is on the host service origin (`http://127.0.0.1:<port>`) and keeps the bearer descriptor in its `localStorage`. A sandbox without `allow-top-navigation` still lets a frame navigate itself, or get a redirect, to `http://127.0.0.1:<port>/`. Such a frame is same-origin with the OBS page and can read the token. So `apps/output/index.html` gets `<meta http-equiv="Content-Security-Policy" content="frame-src https:">`, which applies to each navigation and redirect of a frame. No other directive is in it.
- Each host service response (all routes in `service/`) gets `x-frame-options: DENY` and `content-security-policy: frame-ancestors 'none'`, so no page can frame a host route. This is a second barrier for the same attack. The OBS page loads as a top-level page, so it does not change.
- `capabilities/main.json` gets no `remote` entry. The Tauri 2 default runs the initialization scripts in the main frame only; this slice does not change it, and the owner check confirms it (Operation 7).

### Editor

R13. The Inspector **Screen** section **Content** select (B29 R19) adds **Web page** after **Video**. If B29 is not merged when this slice starts, this slice adds the select with **Image** and **Web page**, and B29 adds **Video** between them.
- Web page shows a **URL** text field, **Width** and **Height** number fields (px), and an **On top** checkbox.
- The URL field commits on Enter and on blur. The field ignores space before and after the text. An empty field commits `url: null`. A value that fails R2 does not commit, keeps the text, and shows `Enter an https URL`. A committed value sends `setScreenWeb` with the other values unchanged.
- Width and Height commit integer values in the R1 ranges on Enter and on blur. They clamp a value outside the range, as the other number fields do. A value that is not a number keeps the stored value.
- A change of Content to Web page sends `setScreenWeb` with `url: null`, `width: 1280`, `height: 720`, `onTop: false`. Content Web page is disabled at the web screen limit, unless the screen has web content.
- Duplicate (`budgetFull` in `Hierarchy.svelte`) is disabled for a screen with web content at the web screen limit, and (B29 R19) for a screen with video content at the video screen limit. Each limit applies only to its content kind.
- The Inspector reset (B17) covers Content (default Image), URL (null), Width (1280), Height (720), and On top (false). The section index covers the section.
- `model.ts` gets a `setScreenWeb` method next to `setScreenImage`.

R14. The Add menu **Screen** item does not change (it still makes image content). The Prop, Environment, character, Screen Image, and Screen Video selects do not change.

### MCP and files

R15. MCP `scene_patch` accepts `createEntity` with a web screen and `setScreenWeb`. The `scene_patch` description says how to show a web page on a screen, that the URL must be `https:`, and that `onTop` draws the page over the scene. There is no MCP tool that reads the page.

R16. Save As and Open keep each web screen and its content. A web screen has no asset reference, so Open has no missing state for it.

R17. `ARCHITECTURE.md` changes in the same commit:
- The Output path names the two web layers, the hole rule, and that page pixels are never in the canvas, a screenshot, a capture, or a frame.
- A new trust rule: a web screen URL is `https:` only, with no local or private host (R2), checked on both sides of the contract and again in the renderer. The page runs in a sandboxed cross-origin iframe with no popups and no top navigation. No renderer reads the iframe document or answers its messages. The Editor window and the OBS page allow `frame-src https:` only, so a frame cannot navigate to the host service origin. Each host response has `x-frame-options: DENY` and `frame-ancestors 'none'`. No capability has a `remote` entry.
- The workspace map row of `packages/renderer` names `web-screen.ts`.

## E — Entities

- `ScreenContent`: adds `{ kind: 'web', url: string | null, width, height, onTop }`.
- `PatchOp`: `setScreenWeb { kind, entityId, web }`.
- `LIMITS.webScreens` and `MAX_WEB_SCREENS`: 4.
- `isWebScreenUrl` (TypeScript) and `is_web_screen_url` (Rust).
- `RendererOptions.webLayers?`: `{ back, front, interactive }`.
- `WebScreenPlan` (renderer, plain data): for each web screen, `{ entityId, href, width, height, onTop, visible }`, from `frame.scene`.
- `InspectorSection`: the screen section adds the Web page fields.

## A — Approach

Add one content member and one saved operation. Do not store the page. Let the browser of each renderer instance draw the page in a sandboxed iframe, and place the iframe with `CSS3DRenderer` from the same camera as the canvas. Cut a hole in the canvas with a depth-writing alpha-0 quad, so the scene can cover the page. Give the operator one switch (`onTop`) for a transparent widget that must show the scene behind it. No page pixels go through Tauri IPC, the host, or the canvas.

## S — Structure

- `packages/contracts`: `schema.ts` (`ScreenContentSchema`, `PatchOpSchema`, `LIMITS.webScreens`, scene refine), `types.ts` (`LivePatchOp`), a new `web-url.ts` (`isWebScreenUrl`).
- `crates/contracts`: `ScreenContent::Web`, `PatchOp::SetScreenWeb`, `MAX_WEB_SCREENS`, `is_web_screen_url`.
- `fixtures/protocol/web-urls.json`.
- `packages/session`: `scene-ops.ts` (`setScreenWeb`).
- `packages/renderer`:
  - `web-screen.ts` (new: `webScreenPlan`, the iframe factory, the two `CSS3DRenderer` layers, the near-plane check, the hole and pick materials)
  - `screen.ts` (shared quad size)
  - `renderer.ts` (`webLayers` option, layer render after the canvas render, pick targets, asset ID branch)
- `apps/output`: `index.html` (layers, canvas pointer rule, `frame-src` meta CSP), `src/main.ts` (`webLayers`).
- `apps/desktop/src-tauri/src/service/`: the `x-frame-options` and `frame-ancestors` response headers, with a test.
- `apps/desktop/src-tauri/tauri.conf.json`: `frame-src https:`.
- `apps/desktop/src`: `components/ScenePane.svelte` (layers), `bootstrap.ts` (`webLayers`), `editor/screen.ts`, `editor/model.ts` (`setScreenWeb`), `editor/inspector-sections.ts`, `editor/property-defaults.ts`, `components/ScreenWebFields.svelte` (new), `components/Inspector.svelte`, `components/Hierarchy.svelte` (Duplicate limit).
- `apps/mcp/src/server.ts`: descriptions.
- `ARCHITECTURE.md`: the Output path, the trust rule, and the workspace map.

## O — Operations

1. **Contracts.** Schemas, types, the Rust mirror, `web-urls.json`, and tests for the URL rule on both sides, the limits, the operation, and a show round trip.
2. **Session.** Unit tests for `setScreenWeb`: content change from image to web and back, `NOT_FOUND`, `INVALID_INPUT` for a non-screen, an invalid URL, and the fifth web screen by each path.
3. **Renderer.**
   1. Spike first (go or no-go). Headless Chromium on WebGL 2, and WebGPU where it runs. Serve a test page through Playwright `page.route` on `https://screen.test.invalid/` (no network). The page fills its viewport with solid red.
      - Hole: draw one `onTop: false` screen in front of a green box that is larger than the screen. Read the canvas pixels (the renderer capture path, `captureRequest`, which reads the drawn frame, not the page screenshot). Pixels at least 2 px inside the projected quad have RGBA `(0, 0, 0, 0)`. Do this on WebGL 2 and WebGPU. A failure here stops the slice: record it.
      - Alignment: take a page screenshot (DOM and canvas composited). Pixels at least 2 px inside the projected quad are red. Pixels at least 2 px outside are green or the clear color. Along each edge, at 5 points, find the position where the red channel crosses 50 % between the inside and outside values. It is within 1 px of the projected quad edge.
      - Cases: straight on, a 30-degree yaw, a 20-degree pitch, a 16:9 output in a 4:3 CSS box (stretched canvas), and the 960 × 540 output format.
      - If a case fails, record it and the measured gap in the implementation pull request before other renderer work.
   2. Unit tests (pure): `webScreenPlan` from a scene (null URL, invalid URL, hidden screen, layer choice, limit), the near-plane check, and the iframe attributes for `interactive` true and false (sandbox, referrer policy, `allow`, pointer events).
   3. Headless page screenshot checks with `page.route` test pages, on WebGL 2 (and WebGPU where it runs):
      - `onTop: false`: a blue box in front of the screen covers the red page. A green box behind the screen does not show.
      - `onTop: true`: the red page covers the blue box in front.
      - A test page with a transparent body and one red square: with `omitBackground: true`, the page pixels outside the square have alpha 0 in both modes, and with `onTop: true` the green box behind shows through. Repeat with a page that sets `color-scheme: dark`, and record the result.
      - Two overlapping `onTop: false` screens at different depths, with different page colors: the nearer page shows in the overlap.
      - FXAA on, and a visible haze: the hole keeps alpha 0 at least 2 px inside the edge (canvas pixel read).
      - Frame barrier: a test page that sets `location` to the host service origin, and a test page that answers with a 302 to it. The frame does not load the host page (the meta CSP blocks it), and no frame reads the OBS page `localStorage`. A host route test checks the two frame headers.
      - A `cameraScreenshot` PNG has alpha 0 in the screen area for `onTop: false`.
      - A camera that moves through the screen plane hides the iframe (R7) and does not throw.
      - A URL change replaces the iframe. A width change keeps it (the same element).
   4. Record each result with the backend. A result that the software adapter cannot give is unknown.
4. **Editor.** The Content select, the Web page fields, the URL commit and its message, the limits, the reset values, and R14, with unit tests for the pure parts. A headless browser check of the flow with a `page.route` test page, where it runs without a GPU.
5. **MCP.** Descriptions, and a `scene_patch` test that creates a web screen and sets its URL.
6. **Records.**
   - Evidence in `docs/evaluation/web-screens.md`. It says that a screenshot or a capture is not valid evidence for page content, because it has no page pixels. `docs/qa.md` gets the same line.
   - `docs/warudo-parity.md`: MED-03 stays unchecked. Custom CSS, load and framing diagnostics, the depth of a transparent page part with `onTop: false`, the owner check, and Windows remain.
   - Open follow-up issues with the `needs-slice` label for Custom CSS and for framing diagnostics, and link them in the parity line. #61 stays open.
   - `ARCHITECTURE.md`.
7. **macOS check by the owner (accept:local).**
   - First, the trust check. In the Editor window, set a web screen URL to a test page that tries: `window.__TAURI_INTERNALS__` and `window.__TAURI__` (must be undefined); a `fetch` and an `XMLHttpRequest` to `ipc://localhost/...` and `http://ipc.localhost/...`; a navigation of the frame to `tauri://localhost/`, `ipc://localhost/`, `http://ipc.localhost/`, and `http://127.0.0.1:<port>/renderer/` (each must be blocked by `frame-src https:`). Each attempt must fail. If one succeeds, stop and report it. Do not ship the Editor iframe.
   - Repeat the navigation attempts in the OBS page.
   - The Editor window (WebKit) shows the page on the screen. The page edge stays on the quad edge during a viewport orbit and a gizmo drag.
   - The OBS page (CEF) shows the page over a colored OBS background. The character in front of an `onTop: false` screen covers the page. A transparent widget with `onTop: true` shows the stage behind it.
   - OBS **Interact**: scroll a chat page and click a button on it.
   - A page with sound plays it in OBS only. The Editor window makes no sound.
   - Record which services show in a frame: a StreamElements or Streamlabs overlay URL, and a YouTube chat popout.
   - A camera switch and a fast camera move in OBS: record whether the page lags the hole.
   - Minimize the Editor window for 30 s: the OBS page keeps the page and the scene.
   - Save As and Open.

## N — Norms

- Use `@oshi-connect/ui` controls.
- Keep UI copy to the labels in R13. The only new message is `Enter an https URL`.
- Write prose in ASD-STE100.
- Use pnpm.
- Keep functional TypeScript and plain data. `webScreenPlan` is a pure function of the scene.
- Use a `page.route` test page in each test. No test loads a page from the network.

## S — Safeguards

- Do not allow a scheme other than `https:` or a URL with a user name or a password.
- Do not add a sandbox token other than `allow-scripts`, `allow-same-origin`, and `allow-forms`. Do not add `allow-popups`, `allow-top-navigation`, or `allow-modals`.
- Do not read the iframe document, post a message to it, or act on its messages.
- Do not add a `remote` capability entry. Do not add a CSP directive other than `frame-src https:` (Editor window and OBS page) and the host `frame-ancestors 'none'` header.
- Do not copy page pixels into the canvas, a texture, a screenshot, a capture, or Tauri IPC. Do not add a native browser engine or a frame stream.
- Do not change the look of a scene without a web screen. Its canvas pixels do not change, and the two empty layers have no visible effect and take no pointer events.
- Do not claim these from this slice: Custom CSS, load or framing diagnostics, page pixels in screenshots or captures, interaction in the Editor window, the depth of a transparent page part with `onTop: false`, or Windows support.
- An old build does not open a show with a web screen. Record this in the evidence.
