# REASONS: Blueprint value model (W0)

Date: 2026-10-18. Scope: slice W0 of bundle B13 ([plan](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md)): port types, values, variables, inline input values, generic node state, categories, and field kinds. Analysis: [Blueprint value model](../analysis/2026-10-18-blueprint-w0-value-model.md). Issue: #81. Parity items: BP-01, BP-02. This contract changes R1 of the [continuous contract](2026-10-12-continuous-blueprints.md) (each data input must be connected) and R4 of the [catalog contract](2026-10-09-blueprint-catalog.md) (variables are `number` or `boolean`).

## R — Requirements

R1. Data types. The scalar types are `number` (float), `integer`, `boolean`, `string`, and `vector3`. Each scalar type has a list type, written as the scalar name with `[]`: `number[]`, `integer[]`, `boolean[]`, `string[]`, `vector3[]`. A port type is `flow` or a data type. The name `number` does not change; it is the float type.
R2. Values.
    - `number`: a finite JavaScript number.
    - `integer`: a JavaScript safe integer (`Number.isSafeInteger`).
    - `boolean`: `true` or `false`.
    - `string`: a string of at most 1024 UTF-16 code units (`MAX_BLUEPRINT_STRING_LENGTH`).
    - `vector3`: a tuple of three finite numbers.
    - A list: an array of at most 256 items (`MAX_BLUEPRINT_LIST_LENGTH`). Each item is a value of the item type.
    - The defaults are `0`, `0`, `false`, `''`, `[0, 0, 0]`, and `[]` for each list type.
    - Values are immutable. Code that makes a new list or vector makes a new array. It never changes an array that it read.
R3. Connections. An output connects to an input when the two types are equal, or when the output is `integer` and the input is `number`. The integer value goes through with no change. No other pair connects. A float goes to an integer input only through an explicit node (wave 2). The `connect` operation, the settings change in `setNodeSettings`, the compiler, and the editor use this one rule.
R4. Variables. A variable has any data type (R1) and a default value of that type (R2). The limit stays 32 variables for each graph. `updateVariable` accepts each data type. A new type without a new default starts from the default of that type (R2). The existing six variable node types keep their type, settings, ports, and behavior. This slice adds no variable node type.
R5. Inline input values.
    - A node has an optional `inputs` object. Each key is the name of a data input of the node that has a scalar type. Each value is a value of that type (R2). A node has at most 16 inline values. A node without inline values has no `inputs` key.
    - A node that breaks one of these rules is not valid (`Invalid inline input`).
    - When a node reads a data input, the runtime uses the wire when the input has one. Else it uses the inline value. Else it uses the default of the input type (R2). A list input without a wire reads `[]`.
    - A data input without a wire is not a compile error. The compile error `Blueprint input is not connected` is removed. Flow ports do not change.
    - A wire does not remove the inline value. The value comes back into use when the wire is removed.
    - `setNodeSettings` checks the new settings first. Then it removes each inline value whose port is gone or whose port type is no longer the type of the value, as it removes wires that no longer connect.
    - A change of an inline value applies to the next run. It does not reset the graph state and does not clear a runtime error, because the runtime logic key (`logicKey` in `blueprint-runtime.ts`, owned by slice D) does not include inline values. A settings change resets the state. Slice D or the integrator decides if inline values join the logic key.
R6. Operation `setNodeInput { graphId, nodeId, port, value }`. `value` is a scalar value or `null`.
    - A value sets the inline value of the port. `null` removes it.
    - An unknown graph gives `NOT_FOUND` `Blueprint not found`. An unknown node gives `NOT_FOUND` `Node not found`.
    - A port that is not a scalar data input of the node, or a value that is not of the port type, gives `INVALID_INPUT` `Invalid inline input`.
    - The operation is appended to the end of the operation union. The Rust host checks its structure.
R7. Runtime value checks. The runtime checks each value that a data output gives against the output type (R2).
    - A number that is not finite, or a value of the wrong shape, fails the run with `Blueprint data could not be evaluated` (as before).
    - A string or a list above its limit fails the run with `Blueprint value exceeds its limit`.
    - A failed run changes no state (catalog contract R7).
    - A flow node that writes a value to state without a data output calls `checkBlueprintValue(type, value)`, which throws the same errors.
