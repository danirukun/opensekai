# Blueprint catalog and editor actions design

Date: 2026-10-09. Scope: BP-01, BP-02, and BP-03 partial. Reference: the [Warudo Blueprint handbook](https://docs.warudo.app/docs/blueprints/overview). The handbook has no node reference page. The node names below come from its tutorials. They are not verified against the live Warudo UI.

## Problem

The Blueprint system has 14 node types. A graph cannot keep a value, repeat a step, limit a hotkey that repeats, or choose between more than two paths. The editor adds a node only from a dropdown and an **Add** button. It deletes a node only from a button in the Inspector. It has no context menu, no keyboard shortcuts, no search, no copy and paste, and no undo.

To add a node type today, a developer edits six places: the zod union, `blueprintPorts`, the labels, the defaults, the runtime switch, and the settings form. The next slices add many more node types, so this cost grows with each slice.

This slice is the first of three. The later slices are continuous Blueprints (On Update with a transient override layer, and transform and property actions with easing) and character and camera actions. This slice adds no new scene effect.

## Decisions

1. **One definition for each node type.**
   - The module `packages/contracts/src/blueprint-nodes/` holds one file for each family: events, flow, math, logic, variables, and scene.
   - A definition holds the `type`, the `label`, the `category`, the search `keywords`, the zod settings schema, `ports(settings)`, `defaults(scene)`, and the Inspector `fields`.
   - The node union, `blueprintPorts`, the labels, the defaults, the search palette, the menus, the settings form, and the MCP node catalog all come from the definitions.
   - The session keeps an evaluator table keyed by `type` in place of the switch in `blueprint.ts`.
   - The 14 existing types keep their `type`, `version: 1`, and settings. Existing shows open without change.
   - A field kind is one of `number`, `boolean`, `entity`, `camera`, `output`, `variable`, `cases`, and `keystroke`. Only the keystroke field keeps its own component.

2. **Node set.** All data ports stay `number` or `boolean`. The added types are listed below; the existing 14 types stay.

   | Family | Node (type) | Inputs | Outputs | Settings and behavior |
   | --- | --- | --- | --- | --- |
   | Event | On Enable (`event.enable`) | — | `flow` | Fires once each time the graph state resets while the graph is enabled (decision 5). |
   | Flow | Gate (`flow.gate`) | `enter`, `open`, `close`, `toggle` (flow) | `exit` | `startOpen` (boolean). `enter` continues to `exit` only while the gate is open. The other inputs change the state and continue nowhere. |
   | Flow | Multi Gate (`flow.multiGate`) | `enter`, `reset` (flow) | `out0`…`out(n-1)` | `outputs` 2–8, `loop` (boolean). Each `enter` continues to the next output. After the last output, `loop` starts again at `out0`; without `loop`, `enter` continues nowhere until `reset`. |
   | Flow | Throttle (`flow.throttle`) | `flow` | `exit` | `seconds` 0.01–3600. The first fire continues. A later fire continues only when at least `seconds` of session time passed since the last fire that continued. |
   | Flow | For Loop (`flow.forLoop`) | `flow`, `first`, `last` (number) | `body`, `completed` (flow), `index` (number) | `first` and `last` are rounded. The loop runs `body` once for each index from `first` to `last`, then `completed`. When `last` is less than `first`, only `completed` runs. More than 64 iterations is a runtime error. |
   | Flow | Switch On Number (`flow.switch`) | `flow`, `value` (number) | `case0`…`case(n-1)`, `default` | `cases`: 1–8 unique integers. The rounded `value` selects the first case that is equal, else `default`. |
   | Math | Subtract, Multiply, Divide, Min, Max (`math.subtract`, `math.multiply`, `math.divide`, `math.min`, `math.max`) | `a`, `b` | `result` | Divide by zero gives a value that is not finite, which is a runtime error. |
   | Math | Clamp (`math.clamp`) | `value`, `min`, `max` | `result` | `min` greater than `max` is a runtime error. |
   | Math | Abs, Round, Floor (`math.abs`, `math.round`, `math.floor`) | `value` | `result` | Round uses JavaScript `Math.round`. |
   | Math | Random Number (`math.random`) | `min`, `max` | `result` | A number in [`min`, `max`). `min` equal to `max` gives `min`. `min` greater than `max` is a runtime error. The generator is part of the graph state (decision 5). |
   | Logic | Less Than, Greater or Equal, Less or Equal, Equal (`logic.less`, `logic.greaterOrEqual`, `logic.lessOrEqual`, `logic.equal`) | `a`, `b` (number) | `result` (boolean) | Equal compares exactly. |
   | Logic | And, Or (`logic.and`, `logic.or`) | `a`, `b` (boolean) | `result` (boolean) | Both inputs are read. |
   | Variable | Get Number Variable, Get Boolean Variable (`variable.getNumber`, `variable.getBoolean`) | — | `value` | `variableId`. Reads the value at the time of the read. |
   | Variable | Set Number Variable, Set Boolean Variable (`variable.setNumber`, `variable.setBoolean`) | `flow`, `value` | `exit` | `variableId`. |
   | Variable | Add To Number Variable (`variable.addNumber`) | `flow`, `amount` (number) | `exit` | `variableId`. |
   | Variable | Toggle Boolean Variable (`variable.toggleBoolean`) | `flow` | `exit` | `variableId`. |

   A variable node has its type in its node type, so its ports do not depend on the graph. A node that refers to a missing variable, or to a variable of the other type, is a compile error on that node.

3. **Variables belong to one graph and live only in the runtime.**
   - A graph document has `variables: [{ id, name, type: 'number' | 'boolean', default }]`. A graph holds at most 32 variables. IDs and names are unique in the graph. A name has 1 to 64 UTF-16 code units. The default has the type of the variable.
   - The key defaults to `[]`, so a document without it validates. A build before this slice rejects a show with a `variables` key.
   - New operations: `addVariable { graphId, variable }`, `updateVariable { graphId, variableId, name?, type?, default? }`, and `removeVariable { graphId, variableId }`. A change of `type` without a `default` resets the default to `0` or `false`.
   - When a variable is removed or changes type, the nodes that use it stay. They show a compile error, as a node with a missing entity does. This keeps each operation small and reversible.
   - A variable value is not saved in the show.

4. **Data reads.** A data input is evaluated each time its node fires, and the cache lasts for one input read, as today. A Get Variable node reads the value of the current run, so a Set earlier in the same run is visible. The `index` output of a For Loop gives the current index while `body` runs and the last index after the loop. Before the first loop run after a reset, it gives `0`.

5. **Graph state and On Enable.**
   - The state of a graph is: variable values, Flip Flop, Gate, Multi Gate, and Throttle state, For Loop indexes, the random generator, and pending delays.
   - The state resets when the session installs the graph (show open or `replaceAll`), when the logic of the graph changes, and when the graph changes from disabled to enabled. Logic includes the variables without their names. A change of node position, graph name, or variable name does not reset state.
   - A reset sets each variable to its default. It seeds the random generator from the graph ID (mulberry32 seeded by the 32-bit FNV-1a hash of the ID), so a run can be repeated.
   - After a reset of an enabled graph, the next tick fires each On Enable node of the graph. On Enable runs before due delays and input events, in node order.
   - An edit that changes logic therefore acts as a hot reload: the variables go back to their defaults, and the setup flow runs again.
   - A run writes state to a copy. The session keeps the copy only when the run succeeds, as it does for Flip Flop today. A later run in the same tick sees the kept state.

6. **Runtime limits.**
   - 512 flow visits per event and 1024 per tick. The previous values were 64 and 256; a For Loop needs more.
   - 64 effects per tick, 32 pending delays per graph, and 64 iterations for each loop entry.
   - A run that hits a limit fails. Its effects and state changes are dropped, and the graph gets a runtime error, as today.
   - The For Loop continues `body` depth first. All of the flow after `body` for one index runs before the next index. A Delay in `body` schedules one delay for each iteration and counts toward the 32 delays.

7. **Editor actions.**
   - **Context menu on the canvas:** a search palette at the pointer, with nodes grouped by category and matched on label and keywords. A choice adds the node at the pointer. The menu also has **Paste** (only when the clipboard has nodes) and **Select all**.
   - **Context menu on a node:** **Delete**, **Duplicate**, **Copy**, and **Disconnect all**. A Manual Trigger node also has **Run**. When the node is part of a selection of more than one node, each action applies to the selection.
   - **Context menu on a wire:** **Delete**.
   - **Wire released on empty canvas:** the same search palette opens. It shows only nodes with a compatible port. A choice adds the node at that point and connects the wire to the first compatible port.
   - The palette dropdown and **Add** button in the left panel become the same search field.
   - Controls come from `@oshi-connect/ui` (`Dropdown`, `Combobox`). Rete events supply the targets (`contextmenu` from the area plugin and `connectiondrop` from the connection plugin).

8. **Keyboard.** The keys work while the canvas has focus, and never while a text field has focus.
   - Delete or Backspace deletes the selection.
   - ⌘C copies and ⌘V pastes at the pointer.
   - ⌘D duplicates with an offset of 24 px.
   - ⌘A selects all.
   - ⌘Z undoes and ⇧⌘Z redoes.
   - Esc closes an open menu, else clears the selection.
   - On Windows, Control replaces ⌘.

9. **Clipboard.** Copy keeps the selected nodes and the wires between them in editor memory. Paste and Duplicate give new node and wire IDs, and keep the layout of the copied nodes relative to the pointer. Paste works into another graph. A pasted node that refers to a variable or entity that the target does not have stays, and shows its compile error. Paste does not add variables. The clipboard is not the system clipboard.

10. **Undo.**
    - The editor keeps one history for each graph, with up to 64 steps. One user action is one step: a delete, a paste, a duplicate, one drag of the selection, one settings change, one connect or disconnect, one variable change, or one menu action.
    - A step stores the inverse operations, computed at action time as the difference from the graph after the action to the graph before it. The difference includes variables and the wires that a cascade removed. Redo stores the forward operations in the same way.
    - Undo and redo send normal `blueprintEdit` batches. The protocol does not change, and other clients see a normal edit.
    - When the session rejects an undo batch because an ID no longer exists, the editor drops that step and shows "Changed elsewhere". Other edits from other clients stay; last writer wins for each property, as today.
    - An action with more than 64 operations is sent as more than one batch, in order, but stays one undo step.
    - Graph create and graph remove are not in the history. The history is cleared when the session resets.

11. **Variables panel.** The Blueprint panel has a Variables section for the selected graph. It can add, rename, retype, set the default of, and remove a variable. Each change is one undo step.

12. **MCP node catalog.** `blueprint_edit` accepts the new node types and variable operations without a new command. The resource `opensekai://blueprint-nodes` lists each node definition: type, label, category, ports, and the JSON Schema of its settings, generated from the definitions. The Rust host does not validate node settings, as before. It checks the structure of variables: IDs, sizes, a known type, and a default of that type.

## Limits

- The limits of the previous slice stay, except the flow visits in decision 6.
- 32 variables per graph.
- 64 undo steps per graph.
- 64 loop iterations per loop entry.

## Verification

- Unit: each definition's defaults pass its schema, and its ports match the table. Each evaluator family, including edge cases (divide by zero, Clamp with `min` greater than `max`, Random with equal bounds, Switch default, Multi Gate without loop, Throttle timing, For Loop with `last` less than `first` and with 65 iterations). Variable operations and cascades. Undo inverse operations, including a cascade. Clipboard ID mapping.
- Integration: session tests for On Enable, then a Set and Get of variables, then a For Loop. Hot reload after a logic edit. A run that exceeds the budget. The Rust validation vectors for `variables`. The MCP stdio round trip that adds a variable and new nodes, and reads `opensekai://blueprint-nodes`.
- Running app on macOS: the canvas, node, and wire context menus; the wire release search; each keyboard shortcut; undo and redo of a delete with wires; copy and paste into another graph; a hotkey graph that counts with a variable and selects a camera through Switch On Number.

## Out of scope

- On Update, transient runtime overrides, transform and property actions, and easing.
- Character, camera, expression, animation, prop, sound, and particle nodes.
- Math Expression, string and vector types, Show Toast, Inspect Value, On Disable, Do Once, and functions.
- Box select, groups and comments, auto layout, system clipboard import and export, and undo of graph create or remove.
- A Windows acceptance run.
