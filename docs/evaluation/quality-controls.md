# Quality controls check

Checked 2026-10-16 in the Linux cloud container (Ubuntu 24.04, x86_64, no GPU) with the code at commit `ef74f71` (branch `claude/b8-quality-profiles`). The commit that adds this record changes only documentation. Contract: [quality controls](../../spdd/prompt/2026-10-16-quality-controls.md). Node 26.10.0, pnpm 12.8.1, rustc 1.93.1, three.js 0.180.0, HeadlessChrome 141.0.7390.37 (Playwright 1.56.1).

No macOS, OBS, WebGPU, or GPU result is claimed. Frame cost for each mode and profile is unknown.

## Renderer check (WebGL 2, software rasterizer)

Method. A scratch Vite page (not in the repository) called the real `createRenderer` from `packages/renderer/src` with `mode: 'force-webgl2'`. Chromium ran headless with SwiftShader (`--use-gl=angle --use-angle=swiftshader`). The frame was `makeSmokeFrame` reduced to the box mesh and the cameras. The box was turned 45° about Z so that its edges are diagonal. For each profile, one renderer drew the modes `none`, `fxaa`, `none`, `fxaa` in turn. After each frame, `renderer.capture()` gave the PNG, and the page counted the alpha values. `differ` is the number of pixels that differ by more than 32 in a channel from the first `none` image of the same renderer.

Raw output:

```
Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.37 Safari/537.36
performance_v1 none webgl2 performance_v1 1920x1080 partial 0 opaque 271584 clear 1802016 differ 0 corner [0, 0, 0, 0] centre [82, 159, 191, 255]
performance_v1 fxaa webgl2 performance_v1 1920x1080 partial 2948 opaque 270112 clear 1800540 differ 2948 corner [0, 0, 0, 0] centre [82, 159, 191, 255]
performance_v1 none webgl2 performance_v1 1920x1080 partial 0 opaque 271584 clear 1802016 differ 0 corner [0, 0, 0, 0] centre [82, 159, 191, 255]
performance_v1 fxaa webgl2 performance_v1 1920x1080 partial 2948 opaque 270112 clear 1800540 differ 2948 corner [0, 0, 0, 0] centre [82, 159, 191, 255]
production_v1 none webgl2 production_v1 1920x1080 partial 1476 opaque 271584 clear 1800540 differ 0 corner [0, 0, 0, 0] centre [82, 159, 191, 255]
production_v1 fxaa webgl2 production_v1 1920x1080 partial 4428 opaque 270112 clear 1799060 differ 2952 corner [0, 0, 0, 0] centre [82, 159, 191, 255]
production_v1 none webgl2 production_v1 1920x1080 partial 1476 opaque 271584 clear 1800540 differ 0 corner [0, 0, 0, 0] centre [82, 159, 191, 255]
production_v1 fxaa webgl2 production_v1 1920x1080 partial 4428 opaque 270112 clear 1799060 differ 2952 corner [0, 0, 0, 0] centre [82, 159, 191, 255]
preview_v1 none webgl2 preview_v1 960x540 partial 736 opaque 67344 clear 450320 differ 0 corner [0, 0, 0, 0] centre [82, 159, 191, 255]
preview_v1 fxaa webgl2 preview_v1 960x540 partial 2208 opaque 66612 clear 449580 differ 1480 corner [0, 0, 0, 0] centre [82, 159, 191, 255]
preview_v1 none webgl2 preview_v1 960x540 partial 736 opaque 67344 clear 450320 differ 0 corner [0, 0, 0, 0] centre [82, 159, 191, 255]
preview_v1 fxaa webgl2 preview_v1 960x540 partial 2208 opaque 66612 clear 449580 differ 1480 corner [0, 0, 0, 0] centre [82, 159, 191, 255]
logs []
```

Result.

- The acknowledgment names the profile, and the drawing buffer follows the profile scale (960 × 540 for `preview_v1`).
- With `none`, `performance_v1` (MSAA off) has 0 partial-alpha pixels, and `production_v1` (MSAA 4) has 1476. Thus the profile MSAA setting reaches the backend.
- With `fxaa`, partial-alpha pixels increase at the box edges (2948 more with MSAA off), and the corner pixel stays `[0, 0, 0, 0]`. The transparent background stays transparent.
- A change from `fxaa` back to `none` gives the same image as the first `none` frame (`differ 0`). The second `fxaa` frame gives the same counts as the first. The chain is released and built again without a change in output.

### SMAA (removed)

