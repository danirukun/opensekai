# Blueprint data nodes check

Slice A of bundle B13 ([contract](../../spdd/prompt/2026-10-18-blueprint-a-data.md)). Checked 2026-10-18 on macOS 27.0.1 (arm64), Node 26.12.0, pnpm 12.8.1, on branch `opensekai/bp-a-data` from base `3e0a7ea` (the integration branch with W0, G, H, and I). Only automated checks ran. The desktop app, the renderer, and OBS did not run, so no editor, macOS, or OBS result is claimed.

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm check` | Passed: all packages and `tsconfig.scripts.json`; svelte-check 0 errors, 0 warnings |
| `pnpm test:unit` | 1144 passed in 151 files, 0 failed |
| `pnpm test:integration` | 41 passed, 2 skipped in 18 files (1 file skipped), with the ignored `artifacts/models/` files copied from the main checkout |

New tests (29):

- `packages/contracts/test/blueprint-data-nodes.test.ts` (6): list ports follow `itemType`; Concat, Format String, and To String ports follow their settings; switch case rules; literal limits; typed variable ports and defaults; an `itemType` change removes the wires and inline values that no longer fit.
- `packages/session/test/blueprint-data-helpers.test.ts` (7): the string form, Format String placeholders and braces, Substring clamps, Split by code point, Parse Number and Parse Integer, the index rules without a change to the input list, and Vector3 equality.
- `packages/session/test/blueprint-data-nodes.test.ts` (13), through `compileBlueprint` and `runFlow` or `createBlueprintRuntime`: each literal, text, and list node in a graph; text results above the string and list limits; Random List Item with a fixed seed and an empty list; For Each order, `index`, `item`, `completed`, an empty list, and the 64-item limit; both switches; Get and Set Variable for each of the 10 data types; the compile error for a variable of a different type; Append, Clear, and Increment with their limits; and the three W0 R15 cases (integer output into a number input, a number output into an integer input rejected at `connect` and at compile, and a run above the string or list limit that fails and keeps the variables).
- `apps/desktop/test/blueprint-data-fields.test.ts` (3): the string-cases parser, the typed variable options and choice, and the argument type resize.

Changed tests: `packages/contracts/test/blueprint-definitions.test.ts` (catalog count 106, two more sample variables, and the `typeKey` of a `typedVariable` field counts as a settings key); `apps/desktop/test/node-search.test.ts` (a search for "random" also finds Random List Item).

## What the macOS run must check

Use the integrated QA build. Record the backend, the quality profile, and the commit.

1. Open the palette. The Values category shows Integer, String, and Vector3. Text, Lists, and Switches show their nodes. The Variables category shows Get Variable, Set Variable, and the list and integer helpers only when the graph has a variable of a fitting type.
2. Add a String variable `Name` and a String List variable `Names` (one JSON string on each line, for example `"Ann"` and `"Bo"`). Add Get Variable and select `Names`. The output socket becomes a list socket. Select `Name`. The socket becomes a string socket, and a wire that no longer fits goes.
3. Build Manual Trigger → For Each (Item type String) with the list from Get Variable `Names` → body → Append To List Variable (a second String List variable `Log`) with the item from Format String (template `{0}:{1}`, arguments Integer and String, wired from `index` and `item`). Run it. Check `Log` with a later run that shows its length (List Length into a Number variable, or Format String into a String variable).
4. Switch On String: type `happy`, `sad` on two lines in Cases. The node shows `case0`, `case1`, and `default`. Type a duplicate line. On blur, the field goes back to the stored cases.
5. Switch On Integer: cases `1, 2`. Wire Parse Integer `value` into `value`. Try to wire a Number output into the integer `value`. The editor refuses the wire.
6. Format String: change the Arguments count to 3, then the type of `{2}` to Vector3. The node shows `arg2` with a Vector3 socket and an inline Vector3 editor.
7. Concat with inline values: type 1000 characters in `text0` and 100 in `text1`, and wire the result to Set Variable. Run it. The run fails with `Blueprint value exceeds its limit`, and the variable keeps its value.
8. Increment Integer Variable with no wire on `amount` adds 1 on each run.
9. Save and reopen the show. The new nodes, their settings, and their inline values load with no change.

## Gaps

- No editor, macOS, or OBS evidence. The inspector branches (string cases, typed variable select, argument types) are checked only by svelte-check and the parser unit tests.
- For Each has the 64-iteration limit of For Loop, but a list can hold 256 items. A longer list fails the run.
- A change of a variable type makes each Get Variable and Set Variable that uses it fail to compile (`Blueprint variable is missing`) until the operator selects the variable again. The six existing variable nodes behave the same way.
- Text lengths and positions are UTF-16 code units, not characters.
- The Warudo names are candidates, and most are not recorded.
