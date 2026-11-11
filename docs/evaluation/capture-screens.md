# Capture screens check

Date: 2026-11-10. Scope: MED-04 slice 1, bundle B31 ([#62](https://github.com/danirukun/opensekai/issues/62)). Contract: [capture screens](../../spdd/prompt/2026-11-09-capture-screens.md). Base commit: a78b27a plus the B31 implementation branch (last code commit before this record: 5cf2937).

Platform: Linux cloud container (Ubuntu, x86_64, no GPU, no macOS, no OBS). Node 26.10.0, pnpm 12.8.1, Playwright Chromium (headless) from `/opt/pw-browsers`. Setup `gpu:` line: WebGPU on SwiftShader (device true), WebGL 2 on ANGLE Mesa llvmpipe. Quality profile: `production_v1` (renderer checks).

This check proves the contracts, the session operation, the host plan, the allowed sources, the `/capture` route with the fixture adapter, the renderer decode and draw in headless Chromium on both backends, the Editor flow with stubbed commands, and MCP. It does not prove a real capture: the macOS adapter (ScreenCaptureKit and VideoToolbox) was type-checked for `aarch64-apple-darwin` in a separate crate with the same crate versions, but it was never built into the app or run. The Editor window on WebKit, the OBS Browser Source (CEF), latency, cost, and Windows are unknown.

## Contracts and session (verified)

| Check | Test | Result |
| --- | --- | --- |
| The text rule and the source rule against the shared vectors (`fixtures/protocol/capture-sources.json`) on each side (R2) | `packages/contracts/test/capture-screen.test.ts`, `crates/contracts/tests/capture_screen.rs` | Pass |
| 2 capture screens, the third fails; the source kind must match the target; `setScreenCapture`; `captureStatus` limits; `app_status.captures` without names; the `videoDecoder` report (R2, R3, R9) | same files | Pass |
| Capture content replaces and is replaced by image and web content; `NOT_FOUND`; `INVALID_INPUT` for a non-screen, a kind mismatch, and a third capture screen by `setScreenCapture` and `createEntity` (R3) | `packages/session/test/screen-patch.test.ts` | Pass |

## Host (verified with the fixture adapter)

| Check | Test | Result |
| --- | --- | --- |
| `match_source` (name and ordinal, exact title, the single-window fallback, two windows of one app, no match) and `capture_plan` (grouping, `notAllowed`, hidden screens, the 2-stream limit, the cursor split) (R7, R8) | `capture::plan` unit tests (11) | Pass |
| The allowed set: only the editor command allows; 16 sources, the oldest goes out (R5) | `capture::allow` unit tests (2) | Pass |
| Subscriber queue: a full queue drops to the next key frame and asks for a key frame at most each 250 ms; the cached key frame for a new subscriber; the limits (R13) | `capture::transport` unit tests (7) | Pass |
| Review fixes: no adapter call under the manager lock; an oversized chunk makes a new subscriber wait for the next key frame; a refused subscription replaces nothing | `capture::tests` (7) | Pass |
| The `avcC` builder against the fixture description (R11) | `capture::adapter` unit test | Pass |
| Socket boundary (reason: the route, the auth, and the binary framing are a protocol boundary): `notAllowed` and no capture for a source that is not allowed, then `live` after the allow; one empty status for a scene without capture screens; `captureStatus` and `app_status` without the display name; the config, the first chunk is a key frame, the order and increasing timestamps across a loop; a bad Origin is refused; a bad token, an operator token, and a token without a `/ws` connection close with 4401; an oversized first message closes; a fifth subscriber closes with 4429; a reader that reads nothing does not stop a second reader; the socket closes when the screen is deleted; an idle stream starts again for a new subscriber (R5, R8, R9, R13) | `cargo test -p opensekai-desktop --features capture-fixture --test capture_integration` (4 tests, 5.3 s) | Pass |
| The exact permission list with the three editor commands (R18) | the permission list test in `cargo test --workspace` | Pass |

The fixture stream is too slow to block a socket write, so the 5 s blocked-write close and the full-queue drop at the socket are proved by the unit tests only.

## Renderer (headless Chromium)

`capture-screens/headless-check.mjs` runs one real renderer instance with a stub capture host that sends the fixture bytes ([WebGL 2 output](capture-screens/headless-check-webgl2.txt): 18 pass, 0 fail, 0 unknown; [WebGPU output](capture-screens/headless-check-webgpu.txt): 18 pass, 0 fail, 0 unknown).

Operation 4.1 spike: go on both backends. The `avc1.4d0029` 1920 × 1080 probe is supported, and 60 of 60 fixture frames decode. The center pixel of the drawn quad against the browser's own 2D canvas draw of the same `VideoFrame`:

| Frame | Expected | WebGL 2 screenshot | 2D canvas reference |
| --- | --- | --- | --- |
| 7 | red | [255, 24, 0] | [255, 24, 0] |
| 22 | green | [0, 216, 0] | [0, 216, 2] |
| 37 | blue | [0, 15, 255] | [0, 14, 253] |
| 52 | white | [255, 255, 255] | [255, 255, 255] |

WebGPU (`ImageBitmap` upload) gives the same values within 24 on each channel ([image](capture-screens/spike-blue-webgpu.png)).

Operation 4.3 on both backends: the four colors in order; two screens on one stream use one socket ([image](capture-screens/two-screens-webgl2.png)); a paused screen draws nothing, warns `Capture: Source hidden`, and keeps the socket; hidden screens close the socket; a second `captureConfig` at 240 × 240 changes the quad aspect from 16:9 to 1:1; the stream starts with a key frame; a decoder error retries 3 times 1 s apart, then `Capture: Capture failed`; a scene without a capture screen opens no socket; `captureAuth` is the first message and the URL has no token; the renderer reports `videoDecoder: supported`.

Run notes: the first run failed the color and aspect checks. The cause was the R14 drop rule (fixed, see the contract change) and test timing. After the review fixes, one WebGPU run failed the aspect check while a Rust build used the CPU; a run of WebGPU alone passed 18 of 18.

Renderer unit tests (`packages/renderer/test/capture-screen.test.ts`, 13): the newest-frame rule, the drop gate with the hold depth, the retry cap, the R15 messages with the entity ID, the plan, sockets on pause, the codec failure, no `VideoDecoder`, a throw from the socket open, and the host message of a state without a socket. `packages/browser-client/test/capture.test.ts`: the binary message parse and `captureAuth` without a token in the URL.

## Editor (headless Chromium, stubbed commands)

`capture-screens/editor-check.mjs` ([output](capture-screens/editor-check.txt): 27 of 27 pass; [Inspector](capture-screens/editor-inspector-capture.png)): the Display and Window options after Video and Web page; a Content change sends `setScreenCapture` with `source: null` and `cursor: true`; the Source select filtered by kind; a saved source that is not in the list shows `Source not found`; a source choice calls `capture_source_allow` before `setScreenCapture`; a failed allow sends no patch; Allow in the state `notAllowed`; the permission error with Open Settings; Show Cursor; reset; the limit on the Content options and on Duplicate. Unit tests: `apps/desktop/test/capture-screen.test.ts`.

## MCP

`apps/mcp/test/screen.integration.test.ts` over real stdio: the `scene_patch` description, `createEntity` with a capture screen, `setScreenCapture`, and a refused kind mismatch and third capture screen. The MCP tests run against a TypeScript session, so `notAllowed` in `app_status` is proved by the host socket test above.

## Old builds

A show with a capture screen does not open in a build before B31: the old `ScreenContent` has no `capture` member, so the show check fails with `INVALID_INPUT`.

## Not verified (owner check on macOS, contract Operation 7)

- The Editor window has `VideoDecoder` and decodes the stream; the OBS page `app_status` output reports `videoDecoder: supported`.
- The Screen Recording permission request, the denial message, and Open Settings.
- A real display capture without the Editor window in it; the window cases (move, resize, cover, minimize, close).
- A static window in a new OBS source within 1 s; latency (100 ms median gate); cost with the benchmark scene; a minimized Editor window for 30 s.
- Save As, quit, start, Open, then Allow; an MCP `setScreenCapture` with a source that is not allowed.
- The review fixes in the macOS adapter: release on each stop path, no lost config or state event under load, a late start, and the exclusion while OpenSekai has no window on screen.
