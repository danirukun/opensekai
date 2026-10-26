# Testing

This document tells you which test to write and how to make it reliable. It adds to "Verification" in [AGENTS.md](../AGENTS.md) and principle V in the [constitution](constitution.md). For the evidence a change needs, see [quality assurance](qa.md).

## Test levels

| Level | Use it for | Location | Command |
| --- | --- | --- | --- |
| Unit | Pure logic: packet decoding, coordinate conversion, scheduling, state transitions, filters, schema validation | `packages/*/test`, `apps/*/test`, `tools/*/test` (`*.test.ts`); Rust `#[cfg(test)]` modules | `pnpm test:unit`, `cargo test` |
| Integration | A real process, network, file, or protocol boundary. State the boundary in the test name or a comment. | `*.integration.test.ts`, `scripts/*.test.ts`, `apps/desktop/src-tauri/tests/` | `pnpm test:integration`, `cargo test --workspace` |
| End-to-end | A critical user path through the running app, the browser, or OBS | `tools/evaluation`, evidence in `docs/evaluation/` | `pnpm evaluate:smoke`, `pnpm evaluate:blueprints`, `pnpm evaluate:vmc-feed` |

Add a unit test for new function behavior. Do not test static copy or wiring that a running check already shows. Prefer one integration test at the real boundary to many unit tests of the wiring around it.

### VMC test peer

Use `pnpm evaluate:vmc-feed` for a VMC receiver or sender check when no tracker or VMC application is present.

- `pnpm evaluate:vmc-feed --port <port>` sends VMC bundles to `127.0.0.1:<port>` at 60 Hz. Each bundle has `/VMC/Ext/OK`, `/VMC/Ext/T`, the blend values `Blink` and `A` `I` `U` `E` `O`, and `/VMC/Ext/Blend/Apply`. The eyes close one time in 2 s. One vowel opens at a time, 0.8 s each. Point it at the VMC Receiver port to give a character face motion that a downstream receiver (for example VSeeFace) can show.
- `pnpm evaluate:vmc-feed --listen --port <port>` receives VMC packets and writes one JSON line each second: the packet count, the count for each OSC address, and the last value of each blend shape. Use it as the receiver for a VMC Sender check.
- `--host`, `--rate`, and `--seconds` change the address, the send rate, and the run time. Without `--seconds`, it runs until Ctrl+C.

## Rules

