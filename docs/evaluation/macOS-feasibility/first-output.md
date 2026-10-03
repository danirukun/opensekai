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

The first OBS WebGPU capture had zero RGBA values in every pixel. A fresh WebGL2 source later displayed the fixture. WebGPU OBS presentation remains unverified.

The desktop showed white avatar textures on both backends. Installed GLTFLoader code creates local blob URLs for embedded images. ImageBitmapLoader fetches those URLs. The desktop policy allowed blob images but did not allow blob connections. The policy now allows local blob fetches. The corrected desktop material check remains pending.

The live OBS image was far behind the scene worker. A camera command timed out and its revision changed later. The command was not replayed. A passive renderer connection received 103 frames in two seconds without GPU work. Publisher-routed inspection took about 1950 ms. Native status calls were fast. These results exposed state backlog beyond the logical queue and silently rejected browser control replies. Reviewed fixes bound client frame bytes and report failed control sends. The native delivery credit correction remains under review.

## Checks

The combined checkpoint passed 62 JavaScript unit tests, workspace TypeScript/Svelte checks, 36 Rust tests, desktop Clippy with warnings denied, and a local debug app build. Later client flow tests passed 19 tests. These are source and boundary checks. They do not pass the final visual or timing gate.

## Remaining work

Apply and review the transport correction. Repeat the live material, camera, alpha, reconnect, and tick checks. Check the release bundle outside the checkout. Then complete MCP integration, editor panels, bounded evidence, minimized motion, and the timed smoke gate. Minimum-hardware and concert acceptance remain separate.