R8. Generic node state. `RunState` has a map `nodes` from node ID to plain data (`NodeState`). A new stateful node type keeps its state there and does not add a key to `RunState`. A run writes to a copy of the map, and the session keeps the copy only when the run succeeds. A node replaces its entry and never changes the stored object. The map resets with the other state (catalog contract R5). The existing maps (`flip`, `gates`, `multi`, `throttle`, `loops`) stay.
R9. Categories. `NodeCategory` adds `Switches`, `Timer`, `Text`, `Lists`, `Camera`, `Blueprints`, and `Debug`. The palette order is Events, Input, Flow, Switches, Timer, Values, Text, Lists, Math, Logic, Variables, Scene, Camera, Character, Blueprints, Debug. A category without a node does not show in the palette.
R10. Field kinds. `BlueprintField` adds `integer` (optional `min`, `max`), `string` (optional `maxLength`, at most 1024), and `vector3`. The `variable` field accepts each data type in `variableType`. The inspector shows a number input with step 1 for `integer`, a text input for `string`, and three number inputs for `vector3`. `DefaultRefs.variables` lists variables of each data type.
R11. Format. The graph `schemaVersion`, the Blueprint file `formatVersion`, and the show `schemaVersion` stay 1. All new fields are optional, and old type names keep their meaning, so each existing graph, file, and show loads with no change. A previous OpenSekai rejects a node with `inputs`, a variable of a new type, and a new node type. It does not misread them. It reports an unconnected data input as a compile error.
R12. Rust host. `validate_blueprint_node` accepts an optional `inputs` object with at most 16 keys; each key is a port name, and each value is a finite number, a boolean, a string of at most 1024 characters, or an array of three finite numbers. `variable_ok` accepts each data type with a default of the matching JSON shape. `updateVariable` accepts each data type. `validate_blueprint_ops` accepts `setNodeInput`. The host still does not check node settings or port types.
R13. Editor.
    - Each port type has its own socket appearance. A list socket is a square with the color of its item type.
    - A scalar data input without a wire shows an inline editor on the node: a number input for `number` and `integer` (step 1), a checkbox for `boolean`, a text input for `string`, and three number inputs for `vector3`. A list input shows no inline editor. An input with a wire shows only its label.
    - A change commits on `change` (Enter or blur) and sends one `setNodeInput`. An integer editor accepts only a safe integer. An invalid entry goes back to the stored value.
    - The editor uses `@oshi-connect/ui` `Input` and adds no helper text.
    - Undo records `setNodeInput`, and two edits of one inline value within 500 ms merge into one step.
    - The Variables drawer adds, retypes, and edits each data type. A list default is a text area with one item on each line; a `vector3` item is `x, y, z`.
R14. MCP. `blueprint_edit` accepts the new node, variable, and operation shapes through the shared contracts. The `opensekai://blueprint-nodes` resource adds `dataTypes` (R1) and `categories` (R9) next to `nodes` and `properties`. The `blueprint_edit` description names inline values and `setNodeInput`.
R15. Tests.
    - Unit: the compatibility rule, the value schemas and defaults, the limits, inline value validation, `setNodeInput`, the settings prune, typed variables, the Blueprint file and show round trip, `checkBlueprintValue`, the generic node state copy, undo of an inline edit, the graph patch, the canvas wired set, and the text parsers of the editors.
    - Session: an inline value in a run, a wire that wins over it, the type default after a clear, and string, list, and integer variables through edits and in the initial run state.
    - MCP integration (stdio): typed variables and an inline value through `blueprint_edit`, read back with `blueprint_inspect`.
    - Rust: the new structural checks.
    - Not in this slice: a session test of an integer to number wire, of a rejected number to integer wire, and of a run that fails at a limit. W0 has no node with an integer port or a node that makes a string or a list, so no graph can reach these paths. The unit tests of `canConnect`, `connectionType`, and `checkBlueprintValue` cover the rules. The first wave 2 slice that adds an integer output, an integer input, or a string or list output adds these session tests.

## E — Entities

- `ScalarType`, `ListType`, `DataType`, `PortType = 'flow' | DataType`.
- `ScalarValue = number | boolean | string | Vec3`. `BlueprintValue = ScalarValue | readonly number[] | readonly boolean[] | readonly string[] | readonly Vec3[]`.
- `BlueprintNode` gains `inputs?: InlineInputs` (`Record<string, ScalarValue>`).
- `BlueprintVariable`: `{ id, name, type: DataType, default }`, where `default` has the type of `type`.
- `BlueprintOp` adds `setNodeInput`.
- `RunState` adds `nodes: Map<Id, NodeState>`.
- `NodeCategory` adds seven names. `BlueprintField` adds three kinds.

