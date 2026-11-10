# Camera grading check

Checked 2026-11-10 in a Linux cloud container (Ubuntu 24.04, x86_64, no GPU) on branch `claude/cam06-camera-grading`, base `a78b27a`. Contract: [camera grading](../../spdd/prompt/2026-11-10-camera-grading.md). Node 26.10.0, pnpm 12.8.1, three.js 0.187.0, HeadlessChrome 153 (Playwright 1.65.0, the Chromium build 1243 of the container).

No macOS, OBS, or GPU result is claimed. The frame cost of the grade and of bloom is unknown. The WebGPU canvas is not checked: in this headless Chromium a WebGPU canvas gives an empty image to `toBlob` and to a page screenshot, also without a grading.

This container was not the usual cloud environment. It could not download rustc 1.93.1 or the MediaPipe models, so the Rust checks ran on rustc 1.97.0 and `pnpm build` did not run. See [Checks](#checks).

## Renderer check (headless Chromium, software adapters)

Method. A scratch Vite page (not in the repository) called the real `createRenderer` from `packages/renderer/src` with `production_v1`. The frame was `makeSmokeFrame` reduced to the box mesh and the cameras, with the box turned 45° about Z and the camera in front of it. One renderer drew 18 gradings in turn. After each frame the page took `renderer.capture()` (the canvas) and `renderer.screenshot()` (the offscreen path) and counted the alpha values of each PNG. `centre` is a pixel on the box, and `corner` is the pixel at (2, 2). `equal` is true when the canvas PNG and the screenshot PNG have the same sampled hash.

- WebGL 2: `--use-gl=angle --use-angle=swiftshader`, renderer `ANGLE (Mesa, Vulkan 1.4.318 (llvmpipe (LLVM 20.1.2 256 bits)), llvmpipe)`.
- WebGPU: `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan`, adapter vendor `google`, architecture `swiftshader`.

Gradings: `missing` has no group; `default` has the default group; `all` is ACES, exposure 0.5, brightness 0.1, contrast −0.2, vibrance 0.3, tint `#ffeedd`; `bloom` is intensity 1, threshold 0, radius 0.4; `bloom-high-threshold` is intensity 1, threshold 4; the names with `fxaa` also set Anti-aliasing to FXAA.

Raw output:

```
Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36
webgl2 missing               canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | equal false | warnings 0
webgl2 default               canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | equal false | warnings 0
webgl2 exposure+1            canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [113, 215, 255, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [113, 215, 255, 255] | equal true | warnings 0
webgl2 exposure-1            canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [57, 114, 138, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [57, 114, 138, 255] | equal true | warnings 0
webgl2 aces                  canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [98, 173, 195, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [98, 173, 195, 255] | equal true | warnings 0
webgl2 neutral+2             canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [137, 215, 251, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [137, 215, 251, 255] | equal true | warnings 0
webgl2 brightness-0.5        canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [57, 114, 138, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [57, 114, 138, 255] | equal true | warnings 0
webgl2 contrast+0.5          canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [67, 181, 237, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [67, 181, 237, 255] | equal true | warnings 0
webgl2 contrast-0.5          canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [98, 136, 149, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [98, 136, 149, 255] | equal true | warnings 0
webgl2 vibrance+1            canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [0, 135, 188, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [0, 135, 188, 255] | equal true | warnings 0
webgl2 vibrance-1            canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [156, 176, 188, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [156, 176, 188, 255] | equal true | warnings 0
webgl2 tint                  canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 76, 45, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 76, 45, 255] | equal true | warnings 0
webgl2 all                   canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [121, 168, 169, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [121, 168, 169, 255] | equal true | warnings 0
webgl2 bloom                 canvas partial 1202460 opaque 83640 clear 787500 corner [0, 0, 0, 0] centre [143, 255, 255, 255] | screenshot partial 1202460 opaque 83640 clear 787500 corner [0, 0, 0, 0] centre [143, 255, 255, 255] | equal true | warnings 0
webgl2 bloom-high-threshold  canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | equal true | warnings 0
webgl2 bloom+aces+fxaa       canvas partial 1203177 opaque 82824 clear 787599 corner [0, 0, 0, 0] centre [197, 230, 239, 255] | screenshot partial 1203276 opaque 82824 clear 787500 corner [0, 0, 0, 0] centre [197, 230, 239, 255] | equal false | warnings 0
webgl2 exposure+1+fxaa       canvas partial 2460 opaque 82824 clear 1988316 corner [0, 0, 0, 0] centre [113, 215, 255, 255] | screenshot partial 2460 opaque 82824 clear 1988316 corner [0, 0, 0, 0] centre [113, 215, 255, 255] | equal true | warnings 0
webgl2 missing-again         canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | equal false | warnings 0
webgl2 logs []
Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36
webgpu missing               screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | warnings 0
webgpu default               screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | warnings 0
webgpu exposure+1            screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [113, 215, 255, 255] | warnings 0
webgpu exposure-1            screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [57, 114, 138, 255] | warnings 0
webgpu aces                  screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [98, 173, 195, 255] | warnings 0
webgpu neutral+2             screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [137, 215, 251, 255] | warnings 0
webgpu brightness-0.5        screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [57, 114, 138, 255] | warnings 0
webgpu contrast+0.5          screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [67, 181, 237, 255] | warnings 0
webgpu contrast-0.5          screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [98, 136, 149, 255] | warnings 0
webgpu vibrance+1            screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [0, 135, 188, 255] | warnings 0
webgpu vibrance-1            screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [156, 176, 188, 255] | warnings 0
webgpu tint                  screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 76, 45, 255] | warnings 0
webgpu all                   screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [121, 168, 169, 255] | warnings 0
webgpu bloom                 screenshot partial 1202460 opaque 83640 clear 787500 corner [0, 0, 0, 0] centre [143, 255, 255, 255] | warnings 0
webgpu bloom-high-threshold  screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | warnings 0
webgpu bloom+aces+fxaa       screenshot partial 1203276 opaque 82824 clear 787500 corner [0, 0, 0, 0] centre [197, 230, 239, 255] | warnings 0
webgpu exposure+1+fxaa       screenshot partial 2460 opaque 82824 clear 1988316 corner [0, 0, 0, 0] centre [113, 215, 255, 255] | warnings 0
webgpu missing-again         screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | warnings 0
webgpu logs []
```

Comparison with the CPU reference. The script read the `missing` box pixel, changed it to linear light, applied `gradeColor` from `grading-math.ts`, and changed the result to sRGB. `delta` is the largest channel difference from the GPU pixel.

```
webgl2 default          canvas     gpu [81,157,188] cpu [81,157,188] delta 0
webgl2 exposure+1       canvas     gpu [113,215,255] cpu [113,214,255] delta 1
webgl2 exposure-1       canvas     gpu [57,114,138] cpu [57,114,137] delta 1
webgl2 aces             canvas     gpu [98,173,195] cpu [98,172,195] delta 1
webgl2 neutral+2        canvas     gpu [137,215,251] cpu [137,215,250] delta 1
webgl2 brightness-0.5   canvas     gpu [57,114,138] cpu [57,114,137] delta 1
webgl2 contrast+0.5     canvas     gpu [67,181,237] cpu [67,181,236] delta 1
webgl2 contrast-0.5     canvas     gpu [98,136,149] cpu [98,136,149] delta 0
webgl2 vibrance+1       canvas     gpu [0,135,188] cpu [0,134,188] delta 1
webgl2 vibrance-1       canvas     gpu [156,176,188] cpu [155,176,188] delta 1
webgl2 tint             canvas     gpu [81,76,45] cpu [81,76,45] delta 0
webgl2 all              canvas     gpu [121,168,169] cpu [121,168,169] delta 0
webgl2 exposure+1+fxaa  canvas     gpu [113,215,255] cpu [113,214,255] delta 1
webgl2 worst delta 1
webgpu default          screenshot gpu [81,157,188] cpu [81,157,188] delta 0
webgpu exposure+1       screenshot gpu [113,215,255] cpu [113,214,255] delta 1
webgpu exposure-1       screenshot gpu [57,114,138] cpu [57,114,137] delta 1
webgpu aces             screenshot gpu [98,173,195] cpu [98,172,195] delta 1
webgpu neutral+2        screenshot gpu [137,215,251] cpu [137,215,250] delta 1
webgpu brightness-0.5   screenshot gpu [57,114,138] cpu [57,114,137] delta 1
webgpu contrast+0.5     screenshot gpu [67,181,237] cpu [67,181,236] delta 1
webgpu contrast-0.5     screenshot gpu [98,136,149] cpu [98,136,149] delta 0
webgpu vibrance+1       screenshot gpu [0,135,188] cpu [0,134,188] delta 1
webgpu vibrance-1       screenshot gpu [156,176,188] cpu [155,176,188] delta 1
webgpu tint             screenshot gpu [81,76,45] cpu [81,76,45] delta 0
webgpu all              screenshot gpu [121,168,169] cpu [121,168,169] delta 0
webgpu exposure+1+fxaa  screenshot gpu [113,215,255] cpu [113,214,255] delta 1
```

Result.

- Each grade (exposure, ACES, Neutral, brightness, contrast, vibrance, tint, and all together) agrees with the CPU reference within 1 of 255, on the WebGL 2 canvas and in the screenshot on both backends (R10, R12, R14).
- `missing`, `default`, and `missing-again` give the same canvas image, with the same counts as the other frames without bloom. A neutral group changes no pixel, and a return from a grading gives the first image again (R7).
- The corner pixel stays `[0, 0, 0, 0]` with each grading, and the count of clear pixels does not change without bloom (R13).
- Bloom with threshold 0 adds 1,201,640 partial-alpha pixels around the box, and the count of opaque pixels does not change (R9). A threshold of 4, above each scene value, gives the image without bloom.
- The canvas and the screenshot have the same sampled hash for each grading that is not neutral, except with bloom and FXAA together: 99 pixels at the end of the glow are clear in the screenshot and partial on the canvas. The screenshot path writes 8-bit color before FXAA, and the chain filters float color. For `missing` and `default` the canvas (direct draw) and the screenshot differ in the sampled hash with equal counts; this was so before this change.
- No material warning and no console error occurred. The log lists exclude the three.js deprecation notes for `renderAsync` and `PostProcessing`, which occur without this change.

## Editor controls (headless Chromium)

Method. A scratch Svelte page (not in the repository) mounted the real `Inspector` with a real `createEditorModel` on a real `createSession` (smoke scene, `camera_wide` selected). Playwright used the controls.

Raw output (shortened):

```
sections: Transform, Rendering, Grading, Lens, Control, Screenshot
labels: Tone Mapping, Exposure, Brightness, Contrast, Vibrance, Tint, Bloom Intensity, Bloom Threshold, Bloom Radius
initial: revision 0, no grading, 0 patches
after Tone Mapping = ACES: revision 1,
  patch {sceneId: scene_smoke, expectedRevision: 0, operations: [{kind: setCameraGrading, entityId: camera_wide,
    grading: {toneMapping: aces, exposure: 0, brightness: 0, contrast: 0, vibrance: 0, tint: #ffffff, bloom: {intensity: 0, threshold: 0.8, radius: 0.4}}}]}
after Exposure = 1.5: revision 2, grading.exposure 1.5
after Bloom Intensity = 0.98: grading.bloom {intensity: 0.98, threshold: 0.8, radius: 0.4}
after Exposure = 9 (out of range): no patch, the field shows 1.5
reset marks: Reset Tone Mapping, Reset Exposure, Reset Bloom Intensity
after Reset Tone Mapping: revision 4, grading.toneMapping none, the other values stay
console errors: one 404 for a file that the scratch page does not have (no script error)
```

Result. The first change writes the full group (R15). A value out of range sends no patch. A reset mark shows only on a changed field and sends one `setCameraGrading` patch. A slider drag and the Tint picker were not operated.

## Checks

| Command | Result |
| --- | --- |
| `pnpm check` | 9 packages and `tsconfig.scripts.json`: pass. svelte-check: 0 errors, 0 warnings |
| `pnpm test:unit` | 2006 passed, 1 skipped (231 files). Base `a78b27a`: 1976 passed, 1 skipped (228 files) |
| `pnpm test:integration` | 73 passed, 4 failed, 4 skipped. The 4 failures are in `scripts/prepare-tracking.test.ts`: the MediaPipe model files are not in `artifacts/models`, because this container cannot reach their download host. They do not use code that this change touches |
| `cargo test -p opensekai-contracts --no-fail-fast` (rustc 1.97.0) | CARGO_CONTRACTS |
| `cargo test --workspace --no-fail-fast` (rustc 1.97.0) | CARGO_WORKSPACE |
| `cargo clippy --workspace --all-targets` (rustc 1.97.0) | CARGO_CLIPPY |
| `cargo fmt --all -- --check` | The same files differ as on the base; `crates/contracts/tests/grading.rs` is clean |

## Local acceptance (owner, macOS)

1. Open a show with a VRM and a stage. Select the output camera. In Grading, set Tone Mapping to ACES and then to Neutral, and move Exposure, Brightness, Contrast, Vibrance, and Tint. The preview and the OBS source (WebGPU) change while a slider moves, with no stall on a number change.
2. Set Bloom Intensity to 1 and Bloom Threshold to 0.76. In OBS, put the source over a dark, a light, and a checker background. The glow shows over each, and the area far from the character stays transparent.
3. Set each field back with its reset mark. The output is the same as before step 1.
4. Take Screenshot with a grading. The PNG has the same look as the output.
5. Save, close, and open the show. The grading is on the camera. Minimize the editor: OBS motion continues.
6. Record the frame time in OBS with bloom off and on for `production_v1`.
