# REASONS: Blueprint interactions slice

Date: 2026-10-07. Scope: BP-01, BP-02, BP-03, and BP-06 partial. Spec: [Blueprint interactions design](../../docs/superpowers/specs/2026-10-07-blueprint-interactions-design.md). Plan: [Blueprint interactions plan](../../docs/superpowers/plans/2026-10-07-blueprint-interactions.md). Analysis: [Blueprint interactions analysis](../analysis/2026-10-07-blueprint-interactions.md).

## R — Requirements

R1. The session owns the Blueprint documents. A client edits them with ordered operation batches.
R2. Clients stay in sync by revision. The editor reconciles its own unconfirmed batches with the session journal.
R3. A show holds up to 8 graphs. Each graph has an `enabled` flag that defaults to `true`.
R4. A graph can start from On Keystroke Pressed or Manual Trigger. On Update is not part of this slice.
R5. The Rust host registers global accelerators that the session reports. A press reaches the session on the 60 Hz clock message while OpenSekai is not focused.
R6. A graph can use flow, data, and action nodes: If Branch, Sequence, Flip Flop, Delay, Number, Boolean, Add, Greater Than, Not, Set Visibility, Toggle Visibility, and Switch Camera.
R7. A document that does not compile is kept. The last valid version of the graph keeps running.
R8. Effects commit at most one scene revision for each tick, and only when the scene changed.
R9. `blueprintRun({ graphId, triggerNodeId })` fires a Manual Trigger in the active version of a graph. The old form that sent a draft graph is removed.
R10. MCP can edit, inspect, and run graphs with the same session API as the editor.
R11. Graphs save and load with the show. Existing version 1 show files still open.
R12. The critical path works on macOS: hotkey in another app, effect in OBS, show save, reopen, and the hotkey works again.

## E — Entities

`BlueprintGraph` has stable graph and node IDs, nodes with settings and positions, typed connections, and `enabled`. A graph set holds up to 8 graphs.

`BlueprintOp` is one operation. Kinds: create a graph, remove a graph, update a graph, add a node, remove a node, move a node, set node settings, connect, disconnect, and replace all graphs.

`BlueprintBatch` is `{ clientId, batchId, ops }`. The session applies a batch atomically. Each accepted batch advances the Blueprint revision by one.

The journal holds the last 64 accepted batches.

`BlueprintInspect` reply is a delta of journal batches or a full snapshot. It also carries the compile status of each graph.

`Accelerator` is a canonical string in the order `Control+Alt+Shift+Super+<Code>`. The key code comes from `fixtures/protocol/keystroke-codes.json`.

`InputEvent` is one keystroke press in the clock message `input` field.

Runtime state, for each graph: the active compiled version, Flip Flop state, and pending delays.

## A — Approach

The session owns the graph documents and applies edits as operations. This is client-side prediction with server reconciliation against an authoritative journal. The editor and MCP edit the same graphs. The only transport is request and reply with a 500 ms status poll, so each frame and `appStatus` carries `blueprintRevision`. When the revision changes, the editor calls `blueprintInspect({ sinceRevision })`.

One pure function, `applyBlueprintOps`, lives in `@opensekai/contracts`. The session uses it as the authority. The editor uses it to predict and replay. Cascades run inside it: removing a node removes its wires, and fewer Sequence outputs remove the wires on the removed ports.

There is no `expectedRevision`. Operations name stable IDs. The last writer wins for each property. A batch that names a missing graph or node is rejected as a whole, and the client reloads.

The session replies with a snapshot when the client is outside the journal, when a batch in the range holds `replaceAll` or `createGraph`, or when the range holds more than 32 batches. Otherwise it replies with a delta.

The session compiles each document. A document that does not compile is stored, and its compile error is reported. The last version that compiled keeps running. `enabled` always comes from the current document. Flip Flop state and pending delays reset only when the executable content of a graph changes. A change of node position or name does not reset them.

