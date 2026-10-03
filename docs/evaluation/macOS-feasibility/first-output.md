# First macOS output check

Date: 2026-10-03. Status: integration in progress. This is a partial checkpoint. It does not pass the performance gate.

The bundled desktop app starts the local service and one scene worker. The preview has a separate output ID. It consumes evaluated frames at a maximum of 15 FPS and half resolution. OBS uses the bundled output page and registered assets through local HTTP and WebSocket connections. No production image stream crosses Tauri IPC.

## Verified scope

- The debug app launched from /private/tmp with an explicit local fixture manifest. Bundled renderer files and registered VRM/GLB bytes loaded.
- The desktop preview displayed the performer and props. The version command and scoped bootstrap command worked.
- The native service has real loopback tests for roles, origins, request IDs, reconnect, capture pairing, queue limits, and shutdown.
- A fresh OBS WebGL2 browser source displayed the colored VRM, GLB reference, moving marker, and diagnostic strip at 1920 by 1080. The top-right source pixel was transparent.
- Two OBS source captures had diagnostic ticks 1741 and 1742. This proves some motion. It does not prove 60 FPS or current-state delivery.
- OBS was idle before each test. The test used new scene and source names. The original scene was restored and only owned test objects were removed.

## Issues found

The first launch failed because shared client timers used the wrong Window receiver. A unit regression reproduced the error. The corrected client passed 12 tests and the desktop launched.

The renderer assigned canvas dimensions on each frame. A regression verified the extra resize. The renderer now sets dimensions only when physical size changes. Its 13 tests pass.

The first OBS WebGPU capture had zero RGBA values in every pixel. A fresh WebGL2 source later displayed the fixture. After the camera-lifetime correction, a fresh release WebGPU source also displayed the colored fixture. The repeated timing gate remains pending.

The desktop showed white avatar textures on both backends. Installed GLTFLoader code creates local blob URLs for embedded images. ImageBitmapLoader fetches those URLs. The desktop policy allowed blob images but did not allow blob connections. The policy now allows local blob fetches. A later debug launch displayed the colored avatar textures correctly. The release WebGPU preview also displayed the correct texture colors.

The live OBS image was far behind the scene worker. A camera command timed out and its revision changed later. The command was not replayed. A passive renderer connection received 103 frames in two seconds without GPU work. Publisher-routed inspection took about 1950 ms. Native status calls were fast. These results exposed state backlog beyond the logical queue and silently rejected browser control replies. Reviewed fixes bound client frame bytes and report failed control sends. The delivery-credit correction passed independent review and 19 real network tests. It alone did not remove renderer stalls.

The renderer also constructed a new PerspectiveCamera for every frame. Three.js render contexts and light lists use camera identity. A new unit regression failed because identity changed. The corrected renderer keeps one camera and applies the selected lens and transform. All 14 renderer tests passed. Live WebGL2 CPU work fell from about 800–2800 ms to about 1–3 ms for this small scene. Two OBS diagnostic ticks advanced from 3351 to 3447 over about 1.5 seconds. The camera command succeeded and the next image identified revision 1 and camera_close. These samples do not establish a percentile or performance gate.

The release bundle launched outside the checkout. A new OBS WebGPU source displayed the colored fixture and transparent background pixels. Its ticks advanced from 4934 to 5029 over about 1.5 seconds. A camera command succeeded. The desktop inspector rejected NaN without a revision change, accepted persistent position [0.25, 0, 0], and changed visibility. OBS captures identified revisions 2 and 3; the second image contained the props and no avatar. The desktop camera selector then updated both output cameras to Wide at revision 6.

A real minimize action was issued in the earlier debug WebGL2 smoke check. OBS ticks advanced from 14067 to 14163. The timed visible/minimized/restored checks and separate recording remain pending.

## Checks

The combined checkpoint passed 62 JavaScript unit tests, workspace TypeScript/Svelte checks, 36 Rust tests, desktop Clippy with warnings denied, and a local debug app build. Later client flow tests passed 19 tests. These are source and boundary checks. They do not pass the final visual or timing gate.

