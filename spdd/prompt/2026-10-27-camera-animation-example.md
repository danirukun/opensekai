# REASONS: Camera animation example

Analysis: [camera animation example](../analysis/2026-10-27-camera-animation-example.md). Issue: [#89](https://github.com/danirukun/opensekai/issues/89) (BP-09, slice 1). Queue bundle B24.

Status: contract only. The next intake run implements it after the owner merges this contract.

## R — Requirements

1. Set Asset Property (`property.set`) gets a second flow output `transitionEnd`, label `On Transition End`. `exit` keeps its meaning: it runs in the same run, when the write starts. A graph saved before this slice keeps its shape and its logic key. The node definition is the only catalog change, so the palette, the MCP node catalog (`opensekai://blueprint-nodes`), and the node audit see the new port from it.
2. When a run writes with Set Asset Property and the run commits, the end of that node is recorded as `{graphId, nodeId}`:
   - When the write starts a tween, the end belongs to that tween.
   - When the same target comes again during a running tween (the B13 H join rule), the end joins that tween. A tween keeps at most 8 ends, each `{graphId, nodeId}` once. A ninth distinct end fails the run with `Transition limit reached` and no state change.
   - When the write is immediate (no transition, 0 s, or a boolean property), or the value is already at the target, the end is pending for the next step.
3. A tween runs its ends only when it reaches its end on the session clock (`sampleTween` gives `done`). A tween that stops for any other reason (a scene patch that touches the property, an immediate write, a new tween to another target, a write failure, or a disabled, deleted, or changed graph) runs no end. A tween that a run fails to start records no end.
4. The ends of a tween that ends at session step N, and the pending immediate ends of step N, run on step N + 1 in Phase 3 of the runtime, after the due delays, debounces, and timers, in the order of their record. Each end is one run of its graph from `{nodeId, port: 'transitionEnd'}`, with the normal flow budget and the normal commit rule. An end whose graph is not enabled, whose graph logic changed after the record, or whose node is gone does not run. An unwired `transitionEnd` runs nothing.
5. The session keeps at most 64 pending ends. A write that would add more fails its run with `Transition limit reached` and no state change. Pending ends and tween ends are runtime state: they are never saved, put in a frame, or advanced by a renderer. A show open, `sceneReplace`, and the drop of a graph clear the ends of the affected graphs. A graph that has a pending end or a tween end counts as a transition owner (`transitionOwners`), so a disable, a deletion, or a logic change of that graph drops its ends, also when it owns no tween.
5a. Only the clock step (`advance`) takes the ends. The steps that `runBlueprint` and `emitBlueprintEvent` start do not run ends, but the ends that their runs record are kept for the next clock step. The ends that a step takes are a snapshot: an end recorded during step N + 1 runs on step N + 2 at the earliest.
5b. A loop keeps the property under a tween, so the B13 H idle commit (250 ms with no write and no tween) does not happen while the loop runs. The persistent scene and its revision do not change during the loop. The frames carry the moving value (the override layer). The last value commits 250 ms after the loop stops. This is the existing B13 H rule, and it does not change.
6. `compileBlueprint` does not count a connection from `transitionEnd` as an immediate flow edge, as for the `exit` of Delay and Debounce. So `B.transitionEnd → A.flow` and `A.exit → B.flow` is a valid loop (Different: Warudo rejects this loop and needs a function).
7. In the Editor window, a Set Asset Property node has a `Use current value` button. It sends one `setNodeInput` for the `value` input with the value of the target property of the target entity in the scene that the editor holds (the committed scene, `readProperty`), through the same path and undo stack as an inline edit. The button is disabled when `value` has a wire, when the target entity is missing, or when the editor has no scene. It is the OpenSekai form of Warudo Align Target With Main Camera and Align Target With Asset. While a Blueprint moves the property, the committed value is the value before the move (R5b); the operator sets poses while no loop runs.
8. The Templates menu gets `Camera Sway`. The camera is the selected camera, else the camera of `output_main`. Its current position `P`, rotation `R`, and field of view `F` give the graph (all transitions 3 s, easing `InOutSine`):
   - On Enable → Set Position to `P + rotate(R, [0.5, 0, 0])` → `exit` → Set Field of View to `max(1, F − 5)`;
   - that Field of View node `transitionEnd` → Set Position to `P` → `exit` → Set Field of View to `F`;
   - that Field of View node `transitionEnd` → the first Set Position node.
   The graph name is `Camera Sway`. It imports enabled, through `importBlueprint`, as Upper Body Rotation does, so the camera starts to move. The camera is the one `camera` reference of the template file, so an export and import remap it by name.
9. The Templates menu is enabled when the scene has fewer than 8 graphs. Each item is enabled when its own reference exists: Upper Body Rotation needs an avatar, and Camera Sway needs a camera. The menu items stay in one `Dropdown` from `@oshi-connect/ui`.
10. A viewport drag of the moving camera stops the loop, because the drag patch stops the tween and no end runs (R3). An operator restarts it with a disable and enable of the graph. This is the Warudo behavior.
11. MCP needs no new tool. `blueprint_edit` can wire `transitionEnd`, and `blueprint_inspect` shows the runtime errors. The `blueprint_edit` description names `transitionEnd` in one sentence.
12. Known gaps, not in this slice: Camera Orbit Character (orbit parameter interpolation; Approximate with a line move), Switch Main Camera with a fade, Blueprint functions (BP-01), an end output on Set Expression, Toggle Expression, Set BlendShape, and Look At, the karaoke example (needs audio playback, CHR-04 animation clips and profiles, and a prop on a hand bone), and the dance example (needs B25 streaming triggers, CHR-04 one-shot overlay animations, audio, and particles).

## E — Entities

- `property.set` ports: `inputs {flow, value}`, `outputs {exit, transitionEnd}`.
- `TransitionEnd`: `{graphId: Id, nodeId: Id}`.
- `PropertyTween` gains `ends: readonly TransitionEnd[]` (at most 8).
- The `setProperty` effect of Set Asset Property gains `nodeId: Id`. Other writers (Move Entity, Set Visibility) do not carry it and record no end.
- `advanceTweens` returns `{layers, failures, ended: TransitionEnd[]}`.
- The runtime step input gains `transitionEnds: readonly TransitionEnd[]`.
- Template file `packages/contracts/src/blueprint-templates/camera-sway.json` with one reference `{id: 'camera', kind: 'camera', name: 'Camera'}`, and `cameraSwayTemplate(camera: {id, name, position, rotation, fovDegrees}): BlueprintFile`, which sets the entity and the four inline `value` inputs.

## A — Approach

- Contracts: add the output to the `property.set` definition. Add `camera-sway.json` and `cameraSwayTemplate` next to `upperBodyRotationTemplate`. The pose math uses `rotateByQuaternion` from `property-registry.ts`.
- Session, compile: add `transitionEnd` to the Delay and Debounce exception in `compileBlueprint`. The exception is by port name for `property.set`, not by node type, so its `exit` still counts.
- Session, effects: the Set Asset Property evaluator puts its `nodeId` on the effect. `writeTransitioned` returns where the end goes: `tween` (started or joined) or `pending`. `startTween` adds the end to the new or joined tween and enforces the limit of 8.
- Session, step: `session.ts` keeps `pendingEnds` with the other runtime transition state. A run keeps its new pending ends on the same scratch copy as its tweens (`moving`), so a run that the gate rejects records no end. `advance` collects `ended` from `stepTweens` and the pending ends, and passes a snapshot to the next clock step. `transitionOwners` includes the graphs of the pending ends and the tween ends, and `dropGraphs` and the reset paths filter both.
- Runtime: Phase 3 runs the ends after the loop over due delays and timers, before input events. An end records the `logicKey` of its graph at the write. At the run, a key different from `Active.logic` means the logic changed, and the end does not run. No new counter: a kept entry keeps its `logic`, an inline input change is not in the key, and a disable and enable changes it.
- Editor: the `Use current value` button is in the node controls that `rete-editor.ts` draws for inline inputs. It calls the same `setNodeInput` helper with undo. `templates.ts` gets `cameraSway(scene, selectedId, newId)` and per-template availability; `BlueprintList.svelte` disables each item from it.
- MCP: one sentence in the `blueprint_edit` description.

## S — Structure

- New: `packages/contracts/src/blueprint-templates/camera-sway.json`; `packages/session/test/transition-end.test.ts`; `packages/session/test/camera-sway.test.ts`; `apps/mcp/test/transition-end.integration.test.ts`; `docs/evaluation/camera-animation-example.md` and its headless check script.
- Changed: `packages/contracts/src/blueprint-nodes/properties.ts`, `blueprint-templates/index.ts`, `index.ts`, and the template and catalog tests; `packages/session/src/blueprint.ts`, `blueprint-runtime.ts`, `tweens.ts`, `session.ts`, `blueprint-eval/properties.ts`, `blueprint-eval/types.ts`; `apps/desktop/src/blueprints/templates.ts` and `apps/desktop/src/blueprints/rete-editor.ts`, `apps/desktop/src/components/BlueprintList.svelte`, and `apps/desktop/test/blueprint-templates.test.ts`; `apps/mcp/src/server.ts` (the `blueprint_edit` description only); `docs/evaluation/blueprint-node-audit.md` and the audit data when the audit check needs the new port.
- Changed: `ARCHITECTURE.md` (Blueprint runtime path: transition ends run in Phase 3 on the next step; tween ends are runtime state).
- Changed: `docs/warudo-parity.md` BP-09 and BP-05 with only the verified behavior. BP-09 stays unchecked.
- No change: the Rust host and `crates/contracts` (the port name check is generic), the show format, the scene schema, the validation vectors, the renderer, the OBS page, Tauri IPC.

## O — Operations

1. Add the output to the node definition. Run the contract catalog and audit tests.
2. Add the compile exception with unit tests: the loop of R6 compiles; `A.exit → B.flow` and `B.exit → A.flow` on two Set Asset Property nodes is still an immediate cycle.
3. Add the tween ends with unit tests on a fake session clock: the end runs on the step after the tween ends and not before; a scene patch on the property, an immediate write, a new target, and a graph disable each stop the tween with no end; a join adds the end once; the ninth distinct end fails the run with no state change; an immediate write and a write to the current value run the end on the next step; a run that the gate rejects records no end; a disable of a graph with only a pending end (no tween) drops it; `runBlueprint` and `emitBlueprintEvent` steps do not run ends; the 65th pending end fails the run; a logic change after the record drops the end; an inline input change does not.
4. Add a session test for the loop of R6 on one camera: in the evaluated frame scene of `advance`, the position goes to B, then to A, then to B again on the session clock; the scene revision does not change during the loop (R5b); a scene patch on the camera position during a move stops the loop, and no end runs after it.
5. Add `cameraSwayTemplate` with unit tests: the four values from a camera pose (a rotated camera moves along its own right axis; a field of view of 3 gives 1); the template imports through `importBlueprint` with no `Missing` entry; export and import remap the camera.
6. Add the editor template item, per-template availability (a scene without an avatar enables Camera Sway only), and the `Use current value` button with a test of the `setNodeInput` it sends and of its disabled states.
7. Add the MCP integration test: build the R6 loop through `blueprint_edit` on the smoke scene with 0.5 s transitions and a Log node between each `transitionEnd` and the next Set Position, and enable it. `blueprint_debug_log` shows the two Log lines in turn, about 0.5 s apart in session time, and `blueprint_inspect` shows no error. A `scene_patch` on the camera position stops the loop: no Log line comes after it. MCP reads the committed scene, which does not move during the loop (R5b), so the test reads the ends through the debug log.
8. Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo fmt --check`, `cargo clippy`, and `cargo test --workspace` (the host does not change, but the workspace must stay green).
9. Run the Editor flow headless where WebGL works: pick Camera Sway in the Templates menu, see the graph with its loop, see the camera position change in the scene, press `Use current value` on a node and see the inline value and one undo step. If the flow cannot run headless, the parity line stays partial and names the flow that is not checked.
10. Ask a reviewer on a different model for defects against these requirements.
11. Update the parity lines with the source commit, the platform, the tests and captures, and the remaining gaps. Update `ARCHITECTURE.md`.

## N — Norms

Functional TypeScript and plain data. Match the compact style of `tweens.ts`, `define.ts`, and the Upper Body Rotation template. Controls come from `@oshi-connect/ui`. UI copy is the port label, the button label, and the template name, with no helper text (constitution principle 1). No badge on a moving camera (principle 2). Unit tests for the compile rule, the end rules, and the template math; an integration test at the MCP boundary; no test of static copy. Prose follows ASD-STE100.

## S — Safeguards

- Do not change the B13 H transition rules: the eased value, the join rule, the stop rules, and the commit 250 ms after the end stay as they are.
- Do not run an end in the same run or the same step as its write. An end always starts a new run on a later step, so a loop cannot run without the session clock.
- Do not save an end, a pending end, or a tween in the show or the scene.
- Do not change the show format, the scene schema, or the Rust host.
- Do not claim BP-09 on macOS or in OBS from the cloud run. The camera move in OBS, the InOutSine look, the motion while the editor is minimized, and a viewport drag that stops the loop need an owner check on macOS (`accept:local`).
