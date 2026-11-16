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

## Local checks

The orchestrator runs these checks on macOS with MCP and OBS, at `production_v1` and 1920 × 1080 at 60 FPS.

| Check | Requirement | Result |
| --- | --- | --- |
| LC1, probe: one beam in the preview and in OBS, no pipeline warning | R10, R12, R15 | not checked |
| LC2, depth: an object in front of a beam hides it; no hard line at the floor | R14 | not checked |
| LC3, alpha over dark, light, and checker backgrounds; one "SRGB Off" capture | R12 | not checked |
| LC4, fixture: 8 beams from the Wide, Stage, and Close cameras | R29 | not checked |
| LC5, Inspector: live drags, reset marks, type change | R19 to R25 | not checked |
| LC6, MCP: `scene_patch`, `scene_inspect`, `camera_screenshot` | R16, R27 | not checked |
| LC7, cost: four cases, 30 s wait, 120 s measure | D1, D2 | not checked |
| LC8, output continues with the Editor minimized | — | not checked |
| LC9, Save As, close, and Open keep the beam group | R3 | not checked |
| LC10, WebGL 2: does the beam draw | — | not checked |
