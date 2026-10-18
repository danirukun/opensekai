# REASONS: Blueprint data nodes (A)

Date: 2026-10-18. Scope: slice A of bundle B13 ([plan](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md)): literals, text, lists with For Each, string and integer switches, and typed variable nodes. Analysis: [Blueprint data nodes](../analysis/2026-10-18-blueprint-a-data.md). Issue: #81. Parity items: BP-01, BP-13. This contract builds on the [value model contract](2026-10-18-blueprint-w0-value-model.md) (W0) and uses its published interfaces. It adds the session tests that W0 R15 deferred.

## R — Requirements

R1. Literals (category Values). Each node has one setting `value` and one output `value` of its type.

| Type ID | Label | Setting | Output |
| --- | --- | --- | --- |
| `value.integer` | Integer | safe integer, default 0 | `value: integer` |
| `value.string` | String | string of at most 1024 code units, default `''` | `value: string` |
| `value.vector3` | Vector3 | three finite numbers, default `[0, 0, 0]` | `value: vector3` |

R2. String form. One function gives the string form of a scalar value: a `number` or an `integer` in the shortest JavaScript form (`String(value)`), with `-0` as `0`; a `boolean` as `true` or `false`; a `vector3` as `(x, y, z)` with each part in number form; a `string` with no change.

R3. Text nodes (category Text). The ports are data ports. All lengths and positions are in UTF-16 code units. A result above the string or list limit fails the run with `Blueprint value exceeds its limit` (W0 R7).

| Type ID | Label | Settings | Inputs | Outputs | Rule |
| --- | --- | --- | --- | --- | --- |
| `text.concat` | Concat | `count` 2..8, default 2 | `text0`…: string | `result: string` | Joins the inputs in order. |
| `text.format` | Format String | `template` string, `args` list of 0..8 scalar types, default `'{0}'` and `['string']` | `arg0`…: the type in `args` | `result: string` | Replaces `{n}` with the string form (R2) of argument `n`. `{{` gives `{` and `}}` gives `}`. A placeholder without an argument stays as text. The node reads only the arguments that the template uses, each one time. |
| `text.length` | String Length | — | `text: string` | `length: integer` | The code unit count. |
| `text.substring` | Substring | — | `text: string`, `start: integer`, `length: integer` | `result: string` | Clamps `start` to 0..text length and `length` to 0..the rest. |
| `text.contains` | String Contains | — | `text`, `search`: string | `result: boolean` | Case sensitive. An empty `search` gives true. |
| `text.startsWith` | Starts With | — | `text`, `search`: string | `result: boolean` | As above. |
| `text.endsWith` | Ends With | — | `text`, `search`: string | `result: boolean` | As above. |
| `text.replace` | Replace String | — | `text`, `search`, `replacement`: string | `result: string` | Replaces each match. An empty `search` gives `text` with no change. |
| `text.toUpper` | To Upper Case | — | `text: string` | `result: string` | `toUpperCase`. |
| `text.toLower` | To Lower Case | — | `text: string` | `result: string` | `toLowerCase`. |
| `text.trim` | Trim String | — | `text: string` | `result: string` | Removes white space at the two ends. |
| `text.split` | Split String | — | `text: string`, `separator: string` (unwired: `,`) | `result: string[]` | An empty separator gives one item for each code point. An empty `text` gives `['']` when the separator is not empty, and `[]` when it is empty. |
| `text.join` | Join Strings | — | `items: string[]`, `separator: string` (unwired: `,`) | `result: string` | Joins the items with the separator. |
| `text.equals` | String Equals | `ignoreCase` boolean, default false | `a`, `b`: string | `result: boolean` | With `ignoreCase`, compares `toLowerCase` forms. |
| `text.toString` | To String | `type`: `number`, `integer`, `boolean`, or `vector3`, default `number` | `value`: the `type` | `result: string` | The string form (R2). |
| `text.parseNumber` | Parse Number | — | `text: string` | `value: number`, `ok: boolean` | Trims the text. A decimal number with an optional sign, fraction, and exponent that is finite gives the value and true. Else 0 and false. |
| `text.parseInteger` | Parse Integer | — | `text: string` | `value: integer`, `ok: boolean` | Trims the text. Optional sign and digits only, and a safe integer, gives the value and true. Else 0 and false. |

