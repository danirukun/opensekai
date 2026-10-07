# Blueprint interactions analysis

Date: 2026-10-07. Scope: BP-01, BP-02, BP-03, and BP-06 partial. Spec: [Blueprint interactions design](../../docs/superpowers/specs/2026-10-07-blueprint-interactions-design.md).

## Problem

A Blueprint is a draft in the editor. The session runs a graph only when the editor sends the full graph with `blueprintRun`. Nothing can start a graph while the streamer works in another app. A show holds at most one graph. The session keeps no state between runs, so a graph has no toggle, no delay, and no branch. A second client, such as MCP, cannot see or change the editor graph.

A VTuber uses Blueprints mostly for interactions. A typical use: press a hotkey to show a prop, then hide the prop after some seconds. This slice makes that path work from end to end on macOS.

Warudo runs graphs from events, such as keystrokes. Its handbook describes the nodes and their behavior. A live Warudo check on the VMPal Windows guest failed. Warudo stops at "Initializing". Unity's Direct3D 11 renderer loses its device on the VirtIO GPU (D3D11 device removed). The node names and behavior in the spec come from the handbook. They are not verified against the live Warudo UI.

## Existing boundaries

- The session worker owns the validated persistent scene. Its `revision` changes with each accepted scene edit.
- `BlueprintGraph` has a schema version, stable graph and node IDs, settings, positions, and typed connections. Show files are version 1 and hold at most one graph.
- The editor talks to the session through the operator API. The only transport is request and reply. The editor polls `appStatus` about every 500 ms. There is no push channel to operators.
- The Rust host owns the 60 Hz clock message to the session worker. It does not interpret graphs.
- The editor and MCP are two clients of the same session. Both must edit the same graphs.

## Candidate directions

1. **Operation journal with prediction and reconciliation.** The session owns the documents. A client sends small operation batches. The session applies them in order and keeps a journal. The editor predicts its own edits with the same pure function and reconciles with the journal. This is the standard model for real-time engine editors. It fits the transport: request and reply only, with a 500 ms status poll that carries a revision number.
2. **Whole-graph replace with a revision check.** The client sends the full graph and an expected revision. This is simple. A drag in the editor then conflicts with an MCP edit of another node. Every conflict forces a reload.
3. **Editor owns the graph and pushes it to the session.** This keeps the current model. MCP cannot see the editor draft. Hotkeys depend on the editor staying open.

The chosen direction is 1. The editor and MCP edit the same graphs, and the transport has no push. Prediction keeps the canvas fast. The journal gives one authoritative order. The last writer wins for each property. A batch that names a missing graph or node is rejected as a whole, and the client reloads.

## Decisions to record

- **On Update is deferred.** A graph that writes the persistent scene 60 times a second advances the scene revision on every tick. Each editor scene edit then gets a revision conflict. On Update needs a transient runtime-override layer with its own contract. This slice adds On Keystroke Pressed and keeps Manual Trigger.
- **A graph that does not compile is kept.** The session stores the document, reports the compile error, and runs the last version that compiled. Live hotkeys keep working during an edit.
- **Effects commit once per tick.** The session drops the invalid effects of one graph only. It commits at most one scene revision for each tick.
- **TypeScript owns the catalog and the operation function.** Rust checks structure only.

## Risks

- **Global hotkeys: Different from Warudo.** The Rust host registers accelerators with the OS. A registered combination is held by OpenSekai. Other apps do not receive it. This is **Different** from Warudo. Mitigations: every accelerator must contain Control, Alt (Option), or Meta (Command or Windows); Shift alone does not count; the defaults avoid Command menu shortcuts on macOS and AltGr on Windows. Another app can already own a combination. The registration then fails, the other accelerators still register, and `appStatus.warnings` names the failed one.
- **Held key repeat.** The OS can repeat Pressed events while a key is down. The host must fire once for each physical press.
- **Two clients edit at the same time.** Both clients must converge to the session order. A rejected editor batch must cause a reload, not a stuck canvas.
- **Invalid graph while a hotkey is live.** The last valid version must still fire. `blueprintInspect` must report the compile error.
- **A removed target entity.** Only the graph with the bad effect drops its effects. Other graphs on the same tick still commit. A toggle that changes nothing must not advance the scene revision.
- **Unbounded work.** Graphs can loop through Delay nodes. Every count needs a limit: graphs, nodes, connections, operations, journal batches, input events, flow visits, effects, pending delays, and accelerators.
- **No live Warudo comparison.** Behavior rests on the handbook. The evidence must say so.
- **No Windows acceptance run.** The Windows default modifiers (Control+Shift) are specified but not run in this slice.

## Acceptance

The critical path is: press a hotkey while another app has focus, see the effect in the OBS output, save the show, quit and reopen the app, open the show, and press the hotkey again. The hotkey works without the Blueprint panel open.

Also check: a held key fires once; a delay hides the prop after its time; a disabled graph does not fire, and its key reaches the focused app; an MCP rename shows in the open editor without a remount; a combination that macOS holds shows a warning and the other keys still work.
