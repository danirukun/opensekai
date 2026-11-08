# Web page screens analysis

Date: 2026-11-08. Scope: MED-03 slice 1 (web page screens and interactive content). Contract: [web page screens](../prompt/2026-11-08-web-screens.md). Issue: [GitHub #61](https://github.com/danirukun/opensekai/issues/61). Base: B28 image screens ([contract](../prompt/2026-11-04-image-screens.md), merged in #258). Related: B29 video screens ([contract](../prompt/2026-11-08-video-screens.md), merged in #263; implementation in #264, not merged).

## Problem

An operator cannot show a web page in the scene. The main use is a chat widget or an alert widget (StreamElements, Streamlabs, a YouTube chat popout) near the character. The Bonnie scene spike ([spike](../../docs/superpowers/specs/2026-10-28-bonnie-scene-spike.md)) has 2 browser screens that show live chat pages. Today the operator must add a separate OBS Browser Source, which is not in the 3D scene and does not move with a camera.

Warudo Screen (handbook, rechecked 2026-11-08): **Content Type** Browser. "You can specify a URL to display a webpage." "You can also specify a Custom CSS stylesheet to be inserted into the webpage after loading." "This allows you to place custom chat widgets in the 3D space." The page gives no rule for the page size, interaction, transparency, audio, or reload.

The parity row MED-03 says: "Later; web pages need a separate capture design." This analysis is that design.

## Code facts

- B28 made `screen` an entity kind with a `content` union. B29 adds the `video` member. The B29 implementation (#264) adds a **Content** select to the Inspector **Screen** section.
- A renderer draws with three.js into one canvas. There are two renderer instances: the OBS page (`apps/output`, `output_main`) and `preview_main` in the Editor window. The scene pane preview, the editor viewport, and `cameraScreenshot` use `preview_main`.
- Both canvases use `alpha: true` and clear to alpha 0. The OBS page body is transparent. OBS composites the page with its alpha.
- DOM layers over a canvas already exist: the FPS counter (`fps-counter.ts`), the guide overlay, and the load overlay. None of them is in a screenshot.
- The Editor window CSP (`tauri.conf.json`) is `default-src 'self'` with no `frame-src`. So an `<iframe>` to a remote page is blocked now. The OBS page is served by the host with no CSP.
- The OBS page reads its connection descriptor from the URL hash, removes the hash, and keeps the descriptor in its own `localStorage`. The page origin is `http://127.0.0.1:<port>`.
- The Editor window has Tauri IPC and the editor commands (native dialogs, file writes). Its capability has no `remote` URL entry.
- three 0.180 has `CSS3DRenderer` (`three/addons/renderers/CSS3DRenderer.js`). It places DOM elements with CSS `matrix3d` from the same camera that the canvas uses.
- The host has an HTTP client only for `youtube.com` hosts.
- `crates/contracts` has the `url` crate.

## Options for the page pixels

A browser page cannot draw a cross-origin page into a WebGL or WebGPU texture. These options were examined:

| Option | Result |
| --- | --- |
| A. One `<iframe>` for each screen in a DOM layer, placed with CSS 3D transforms from the render camera. The canvas cuts a hole (alpha 0 with depth) where the screen is, and the page shows through. | Works in WebKit (Editor window) and CEF (OBS). The real browser draws the page, so scripts, fonts, animation, and OBS Interact work. No pixel copy. Limits: see below. **Selected.** |
| B. A native off-screen browser in the host (CEF or WKWebView snapshot) and a frame stream to each renderer. | AGENTS.md forbids a continuous image stream through Tauri IPC in the output path. A stream over the loopback service has the same cost (encode, copy, decode for each frame in two instances). A second browser engine in the host is a large dependency. Rejected. |
| C. HTML in canvas (`drawElementImage`, WICG proposal). | Chromium flag only. Not in WebKit or in the OBS CEF build. Candidate for a later slice when it ships. |
| D. Element capture or `getDisplayMedia`. | Needs a permission prompt and a user gesture. Chromium only. Not in OBS. Rejected. |

## Decisions

- A web page screen is a third member of the screen `content` union: `{ kind: 'web', url, width, height, onTop }`. The screen keeps its ID, transform, and Blueprint targets when the operator changes the content type. There is no asset record: the page is not stored.
- `url` is an `https:` URL (at most 2048 characters, no user name or password) or null. Plain `http:`, `file:`, and other schemes are refused, and so are local and private hosts (`localhost`, `.local`, loopback, private, and link-local addresses), so an MCP client or a show file cannot make the OBS page probe a local service. The first `src` can therefore never be the host service origin (`http://127.0.0.1`) or the Editor origin.
- `width` and `height` are the page viewport in CSS pixels (default 1280 × 720). The quad is 1 m high and `width / height` m wide, as for an image.
- **Depth.** With `onTop: false` (the default), the screen quad writes depth and color `(0, 0, 0, 0)` with no blending. A 3D object in front of the screen covers the page. A 3D object behind the screen is hidden. The page shows through the hole from a DOM layer below the canvas. With `onTop: true`, the quad writes nothing, and the page is in a DOM layer above the canvas. Nothing in the scene covers it, and the scene shows through the transparent parts of the page.
- **Transparency limit.** With `onTop: false`, a transparent part of the page shows what is under the OBS page (other OBS sources), not the 3D scene behind the screen. A chat widget with a transparent background in front of the stage needs `onTop: true`. This is the main difference from Warudo, which draws the page into a texture.
- **Interaction.** The OBS page gives pointer and key events to the iframes, so OBS **Interact** works on the page (scroll the chat, close a banner, sign in). The Editor window iframes get no pointer events, because the viewport tools own the pointer there. Each renderer instance has its own page instance. A sign-in or a scroll in OBS does not change the Editor page.
- **Audio.** The OBS page iframes get `allow="autoplay"`. The Editor iframes do not, so a page cannot start audio there without a gesture, and the iframes get no gesture. A cross-origin page cannot be muted from its parent, so this is the only control.
- **Sandbox.** Each iframe has `sandbox="allow-scripts allow-same-origin allow-forms"`, and `referrerpolicy="no-referrer"`. No popups and no top navigation. A sandboxed frame can still navigate itself, or follow a redirect, to `http://127.0.0.1:<port>/`. On the OBS page that frame would be same-origin with its parent and could read the bearer descriptor in `localStorage`. So the Editor CSP and a new OBS page meta CSP both set `frame-src https:`, which blocks each later navigation to a non-`https` URL, and each host response gets `x-frame-options: DENY` and `frame-ancestors 'none'`.
- **Screenshots and captures** contain no page pixels. With `onTop: false` the screen area is alpha 0 in a screenshot. With `onTop: true` the screenshot does not show the page.
- **Custom CSS** (Warudo) is not possible: a parent page cannot change a cross-origin document. Most widget services have their own CSS setting.
- **Load diagnostics** are not possible: a cross-origin iframe gives a `load` event also for an error page or a refused frame (`X-Frame-Options`, `frame-ancestors`). The renderer reports no load status for a web screen. A host-side probe of the frame headers is a candidate for a later slice.
- A scene has at most 4 web page screens, inside the B28 limit of 16 screens. Each page is a full page process in each renderer instance.

## Effects

- Old shows open without change. A show with a web page screen does not open in a build without this slice.
- No asset record, Tauri command, host route, frame field, or session runtime state changes.
- The Editor window can load remote `https:` pages in iframes. This changes the trust boundary of the Editor window (see Risks), so `ARCHITECTURE.md` gets a trust rule for web page screens.
- Each visible page costs a page process and its network traffic in each renderer instance: two in total.

## Risks

- **Tauri IPC from a frame.** The Editor window has privileged commands. Tauri 2 checks the IPC origin against the capability, and the capability has no `remote` entry. The Tauri initialization scripts must not run in a sub-frame. The cloud cannot prove this. The owner checks it first on macOS with a test page that tries to reach `window.__TAURI_INTERNALS__` and `ipc:`. If a frame can reach IPC, the Editor preview must not load pages (the fallback is the hole only, with the page in OBS only).
- **CSS 3D alignment.** The iframe corners must fall on the projected quad corners. The camera aspect comes from the logical output size, and the browser stretches the canvas to its CSS box, so the layer must stretch in the same way. Rounding and the CSS `perspective` precision in WebKit can still give a gap of a few pixels at the hole edge. The contract starts the renderer work with an alignment spike and a 1 px tolerance on Chromium.
- **Near plane.** CSS has no near-plane clipping. An element that crosses the camera plane draws mirrored or very large. The contract hides the iframe when a quad corner is not in front of the near plane.
- **Frame sync.** The canvas present and the DOM transform must change in the same composited frame, or the page lags the hole during a camera move. Both change in the same task. WebKit and CEF can still split them. The owner checks a camera move in OBS.
- **Framing refused.** YouTube chat allows a frame only for an `embed_domain` that equals the parent domain, so a YouTube chat popout can be refused in both instances. StreamElements and Streamlabs overlay URLs are made for OBS Browser Sources and usually allow a frame. The owner records which services work.
- **Third-party cookies.** A sign-in in a frame can need third-party cookies, which WebKit blocks by default. Widgets with a token in the URL do not need a sign-in.
- **Hole material.** three 0.180 node materials discard a fragment with alpha 0 when the blending is not normal, and a discarded fragment writes no depth. The hole must keep the color alpha above 0 and write `(0, 0, 0, 0)` through the output node.
- **Editor gizmo.** The gizmo is in the canvas, so a page with `onTop: true` covers it. The Editor preview dims the page of the selected screen.
- **Post effects.** A haze beam or FXAA applies to the canvas only. A beam in front of an `onTop: false` screen draws over the page; with `onTop: true` the page covers the beam.

## Out of scope

Custom CSS, load and framing diagnostics, a reload control, page zoom, Blueprint nodes for the URL, `http:` and local file pages, page audio volume, interaction in the Editor window, page pixels in screenshots, captures, and the benchmark, MED-05 appearance fields (bend, crop, corners, tint, chroma key), desktop and window capture (B31), and import from a Warudo scene file.
