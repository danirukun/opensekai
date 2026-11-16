# Analysis: Editor and MCP fixes (scene ID after replace, manual run commit, node width)

Date: 2026-11-13. Scope: three defects, bundle B33. Issues: [#244](https://github.com/danirukun/opensekai/issues/244), [#245](https://github.com/danirukun/opensekai/issues/245), [#261](https://github.com/danirukun/opensekai/issues/261). Found in the [prop import check](../../docs/evaluation/prop-import.md) (Limits) and in a user screenshot. Related: [scene and show management](../prompt/2026-10-07-scene-show-management.md), [continuous Blueprints](../prompt/2026-10-12-continuous-blueprints.md), [camera animation example](../prompt/2026-10-27-camera-animation-example.md), [camera orbit and selection](../prompt/2026-11-07-camera-orbit-selection.md). Contract: [Editor and MCP fixes](../prompt/2026-11-13-editor-mcp-fixes.md).

The causes below come from the code at commit `06dce38`. Each statement says whether a test, a committed image, or only a code reading supports it.

## Problem

1. **#244.** After MCP `scene_replace` with a scene that has a new `sceneId`, the Editor shows `NOT_FOUND`. Each Editor edit and Save then fail. A second `scene_replace` with the old ID repairs the view.
2. **#245.** MCP `blueprint_run` sent at once after `blueprint_edit` `createGraph` replies `ok`, and `scene_inspect` then shows the old property value. The same run 2 s later "works".
3. **#261.** On a Set Asset Property node with a three-component value, the last number input is under the output label "On Transition End", and the "Use current value" button touches the inputs.

## Current behavior

### #244 (cause read in code; one defect)

- The session has one scene. `sceneReplace` takes the `sceneId` of the given scene (`packages/session/src/session.ts:282-300`). `sceneInspect`, `scenePatch`, and `proposalApply` answer `NOT_FOUND` for any other ID (`packages/session/src/session-api.ts:10-12`, `session.ts:349-350`, `session.ts:381-382`).
- The Editor model keeps the scene ID only inside the scene that it holds. Each read sends that ID (`apps/desktop/src/editor/model.ts:23`). A failed read publishes the error code and keeps the old scene (`model.ts:25`).
- The Editor learns of an external change from its 500 ms poll. `appStatus.revision` differs from the held revision, so the poll calls `model.load()` (`apps/desktop/src/editor-poll.ts:24`). `appStatus` has no scene ID, so the model asks with the old ID again. The reply is `NOT_FOUND` on each poll.
- The Open Show action of the Editor does not have the fault, because the model takes the scene from the `sceneReplace` reply (`model.ts:58-76`; test `apps/desktop/test/editor-model.test.ts:20-25`).
- The host does not use the scene ID. It keeps the latest frame, and the frame holds the scene with its ID. `appStatus.revision` comes from that frame (`apps/desktop/src-tauri/src/service/router.rs:336`).

### #245 (cause read in code and stated by two tests; not confirmed on the running app)

- The cause that the issue names (the runtime loads the new graph late) is not possible. `store.edit` compiles the graph and installs it in the runtime before it replies (`packages/session/src/blueprint-store.ts:50-60`, `packages/session/src/blueprint-runtime.ts:127-142`). The session handles calls in order (`packages/session/src/worker.ts:84-86`).
- `runBlueprint` already refuses a graph or a trigger that is not loaded: `NOT_FOUND` for a missing graph, `INVALID_INPUT` for a disabled graph or a missing Manual Trigger (`session.ts:316-320`).
- The run does occur. Set Asset Property does not write to the committed scene. It writes an override (`packages/session/src/tweens.ts:125-136`). The step commits only scene effects (`session.ts:203-204`), so `blueprintRun` replies `ok` with the old revision.
- `sceneInspect` returns the committed scene without overrides (`session.ts:281`). An override commits at the first clock step that is 250 ms or more after its last write (continuous Blueprints R11; `packages/session/src/overrides.ts:14`, `session.ts:235-242`).
- So `scene_inspect` in the first 250 ms after the run shows the old value. The "second run that works" reads the value that the first run committed. `createGraph` is not part of the cause.
- Tests that state the rule: `packages/session/test/blueprint-value-model.test.ts:30-31`, `packages/session/test/transitions-session.test.ts:62-69`, `apps/mcp/test/transition-end.integration.test.ts:5-6`.
- Move Entity, Camera Orbit Character without a transition, and a custom event (`emitBlueprintEvent`) have the same behavior.

### #261 (cause read in CSS; the fault is visible in a committed image)

- All nodes use one view and one style block (`apps/desktop/src/components/BlueprintNodeView.svelte:55-92`, `apps/desktop/src/app.css:66-93`).
- `.bp-node` has `max-width:260px`. The node body is a flex row of an input column and an output column with a 14 px gap. Each column has `min-width:0`, so it can shrink below its content. Rows do not wrap and overflow is visible. When the two columns need more than the node width, the content of each column goes over the other column.
- Set Asset Property has the inputs `flow`, `value` and the outputs `exit`, `transitionEnd` (`packages/contracts/src/blueprint-nodes/properties.ts:10`). The `value` row and the "On Transition End" row are the same row. With a vector editor that row needs about 281 px (estimate from the CSS); the node gives 258 px.
- `docs/evaluation/camera-animation-example/camera-sway-graph.png` (headless Chromium, 2026-10-27) shows the fault: each vector node is 260 px wide, and the third input is under the label by about 12 px. The nodes with a number value are about 213 px wide and correct.
- `.bp-node-action` has no top padding (`app.css:88`), so the button starts about 1 px below the inputs.
- By the same estimate, no other node type in the catalog reaches 258 px today. The fault is in shared CSS, so each future node with a wide row gets it.
- The canvas zoom is a CSS transform of the Rete area. Node layout does not change with the zoom. The code sets no zoom limits and no zoom steps. The Editor has no Zoom to Fit control; the canvas fits the graph only when a graph opens (`apps/desktop/src/blueprints/rete-editor.ts:287`).

## Decision

- **#244: the Editor follows the new scene ID.** The scene and show design already says "The editor updates its scene ID and clears selection", and Open Show uses the same `sceneReplace` call with the ID of the file. Alternative: `scene_replace` refuses an ID change. Rejected: it contradicts that design and breaks Open for a show file with another ID.
- **#244: `AppStatus` gets an optional `sceneId`.** The host fills it from the latest frame, as it fills `revision`. The Editor poll gives it to the model. Alternative: the Editor reads the ID from its preview frames. Rejected: it makes a second source of the scene ID in the window and does not help an MCP client. Alternative: `sceneInspect` without an ID. Rejected: it changes the meaning of an existing call on both sides.
- **#245: a manual run and a custom event commit their writes that have no transition before the reply** (owner decision). The reply revision and the next `scene_inspect` show the new value. Runs of a clock step keep the 250 ms rule. This changes continuous Blueprints R11. Alternative: keep the rule and add a field to the result. Rejected: the caller must still wait. Alternative: change only the tool text. Rejected: the fault stays for each MCP client, and no test fails on the old code.
- **#245: no new check for "trigger not loaded".** The session already returns `NOT_FOUND` or `INVALID_INPUT`, and tests cover it. A branch for "no run found" is not reachable through the real store, so it gets no code.
- **#261: the node grows to fit its content, on one row, and the button gets 4 px of top spacing** (owner decision). Alternative: the vector editor moves to its own row. Rejected: each vector node gets taller and the node look changes. Alternative: a higher fixed limit. Rejected: the next long label breaks it again.
- **No change of the show file, the scene schema, or the Blueprint file.** One optional field is added to the `appStatus` result.

## Risks

- The #245 cause is from a code reading. The first test of that fix (a run with no clock) must fail on the old code. If it passes, the cause is wrong and the work on #245 stops.
- Existing session tests state the old rule for a manual run (for example `transitions-session.test.ts:62-69` and the hide and show test in `property-nodes.test.ts`). They must change with the contract. Some tests use a manual run only to make an override for another behavior (the Orbit Character follow tests). After the change that override commits at once, so such a test must start its write from a clock step to keep its meaning.
- A property that a manual run and an On Update graph both write commits at each manual run. This adds revisions. It does not make a wrong value.
- `AppStatus` is strict in TypeScript and in Rust. Both sides must change in one commit.
- The #261 widths are estimates from CSS and one Chromium image. The headless check measures them. WKWebView has other font widths; only a run of the macOS app proves the look there.
- With no width limit, a future node with a very long row makes a very wide node. Today each label and each editor has a short or fixed width.