The first implementation also had SMAA. The same check gave `opaque 2073600, clear 0, corner [0, 0, 0, 255]` for SMAA with each profile: the whole output was opaque. The three.js r180 `SMAANode.updateBefore` sets the clear color to opaque black, and the scene pass that feeds it renders in that state. Two workarounds (alpha from the unfiltered pass; SMAA on the pass texture before the color transform) gave the same result. SMAA was removed from the contract.

## Editor controls (headless Chromium)

Method. A scratch Svelte page mounted the real `OutputControls` and `Inspector` components with a real `createEditorModel` on a real `createSession` (smoke scene, `camera_wide` selected). Playwright used the controls.

Raw output (URLs shortened at the hash):

```
aaOptions: None, FXAA        aaInitial: none
qualityOptions: Production, Performance, Preview
urlProduction:  http://127.0.0.1:4321/renderer/#%7B...
urlPerformance: http://127.0.0.1:4321/renderer/?quality=performance_v1#%7B...
copy label after a Quality change: "Copy OBS URL"
after Anti-aliasing = FXAA: session camera_wide.antiAliasing = fxaa, revision 1,
  patch {sceneId: scene_smoke, expectedRevision: 0, operations: [{kind: setCameraAntiAliasing, entityId: camera_wide, antiAliasing: fxaa}]}
after Anti-aliasing = None: revision 2
console errors: none
```

## Checks

| Command | Result |
| --- | --- |
| `pnpm check` | 8 packages and scripts; svelte-check 0 errors, 0 warnings |
| `pnpm test:unit` | 697 passed (104 files), 0 failed |
| `pnpm test:integration` | 24 passed (8 files), 0 failed |
| `cargo test --workspace --no-fail-fast` | 216 passed, 0 failed, 1 ignored (pinned fixture benchmark, as in the baseline) |
| `cargo clippy --workspace --all-targets` | clean |
| `cargo fmt --all -- --check` | no difference in the files this change touches; baseline differences remain in other files |

The shared vectors gained two valid and three invalid cases after the full run; the contract tests were run again (TypeScript 148 passed, Rust `vectors` 9 passed).

## Remaining gaps

OBS alpha with FXAA over dark, light, and checker backgrounds; the visual result on hair and alpha-tested materials; WebGPU; frame cost of each mode and profile on macOS; the profile in benchmark run records; SMAA; TAA; Windows.

## macOS acceptance check

Checked 2026-10-17 on macOS 27.0.1 (Apple M3 Pro, 36 GB, battery power) with the code at commit `315df98` (the app reports `OPENSEKAI_APP_COMMIT` 315df98). The app was the debug build from `pnpm dev:desktop`. It was not a release build. The renderer backend was WebGPU for `output_main` and `preview_main`. The scene was the user's "Demo Show": one user-supplied VRM avatar, one user-supplied environment, and two cameras. These files are not in the repository, so there is no fixture revision. OBS 32.2.2 (WebSocket 5.7.4) ran at 1920 × 1080 and 60 FPS. OBS did not stream or record.

OBS isolation. The user's existing browser source held the `output_main` renderer slot, and the app refuses a second renderer for the same output. With the user's approval, the test set that source's URL to `about:blank` for the test. It made an isolated scene `OpenSekai-B8-Test` with the browser source `OpenSekai-B8-Output` (1920 × 1080, 60 fps, shutdown off) and three composition scenes (dark, light, checker image under the source). After the test, it removed the test scenes and sources, restored the program scene, and wrote back the original source settings. A read-back of the settings was identical. The camera Anti-aliasing setting was set back to FXAA, as it was before the test.

Method. A CGEvent click helper operated the editor. The real stdio MCP server (`apps/mcp/src/cli.ts`) supplied `app_status`, `scene_inspect`, and `scene_patch`. OBS screenshots came from `GetSourceScreenshot`. The app was not in evaluation mode, so `capture_frame` and `benchmark_start` were not available.

