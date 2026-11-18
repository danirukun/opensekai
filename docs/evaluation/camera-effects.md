# Camera effects check (B37)

Date: 2026-11-18. Contract: [camera effects](../../spdd/prompt/2026-11-13-camera-effects.md). Issue: #172 (CAM-15). Commit: `64948ba` on `claude/b37-camera-effects`, rebased on `main` at `0be52bc`.

GPU time: unknown.

## Full checks

These commands ran on macOS (Darwin 27.2.0, Apple silicon) in the B37 worktree, with the shared Cargo target. They do not start the app, a WebView, or OBS.

| Command | Result |
| --- | --- |
| `pnpm check` | Exit 0. svelte-check: 5882 files, 0 errors, 0 warnings. |
| `pnpm test:unit` | Exit 0. 266 files passed; 2486 tests passed, 1 skipped. |
| `pnpm test:integration` | Exit 1. 43 files passed, 1 failed, 3 skipped; 106 tests passed, 4 failed, 7 skipped. The 4 failures are in `scripts/prepare-tracking.test.ts`. This is the known baseline without the MediaPipe models. |
| `cargo fmt --all -- --check` | Exit 1. One difference, in `apps/desktop/src-tauri/src/recent_shows.rs`. B37 does not change that file. |
| `cargo clippy --workspace --all-targets` | Exit 0, 0 warnings (after `2590989`, which boxes the effects group). |
| `cargo test --workspace --no-fail-fast` | Exit 101. 57 test binaries; 611 passed, 1 failed, 2 ignored. The failure is `due_clocks_progress_under_sustained_control_without_credit_accumulation` in `clock_integration.rs` ("unsolicited frames accumulated credits: 2"), in two full runs on a machine with a load average of about 10. Alone, that test binary passed 3 of 3 runs. B37 and the merged `main` changes do not change the clock code. |

## Headless checks

The scripts are in [camera-effects/](camera-effects/). Each one makes its own test images. A stand-in for the host sends the frames of a real `@opensekai/session`, and each step is a `setCameraEffects` patch. The pixel tests are in [`pixels.mjs`](camera-effects/pixels.mjs).

Capture method: `page.screenshot` timed out at 1920 × 1080 on this Mac (the image-screens check has the same problem). The scripts use the renderer `captureRequest` instead. This gives a straight-alpha PNG of the output canvas. The frames stop during a capture, and a step passes only after two equal captures in sequence.

| Check | Backend | Result |
| --- | --- | --- |
| HC0 to HC7, OBS page ([log](camera-effects/headless-check.txt)) | WebGL 2 (`?backend=webgl2`) | 24 pass, 0 fail. HC4: the pixel blocks start at the top-left corner of the frame. |
| HC0 to HC7, OBS page, chain build only ([log](camera-effects/headless-check-webgpu.txt)) | WebGPU | 0 pass, 9 fail. Each step, the baseline without effects too, has the warning "Pipeline compile failed", and the page reports GPU validation errors. The headless WebGPU device is not usable here. This result does not tell if the effects compile on WebGPU. |
| HC8, Editor, preview on WebGL 2 ([log](camera-effects/editor-check-webgl2.txt)) | WebGL 2 | 18 of 18 pass, which includes the HC1 and HC4 tests on the camera screenshot. |
| HC8, Editor, automatic backend ([log](camera-effects/editor-check.txt)) | WebGPU | 9 of 11 pass. The Inspector tests pass. The camera screenshot gives UNAVAILABLE "Screenshot failed", and the page error is "Instance dropped in popErrorScope". The WebGPU device was lost at start. |

The two WebGL 2 rows ran again at `64948ba`, after the review fixes (render target disposal, blur sigma, pixelate sample point) and the rebase. The two WebGPU rows are from before the fixes and were not run again.

Images (WebGL 2):

- OBS page: [baseline](camera-effects/baseline-webgl2.png), [vignetting](camera-effects/vignetting-webgl2.png), [vignetting with Blink 1](camera-effects/vignetting-blink-webgl2.png), [night vision](camera-effects/night-vision-webgl2.png), [blur 4](camera-effects/blur-webgl2.png), [pixelate 64](camera-effects/pixelate-webgl2.png), [lens dirt](camera-effects/lens-dirt-webgl2.png), [all five effects](camera-effects/all-effects-webgl2.png).
- Camera screenshot: [vignetting](camera-effects/vignetting-screenshot-webgl2.png), [vignetting with Blink 1](camera-effects/vignetting-blink-screenshot-webgl2.png), [pixelate 64](camera-effects/pixelate-screenshot-webgl2.png).
- Inspector: [Effects section](camera-effects/inspector-effects-webgl2.png).

## Limits

- The output keeps one dirt lease, for the output camera only (R20). A camera cut to a camera with another dirt image, or with no dirt image, releases the image. A cut back loads it again, and lens dirt does not show until that load completes.

## Local checks

LC1 ran on 2026-11-18 at `69b497e`: macOS 27.2.1 (Apple silicon), debug build (`pnpm dev:desktop`, `OPENSEKAI_EVALUATION=1`), OBS 33.0.1 (browser source, 1920 × 1080 at 60 FPS), WebGPU, `production_v1`. LC2 is the owner review of the look. LC3 to LC5 did not run.

LC1 method: the app scene got the scene of operation 7 (the cameras `camera_wide` and `camera_close` of the smoke scene and the gray image screen, no environment) through `scene_replace`, and `camera_select` put `camera_wide` on `output_main`. The two test images of `pixels.mjs` were added to the app library as records. Each step is an MCP `scene_patch` with `setCameraEffects`. After each step, OBS `GetSourceScreenshot` was taken until two PNGs in sequence were equal. The pixel tests are the tests of `pixels.mjs`. OBS gives a premultiplied colour, so the colour of each partly transparent pixel was divided by its alpha before the tests. Without the division, 2 tests fail only on edge pixels (HC1 Blink at the antialiased screen edge, and HC3 at the blur edge), for example `[1, 1, 1, 2]`, which is gray 128 with alpha 2.

| Check | Result |
| --- | --- |
| LC1, WebGPU: HC1 to HC5 on OBS source screenshots | Pass. HC0 to HC7: 19 pass, 0 fail ([log](camera-effects/obs-webgpu.txt)). Each of the 10 steps reports `webgpu` on `output_main` and has no warning, which includes HC6 with all five effects. HC4: the pixel blocks start at the top-left corner of the frame. [Images](camera-effects/obs-webgpu.png), over #303040, in the order baseline, vignetting, vignetting with Blink 1, night vision; blur 4, pixelate 64, lens dirt, all five effects. HC8 on WebGPU (the Editor camera screenshot) did not run. |
| LC2, the look of each effect, from the HC images | Pass. The owner accepted the look of each effect from the [OBS WebGPU images](camera-effects/obs-webgpu.png) on 2026-11-18. V1 to V9 do not change. |
| LC3, the WebKit preview compiles each effect | Not checked. Only on owner request. |
| LC4, OBS alpha over dark, light, and checker backgrounds with all five effects | Not checked. Only on owner request. |
| LC5, cost at `production_v1` and output with the Editor minimized | Not checked. Only on owner request. GPU time: unknown. |