- **Use the real interface.** A test is evidence only when it calls the code the way the product calls it: the exported function, the WebSocket protocol, the HTTP route, the MCP tool, or the file format. A test that replaces the unit under test with a mock proves nothing about it.
- **Fake only the boundary you do not own.** Fake the clock, the network peer, or the hardware source. Do not fake the module that the test is about.
- **A bug fix needs a regression test.** The test must fail on the old code and pass on the new code. Record both results in the pull request.
- **Do not wait with a fixed sleep for an effect in another task.** When a test waits for a socket close, a message, or a background task, poll for the expected state with a deadline. Fail with a message that names the state and the last value. A fixed sleep passes on a fast host and fails on a slow one (see #158). A fixed sleep is correct only when the test measures elapsed time itself, for example a timeout or a stale interval.
- **Prove that an effect does not occur with a barrier, not a sleep.** A poll cannot show that a value stays the same. When the host handles messages on one socket in order, send a message that gets a reply (for example a wire `ping`) and wait for the reply. Then read the state once. See `barrier` in `diagnostics_integration.rs`.
- **Keep tests deterministic.** Use fixed seeds, fixed fixtures, and injected time. A test that passes on a re-run after a failure is a defect, not a pass.
- **Do not skip, disable, or weaken a test to get a pass.** If a test needs hardware or a platform that is not present, mark the skip with the reason and record it in the baseline below.

## Linux cloud baseline

The cloud container is Ubuntu 24.04 on x86_64 with no GPU, no OBS, and no tracking hardware. Run `bash scripts/cloud-setup.sh` first. Compare your results with this baseline. A result that is worse than the baseline is a failure of your change until you prove otherwise.

Recorded 2026-10-15 on `main` at `c395dcc`, Node 26.10.0, pnpm 12.8.1, rustc 1.93.1.

| Command | Pass | Fail | Skip | Notes |
| --- | --- | --- | --- | --- |
| `pnpm check` | 8 packages and `tsconfig.scripts.json` | 0 | 0 | svelte-check: 0 errors, 0 warnings |
| `pnpm test:unit` | 671 (100 files) | 0 | 0 | |
| `pnpm test:integration` | 23 (7 files) | 0 | 0 | |
| `cargo test --workspace --no-fail-fast` | 205 | 1 | 1 | Fail: `service_ports_retain_all_native_ack_times_and_reject_disconnected_output` (#158, fixed after this baseline). Skip: `pinned_fixture_benchmark_cancel_replay_stale_timer_summary_and_history` needs local pinned smoke fixtures. |
| `cargo clippy --workspace --all-targets` | Clean | 0 | — | 0 warnings |
| `cargo fmt --all -- --check` | — | 10 files | — | Formatting differences in files that this baseline did not change (`assets/registry.rs`, `assets/scene_import.rs`, `bootstrap.rs`, `service/mod.rs`, `service/router.rs`, `import_integration.rs`, and four `crates/contracts` files). Do not count them against your change. Keep the files you change clean. |

## Fixtures

`fixtures/cloud/manifest.json` lists the test fixtures that setup downloads. It contains metadata only: the file name, the source, and the asset record with the SHA-256 and the byte count. `pnpm exec tsx scripts/prepare-fixtures.ts` downloads each file into `fixtures/local/`, rejects a file that does not agree with its hash, and writes `fixtures/local/manifest.json`. That file is a local asset manifest for fixture mode (`OPENSEKAI_FIXTURE_MANIFEST`). A file that is already present and correct is not downloaded again.

| Asset ID | Content | Source |
| --- | --- | --- |
| `fixture_vrm_1` | VRM 1.0 sample (pixiv) | Public URL |
| `fixture_vrm0_arkit` | VRM 0.x avatar with ARKit (perfect sync) blend shapes, 57 meshes, 16 MToon materials | Private R2 bucket |
| `fixture_glb_stage` | Stage environment (TV01 Stage, CC-BY-4.0), 25 meshes, 25 materials | Private R2 bucket |
| `fixture_test_stage` | Project test stage (CC0): 10 × 10 m floor grid, two walls, resolution and colour charts, focus targets, shadow props, and a green cove. 30 meshes, 12 materials | Private R2 bucket |

The private files are in the R2 bucket `opensekai-fixtures`. Setup reads them only when the environment has `OPENSEKAI_FIXTURES_S3_ENDPOINT`, `OPENSEKAI_FIXTURES_ACCESS_KEY_ID`, and `OPENSEKAI_FIXTURES_SECRET_ACCESS_KEY` (a read-only R2 token). Any S3 API endpoint works. Without these variables, setup skips the private files.

The avatar license prohibits redistribution. Do not commit a private fixture file, attach it to an issue, or upload it to another service. Screenshots of a render are permitted as pull request evidence. To add a fixture, upload it to the bucket under `sha256/<hash>.<extension>` and add an entry to `fixtures/cloud/manifest.json`.

`pnpm build:test-stage` rebuilds the test stage with Blender 5.2 or later (`BLENDER` sets the binary) into `fixtures/local/cache/test-stage/test-stage.glb`, and validates it. The [test stage contract](../spdd/prompt/2026-10-18-test-stage.md) gives the layout. A rebuild is not byte-identical, so a changed stage is a new fixture revision: upload it and change its manifest entry. The public copy for users is at <https://assets.oshi-connect.net/opensekai/test-stage/opensekai-test-stage-fbeb8623.glb>. A new revision gets a new public file name, and the README link changes with it.

`fixtures/scene-import/packed-room.glb` is a committed test file. `import_integration.rs` makes it from synthetic data through the scene import and the asset HTTP route, and the renderer test `scene-import.test.ts` loads it. When the packer output changes, the Rust test fails. Run it with `OPENSEKAI_UPDATE_FIXTURES=1` to write the file again, and then run the renderer test.

Tools for fixture checks:

- `pnpm exec tsx scripts/gltf-validate.ts <file>...` runs the Khronos glTF validator and prints the error and warning counts by code. Exit code 1 means that a file has validation errors. The fixtures above have 0 errors.
- `pnpm exec gltf-transform inspect <file>` lists the scenes, meshes, materials, textures, and extensions. Do not use `gltf-transform validate`: it stops with a stack overflow on the fixtures above.
- `pnpm exec tsx scripts/gpu-probe.ts` starts headless Chromium with the flags in `chromiumGpuArgs` and prints the WebGPU adapter and the WebGL2 renderer. Use the same flags for a render check. On macOS the adapter is SwiftShader in headless mode. In the cloud it is SwiftShader or Mesa lavapipe. A software adapter proves that the code runs. It does not prove visual quality or performance.
- `cargo test -p opensekai-desktop --lib prepared_local_fixtures` loads `fixtures/local/manifest.json` through the asset registry and reads each fixture. Without the manifest, the test has nothing to check and passes.

Use `--no-fail-fast` with `cargo test`. Without it, cargo stops at the first failing test binary and the counts are incomplete.

After the #158 fix, `cargo test --workspace --no-fail-fast` gives 206 passed, 0 failed, 1 skipped.

One unexplained failure was seen once in about 70 runs of `evaluation_integration`: `native_capture_produces_registered_evidence_and_http_role_cors_policy` and `capture_export_failure_preserves_registered_records_and_cannot_escape_root` failed together at their first capture. It did not occur again in 65 runs, also under CPU load. If you see it, record the full output on a new issue.

Update this table when a change adds a known failure, removes one, or changes a skip.
