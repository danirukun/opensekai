# Blueprint debug analysis

Date: 2026-10-18. Scope: slice F of bundle B13 "Blueprint depth" (#199, BP-18, BP-01). Debug node types, the debug data path, the editor debug output, and the MCP debug read. Plan: [Blueprint depth](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md).

## Problem

A Blueprint author cannot see what a graph does while it runs. The editor shows only the last runtime error of each graph. A value on a wire, the order of runs, and the result of a chat event are not visible. An agent that uses MCP can read the graph documents and the errors, but not what a run did.

Warudo has a **Debug** palette category with 6 node types in 0.15.1. Show Toast has Header, Caption, and Type. A typical Warudo graph is On YouTube Chat Received → Show Toast (Header = Username, Caption = Message, Type = Success).

## Facts from the code

- The session worker runs in the Scene window. It is the only authority for Blueprint runs. The editor and MCP are operator clients. They reach the session only through calls that the Rust host relays (`route_scene_call` in `service/router.rs`).
- The host validates each call (`validate_call`) and each reply (`validate_result`) for each method name. A new method or a new reply field needs a Rust change. The host rejects a reply key that it does not know (`keys_within`).
- A run is a transaction. `runFlow` returns effects. The session gate (`stepBlueprints` in `session.ts`) applies the effects of a run, or rejects the run, and a rejected run changes no state.
- The effect budget is 64 effects for each tick for all graphs (`TICK_EFFECTS`). The visit budget is 1024 for each tick and 512 for each run.
- A data node is evaluated only when a flow node reads it. A data node without a reader is never evaluated.
- `readInput` in `blueprint.ts` evaluates data nodes with a cache for each read. A data evaluator receives the run state but not the session time and cannot emit an effect.
- The editor polls `appStatus` each 500 ms and pulls `blueprintInspect` while the Blueprint panel is open (`editor-poll.ts`).
- `@oshi-connect/ui` has `ToastRegion` and a `toasts` store with the variants `success`, `info`, `warning`, and `error`. The editor window already mounts `ToastRegion`. A toast shows plain text (Svelte text interpolation).
- The largest ordinary wire message is 256 KiB (`MAX_MESSAGE_BYTES`).
- A Blueprint string is at most 1024 UTF-16 code units. A list has at most 256 items.
- Slice I added the `choice` field kind (a select with fixed options) to `BlueprintField`.

## Decisions

- **One new session method, `blueprintDebug`.** The editor and MCP read the debug log with the same call. The call takes an optional cursor (`since`). A new method keeps `blueprintInspect` unchanged and keeps the debug traffic out of the Blueprint document sync. The host relays it like `blueprintInspect`, with the Read capability, and validates the reply shape.
- **Debug output is effects.** Log, Show Toast, and Emit Debug Event emit debug effects. The session gate applies them with the other effects of the run. So a failed run adds no debug entry, as it adds no other change. The run error already tells the author what failed.
- **Debug effects do not use the effect budget.** An On Update graph with a Log node, or a Log node in a For Loop, must not take the 64-effect budget from the scene effects. The visit budget still limits the number of debug effects in a tick.
- **Debug Value is a pass-through data node with a type setting.** It has one input and one output of the chosen data type. It returns its input. When the run reads it, the runtime records the value. After a successful run, the runtime also evaluates each Debug Value node that the run did not read, on a copy of the run state, so a Debug Value node with no reader works as a watch. An evaluation that fails in this step is ignored. The recorded values become debug effects of the run.
- **Bounded ring buffer in the session.** The session keeps the last 1000 entries (issue rule). Each entry has a sequence number, the session time, the graph ID, and the node ID. The session keeps the latest Debug Value of each node (at most 64 nodes). Nothing goes into the show, the Blueprint file, or the scene.
- **Rate limit with drop counts.** Log and Emit Debug Event keep at most 10 entries for each node in each 1 s window. Show Toast keeps at most 5 entries for each graph in each 1 s window (issue rule). The session counts the dropped entries. The next kept entry of the same node (or graph, for toasts) carries the count, and each reply carries the total count.
- **Values as text.** The session formats each Debug Value and each event payload as plain text of at most 256 characters. A string shows in JSON quotes, so an empty string and white space are visible. This bounds the reply size and gives the editor and MCP the same text. Each value also carries its data type.
- **Plain text.** The session replaces control characters in log messages, toast text, and event names with spaces. The editor renders all debug text as text, never as HTML or Markdown.
- **Toasts are an editor reaction to entries.** The session stores a toast as an entry. The editor shows a toast for each new toast entry that it reads. When no editor window is open, the entry stays in the log only. The editor shows at most 3 debug toasts at a time. Extra toasts in one read merge into one `+N more` toast. Toasts never go into the scene, the frame, the renderer, or OBS.
- **The editor reads the log in the Editor window, not in the panel.** A toast must show when the Blueprint panel is closed. The Editor window polls `blueprintDebug` each 500 ms. The Blueprint panel shows the entries and the values from the same feed.
- **Level names from the issue.** Log has the levels `debug`, `info`, `warning`, and `error`. The default is `info`.
- **Strings are W0 inline inputs.** Message, Header, Caption, and Name are `string` data inputs. They take a wire or an inline value. Duration and the enums are settings.

## Rejected approaches

- **Add debug entries to the `blueprintInspect` reply.** The Blueprint sync applies inspect replies as document deltas and resets on a revision change. Debug traffic would mix with the document sync and grow every inspect reply.
- **Add debug entries to the runtime frame.** Frames go to renderers, including the OBS page, 60 times each second. Debug data has no place in the output path.
- **A `debug` callback in `RunEnv`.** It would record values from failed runs, change a W0-owned type that slice I also changes, and bypass the run gate.
- **A Debug Value node with an input only (as in the issue table).** In the pull model a data node without a reader is never evaluated. The pass-through output lets the author put the node on a wire. The watch step covers the input-only use.
- **A raw typed value in the reply.** A string list can be 256 KiB, which is above the message limit. Text with a type is bounded.
- **Host `tracing` for Log lines.** The host sees debug entries only when a client reads them. A host log needs a new session-to-host message. This is deferred (open question).

## Open questions

- Should Log lines also go to the app log (host `tracing`)? This needs a push message from the session to the host.
- Should a Breakpoint node come later (issue question)?
- Should toasts go to the system notification center when the app is in the background (issue question)?
