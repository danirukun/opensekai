# Light limits check (B34b)

Date: 2026-11-17. Contract: [light limits](../../spdd/prompt/2026-11-17-light-limits.md). Issues: #304, #45 (ENV-07), #46 (ENV-08). Commit: `1a038d3` on `claude/b34b-light-limits` (the last code commit; this page is in the next commit). The renderer change is in `d44d1a1`.

GPU time: unknown.

## Headless checks

These commands ran on macOS (Darwin 27.2.0, Apple silicon) in the B34b worktree, with the shared Cargo target. They do not start the app, a WebView, or OBS. The baseline ran on `6453256` (the contract commit, before any code change).

| Command | Baseline | Result |
| --- | --- | --- |
| `pnpm check` | Exit 0. svelte-check 5877 files, 0 errors, 0 warnings. | Exit 0. svelte-check 5877 files, 0 errors, 0 warnings. |
| `pnpm test:unit` | Exit 0. 261 files passed; 2358 tests passed, 1 skipped. | Exit 0. 265 files passed; 2389 tests passed, 1 skipped (+4 files, +31 tests). |
| `pnpm test:integration` | Exit 1. 43 files passed, 1 failed, 3 skipped; 105 tests passed, 4 failed, 7 skipped. | Exit 1. 44 files passed, 1 failed, 3 skipped; 107 tests passed, 4 failed, 7 skipped (+1 file, +2 tests). |
| `cargo fmt --all --check` | Exit 1. One difference, in `apps/desktop/src-tauri/src/recent_shows.rs`. | Exit 1. The same difference only. B34b does not change that file. |
| `cargo clippy --workspace --all-targets -- -D warnings` | Exit 0, 0 warnings. | Exit 0, 0 warnings. |
| `cargo test --workspace` | 606 passed, 1 failed, 2 ignored. The failure was `clock_integration` (`unsolicited frames accumulated credits: 2`); it passed on a second run. | Exit 0. 611 passed, 0 failed, 2 ignored (+4). |

The 4 integration failures are in `scripts/prepare-tracking.test.ts`, before and after: ENOENT on `artifacts/models/face_landmarker.task`. This is the known baseline without the MediaPipe models. The 2 ignored Rust tests are `pinned_fixture_benchmark_cancel_replay_stale_timer_summary_and_history` (local pinned smoke fixtures) and `youtube_live_gate` (network, 30 minutes).

In the first final unit run, `apps/desktop/test/hidden-cameras.test.ts` failed one time (`expected [] to deeply equal [ 'a' ]`). B34b does not change hidden cameras. The file passed alone (11 tests), and the second full run passed.

The new tests:

- Contracts: `packages/contracts/test/light-limits.test.ts` (7) and 2 new shared vectors; `crates/contracts/tests/light_limits.rs` (3).
- Session: `packages/session/test/light-limits.test.ts` (5).
- Assist: 3 in `compile-scene.test.ts`.
- Renderer: 2 in `beam.test.ts`, 3 in `scene-lights.test.ts`.
- Desktop: `apps/desktop/test/light-limits.test.ts` (5), `stage-rig.test.ts` (3), 1 in `stage-beams.test.ts`; 1 Rust test in `show.rs`.
- MCP stdio: `apps/mcp/test/light-limits.integration.test.ts` (2).

The unit tests cannot show that 32 lights or 30 beams compile on a GPU, what they cost, or how they look.

## Local checks

Date: 2026-11-18. Commit: `0aee4fa`. macOS 27.2.1 (Apple silicon), debug build (`pnpm dev:desktop`, `OPENSEKAI_EVALUATION=1`), WebGPU in WKWebView and in OBS 33.0.1 (browser source, 1920 × 1080 at 60 FPS), `production_v1`. Character: Catboy (VRM 0, ARKit). The checks used MCP, real clicks in the Editor, and OBS captures. App timing and OBS timing are separate. GPU time: unknown.

