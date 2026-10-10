# Blueprint catalog analysis

Date: 2026-10-09. Scope: BP-01, BP-02, and BP-03 partial. Design: [Blueprint catalog and editor actions](../../docs/superpowers/specs/2026-10-09-blueprint-catalog-design.md).

## Problem

The operator can make a hotkey show a prop or switch a camera, but a graph cannot count, remember a value, repeat a step, or select one of many paths. Warudo has variables, Gate, Throttle, For Loop, Switch On Integer, Multi Gate, and a full set of math and compare nodes. The operator also expects normal node-editor actions: right-click to add or delete, Delete key, copy and paste, and undo. The editor has none of these.

Each node type is defined in six places today. The two later slices (continuous Blueprints, and character and camera actions) add many node types, so this slice first moves each type into one definition.

## Decisions

- One definition for each node type in contracts. The session, the editor, and MCP read the same definitions.
- 28 new node types with `number` and `boolean` data only: On Enable, Gate, Multi Gate, Throttle, For Loop, Switch On Number, nine math nodes, Random Number, six compare and logic nodes, and six variable nodes.
- Variables belong to one graph. Their values live only in the session runtime and reset with the graph state. The operator chose this over global variables and saved values.
- A reset of an enabled graph fires On Enable. A logic edit is a hot reload.
- Random Number uses a generator seeded from the graph ID, so runs can be repeated.
- The flow budget goes up to 512 visits per event and 1024 per tick, because a For Loop needs more than 64 visits.
- Right-click menus on the canvas, a node, and a wire. A search palette at the pointer, also when a wire is released on empty canvas.
- Keyboard shortcuts, an editor-memory clipboard, and an undo history per graph that sends normal edit batches.
- MCP reads a generated node catalog resource.

## Effects

- Existing shows open without change. A show saved with variables does not open in an earlier build.
- Undo uses the existing edit path, so the session, MCP, and other editors need no protocol change.
- A logic edit now resets variables and runs On Enable again. The operator sees setup run again while editing. This is intended.
- The Rust host stays structural. It learns the `variables` key and the three variable operations.

## Out of scope

On Update and transient overrides, transform and property actions, character and camera actions, Math Expression, strings and vectors, toasts and value inspection, functions, box select, groups, auto layout, and system clipboard import and export.
