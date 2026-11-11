# REASONS: Capture screens

Date: 2026-11-09. Scope: MED-04 slice 1. A Screen whose content is a live capture of one display or one application window. The host captures with a platform adapter, encodes H.264, and sends the encoded chunks to each renderer instance over a separate loopback WebSocket route. Each renderer decodes with WebCodecs and draws the newest frame on the screen quad. Only the Editor window can allow a capture source. Analysis: [capture screens](../analysis/2026-11-09-capture-screens.md). Issue: [GitHub #62](https://github.com/danirukun/opensekai/issues/62). Base: [image screens](2026-11-04-image-screens.md) (B28) and [video screens](2026-11-08-video-screens.md) (B29).

**Gate before implementation.** This contract adds a per-frame stream to the OBS page. The architecture design allows no per-frame image stream to the OBS renderer except diagnostic screenshots. The owner accepts or rejects the exception (R1) by the merge of this contract. Without that acceptance, do not implement this contract.

## R — Requirements

### Architecture exception

R1. The architecture design (`docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md`, the output section) adds one bounded exception: a capture screen stream. The stream:
- exists only while the scene has a visible capture screen whose source is allowed (R5) and found (R6);
- carries H.264 chunks from the host encoder, never raw pixels, JPEG, or PNG;
- uses its own WebSocket route (`/capture`), never `/ws` and never Tauri IPC;
- has at most 2 sources, each at most 1920 × 1080 and 30 frames a second.

`ARCHITECTURE.md` records the capture path (a new **Capture path** section, see Structure) in the same commit as the code.

### Scene

R2. `ScreenContentSchema` adds `{ kind: 'capture', target: 'display' | 'window', source: CaptureSource | null, cursor: boolean }` in TypeScript and the Rust `ScreenContent`. A non-null `source` has the same kind as `target`. `target` keeps the Inspector choice (Display or Window) while `source` is null. `CaptureSource` is one of:
- `{ kind: 'display', name, ordinal }`: `name` is the display name (1 to 128 characters), `ordinal` is an integer 0 to 7, the order among the displays with the same name.
- `{ kind: 'window', app, title }`: `app` is the application ID (the bundle ID on macOS; 1 to 255 characters), `title` is the window title (0 to 512 characters).

Each string is normalized with one function on both sides (`normalizeCaptureText` / `normalize_capture_text`): control characters become spaces, runs of spaces become one space, the result is trimmed, and a title is cut to 512 characters. `match_source` (R7) applies the same function to the inventory values before it compares them. `fixtures/protocol/capture-sources.json` holds valid and invalid values, and a test on each side reads it.

A scene has at most 2 screens with capture content (`LIMITS.captureScreens` in the `SceneViewSchema` refine and `MAX_CAPTURE_SCREENS` in the Rust `SceneView::validate`), inside the limit of 16 screens. A show without a capture screen validates without change. A patch that makes a third capture screen (by `setScreenCapture`, `createEntity`, or Duplicate) fails the scene check with `INVALID_INPUT`.

R3. The operation `setScreenCapture { entityId, capture: { target, source, cursor } }` sets `content` to `{ kind: 'capture', ...capture }`. It fails with `NOT_FOUND` for an unknown entity and with `INVALID_INPUT` for an entity that is not a screen. It is in `PatchOpSchema`, `LivePatchOp`, and the Rust `PatchOp`. It commits like the other scene operations. `setScreenImage` and `setScreenVideo` replace capture content as they replace other content. When B30 is merged first, `setScreenWeb` does the same, and the content kinds are ordered `image`, `video`, `web`, `capture`.

R4. The session has no capture state. The capture status is host state (R9). The session frame does not change.

The source is scene data: the display name and the window title are in the scene, in show files, and in `scene_inspect` replies, as the operator chose them. They are not in the capture status, `app_status`, or a log.

### Allowed sources

R5. The host keeps a set of allowed sources for this app run (`capture/allow.rs`). It is never saved. A source is allowed when:
- the Editor window calls the editor-only Tauri command `capture_source_allow { source }` after the operator chooses it in the Inspector (R17), or after the operator clicks **Allow** on a saved source (R17).

Nothing else allows a source. An opened show (`open_show` in `lib.rs`), `sceneReplace`, and `scenePatch` from any client never allow a source, so a show file from another person cannot start a capture by itself (the same rule as a VMC sender, which an Open never starts). A source compares by its full value (R2). The set holds at most 16 sources; the oldest one goes out first. An MCP client can therefore set a capture source only when the operator already allowed it in this run.

R6. `capture_source_list` is an editor-only Tauri command with no argument. It returns `{ sources: [{ source, label, width, height }] , error }`:
- one entry for each display, with `label` equal to the name. The name is `NSScreen.localizedName` of the display with the same `CGDirectDisplayID`. Displays with one name are ordered by the frame origin (x, then y), and `ordinal` is the index in that order. The label is the name plus ` (2)`, ` (3)`, and so on for a later ordinal;
- one entry for each capturable window: on screen, at layer 0, not of the OpenSekai process, with a non-empty title or app name, at least 32 × 32 pixels. `label` is `<app name> — <title>`;
- at most 64 windows, in front-to-back order;
- `error`: null, `Screen Recording permission needed`, or `Capture not supported on this platform`.

The list goes only to the Editor window. Window titles and display names that the operator did not choose never leave the host and the Editor window.

R7. Source match (pure function `match_source(source, inventory) -> Option<PlatformTarget>` in `capture/plan.rs`):
- A display matches the display with the same name at the same ordinal.
- A window matches the first window (front to back) with the same `app` and the same `title`. When there is none and exactly one capturable window of that `app` exists, that window matches.
- Otherwise there is no match.

### Host capture manager

R8. `capture/mod.rs` has one `CaptureManager`. On each accepted scene revision it computes a plan with the pure function `capture_plan(scene, allowed) -> Vec<PlannedStream>`:
- each visible screen with capture content and a non-null source;
- grouped by the stream key (`source` and `cursor`), so screens with one source and one cursor value share one stream; two cursor values make two streams;
- each source that is not allowed gets the screen state `notAllowed` and no stream;
- at most 2 streams. Each stream has an opaque `streamId` (a random 128-bit value for each start).

The manager starts a stream for each new key in the plan and stops each stream that is not in the plan. A stream with no subscriber (R13) for 5 s stops its capture and stays in the plan with the state `idle`; the first new subscriber starts it again. Each 2 s, the manager runs `match_source` again for each stream in the state `notFound` or `ended`.

R9. The host sends a new wire message `captureStatus { revision, screens: [{ entityId, streamId, state, width, height }] }` on `/ws` to each renderer connection. It sends it when a value changes and one time after a renderer authenticates. The publisher never sends or receives it, and `Frame` does not change. It goes through the control queue. Each entry:
- `streamId`: the stream of the screen, or null;
- `state`: `starting`, `idle`, `live`, `paused` (the window is minimized, on another Space, or fully off screen), `ended` (the window closed), `notAllowed`, `notFound`, `permissionNeeded`, `unsupported`, or `failed`;
- `width` and `height`: the encoded size, or 0.

The TypeScript and Rust wire schemas check it (at most 2 entries with a non-null `streamId`, at most 16 entries, unique entity IDs). A scene without a capture screen sends `captureStatus` with an empty list one time and then nothing. `app_status` gets `captures: [{ entityId, state }]`, without names or titles.

### Platform adapter

R10. `capture/adapter.rs` defines the trait `CaptureAdapter`:
- `inventory() -> Result<Inventory, CaptureError>`: displays and windows for R6 and R7;
- `start(target, StreamConfig) -> Result<StreamHandle, CaptureError>`: a running capture and encode that sends `EncodedChunk { key, timestamp_us, data }` and one `DecoderConfig { codec, description, coded_width, coded_height }` before the first chunk and after each size change into a bounded channel, and `StreamEvent::Paused`, `Resumed`, `Ended`, or `Failed(String)`;
- `request_key(handle)`: the adapter encodes the last captured image again as a key frame at once, also when the content did not change.

The adapter encodes the last image again at least each 1 s while the content does not change, so a stream always has a recent chunk. Timestamps increase strictly in one stream. After a size change, the first chunk is a key frame.

`StreamConfig`: at most 1920 × 1080 (scaled down, aspect kept, even sizes), 30 frames a second, `cursor`. `CaptureError`: `PermissionNeeded`, `NotFound`, `Unsupported`, `Failed(String)`.

R11. The macOS adapter (`capture/macos.rs`, `cfg(target_os = "macos")`):
- ScreenCaptureKit: `SCShareableContent` for the inventory, `SCContentFilter` with one display and `excludingApplications` set to the OpenSekai application (so windows that open later are also excluded) or one window, and `SCStream` with `showsCursor` from the config, `minimumFrameInterval` 1/30 s, BGRA or 420v, and the scaled size.
- VideoToolbox: one `VTCompressionSession` for each stream. H.264 Main profile, level 4.1 or lower, `RealTime` true, `AllowFrameReordering` false, a key frame at least each 2 s, an average bit rate of 12 Mbit/s for 1080p (scaled with the pixel count). The `avcC` from the format description is the `description`. The chunks are AVCC (length-prefixed), as WebCodecs expects with a `description`.
- The adapter keeps the last `CVPixelBuffer` for `request_key` and the 1 s repeat. A window resize gives a new encoder session, a new `DecoderConfig`, and a key frame. A minimized or hidden window gives `Paused`; a stream stop for a closed window gives `Ended`; another stream error gives `Failed`.
- A TCC denial gives `PermissionNeeded`. The adapter calls `CGRequestScreenCaptureAccess` at most one time in an app run, from the first `capture_source_list` call.
- The bindings are `objc2` crates with exact versions, under the macOS target table, as `gilrs` and `midir` are.

R12. Linux and Windows get a stub adapter. `inventory()` and `start()` return `Unsupported`. A test adapter (`capture/fixture.rs`, behind the cargo feature `capture-fixture`, which only tests enable) has one display named `Fixture display`. It replays `fixtures/capture/h264-main.json` and `h264-main.bin` (Operation 1) at 30 frames a second in a loop with timestamps that keep increasing across loops. On `request_key` it sends the next key frame of the file at once.

### Transport

R13. The loopback service adds the WebSocket route `/capture`:
- The upgrade uses `headers_allowed` (Host and Origin), as `/ws` does.
- The first message is text, at most 512 bytes, within 2 s: `{ kind: 'captureAuth', token, outputId, streamId }`. The token is the token of a renderer connection descriptor (role `renderer`), and a `/ws` renderer connection with the same token and `outputId` must be open. Another role, a bad token, no such `/ws` connection, or an unknown `streamId` closes the socket with close code 4401 or 4404. No token goes into the URL.
- A stream has at most 4 subscribers, and the host at most 8 in total. A subscription over a limit closes with 4429. A second subscription of one renderer connection to one stream replaces the first.
- The host keeps the latest `DecoderConfig` and the latest key frame of each stream. It answers with one text message `{ kind: 'captureConfig', codec, description (base64), codedWidth, codedHeight }`, then the cached key frame, then the live chunks. It sends `captureConfig` again after each size change.
- Then each chunk is one binary message: byte 0 is the flags (bit 0 = key frame), bytes 1 to 8 are the timestamp in µs (u64, big-endian), and the rest is the AVCC chunk. One message is at most 4 MiB.
- Each subscriber has a queue of at most 8 chunks. When the queue is full, the host drops the queue and each later chunk until the next key frame, and calls `request_key` (at most one time each 250 ms for one stream). A slow subscriber never slows the capture or another subscriber.
- A subscriber whose socket write stays blocked for 5 s is closed. The socket closes when the stream stops, and when the `/ws` connection of the renderer closes.

The `/ws` route, its queues, and its message limits do not change.

### Renderer

There are two renderer instances: the OBS page and `preview_main` in the Editor window.

R14. `renderer/src/capture-screen.ts`:
- The instance opens one `/capture` socket for each `streamId` in the latest `captureStatus` that a visible screen uses with the state `starting`, `idle`, `live`, or `paused`. Screens with one `streamId` share the socket, the decoder, and the texture. It closes the socket when no visible screen uses the stream, when the stream leaves those states, and when the renderer is disposed.
- One `VideoDecoder` for each socket, with `optimizeForLatency: true` and `hardwareAcceleration: 'no-preference'`. Before `configure`, `VideoDecoder.isConfigSupported` must return `supported: true`. Otherwise the screen fails with `Capture codec not supported`.
- Each `captureConfig` configures the decoder again (after `isConfigSupported`), and the quad aspect follows the new size.
- The decoder keeps only the newest `VideoFrame`. Each older frame is closed at once. When `decodeQueueSize` is more than 4 above the hold depth of the decoder, the instance drops chunks until the next key frame. The hold depth is the largest `decodeQueueSize` at the first 8 outputs after each `configure`, at most 30; before the first output it is 30 (one key frame interval). After the first 8 outputs it stays fixed, so a slow decoder cannot raise the limit. A decoder that holds no chunk keeps the limit of 4. (Changed in the implementation: in headless Chromium, the first output came only after 11 queued chunks while the first shader compile blocked the main thread, and the plain limit of 4 dropped each delta frame, so the screen stopped changing.)
- On each applied renderer frame, the instance uploads the newest decoded frame one time, if it is new. WebGL 2 uploads the `VideoFrame` with `texImage2D`. WebGPU uploads one `ImageBitmap` made from the `VideoFrame` (the B29 path). Operation 4.1 checks both paths.
- The quad follows B28 R11 and R14: 1 m high, `width / height` m wide from the decoded size, unlit, `toneMapped: false`, `colorSpace` sRGB, opaque, no shadows, double-sided with the B28 front and back rule.
- While no frame is decoded, the quad does not draw. A screen in a state other than `live` draws nothing; in `paused` the decoder keeps running, but the quad does not draw, so an old image of a hidden window does not show.
- A decoder `error` closes the socket and opens a new one after 1 s, at most 3 times for one content value of the screen. Then the screen fails with `Capture failed`.
- Without `VideoDecoder` (no secure context or an old browser), the screen fails with `Capture not supported in this view`. Each instance reports in its renderer diagnostics, one time at start, whether `VideoDecoder` exists and whether `isConfigSupported` is true for `avc1.4d0029` at 1920 × 1080. So the OBS CEF result is visible in `app_status` without a capture.
- `preview_main` closes its sockets when its pump stops (the Preview toggle or the Assets tab) and opens them again when it starts. The OBS page never closes them for the Editor state.
- `cameraScreenshot` draws the current texture. It does not wait for a frame.

R15. The frame warnings are `Capture: <message>`, with these messages:
- `notAllowed`: `Choose the source again`.
- `notFound` and `ended`: `Source not found`.
- `paused`: `Source hidden`.
- `permissionNeeded`: `Screen Recording permission needed`.
- `unsupported`: `Capture not supported on this platform`.
- `failed`: `Capture failed`.
- the renderer failures of R14.

The Inspector shows the `preview_main` message. An OBS-only failure is in the `output_main` frame acknowledgment warnings, so it is in `app_status` outputs and in the Assets list warnings.

R16. A capture screen is a viewport pick target, and the transform gizmo moves, rotates, and scales it (as B28 R16).

### Editor

R17. The Inspector **Screen** section **Content** select adds **Display** and **Window** after **Video** (and after **Web page** when B30 is merged).
- Display and Window each show a **Source** select. Its options come from `capture_source_list`, filtered by the kind, with the `label` of each entry. The list loads when the select opens and when the Content changes. The empty option is `Choose display…` or `Choose window…`.
- A saved source that is not in the list shows its saved description (the name, or `<app> — <title>`) with `Source not found`.
- A saved source in the state `notAllowed` shows its description and an **Allow** button. **Allow** calls `capture_source_allow` with the saved source.
- A `capture_source_list` error shows the error text under the select. `Screen Recording permission needed` has an **Open Settings** button that opens the Screen Recording page of System Settings (`x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`) through a new editor-only command `open_capture_settings` (no argument; Rust API of `tauri-plugin-opener`).
- **Show Cursor** (checkbox) sets `cursor`.
- A Content change to Display or Window sends `setScreenCapture` with that `target`, `source: null`, and `cursor: true`. A change between Display and Window clears the source; this is intended, because a display is not a window. A source choice first calls `capture_source_allow`, then sends `setScreenCapture`. Display and Window are disabled at the capture screen limit, unless the screen has capture content.
- `model.ts` gets `setScreenCapture` next to `setScreenVideo`.
- Duplicate (`budgetFull` in `Hierarchy.svelte`) is disabled for a capture screen at the limit.
- The Inspector reset (B17) covers Content (default Image) and Show Cursor (true). The section index covers the section.

R18. The three editor-only commands (`capture_source_list`, `capture_source_allow`, `open_capture_settings`) are in each place that `import_video` is (B29 R3): `build.rs`, the autogenerated permission files, `capabilities/main.json`, `generate_handler!`, the exact permission list test, and the ports trait in `bootstrap.rs`. They take and return small JSON values. No pixel data goes through Tauri IPC. The commands are for the `main` window only; no remote page or frame (for example a B30 web page frame) gets a capability for them.

### MCP and files

R19. MCP `scene_patch` accepts `createEntity` with a capture screen and `setScreenCapture`. Its description says that only a source that the operator chose in the editor in this run captures, and that another source shows `Choose the source again`. There is no MCP source list. `app_status` returns `captures`.

R20. Save As and Open keep each capture screen and its source. After Open, each capture screen with a source shows `Choose the source again` and an **Allow** button until the operator allows the source (R5). A source that the operator allowed earlier in this app run starts at once.

## E — Entities

- `CaptureSource`: `{ kind: 'display', name, ordinal } | { kind: 'window', app, title }`.
- `ScreenContent`: adds `{ kind: 'capture', target: 'display' | 'window', source: CaptureSource | null, cursor: boolean }`.
- `PatchOp`: `setScreenCapture { kind, entityId, capture: { target, source, cursor } }`.
- `WireMessage.captureStatus`: `{ revision, screens: [{ entityId, streamId, state, width, height }] }`, host to renderers only.
- `AppStatus.captures`: `[{ entityId, state }]`.
- `LIMITS.captureScreens` and `MAX_CAPTURE_SCREENS`: 2.
- Host: `AllowedSources`, `Inventory`, `PlatformTarget`, `PlannedStream`, `StreamConfig`, `EncodedChunk`, `DecoderConfig`, `StreamEvent`, `CaptureError`, `CaptureAdapter`.
- Wire: `captureAuth`, `captureConfig` (text) and the binary chunk message of R13.
- `InspectorSection`: the screen section adds the Display and Window Content options, Source, and Show Cursor.

## A — Approach

Keep platform code behind one adapter. The host owns capture and encode, because only native code can capture and only one encode is necessary. The renderers decode with WebCodecs, which CEF and WebKit both have. The stream is compressed, has its own socket and bounded queues, starts each subscriber from a cached key frame, and drops to the next key frame under load, so it cannot delay scene state or calls. The session stays the one authority for the scene; the capture status is host state in its own wire message. Only an operator action in the Editor window can allow a source, so an MCP client or a show file cannot start a desktop capture by itself.

## S — Structure

- `docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md`: the R1 exception.
- `packages/contracts`: `schema.ts` (`CaptureSourceSchema`, `ScreenContentSchema`, `PatchOpSchema`, the `captureStatus` wire message, `AppStatus.captures`, `LIMITS.captureScreens`, scene refine), `types.ts`.
- `crates/contracts`: the same in Rust.
- `fixtures/protocol/capture-sources.json`.
- `fixtures/capture/`: `h264-main.bin` (AVCC chunks), `h264-main.json` (config and chunk index), `README.md` (the ffmpeg commands), made by `scripts/make-capture-fixture.sh`.
- `apps/desktop/src-tauri/src/capture/` (new): `mod.rs` (manager), `plan.rs` (`capture_plan`, `match_source`), `allow.rs`, `adapter.rs`, `macos.rs`, `stub.rs`, `fixture.rs`, `transport.rs` (subscriber queues and the binary message).
- `apps/desktop/src-tauri/src/service/mod.rs`: the `/capture` route, the `captureStatus` message, `app_status.captures`.
- `apps/desktop/src-tauri`: `lib.rs`, `bootstrap.rs`, `build.rs`, permission files, `capabilities/main.json`, `Cargo.toml` (macOS `objc2` crates), `Info.plist` usage text if the bundle needs one.
- `packages/browser-client`: an `openCaptureSocket(descriptor, streamId)` helper and the `captureStatus` stream.
- `packages/renderer`: `capture-screen.ts` (new), `screen.ts` (shared quad), `renderer.ts` (objects, pick targets, warnings, pump close).
- `apps/desktop/src`: `bootstrap.ts`, `editor/model.ts`, `editor/inspector-sections.ts`, `editor/property-defaults.ts`, `components/ScreenCaptureFields.svelte` (new), `components/ScreenContentField.svelte`, `components/Inspector.svelte`, `components/Hierarchy.svelte`, `EditorApp.svelte`.
- `apps/mcp/src/server.ts`: descriptions.
- `ARCHITECTURE.md`: the process diagram (capture adapter), the workspace map, a new **Capture path** section, and the output path.

## O — Operations

1. **Fixture.** `scripts/make-capture-fixture.sh` makes a 2 s, 320 × 180, 30 frames a second H.264 Main stream with libx264 (`-tune zerolatency -bf 0 -g 30`), with a solid color that changes each 0.5 s (red, green, blue, white), and writes AVCC chunks and their index. The file is at most 200 KB. The tests do not run ffmpeg.
2. **Contracts.** Schemas, types, the Rust mirror, the source fixture, and tests for R2, R3, the limit by each path, and the frame and status fields.
3. **Host.**
   - Unit tests for `match_source` (name and ordinal, exact title, the single-window fallback, two windows of one app, no match) and `capture_plan` (grouping, `notAllowed`, hidden screens, the 2-stream limit, the `cursor` merge).
   - Unit tests for `normalize_capture_text` against the shared fixture.
   - Unit tests for the allowed set (the Tauri command allows; `open_show`, `sceneReplace`, and `scenePatch` do not; the 16 limit).
   - Unit tests for the subscriber queue (the full queue drops to the next key frame and calls `request_key`; the 250 ms limit; the cached key frame for a new subscriber; the subscriber limits).
   - An integration test at the socket boundary (reason: the route, auth, and binary framing are a protocol boundary), with the `capture-fixture` feature: start the service with the fixture adapter, connect a renderer `/ws` and a `/capture` socket with tokio-tungstenite, and check: `captureStatus`, the config, the first chunk is a key frame, the chunk order and increasing timestamps across a loop, a bad Origin is refused, a bad token, an operator token, and a token without a `/ws` connection close with 4401, an oversized first message closes, a fifth subscriber closes with 4429, a blocked reader does not stop a second reader, and the socket closes when the screen is deleted.
   - The permission list test.
4. **Renderer.**
   1. Spike first. In headless Chromium on a `http://127.0.0.1` page, decode the fixture with `VideoDecoder` and draw it on a quad with WebGL 2 and WebGPU (software adapter). The check needs real decoded frames, not only `isConfigSupported`. The center pixel matches the browser's own 2D canvas draw of the same `VideoFrame` within 24 on each channel, and the nearest nominal color is the expected one. When the browser cannot decode H.264, the result is unknown, not a pass. Record each backend result.
   2. Unit tests: the binary message parse, the newest-frame rule, the drop to key frame above the hold depth (R14), the retry cap, and the R15 messages.
   3. A headless check with a stub `/capture` server that sends the fixture (the same bytes as the host test): the screen shows the four colors in order, two screens on one stream use one socket, a second `captureConfig` with a new size changes the quad aspect, a `paused` screen draws nothing, a hidden screen closes its socket, and a decoder error gives a retry and then `Capture failed`.
5. **Editor.** The Content options, the Source select and its states, Show Cursor, the limits, the reset values, and the allow-then-patch order, with unit tests for the pure parts. A headless browser check of the flow with a stubbed `capture_source_list`, where it runs without a GPU.
6. **MCP.** Descriptions, and a `scene_patch` test that creates a capture screen with a source that is not allowed and reads `notAllowed` in `app_status`.
7. **macOS check (accept:local).** Use the local QA flow: the OpenSekai MCP server, computer use, and the local OBS WebSocket with an isolated OpenSekai test source. Record the backend, the quality profile, the fixture revision, the commit, and the macOS and OBS versions. Keep app timing and OBS timing separate.
   - First: the Editor window has `VideoDecoder` (secure context) and decodes the stream, and the OBS page diagnostics say `VideoDecoder` is supported. If not, stop and report it.
   - The first Source list asks for the Screen Recording permission. A denial shows `Screen Recording permission needed` and Open Settings opens the right page.
   - Display capture: the OBS page shows the display; the Editor window is not in it.
   - Window capture: choose a window, then move it, resize it, cover it with another window, minimize it (`Source hidden`, nothing drawn), and close it (`Source not found`). Record what the OBS output shows in each case.
   - Static content: a window that does not change shows in a new OBS source within 1 s.
   - Latency: a change on the source shows in the OBS page within 100 ms (median of 10, for example a stopwatch window), measured at 1920 × 1080.
   - Cost: the benchmark scene with one capture screen keeps its frame rate within the benchmark tolerance. Record the CPU of the app and of OBS with and without the capture screen.
   - Minimize the Editor window for 30 s: the OBS page keeps the capture live.
   - Save As, quit, start, Open: the screen shows `Choose the source again`; **Allow** starts the capture. An MCP `setScreenCapture` with a source that is not allowed shows `Choose the source again`.
8. **Records.** Evidence in `docs/evaluation/capture-screens.md`, `docs/warudo-parity.md` (MED-04 stays unchecked until the macOS check passes; the line names the remaining parts: the Windows adapter, window audio, and the MED-05 fields), the architecture design (R1), and `ARCHITECTURE.md`. The implementation opens follow-up issues for the Windows adapter and window audio and keeps #62 open until they are done or split.

## N — Norms

- Use `@oshi-connect/ui` controls.
- Keep UI copy to the labels in R6, R15, and R17.
- Write prose in ASD-STE100.
- Use pnpm.
- Keep functional TypeScript and plain data. Keep the pure plan and match functions free of platform calls.
- Keep platform code in the adapter. No other module calls ScreenCaptureKit or VideoToolbox.

## S — Safeguards

- Do not send pixels, chunks, or titles through Tauri IPC. Do not put a token in a URL.
- Do not send raw frames, JPEG, or PNG on the capture route. Do not add a stream to `/ws`.
- Do not start a capture for a source that the operator did not allow in the Editor window in this run. An opened show never allows a source.
- Do not capture an OpenSekai window.
- Do not put a window title or a display name in the capture status, a log, or `app_status`. Do not send the source list to MCP.
- Do not change the look or the cost of a scene without a capture screen: no capture runs, no `/capture` socket opens, and `Frame` does not change.
- Do not write captured frames to disk, except through `cameraScreenshot`.
- Do not add a vendor service or a native decoder in the renderer.
- Do not claim these from this slice: a macOS capture result, latency, cost, Windows, audio, or MED-05 fields.
- An old build does not open a show with a capture screen. Record this in the evidence.
