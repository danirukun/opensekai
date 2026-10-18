# REASONS: Blueprint flow, timers, events, and Blueprint control (slice D)

Date: 2026-10-18. Scope: slice D of bundle B13 ([plan](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md)): Do Once, Debounce, Select, On Disable, timers, custom events between graphs, and Blueprint control nodes. Analysis: [slice D](../analysis/2026-10-18-blueprint-d-flow-events.md). Issues: #81, #83. Parity items: BP-01, BP-03. This contract adds to R5, R6, and R8 of the [catalog contract](2026-10-09-blueprint-catalog.md), decides R5 of the [value model contract](2026-10-18-blueprint-w0-value-model.md), and adds to R4b of the [transitions contract](2026-10-18-blueprint-h-transitions.md).

## R — Requirements

R1. **Do Once** (`flow.doOnce`, category Flow). Inputs `flow` and `reset` (flow). Output `exit`. The first entry at `flow` continues at `exit` and closes the node. A closed node stops each later entry at `flow`. An entry at `reset` opens the node and continues nowhere. The state is in the generic node state (W0 R8) and resets with the graph (catalog R5).

R2. **Debounce** (`flow.debounce`, category Flow). Setting `seconds` (0.01 to 3600, default 0.5). Input `flow`. Output `exit`. Each entry schedules the node to continue at `exit` when `seconds` of session time pass, and removes the earlier schedule of the same node. So the node continues once, `seconds` after the last entry of a burst. The schedule is a pending delay of the graph: it counts toward the 32 delays of the graph, it fires in the due-delay phase of a step (R10), and it resets with the graph.

R3. **Select** (`flow.select`, category Flow). Setting `type`: a data type (W0 R1), default `number`, field kind `choice`. Inputs `condition` (boolean), `ifTrue` and `ifFalse` (the selected type). Output `value` (the selected type). It reads only the input that `condition` selects. A change of `type` removes the wires and inline values that no longer fit (W0 R5).

R4. **On Disable** (`event.disable`, category Events). Output `flow`.
- A version of a graph departs when an edit disables the graph, removes it, or changes its logic key, and the version is enabled and has started (its On Enable phase ran in a step). A version that never started does not run On Disable.
- At the start of the next step, before each other phase (R10), each departing version runs each of its On Disable nodes in node order, with its last committed state and its compiled logic. The new version of the graph does not run before this.
- Departing versions run in the order of the installed list before the edit.
- The departure phase has its own budget: 1024 flow visits and 64 effects for each step, and the limit of 512 visits for each run (catalog R8).
- The pending delays, debounce schedules, and timers of a departing version are discarded before its On Disable runs. Delays, debounces, and timers that an On Disable run requests are discarded.
- Effects of an On Disable run go through the run gate (catalog R7).
- Custom events that an On Disable run emits are delivered after the On Enable phase of the same step (R7).
- Blueprint control requests of an On Disable run apply after the step (R9).
- The edit stops the transitions of the departing graph first (transitions R4b, at the edit). A transition that an On Disable run starts is not stopped by that departure. It runs to its end, or it stops at the next edit that finds its graph disabled, removed, or changed (transitions R4b).
- `replaceAll` (a show open, `fresh` install) discards all versions and runs no On Disable, because the graphs of the old show must not change the new scene.

R5. **Timers** (category Timer).
- **Start Timer** (`timer.start`): settings `name` (string, 1 to 64 characters, default `Timer`) and `repeat` (boolean, default `true`). Inputs `flow` and `seconds` (number; an unconnected input without an inline value reads 1). Output `exit`. It starts the timer `name` of its graph, due `seconds` after the session time of the run. `seconds` is clamped to 0.01 to 3600; a value that is not finite fails the run. A timer that already runs restarts.
- **Stop Timer** (`timer.stop`): setting `name`. Input `flow`. Output `exit`. It removes the timer `name` of its graph. An unknown name does nothing.
- **On Timer** (`timer.on`): setting `name`. Output `flow`. When the timer `name` of its graph is due, each On Timer node with that name runs, in node order.
- A due repeating timer becomes due again `seconds` after its previous due time. When that time is not after the current step, it becomes due `seconds` after the current step, so a timer fires at most once in each step. A due one-shot timer is removed.
- A graph has at most 16 timers. A run that starts a 17th timer fails with `Blueprint timer limit reached` and changes no state.
- Timers are runtime state of the graph version. They reset with the graph (catalog R5) and continue on the session clock with no editor and no Blueprint run.
- **Get Session Time** (`timer.sessionTime`): output `seconds` (number): the session time of the run in seconds.

