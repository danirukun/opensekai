# Editor and MCP fixes check (B33)

Date: 2026-11-16. Bundle B33: [#244](https://github.com/danirukun/opensekai/issues/244), [#245](https://github.com/danirukun/opensekai/issues/245), [#261](https://github.com/danirukun/opensekai/issues/261). Contract: [Editor and MCP fixes](../../spdd/prompt/2026-11-13-editor-mcp-fixes.md). Base: `main` at 06dce38. The pull request names the branch commits.

Platform: macOS host (Darwin 27.2.0, arm64). Node 26.13.0, pnpm 12.8.1, Rust 1.93.1. No app run. This file has no macOS app, WKWebView, or OBS result.

## #244: the Editor follows a new scene ID (R1 to R3, R12)

Commands: `pnpm exec vitest run --project unit packages/contracts/test/app-status.test.ts apps/desktop/test/editor-poll.test.ts`, `direnv exec . cargo test --workspace --no-fail-fast`.

| Check | Requirement | Old code | New code |
| --- | --- | --- | --- |
| `packages/contracts/test/app-status.test.ts` | R1: `AppStatusSchema` accepts `sceneId: 'scene_b'` and a status without it, and rejects `sceneId: ''` | Fail: `expected false to be true` (the strict schema rejects the key) | Pass |
| `crates/contracts/tests/app_status.rs` | R1: `validate_result("appStatus", …)` accepts `"sceneId": "scene_b"` and a status without it, and rejects `""` and a 257-character ID | Fail: `assertion failed: validate_result("appStatus", &status(json!({"sceneId":"scene_b"}))).is_ok()` | Pass |
| `apps/desktop/src-tauri/tests/service_integration.rs`, `service_real_loopback_relays_inspection_and_recovers_latest_frame` | R1: the host status has no `sceneId` before the first frame, and `"sceneId": "scene_main"` after a frame of `scene_main` | Fail: `left: Null`, `right: "scene_main"` | Pass |
| `apps/desktop/test/editor-poll.test.ts`, "follows a new scene ID …" | R2: a real session replaces the scene with `scene_other`; the next poll gives `error: null`, `sceneId: 'scene_other'`, revision 1, `marker` still selected; then `setVisibility('marker', false)` is `ok` | Fail: `error: "NOT_FOUND"`, `sceneId: "scene_smoke"`, revision 0 | Pass |
| `apps/desktop/test/editor-poll.test.ts`, "clears a selection …" | R2: the new scene has no `marker`; the selection is `null` | Fail: `error: "NOT_FOUND"`, `sceneId: "scene_smoke"`, `selectedId: "marker"` | Pass |
| `apps/desktop/test/editor-poll.test.ts`, "keeps a show opened in this window …" | R3: after Open Show in the Editor, a status from the older frame (old revision and old ID) does not give `NOT_FOUND` | Pass (no fault on the old code) | Pass. It fails when the poll uses the ID of an older frame (checked with a temporary change) |
| `apps/desktop/test/editor-model.test.ts`, unchanged | R3: Open Show with a new scene ID | Pass | Pass |

Full checks after the change: `pnpm check` pass; `pnpm test:unit` 248 files, 2178 tests pass, 1 skipped; `pnpm test:integration` 38 files pass, 2 skipped, 92 tests pass, 4 skipped; `cargo test --workspace --no-fail-fast` 557 pass, 0 fail, 2 ignored; `cargo clippy --workspace --all-targets` no warning.

Known limit: if a replace occurs between the status reply and the scene read of one poll, that poll gets `NOT_FOUND`. The next poll, 500 ms later, corrects it. The poll does not use the status ID when the status revision is lower than the held revision, because that frame is older than the held scene.
