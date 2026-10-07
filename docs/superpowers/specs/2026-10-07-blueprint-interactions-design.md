# Blueprint interactions design

Date: 2026-10-07. Scope: BP-01, BP-02, BP-03, and BP-06 partial. Reference: the [Warudo Blueprint handbook](https://docs.warudo.app/docs/blueprints/overview). A live Warudo check on the VMPal Windows guest failed. Warudo stops at "Initializing", because Unity's Direct3D 11 renderer loses its device on the VirtIO GPU. The node names and behavior below come from the handbook. They are not verified against the live Warudo UI.

## Problem

Today a Blueprint is a draft in the editor. The session runs a graph only when the editor sends the full graph with `blueprintRun`. Nothing can start a graph while the streamer works in another app. A show holds at most one graph. The session cannot keep state between runs, so there is no toggle, no delay, and no branch. A second client, such as MCP, cannot see or change the editor's graph.

A VTuber uses Blueprints mostly for interactions. Typical uses: press a hotkey to show a prop or switch a camera, then hide the prop again after some seconds. This slice makes that path work from end to end on macOS.

## Decisions

1. **The session owns the graph documents and applies edits as ordered operations.** This is the standard model for real-time engine editors: client-side prediction with server reconciliation against an authoritative operation journal.
   - A client sends one small batch of operations to `blueprintEdit`. A batch is `{ clientId, batchId, ops }`. It can create a graph, remove a graph, update a graph, add, remove, or move a node, set node settings, connect, disconnect, or replace all graphs.
   - The session applies a batch atomically, in arrival order. Each accepted batch advances the Blueprint revision by one. The session keeps the last 64 batches in a journal.
   - There is no `expectedRevision`. Operations name stable IDs, and concurrent edits resolve by server order: the last writer wins for each property. A batch that names a graph or node that no longer exists is rejected as a whole. The client then reloads.
   - One pure function in `@opensekai/contracts` applies operations. The session uses it as the authority. The editor uses it for prediction and replay, so both sides compute the same result. Cascades run inside this function, so they are the same everywhere. Examples: when a node is removed, its wires go with it; when a Sequence gets fewer outputs, the wires on the removed ports go too.
2. **Clients stay in sync by revision.** Each runtime frame carries `blueprintRevision`. `appStatus` reports it, and the editor already polls `appStatus`. When the revision changes, the editor calls `blueprintInspect({ sinceRevision })`. The reply is either a delta of journal batches or a full snapshot. The session sends a snapshot when the client is outside the journal, when a batch in the range replaces or creates a whole graph, or when the range holds more than 32 batches. The editor applies remote batches to its confirmed copy. It then applies its own unconfirmed batches again on top, and patches the canvas with the difference. It does not mount the canvas again. When its own batch comes back in the journal, the editor drops that batch from its pending list.
3. **A document that does not compile is kept, and its last valid version keeps running.** Edits pass through states that do not compile. One example is a new Set Visibility node before its input is wired. The session stores the document and reports the compile error. It continues to run the last version that compiled, so live hotkeys keep working while the streamer edits. `enabled` always comes from the current document. Flip Flop state and pending delays reset only when the executable content of a graph changes. A change of node position or name does not reset them.
4. **A show holds up to 8 graphs.** Each graph has an `enabled` flag, which defaults to `true`. A graph that is not enabled gets no events, and its pending delays are cleared.
5. **Events, not On Update.** This slice adds On Keystroke Pressed and keeps Manual Trigger. On Update is deferred. A graph that writes the persistent scene 60 times a second would advance the scene revision on every tick, and every editor edit would then get a conflict. On Update needs a transient runtime-override layer with its own contract.
6. **Global keystrokes from the native host, always with a modifier.**
   - The Rust host registers accelerators through `tauri-plugin-global-shortcut`. The session decides which accelerators are active, and `blueprintEdit` returns that list. The host does not interpret graphs.
   - A press goes into a bounded native queue. The next 60 Hz clock message carries the queued presses to the session worker, in order with the tick. Keys work while OpenSekai is not focused.
   - This is **Different** from Warudo: a registered combination is held by OpenSekai, and other apps do not receive it.
   - Every accelerator must contain Control, Alt (Option), or Meta (Command or Windows). Shift alone does not count, because Shift with a letter is typing. A held key fires once.
   - New keystroke nodes use the idiomatic modifiers of the host platform: Control+Option on macOS, which does not collide with Command menu shortcuts, and Control+Shift on Windows, which does not collide with AltGr on international layouts. The editor shows modifiers with the platform's own names and symbols. Settings store the physical modifiers, so a show opens on both platforms.
7. **Warudo flow rules.** A flow output connects to one flow input. A flow input accepts many. A data input accepts one wire. When a new wire goes to a port that already has its one wire, the new wire replaces the old one. A data input is read each time its node fires. A flow cycle is allowed only through a Delay node. Data cycles are rejected.
8. **Node set for this slice.**
   - Events: Manual Trigger and On Keystroke Pressed.
   - Flow: If Branch, Sequence (2–8 outputs), Flip Flop (with an Is A data output), and Delay (0–3600 seconds).
   - Data: Number, Boolean, Add, Greater Than, and Not.
   - Actions: Set Visibility, Toggle Visibility, and Switch Camera (for one output). Each action has an Exit flow output.
9. **`blueprintRun({ graphId, triggerNodeId })` fires a Manual Trigger in the active version of a graph.** The old form, which sent a draft graph, is removed. MCP gets `blueprint_edit`, `blueprint_inspect`, and the new `blueprint_run`.
10. **Effects commit once per tick.** The session applies the effects of each graph to a working copy of the scene, one graph at a time. When one graph's effects are not valid, the session drops only those effects and records a runtime error on that graph. The session commits at most one scene revision for each tick, and only when the scene changed.
11. **Validation authority.** TypeScript contracts own the node catalog, the settings, and the operation function. The Rust host checks only structure: version, IDs, sizes, operation kinds, a bounded node type name, and an object for settings. The host keeps no copy of the node settings table.

## Limits

- 8 graphs. Each graph keeps 128 nodes and 256 connections.
- 64 operations per batch, and 64 batches in the journal.
- 16 input events per clock message, and 64 in the native queue. When the queue is full, the oldest event is dropped.
- 64 flow visits per event. 256 flow visits and 64 effects per tick in total.
- 32 pending delays per graph.
- 64 active accelerators.

## Out of scope

- On Update and transient runtime overrides.
- Variables, Gate, Throttle, For Loop, Switch On Integer, and functions.
- Mouse, gamepad, MIDI, Stream Deck, WebSocket, and stream-platform triggers.
- Expressions, animations, props, and particles.
- Search, grouping, undo, copy and paste, and graph import or export.
- A push channel from the session to operators. The revision poll is the sync signal in this slice.
- A Windows acceptance run.
