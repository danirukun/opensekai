# Stage beams check (B34)

Date: 2026-11-16. Contract: [stage beams](../../spdd/prompt/2026-11-13-stage-beams.md). Issue: #46 (ENV-08). Commit: `e33d45a` on `claude/b34-stage-beams`.

GPU time: unknown.

## Headless checks

These commands ran on macOS (Darwin 27.2.0, Apple silicon) in the B34 worktree, with the shared Cargo target. They do not start the app, a WebView, or OBS.

| Command | Result |
| --- | --- |
| `pnpm check` | Exit 0. svelte-check: 0 errors, 0 warnings. |
| `pnpm test:unit` | Exit 0. 252 files passed; 2236 tests passed, 1 skipped. |
| `pnpm test:integration` | Exit 1. 37 files passed, 1 failed, 2 skipped; 89 tests passed, 4 failed, 4 skipped. The 4 failures are in `scripts/prepare-tracking.test.ts` (ENOENT on `artifacts/models/face_landmarker.task`). This is the known baseline without the MediaPipe models. |
| `cargo fmt --all -- --check` | Exit 1. One difference, in `apps/desktop/src-tauri/src/recent_shows.rs`. B34 does not change that file. |
| `cargo clippy --workspace --all-targets` | Exit 0, 0 warnings. |
| `cargo test --workspace --no-fail-fast` | Exit 0. 559 passed, 0 failed, 2 ignored: `pinned_fixture_benchmark_cancel_replay_stale_timer_summary_and_history` (local pinned smoke fixtures) and `youtube_live_gate` (network, 30 minutes). |

The unit tests cannot show that the beam material compiles on a GPU or how the beam looks. A Node `WGSLNodeBuilder` run built the WGSL of the beam material. That run is not a GPU compile.

## Pipeline failure rule

Review of PR #303 found that one sticky failure flag stopped the haze and the beams together. It also stopped a beam that was switched on after an unrelated failure. Contract R15a replaces the flag with `pipeline-blame.ts`. Each failure report counts one time, in the first drawn frame after it arrives. A label that starts with `renderPipeline_beam_` stops the beams only. Any other new report goes to the pass (haze or beams) that started to draw later, or to both if they started in the same frame. The report cannot always name the pass, because the chain composite is one pipeline for both, so this rule is a choice. `pipeline-blame.test.ts` (8 tests) and two renderer tests in `beam.test.ts` cover it. The two renderer tests fail with the old flag.

After the fix: `pnpm check` exit 0 (svelte-check 0 errors, 0 warnings); `pnpm vitest run --project unit packages/renderer` 40 files, 333 tests passed (this includes `haze.test.ts` and `beam.test.ts`). Cargo did not run again, because no Rust file changed.

## Limits

- A change of the beam count between 0 and 1 or more rebuilds the post chain (`post-chain.ts`, chain key). A Blueprint that strobes the only beam rebuilds the chain at each toggle. R13 permits this.
- The failure rule cannot tell an avatar or prop pipeline that fails for the first time while a beam starts from a beam failure. It gives that failure to the beams.

## Local checks

Date: 2026-11-17. Commit: `9a8b0b8`. macOS 27.2.1 (Apple silicon), debug build (`pnpm dev:desktop`, `OPENSEKAI_EVALUATION=1`), WebGPU in WKWebView and in OBS 33.0.1 (browser source, 1920 × 1080 at 60 FPS), `production_v1`. Character: Catboy (VRM 0, ARKit). The checks used MCP, real clicks and drags in the Editor, and OBS captures. App timing and OBS timing are separate. GPU time: unknown.

