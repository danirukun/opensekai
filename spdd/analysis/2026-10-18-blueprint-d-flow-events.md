# Analysis: Blueprint flow, timers, events, and Blueprint control (slice D)

Date: 2026-10-18. Bundle B13 ([plan](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md)), slice D. Issues: #81, #83. Parity items: BP-01, BP-03. Contract: [slice D](../prompt/2026-10-18-blueprint-d-flow-events.md).

## Problem

The [node audit](../../docs/evaluation/blueprint-node-audit.md) shows these gaps in the Warudo palette categories Flow Control, Timer, Events, and Blueprints:

- Flow Control: OpenSekai has no Do Once, no Debounce, and no node that selects one of two values.
- Events: OpenSekai has On Enable but no On Disable. A graph cannot send an event to another graph.
- Timer: OpenSekai has Delay and Throttle (category Flow). It has no repeating timer and no node that reads the session time.
- Blueprints: a graph cannot enable, disable, or toggle another graph, and it cannot read whether a graph is enabled.

## Current behavior (base 3e0a7ea)

- The runtime (`packages/session/src/blueprint-runtime.ts`) keeps one entry for each installed graph: the compiled graph, the logic key, the run state, the pending delays, and a flag that fires On Enable on the next step.
- An install keeps an entry when the graph is enabled and its logic key did not change. Otherwise the entry gets a new state. The old entry is discarded with no run.
- A step runs On Enable nodes, then due delays (by due time), then the input events in order (keystroke, device, On Update). A tick has one flow budget (1024 visits, 64 effects).
- A run writes to a copy of the state. The session keeps the copy only when the run gate accepts the effects.
- The session drops the transitions (H) of a graph when an edit disables, removes, or changes it.
- The native host learns the accelerator set, the held-key set, and the device set only from the replies of `blueprintEdit` that it relays, and from `blueprintInspect` after a reconnect. The session cannot push a new set to the host.

## Requirements found

1. New Flow Control nodes keep state in the generic node state (W0 R8). The reset rules do not change.
2. On Disable needs the old version of the graph and its old state, because the new version has a new state. The runtime must keep the old entry until its On Disable runs.
3. On Disable effects must go through the run gate of the session, so they must run inside a session step, not inside the edit call.
4. A custom event must reach other graphs in the same tick. A loop of events must stop. The flow budget alone does not stop it in a defined way, so the slice needs a hop limit and an event budget.
5. A Blueprint toggle must show in the editor list. The editor list shows the documents. A runtime override would need a new inspect field and editor changes in files that slice G owns. A document change goes through the existing sync path.
6. A graph that a node enables must have its keystrokes registered. The host cannot learn a set that the session changes without an edit reply. So the reported set must already contain the keystrokes of each graph that a node can enable.
7. Inline values (W0 R5) are not in the logic key. If they were, each inline edit would reset the graph and fire On Disable and On Enable.

## Options and choices

| Question | Options | Choice | Reason |
| --- | --- | --- | --- |
| Toggle persistence | A: a document edit (`updateGraph`), saved with the show. B: a runtime override. | A | The editor list, MCP inspect, and the show save show the state with no new protocol field. Warudo stores the Enabled flag of a Blueprint in the scene. |
| When On Disable runs | A: inside the edit call. B: at the start of the next step. | B | A step has the run gate and the scene working copy. The new version cannot run before the next step, so the order "old On Disable, then new version" holds. |
| H tweens of a departing graph | A: stop before On Disable. B: stop after On Disable. | A | H stops them at the edit (no change to H). A transition that On Disable starts then runs to its end. |
| Event delivery | A: a FIFO queue, drained after each run. B: delivery in the next tick. | A | Same-tick delivery is in the brief. A FIFO order is deterministic. |
| Event loop guard | Hop limit 8 and a budget of 64 events per tick. | Both | The hop limit stops a chain. The budget stops a fan-out. The run that exceeds a limit fails with no state change. |
| Timer identity | A: a timer name in the graph. B: a node picker. | A | It uses the existing `string` field kind. Start, Stop, and On Timer nodes share the name. |
| Host key set | A: change the Rust host. B: report the keystrokes of enabled graphs and of graphs that an Enable or Toggle node in such a graph names (transitive). | B | No host change. The set does not change when a node toggles a graph. |
| R5 (inline values in the logic key) | Add or keep out. | Keep out | Live tuning of a value must not reset the graph or fire On Disable. A test records the decision. |
| MCP emit | A: a new method. B: an optional form of `blueprintRun`. | B | No new host route. The host already relays `blueprintRun` with the Edit capability. |

## Warudo name candidates

Each name is a candidate until a Warudo palette pass records it (BP-13): Do Once, Debounce, Select (Flow Control); On Disable, Emit Event and On Event (Events, Warudo may call them Trigger Custom Event and On Custom Event); Start Timer, Stop Timer, On Timer, Get Session Time (Timer); Enable Blueprint, Disable Blueprint, Toggle Blueprint, Is Blueprint Enabled (Blueprints, the Warudo category has 3 nodes).

## Risks

- A runtime toggle increments the Blueprint revision. A graph that toggles on each tick makes the show dirty on each tick and fills the edit journal. The session applies at most one toggle batch for each step.
- The reported keystroke set can contain the keystrokes of a disabled graph that a node can enable. The OS registers those combinations while the graph is disabled.
- On Disable does not run for `replaceAll` (show open). The graphs of the old show must not change the new scene.
