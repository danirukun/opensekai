# GPU time check (B43 PR1)

Date: 2026-11-21; local checks 2026-11-22. Contract: [light scale](../../spdd/prompt/2026-11-21-light-scale.md), Part A. Analysis: [light scale](../../spdd/analysis/2026-11-21-light-scale.md). Issue: #305. Commit: `5a529ab` on `claude/b43-gpu-time` (the last code commit, the frame span; this page is in the next commit).

The headless checks did not start the app, a WebView, or OBS. The orchestrator ran the local checks. The probe of 2026-11-21 measured the first design (the sum of the pass durations), and the owner then changed the sample to the frame span (contract D8). The local checks of 2026-11-22 measured the frame span.

## Design

- On WebGPU, the renderer is made with `trackTimestamp: true`. three writes timestamps only when the device has `timestamp-query` (R1). On WebGL 2, the renderer sets `trackTimestamp` to false before the first render, so it makes no timer query (TA3).
- After the last render call of each applied frame, `packages/renderer/src/gpu-timer.ts` records the query index of each three pool (a frame boundary). When no resolve is in progress, it resolves the query set of each pool into its own buffers and resets the pool as three does. It does not wait for the resolve (R3, R8).
- three keeps only a duration for each pass, so the timer reads the begin and end timestamps from its own result buffer. It does not call `resolveTimestampsAsync` and does not patch three (TA5).
- `frameSpan` gives the time from the earliest pass begin to the latest pass end of one frame, or `null` when a timestamp is 0 or an end is before its begin. `gpuSample` gives the mean of the frame spans of a batch, or `null` (R5). The next acknowledgment carries the sample; the other acknowledgments carry `null` (TA1).
- The value is "the GPU time span of a frame". Passes that run at the same time count one time (R7).
- A render outside an applied frame taints the batch, so the batch gives no sample (R4). These renders taint: a screenshot, the render of a capture, the room irradiance cube, the room environment map, and a frame render that failed.
- Each renderer reports `gpuTimer` in its diagnostics. The host keeps it for each output, and `app_status` shows it (R2).
- The benchmark summary gives the `gpuMs` percentiles of the samples in the measured window, `gpuSampleCount`, and `gpuUnknownCount` (R9).

## Headless checks

These commands ran on macOS (Darwin 27.2.0, Apple silicon) in the PR1 worktree, with the shared Cargo target. The baseline ran on `df3534f` (the documents commit, before any code change). The result ran on `5a529ab`.

| Command | Baseline | Result |
| --- | --- | --- |
| `pnpm check` | Exit 0. svelte-check 5915 files, 0 errors, 0 warnings. | Exit 0. svelte-check 5916 files, 0 errors, 0 warnings. |
| `pnpm test:unit` | Exit 0. 303 files passed; 2851 tests passed, 1 skipped. | Exit 0. 304 files passed; 2869 tests passed, 1 skipped (+1 file, +18 tests). |
| `pnpm test:integration` | Exit 0. 48 files passed, 4 skipped; 125 tests passed, 8 skipped. | Exit 0. The same counts. |
| `cargo fmt --all -- --check` | Exit 1. Two differences, in `apps/desktop/src-tauri/src/recent_shows.rs` and `apps/desktop/src-tauri/src/tracking/parser.rs`. | Exit 1. The same two differences only. PR1 does not change those files. |
| `cargo clippy --workspace --all-targets -- -D warnings` | Exit 0, 0 warnings. | Exit 0, 0 warnings. |
| `cargo test --workspace` | Exit 0. 632 passed, 0 failed, 2 ignored. | Exit 0. 636 passed, 0 failed, 2 ignored (+4). In the first run, `clock_integration` failed one time (`unsolicited frames accumulated credits: 2`); PR1 does not change the clock, and the second full run passed. |

The new tests:

- Renderer: `packages/renderer/test/gpu-timer.test.ts` (13): `framePairs`, `frameSpan`, `gpuSample`, and the timer with a fake device that copies the query slots. One test runs the timer with the real `WebGPUBackend` and `WebGPUTimestampQueryPool` classes of three 0.187, so a three update that changes a field fails this test.
- Contracts: 1 in `packages/contracts/test/app-status.test.ts`, 4 shared vectors (`applied-gpu-ms`, `applied-negative-gpu-ms`, `diagnostics-gpu-timer`, `diagnostics-unknown-gpu-timer`), 1 in `crates/contracts/tests/app_status.rs`. The vectors run in the TypeScript and the Rust harness.
- Evaluation: 2 in `crates/evaluation/src/runs.rs`.
- Host: 1 in `apps/desktop/src-tauri/tests/diagnostics_integration.rs`. It sends a real diagnostics message on a renderer socket and reads `appStatus` on an operator socket. It is a test at a process and protocol boundary, because the host stores the report in the renderer connection task.

