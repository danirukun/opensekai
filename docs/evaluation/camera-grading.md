# Camera grading check

Checked 2026-11-10 in a Linux cloud container (Ubuntu 24.04, x86_64, no GPU) on branch `claude/cam06-camera-grading`, base `a78b27a`. Contract: [camera grading](../../spdd/prompt/2026-11-10-camera-grading.md). Node 26.10.0, pnpm 12.8.1, three.js 0.187.0, HeadlessChrome 153 (Playwright 1.65.0, the Chromium build 1243 of the container).

No macOS, OBS, or GPU result is claimed. The frame cost of the grade and of bloom is unknown. The WebGPU canvas is not checked: in this headless Chromium a WebGPU canvas gives an empty image to `toBlob` and to a page screenshot, also without a grading.

This container was not the usual cloud environment. It could not download rustc 1.93.1 or the MediaPipe models, so the Rust checks ran on rustc 1.97.0 and `pnpm build` did not run. See [Checks](#checks).

## Renderer check (headless Chromium, software adapters)

Method. A scratch Vite page (not in the repository) called the real `createRenderer` from `packages/renderer/src` with `production_v1`. The frame was `makeSmokeFrame` reduced to the box mesh and the cameras, with the box turned 45° about Z and the camera in front of it. One renderer drew 21 gradings in turn. After each frame the page took `renderer.capture()` (the canvas) and `renderer.screenshot()` (the offscreen path) and counted the alpha values of each PNG. `centre` is a pixel on the box, and `corner` is the pixel at (2, 2). `equal` is true when the canvas PNG and the screenshot PNG have the same sampled hash.

- WebGL 2: `--use-gl=angle --use-angle=swiftshader`, renderer `ANGLE (Mesa, Vulkan 1.4.318 (llvmpipe (LLVM 20.1.2 256 bits)), llvmpipe)`.
- WebGPU: `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan`, adapter vendor `google`, architecture `swiftshader`.

Gradings: `missing` has no group; `default` has the default group; `all` is ACES, exposure 0.5, brightness 0.1, contrast −0.2, vibrance 0.3, tint `#ffeedd`; `bloom` is intensity 1, threshold 0, radius 0.4; `bloom-high-threshold` is intensity 1, threshold 4; the names with `fxaa` also set Anti-aliasing to FXAA; `contrast-1+red` is contrast −1 with the tint `#ff0000`, and `red+contrast-1-order` is contrast −1 with brightness −1 (each channel is 0 before the contrast). The last two lines are a second run with `preview_v1` (a 960 × 540 canvas).

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
webgl2 contrast-1+red        canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [118, 0, 0, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [118, 0, 0, 255] | equal true | warnings 0
webgl2 red+contrast-1-order  canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [118, 118, 118, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [118, 118, 118, 255] | equal true | warnings 0
webgl2 exposure+4            canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [255, 255, 255, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [255, 255, 255, 255] | equal true | warnings 0
webgl2 bloom                 canvas partial 1202460 opaque 83640 clear 787500 corner [0, 0, 0, 0] centre [143, 255, 255, 255] | screenshot partial 1202460 opaque 83640 clear 787500 corner [0, 0, 0, 0] centre [143, 255, 255, 255] | equal true | warnings 0
webgl2 bloom-high-threshold  canvas partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | equal true | warnings 0
webgl2 bloom+aces+fxaa       canvas partial 1203177 opaque 82824 clear 787599 corner [0, 0, 0, 0] centre [197, 230, 239, 255] | screenshot partial 1203276 opaque 82824 clear 787500 corner [0, 0, 0, 0] centre [197, 230, 239, 255] | equal false | warnings 0
webgl2 exposure+1+fxaa       canvas partial 2460 opaque 82824 clear 1988316 corner [0, 0, 0, 0] centre [113, 215, 255, 255] | screenshot partial 2460 opaque 82824 clear 1988316 corner [0, 0, 0, 0] centre [113, 215, 255, 255] | equal false | warnings 0
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
webgpu contrast-1+red        screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [118, 0, 0, 255] | warnings 0
webgpu red+contrast-1-order  screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [118, 118, 118, 255] | warnings 0
webgpu exposure+4            screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [255, 255, 255, 255] | warnings 0
webgpu bloom                 screenshot partial 1202460 opaque 83640 clear 787500 corner [0, 0, 0, 0] centre [143, 255, 255, 255] | warnings 0
webgpu bloom-high-threshold  screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | warnings 0
webgpu bloom+aces+fxaa       screenshot partial 1203276 opaque 82824 clear 787500 corner [0, 0, 0, 0] centre [197, 230, 239, 255] | warnings 0
webgpu exposure+1+fxaa       screenshot partial 2460 opaque 82824 clear 1988316 corner [0, 0, 0, 0] centre [113, 215, 255, 255] | warnings 0
webgpu missing-again         screenshot partial 820 opaque 83640 clear 1989140 corner [0, 0, 0, 0] centre [81, 157, 188, 255] | warnings 0
webgpu logs []
webgl2 preview_v1 bloom             canvas 960x540 | screenshot partial 1202460 opaque 83640 clear 787500 corner [0, 0, 0, 0] centre [143, 255, 255, 255] | equal to the production_v1 screenshot true
webgl2 preview_v1 bloom+aces+fxaa   canvas 960x540 | screenshot partial 1203276 opaque 82824 clear 787500 corner [0, 0, 0, 0] centre [197, 230, 239, 255] | equal to the production_v1 screenshot true
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
webgl2 contrast-1+red   canvas     gpu [118,0,0] cpu [118,0,0] delta 0
webgl2 red+contrast-1-order canvas     gpu [118,118,118] cpu [118,118,118] delta 0
webgl2 exposure+4       canvas     gpu [255,255,255] cpu [255,255,255] delta 0
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
webgpu contrast-1+red   screenshot gpu [118,0,0] cpu [118,0,0] delta 0
webgpu red+contrast-1-order screenshot gpu [118,118,118] cpu [118,118,118] delta 0
webgpu exposure+4       screenshot gpu [255,255,255] cpu [255,255,255] delta 0
webgpu exposure+1+fxaa  screenshot gpu [113,215,255] cpu [113,214,255] delta 1
```

Result.

- Each grade (exposure, ACES, Neutral, brightness, contrast, vibrance, tint, and all together) agrees with the CPU reference within 1 of 255, on the WebGL 2 canvas and in the screenshot on both backends (R10, R12, R14).
- `missing`, `default`, and `missing-again` give the same canvas image, with the same counts as the other frames without bloom. A neutral group changes no pixel, and a return from a grading gives the first image again (R7).
- The corner pixel stays `[0, 0, 0, 0]` with each grading, and the count of clear pixels does not change without bloom (R13).
- Bloom with threshold 0 adds 1,201,640 partial-alpha pixels around the box, and the count of opaque pixels does not change (R9). A threshold of 4, above each scene value, gives the image without bloom.
- The canvas and the screenshot have the same sampled hash for each grading that is not neutral, except with bloom and FXAA together: 99 pixels at the end of the glow are clear in the screenshot and partial on the canvas. The screenshot path writes 8-bit color before FXAA, and the chain filters float color. For `missing` and `default` the canvas (direct draw) and the screenshot differ in the sampled hash with equal counts; this was so before this change.
- With contrast −1, a channel of 0 gives the pivot (118 of 255) and no invalid value, on both backends. With exposure 4 the box is white and its edge counts do not change.
- With `preview_v1`, the screenshot with bloom is equal to the `production_v1` screenshot: the bloom targets of a screenshot have the screenshot size (R12).
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
| `pnpm test:unit` | 2007 passed, 1 skipped (231 files). Base `a78b27a`: 1976 passed, 1 skipped (228 files) |
| `pnpm test:integration` | 73 passed, 4 failed, 4 skipped. The 4 failures are in `scripts/prepare-tracking.test.ts`: the MediaPipe model files are not in `artifacts/models`, because this container cannot reach their download host. They do not use code that this change touches |
| `cargo test -p opensekai-contracts --no-fail-fast` (rustc 1.97.0) | 120 passed, 0 failed |
| `cargo test --workspace --no-fail-fast` (rustc 1.97.0) | 459 passed, 0 failed, 2 ignored. The desktop crate needs the output and desktop bundles; they were built without the tracking model step |
| `cargo clippy --workspace --all-targets` (rustc 1.97.0) | Clean, 0 warnings |
| `cargo fmt --all -- --check` | The same files differ as on the base; `crates/contracts/tests/grading.rs` is clean |

## Local acceptance (owner, macOS)

1. Open a show with a VRM and a stage. Select the output camera. In Grading, set Tone Mapping to ACES and then to Neutral, and move Exposure, Brightness, Contrast, Vibrance, and Tint. The preview and the OBS source (WebGPU) change while a slider moves, with no stall on a number change.
2. Set Bloom Intensity to 1 and Bloom Threshold to 0.76. In OBS, put the source over a dark, a light, and a checker background. The glow shows over each, and the area far from the character stays transparent.
3. Set each field back with its reset mark. The output is the same as before step 1.
4. Take Screenshot with a grading. The PNG has the same look as the output.
5. Save, close, and open the show. The grading is on the camera. Minimize the editor: OBS motion continues.
6. Record the frame time in OBS with bloom off and on for `production_v1`.

## Review

Reviewer: Claude Opus (a different model from the implementer), on the diff, the contract, and the issue.

| Finding | Action |
| --- | --- |
| Contrast −1 on a channel of 0 gives `pow(0, 0)`, which has no defined value in a shader | Fixed: the base has a floor of 10⁻⁶ in the shader and in the CPU reference. Unit test and render check added |
| The screenshot bloom took its target size from the canvas, so a screenshot from a 960 × 540 preview had another glow than the output | Fixed: the screenshot bloom has the screenshot size. Checked with `preview_v1` |
| A graded edge pixel could get a channel above its alpha (for example exposure on a pixel with alpha 0.5) | Fixed: the graded color is clamped from 0 to 1 before it is premultiplied. R10 changed. Unit test added |
| Rust accepts `setCameraGrading` without the `grading` field as a removal; TypeScript rejects it | Not changed. Rust reads each `Option` field this way (the same as `assetId`), and the session, which applies the operation, rejects it |

## macOS local acceptance (2026-11-10)

Checked on the owner's Mac by a local review agent, on commit `e08bc09`. This section records only what was seen on this machine. Each item that was not seen has the status "not checked" or "unknown".

- Machine: MacBook Pro (Mac15,6), Apple M3 Pro, 36 GB, macOS 27.2 (26B123), on battery power, low power mode off.
- OBS 33.0.1 (obs-websocket 5.7.6, browser source Chrome 150), 1920 × 1080 at 60. The app output was one Browser Source in an isolated scene, with the default blending method. No stream and no recording.
- App: `pnpm dev:desktop` (debug build) with `OPENSEKAI_EVALUATION=1`. rustc 1.93.1, Node 26.13.0, pnpm 12.8.1.
- Backend: WebGPU for the editor preview (`preview_v1`) and for the OBS source (`production_v1`), from `app_status`.
- Fixtures: character `fixture_vrm0_arkit` (sha256 `7b7c689e…`, VRM 0, MToon). Stage: the library asset "OpenSekai Test Stage" `scene_6eb17002…`. This is not the manifest revision `fbeb8623…`.
- Scene: the start scene (one directional light, intensity 3) with the character and the stage.

### Commands

| Command | macOS result | Difference from the pull request text |
| --- | --- | --- |
| `pnpm i` | Pass. `pnpm-lock.yaml` did not change | — |
| `pnpm build` | Pass, after the one-time step `prepare-tracking.ts --download` | The cloud run did not run it |
| `pnpm check` | Pass: 10 packages and `tsconfig.scripts.json`; svelte-check 0 errors, 0 warnings | The text says 9 packages |
| `pnpm test:unit` | 2007 passed, 1 skipped (231 files) | None |
| `pnpm test:integration` | 77 passed, 0 failed, 4 skipped (36 files passed, 2 skipped) | Cloud: 73 passed, 4 failed. The 4 `prepare-tracking` tests pass here |
| `cargo fmt --all -- --check` | Clean, exit code 0 | The text says that files differ as on the base. No file differs here |
| `cargo clippy --workspace --all-targets` | 0 warnings | None |
| `cargo test --workspace --no-fail-fast` | 461 passed, 0 failed, 2 ignored | Cloud (rustc 1.97.0): 459 passed. The cause of the 2 more tests is unknown |

The baseline table in `docs/testing.md` (2026-10-15: 671 unit, 23 integration, 206 Rust tests) is older than `main`. No count is below it.

### Steps of the pull request

| Step | Result | What was seen |
| --- | --- | --- |
| 1. Tone Mapping ACES and Neutral; move Exposure, Brightness, Contrast, Vibrance, Tint | Pass | The Inspector select and a mouse drag of each slider changed the preview and the OBS source during the drag. OBS captures in the middle of the Exposure drag show exposure 4 and then a negative exposure. In 46 s of drags, the OBS output had 60 frames each second, 0 frame gaps above 50 ms, and a maximum gap of 45 ms. Ten passes of Exposure through 0 with Tone Mapping None (the chain is built again there) gave a maximum gap of 30 ms. Tint was set in its text field. The Tint color picker was not operated |
| 2. Bloom Intensity 1, Threshold 0.76, over dark, light, and checker | Fail over a light background | See "Bloom in OBS" |
| 3. Reset marks | Pass | 9 marks showed. After the 9 resets, the group was the default group and 0 pixels outside the character differed from the first OBS capture |
| 4. Take Screenshot with a grading | Pass | Taken in the Inspector with ACES, exposure 0.3, bloom 1 / 0.76 / 0.4. The PNG is 1920 × 1080 from the half-resolution preview. The face and hoodie pixels are equal to the OBS source. The glow alpha along two lines is equal within 1 of 255, and the glow box is equal within 1 pixel |
| 5. Save, close, open; minimize | Pass | The saved `.osekai` file and the opened show have the same group on the camera. With the editor minimized, the OBS output drew 1198 frames in 20 s, the preview drew 0, and OBS captures changed |
| 6. OBS frame time, `production_v1` | Recorded, with limits | See "Timing" |

### WebGPU canvas

Pass. The preview canvas and the OBS page both use WebGPU, and both show each grading. The stress through `scene_patch` gave no stall: 117 changes between a neutral and a graded group at 10 Hz (maximum frame gap 25 ms), 60 changes between bloom off and on at 5 Hz (38 ms, one frame of 9.8 ms CPU), and 633 number changes at 60 Hz (29 ms).

### Bloom in OBS

Method. The stage was hidden, so the character was over the transparent background. The OBS scene had a color source `#101010`, a color source `#f2f2f2`, or a checker image below the app source. Values are 8-bit sRGB from OBS captures.

- **Far area.** The four corners and the left and right edges stay `0, 0, 0, 0`. The glow of bloom 1 / 0.76 / 0.4 covers x from 452 to 1465 and the full height. No pixel has a color channel above its alpha, with each curve and with FXAA.
- **Box edge.** None seen. In the area with alpha below 24, the largest step between neighbor pixels is 3 of 255. The alpha image times 12 shows round contours.
- **Bright fringe.** None seen on the dark hoodie and trousers edge. The added brightness falls smoothly with the distance from the edge (14, 15, 11, 9, 7, 6, 6, 5 of 255 at 1 to 8 pixels).
- **Light background: the glow is a dark veil.** Near the head, the source pixel is a white glow with alpha 23 of 255 (`23, 22, 22, 23`). Over `#f2f2f2`, OBS shows 234, not 243. Over `#101010` it shows 30. The values agree with a blend in linear light on the premultiplied sRGB values, which is the default blending method of an OBS scene item. Around the hand and the head, the eye sees a gray shadow, not a glow ([head](camera-grading/macos-obs-bloom-head-dark-light-checker-off.jpg), [edge](camera-grading/macos-obs-bloom-edge-dark-light-off.jpg)). The result is the same with None, ACES, Neutral, and exposure −2. The "SRGB Off" blending method of OBS was not checked. The haze has the same effect ([haze](camera-grading/macos-obs-haze-bloom.jpg)).
- **Strength.** With the start light (intensity 3), the skin and the white hair of this character are at the clip level. Bloom 1 / 0.76, the values of step 2, remove the face: the eyes and the glasses are not visible. Bloom 0.3 still washes the face, and 0.1 is a light wash ([weaker](camera-grading/macos-obs-bloom-weaker.jpg)). With light intensity 1 nothing is above the threshold and no glow shows. With the stage, bloom 1 / 0.76 after step 1 fills the full frame ([stage](camera-grading/macos-obs-step2-stage-dark-light-checker.jpg)).

### Curves on the MToon character

OBS source pixels (R, G, B), start light, no other grading ([image](camera-grading/macos-obs-tonemap-none-aces-neutral.jpg)).

| Point | None | ACES | Neutral |
| --- | --- | --- | --- |
| Skin | 255, 255, 247 | 232, 228, 225 | 245, 230, 218 |
| Hair (white) | 255, 255, 255 | 227, 227, 227 | 241, 241, 241 |
| Hoodie (dark) | 58, 58, 58 | 43, 43, 43 | 27, 27, 27 |
| Green cove | 0, 255, 103 | 161, 232, 150 | 51, 245, 103 |
| Chart tan patch | 182, 138, 120 | 194, 154, 135 | 175, 127, 107 |
| Chart white patch | 255, 255, 255 | 244, 244, 243 | 251, 251, 250 |

ACES makes the skin gray and makes strong colors pale. Neutral keeps the hues and makes dark cloth much darker (58 to 27). These are the properties of the two three.js curves. The owner must decide if they are acceptable without an exposure change.

### Limits of the values

- Contrast −1: each opaque pixel is `118, 118, 118`. There is no black, white, or invalid patch, but the picture has no content. This agrees with R10.
- Exposure 4 and −4, alone and with contrast −1 and with ACES: no invalid patch. For 10 gradings, the counts of clear, partial, and opaque pixels are equal (61,992 / 2,641 / 2,008,967).
- Vibrance 0.77 makes strong colors primary colors: the tan patch becomes `232, 12, 0` ([image](camera-grading/macos-obs-neutral-vibrance-tint.jpg)).

### FXAA and haze with bloom

- FXAA with bloom 0.3: the output is a valid premultiplied image, and the screenshot agrees with the OBS source (1 % difference in the count of partial pixels, glow box within 3 pixels).
- Haze (density 1, one volumetric spot light) with bloom 0.3, and with ACES: both draw, and the status has no warning.

### Timing

Conditions: debug build, battery power, 20 s warm-up and one window of 60 s for each state. This is not a result under the benchmark contract (three runs of 120 s, release build). The preview drew only in the first state, because another application covered the editor in the others. App timing is the CPU time that the renderer of the OBS page reports. OBS timing is from `GetStats`.

| State | OBS average frame render time (median) | OBS render-skipped frames | App CPU time, p50 / p95 | App frames each second | App GPU time |
| --- | --- | --- | --- | --- | --- |
| No grading | 0.370 ms | 0 of 3673 | 3.7 / 4.2 ms | 59.98 | unknown |
| Bloom 0.3, threshold 0.76, radius 0.4 | 0.384 ms | 0 of 3667 | 4.1 / 4.7 ms | 59.96 | unknown |
| ACES, exposure 0.3, bloom 1, radius 1 | 0.400 ms | 0 of 3665 | 4.1 / 4.8 ms | 59.96 | unknown |
| No grading, second time | 0.414 ms | 0 of 3667 | 4.3 / 4.8 ms | 59.95 | unknown |

The difference between bloom off and on is smaller than the difference between the two runs without a grading. The GPU cost is unknown: the renderer reports no GPU time. A first set of runs is not used, because the screen locked during it.

### Not checked

The Tint color picker, the gizmo of the editor in a graded preview, a web page Screen with a grading, a release build, the "SRGB Off" blending method of OBS, WebGL 2 on macOS, and Windows.
