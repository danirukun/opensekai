# GPU time check (B43 PR1)

Date: 2026-11-21. Contract: [light scale](../../spdd/prompt/2026-11-21-light-scale.md), Part A. Analysis: [light scale](../../spdd/analysis/2026-11-21-light-scale.md). Issue: #305. Commit: `baf40bd` on `claude/b43-gpu-time` (the last code commit; this page is in the next commit).

GPU time: unknown. No check on this page started the app, a WebView, or OBS.

## Design

- On WebGPU, the renderer is made with `trackTimestamp: true`. three writes timestamps only when the device has `timestamp-query` (R1). On WebGL 2, the renderer sets `trackTimestamp` to false before the first render, so it makes no timer query (TA3).
- After the last render call of each applied frame, `packages/renderer/src/gpu-timer.ts` starts one resolve of the render and compute queries since the previous resolve, when no resolve is in progress and the result buffers are unmapped. It does not wait for the resolve (R3).
- The timer reads the durations from `timestampQueryPool.{render,compute}.timestamps` after its own resolve. It does not use the value that `resolveTimestampsAsync` returns, because that value can be stale or 0 (TA5).
- `gpuSample` gives the sum of the durations divided by the frame count of the batch, or `null` (R5). The next acknowledgment carries the sample; the other acknowledgments carry `null` (TA1).
- A render outside an applied frame taints the batch, so the batch gives no sample (R4). These renders taint: a screenshot, the render of a capture, the room irradiance cube, the room environment map, and a frame render that failed.
- Each renderer reports `gpuTimer` in its diagnostics. The host keeps it for each output, and `app_status` shows it (R2).
- The benchmark summary gives the `gpuMs` percentiles of the samples in the measured window, `gpuSampleCount`, and `gpuUnknownCount` (R9).

## Headless checks

These commands ran on macOS (Darwin 27.2.0, Apple silicon) in the PR1 worktree, with the shared Cargo target. The baseline ran on `df3534f` (the documents commit, before any code change). The result ran on `baf40bd`.

| Command | Baseline | Result |
| --- | --- | --- |
| `pnpm check` | Exit 0. svelte-check 5915 files, 0 errors, 0 warnings. | Exit 0. svelte-check 5916 files, 0 errors, 0 warnings. |
| `pnpm test:unit` | Exit 0. 303 files passed; 2851 tests passed, 1 skipped. | Exit 0. 304 files passed; 2865 tests passed, 1 skipped (+1 file, +14 tests). |
| `pnpm test:integration` | Exit 0. 48 files passed, 4 skipped; 125 tests passed, 8 skipped. | Exit 0. The same counts. |
| `cargo fmt --all -- --check` | Exit 1. Two differences, in `apps/desktop/src-tauri/src/recent_shows.rs` and `apps/desktop/src-tauri/src/tracking/parser.rs`. | Exit 1. The same two differences only. PR1 does not change those files. |
| `cargo clippy --workspace --all-targets -- -D warnings` | Exit 0, 0 warnings. | Exit 0, 0 warnings. |
| `cargo test --workspace` | Exit 0. 632 passed, 0 failed, 2 ignored. | Exit 0. 636 passed, 0 failed, 2 ignored (+4). |

The new tests:

- Renderer: `packages/renderer/test/gpu-timer.test.ts` (9). One test runs the timer against the timestamp pool class of three 0.187 with a fake device, so a three update that changes the fields fails this test.
- Contracts: 1 in `packages/contracts/test/app-status.test.ts`, 4 shared vectors (`applied-gpu-ms`, `applied-negative-gpu-ms`, `diagnostics-gpu-timer`, `diagnostics-unknown-gpu-timer`), 1 in `crates/contracts/tests/app_status.rs`. The vectors run in the TypeScript and the Rust harness.
- Evaluation: 2 in `crates/evaluation/src/runs.rs`.
- Host: 1 in `apps/desktop/src-tauri/tests/diagnostics_integration.rs`. It sends a real diagnostics message on a renderer socket and reads `appStatus` on an operator socket. It is a test at a process and protocol boundary, because the host stores the report in the renderer connection task.

The unit tests cannot show that a client has `timestamp-query`, what the timestamp resolution is, or what the measurement costs.

## Client support

| Client | WebGPU `timestamp-query` | WebGL 2 `EXT_disjoint_timer_query_webgl2` | Timestamp resolution |
| --- | --- | --- | --- |
| Editor window, macOS (WKWebView, system WebKit) | Not checked | Not checked | Not checked |
| OBS browser source, macOS (CEF in OBS 33.0.1) | Not checked | Not checked | Not checked |
| Editor window, Windows (WebView2) | Not checked | Not checked | Not checked |
| OBS browser source, Windows | Not checked | Not checked | Not checked |

## Local checks

| Check | Requirement | Result |
| --- | --- | --- |
| LC A1, probe (gate G-A1) | R1, R2 | Not checked |
| LC A2, resolution | R5 | Not checked |
| LC A3, plausibility | R3 to R7 | Not checked |
| LC A4, benchmark | R9 | Not checked |
| LC A5, overhead (gate G-A2) | TA4 | Not checked |
| LC A6, cost again (#305) | R12 | Not checked |
| LC A7, minimized | R3 | Not checked |
