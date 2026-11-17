# Camera effects check (B37)

Date: 2026-11-18. Contract: [camera effects](../../spdd/prompt/2026-11-13-camera-effects.md). Issue: #172 (CAM-15). Commit: `1a8fc97` on `claude/b37-camera-effects`.

GPU time: unknown.

## Full checks

These commands ran on macOS (Darwin 27.2.0, Apple silicon) in the B37 worktree, with the shared Cargo target. They do not start the app, a WebView, or OBS.

| Command | Result |
| --- | --- |
| `pnpm check` | Exit 0. svelte-check: 5881 files, 0 errors, 0 warnings. |
| `pnpm test:unit` | Exit 0. 264 files passed; 2457 tests passed, 1 skipped. |
| `pnpm test:integration` | Exit 1. 42 files passed, 1 failed, 2 skipped; 105 tests passed, 4 failed, 4 skipped. The 4 failures are in `scripts/prepare-tracking.test.ts`. This is the known baseline without the MediaPipe models. |
| `cargo fmt --all -- --check` | Exit 1. One difference, in `apps/desktop/src-tauri/src/recent_shows.rs`. B37 does not change that file. |
| `cargo clippy --workspace --all-targets` | Exit 0, 0 warnings (after `1a8fc97`, which boxes the effects group). |
| `cargo test --workspace --no-fail-fast` | Exit 0. 56 test binaries; 601 passed, 0 failed, 2 ignored. |

## Headless checks

The scripts are in [camera-effects/](camera-effects/). Each one makes its own test images. A stand-in for the host sends the frames of a real `@opensekai/session`, and each step is a `setCameraEffects` patch. The pixel tests are in [`pixels.mjs`](camera-effects/pixels.mjs).

Capture method: `page.screenshot` timed out at 1920 × 1080 on this Mac (the image-screens check has the same problem). The scripts use the renderer `captureRequest` instead. This gives a straight-alpha PNG of the output canvas. The frames stop during a capture, and a step passes only after two equal captures in sequence.

| Check | Backend | Result |
| --- | --- | --- |
| HC0 to HC7, OBS page ([log](camera-effects/headless-check.txt)) | WebGL 2 (`?backend=webgl2`) | 24 pass, 0 fail. HC4: the pixel blocks start at the top-left corner of the frame. |
| HC0 to HC7, OBS page, chain build only ([log](camera-effects/headless-check-webgpu.txt)) | WebGPU | 0 pass, 9 fail. Each step, the baseline without effects too, has the warning "Pipeline compile failed", and the page reports GPU validation errors. The headless WebGPU device is not usable here. This result does not tell if the effects compile on WebGPU. |
| HC8, Editor, preview on WebGL 2 ([log](camera-effects/editor-check-webgl2.txt)) | WebGL 2 | 18 of 18 pass, which includes the HC1 and HC4 tests on the camera screenshot. |
| HC8, Editor, automatic backend ([log](camera-effects/editor-check.txt)) | WebGPU | 9 of 11 pass. The Inspector tests pass. The camera screenshot gives UNAVAILABLE "Screenshot failed", and the page error is "Instance dropped in popErrorScope". The WebGPU device was lost at start. |

Images (WebGL 2):

- OBS page: [baseline](camera-effects/baseline-webgl2.png), [vignetting](camera-effects/vignetting-webgl2.png), [vignetting with Blink 1](camera-effects/vignetting-blink-webgl2.png), [night vision](camera-effects/night-vision-webgl2.png), [blur 4](camera-effects/blur-webgl2.png), [pixelate 64](camera-effects/pixelate-webgl2.png), [lens dirt](camera-effects/lens-dirt-webgl2.png), [all five effects](camera-effects/all-effects-webgl2.png).
- Camera screenshot: [vignetting](camera-effects/vignetting-screenshot-webgl2.png), [vignetting with Blink 1](camera-effects/vignetting-blink-screenshot-webgl2.png), [pixelate 64](camera-effects/pixelate-screenshot-webgl2.png).
- Inspector: [Effects section](camera-effects/inspector-effects-webgl2.png).

## Local checks

The local checks did not run. The app, a WebView, and OBS were not started.

| Check | Result |
| --- | --- |
| LC1, WebGPU: HC1 to HC5 on OBS source screenshots | Not checked. **Triggered**: the headless checks cannot build the chain on WebGPU (HC6 and HC8), because the headless WebGPU device is lost at start. |
| LC2, the look of each effect, from the HC images | Not checked. For the owner, in review. |
| LC3, the WebKit preview compiles each effect | Not checked. Only on owner request. |
| LC4, OBS alpha over dark, light, and checker backgrounds with all five effects | Not checked. Only on owner request. |
| LC5, cost at `production_v1` and output with the Editor minimized | Not checked. Only on owner request. GPU time: unknown. |