| Check | Requirement | Result |
| --- | --- | --- |
| LC1, probe: one beam in the preview and in OBS, no pipeline warning | R10, R12, R15 | Pass. Add › Spot Light, then tick Beam: the group is `{true, 1, 0.5}`. The beam shows in the preview and in OBS. `app_status` has no warning on either output. The preview FPS counter fell to 18 for a moment at the tick. |
| LC2, depth: an object in front of a beam hides it; no hard line at the floor | R14 | Pass. The character at [−1, 0, 1] and at [−1, 0, −2.5] hides the beams behind it, and a beam in front of it veils it. There is no hard line at the floor or at the character ([image](stage-beams/depth-avatar.png)). |
| LC3, alpha over dark, light, and checker backgrounds; one "SRGB Off" capture | R12 | Pass for alpha: 826,265 pixels have alpha 0; the maximum alpha is 223; 0 of 1,247,335 partial-alpha pixels have a channel above alpha. Look finding: over a light (#eeeeee) OBS background with the default blending, the beams show as a gray veil (luma median 231 against 238). With Blending Method "SRGB Off" the beams keep their color ([image](stage-beams/obs-light-srgb-off.png)). The owner accepts the veil with the default blending (2026-11-17). [The README](../../README.md#obs-output) tells users to set the Browser Source Blending Method to SRGB Off. |
| LC4, fixture: 8 beams from the Wide, Stage, and Close cameras | R29 | Pass. Wide and Stage show 8 beams ([image](stage-beams/fixture-wide-obs.png)). The Close camera is inside the beam volume and shows a wash. |
| LC5, Inspector: live drags, reset marks, type change | R19 to R25 | Partial. Pass: clear and tick Beam keeps the values; Beam Intensity and Beam Softness show only while Beam is on; one Beam Intensity drag made 57 live revisions, and the preview and OBS followed during the drag; Spot → Point → Spot removes the beam and does not refuse; Scatter In Haze toggles. Fail: no reset mark shows on any light field. The same markup and CSS are on `main` (`.resettable > .reset-mark` at `left: -26px` inside `.section-clip { overflow: hidden }`), so this is not caused by B34. The first change to a new light type stopped the preview for about 8 s, and `scene_inspect` returned UNAVAILABLE in that time; later changes did not. |
| LC6, MCP: `scene_patch`, `scene_inspect`, `camera_screenshot` | R16, R27 | Pass. `setLight` with a beam group is returned by `scene_inspect`, and `camera_screenshot` shows the beam. A beam on a point light is refused at MCP input ("Only a spot light has a beam"), as a tool error, not as a structured INVALID_INPUT. |
| LC7, cost: four cases, 30 s wait, 120 s measure | D1, D2 | Pass. Each case is the fixture, the character, and an FPS Counter, with the Editor in front. The table below has the results. |
| LC8, output continues with the Editor minimized | — | Pass. For 12 s minimized, the output sequence went from 264267 to 265029 (about 59 FPS), and OBS showed the 8 beams ([image](stage-beams/minimized-obs.png)). The preview stops while minimized and starts again after restore. |
| LC9, Save As, close, and Open keep the beam group | R3 | Pass. Two beams had values that are not the defaults, one with Beam off. Save As wrote the 8 groups. After the app restarted, Open gave the same 8 groups in `scene_inspect`. `fixtures/shows/stage-lights.osekai` opens with no beam field and no warning, and OBS shows no beam cone. It was not compared side by side with a `main` build. |
| LC10, WebGL 2: does the beam draw | — | Pass. With `?backend=webgl2` on the OBS URL, the output reports `webgl2`, has no warning, and draws the 8 beams ([image](stage-beams/webgl2-obs.png)). The character was not in this scene. |

### Cost (LC7)

| Case | OBS render frames skipped | Output CPU ms, median / max | Preview CPU ms, median / max | Output FPS from sequence | FPS Counter (start, middle, end) |
| --- | --- | --- | --- | --- | --- |
| A, beams off | 0 / 7246 | 5.0 / 5.8 | 6 / 8 | 59.9 | 60, 60, 60 |
| B, 8 beams | 0 / 7242 | 5.4 / 7.4 | 7 / 10 | 59.6 | 60, 60, 60 |
| C, haze and 8 volumetric lights, beams off | 0 / 7273 | 5.2 / 6.5 | 7 / 8 | 60.0 | 61, 61, 61 |
| D, haze, 8 volumetric lights, and 8 beams | 0 / 7273 | 5.4 / 6.2 | 7 / 8 | 60.0 | 60, 60, 61 |

The beams add about 0.2 to 0.4 ms of CPU time (median). GPU time: unknown ([FPS Counter crops](stage-beams/cost-fps-counter.png)). WKWebView stops the Editor preview when another window covers the Editor. A first run with the Editor covered is not valid and is not in the table.

### Look findings

- Banding: vertical bands show across each beam cone in the OBS output, not only in the Editor ([image](stage-beams/banding-obs.png)). Cause, from the capture and the three.js r187 source: the interpolated vertex normal. A cone with a top radius of 0 has one triangle per segment, and its apex vertex has the normal of the next segment. The normal is therefore discontinuous at each segment edge, and the step increases toward the apex. The capture agrees with this cause, not with 8-bit quantization:
  - Row 150 of the capture has flat runs of 10 to 28 px, and adjacent runs differ by 3 to 8 levels, not by 1.
  - Row 150, nearer the apex, has 83 runs. Row 300 has 39.
  - A row has about 24 bands, which is 48 segments / 2, because a front segment edge and a back segment edge project to the same place.
  - The center band is 26 px wide. The 7.5° segment angle predicts about 28 px.

  Fix (R9a, R9b): the material calculates the exact cone normal from the local position (`beamConeNormal`). `beam.test.ts` shows that the vertex normals of `beamGeometry` differ by more than 2° across a segment edge near the apex, and that `beamConeNormal` is the same on both sides. OBS check of the fix (R9b), commit `31f8faf`, 2026-11-17: the camera looked along `beam_front_2` from outside the cone, near the apex. In 4 pixel rows through the beam, the largest step between neighbor runs is 2 levels, and no step is above 2. The LC1 capture before the fix has steps of 4 and long flat bands. No band shows ([image](stage-beams/banding-fixed-obs.png)). `app_status` has no warning. Pass.
- An empty row shows between the Beam checkbox and the next field. This is not a B34 change. On `main`, `.visibility-control` has `margin-bottom: 22px`, and the light fields grid has a 10 px gap. So each checkbox in the light fields (Shadow, Soft Shadows, Scatter In Haze, and the Affect switches) has the same space after it. The Beam checkbox uses the same markup.
- Over a light OBS background with the default blending, the beams are a gray veil (LC3). The owner accepts it. The README tells users to set the Blending Method to SRGB Off.
