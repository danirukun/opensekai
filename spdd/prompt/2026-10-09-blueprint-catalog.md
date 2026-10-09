# REASONS: Blueprint catalog and editor actions

Date: 2026-10-09. Scope: BP-01, BP-02, and BP-03 partial. Spec: [Blueprint catalog and editor actions design](../../docs/superpowers/specs/2026-10-09-blueprint-catalog-design.md). Analysis: [Blueprint catalog analysis](../analysis/2026-10-09-blueprint-catalog.md).

## R — Requirements

R1. Each node type has one definition in `packages/contracts/src/blueprint-nodes/`. The node union, ports, labels, defaults, settings form, search palette, menus, and MCP catalog come from the definitions. The session evaluates nodes through a table keyed by type.
R2. The 14 existing node types keep their type, version, and settings. Existing shows open without change.
R3. The 28 node types in spec decision 2 exist, with the ports, settings, and behavior in that table.
R4. A graph declares up to 32 typed variables (`number` or `boolean`) with unique IDs and names and a default. The operations `addVariable`, `updateVariable`, and `removeVariable` change them. Nodes that use a removed or retyped variable stay and show a compile error.
R5. Variable values live only in the session runtime. The graph state (variables, Flip Flop, Gate, Multi Gate, Throttle, For Loop indexes, random generator, and delays) resets on install, on a logic change, and on enable. Logic includes variables without their names.
R6. After a reset of an enabled graph, the next tick fires each On Enable node, before due delays and input events.
R7. A run writes state to a copy. The session keeps it only when the run succeeds.
R8. The limits are 512 flow visits per event, 1024 per tick, 64 effects per tick, 32 delays per graph, and 64 iterations per loop entry. A run that hits a limit fails with a runtime error.
R9. Random Number uses mulberry32, seeded on reset from the 32-bit FNV-1a hash of the graph ID.
R10. The editor has context menus on the canvas (search palette, Paste, Select all), on a node (Delete, Duplicate, Copy, Disconnect all, and Run for a Manual Trigger), and on a wire (Delete). A node action applies to the selection when the node is part of it.
R11. A wire released on empty canvas opens the search palette filtered to compatible nodes. A choice adds the node there and connects the wire.
R12. The keys Delete, Backspace, ⌘C, ⌘V, ⌘D, ⌘A, ⌘Z, ⇧⌘Z, and Esc work while the canvas has focus and never while a text field has focus. Control replaces ⌘ on Windows.
R13. Copy and paste use editor memory, give new IDs, keep relative layout, and work across graphs.
R14. Undo and redo keep 64 steps per graph. A step is one user action, stores operations computed from the graph difference, and sends normal `blueprintEdit` batches. A rejected undo drops the step and shows "Changed elsewhere". An action with more than 64 operations is sent as more than one batch.
R15. The Blueprint panel has a Variables section to add, rename, retype, set the default of, and remove variables.
R16. MCP reads the resource `opensekai://blueprint-nodes`, generated from the definitions. `blueprint_edit` accepts the new nodes and variable operations.
R17. The Rust host checks the structure of `variables` and the three new operation kinds. It does not check node settings.

## E — Entities

- `BlueprintNodeDefinition`: `{ type, label, category, keywords, settings, ports(settings), defaults(scene), fields }`.
- `BlueprintField`: `{ key, kind: 'number' | 'boolean' | 'entity' | 'camera' | 'output' | 'variable' | 'cases' | 'keystroke', label, ... }`.
- `BlueprintVariable`: `{ id, name, type: 'number' | 'boolean', default: number | boolean }`.
- `BlueprintGraph`: adds `variables: BlueprintVariable[]` (default `[]`).
- `BlueprintOp`: adds `addVariable`, `updateVariable`, and `removeVariable`.
- `GraphState` (session): variables, flip, gates, multiGates, throttles, loopIndexes, random, delays.
- `UndoStep` (editor): `{ undo: BlueprintOp[], redo: BlueprintOp[] }` for one graph.
- `BlueprintClipboard` (editor): `{ nodes, connections }`.

## A — Approach

Move the 14 existing node types into definitions first, with no change in behavior, and keep the existing tests green. Then add variables to the contract in TypeScript and Rust with shared validation vectors. Then extend the runtime state and the evaluators family by family. Then add the editor actions: menus, search, keys, clipboard, undo, and the Variables section. Add the MCP resource last. Keep all edits on the existing validated `blueprintEdit` path.

## S — Structure

- `packages/contracts/src/blueprint-nodes/` (new: `index.ts`, `events.ts`, `flow.ts`, `math.ts`, `logic.ts`, `variables.ts`, `scene.ts`); `blueprint.ts`, `blueprint-ops.ts`; `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`.
- `packages/session/src/blueprint.ts`, `blueprint-runtime.ts`, and a new `blueprint-eval/` table.
- `apps/desktop/src/blueprints/`: `rete-editor.ts`, new `context-menu.ts`, `node-search.ts`, `clipboard.ts`, `undo.ts`, `keys.ts`; `components/BlueprintPanel.svelte`, `BlueprintNodeFields.svelte`, new `NodeSearch.svelte`, `CanvasMenu.svelte`, `BlueprintVariables.svelte`.
- `apps/mcp/src/resources.ts`.
- `docs/warudo-parity.md` and `docs/evaluation/blueprint-catalog.md`.

## O — Operations

1. Contracts: node definitions for the 14 existing types; derive union, ports, labels, and defaults. No behavior change.
2. Session: evaluator table for the existing types. No behavior change.
3. Contracts and Rust: variables and the three operations, with validation vectors.
4. Runtime: graph state, reset rules, On Enable, run copy, and the new limits.
5. Runtime: flow nodes (Gate, Multi Gate, Throttle, For Loop, Switch On Number).
6. Runtime: math, logic, Random Number, and variable nodes.
7. Editor: settings form from fields, and the Variables section.
8. Editor: search palette, context menus, and wire release.
9. Editor: keys, clipboard, and undo.
10. MCP: node catalog resource and round-trip test.
11. Verify in the running macOS app and record evidence and parity.

## N — Norms

Use `@oshi-connect/ui` controls. Keep UI copy to node labels, category names, and the menu items in R10. Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript. Add unit tests for pure logic (evaluators, operations, undo, clipboard) and integration tests at the session, Rust, and MCP boundaries.

## S — Safeguards

- Do not change the type, version, or settings of an existing node type.
- Do not add a protocol command for undo; send normal edit batches.
- Do not let a failed run change graph state.
- Do not let a keyboard shortcut fire while a text field has focus.
- Do not use the system clipboard.
- Do not add the Rust copy of node settings.
- Do not add a scene effect in this slice.
- Do not claim a node as verified on macOS unless a running-app check or a session integration test covered it; record unit-only coverage as unit-only in parity.
