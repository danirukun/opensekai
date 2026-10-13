# REASONS: Blueprint files

Date: 2026-10-13. Scope: export one Blueprint to a JSON file and import such a file into the open show, in the editor and through MCP, with fixture files, integration tests, and an end-to-end run against the app. Analysis: [Blueprint files](../analysis/2026-10-13-blueprint-files.md). Parity item: BP-04.

## R — Requirements

R1. A Blueprint file is UTF-8 JSON of at most 1 MiB with this shape:
    - `format`: the string `opensekai.blueprint`.
    - `formatVersion`: the integer `1`.
    - `graph`: one `BlueprintGraph` (schema version 1), not changed.
    - `references`: at most 256 entries `{ id, kind, name }`, the largest number of reference values a graph can hold, one for each distinct value in the graph's `entity`, `camera`, and `output` fields. `kind` is `avatar`, `mesh`, `camera`, `output`, or `unknown`. `name` has 1 to 256 characters, because an output ID can have 256.
    - The file has no other keys. It does not store the view, the export time, or the app version.
R2. `exportBlueprint(graph, scene)` makes the file object. Each entity reference gets the kind and name of the entity in the scene. Each output reference gets the kind `output` and the output ID as its name. A value that is not in the scene gets the kind `unknown` and its ID as its name. Entries are in the order of first use (nodes in graph order, fields in catalog order). `serializeBlueprintFile(file)` writes JSON with two-space indentation and a final newline.
R3. `importBlueprint(input, scene, newId)` checks the input in this order and stops at the first failure. No part of a failed file is added.
    1. Text longer than 1 MiB (UTF-8 bytes): `INVALID_INPUT`, `Blueprint file is too large`.
    2. Not JSON, not an object, or `format` is not `opensekai.blueprint`: `INVALID_INPUT`, `Not an OpenSekai Blueprint file`. A Warudo file fails here.
    3. `formatVersion` is not a positive integer: the same error. A `formatVersion` above 1: `VERSION_MISMATCH`, `Blueprint file needs a newer OpenSekai`.
    4. A node type that is not in the catalog: `UNSUPPORTED`, `Unknown node types: <types>`, with at most five distinct types in file order of first use, and the IDs of those nodes as `ids`.
    5. The file schema (R1) and `BlueprintGraphSchema`: `INVALID_INPUT` with the first issue message.
    A graph larger than the Blueprint store limit (192 KiB of compact JSON) gives `INVALID_INPUT`, `Blueprint file is too large`, the same as step 1.
R4. Import gives the graph a new ID from `newId`. Node, connection, and variable IDs, the name, the positions, and the settings stay the same, except for the references in R5.
R5. Import resolves each distinct reference value one time and changes every field that uses it:
    - **ID.** The scene has an entity with the same ID that the field kind accepts (`entity`: avatar, mesh, or camera; `camera`: camera), or an output with the same ID for an `output` field. The value stays.
    - **Name.** Otherwise the scene has exactly one entity with the same name and the same kind as the reference entry, and the field kind accepts it. The value changes to that entity ID. Outputs and `unknown` entries match by ID only.
    - **Missing.** Otherwise, including two or more name matches, the value stays and the reference is missing. A field value without a reference entry matches by ID only, and its name is its ID. A reference entry that no field uses is ignored.
R6. The imported graph keeps `enabled` from the file, unless a reference is missing. Then it is imported with `enabled: false`.
R7. The import result is `{ graph, report }`. The report is `{ graphId, enabled, remapped: [{ name, kind, from, to }], missing: [{ name, kind, id, nodeIds }] }`. The caller adds the graph with one `createGraph` op through `blueprintEdit`. The existing limits apply, for example 8 graphs.
R8. Export uses the graph that the session stores (`blueprintInspect`), not an editor draft.
R9. The native host has two Tauri commands for the editor window only:
    - `import_blueprint_file()`: a file dialog with the title `Import Blueprint` and the filter `OpenSekai Blueprint` (`json`). It returns the file text, or null when the operator cancels. A file above 1 MiB is refused before it is read, with `INVALID_INPUT` `Blueprint file is too large`.
    - `export_blueprint_file(name, text)`: a save dialog with the title `Export Blueprint`, the same filter, and the default file name `<name>.json`, with characters that are not allowed in file names changed to `_`. It writes the text and returns the path, or null on cancel. It refuses text above 1 MiB.
    - Neither command parses the file.
