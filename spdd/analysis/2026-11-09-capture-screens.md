# Capture screens analysis

Date: 2026-11-09. Scope: MED-04 slice 1 (desktop and window capture into the scene). Contract: [capture screens](../prompt/2026-11-09-capture-screens.md). Issue: [GitHub #62](https://github.com/danirukun/opensekai/issues/62). Base: B28 image screens ([contract](../prompt/2026-11-04-image-screens.md), #258) and B29 video screens ([contract](../prompt/2026-11-08-video-screens.md), #264). Related: B30 web page screens ([contract](../prompt/2026-11-08-web-screens.md), #265; implementation #275, not merged).

## Problem

An operator cannot show a monitor or an application window on a screen in the 3D scene. Common uses: a game window behind the character, a slide deck or a code editor on a stage screen, and a collaboration partner's stream window. Today the operator must add an OBS Display Capture or Window Capture source. That source is flat, is not in the 3D scene, does not move with a camera, and a character cannot stand in front of it.

Warudo Screen (handbook, rechecked 2026-11-09): **Content Type** **Display** "captures a monitor" with the **Display** property. **Window** "captures a window" with the **Window** property; "the window is captured using the window title", and when several windows have the same title, only one of them is captured. The page gives no frame rate, size, cursor, or audio rule. Bend, Crop, Corner Radius, Tint, and Chroma Key are MED-05.

The parity row MED-04 says: "Later; native platform adapters."

## Code facts

- B28 made `screen` an entity kind with a `content` union. B29 adds the `video` member, the Inspector **Content** select (`ScreenContentField.svelte`), and a session-owned playback clock. B30 (not merged) adds the `web` member.
- There are two renderer instances: the OBS page (`apps/output`, `output_main`) and `preview_main` in the Editor window (WebKit). The scene pane preview, the editor viewport, and `cameraScreenshot` use `preview_main`. The OBS page runs in the OBS CEF (Chromium) browser source.
- The architecture design says: "The initial OBS renderer sends state and loads assets; it does not receive a per-frame image stream. Diagnostic screenshots are bounded exceptions." AGENTS.md forbids a continuous image readback, a JPEG encode, or an image stream through Tauri IPC in the production output path.
- The loopback service (`service/mod.rs`) has one WebSocket route, `/ws`. It carries JSON text only. The first message is `Auth` with the token of a connection descriptor. Each connection has small bounded queues (`queues.rs`: state 2, control 64).
- The host already runs per-revision managers that read the scene: the tracking manager and the VMC sender manager (`vmc_sender.rs`) bind sockets from a pure plan of the accepted scene.
- The host has macOS-only dependencies behind `cfg` (gilrs, midir). Linux has stubs, so the cloud build needs no platform headers.
- B29 found that Dawn on the software adapter rejects an external texture copy of an `HTMLVideoElement` and of a `VideoFrame`. It uploads one `ImageBitmap` for each new video frame on WebGPU. WebGL 2 uploads the element.
- The router gives the same `edit` capability to the Editor operator and to MCP. The host cannot tell them apart by the capability.
- `cameraScreenshot` writes a PNG of `preview_main` into the app screenshots folder.

## Platform facts (to confirm on macOS)

- macOS: ScreenCaptureKit (`SCShareableContent`, `SCStream`) captures one display or one window into `CVPixelBuffer` frames. It needs the Screen Recording permission (TCC) for the app. macOS 15 and later show a recurring privacy prompt for apps that capture. The system shows a capture indicator in the menu bar. VideoToolbox (`VTCompressionSession`) encodes H.264 in hardware with real-time and no frame reorder.
- WebCodecs `VideoDecoder` is in Chromium 94 and later (the OBS 30 and later CEF builds) and in Safari 16.4 and later (the WKWebView of the supported macOS versions). Both decode H.264. `optimizeForLatency` is in both.
- Windows (later): Windows.Graphics.Capture and Media Foundation give the same shape.
- The cloud container has no display server for capture, no ScreenCaptureKit, and no hardware encoder. ffmpeg with libx264 is installed. Headless Chromium 153 on a page at `http://127.0.0.1` answers `VideoDecoder.isConfigSupported` true for `avc1.42e01f`, `avc1.4d0029`, and `avc1.640029` at 1920 × 1080 with `optimizeForLatency` (checked 2026-11-09). On `about:blank`, `VideoDecoder` is not defined: WebCodecs needs a secure context. The OBS page origin `http://127.0.0.1` is a secure context. The Editor window origin (`tauri://localhost`) must be confirmed on macOS.

## Options for the pixels in the OBS page

| Option | Result |
| --- | --- |
| A. The host captures natively, encodes H.264 in hardware, and sends the encoded chunks over a separate loopback WebSocket route to each renderer. Each renderer decodes with WebCodecs and uploads the newest frame to a texture. | Works in CEF and WebKit. One capture and one encode for each source. The data is compressed (about 1 to 3 MB/s at 1080p30), not raw pixels, and it never goes through Tauri IPC. It is a per-frame stream to the OBS page, so it is a second bounded exception to the architecture rule. **Selected, owner to confirm.** |
| B. Raw BGRA frames over the loopback WebSocket. | 1920 × 1080 × 4 × 30 is about 250 MB/s for each renderer. The copy and the upload cost are too high. Rejected. |
| C. `getDisplayMedia` in each page. | Not in the OBS browser source. Needs a picker and a user gesture in each page. Rejected. |
| D. WebRTC from the host. | Needs a WebRTC stack in Rust (a large crate) for a loopback link. It adds jitter buffers and pacing that add latency. Candidate only if option A fails the latency gate. |
| E. OBS owns the capture (Display Capture source under the OpenSekai page). | Not in the 3D scene. A character cannot stand in front of it. It does not follow the camera. This is the current workaround, not this feature. |
| F. Shared GPU memory (IOSurface) into the page. | A browser page cannot read it. Rejected. |

## Decisions

- **Architecture exception.** A capture screen is the one content type that needs a per-frame stream to the OBS page. The stream starts only while a scene has a visible capture screen with an allowed source. It carries H.264 chunks, never raw pixels or JPEG. It uses its own WebSocket route, so it never delays a state frame or a call reply. It never goes through Tauri IPC. The architecture design and `ARCHITECTURE.md` record this as a bounded exception, next to the diagnostic screenshot exception. The owner must confirm this before the implementation run.
- **Content shape.** A fourth member of the screen `content` union: `{ kind: 'capture', target, source, cursor }`. `target` is `display` or `window`, so the Inspector can show the two Content options, **Display** and **Window**, as Warudo does, also while no source is chosen. `source` is `{ kind: 'display', name, ordinal }`, `{ kind: 'window', app, title }`, or null. There is no asset record. The source is scene data: the chosen display name or window title is in the scene and in show files, as a Warudo scene keeps the window title.
- **Source match.** A saved source is a description, not a platform ID, because display and window IDs change after a restart. A display matches by its name and the order among displays with the same name. A window matches by its application ID (the bundle ID on macOS) and its exact title. When no window has that title and the application has exactly one capturable window, that window matches. Warudo matches by title only; the application ID stops a different application with the same title from being captured.
- **Who can choose a source.** Only an operator action in the Editor window can allow a source. The host keeps a set of allowed sources for this app run. A source becomes allowed when the operator chooses it in the Inspector, or clicks **Allow** on a saved source (an editor-only Tauri command). An opened show allows nothing, so a show file from another person cannot start a capture of the desktop (the VMC sender has the same rule for Open). A capture screen whose source is not allowed shows `Choose the source again` and captures nothing. MCP can create, move, and hide capture screens, and can set a source that is already allowed. MCP cannot list the windows. So an MCP client cannot turn on a capture of the desktop and read it back with `camera_screenshot`.
- **Limits.** At most 2 capture screens in a scene, and at most 2 sources at a time. Screens with the same source and cursor value share one stream, and each renderer opens one socket and one decoder for each stream. A new subscriber starts from a cached key frame, and the adapter encodes the last image again each 1 s, so a static window shows at once. Each stream is at most 1920 × 1080 (scaled down, aspect kept) and at most 30 frames a second. The cursor is captured when `cursor` is true (default true, as OBS does).
- **No audio** in this slice. Window audio capture is a later slice.
- **The OpenSekai windows are never captured.** A display capture excludes the Editor window, so the preview does not show itself in a loop.
- **Linux and Windows** get a stub adapter that reports `Capture not supported on this platform`. A test adapter replays a committed H.264 fixture, so the cloud can test the plan, the route, the queue rules, the decoder, and the texture path.

## Effects

- Old shows open without change. A show with a capture screen does not open in a build without this slice.
- The scene gets a new content member and two operations. The frame gets an optional `screenCapture` status list.
- The host gets a capture manager, a platform adapter, one WebSocket route, and one editor-only Tauri command. The macOS build gets ScreenCaptureKit and VideoToolbox bindings.
- The first capture asks for the Screen Recording permission. The owner sees the macOS capture indicator while a capture runs.

## Risks

- **Permission flow.** macOS shows the TCC prompt one time, then needs an app restart after the operator allows it. A Tauri dev build and a signed build have different TCC identities. The contract maps a denied permission to `Screen Recording permission needed` and does not retry in a loop.
- **Latency and cost.** Capture, encode, two WebSocket sends, two decodes, and two texture uploads. The gate: the OBS page shows a change on the source within 100 ms (median) on the owner's Mac, and the benchmark scene with one capture screen keeps its frame rate within the benchmark tolerance. These are owner checks. If the gate fails, the fallback order is: a lower capture size, then option D.
- **WebGPU upload.** On WebGPU the renderer uploads one `ImageBitmap` for each decoded frame (the B29 path). A real GPU may accept the `VideoFrame` external copy, which is cheaper. The contract starts with the B29 path and records a spike result.
- **Decoder errors.** CEF and WebKit can reject a profile or a level. The encoder uses the H.264 Main profile, level 4.1 or lower. The renderer checks `VideoDecoder.isConfigSupported` and reports `Capture codec not supported`.
- **Window title changes.** A browser window changes its title with each tab. The single-window fallback helps for one window. Several windows of one application with changing titles lose their match. Warudo has the same limit.
- **Privacy.** A display capture shows notifications and other windows on that display in the stream. This is the operator's choice, as in OBS. The host never writes the captured frames to disk except through `cameraScreenshot`, which the operator or an allowed MCP call starts.
- **Rust bindings.** The `objc2` ScreenCaptureKit and VideoToolbox crates are new dependencies. The integrator owns dependency versions; the implementation pins exact versions as the other platform crates do.

## Out of scope

Audio capture, region capture, Crop and the other MED-05 fields, more than 30 frames a second or more than 1920 × 1080, HDR, the Windows adapter, Spout (MED-06), NDI (MED-07), a capture of a single application with all its windows, a capture source in a Blueprint, an MCP source list, and a capture source in a Warudo scene import.