On each tick the session runs due delays first, then input events. It applies the effects of each graph to a working copy of the scene, one graph at a time. When the effects of one graph are not valid, the session drops only those effects and records a runtime error on that graph. It then commits at most one scene revision.

The Rust host registers accelerators through `tauri-plugin-global-shortcut`. The session decides which accelerators are active. `blueprintEdit` returns that list. The host does not interpret graphs. A press goes into a bounded native queue. The next clock message carries the queued presses to the session worker, in order with the tick. A held key fires once.

Warudo flow rules apply. A flow output connects to one flow input. A flow input accepts many wires. A data input accepts one wire. A new wire on a port that already has its one wire replaces the old wire. A data input is read each time its node fires. A flow cycle is allowed only through a Delay node. Data cycles are rejected.

Different from Warudo: a registered combination is held by OpenSekai, and other apps do not receive it.

TypeScript contracts own the node catalog, the settings, and the operation function. The Rust host checks structure only: version, IDs, sizes, operation kinds, a bounded node type name, and an object for settings. The host keeps no copy of the node settings table.

## S — Structure

| Area | Files |
| --- | --- |
| Contracts | `packages/contracts/src/blueprint.ts`, `blueprint-nodes.ts` (new), `blueprint-ops.ts` (new), `schema.ts`, `types.ts`, `index.ts`; `fixtures/protocol/keystroke-codes.json`, `fixtures/protocol/blueprint-set.json` |
| Session | `packages/session/src/blueprint.ts` (rewrite), `blueprint-runtime.ts` (new), `blueprint-store.ts` (new), `scene-ops.ts` (new), `session.ts`, `worker.ts`, `index.ts`; `packages/browser-client/src/client.ts` |
| Rust contracts and show | `crates/contracts/src/lib.rs`, `apps/desktop/src-tauri/src/show.rs` |
| Native input | `apps/desktop/src-tauri/src/input.rs` (new), `service/mod.rs`, `service/router.rs`, `lib.rs`, `Cargo.toml`, `Cargo.lock`, `docs/dependencies.md` |
| MCP | `apps/mcp/src/tools.ts`, `resources.ts` |
| Editor | `apps/desktop/src/blueprints/blueprint-sync.ts` (new), `keystroke-format.ts` (new), `rete-editor.ts`; `components/BlueprintPanel.svelte`, `BlueprintList.svelte` (new), `BlueprintNodeFields.svelte` (new), `KeystrokeField.svelte` (new); `EditorApp.svelte`, `editor-poll.ts`, `app.css` |
| Evidence | `docs/evaluation/blueprint-interactions.md`, `docs/evaluation/blueprint-interactions-evidence.json`, `docs/warudo-parity.md` |

Commands: `blueprintEdit` and `blueprintRun` need the `edit` capability. `blueprintInspect` needs `read`. MCP tools: `blueprint_edit`, `blueprint_inspect`, `blueprint_run`.

## O — Operations

1. Task 2, contracts. Add the node catalog, the operation and batch schemas, `applyBlueprintOps`, the commands, the inspect reply, the clock `input` field, `blueprintRevision` on frames and `appStatus`, and the 8-graph show limit. Add the shared fixtures.
2. Task 3, compiler, flow executor, and runtime. Compile graphs, check port rules and cycles, run one event through the flow, and keep Flip Flop state and delays.
3. Task 4, session store, journal, tick dispatch, and worker routes. Add the document store, the journal, inspect replies, compile status, the per-tick commit, and the routes. Move scene operations to `scene-ops.ts`. Pass clock `input` in the browser client.
4. Task 5, Rust contracts and show validation. Add structural graph and operation validation, the new methods, the clock input, and the frame and status fields. Allow up to 8 graphs in a show.
5. Task 6, native global keystrokes. Add the registrar trait, the key latch, the bounded input queue, and the Tauri global-shortcut adapter. Drain the queue into the clock. Reconcile registration after `blueprintEdit`. Report failed registrations in `appStatus.warnings`.
6. Task 7, MCP server. Add `blueprint_edit`, `blueprint_inspect`, and `blueprint_run`, and the `opensekai://blueprints` resource.
7. Task 8, editor. Add prediction and reconciliation, catalog-driven sockets with port multiplicity, canvas patching without a remount, the graph list, node fields, and the keystroke field. Pull on a revision change. Save and open the show through the session.
8. Task 9, macOS acceptance, evidence, and parity. Run all checks. Run the critical path in the release app with OBS. Record the evidence. Update parity for the verified behavior only. Sync this contract if the code moved from it.

