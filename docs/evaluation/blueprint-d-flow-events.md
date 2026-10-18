# Evaluation: Blueprint flow, timers, events, and Blueprint control (slice D)

Date: 2026-10-18. Contract: [slice D](../../spdd/prompt/2026-10-18-blueprint-d-flow-events.md). Branch: `opensekai/bp-d-flow-events`. Base: `097d37a` (integration branch `opensekai/blueprint-depth` with slices W0, G, H, I, C, and A), merged in `e98b769`.

## Platform

| Item | Value |
| --- | --- |
| Host | macOS (Darwin 27.0.0), Apple silicon |
| Node | 26.12.0 |
| pnpm | 12.8.1 |
| App run | Not done. The desktop app was not started in this slice (bundle rule). See "macOS QA steps". |

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm check` | 8 packages and `tsconfig.scripts.json` pass. svelte-check: 5373 files, 0 errors, 0 warnings. |
| `pnpm test:unit` | 155 files, 1196 tests passed, 0 failed. |
| `pnpm test:integration` | 19 files passed, 1 file skipped; 51 tests passed, 2 skipped. The skip is `packages/renderer/test/two-vrm.integration.test.ts`, which needs local fixtures (not changed by this slice). |
| `cargo test -p opensekai-contracts` (shared `CARGO_TARGET_DIR`) | 71 passed, 0 failed. |
| `rustfmt --check` on `crates/contracts/src/lib.rs` and `crates/contracts/tests/blueprint.rs` | Clean. |

## New tests

| File | Level | What it covers |
| --- | --- | --- |
| `packages/session/test/blueprint-flow-events.test.ts` | Unit (13) | Do Once open, close, reset; Select lazy read for a typed port; Debounce reschedule (pure and through the runtime clock); timer start, restart, stop, repeat, catch-up, one-shot, and limit; Get Session Time and Is Blueprint Enabled; the event hop limit; the event budget; the listened-graph closure; control requests of a step that threw are dropped. |
| `packages/session/test/blueprint-events.integration.test.ts` | Integration (9), boundary: the session command API | A cross-graph event with a Boolean payload, the emitter receives its own event, one scene commit; `emitBlueprintEvent`; a runaway loop stops with `Blueprint event hop limit reached` and the session keeps ticking; On Disable once on disable, old version before new On Enable on a logic change, on removal, not for a version that never started, not on `replaceAll`; Enable, Disable, and Toggle Blueprint from another graph as a document change with a new Blueprint revision, the hotkey of the target stays registered, `Blueprint not found` for a missing target; On Disable of a graph at its timer limit starts a timer (the schedule is discarded first); `emitBlueprintEvent` reports only the errors of runs that it caused; a repeating timer with only `advance` calls; an inline value change keeps the state and runs no On Disable (value model R5). |
| `apps/mcp/test/blueprint-events.integration.test.ts` | Integration (1), boundary: stdio MCP | `blueprint_run` with `{ event, payload }` changes the scene; a mixed form and an object payload are rejected. |
| `packages/contracts/test/blueprint-run-params.test.ts` | Unit (1) | The two `blueprintRun` forms in `validateCall`. |
| `packages/contracts/test/blueprint-authoring.test.ts`, `blueprint-file.test.ts` | Unit (2) | A control node of the own graph targets the copy on duplicate and the new graph on import; another target is listed as missing (`blueprint`). |
| `fixtures/protocol/validation-vectors.json` | Shared vectors (2) | A `null` payload and a mixed form are rejected in TypeScript and Rust. |
| `crates/contracts/tests/blueprint.rs` | Rust | The two `blueprintRun` forms in `validate_call`. |

A mutation check: with the departure phase turned off, 2 of the 7 session integration tests fail (On Disable and Blueprint control). The code was restored before the commit.

## macOS QA steps (not done in this slice)

Run these in the integrated build (`/local-qa-e2e` on the bundle PR), with OBS for the visible effects:

1. Make graph A with Manual Trigger → Emit Event (`show`, payload Boolean, inline false). Make graph B with On Event (`show`, payload Boolean) → Set Visibility of an entity, `visible` from `payload`. Run A from the node menu. The entity hides in the editor and in OBS in the same frame.
2. Call `blueprint_run` with `{ "event": "show", "payload": true }` through MCP. The entity shows again.
3. Add On Disable → Toggle Visibility to graph B. Turn B off in the Blueprint list. The entity toggles once on the next frame. Turn B on again and change a node setting: the On Disable effect shows once, then the On Enable effect.
4. In graph A, add Manual Trigger → Disable Blueprint (target B). Run it. The Blueprint list shows B disabled without a reload, the show is marked unsaved, and a save and reopen keeps B disabled. Run Enable Blueprint: B is enabled and its On Enable runs.
5. Give graph B an On Keystroke Pressed hotkey. Disable B with Disable Blueprint, then enable it with Enable Blueprint while OpenSekai is not focused. The hotkey works without an editor edit.
6. Make a graph with On Enable → Start Timer (0.5 s, repeat) and On Timer → Toggle Visibility. Minimize the editor. In OBS the entity blinks at 1 Hz.
7. Make an On Event (`ping`) → Emit Event (`ping`) loop. Run it. The app does not stall; the Blueprint panel shows `Blueprint event hop limit reached`.
8. In the inspector, check the `Blueprint` select of Enable Blueprint: it lists the graphs of the show by name, and shows `Missing` after the target is deleted.

## Gaps

- No running-app or OBS evidence yet (steps above).
- The editor undo history and a runtime toggle: a `blueprint.*` toggle arrives as a remote change (client `opensekai-runtime`). An undo of an editor step that the toggle changed later is rejected as "Changed elsewhere" (catalog R14). Not checked in the app.
- The audit summary table in `blueprint-node-audit.md` is not updated (integrator file).
