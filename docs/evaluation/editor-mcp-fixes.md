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

## #245: a manual run commits its writes before the reply (R4 to R7, R12)

### Gate on the old code

The cause came from a code reading. Two tests with no clock step after the run were written first and run on the unchanged code (06dce38 plus the tests):

```text
$ pnpm exec vitest run --project unit packages/session/test/manual-run-commit.test.ts
 × commits the write of a manual run before the reply, with no clock step after the run
AssertionError: expected { ok: true, data: { revision: +0 } } to deeply equal { ok: true, data: { revision: 1 } }
 Test Files  1 failed (1)
      Tests  1 failed (1)

$ pnpm exec vitest run --project integration apps/mcp/test/blueprint-run-commit.integration.test.ts
 × shows the write of blueprint_run in its reply revision and in the next scene_inspect, with no clock step
AssertionError: expected { ok: true, data: { revision: +0 } } to deeply equal { ok: true, data: { revision: 1 } }
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

A temporary test (not committed) confirmed that the run occurs on the old code, and that only the committed scene keeps the old value:

```text
GATE reply {"ok":true,"data":{"revision":0}} inspect revision 0 inspect position [0.9,0.7,0] before [0.9,0.7,0]
GATE advance(32).scene position [1,2,3]
```

The gate held, so the fix went ahead.

### Checks

| Check | Requirement | Old code | New code |
| --- | --- | --- | --- |
| `manual-run-commit.test.ts`, no clock step after the run | R4: the reply is revision 1 and `inspect()` has the position | Fail (revision 0) | Pass |
| `blueprint-run-commit.integration.test.ts` (MCP stdio, real session, no fixture clock) | R4: `blueprint_run` replies revision 1 and the next `scene_inspect` has the position | Fail (revision 0) | Pass |
| `manual-run-commit.test.ts`, custom event | R4: `emitBlueprintEvent` replies the new revision | Fail | Pass |
| `manual-run-commit.test.ts`, Move Entity | R4 | Fail | Pass |
| `manual-run-commit.test.ts`, Camera Orbit Character without a transition | R4 | Fail | Pass |
| `manual-run-commit.test.ts`, Set Asset Property with `transitionSeconds: 1` | R6: the reply has the old revision; the value commits 250 ms after the end | Pass | Pass |
| `manual-run-commit.test.ts`, keystroke run in a clock step | R5: a write at 32 ms commits at 282 ms, not at 281 ms | Pass | Pass |
| `manual-run-commit.test.ts`, On Update graph and a manual graph | R5: the manual run commits only its own write; the On Update override stays | Fail | Pass |
| `manual-run-commit.test.ts`, write of the current value | R7: no commit, old revision | Pass | Pass |
| `manual-run-commit.test.ts`, wired On Transition End | R7: the write commits in the call; the end runs on the next clock step | Fail | Pass |
| `manual-run-commit.test.ts`, failed commit (scene at the revision limit) | R7: the reply is `Revision limit reached`, the override is gone, and the graph has the runtime error | Fail | Pass |
| `overrides.test.ts`, forced keys | `takeIdle` takes a forced key before 250 ms and never a busy key | New test | Pass |

### Older tests that changed

| Test | Reason |
| --- | --- |
| `transitions-session.test.ts`, "keeps an old graph without transition settings immediate" | It stated the commit time of a manual write. The revision is now 1 after the run. |
| `property-nodes.test.ts`, "hides and shows the environment …" | It stated the commit time of a manual write. Each run reply now has the new revision, and `inspect()` shows the value after the run. |
| `blueprint-files.integration.test.ts`, "nudge sets the position after a run and commits it 250 ms later" | It stated the commit time of a manual write. Renamed to "nudge sets the position and commits it before the run reply". |
| `camera-orbit-node.test.ts`, "drops the camera position and rotation overrides on a setCameraNavigation patch" | It used a manual run only to make a camera override. The write now comes from a keystroke in a clock step, so the patch still drops a live override. |
| `camera-orbit-node.test.ts`, "orbits the evaluated character while a Blueprint override moves it …" | It used a manual run only to make a character position override. It passed without the override, so the write now comes from a keystroke in a clock step. |
| `camera-orbit-node.test.ts`, "keeps a moved orbit position follow-relative …" | It used two manual runs only to make follow-relative camera overrides. It passed without the overrides, so both writes now come from keystrokes in clock steps. |
| `camera-orbit-node.test.ts`, the comment in "writes the position and rotation …" | Comment only: the run commits the values, not the idle commit. |
| `blueprint-value-model.test.ts`, the comment of `runAndCommit` | Comment only: the run commits its write before the reply. |

The continuous Blueprints contract R11 has the exception, and its safeguard names it. The `blueprint_run` tool text says which writes are in the reply revision. `docs/warudo-parity.md` does not change: BP-01 and BP-05 describe clock-step writes and transitions, which keep the 250 ms rule.

A property that a manual run and an On Update graph both write commits at each manual run. This adds revisions; it does not make a wrong value.