| Step | Result | Evidence |
| --- | --- | --- |
| Select Camera Full; Inspector Anti-aliasing FXAA, then None | PASS | Scene revision 8 (`none`), 9 (`fxaa`), 10 (`none`) through `scene_inspect`. Preview crops: [None, FXAA, None](quality-controls-preview-none-fxaa-none.png). The FXAA crop has softer hair strands and table edges. The two None crops have the same crisp edges. |
| Editor minimized: motion continues | PASS | Both editor windows minimized. `output_main` tick went from 29548 to 29941 in about 6.6 s. Five OBS screenshots 1.2 s apart all differed (3054 to 5441 changed pixels at 960 × 540). The preview tick stayed at 29326, so the preview pauses while minimized. |
| Output Quality Performance, Copy OBS URL | PASS | The clipboard URL was `http://127.0.0.1:<port>/renderer/?quality=performance_v1#<descriptor>`. The descriptor has role `renderer` and output `output_main`. The button showed "Copied". |
| MCP `app_status` for `output_main` | PASS | `{"backend":"webgpu","cpuMs":2.1,"gpuMs":null,"qualityProfile":"performance_v1"}` with the isolated source connected. |
| OBS alpha with FXAA (environment off for this step) | PASS | Raw source with FXAA: 1933530 clear pixels and 9326 partial-alpha pixels of 2073600. With None: 1938505 clear and 0 partial (`performance_v1` has MSAA off). Over [dark](quality-controls-obs-dark-none-fxaa.png), [light](quality-controls-obs-light-none-fxaa.png), and [checker](quality-controls-obs-checker-none-fxaa.png) (None on the left, FXAA on the right; [full checker frame](quality-controls-obs-checker-fxaa-full.png)), the background is transparent and FXAA adds no halo. |
| Hair and outline edges | PASS, visual | FXAA smooths the hair strand edges. The dark outline along the hat edge shows as a dotted line on the light background in both modes. This is the outline geometry; FXAA does not add or remove it. The mean color of opaque pixels does not change: head region 108.8, 111.1, 136.4 (None) and 109.9, 111.8, 137.3 (FXAA). |

The environment was turned off only for the alpha step (`setCameraRenderEnvironment`) and turned on again before the frame cost runs.

### Frame cost (WebGPU)

Setup: environment on, editor minimized (preview paused), isolated OBS source active, user source blank. Each run had a 10 s warmup and a 45 s measurement. The matrix ran forward and then in reverse. These windows are shorter than the [benchmark contract](benchmark-contract.md) (30 s warmup, 120 s measurement, three repeats). The build is a debug build on battery power. Use these values to compare modes only, not as benchmark results.

App timing is the renderer `cpuMs` from the `output_main` frame acknowledgment: scene apply and render submission in the page, on the CPU. The test read `app_status` about every 100 ms, so each run has about 420 of about 2700 frames. GPU time is unknown: `gpuMs` is `null` on this backend. OBS timing comes from `GetStats`: the render-skipped delta, and `averageFrameRenderTime` read each second. That value is the OBS compositor render time. It does not include the browser page's own GPU work.

| Profile | AA | App samples | App cpuMs mean | p50 | p95 | max | Ticks | OBS skipped/total | OBS render ms mean | max | OBS FPS min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| performance_v1 | none | 418 | 2.04 | 1.9 | 2.9 | 3.8 | 2698 | 0/2707 | 0.76 | 0.89 | 60.0 |
| performance_v1 | fxaa | 413 | 2.06 | 2.0 | 3.1 | 4.2 | 2699 | 0/2707 | 0.64 | 1.02 | 60.0 |
| production_v1 | none | 418 | 2.15 | 2.2 | 3.2 | 4.0 | 2699 | 0/2707 | 0.51 | 0.60 | 60.0 |
| production_v1 | fxaa | 421 | 2.15 | 2.3 | 2.9 | 3.4 | 2693 | 0/2704 | 0.53 | 0.63 | 60.0 |
| production_v1 | fxaa | 422 | 2.20 | 2.5 | 3.0 | 3.5 | 2694 | 0/2702 | 0.58 | 0.69 | 60.0 |
| production_v1 | none | 420 | 2.01 | 2.1 | 2.8 | 3.2 | 2695 | 0/2706 | 0.58 | 0.69 | 60.0 |
| performance_v1 | fxaa | 422 | 1.76 | 1.5 | 2.8 | 3.5 | 2698 | 0/2706 | 0.53 | 0.74 | 60.0 |
| performance_v1 | none | 424 | 1.98 | 2.1 | 2.9 | 3.4 | 2699 | 0/2707 | 0.59 | 0.71 | 60.0 |

Result. Each run kept 60 FPS in OBS with 0 render-skipped frames, and each acknowledgment named the expected profile on WebGPU. The CPU-side cost of FXAA and of the profile is within the run-to-run spread (1.76 to 2.20 ms mean). This check does not show a difference. The GPU cost of FXAA and of MSAA 4 is unknown.

### Observation

The Output panel Quality select is local component state. After a change to another panel and back, it shows Production again. The copied URL is correct for the value that shows. This agrees with the contract (the select changes only the copied URL).

### Not verified on macOS

GPU frame time; a release build; contract-length benchmark windows and repeats; WebGL 2 on macOS; whether this avatar's hair uses alpha-tested or blended materials (not inspected); TAA; SMAA; Windows.