R6. **Custom events** (category Events).
- **Emit Event** (`event.emit`): settings `name` (string, 1 to 64 characters, default `Event`) and `payload` (`none` or a data type, default `none`, field kind `choice`). Inputs `flow` and, when `payload` is a type, `payload` of that type. Output `exit`. It emits the event `name` with the payload value, or with no payload.
- **On Event** (`event.custom`): settings `name` and `payload` as Emit Event. Outputs `flow` and, when `payload` is a type, `payload` of that type. It runs for each delivered event with the same name (case-sensitive).
- The `payload` output gives the payload of the event that started the run, when the payload is a value of the output type (W0 R2). Else it gives the default of the type. The value stays in the node state until the next event, so a later run of the graph reads the last payload.

R7. **Event delivery.**
- An emitted event goes to a FIFO queue of the step when its run commits. The runtime drains the queue after each run, before the next run of the step. In the departure phase and the On Enable phase the queue waits until the On Enable phase ends (R4, R10), so a new version does not receive an event before its On Enable runs.
- A delivery visits each enabled graph in the installed order (the emitter too), and in each graph each On Event node with the event name, in node order. Each match is one run with its own state copy and run gate.
- An event has a hop count. An event from a run that an input, a delay, a timer, On Enable, On Disable, or `blueprintRun` started has hop 1. An event from a run that an event of hop h started has hop h + 1. The hop limit is 8.
- A step delivers at most 64 events (the event budget).
- A run that emits an event above the hop limit fails with `Blueprint event hop limit reached`. A run that emits an event above the event budget fails with `Blueprint event limit reached`. The failed run changes no state, emits no event, and its effects do not apply. So a loop of events stops in the same step with a runtime error.
- Deliveries use the flow budget of the step (catalog R8).

R8. **Blueprint control** (category Blueprints). Field kind `graph` (appended to `BlueprintField`): a select of the graphs of the show by name, with a `Missing` entry for an ID that is not in the show. `DefaultRefs` gains `graphId` (the graph that the node is added to). Each node has the setting `graphId` (default: the graph of the node).
- **Enable Blueprint** (`blueprint.enable`), **Disable Blueprint** (`blueprint.disable`), **Toggle Blueprint** (`blueprint.toggle`): input `flow`, output `exit`. Each records a control request when its run commits.
- **Is Blueprint Enabled** (`blueprint.isEnabled`): output `enabled` (boolean): the enabled flag of the target graph at the start of the step. An unknown graph reads `false`.

R9. **Control requests apply as a document edit.**
- After a step, the session reads the control requests of the step in run order. It starts from the current enabled flag of each target and applies each request: enable sets true, disable sets false, toggle inverts the current value. A target whose final value equals its stored flag is not changed.
- The session applies the changed flags in one batch of `updateGraph { enabled }` operations through the same path as an editor edit (client ID `opensekai-runtime`). The batch increments the Blueprint revision. The editor list, `blueprintInspect`, and the show save show the change. The toggle is persisted with the show.
- The rules of an editor edit apply: an enabled graph gets a new state and runs On Enable on the next step (catalog R6); a disabled graph departs (R4); transitions stop (transitions R4b).
- A request for a graph that is not in the show, or that has no valid version, sets the runtime error `Blueprint not found` on the graph of the request.
- A step applies at most one control batch. A request that an On Disable run makes applies after its step.

R10. **Step order.** A step runs these phases in order:
1. Departures: On Disable of each departing version (R4).
2. On Enable of each new state (catalog R6), then delivery of the events that phases 1 and 2 emitted, in FIFO order.
3. Due delays, debounces, and timers, merged by due time, then by schedule order.
4. Input events in their order: keystroke, device, `blueprintRun` (Manual Trigger or event), On Update.
After each run in phases 3 and 4, the runtime delivers the events of that run (R7). After the step, the session applies the control requests (R9).

R11. **Reported key and device sets.** The accelerator set, the held-key set, and the device set come from the listened graphs: each enabled graph, and each graph that an Enable Blueprint or Toggle Blueprint node of a listened graph names (transitive). So a node that enables a graph does not change the sets, and the host needs no new report. The edit limits of 64 accelerators and 16 held keys apply to these sets. Events of a disabled graph still start no run.

R12. **MCP and protocol.** `blueprintRun` accepts a second form `{ event, payload? }`: `event` is an event name (1 to 64 characters), and `payload` is a scalar value (W0 `ScalarValue`). The session delivers the event as a hop-1 event in a step at the session time of the last advance. It replies `{ revision }`, or the first runtime error of the delivery runs. A name with no On Event node in an enabled graph is not an error. The Rust contracts validate the two forms. The `blueprint_run` tool description names the event form.

R13. **R5 of the value model.** Inline input values stay out of the logic key. An inline value change applies to the next run with the kept state. It does not reset the graph, does not fire On Disable or On Enable, and does not clear a runtime error.

R14. **Audit.** `docs/evaluation/blueprint-node-audit.json` has one row for each new node type, with the Warudo category candidate (Flow Control, Timer, Events, Blueprints), the candidate name, and `evidence: "tests"`. The catalog count test counts the new node types.

