# GPU time check (B43 PR1)

Date: 2026-11-21. Contract: [light scale](../../spdd/prompt/2026-11-21-light-scale.md), Part A. Analysis: [light scale](../../spdd/analysis/2026-11-21-light-scale.md). Issue: #305. Commit: `5a529ab` on `claude/b43-gpu-time` (the last code commit, the frame span; this page is in the next commit).

The headless checks did not start the app, a WebView, or OBS. The probe of 2026-11-21 (below) is from the orchestrator. It measured the first design (the sum of the pass durations), and the owner then changed the sample to the frame span (contract D8). GPU time with the frame span: unknown.

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

From the probe of 2026-11-21.

| Client | WebGPU `timestamp-query` | WebGL 2 `EXT_disjoint_timer_query_webgl2` | Timestamp resolution |
| --- | --- | --- | --- |
| Editor window, macOS (WKWebView, system WebKit) | Yes | Not checked | Below 1 µs |
| OBS browser source, macOS (CEF in OBS 33.0.1) | Yes | Not recorded. With `?backend=webgl2`, `gpuMs` is `null`, as designed | 0.065536 ms (each pass duration is a multiple of this step) |
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

The cause is not known. The analysis gives the candidates in code (risk "Implausibly low samples"). With the frame span, a frame that has a timestamp of 0 or an end before its begin gives no sample, and a batch after a pool reset by three gives no sample. LC A3 must check the frame span again.

## Local checks with the frame span

| Check | Requirement | Result |
| --- | --- | --- |
| LC A1, probe (gate G-A1) | R1, R2 | Not checked |
| LC A2, resolution | R5 | Not checked |
| LC A3, plausibility | R3 to R7 | Not checked |
| LC A4, benchmark | R9 | Not checked |
| LC A5, overhead (gate G-A2) | TA4 | Not checked |
| LC A6, cost again (#305) | R12 | Not checked |
| LC A7, minimized | R3 | Not checked |