R10. The editor Blueprint list has an **Import** button next to **New**, disabled under the same conditions, and an **Export** action on each row. The row actions appear on hover, on focus, or on the selected row. After an import the editor selects the new graph. When the report has missing references, the panel shows `Missing: <names>` until the operator selects another graph or makes the next edit. A field whose value is not in its choices shows the option **Missing**. Import and export errors show in the existing panel error line.
R11. MCP has two tools, added after `blueprint_inspect` in the tool list:
    - `blueprint_export { sceneId, graphId }`: returns `{ file }`. An unknown graph gives `NOT_FOUND`.
    - `blueprint_import { sceneId, file }`: `file` is the JSON object.
    - Both tools take `sceneId` because `sceneInspect` needs it. It runs R3 to R7, sends `createGraph` through `blueprintEdit`, and returns `{ revision, report }`.
    - The tools use the same contract functions and the existing app commands. The host gets no new method.
R12. `fixtures/blueprints/` holds these files. Each valid file uses the names and IDs of the smoke scene (`fixtures/protocol/valid-scene.json`) unless a row says otherwise:

    | File | Content |
    | --- | --- |
    | `nudge.json` | Manual event → Set Asset Property position of `reference` to a constant Vector3 |
    | `drift.json` | On Update → Move Entity `reference` (world) by a constant speed × `deltaSeconds` |
    | `wasd.json` | On Update, Key Axis (D, A) and (S, W), Move Entity `performer` (local) |
    | `camera-flip.json` | On Keystroke Pressed ⌃⌥H → Flip Flop → Switch Camera `preview_main` to `camera_close` (A), then `camera_wide` (B) |
    | `counter.json` | Variables, Add To Number Variable, Switch On Number → Switch Camera |
    | `renamed-ids.json` | Like `nudge.json`, with old IDs and the smoke names, so each reference changes by name |
    | `missing-ref.json` | A reference to an entity name that is not in the smoke scene |
    | `ambiguous-ref.json` | A reference with old IDs and the name `camera_wide`. The unit and MCP tests use a smoke scene in which `camera_close` is renamed `camera_wide`. The smoke scene has unique names, so the end-to-end run does not use this file |
    | `future-version.json` | `formatVersion` 2 |
    | `unknown-node.json` | One node type that is not in the catalog |
    | `warudo-shaped.json` | A small hand-made file in the Warudo shape. It contains no Warudo content |

    Each valid fixture is the output of `exportBlueprint` and `serializeBlueprintFile`, so an export test can compare bytes.
R13. Tests:
    - Unit: export then import gives back the graph with a new ID; each R3 rejection; each R5 case; R6. Rust unit tests: the file name rule and the size limits in R9.
    - Integration, session: each valid fixture is imported into a real `createSession` with the smoke scene, and the clock advances. `nudge` sets the position after `runBlueprint` and commits 250 ms later. `drift` moves `reference` by speed × time and commits 250 ms after the graph is disabled. `wasd` moves `performer` while `held` has W. `camera-flip` switches the camera on each keystroke event. `counter` counts. This is an integration test because it crosses the file, the contracts, the compiler, the runtime, and the override layer.
    - Integration, MCP: the real MCP CLI process runs against a fixture API backed by a real session. `blueprint_import` then `blueprint_export` gives back the fixture except the graph ID. The missing, rejected, and graph-limit cases give the R3 and R7 results. This is an integration test because it crosses the stdio protocol boundary.