R15. **Tests.**
- Unit: Do Once open, close, and reset; Debounce reschedule; Select both branches and lazy read; timer due rule (repeat, one-shot, catch-up, restart, stop, limit); event hop limit and event budget; the listened-graph closure.
- Session (`createSession`): a cross-graph event with a payload; an emitter that receives its own event; On Disable once on disable and once on a logic change, before the new On Enable; no On Disable on `replaceAll`; Enable and Disable Blueprint from another graph, shown in `inspectBlueprints`; a timer that fires with only `advance` calls; a runaway event loop that stops with a runtime error; an inline value change that keeps the state (R13); the event form of `blueprintRun`.
- MCP stdio: `blueprint_run` with an event.
- Rust: the two `blueprintRun` forms.

## E — Entities

- Node types: `flow.doOnce`, `flow.debounce`, `flow.select`, `event.disable`, `event.emit`, `event.custom`, `timer.start`, `timer.stop`, `timer.on`, `timer.sessionTime`, `blueprint.enable`, `blueprint.disable`, `blueprint.toggle`, `blueprint.isEnabled` (14).
- `BlueprintField` adds `{ key; label; kind: 'graph' }`. `DefaultRefs` adds `graphId?: string`.
- Session (not protocol): `RuntimeRequest = { kind: 'emit'; name; payload } | { kind: 'control'; graphId; action: 'enable' | 'disable' | 'toggle' } | { kind: 'startTimer'; name; seconds; repeat } | { kind: 'stopTimer'; name } | { kind: 'debounce'; seconds }`. `FlowContext.request(request)`. `FlowResult.requests`. `RunEnv.nowMs?`, `RunEnv.graphEnabled?` (declaration merging, as slice I does for devices).
- Runtime entry adds `timers` (name → due time, interval, repeat, order) and keeps departing entries until the next step.
- `BlueprintEvent` adds `{ kind: 'custom'; name; payload }`.
- `BlueprintRuntime` adds `takeControlRequests()`. `GraphRun` adds an optional `nodeId` (the node that started the run), so `blueprintRun` reports the error of its own Manual Trigger run when events run after it.
- `blueprintRun` params: `{ graphId, triggerNodeId } | { event, payload? }`.

## A — Approach

Add the node definitions in the owned family files (`flow.ts`, `events.ts`) and two new family files (`timer.ts`, `graph-control.ts`). Add one request channel from a run to the runtime, so the effect union (slice F) does not change. Keep the new runtime phases as new branches and new helper functions in `blueprint-runtime.ts`, so the merge with other slices stays small. Apply control requests in the session through the existing edit path. Extend `blueprintRun` with an optional form, not a new method.

## S — Structure

- `packages/contracts/src/blueprint-nodes/`: `flow.ts`, `events.ts`, new `timer.ts`, new `graph-control.ts`, `define.ts` (append `graph` kind and `graphId` ref), `index.ts` (append registrations, sample ref).
- `packages/contracts/src/schema.ts`, `types.ts` (`blueprintRun` params).
- `packages/session/src/blueprint-eval/`: `flow.ts`, `events.ts`, new `timer.ts`, new `graph-control.ts`, new `requests.ts`, `index.ts` (append).
- `packages/session/src/blueprint.ts` (`runFlow`: request channel only), `blueprint-runtime.ts`, `blueprint-store.ts` (listened sets), `session.ts`, `session-api.ts`.
- `apps/desktop/src/components/BlueprintNodeFields.svelte`, `BlueprintPanel.svelte` (graph field and ref).
- `apps/mcp/src/server.ts` (description).
- `crates/contracts/src/lib.rs`, `crates/contracts/tests/blueprint.rs`.
- Tests in `packages/session/test`, `packages/contracts/test`, `apps/mcp/test`. `docs/evaluation/blueprint-d-flow-events.md`, `docs/evaluation/blueprint-node-audit.json`.

## O — Operations

1. Commit this contract and the analysis.
2. Contracts: node definitions, field kind, refs, audit rows, catalog count.
3. Session: the request channel, Do Once, Debounce, Select, timers, Get Session Time, events, On Disable, control requests, the listened sets. Unit and session tests.
4. Protocol: the `blueprintRun` event form in TypeScript and Rust; MCP description and stdio test.
5. Editor: the `graph` field and the `graphId` ref.
6. Evaluation note, `pnpm check`, unit and integration tests, `cargo test -p opensekai-contracts`.

## N — Norms

Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript and plain data. Use `@oshi-connect/ui` controls. Keep UI copy to node labels, field labels, and `Missing`. Append to shared unions and registration lists; do not reorder them.

## S — Safeguards

- Do not let an event loop, a timer, or a control request hang a step: each has a limit (R5, R7, R9).
- Do not let a failed run change state, emit events, schedule timers, or record control requests.
- Do not add a member to the effect union for control or timers.
- Do not run On Disable for `replaceAll`, and do not run a new version before the On Disable of its old version.
- Do not change an existing node type, its settings, its ports, or its behavior.
- Do not edit `docs/warudo-parity.md`, `ARCHITECTURE.md`, or a lockfile.
