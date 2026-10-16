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
