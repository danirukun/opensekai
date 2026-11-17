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

The orchestrator runs these checks on macOS with OBS. Until then, each row is "not checked".

| Check | Requirement | Result |
| --- | --- | --- |
| LC1, limits through MCP and show open | R2, R3, R5 | not checked |
| LC2, Editor with real input | R7 to R11 | not checked |
| LC3, Stage Beams lights and beams | R18 | not checked |
| LC4, Stage Rig: 30 beams in the preview and in OBS | R12, R19 | not checked |
| LC5, alpha | R15 | not checked |
| LC6, beam pool grows and stays | R12 | not checked |
| LC7, cost (cases A to D) | R12 to R14 | not checked |
| LC8, Metal after 30 changes | R13 | not checked |
| LC9, minimized Editor | R15 | not checked |
| LC10, old shows | R6 | not checked |