## N — Norms

Use pnpm, functional TypeScript, Zod 4, Vitest 5, Svelte 5, Rete 2, `@oshi-connect/ui`, and Tauri 2. Do not write UI copy that repeats what a control shows. Verify changed UI in the running app. Write docs in ASD-STE100. Keep platform input behind the registrar trait. Keep the node catalog in TypeScript only. Do not send rendered frames through IPC. Do not push, publish, or start a stream. Local OBS WebSocket control (`ws://127.0.0.1:4455`) and test recordings are allowed.

## S — Safeguards

- At most 8 graphs. Each graph has at most 128 nodes and 256 connections.
- A batch has 1–64 operations. The journal keeps the last 64 batches.
- A delta reply never holds more than 32 batches, and never holds a batch with `replaceAll` or `createGraph`. Otherwise the reply is a snapshot.
- At most 16 input events per clock message. At most 64 events in the native queue. When the queue is full, drop the oldest.
- At most 64 flow visits per event. At most 256 flow visits and 64 effects per tick in total.
- At most 32 pending delays per graph. Delay seconds are 0–3600.
- A Sequence has 2–8 outputs.
- Every accelerator contains Control, Alt, or Meta. Shift alone does not count. There is no exception for function keys.
- The canonical accelerator order is `Control+Alt+Shift+Super+<Code>`. At most 64 active accelerators.
- New keystroke nodes default to Control+Alt+KeyH on macOS (shown as ⌃⌥H) and to Control+Shift+KeyH on other platforms.
- A flow output has at most one wire. A flow input accepts many. A data input has exactly one wire, and the wire is required to compile. A new wire on a single-wire port replaces the old wire.
- A flow cycle is allowed only when it passes through `flow.delay`. Every data cycle is rejected.
- `blueprintEdit` and `blueprintRun` need the `edit` capability. `blueprintInspect` needs `read`.
- Blueprint effects commit at most one scene revision per tick, and only when the scene changed.
- Do not add On Update. Graphs run only on the session clock and through `blueprintRun`.
- Show files stay at version 1. `blueprints` has at most 8 entries. `enabled` defaults to `true`, so existing files still open.
- Constitution: pnpm only; functional TypeScript; `@oshi-connect/ui` controls; no UI copy that repeats the control; verify UI in the running app; ASD-STE100 for docs.
- Do not push, publish, or start a stream. Local OBS WebSocket control (`ws://127.0.0.1:4455`) and test recordings are allowed.
- Review focus 1: two clients that edit the same graph converge to the session order. A rejected editor batch causes a reload.
- Review focus 2: a held hotkey fires once for each physical press.
- Review focus 3: when another app owns an accelerator, the other accelerators still register, and `appStatus.warnings` names the failed one.
- Review focus 4: a graph that is invalid mid-edit keeps firing its last valid version, and `blueprintInspect` reports the compile error.
- Review focus 5: when a target entity is removed, only that graph drops its effects and records a runtime error. Other graphs still commit. A toggle that changes nothing does not advance the scene revision.
- The Rust host keeps no copy of the node settings table.
- State the Different behavior in evidence: a registered combination is held, and other apps do not receive it. State that the live Warudo comparison was not possible on the VMPal guest.
