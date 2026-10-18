# REASONS: Blueprint editor authoring (slice G)

Date: 2026-10-18. Batch: B13 Blueprint depth. Scope: BP-02, BP-03, BP-14, BP-15, and BP-17 partial. Analysis: [Blueprint editor authoring analysis](../analysis/2026-10-18-blueprint-g-editor-authoring.md). Plan: [Blueprint depth](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md).

## R — Requirements

R1. The node palette has one section for each category in `NODE_CATEGORIES`, in catalog order, and only for categories with an available node. A header shows the category name and its node count, `Name (n)`. A category that a later slice adds appears with no editor change.
R2. A click on a section header, or Left and Right arrow on a focused header, collapses and expands that section. Arrow Up, Arrow Down, and Enter move through and pick the visible rows only. The Nodes drawer has a palette menu with **Expand all** and **Collapse all**.
R3. A search matches node types in all sections, also collapsed ones. During a search, each section with a match is open, and its header shows `matches/total`. When the query is empty, the saved collapse state applies again. A wire-release search shows only compatible types, and the header count is of those types.
R4. Each node row has a star button (`Add to favorites` / `Remove from favorites`). A **Favorites** section is first, in star order, and is hidden when it is empty or has no match. A starred type also stays in its category. In a category, a favorite comes before a non-favorite with the same match rank.
R5. Favorites and collapsed sections are per user. They persist in `localStorage` key `opensekai.blueprint.palette` as `{ favorites: string[], collapsed: string[] }`. At most 64 favorites and 64 collapsed keys are kept. A favorite that is not a registered node type is kept and not shown. Missing or bad storage gives the empty state and no error. A show change does not change them.
R6. `formatLayout(nodes, connections, sizes?)` is pure. It returns a position for each given node. Flow wires set layers by longest path; a back edge in a flow cycle is ignored. A node without a flow wire in the set is one layer left of its nearest data consumer, else in layer 0. Each weakly connected group is laid out on its own, and the groups stack from top to bottom in their current vertical order. In a layer, the start order is the current `y`, and each node moves without overlap toward its placed neighbors: the mean top of its flow neighbors (flow ports are in the title row), else the mean center of its data neighbors. A node with no wire to its left then follows its neighbors to the right. Horizontal gap 80, vertical gap 40, group gap 80; the default node size is 180 × 100. The top-left corner of the set stays.
R7. **Format** in the canvas menu formats the selected nodes, or the whole graph when fewer than two nodes are selected. The node menu has **Format** when more than one node is selected. Format sends one `moveNode` for each node that moves, as one undo step.
R8. A Shift and primary-button drag that starts on empty canvas draws a selection rectangle and does not pan. On release, the nodes whose box intersects the rectangle and the comments fully inside it are the selection. With ⌘ (Control on Windows) also held, they are added to the selection. A plain primary drag still pans. Delete, Copy, Duplicate, Format, and undo act on the box selection like on any other selection.
R9. `BlueprintCommentSchema` is `{ id, text, position: { x, y }, size: { width, height } }`. `text` has 0 to 512 code units. `width` and `height` are finite and from 64 to 8192. A graph has an optional `comments` array, at most 32, with unique IDs. A graph without `comments` validates and is not changed.
R10. New operations, appended to `BlueprintOpSchema`: `addComment { graphId, comment }`, `updateComment { graphId, commentId, text?, position?, size? }`, `removeComment { graphId, commentId }`, and `duplicateGraph { graphId, newGraphId, name? }`. A missing graph or comment is `NOT_FOUND`. A duplicate comment ID or graph ID is `INVALID_INPUT`.
R11. `duplicateGraph` copies nodes, wires, variables, and comments. Each node, wire, and comment ID in the copy is `derivedId(newGraphId, oldId)`, a deterministic 32-hex-digit ID. Wires use the new node IDs. Variable IDs stay, because they are local to the graph and node settings refer to them. The name is `name` when given, else the first free of `<name> copy`, `<name> copy 2`, `<name> copy 3`, and so on, cut to 128 code units. The copy is disabled. The copy is added after the source graph. The limit of 8 graphs applies.
R12. The canvas draws each comment behind wires and nodes, at its position and size. A header drag moves the comment and each node fully inside it at drag start, and sends one batch: `updateComment` with the position and one `moveNode` for each node. A drag of the bottom-right handle sends one `updateComment` with the size. A click on the header selects the comment. Comment drags do not send intermediate operations.
R13. **Add comment** in the canvas menu wraps the selected nodes (padding 32, header 28), or adds a 320 × 200 comment at the pointer when no node is selected. The node menu has **Add comment** for its nodes. The inspector shows the text of a selected comment in a kit `Textarea` and a Delete button. Delete and Backspace remove the selected comments and nodes together.
R14. Copy, Duplicate, and Paste include the selected comments. Paste gives new IDs and keeps the relative layout of nodes and comments.
R15. Undo and redo include comment changes. A comment change is one step; a comment drag with its nodes is one step.
R16. `exportBlueprint` and `importBlueprint` keep comments. A file without comments imports as before.
R17. The graph list has a **Duplicate blueprint** button on each row, disabled at 8 graphs. The new graph is selected after a duplicate.
R18. The Rust host accepts the `comments` key with the R9 structure and the four new operation kinds with their structure. It does not compute IDs.
R19. MCP `blueprint_edit` accepts the new operations. Its description names `duplicateGraph` and the comment operations.