The unit tests cannot show that a client has `timestamp-query`, what the timestamp resolution is, or what the measurement costs.

## Client support

From the probe of 2026-11-21 and the local checks of 2026-11-22.

| Client | WebGPU `timestamp-query` | WebGL 2 `EXT_disjoint_timer_query_webgl2` | Timestamp resolution |
| --- | --- | --- | --- |
| Editor window, macOS (WKWebView, system WebKit) | Yes | Not checked | Below 1 µs |
| OBS browser source, macOS (CEF in OBS 33.0.1) | Yes | Yes (`gpuTimer: supported` with `?backend=webgl2`). `gpuMs` is `null`, as designed | 0.065536 ms (2^16 ns) for each timestamp |
| Editor window, Windows (WebView2) | Not checked | Not checked | Not checked |
| OBS browser source, Windows | Not checked | Not checked | Not checked |

## Probe (2026-11-21)

Commit: `c8e3b13` (the first design: the sum of the pass durations). macOS 27.2.1, Apple M3 Pro, OBS 33.0.1. The orchestrator ran the checks. This page records its results.

| Check | Requirement | Result |
| --- | --- | --- |
| LC A1, probe (gate G-A1) | R1, R2 | Pass. The Editor window and the OBS browser source have `timestamp-query`. The OBS browser source with WebGL 2 gives `null`. |
| LC A2, resolution | R5 | OBS: each pass duration is a multiple of 0.065536 ms. Editor window: below 1 µs. |
| LC A3, plausibility | R3 to R7 | Fail for the sum. Stage Rig case D (a haze with 32 scattering lights) gave p50 24.4 ms and p95 32.2 ms while OBS ran at 59.7 FPS (FPS Counter 61). Case A (8 lit lights, a steady 60 FPS) gave p95 13.8 ms. An Apple GPU runs passes at the same time, so the sum counts the same time more than one time. The owner changed the sample to the frame span (D8). Also, some OBS samples were too low (see below). |
| LC A4, benchmark | R9 | Not done |
| LC A5, overhead (gate G-A2) | TA4 | Not done |
| LC A6, cost again (#305) | R12 | Not done |
| LC A7, minimized | R3 | Pass. With the Editor minimized, OBS kept its samples. One of 118 samples was too low. |

Low OBS samples (0.13 ms to 0.2 ms, 2 or 3 steps of 0.065536 ms) where the other samples were 4 ms to 20 ms:

| Case | Low samples |
| --- | --- |
| A | 73 of 1128 |
| B | 50 of 1039 |
| C | 77 of 1131 |
| D | 4 of 1016 |
| Editor minimized | 1 of 118 |

The cause is not known. The analysis gives the candidates in code (risk "Implausibly low samples"). With the frame span, a frame that has a timestamp of 0 or an end before its begin gives no sample, and a batch after a pool reset by three gives no sample. LC A3 must check the frame span again. The frame span checks below show that low samples continue.

## Local checks with the frame span (2026-11-22)

Commit `c3a08e3` (the frame span). macOS 27.2.1, Apple M3 Pro, debug build (`pnpm dev:desktop` with `OPENSEKAI_EVALUATION=1`), WebGPU, OBS 33.0.1 (browser source, 1920 × 1080 at 60 FPS), `production_v1`, Catboy character. Each case waited 30 s and then polled `app_status` at 10 Hz for 120 s. App timing and OBS timing are separate. OBS skipped 0 render frames in each case. A batch gives one sample (R6), so a case where a resolve takes about 2 frames has about half the samples. The orchestrator ran the checks and reported them on PR #346.

| Check | Requirement | Result |
| --- | --- | --- |
| LC A1, probe (gate G-A1) | R1, R2 | Pass. `preview_main` and `output_main` report `gpuTimer: supported` and a `gpuMs` value. OBS with `?backend=webgl2`: backend `webgl2`, `gpuTimer: supported` (the timer extension), `gpuMs` `null` in 99 of 99 acknowledgments, never 0. Gate G-A1: pass. OBS on macOS has a GPU timer, so #316 continues with GPU time. |
| LC A2, resolution | R5 | Pass (recorded). OBS: steps of 0.065536 ms (2^16 ns) for each timestamp. Editor window: below 1 µs. |
| LC A3, plausibility | R3 to R7 | Fail on one part. The owner accepts it for now (2026-11-22); the follow-up is #349. The frame span agrees with the frame rate: Stage Rig case D gives p50 7.3 ms and p95 9.4 ms at 59.9 FPS (the sum gave 24.4 ms and 32.2 ms at the same rate). Case A gives p50 4.9 ms and p95 7.2 ms. But low samples continue: 0.07 ms to 0.26 ms (1 to 4 OBS steps), in short runs between normal values. Case A has 75 of 1105, and case C has 86 of 1130. Without them, the p95 of case A changes from 7.21 ms to 7.27 ms. In such a frame all the timestamps are almost equal, so PR1 cannot find these frames. |
| LC A4, benchmark | R9 | Pass. `webgpu_smoke_v1`: `gpuMs` p50 0.92 ms, p95 1.31 ms, p99 1.64 ms, max 2.10 ms; `gpuSampleCount` 7196; `gpuUnknownCount` 2; 7198 frames; `appCommit` c3a08e3. The benchmark needs `OPENSEKAI_FIXTURE_MANIFEST` set to a manifest that has exactly `fixture_vrm_1` and `fixture_glb_1`. |
| LC A5, overhead (gate G-A2) | TA4 | Pass. Light limits case B. Timer on: output CPU median 5.7 ms, 59.95 FPS. A local build with `trackTimestamp: false`: 5.8 ms, 59.96 FPS. The gate limits are +0.3 ms CPU and −0.5 FPS. OBS skipped 0 frames in both. Gate G-A2 selects TA4 (a): the timer is on when the device has the feature. |
| LC A6, cost again (#305) | R12 | Partial. The light limits cases A to F and the stage beams cases A to D are in the tables below. Not done: the stage lights case, the `performance_v1` profile, the anti-aliasing modes, and grading. |
| LC A7, minimized | R3 | Pass. For 12 s with the Editor minimized: `output_main` 59.8 FPS, 117 of 119 acknowledgments with `gpuMs` (p50 5.8 ms). The preview stops. |

Not verified: the Editor forced to WebGL 2, Windows, and Linux.

### Light limits (Stage Rig), `output_main`

| Case | FPS | Output CPU ms, median | GPU ms p50 / p95 / max | Samples / acknowledgments | Samples below 2 ms |
| --- | --- | --- | --- | --- | --- |
| A, 8 lit lights, 6 beams | 59.9 | 5.5 | 4.9 / 7.2 / 9.1 | 1105 / 1182 | 75 |
| B, 32 lights, 30 beams | 59.9 | 5.7 | 5.0 / 7.7 / 9.4 | 1100 / 1182 | 5 |
| C, 32 lights, 6 beams | 60.0 | 5.6 | 5.0 / 7.3 / 8.4 | 1130 / 1181 | 86 |
| D, B with a haze and 30 scattering lights | 59.9 | 6.1 | 7.3 / 9.4 / 12.3 | 1002 / 1181 | 1 |
| E, B with a haze and 8 scattering lights | 59.9 | 6.2 | 13.0 / 16.6 / 22.7 | 611 / 1182 | 0 |
| F, B with a haze and 16 scattering lights | 59.9 | 6.2 | 12.9 / 16.9 / 21.3 | 582 / 1181 | 0 |

### Stage beams, `output_main`

| Case | FPS | Output CPU ms, median | GPU ms p50 / p95 / max | Samples / acknowledgments | Samples below 2 ms |
| --- | --- | --- | --- | --- | --- |
| A, beams off | 60.0 | 5.1 | 4.2 / 5.4 / 7.5 | 1158 / 1182 | 6 |
| B, 8 beams | 60.0 | 5.5 | 4.5 / 6.2 / 7.9 | 1162 / 1181 | 81 |
| C, haze and 8 volumetric lights, beams off | 60.0 | 5.5 | 4.7 / 6.9 / 9.3 | 1127 / 1187 | 3 |
| D, haze, 8 volumetric lights, and 8 beams | 60.0 | 5.6 | 5.0 / 7.2 / 11.3 | 1161 / 1190 | 35 |

### Findings

- Low samples (LC A3). The frame span did not remove them. They are 1 to 4 OBS steps, so all the timestamps of such a frame are almost equal. They change p95 by less than 0.1 ms. The owner accepts them for now (2026-11-22). Follow-up: #349.
- Cases E and F have about half the samples of the other cases. There, a resolve takes about 2 frames, and each resolved batch gives one sample (R6). This is the design, not a loss.
- Haze cost on Stage Rig. Case D (30 scattering lights) costs less GPU time than case E (8) and case F (16), and it looks the same as case E: the frames of D and E differ by 1.75 for each pixel (mean absolute difference, 0 to 255), and two frames of D differ by 1.65. On 2026-11-18, case D ran at 42 FPS; on 2026-11-22 it ran at 59.9 FPS. This is a renderer behavior, not a PR1 fault. Follow-up: #350.