## A — Approach

Put the value model in one new contracts module (`blueprint-values.ts`) with pure functions: type names, schemas, defaults, limits, and the compatibility rule. Build the node, variable, and operation schemas on it. Then change the session: inline reads, output value checks, and the generic state map. Then mirror the structure checks in Rust. Then change the editor: sockets, inline editors, the Variables drawer, the inspector fields, and undo. Keep each existing node type unchanged. Keep edits in files that other slices own to the lines that this contract needs.

## S — Structure

- `packages/contracts/src/blueprint-values.ts` (new), `blueprint-nodes/define.ts`, `blueprint-nodes/index.ts` (no change to the registration lines), `blueprint.ts`, `blueprint-ops.ts`, `index.ts`.
- `packages/session/src/blueprint.ts` (compile and read), `blueprint-eval/types.ts`.
- `crates/contracts/src/lib.rs`, `crates/contracts/tests/blueprint.rs`, `fixtures/protocol/blueprint-variables.json`.
- `apps/desktop/src/blueprints/rete-editor.ts` (sockets and inline input wiring only), `fields.ts`, `graph-patch.ts`, `undo.ts`; `components/BlueprintNodeView.svelte`, `BlueprintSocketView.svelte`, `BlueprintVariables.svelte`, `BlueprintNodeFields.svelte`; `app.css` (socket and inline editor rules).
- `apps/mcp/src/server.ts` (tool description only), `resources.ts` (node resource).
- Tests in `packages/contracts/test`, `packages/session/test`, `apps/desktop/test`.
- `docs/evaluation/blueprint-w0-value-model.md`.

## Published interfaces

Wave 2 contracts cite these names. All are exported from `@opensekai/contracts` unless the line names the session.

```ts
// packages/contracts/src/blueprint-values.ts
export const SCALAR_TYPES = ['number', 'integer', 'boolean', 'string', 'vector3'] as const;
export type ScalarType = (typeof SCALAR_TYPES)[number];
export type ListType = `${ScalarType}[]`;
export type DataType = ScalarType | ListType;
export const DATA_TYPES: readonly DataType[];            // the 5 scalar types, then the 5 list types
export const DATA_TYPE_LABELS: Record<DataType, string>; // 'Number', 'Integer', …, 'String List'
export const listOf: (type: ScalarType) => ListType;
export const itemType: (type: ListType) => ScalarType;
export const isListType: (type: string) => type is ListType;
export const isScalarType: (type: string) => type is ScalarType;
export const MAX_BLUEPRINT_STRING_LENGTH = 1024;
export const MAX_BLUEPRINT_LIST_LENGTH = 256;
export const MAX_INLINE_INPUTS = 16;
export type ScalarValue = number | boolean | string | Vec3;
export type BlueprintValue = ScalarValue | readonly number[] | readonly boolean[] | readonly string[] | readonly Vec3[];
export type ValueOf<T extends DataType>;                 // 'integer' -> number, 'string[]' -> readonly string[], …
export const blueprintValueSchema: (type: DataType) => z.ZodType<BlueprintValue>;
export const ScalarValueSchema: z.ZodType<ScalarValue>;  // any scalar value, used for the op and inputs
export const defaultBlueprintValue: <T extends DataType>(type: T) => ValueOf<T>;
export const isBlueprintValue: (type: DataType, value: unknown) => boolean;
// 'limit' when a string or list is too long, 'type' for any other mismatch, null when the value fits.
export const blueprintValueProblem: (type: DataType, value: unknown) => 'type' | 'limit' | null;
// The one connection rule: equal types, or integer output to number input.
export const canConnect: (output: PortType, input: PortType) => boolean;

// packages/contracts/src/blueprint-nodes/define.ts
export type PortType = 'flow' | DataType;
export type NodeCategory = 'Events' | 'Input' | 'Flow' | 'Switches' | 'Timer' | 'Values' | 'Text' | 'Lists'
  | 'Math' | 'Logic' | 'Variables' | 'Scene' | 'Camera' | 'Character' | 'Blueprints' | 'Debug';
export const NODE_CATEGORIES: readonly NodeCategory[];   // palette order as listed
export interface DefaultRefs { …; variables?: readonly { id: string; type: DataType }[] }
export type BlueprintField = …existing kinds…
  | { key: string; label: string; kind: 'integer'; min?: number; max?: number }
  | { key: string; label: string; kind: 'string'; maxLength?: number }
  | { key: string; label: string; kind: 'vector3' }
  | { key: string; label: string; kind: 'variable'; variableType: DataType };

// packages/contracts/src/blueprint-nodes/index.ts
export type InlineInputs = Partial<Record<string, ScalarValue>>;
// BlueprintNode = { id; version: 1; position; type; settings; inputs?: InlineInputs }
// The port type when a wire from the output can enter the input, else null. Callers test `=== 'flow'`.
export function connectionType(source: BlueprintNode, sourcePort: string, target: BlueprintNode, targetPort: string): PortType | null;
// The scalar type of an input that can hold an inline value, else null.
export const inlineInputType: (node: BlueprintNode, port: string) => ScalarType | null;
// True when each inline value of the node is on a scalar data input and has the type of that input.
export const inlineInputsFit: (node: BlueprintNode) => boolean;
// The value an unconnected input reads: the inline value, else the type default.
export function unconnectedInputValue(node: BlueprintNode, port: string): BlueprintValue;
// A copy of the node with one inline value set, or removed when value is null. It does not check the value.
export function withInlineInput<N extends BlueprintNode>(node: N, port: string, value: ScalarValue | null): N;
// A copy of the node without inline values that no longer fit its ports.
export function pruneInlineInputs<N extends BlueprintNode>(node: N): N;

// packages/contracts/src/blueprint-ops.ts (appended)
{ kind: 'setNodeInput'; graphId: Id; nodeId: Id; port: string; value: ScalarValue | null }

// packages/contracts/src/blueprint.ts
export type BlueprintVariable = { [T in DataType]: { id: string; name: string; type: T; default: ValueOf<T> } }[DataType];

// packages/session/src/blueprint-eval/types.ts
export type BlueprintValue;                              // re-exported from contracts
export type NodeState = BlueprintValue | null | readonly NodeState[] | { readonly [key: string]: NodeState };
export interface RunState { …existing maps…; nodes: Map<Id, NodeState> }
export const getNodeState: <T extends NodeState>(state: RunState, nodeId: Id) => T | undefined;
export const setNodeState: (state: RunState, nodeId: Id, value: NodeState) => void;
export const clearNodeState: (state: RunState, nodeId: Id) => void;
// Throws so the run fails with the R7 message.
export const checkBlueprintValue: (type: DataType, value: unknown) => void;
export class BlueprintLimitError extends RangeError {}
```

