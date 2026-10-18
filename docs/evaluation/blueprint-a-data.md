# Blueprint data nodes check

Slice A of bundle B13 ([contract](../../spdd/prompt/2026-10-18-blueprint-a-data.md)). Checked 2026-10-18 on macOS 27.0.1 (arm64), Node 26.12.0, pnpm 12.8.1, on branch `opensekai/bp-a-data` from base `6629941` (the integration branch with W0, G, H, and I), after the review fixes. Only automated checks ran. The desktop app, the renderer, and OBS did not run, so no editor, macOS, or OBS result is claimed.

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm check` | Passed: all packages and `tsconfig.scripts.json`; svelte-check 0 errors, 0 warnings |
| `pnpm test:unit` | 1226 passed in 160 files, 0 failed (at `56b12b7` plus the smart-quote fix) |
| `pnpm test:integration` | 53 passed, 2 skipped in 22 files (1 file skipped), with the ignored `artifacts/models/` files copied from the main checkout |

New tests (34):

- `packages/contracts/test/blueprint-data-nodes.test.ts` (7): list ports follow `itemType`; Concat, Format String, and To String ports follow their settings; switch case rules; literal limits; typed variable ports and defaults; an `itemType` change removes the wires and inline values that no longer fit; `updateVariable` with a new type retypes typed variable nodes, removes the wires and inline values that no longer fit, keeps a list node on a scalar type, and keeps the old variable nodes.
- `packages/session/test/blueprint-data-helpers.test.ts` (8): the string form, Format String placeholders and braces, Format String reads only the used arguments once, Substring clamps, Split by code point, Parse Number and Parse Integer, the index rules without a change to the input list, and Vector3 equality.
- `packages/session/test/blueprint-data-nodes.test.ts` (16), through `compileBlueprint` and `runFlow` or `createBlueprintRuntime`: each literal, text, and list node in a graph; text results above the string and list limits; Random List Item with a fixed seed and an empty list; For Each order, `index`, `item`, `completed`, an empty list, 256 items, and no saved list or index after the loop (a later run reads the defaults); For Loop still fails above 64; a graph that compiles and runs after `updateVariable` changes the variable type (through `createSession`); both switches; Get and Set Variable for each of the 10 data types; the compile error for a variable of a different type; Append, Clear, and Increment with their limits; and the three W0 R15 cases (integer output into a number input, a number output into an integer input rejected at `connect` and at compile, and a run above the string or list limit that fails and keeps the variables).
- `apps/desktop/test/blueprint-data-fields.test.ts` (3): the string-cases round trip (plain text, JSON only where needed, smart quotes, an empty case, and a line break), the typed variable options and choice, and the argument type resize.

Changed tests: `apps/desktop/test/blueprint-fields.test.ts` (string list items: plain text, JSON only where needed, smart quotes, literal lines; 2 new tests); `packages/contracts/test/blueprint-definitions.test.ts` (catalog count 106, two more sample variables, and the `typeKey` of a `typedVariable` field counts as a settings key); `apps/desktop/test/node-search.test.ts` (a search for "random" also finds Random List Item).

## What the macOS run must check

Use the integrated QA build. Record the backend, the quality profile, and the commit.

1. Open the palette. The Values category shows Integer, String, and Vector3. Text, Lists, and Switches show their nodes. The Variables category shows Get Variable, Set Variable, and the list and integer helpers only when the graph has a variable of a fitting type.
2. Add a String variable `Name` and a String List variable `Names` (one item on each line, for example `Ann` and `Bo`; type also `"Cy"` with smart quotes on, and it reads as `Cy`). Add Get Variable and select `Names`. The output socket becomes a list socket. Select `Name`. The socket becomes a string socket, and a wire that no longer fits goes. In the Variables drawer, change the type of `Name` to Integer. The Get Variable socket becomes an integer socket, and the graph has no compile error.
3. Build Manual Trigger → For Each (Item type String) with the list from Get Variable `Names` → body → Append To List Variable (a second String List variable `Log`) with the item from Format String (template `{0}:{1}`, arguments Integer and String, wired from `index` and `item`). Run it. Check `Log` with a later run that shows its length (List Length into a Number variable, or Format String into a String variable).
4. Switch On String: type `happy`, `sad` on two lines in Cases. The node shows `case0`, `case1`, and `default`. Type a duplicate line. On blur, the text stays and the field shows the error state, and the node keeps the stored cases.
5. Switch On Integer: cases `1, 2`. Wire Parse Integer `value` into `value`. Try to wire a Number output into the integer `value`. The editor refuses the wire.
6. Format String: change the Arguments count to 3, then the type of `{2}` to Vector3. The node shows `arg2` with a Vector3 socket and an inline Vector3 editor.
7. Concat with inline values: type 1000 characters in `text0` and 100 in `text1`, and wire the result to Set Variable. Run it. The run fails with `Blueprint value exceeds its limit`, and the variable keeps its value.
8. Increment Integer Variable with no wire on `amount` adds 1 on each run.
9. Save and reopen the show. The new nodes, their settings, and their inline values load with no change.

## Gaps

- No editor, macOS, or OBS evidence. The inspector branches (string cases, typed variable select, argument types) are checked only by svelte-check and the parser unit tests.
- For Each runs up to 256 items, but the 512-visit limit for each event stops a body of more than one flow node before 256 items.
- Loop steps no longer count as visits, also for For Loop. A For Loop with a large body can now run a few more nodes before the visit limit.
- A list variable that becomes a scalar type makes Append To and Clear List Variable fail to compile (`Blueprint variable is missing`). The six existing variable nodes also give this error after a type change.
- Text lengths and positions are UTF-16 code units, not characters.
- The Warudo names are candidates, and most are not recorded.