Format String, To String, and Concat have ports that change with their settings (`dynamicPorts`).

R4. List nodes (category Lists). Each node has the setting `itemType` (a scalar type, default `string`). In the table, `T` is `itemType` and `T[]` is its list type. All list nodes have `dynamicPorts`. A list result above 256 items fails the run (W0 R7). An index is out of range when it is below 0 or not below the list length (for Insert: above the list length).

| Type ID | Label | Inputs | Outputs | Rule |
| --- | --- | --- | --- | --- |
| `list.make` | Make List | `item0`…: `T` (setting `count` 0..8, default 2) | `result: T[]` | The inputs in order. |
| `list.get` | Get List Item | `list: T[]`, `index: integer` | `item: T`, `ok: boolean` | Out of range: the default of `T` and false. |
| `list.length` | List Length | `list: T[]` | `length: integer` | |
| `list.append` | Append To List | `list: T[]`, `item: T` | `result: T[]` | A new list with `item` at the end. |
| `list.insert` | Insert Into List | `list: T[]`, `index: integer`, `item: T` | `result: T[]`, `ok: boolean` | Out of range: `list` with no change and false. |
| `list.removeAt` | Remove List Item | `list: T[]`, `index: integer` | `result: T[]`, `ok: boolean` | As above. |
| `list.set` | Set List Item | `list: T[]`, `index: integer`, `item: T` | `result: T[]`, `ok: boolean` | As above. |
| `list.contains` | List Contains | `list: T[]`, `item: T` | `result: boolean` | Equal values; a Vector3 is equal when the three parts are equal. |
| `list.indexOf` | List Index Of | `list: T[]`, `item: T` | `index: integer` | The first equal item, else -1. |
| `list.random` | Random List Item | `list: T[]` | `item: T`, `ok: boolean` | One step of the seeded run random (`RunState.random`) for each read of `item` from a list that is not empty. An empty list gives the default of `T` and false, with no step. |
| `list.forEach` | For Each | `flow`, `list: T[]` | `body: flow`, `item: T`, `index: integer`, `completed: flow` | R5. |

R5. For Each. When flow enters, For Each reads `list` once and keeps it in its node state (W0 R8). It calls the loop mechanism of For Loop with first 0, last `length - 1`, the iteration limit 256 (`MAX_BLUEPRINT_LIST_LENGTH`), and `clear`. So `body` runs once for each item in order, depth first, and then `completed` runs. An empty list runs only `completed`. `index` is the loop index. `item` is the kept item at `index`. A list cannot have more than 256 items, so the limit stops only a wrong call.
    - When the loop ends (also for an empty list), the runtime removes the loop index and the node state of For Each, before `completed` runs. A read of `item` or `index` outside the loop (in `completed`, or in a later run) gives the default of `T` and 0.
    - The loop mechanism takes optional `{ limit, clear }` (`LoopOptions`). For Loop does not pass them: its limit stays 64 and its index stays after the loop.
    - A loop step is not a node visit. The 512-visit limit for each event counts the node visits only, for For Loop and For Each. So a 256-item For Each with a body of one flow node runs; a body of two flow nodes reaches the visit limit before 256 items.

R6. Switches (category Switches). Each has `flow` and `value` inputs and the outputs `case0`… and `default`. Flow goes to the first case equal to `value`, else to `default`.

| Type ID | Label | Setting `cases` | `value` |
| --- | --- | --- | --- |
| `switch.string` | Switch On String | 1..8 (`MAX_SWITCH_CASES`) different strings of at most 1024 code units, default `['a', 'b']`; field kind `stringCases` | `string` (case sensitive) |
| `switch.integer` | Switch On Integer | 1..8 different integers from -1e6 to 1e6 (`IntegerCasesSchema`, shared with Switch On Number), default `[0, 1]`; field kind `cases` | `integer` |