| Check | Requirement | Result |
| --- | --- | --- |
| LC1, limits through MCP and show open | R2, R3, R5 | Pass. On Stage Rig, `scene_patch` refuses each change with `INVALID_INPUT`, and the revision stays the same: a 33rd light (M2, "Scene has the maximum of 32 lights"); an affect flag on a head (M1, "Scene has the maximum of 8 lit lights"); a third shadow (M3, "Scene has the maximum of 2 shadow lights"); a head removed and a lit light created in one patch (M1). `scene_replace` with 9 lit lights gives M1, and with 33 lights gives M2. File › Open of Stage Rig plus one light shows M2 in the Editor status, and the scene does not change ([image](light-limits/open-33-lights-status.png)). |
| LC2, Editor with real input | R7 to R11 | Pass. On Stage Beams (6 lit), Add › Spot Light two times makes two lit lights. At 8 lit lights, Add › Spot Light, Point Light, Directional Light, and Ambient Light each make a light with the three Affect flags off. The unlit Ambient Light does not change the OBS output: the mean color and alpha stay the same ([image](light-limits/unlit-ambient-obs.png)). A tick on Affect Characters at 8 lit lights is refused: the box stays off, the status shows `INVALID_INPUT`, and the Inspector shows M1 ([image](light-limits/affect-at-8-lit.png)). Duplicate is disabled for a lit light and enabled for an unlit light ([image](light-limits/duplicate-lit-unlit.png)). On Stage Rig, the four Add light items and Duplicate on each light are disabled. |
| LC3, Stage Beams lights and beams | R18 | Pass. The Hierarchy has the Directional Light and the Ambient Light, they light the stage, and 8 beams show from the Wide, Stage, and Close cameras ([image](light-limits/stage-beams-cameras-obs.png)). `app_status` has no warning. |
| LC4, Stage Rig: 30 beams in the preview and in OBS | R12, R19 | Pass. 30 beams show in OBS from the Wide, Stage, and Close cameras and in the Editor preview (55 FPS) ([image](light-limits/stage-rig-30-beams-obs.png)). `app_status` has no `Pipeline compile failed` on either output. |
| LC5, alpha | R15 | Pass. Stage Rig with the environment hidden, over dark, light, and checker backgrounds: 0 of 1,950,782 partial-alpha pixels have a channel above alpha; 114,367 pixels have alpha 0 ([image](light-limits/stage-rig-alpha-obs.png)). Over the light background with the default blending, the beams are a gray veil, as in B34. |
| LC6, beam pool grows and stays | R12 | Pass. Stage Beams (8 beams), then `scene_replace` with Stage Rig (30 beams), then 23 heads removed (7 beams), then the heads added again (30 beams). Each step shows the right beam count in OBS and no warning ([image](light-limits/beam-pool-obs.png)). The maximum output CPU time in the 2 s after a change was 5.3 to 6.6 ms. |
| LC7, cost (cases A to F) | R12 to R14 | Pass for A, B, C, E, and F. Case D (a haze with 32 scattering lights) does not keep 60 FPS. The owner decided on 2026-11-18 to keep 32 scattering lights and to record the cost. See the table below. |
| LC8, Metal after 30 changes | R13 | Pass. 15 `scene_patch` changes without a haze, then a haze with 32 volumetric lights, then 15 more: a head removed, added again, a flag swap between a lit light and a head, and a head type change spot → point → spot. After each change, `app_status` had no warning on either output, and every patch applied. OBS shows the beams and the haze at the end ([image](light-limits/changes-haze-obs.png)). In a first run, the reply of one patch (the first spot → point change) was lost (`UNAVAILABLE`, "Connection closed"), but the patch applied; the run was repeated. |
| LC9, minimized Editor | R15 | Pass. For about 11 s minimized, the output sequence went from 12663 to 13293 (about 57 FPS), and OBS showed the 30 beams ([image](light-limits/minimized-obs.png)). The preview stops while minimized. |
| LC10, old shows | R6 | Pass. `fixtures/shows/stage-lights.osekai`, `fixtures/shows/test-stage.osekai`, the Stage Lights template (from the start screen), and a show saved with the B34 build before this change open with no message. `scene_inspect` gives the scene of each file, with 0 differences. In the first open of `stage-lights.osekai`, one edit from outside the check changed the camera field of view after the open; a second open gave 0 differences. |

### Cost (LC7)

Each case is Stage Rig with the character and an FPS Counter, the Wide camera, and the Editor in front. Each case waited 30 s and then measured 120 s. CPU times are samples each second, not a p95.

| Case | OBS render frames skipped | Output CPU ms, median / max | Output FPS from sequence | Preview FPS from sequence | FPS Counter in OBS (start, middle, end) |
| --- | --- | --- | --- | --- | --- |
| A, 8 lit lights, 6 beams (heads removed) | 0 / 7259 | 4.8 / 5.8 | 59.5 | 57.0 | 60, 60, 30 |
| B, 32 lights, 30 beams | 0 / 7262 | 5.3 / 7.3 | 59.4 | 59.4 | 61, 61, 61 |
| C, 32 lights, 6 beams | 0 / 7261 | 5.1 / 7.7 | 59.4 | 59.4 | 60, 60, 61 |
| D, B with a haze and 32 scattering lights | 0 / 7274 | 5.2 / 6.1 | 42.3 | 0.0 | 60, 36, 41 |
| E, B with a haze and 8 scattering lights | 0 / 7280 | 5.9 / 7.0 | 59.9 | 56.6 | 49, 59, 57 |
| F, B with a haze and 16 scattering lights | 0 / 7279 | 5.7 / 6.0 | 60.0 | 60.0 | 61, 60, 60 |

[FPS Counter crops](light-limits/cost-fps-counter.png), one row for each case in the table order.

- 30 beams cost about 0.2 to 0.5 ms of output CPU time (median) more than 6 beams. The frame rate stays at 60.
- Case D is limited by the GPU, not the CPU: the output CPU time stays near 5 ms, but the output falls to about 36 to 42 FPS, and the Editor preview draws no frame in 120 s. A first run of D in an earlier app session gave the same result (output 40.9 FPS, FPS Counter 60, 28, 30; preview 4 FPS). The haze evaluates each scattering light at each of its 12 steps, so 32 lights are 384 light evaluations for each haze pixel. The owner keeps the limit at 32 and accepts this cost (2026-11-18). Up to 16 scattering lights kept 60 FPS on this Mac.
- After case D, the Editor took about 10 s to show the next scene.
- The single 30 FPS reading at the end of case A is one capture. The output sequence for the full 120 s gives 59.5 FPS.
- Runs that were disturbed are not in the table: a first run of A, in which the preview gave 32.2 FPS after an `UNAVAILABLE` reply, and a first run of F, in which a second character was added in the Editor during the measurement.

### Other findings

- The M1 message for a refused Affect tick shows at the bottom of the Inspector, and the window edge cuts half of it off. It is far from the checkbox.
- Each Add of a lit light stops the Editor for about 8 to 10 s while the lit materials compile again. MCP returns `UNAVAILABLE` ("Publisher disconnected") during that time. An Add of an unlit light at 8 lit lights does not stop the Editor (T3).
- A right-click on a Hierarchy row also selects a word of the row name. This is not a B34b change.