R14. End-to-end: `pnpm evaluate:blueprints` connects to the running app with the operator connection file, as `evaluate:smoke` does.
    - It requires the scene ID `scene_smoke` and no Blueprints, and stops with an error otherwise. It never calls `sceneReplace`. It adds the smoke entities it needs that are missing (`reference` as a box mesh, `performer` as an avatar with no model, `camera_wide`, `camera_close`) and removes them at the end.
    - It imports each fixture through the app commands and checks: the invalid files give the R3 codes; `renamed-ids` changes each reference; `missing-ref` is imported disabled; `nudge` sets the position after a run; `drift` moves `reference` while enabled and commits after it is disabled; `camera-flip` and `wasd` register their keystrokes and `heldKeys`; export gives back each import.
    - At the end it removes the graphs it added and restores the transforms it changed and removes the entities it added.
    - It writes a JSON report to `artifacts/evaluation/blueprint-files/<timestamp>.json` with the app commit, the session ID, and the result of each check.
R15. A live macOS check covers what the runner cannot: the dialogs, the Import and Export controls, the `Missing` display, physical WASD after an import, and the `drift` motion in the OBS output when OBS runs.

## E — Entities

- `BlueprintFile`: `{ format: 'opensekai.blueprint'; formatVersion: 1; graph: BlueprintGraph; references: BlueprintReference[] }`.
- `BlueprintReference`: `{ id: Id; kind: 'avatar' | 'mesh' | 'camera' | 'output' | 'unknown'; name: string }`.
- `BlueprintImportReport`: `{ graphId; enabled; remapped: { name; kind; from; to }[]; missing: { name; kind; id; nodeIds }[] }`.
- Functions: `exportBlueprint`, `serializeBlueprintFile`, `importBlueprint`. Host: `blueprint_file_name`, `read_blueprint_file`, `write_blueprint_file`.
- MCP tools `blueprint_export`, `blueprint_import`. Tauri commands `import_blueprint_file`, `export_blueprint_file`.

## A — Approach

Write the contract functions first, as pure functions with unit tests. Generate the valid fixtures from them. Then add the session integration test, the MCP tools and their integration test, the host dialogs, and the editor controls. Last, add the evaluation runner, run it against the app, and do the live check. Find reference fields through the catalog field kinds, so new nodes need no change here.

## S — Structure

- `packages/contracts/src/blueprint-file.ts` (new), `index.ts`.
- `fixtures/blueprints/*.json` (new).
- `packages/session/test/blueprint-files.integration.test.ts` (new).
- `apps/mcp/src/tools.ts`, `server.ts`; `apps/mcp/test/` (a session-backed fixture API and the integration test).
- `apps/desktop/src-tauri/src/lib.rs`, `capabilities/editor.json`, the generated permission files.
- `apps/desktop/src/components/BlueprintList.svelte`, `BlueprintPanel.svelte`, `BlueprintNodeFields.svelte`.
- `tools/evaluation/src/run-blueprints.ts` (new), root `package.json` script.
- `docs/warudo-parity.md` (BP-04) and `docs/evaluation/blueprint-files.md`.

## O — Operations

1. Contracts: the file schema, export, serialization, import with reference resolution, and the file name rule. Add unit tests.
2. Fixtures: make the valid files with the export function and write the invalid ones by hand. Add a test that each valid fixture is byte-equal to its export.
3. Session integration test (R13).
4. MCP: the two tools, the session-backed fixture API, and the integration test.
5. Host: the two Tauri commands and the capability entries.
6. Editor: the Import and Export controls, the missing list, and the **Missing** option. Check the flow in the running app.
7. Evaluation runner (R14). Run it against the app on the smoke scene.
8. Live macOS check (R15). Record evidence and parity.

## N — Norms

Use `@oshi-connect/ui` controls and lucide icons. Keep UI copy to the strings in R3, R9, and R10. Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript and plain data.

## S — Safeguards

- Do not add a graph from a file that fails any check.
- Do not choose a target when two entities match a name.
- Do not enable an imported graph that has a missing reference.
- Do not read a file above 1 MiB into memory.
- Do not add a host method for import or export. Use `blueprintEdit` and `blueprintInspect`.
- The evaluation runner must not replace the scene, must not run on a scene other than `scene_smoke` or on a scene with Blueprints, and must remove what it added.
- Do not commit Warudo content to the repository.