Switch On Number (`flow.switch`) does not change.

R7. Variable nodes (category Variables).

| Type ID | Label | Settings | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `variable.get` | Get Variable | `variableId`, `type` (a data type) | — | `value`: `type` |
| `variable.set` | Set Variable | `variableId`, `type` (a data type) | `flow`, `value`: `type` | `exit` |
| `variable.appendList` | Append To List Variable | `variableId`, `type` (a list type) | `flow`, `item`: the item type | `exit` |
| `variable.clearList` | Clear List Variable | `variableId`, `type` (a list type) | `flow` | `exit` |
| `variable.incrementInteger` | Increment Integer Variable | `variableId` (an `integer` variable) | `flow`, `amount: integer` (unwired: 1) | `exit` |

- The defaults select the first variable of an allowed type and its type. With no such variable, the defaults are null.
- Set Variable writes the value (`checkBlueprintValue` first). Append writes a new list with the item at the end; a full list fails the run with `Blueprint value exceeds its limit`. Clear writes `[]`. Increment adds `amount`; a result that is not a safe integer fails the run with `Blueprint data could not be evaluated`.
- The compiler fails a graph with `Blueprint variable is missing` when the variable of a `typedVariable` field does not exist or its type is not the `type` setting. The check for the `variable` field kind does not change.
- When `updateVariable` changes the type of a variable, `applyBlueprintOps` writes the new type to the `typeKey` setting of each node with a `typedVariable` field on that variable. It then removes the inline values and wires that no longer type-check, as `setNodeSettings` does. A node whose settings cannot take the new type (a list node after a change to a scalar type) does not change, and the compiler reports `Blueprint variable is missing`. The Rust host checks only the operation structure, so it does not change.
- The six existing variable node types do not change. A type change of their variable still gives the compile error.

R8. Field kinds. `BlueprintField` appends three kinds:
- `{ kind: 'types'; options: readonly DataType[]; max: number }`: a list of types. The inspector shows a count select (0..`max`) and one select for each entry, labelled `{0}`, `{1}`, ….
- `{ kind: 'stringCases' }`: the inspector shows a text area with one case on each line, in the encoding of a String List default (W0 R13): plain text when that is safe (`happy`), else a JSON string (`""`, `"a\nb"`). Lines in macOS smart quotes read as JSON strings. So an empty case and a case with a line break keep their value. Empty lines are ignored. Text with 0 or more than 8 cases, a duplicate, or a case above the limit stays in the field and shows the error state; the settings do not change.
- The inspector and the Variables drawer set `autocorrect="off"`, `autocapitalize="off"`, and `spellcheck="false"` on their text fields (an action, because the UI kit does not pass these attributes).
- `{ kind: 'typedVariable'; typeKey: string; lists?: boolean }`: the inspector shows one select of the graph variables (list variables only when `lists`). A choice sets the key of the field to the variable ID and `typeKey` to the variable type in one settings change. An unknown ID shows as `Missing` (the shared fallback of the other reference selects).
The `itemType` and To String `type` settings use the `choice` kind of slice I.

R9. Audit and catalog. Each new node type has one row in `docs/evaluation/blueprint-node-audit.json` with a Warudo category, a Warudo name candidate or null, and `evidence: "tests"`. The catalog count test increases by 38.

R10. Tests.
- Unit (contracts): defaults parse, field keys (the `typeKey` of a `typedVariable` field counts as a settings key), port shapes that follow `itemType`, `type`, `count`, and `args`.
- Unit (session, pure): the string form, Format String (and its lazy reads), Substring, Split, Parse Number, Parse Integer, the index rules, list equality, and the string-cases parser.
- Unit (contracts): `updateVariable` retypes typed variable nodes, removes wires and inline values that no longer fit, keeps a list node on a scalar type change, and keeps the old variable nodes.
- Session (through `compileBlueprint` and `runFlow` or `createBlueprintRuntime`): each text and list node in a graph; For Each order, `item`, `index`, empty list, the 256-item limit, and the clear at the loop end; For Loop keeps 64; a graph that still compiles after a variable type change; Random List Item with a fixed seed; both switches; Get and Set Variable for each of the 10 types; Append, Clear, and Increment; the compile error for a variable with a different type.
- W0 R15 deferred cases: an `integer` output into a `number` input runs end to end; a `number` output into an `integer` input is rejected by `connect` and by the compiler; a run that makes a string or a list above its limit fails and leaves the variables with no change.

