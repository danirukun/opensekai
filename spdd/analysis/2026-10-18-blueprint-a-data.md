# Blueprint data nodes analysis (A)

Date: 2026-10-18. Scope: slice A of bundle B13 "Blueprint depth" ([plan](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md)). Issue: #81. Parity items: BP-01, BP-13. This slice uses the value model of slice W0 ([contract](../prompt/2026-10-18-blueprint-w0-value-model.md)).

## Problem

Slice W0 added the `integer`, `string`, and list types, typed variables, and inline input values. No node makes or uses a string or a list yet, and no node has an integer port in the core families. So an operator cannot:

- type a string, an integer, or a Vector3 constant in one node;
- join, format, cut, compare, or parse text;
- make a list, read or change its items, or run flow once for each item;
- route flow by a string or an integer value;
- read or write a string, integer, Vector3, or list variable.

The [node audit](../../docs/evaluation/blueprint-node-audit.md) shows Literals (31 Warudo nodes), Data (6), Switches (6), and Variables (29) with few or no OpenSekai nodes. Warudo puts most string operations under Arithmetic.

## Facts from the code

- `NodeDefinition.ports(settings)` sees only the node settings. It does not see the graph variables. A node whose ports follow a variable type must keep the type in its settings.
- `compileBlueprint` checks a `variable` field: the variable must exist and have the `variableType` of the field. The field type is fixed for each node type.
- `runFlow` has one loop mechanism: `FlowContext.loop(first, last)` keeps the index in `RunState.loops` and follows `body` once for each index, then `completed`. The limit is 64 iterations (`MAX_LOOP_ITERATIONS`) and 512 visits for each event.
- The runtime checks each data output against its port type and the size limits (W0 R7). A string above 1024 code units or a list above 256 items fails the run with `Blueprint value exceeds its limit`, and the run changes no state.
- `RunState.random` is the seeded generator that Random Number uses.
- `RunState.nodes` keeps plain data for each node ID (W0 R8).
- Slice I added the `choice` field kind (a select of fixed options).
- The definitions test requires one field for each settings key.

## Decisions

- **Literals.** Add Integer, String, and Vector3 literal nodes in the Values category, next to Number and Boolean.
- **Text nodes are pure data nodes.** Each one reads strings and gives one value. They work on UTF-16 code units, as the string limit does. Split with an empty separator gives one item for each code point, so it does not cut a surrogate pair.
- **Out-of-range text input clamps.** Substring clamps the start and the length to the string. Warudo (C#) throws. A failed run for a typed index is too strict for a live show.
- **Parse gives `ok`.** Parse Number and Parse Integer give the value and a Boolean `ok`. Text that is not a number gives 0 and `ok` false. The run continues, so the graph can branch on `ok`.
- **One string form for each scalar.** To String and Format String use the same rule: a number in the shortest JavaScript form, `true` or `false`, a Vector3 as `(x, y, z)`. Negative zero is `0`.
- **Format String.** The template uses `{0}` to `{7}`. `{{` and `}}` give one brace. A placeholder without an argument stays as text, so a template can be typed before its arguments exist. The settings keep one scalar type for each argument. This needs a field kind that edits a list of types.
- **Lists are typed by a setting.** Each list node has an `itemType` setting (a scalar type). The ports use the list type of it. The editor shows it with the `choice` field kind of slice I. A change of `itemType` removes the wires and inline values that no longer fit (W0 R5).
- **Index errors give `ok` false.** Get List Item, Insert, Remove At, and Set Item give `ok` false and the default item or the list with no change when the index is out of range. One rule for all index nodes is easy to learn.
- **For Each uses the For Loop mechanism.** For Each reads the list once when flow enters, keeps it in the generic node state, and calls `loop(0, length - 1)`. The `item` output reads the kept list at the loop index. So For Each has the 64-iteration limit of For Loop. A list of more than 64 items fails the run with `Blueprint loop exceeded its iteration limit`. The run limit (512 visits) does not change.
- **Switches.** Switch On String and Switch On Integer have up to 8 cases. Switch On Integer uses the existing `cases` field kind. Switch On String needs a new field kind with one case on each line. Switch On Number does not change.
- **Generic variable nodes keep the type in settings.** Get Variable and Set Variable have settings `{ variableId, type }`. The ports use `type`. The editor shows one select of all variables; a choice sets both keys. The compiler checks that the variable exists and has the type of the settings. This needs a new field kind (`typedVariable`) and one change in the compiler check. When the operator changes the type of a variable, a node that uses it gives the existing compile error `Blueprint variable is missing` until the operator selects it again. The existing six variable nodes behave the same way.
- **List variable helpers.** Append To List Variable and Clear List Variable accept list variables only. Append fails the run when the list is full (W0 limit). Increment Integer Variable uses the existing `variable` field with the `integer` type, and its `amount` input reads 1 when it has no wire and no inline value.
- **Categories.** Literals go to Values. Text nodes go to Text. List nodes and For Each go to Lists. The two switches go to Switches. Variable nodes go to Variables.

## Rejected approaches

- **Ports that follow the variable without a type setting.** The ports function does not see the graph. A change of the define contract is out of scope.
- **A For Each with its own loop in the runtime.** The runtime is owned by slice D. A second loop path duplicates the budget rules.
- **A raised loop limit for For Each.** A list has up to 256 items; 256 iterations with a body of two nodes reaches the 512-visit limit. One limit for both loops is easier to explain. The owner can raise the limit later.
- **Fail the run for an index out of range.** See above.
- **Format with one argument type.** A typed argument removes one To String node for each argument.
- **Case-insensitive switches and contains.** Only String Equals has an `ignoreCase` setting. The other nodes can use To Lower Case first.

## Effects

- An operator builds a chat-style text, a counter label, or a list of camera names with nodes, and runs flow for each item.
- The first integer, string, and list outputs exist. The deferred W0 session tests can now run (W0 R15).
- The catalog grows by 38 node types.
