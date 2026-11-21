# REASONS: Editor and MCP fixes

Date: 2026-11-13. Scope: three defect fixes, bundle B33 ([#244](https://github.com/danirukun/opensekai/issues/244), [#245](https://github.com/danirukun/opensekai/issues/245), [#261](https://github.com/danirukun/opensekai/issues/261)). Analysis: [Editor and MCP fixes](../analysis/2026-11-13-editor-mcp-fixes.md). This contract replaces R11 of [continuous Blueprints](2026-10-12-continuous-blueprints.md) and its safeguard "Commit only under the R11 rule" for the calls that R4 names. It adds one optional field to the `appStatus` result of the call API.

## R — Requirements

### Scene ID after a replace (#244)

R1. `AppStatus` has an optional `sceneId` (an ID), in TypeScript and in Rust. The host sets it to the scene ID of the latest frame, from the same frame as `revision`. Before the first frame it is absent.
R2. When another client replaces the scene with a scene that has a new `sceneId`, the next Editor poll loads the new scene. The Editor model then holds the new scene and no `NOT_FOUND` error. A selected entity stays selected only when its ID is in the new scene. Each later Editor edit and Save use the new ID.
R3. `sceneReplace` and MCP `scene_replace` accept a scene with a new `sceneId`, as before. The Open Show action of the Editor does not change. Just after Open Show, a status from an older frame (a lower revision with the old ID) does not give a `NOT_FOUND` error. After a session restart (the revision starts again from 0 with a new scene ID), the next poll loads the scene of the status ID, also when the status revision is lower than the held revision.

### Commit of a manual run (#245)

R4. `blueprintRun` (a Manual Trigger, or a custom event) commits each property override that a run of its step wrote, before it replies. The override writes are: Set Asset Property without a transition (or on a boolean property), Move Entity, Camera Orbit Character without a transition, and Set and Reset Character and Prop Material Property without a transition (B38). The reply `revision` is the revision after that commit, and `sceneInspect` after the reply shows the values.
R5. A run of a clock step (On Update, keystroke, device, tracking, YouTube, timer, delay, On Transition End) keeps continuous Blueprints R11: its overrides commit 250 ms after the last write. A `blueprintRun` call does not commit an override that its step did not write.
R6. A write with a transition does not commit in the call. The reply is `ok` with the current revision, and the value commits after the transition ends, as before. The `blueprint_run` tool text says which writes are in the reply revision.
R7. When the commit of R4 fails, the reply is that error, the overrides of the failed commit are removed, and the error is the runtime error of each graph that wrote them (the R11 rule for a failed commit). A write that does not change the value makes no commit and no new revision. This is also true when the value is already in a pending override of another run (a clock step less than 250 ms ago, or a transition that ended less than 250 ms ago), with or without a transition on the write: that override commits by the R5 rule, not in the call. On Transition End of a write still runs on the next clock step.

### Node width (#261)

R8. A Blueprint node is as wide as its rows need. In a node, no label, inline editor, socket, or button overlaps another, and each one is inside the node rectangle (a socket can extend 9 px outside, by design). This is true for Set Asset Property with a vector, a number, a boolean, and a wired value, and for Camera Orbit Character, Lerp Vector3, Move Towards Vector3, and a node with three text inputs.
R9. The top of the "Use current value" button is 4 px or more below the last port row.
R10. Each node type that was correct before keeps its width (a difference of 1 px or less). A Debug Value node with long text is 260 px wide or less.
R11. A headless check of the built Editor window measures R8 to R10 at a canvas zoom of 50%, 100%, and 200%, and in the view that the canvas has when the graph opens (the fit to the graph). The pull request has one screenshot of each. The owner judges the look in review.

### Evidence

R12. Each of the three fixes has a test or a named check that fails on the old code and passes on the new code. The evidence record has both results.

## E — Entities

- `AppStatus` (wire result of `appStatus`): adds `sceneId?: Id`. No other wire, scene, show, or Blueprint file change.
- Session `OverrideLayer`: no change of shape. The commit of R4 selects entries by entity and property key.
- No new entity in the Editor. No new control and no new text in the Editor.

## A — Approach

For each fix, write the failing test first, record its result on the old code, then change the code.

- #245 first, as a gate: a session test and an MCP stdio test, each with no clock, run on the old code. If one of them passes on the old code, the cause in the analysis is wrong: stop the work on #245, change nothing for it, and report. Do not make another fix.
- #244: add the field on both sides of the contract and in the host, then give it from the Editor poll to the model.
- #245: in the session, record the property keys that the runs of a step wrote. After the step of a `blueprintRun` call, commit those keys with the same operation builder as the idle commit. A key under a transition is not taken.
- #261: change the shared node CSS only. Prove it with a geometry check in headless Chromium.

## S — Structure

- `packages/contracts/src/schema.ts`, `packages/contracts/src/types.ts`, `crates/contracts/src/lib.rs` (the field). Tests: `packages/contracts/test/`, `crates/contracts/tests/`.
- `apps/desktop/src-tauri/src/service/router.rs`; `apps/desktop/src-tauri/tests/service_integration.rs`.
- `apps/desktop/src/editor-poll.ts`, `apps/desktop/src/editor/model.ts`; `apps/desktop/test/editor-poll.test.ts`.
- `packages/session/src/overrides.ts`, `packages/session/src/session.ts`; `packages/session/test/manual-run-commit.test.ts` (new), the session tests that state the old rule.
- `apps/mcp/src/server.ts` (the `blueprint_run` text); `apps/mcp/test/blueprint-run-commit.integration.test.ts` (new).
- `apps/desktop/src/app.css`.
- `spdd/prompt/2026-10-12-continuous-blueprints.md` (R11 and its safeguard), in the commit of the #245 fix.
- `docs/evaluation/editor-mcp-fixes.md` and `docs/evaluation/editor-mcp-fixes/` (new: the check script, its output, the screenshots).
- `ARCHITECTURE.md` (Command path, Blueprint runtime path), `docs/mcp-client-setup.md`.
- `fixtures/protocol/validation-vectors.json` does not change: it has no vector for the `appStatus` result.

## O — Operations

1. Gate: the two #245 tests with no clock, on the old code.
2. Spec commit: this contract and its analysis.
3. #244: contract tests on both sides, the host test, the Editor poll test; then the field, the host, the poll, and the model; the two documents.
4. #245: the session commit, the tool text, the changed older tests, the continuous Blueprints text, `ARCHITECTURE.md`.
5. #261: the check script and its result on the old CSS; the CSS change; the result and the screenshots on the new CSS.
6. Full checks, the evidence record, and the report.

## N — Norms

- Unit tests for the session commit rule and the Editor poll and model. They use a real session (`createSession`, `sessionApi`). Only the host status is a fake in the Editor test, because the host is not the unit under test.
- Integration tests at real boundaries only: the MCP stdio protocol (#245) and the host WebSocket service (#244).
- No fixed sleep for an effect in another task. The #245 tests need no wait, because the fixture has no clock.
- An older test that states the old R11 rule for a manual run changes with this contract. An older test that uses a manual run only to make an override for another behavior keeps that behavior: its write moves to a clock step. Each changed test is listed in the pull request with its reason.
- No unit test for CSS. The headless check of the built Editor window is the proof, in Chromium only.
- Prose in Simplified Technical English. No new UI text.

## S — Safeguards

- Do not make `scene_replace` refuse a new `sceneId`.
- Do not make `sceneInspect` return overrides. The revision must change when the committed scene changes.
- Do not change the 250 ms rule for a run of a clock step.
- Do not commit an override that a transition holds.
- Do not add a result field to `blueprintRun`, and do not add a "no run found" branch.
- Do not change a node label, a node control, the node view component, or the Inspector. CSS only.
- Do not add a dependency, a browser test runner, or an image comparison library.
- Do not change `fixtures/protocol/validation-vectors.json`.
- Do not claim a macOS, WKWebView, or OBS result. The headless check proves the geometry in Chromium only.