## E — Entities

- New node types: 3 literals, 17 text, 11 list, 2 switch, and 5 variable types (38).
- Settings: `{ value }`, `{ count }`, `{ template, args }`, `{ ignoreCase }`, `{ type }`, `{ itemType }`, `{ itemType, count }`, `{ cases }`, `{ variableId, type }`, `{ variableId }`.
- For Each node state: the list that it read (`NodeState`), removed when the loop ends.
- `BlueprintField` gains `types`, `stringCases`, and `typedVariable`.

## A — Approach

Put each family in a new definitions file and a new evaluator file. Put the pure helpers (string form, format, parse, index rules, list equality) in one session module, so the unit tests call them directly. Use the For Loop mechanism for For Each. Make the one compiler change for `typedVariable` next to the existing variable check. Add the three inspector branches in `BlueprintNodeFields.svelte`, with their text parsers in a new desktop module.

## S — Structure

- `packages/contracts/src/blueprint-nodes/{literals,text,lists,switches,typed-variables}.ts` (new); `define.ts` (append three field kinds; `numbered` takes a port type; `MAX_SWITCH_CASES` and `IntegerCasesSchema`); `flow.ts` (Switch On Number uses `IntegerCasesSchema`, no change in behavior); `index.ts` (one import and one spread for each family, two exports); `blueprint-ops.ts` (the retype on `updateVariable`; `setNodeSettings` shares the helper).
- `packages/session/src/blueprint-eval/{data-helpers,literals,text,lists,switches,typed-variables}.ts` (new); `index.ts` (one import and one spread for each family); `blueprint.ts` (the variable check in `compileBlueprint`; `LoopOptions` and the visit count in `runFlow`); `types.ts` (`LoopOptions`).
- `apps/desktop/src/blueprints/data-fields.ts` (new); `fields.ts` (`dataTypeOptions` takes the types); `components/BlueprintNodeFields.svelte` (three branches).
- Tests: `packages/contracts/test/blueprint-definitions.test.ts` (count and `typeKey`), `packages/contracts/test/blueprint-data-nodes.test.ts`, `packages/session/test/blueprint-data-helpers.test.ts`, `packages/session/test/blueprint-data-nodes.test.ts`, `apps/desktop/test/blueprint-data-fields.test.ts`.
- `docs/evaluation/blueprint-node-audit.json`, `docs/evaluation/blueprint-a-data.md`.

## O — Operations

1. Commit this contract and the analysis.
2. Contracts: the field kinds and the five families. Unit tests.
3. Session: helpers, evaluators, the compiler check. Unit and session tests, including the W0 R15 cases.
4. Editor: the three field branches and their parsers. Unit tests for the parsers.
5. Audit rows, catalog count, evaluation note. `pnpm check`, `pnpm test:unit`, `pnpm test:integration`.

## N — Norms

Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript and plain data. A value is immutable: a list node makes a new array. Use `@oshi-connect/ui` controls. Keep UI copy to field labels and port names.

## S — Safeguards

- Do not change an existing node type, its settings, its ports, or its behavior.
- Do not edit `math.ts`, `vector3.ts`, `logic.ts`, `events.ts`, `blueprint-runtime.ts`, the effect union in `session/blueprint.ts`, `docs/warudo-parity.md`, `ARCHITECTURE.md`, or a lockfile. The `flow.ts` edit is the shared case schema only.
- Do not change the For Loop limit or the index that For Loop leaves after its loop.
- Do not convert a float to an integer implicitly.
- Do not let a string or a list grow above its limit. Do not let a failed run change state.
- Do not change a list or a vector that a node read.