## E — Entities

- `BlueprintComment` (contracts, new file `blueprint-comments.ts`): `{ id, text, position, size }`; `BlueprintCommentsSchema` (array, max 32, unique IDs); `MAX_BLUEPRINT_COMMENTS = 32`; `MAX_COMMENT_TEXT = 512`.
- `BlueprintGraph`: adds `comments?: BlueprintComment[]`.
- `BlueprintOp`: adds `addComment`, `updateComment`, `removeComment`, and `duplicateGraph`.
- `derivedId(seed, id)` and `duplicateGraph(graphs, source, newGraphId, name?)` (contracts, new file `blueprint-duplicate.ts`).
- `PalettePrefs` (editor): `{ favorites(), collapsed(), toggleFavorite(type), setCollapsed(keys), subscribe(fn) }` over an injected storage.
- `PaletteSection` (editor): `{ key, label, entries, count, total, open }`.
- `BlueprintClipboard` (editor): adds `comments: BlueprintComment[]`.
- `LayoutSize` (editor): `{ width, height }` by node ID.

## A — Approach

Add the comment schema and the four operations in contracts first, with unit tests, and add the structure checks to the Rust host with a test file of its own. Then add the pure editor functions with unit tests: palette sections, preferences, layout, box hit test, comment containment, clipboard with comments, and undo diff with comments. Then wire the canvas: box select and the comment layer in the Rete adapter, in functions apart from socket and inline-input rendering. Then the Svelte palette, the menus, the comment inspector, and the duplicate button. Keep every edit on the validated `blueprintEdit` path.

## S — Structure

- `packages/contracts/src/blueprint-comments.ts` (new), `blueprint-duplicate.ts` (new), `blueprint.ts` (one optional field), `blueprint-ops.ts` (appended operations and cases), `index.ts` (exports).
- `crates/contracts/src/lib.rs` (comment check and four operation arms), `crates/contracts/tests/blueprint_authoring.rs` (new).
- `apps/desktop/src/blueprints/`: `node-search.ts` (sections), `palette-prefs.ts` (new), `layout.ts` (new), `box-select.ts` (new), `comments.ts` (new), `clipboard.ts`, `undo.ts`, `selection-ops.ts`, `editor-memory.ts`, `keys.ts` unchanged, `rete-editor.ts` (box select and comment layer functions).
- `apps/desktop/src/components/`: `NodeSearch.svelte`, `BlueprintPanel.svelte`, `BlueprintList.svelte`, `BlueprintCommentFields.svelte` (new); `app.css`.
- `apps/mcp/src/server.ts` (description).
- `docs/evaluation/blueprint-g-editor-authoring.md` (new).

## O — Operations

1. Contracts: comment schema, optional `comments` field, four operations, `duplicateGraph`, file round trip. Unit tests.
2. Rust host: structure checks and tests.
3. Editor logic: palette sections and preferences, layout, box hit test, comment containment, clipboard, undo diff. Unit tests.
4. Canvas: Shift-drag box select; comment layer with header drag, resize, select, and order behind wires.
5. UI: palette sections, stars, palette menu; Format and Add comment menu items; comment inspector; Duplicate blueprint.
6. MCP description; session integration test for `duplicateGraph` and comments through `blueprintEdit`.
7. Evaluation document with the macOS steps for the integrated QA run.

## N — Norms

Use `@oshi-connect/ui` controls (`Input`, `Textarea`, `Dropdown`, `Button`). UI copy is limited to: **Favorites**, **Expand all**, **Collapse all**, **Format**, **Add comment**, **Delete comment**, **Duplicate blueprint**, and the star labels. No badges or pills; the count is plain header text. Write prose in ASD-STE100. Use pnpm and add no dependency. Keep functional TypeScript. Unit tests for pure logic; session integration test at the `blueprintEdit` boundary.

## S — Safeguards

- Do not reorder existing operations or change an existing operation shape.
- Do not edit node definitions, evaluators, `blueprint-nodes/define.ts`, or socket and inline-input rendering.
- Do not make `comments` required; old graphs must not change on load.
- Do not let a comment change reset graph state (`logicKey` excludes comments).
- Do not generate random IDs inside `applyBlueprintOps`; `duplicateGraph` must give the same result on each client and in the session.
- Do not use the system clipboard.
- Do not claim the macOS gestures as verified before the integrated QA run; record them as unit-only until then.
