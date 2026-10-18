# Blueprint value model analysis (W0)

Date: 2026-10-18. Scope: slice W0 of bundle B13 ([plan](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md)). Issue: #81. Parity items: BP-01, BP-02.

## Problem

The Blueprint value model is too small for the wave 2 node families.

- A port carries `flow`, `number`, `boolean`, or `vector3` only. Warudo has Boolean, Integer, Float, String, Vector3, and a list of each type.
- A variable is `number` or `boolean` only.
- Each data input must have a wire. In Warudo, an input without a wire shows a value on the node, and the operator types the value there. In OpenSekai, a constant needs one extra Number or Boolean node and one wire.
- Each stateful node type adds one map to `RunState`. Wave 2 adds Do Once, Debounce, timers, and other stateful nodes. Each one would change the shape of `RunState` and the clone code.
- The palette categories have no place for text, lists, switches, timers, debug, Blueprint control, or camera nodes.
- The [node audit](../../docs/evaluation/blueprint-node-audit.md) shows that Arithmetic (183 Warudo nodes) and Variables (29) differ mainly by type coverage.

## Owner decisions (2026-10-18)

- Integer and float are two types. The existing `number` port type is the float type. Its name does not change, so saved graphs keep their meaning.
- An integer output connects to a float input. The value widens with no change.
- A float goes to an integer input only through an explicit node (Round, Floor, Ceil, Truncate in wave 2).
- An integer is a JavaScript safe integer.

## Requirements

1. Port types: add `integer`, `string`, and a list type for each scalar type. One function decides which output type connects to which input type. Each caller (editor, operations, compiler) uses it.
2. Values: one value shape for each port type, one default value for each type, and fixed size limits for strings and lists. The runtime fails a run that makes a value above a limit. A value never grows without a limit.
3. Variables: each data type, including lists. The existing number and boolean variable nodes do not change. This slice adds no new variable node types (wave 2 slice A does).
4. Inline values: a node can store a value for each scalar data input. The runtime reads the wire when one exists, else the inline value, else the default of the type. A data input without a wire is not an error. One new Blueprint operation sets or clears an inline value, for the editor and MCP.
5. Run state: one generic map from node ID to plain data, so a new stateful node does not change the `RunState` shape. A run writes to a copy, and the session keeps the copy only when the run succeeds.
6. Categories: `Text`, `Lists`, `Switches`, `Timer`, `Debug`, `Blueprints`, and `Camera`.
7. Field kinds: integer, string, Vector3, and a variable field for each data type.
8. File format: decide if the graph `schemaVersion`, the Blueprint file `formatVersion`, or the show `schemaVersion` must change.
9. Editor: a socket appearance for each type, inline editors on the node for unconnected scalar inputs, and the Variables drawer for each type.
10. MCP and the Rust host accept the new shapes.

## Decisions

- **Type names.** Scalar types are `number`, `integer`, `boolean`, `string`, and `vector3`. A list type is the scalar name with `[]`, for example `string[]`. The name tells the item type with no lookup table, and it is a valid JSON string.
- **One compatibility rule.** `canConnect(output, input)` is true when the types are equal, or when the output is `integer` and the input is `number`. Lists do not widen. `integer[]` to `number[]` is not in the owner decision, and a later slice can add it without a format change.
- **Limits.** A string has at most 1024 UTF-16 code units. A list has at most 256 items. A string of 1024 characters is longer than a chat message (Twitch allows 500). With these limits, the largest variable is a list of 256 strings of 1024 characters. 32 such variables are about 8 M code units, which is a fixed upper bound. The 192 KiB set limit stops a stored graph before that bound, so stored values stay small. The runtime checks each data value that a node makes against its port type and the limits. A value above a limit fails the run with `Blueprint value exceeds its limit`.
- **Inline values for scalar types only.** A list input without a wire reads the empty list. A list literal on a node needs a list editor and makes nodes large. A list variable has a default list, so the operator can make a list without an inline value.
- **Inline storage.** A node gets an optional `inputs` object: port name to value. The key is optional, so a node without inline values has the same JSON as before. A node has at most 16 inline values. Each value must match the type of its port. A settings change that removes a port or changes its type removes the inline values that no longer match, as it removes the wires.
- **Wire wins.** When an input has a wire, the runtime ignores its inline value. The value stays on the node, so it comes back when the operator removes the wire. This is the Warudo behavior.
- **One new operation.** `setNodeInput { graphId, nodeId, port, value }` sets one inline value. `value: null` removes it, and the input then reads the type default. One operation for one value keeps undo steps small and lets MCP set a value without the node settings.
- **Generic node state.** `RunState.nodes` is a `Map<Id, NodeState>`. `NodeState` is plain data (values, null, arrays, and objects of these). A node must replace its state and never change the stored object, because the run copy is a shallow map copy. The existing maps (`flip`, `gates`, `multi`, `throttle`, `loops`) stay, because slice D owns their evaluators.
- **Variable types.** A variable type is any data type. The `variable` field keeps `variableType` and accepts each data type. The compiler check stays exact: a Get String Variable node needs a `string` variable.
- **Labels.** `number` keeps the label Number, because the existing nodes are named Number, Get Number Variable, and Switch On Number. A rename to Float is a UI decision for the owner (see open questions in the contract).
- **No version change.** The graph keeps `schemaVersion: 1`, the Blueprint file keeps `formatVersion: 1`, and the show keeps `schemaVersion: 1`. A previous OpenSekai rejects each new shape and does not misread it:
  - A node with `inputs` fails the strict node schema (TypeScript) and the key check (Rust).
  - A variable of a new type fails the variable schema.
  - A new node type (wave 2) fails as an unknown node type.
  - A graph with an unconnected data input loads, and the old compiler reports `Blueprint input is not connected`. The graph does not run with a wrong value.
  A graph saved by a previous OpenSekai loads with no change, because each new field is optional and each old type keeps its name and meaning.
- **Rust host.** The host checks the structure of nodes, variables, and operations (catalog contract R17). It must accept `inputs`, the new variable types, and `setNodeInput`. It still does not check node settings or port types.

## Rejected approaches

- **Rename `number` to `float`.** Each saved graph and the catalog would change, and a migration would be necessary. The owner decision keeps `number`.
- **Store inline values in `settings`.** Settings schemas are strict and differ for each node type. Each schema would need a change, and `setNodeSettings` would replace inline values.
- **A generic `list` type with an item type field.** A port type would become an object, and each comparison and map key would need a serializer.
- **Implicit float to integer conversion.** Rejected by the owner.
- **Inline list values.** See the decision above.
- **Move all state maps to the generic map now.** Slice D owns the flow evaluators. A move now makes merge conflicts for no change in behavior.
- **A schema version bump.** The old reader already rejects each new shape. A bump would need a migration for no gain.

## Effects

- An operator types a constant on the node. A graph needs fewer Number and Boolean nodes.
- A graph that the old compiler rejected for an unconnected input now runs, with the default value of the type. For example, an unconnected Add reads 0 + 0.
- Wave 2 can add integer, string, and list nodes, variables, and stateful nodes without a change to the value model.

## Out of scope

New node types, new variable node types, list and string operations, a rename of `number` to Float in the UI, `integer[]` to `number[]` widening, and color or other Warudo types.
