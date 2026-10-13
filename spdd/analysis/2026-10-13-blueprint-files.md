# Blueprint files analysis

Date: 2026-10-13. Scope: export one Blueprint to a JSON file and import it into a show, in the editor and through MCP. Parity item: BP-04.

## Problem

A Blueprint lives only inside its show. An operator cannot share a graph with another show or with another person, and cannot keep a library of graphs such as a WASD template. Copy and paste works only between graphs in the same running editor.

Warudo exports a Blueprint as a JSON file and imports such a file into the open scene. A Warudo file has the graph, node positions, typed input values, variables, and the view state. Each asset reference has the asset ID and the asset name (`{"id": "…", "name": "Character"}`). Warudo uses the name when the ID is not in the scene.

## Decisions

- **OpenSekai format only.** The file has the same structure as a Warudo file: one graph and its asset references. OpenSekai does not read Warudo files. The Warudo node catalog (bone rotations, animation pipeline, comments) has almost no match in OpenSekai, and a mapping table would need maintenance for no current use. A Warudo file is rejected with a clear message.
- **The graph stays as it is.** The file holds a `BlueprintGraph` without change, so the existing schema validates it. A separate `references` table gives the name and kind of each referenced entity or output, and does the job of the Warudo `{id, name}` pairs.
- **Match references by ID, then by name.** On import, a reference keeps its ID when the ID exists in the scene with the same kind. If not, it changes to the one entity with the same name and kind. If there is no match, or more than one, the reference is missing. A graph with a missing reference is imported disabled, so it does not run into "Entity not found" errors.
- **No new host command.** The conversion is a pair of pure functions in `@opensekai/contracts`. The editor and MCP send the result through the existing `blueprintEdit` command (`createGraph`). The host adds only two file dialog commands.
- **Editor and MCP.** The editor has Import and Export actions with native file dialogs. MCP has `blueprint_import` and `blueprint_export` tools that use the same functions.

## Rejected approaches

- Import of Warudo files: a large node mapping table, and most Warudo nodes have no OpenSekai match.
- Warudo-compatible output: needs Warudo type IDs and asset types.
- A new session command for import and export: a second schema in TypeScript and Rust for the same graph validation that `createGraph` already does.
- Export as a show file with no scene: brings scene data that sharing a graph does not need.
- A remap dialog on import: more UI for a case that name matching and a later field edit solve.
- Keep IDs only: works only in the same show.

## Effects

- An operator exports a graph to `<graph name>.json` and imports it into another show. References to entities with the same names connect again.
- The same file can be imported two times. Each import makes a new graph.
- A file from a newer OpenSekai, with unknown node types, or from Warudo, is rejected. No part-graph is added.
- After an import with missing references, the panel lists the missing names, and each affected field shows **Missing** until the operator chooses a new target.

## Out of scope

Reading or writing Warudo files, comment nodes (BP-02), view pan and zoom, several graphs in one file, graph groups (BP-03), assets inside the file, a template gallery, and export of an unsaved editor draft.
