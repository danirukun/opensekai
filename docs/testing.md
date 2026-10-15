# Testing

This document tells you which test to write and how to make it reliable. It adds to "Verification" in [AGENTS.md](../AGENTS.md) and principle V in the [constitution](constitution.md). For the evidence a change needs, see [quality assurance](qa.md).

## Test levels

| Level | Use it for | Location | Command |
| --- | --- | --- | --- |
| Unit | Pure logic: packet decoding, coordinate conversion, scheduling, state transitions, filters, schema validation | `packages/*/test`, `apps/*/test`, `tools/*/test` (`*.test.ts`); Rust `#[cfg(test)]` modules | `pnpm test:unit`, `cargo test` |
| Integration | A real process, network, file, or protocol boundary. State the boundary in the test name or a comment. | `*.integration.test.ts`, `scripts/*.test.ts`, `apps/desktop/src-tauri/tests/` | `pnpm test:integration`, `cargo test --workspace` |
| End-to-end | A critical user path through the running app, the browser, or OBS | `tools/evaluation`, evidence in `docs/evaluation/` | `pnpm evaluate:smoke`, `pnpm evaluate:blueprints` |

Add a unit test for new function behavior. Do not test static copy or wiring that a running check already shows. Prefer one integration test at the real boundary to many unit tests of the wiring around it.

## Rules

- **Use the real interface.** A test is evidence only when it calls the code the way the product calls it: the exported function, the WebSocket protocol, the HTTP route, the MCP tool, or the file format. A test that replaces the unit under test with a mock proves nothing about it.
- **Fake only the boundary you do not own.** Fake the clock, the network peer, or the hardware source. Do not fake the module that the test is about.
- **A bug fix needs a regression test.** The test must fail on the old code and pass on the new code. Record both results in the pull request.
- **Do not wait with a fixed sleep for an effect in another task.** When a test waits for a socket close, a message, or a background task, poll for the expected state with a deadline. Fail with a message that names the state and the last value. A fixed sleep passes on a fast host and fails on a slow one (see #158). A fixed sleep is correct only when the test measures elapsed time itself, for example a timeout or a stale interval.
- **Keep tests deterministic.** Use fixed seeds, fixed fixtures, and injected time. A test that passes on a re-run after a failure is a defect, not a pass.
- **Do not skip, disable, or weaken a test to get a pass.** If a test needs hardware or a platform that is not present, mark the skip with the reason and record it in the baseline below.

## Linux cloud baseline

The cloud container is Ubuntu 24.04 on x86_64 with no GPU, no OBS, and no tracking hardware. Run `bash scripts/cloud-setup.sh` first. Compare your results with this baseline. A result that is worse than the baseline is a failure of your change until you prove otherwise.

Recorded 2026-10-15 on `main` at `c395dcc`, Node 26.10.0, pnpm 12.8.1, rustc 1.93.1.

| Command | Pass | Fail | Skip | Notes |
| --- | --- | --- | --- | --- |
| `pnpm check` | All packages | 0 | 0 | svelte-check: 0 errors, 0 warnings |
| `pnpm test:unit` | 671 (100 files) | 0 | 0 | |
| `pnpm test:integration` | 23 (7 files) | 0 | 0 | |
| `cargo test --workspace --no-fail-fast` | 205 | 1 | 1 | Fail: `service_ports_retain_all_native_ack_times_and_reject_disconnected_output` (#158, fixed after this baseline). Skip: `pinned_fixture_benchmark_cancel_replay_stale_timer_summary_and_history` needs local pinned smoke fixtures. |
| `cargo clippy --workspace --all-targets` | Clean | 0 | — | 0 warnings |
| `cargo fmt --all -- --check` | — | 10 files | — | Formatting differences in files that this baseline did not change (`assets/registry.rs`, `assets/scene_import.rs`, `bootstrap.rs`, `service/mod.rs`, `service/router.rs`, `import_integration.rs`, and four `crates/contracts` files). Do not count them against your change. Keep the files you change clean. |

Use `--no-fail-fast` with `cargo test`. Without it, cargo stops at the first failing test binary and the counts are incomplete.

After the #158 fix, `cargo test --workspace --no-fail-fast` gives 206 passed, 0 failed, 1 skipped.

One unexplained failure was seen once in about 70 runs of `evaluation_integration`: `native_capture_produces_registered_evidence_and_http_role_cors_policy` and `capture_export_failure_preserves_registered_records_and_cannot_escape_root` failed together at their first capture. It did not occur again in 65 runs, also under CPU load. If you see it, record the full output on a new issue.

Update this table when a change adds a known failure, removes one, or changes a skip.