`blueprintNodeCatalog()` computes the default ports with sample references that contain one variable of each data type (ID equal to the type name), so a wave 2 variable node with `defaults` that need a variable of its type is in the catalog.

A wave 2 evaluator reads inputs with `read(port)` as before. It does not read `node.inputs`; the runtime resolves the wire, the inline value, and the default. A data evaluator returns a value of its output type; the runtime checks it (R7).

Suggested Warudo palette mapping for the audit rows of wave 2 nodes (each is a candidate): Text → Arithmetic or Data, Lists → Data, Switches → Switches, Timer → Timer, Debug → Debug, Blueprints → Blueprints, Camera → Cinematography. The audit file lists Warudo categories, so no change to its allowed list is necessary.

## O — Operations

1. Commit this contract and the analysis.
2. Contracts: `blueprint-values.ts`, the port type, the compatibility rule, the categories, the field kinds, inline inputs in the node schema, the variable schema, `setNodeInput`, and the settings prune. Unit tests.
3. Session: the compile rule, inline reads, output value checks, the generic state map, and `checkBlueprintValue`. Unit and session tests.
4. Rust: the structure checks and tests. Shared variable vectors.
5. Editor: sockets, inline editors, the Variables drawer, the inspector fields, the graph patch, and undo. Unit tests for the pure parts.
6. MCP: the tool description.
7. Evaluation note, `pnpm check`, unit and integration tests.

## N — Norms

Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript and plain data. Use `@oshi-connect/ui` controls. Keep UI copy to type labels and port names. Keep edits in other slices' files small and local.

## S — Safeguards

- Do not rename `number` and do not change an existing node type, its settings, its ports, or its behavior with all inputs connected.
- Do not change the graph, file, or show version numbers.
- Do not let a value grow above a limit. Do not let a failed run change state.
- Do not convert a float to an integer implicitly.
- Do not store an inline value that does not match its port type.
- Do not add a variable node type, a new node type, or a scene effect in this slice.
- Do not edit `docs/warudo-parity.md`, `ARCHITECTURE.md`, or a lockfile.
