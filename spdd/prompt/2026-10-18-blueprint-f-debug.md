# REASONS: Blueprint debug nodes

Date: 2026-10-18. Scope: slice F of bundle B13 (#199, BP-18, BP-01). Debug node types, the debug data path, the editor debug output, and the MCP debug read. Analysis: [Blueprint debug](../analysis/2026-10-18-blueprint-f-debug.md). Plan: [Blueprint depth](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md). Uses the [value model](2026-10-18-blueprint-w0-value-model.md) (data types, inline inputs, `choice` field from slice I). Adds to the effect union of [transitions](2026-10-18-blueprint-h-transitions.md).

## R — Requirements

R1. **Log** (`debug.log`, category Debug). Settings `{ level }`, where `level` is `debug`, `info`, `warning`, or `error` (default `info`, field kind `choice`, label Level). Inputs `flow` and `message` (`string`). Output `exit`. The evaluator emits `debugLog { nodeId, level, message }`.

R2. **Show Toast** (`debug.toast`, category Debug). Settings `{ variant, durationSeconds }`. `variant` is `success`, `info`, `warning`, or `error` (default `info`, field kind `choice`, label Type). `durationSeconds` is a finite number from 1 to 30 (default 3, label Duration (s)). Inputs `flow`, `header` (`string`), and `caption` (`string`). Output `exit`. The evaluator emits `debugToast { nodeId, variant, header, caption, durationSeconds }`.

R3. **Debug Value** (`debug.value`, category Debug). Settings `{ valueType }`, a data type of W0 R1 (default `number`, field kind `choice`, label Type). Input `value` and output `value`, both of type `valueType`. The node has dynamic ports. The data evaluator returns its input with no change.
- When a run reads the output, the runtime records the value for the node. A second read in the same run replaces it.
- After a run that succeeds, the runtime evaluates each Debug Value node of the graph that the run did not read, on a copy of the run state, and records the value. A failure in this step does not fail the run; that node has no value from the run. This step does not change the run state.
- The recorded values are appended to the effects of the run as `debugValue { nodeId, valueType, value }`, one for each node, in node order.

R4. **Emit Debug Event** (`debug.event`, category Debug). Settings `{ payloadType }`, a data type or `none` (default `none`, field kind `choice`, label Payload). Inputs `flow`, `name` (`string`), and, when `payloadType` is not `none`, `payload` of that type. Output `exit`. The evaluator emits `debugEvent { nodeId, name, payloadType?, payload? }`.

R5. **Effects and budget.** `DebugEffect` is the union of the four debug effects. It is appended to `BlueprintEffect`. `isDebugEffect` is true for the four kinds, and `isSceneEffect` is false for them. A debug effect does not use the effect budget of the run or the tick; the visit budget still applies. A debug effect continues at `exit` like any other effect (`debugValue` has no flow). A run that fails, or that the session gate rejects, adds no debug entry and no value.

R6. **Debug log.** The session keeps one debug log. It is runtime state: it is not in the show, the Blueprint file, or the scene, and it does not change a revision.
- Each accepted debug effect except `debugValue` becomes one entry `{ seq, atMs, graphId, nodeId, kind, … }`. `seq` is a sequence number that increases by 1 for each entry and each value change, from 1. `atMs` is the session time of the run.
- The log keeps the last 1000 entries (`MAX_DEBUG_ENTRIES`). An older entry leaves the log.
- Kinds: `log { level, message }`, `toast { variant, header, caption, durationSeconds }`, and `event { name, valueType?, text? }`.
- Text rules: the session replaces each control character (U+0000 to U+001F and U+007F to U+009F) in a message, header, caption, or name with a space. The text is otherwise unchanged.

R7. **Rate limit.** For each node (Log, Emit Debug Event), the log keeps at most 10 entries in a window of 1000 ms (`DEBUG_NODE_RATE`). For each graph, it keeps at most 5 toast entries in a window of 1000 ms (`DEBUG_TOAST_RATE`). A window starts at the first entry after the previous window ended, and it ends 1000 ms later on the session clock. An entry above the limit is dropped and counted. The next kept entry of the same node (toasts: the same graph) has `dropped: n`, the count since the previous kept entry of that key. The log also keeps the total count of dropped entries.

R8. **Debug values.** The log keeps the latest value of each Debug Value node: `{ graphId, nodeId, valueType, text, changedMs, seq }`. When the text or the type changes, `changedMs` becomes the time of the run and `seq` takes the next sequence number. When neither changes, the entry stays the same. At most 64 nodes have a value (`MAX_DEBUG_VALUES`); the value of a new node above the limit is dropped and counted. After each successful `editBlueprints`, the session removes the values of nodes that are no longer a Debug Value node in an enabled or disabled stored graph.

R9. **Value text.** `formatDebugValue(type, value)` gives plain text: `number` and `integer` as JavaScript `String`, `boolean` as `true` or `false`, `string` as a JSON string (`"a\nb"`), `vector3` as `(x, y, z)`, and a list as `[a, b, …]` with each item in its scalar format. Text above 256 characters (`MAX_DEBUG_TEXT`) is cut to 255 characters and `…`. An event payload uses the same format (`text`, with `valueType`).

R10. **Method `blueprintDebug { since? }`** (Read capability).
- Without `since`: the last 50 entries (`MAX_DEBUG_PAGE`) and all values.
- With `since`: the first 50 entries with `seq > since`, and each value with `seq > since`.
- Reply `{ latest, next, entries, values, dropped }`. `latest` is the last sequence number. `next` is the `seq` of the last returned entry when more entries with a higher `seq` exist, else `latest`. Entries are in `seq` order. `dropped` is the total count of R7 and R8.
- The contracts export `BlueprintDebugSchema` (zod) for the reply, and the Rust host checks the call (`since` is an optional unsigned integer, no other key) and the reply shape (known keys, kinds, levels, variants, data type names, string lengths, at most 50 entries and 64 values).
- The host relays the call to the publisher like `blueprintInspect`.

R11. **Editor feed.** The Editor window reads `blueprintDebug` each 500 ms while it is connected. The first read has no `since`; it fills the debug output and shows no toast. Each later read passes the last `next`. When `next` is less than `latest`, the feed reads again at once. The feed keeps the last 1000 entries and the latest value of each node. When `latest` goes below the cursor (a new session), the feed starts again from an empty state.

R12. **Toasts.** For each new toast entry of a read, the editor pushes a toast with the variant of the entry and the text `header: caption` (only the non-empty part when one is empty) for `durationSeconds`. At most 3 debug toasts show at a time. When a read has more new toast entries than free places, the editor shows the newest ones that fit and one `+N more` toast (info, 3 s) for the others plus the `dropped` counts of the shown entries. Toasts render only in the Editor window, never in the scene, a frame, a renderer, or OBS.

R13. **Debug output.** The Blueprint panel has a Debug output button in its tool rail. It opens an output strip below the canvas. The strip lists the entries newest last, with time (`mm:ss.mmm` of `atMs`), the graph name, the level or kind, and the text, and it scrolls to the end on a new entry. It has a graph select (All graphs, or one graph), a level select (All, Debug, Info, Warning, Error; Toast and Event entries show for All only), and a Clear button. Clear hides the entries that the feed has at that time; it does not change the session log. A dropped count shows as `+n` after the text. It uses `@oshi-connect/ui` `Select` and `Button`. The open state is a per-user convenience in `localStorage`.

R14. **Value on the node.** A Debug Value node in the canvas shows the text of its latest value under its ports, with the time it changed (`mm:ss.mmm`). A node without a value shows no line.

R15. **MCP.** Tool `blueprint_debug_log` maps to `blueprintDebug` and takes `since`. Its description names the entry kinds, the cursor, and the values.

R16. **Audit.** One row for each node type in `docs/evaluation/blueprint-node-audit.json`, Warudo category `Debug`, with the candidates `Log` (`debug.log`), `Show Toast` (`debug.toast`), `Debug Value` (`debug.value`), and `Emit Debug Event` (`debug.event`), and `evidence: "tests"`. The catalog count increases by 4.

R17. **Tests.**
- Unit: the value text of each data type and the cut; the control character rule; the ring buffer bound; the node and toast rate limits with the drop count and the window reset; the value change rule and the 64 limit; the read paging (`since`, `next`, `latest`); the run capture of Debug Value (read, watch, failed watch, no state change); the debug effects outside the effect budget; the editor feed merge and reset; the toast plan.
- Session: through `createSession`, an On Update graph with Log keeps 10 entries in a second and reports the drops; a failed run adds no entry; a Debug Value updates its value only on change; a value of a removed node goes away.
- Integration: the session reply through `sessionApi` validates with `ResultSchemas.blueprintDebug` and feeds the editor feed (session → editor boundary); a shared fixture reply validates in TypeScript and in Rust; MCP stdio with a real session: a manual run with Log, Emit Debug Event, and Debug Value, read with `blueprint_debug_log` and `since`.
- No test of static copy.

## E — Entities

- Node types `debug.log { level }`, `debug.toast { variant, durationSeconds }`, `debug.value { valueType }`, `debug.event { payloadType }`.
- Session effects (`packages/session/src/debug-log.ts`): `DebugLogEffect`, `DebugToastEffect`, `DebugEventEffect`, `DebugValueEffect`, `DebugEffect`.
- Contracts (`packages/contracts/src/blueprint-debug.ts`): `DEBUG_LEVELS`, `DEBUG_VARIANTS`, limits, `DebugEntry`, `DebugValue`, `BlueprintDebug`, their schemas, `formatDebugValue`, `plainDebugText`.
- Method `blueprintDebug` in `ParamSchemas`, `ResultSchemas`, `MethodSchema`, `AppApi`, and the Rust `validate_call` and `validate_result`.
- Editor: `blueprints/debug-feed.ts` (feed state, merge, toast plan), `components/BlueprintDebugOutput.svelte`.

## A — Approach

Put the wire shapes, limits, and text rules in one contracts module. Add the four node definitions in a new `debug` family and their evaluators. Add the debug effects to the effect union, keep them outside the effect budget, and add the Debug Value capture to `runFlow`. Add the debug log as a closure module with pure helpers in the session, feed it from the session gate, and expose it as a session method. Mirror the call and the reply checks in Rust and route the method in the host. Then add the editor feed, toasts, the output strip, and the value on the node. Then the MCP tool.

## S — Structure

- `packages/contracts/src/blueprint-debug.ts` (new), `blueprint-nodes/debug.ts` (new), `blueprint-nodes/index.ts` (one import, one spread), `index.ts` (one export), `schema.ts`, `types.ts`.
- `packages/session/src/debug-log.ts` (new), `blueprint-eval/debug.ts` (new), `blueprint-eval/index.ts` (one import, one spread), `blueprint.ts` (effect union, budget, capture), `session.ts` (log, gate, method, prune), `session-api.ts`.
- `crates/contracts/src/lib.rs`, `crates/contracts/tests/blueprint_debug.rs` (new), `apps/desktop/src-tauri/src/service/router.rs` (two method lists), `fixtures/protocol/blueprint-debug.json` (new), `fixtures/protocol/validation-vectors.json`.
- `apps/desktop/src/blueprints/debug-feed.ts` (new), `blueprints/rete-editor.ts` (a `setDebugValues` method and one node field), `components/BlueprintDebugOutput.svelte` (new), `components/BlueprintPanel.svelte`, `components/BlueprintNodeView.svelte`, `EditorApp.svelte`, `app.css`.
- `apps/mcp/src/tools.ts`, `server.ts`, `apps/mcp/test/stdio-fixture.ts`.
- Tests in `packages/contracts/test`, `packages/session/test`, `apps/desktop/test`, `apps/mcp/test`.
- `docs/evaluation/blueprint-node-audit.json`, `docs/evaluation/blueprint-f-debug.md`.

## O — Operations

1. Commit this contract and the analysis.
2. Contracts: debug module, node family, method schemas. Unit tests.
3. Session: evaluators, effect union, budget, Debug Value capture, debug log, session method. Unit and session tests.
4. Rust: call and reply checks, router lists, shared fixture test.
5. Editor: feed, toasts, output strip, node value. Unit tests for the feed and the toast plan.
6. MCP tool and stdio integration test.
7. Audit rows, evaluation note, `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, Rust tests of the changed crates.

## N — Norms

Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript and plain data; the log is a closure over plain data. Use `@oshi-connect/ui` controls. UI copy is limited to the node labels, field labels, Debug output, All graphs, the level names, Clear, and `+N more`. No pill or badge repeats a level that the text already shows.

## S — Safeguards

- Do not render debug text as HTML or Markdown. Do not put debug data in the frame, the renderer, the OBS output, the show, or the Blueprint file.
- Do not let a debug node use the effect budget or let a debug flood grow the log above 1000 entries or a reply above 50 entries.
- Do not let the Debug Value watch step change the run state or fail a run.
- Do not change an existing node type, an existing effect, or an existing method.
- Do not claim a macOS, editor, or OBS result from unit and integration tests.
- Do not edit `docs/warudo-parity.md`, `ARCHITECTURE.md`, or a lockfile.