## Remaining work

Packaged Origin, panel resize and keyboard checks, native evidence, and the release MCP round trip have evidence. Complete source lifecycle, minimized recording, soak, and final visual review. The qualifying timing repeats are recorded below. Clipboard testing is pending. Minimum-hardware and concert acceptance remain separate.

The packaged debug app at source 99aabef accepted three actual WebSocket connections with Origin tauri://localhost. The full official MCP client loop then exercised all nine tools. Capture 68f95685-74c3-46df-a859-d6b72413f0ef identified output_main, revision 4, camera_close, WebGPU, tick 4374, and sequence 3959. Its 173124 bytes matched SHA-256 6c723fbf0188c625607e635be02b75feaade9c0bd806ac49e1d4f27ac6f9bd49. The benchmark was started, inspected, cancelled, and read through its registered summary resource. The later packaged release also passed this loop; see [MCP round trip](mcp-roundtrip.md).

The first formal run at app source 75de982 used scheduled minimize at 60002 ms and restore at 105001 ms. It completed with 0/7229 OBS render skips, CPU p95 4.2 ms, and no stale output periods. However, native interval p95 was 111 ms and maximum was 122 ms. It fails the 100 ms gate. Its 4596 distinct ACK samples do not establish 60 distinct poses per second. Early smoke checks did not preserve the required minimized interval.

The installed Tauri/Wry code supports an explicit background throttling policy. The main WebView now requests disabled throttling and the macOS minimum is 14.0, where that public WebKit policy is available. This was a targeted hypothesis; the subsequent policy retest below failed the minimized gate. Windows background scheduling remains pending because this option is unsupported there. Source: [Tauri configuration](https://v2.tauri.app/reference/config/#backgroundthrottling).

The policy retest at source 953ab9b also failed: run 9338c8b1 had maximum interval 121 ms and p95 111 ms. CPU p95 was 3.9 ms, with 0/7228 OBS render skips and no stale periods. The worker emitted 9–10 frames per second while minimized, while ticks tracked elapsed time. A bounded read-only WebSocket wake experiment kept emission at 56–59 frames per second while minimized. The native clock correction was specified before implementation and is implemented at c5e107a; its timing checkpoint is recorded below while full feasibility acceptance remains pending. These experiments do not pass the formal gate.

At source 953ab9b, 163 JavaScript tests and 66 Rust tests passed. One licensed-fixture Rust test was ignored in the standard suite. Workspace checks had no Svelte errors or warnings. Clippy passed with warnings denied.

## Dated editor observations

Observed on 2026-10-03 in the packaged release: pointer and keyboard resizing changed the Scene and Inspector panel widths to 237 and 325 pixels. Home followed by Down selected the performer; End selected the close camera through keyboard navigation. The inspector rejected NaN with revision 1 unchanged. Position [0.25, 0, 0] committed revision 2; hide committed revision 3 and restore revision 4. The UI Wide selection set both output cameras at revision 6. These observations establish the exercised interactions only. Clipboard and full Task 11 interaction/recovery acceptance remain pending.

## Native-clock timing checkpoint

At source c5e107a, three prescribed runs each on WebGPU and WebGL2 passed the timing thresholds. WebGPU maximum intervals were 39/30/33 ms and CPU p95 was 3.3/3.2/3.2 ms. WebGL2 maximum intervals were 28/28/28 ms and CPU p95 was 3.2/3.0/3.1 ms. The only skipped frames were 2/7229 in WebGPU run 71551038; all other runs had zero render skips. See [results](results.md) for exact action offsets and the artifact index for issued/completed timestamps. The two earlier formal failures remain retained. Separate recording, soak, source lifecycle, clipboard, and final visual review remain pending. The runtime Wide Y=1 framing probe is indexed; it does not correct or conceal the documented default-preset crop.
