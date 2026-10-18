# Blueprint editor authoring analysis (slice G)

Date: 2026-10-18. Batch: B13 Blueprint depth ([plan](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md)). Scope: BP-02, BP-03, BP-14, BP-15, and BP-17 partial. Issues: [#198](https://github.com/danirukun/opensekai/issues/198), [#177](https://github.com/danirukun/opensekai/issues/177), [#176](https://github.com/danirukun/opensekai/issues/176), [#82](https://github.com/danirukun/opensekai/issues/82), [#83](https://github.com/danirukun/opensekai/issues/83).

## Problem

The batch adds many node types. The palette shows one flat list per category, with no counts, no collapse, and no favorites. The Warudo 0.15.1 palette has 33 categories and 519 nodes, a star on each node type, and a count on each group, for example `YouTube (8)`.

A graph has no auto layout, no box select, and no comments. The operator cannot copy a whole graph to start a variant of it. Warudo has each of these.

## Decisions

1. **Palette sections.** Each category in `NODE_CATEGORIES` is one section, in catalog order. A new category in the catalog appears with no editor change. The header shows a chevron, the name, and the count: `Math (12)`. During a search, the header shows `matches/total`, for example `Math (2/12)`, and each section with a match is open. When the query is empty, the saved collapse state applies again. A click on the header, or Left and Right arrow on a focused header, collapses and expands it. The Nodes drawer has **Expand all** and **Collapse all** in a small palette menu. The canvas menu and the wire-release search use the same sections.
2. **Favorites.** Each node row has a star button. A **Favorites** section is first, in the order the user starred the types, and is hidden when empty. A starred type also stays in its own category. Inside a category, a favorite comes first among results with the same match rank.
3. **Per-user storage.** Favorites and collapsed sections are per user, not per show. They live in the Editor window `localStorage` key `opensekai.blueprint.palette`, as the drawer choice does today. The editor memory loads them once and shares them with each palette. A favorite ID that is not a registered node type is kept but not shown. Storage that is not available gives an empty state and no error. At most 64 favorites are kept.
4. **Format.** A pure function places nodes in layers from left to right. Flow wires give the layers (longest path, back edges ignored). A node with no flow wire in the set goes one layer to the left of the first data consumer. Each connected group is placed below the previous one. The order in a layer starts from the current vertical order and follows the wired neighbors. The layout keeps the top-left corner of the formatted nodes. **Format** is in the canvas menu (selection when one or more nodes are selected, else the whole graph) and in the node menu for a selection. It is one undo step.
5. **Box select.** Shift and a primary-button drag that starts on empty canvas draws a rectangle. A node that intersects the rectangle and a comment that is fully inside it are selected. ⌘ (Control on Windows) together with Shift adds to the selection. A plain drag still pans the canvas. This is a candidate gesture: Rete has no built-in box select, and the gesture on the live Warudo app is not recorded.
6. **Comments.** A graph has `comments` (at most 32): `{ id, text, position, size }`. Text has at most 512 UTF-16 code units and can be empty. Width and height are 64 to 8192. The canvas draws each comment behind wires and nodes. A drag on the comment header moves the comment and each node that is fully inside it when the drag starts. A handle at the bottom-right corner resizes it. A click on the header selects it; the inspector then shows its text and a Delete button. **Add comment** in the canvas and node menus wraps the selected nodes, or adds a 320 × 200 comment at the pointer. Operations: `addComment`, `updateComment`, and `removeComment`. A comment is part of undo, copy and paste, and the Blueprint file. A graph without the key loads as before; the key is optional, so W0's graph literals do not change.
7. **Duplicate graph.** The operation `duplicateGraph { graphId, newGraphId, name? }` copies a graph with new node, wire, and comment IDs. Variable IDs stay, because they are local to the graph and node settings refer to them. The IDs come from a hash of the new graph ID and the old ID, so each client and the session get the same result. The default name is `<name> copy`, then `<name> copy 2` and up when that name is in use. The copy starts disabled, so a hotkey does not fire twice. The limit of 8 graphs applies. MCP gets the operation through `blueprint_edit`.
8. **Rust host.** The host checks only structure. It accepts the `comments` key and the four new operation kinds.

## Effects

- Old shows and files load without change. A show or file with comments does not open in an earlier build.
- A comment does not change logic, so an edit of a comment does not reset graph state.
- Favorites are per Editor window storage. MCP cannot read them in this slice.

## Out of scope

MCP palette favorite tools (`palette_favorites_get` and `palette_favorites_set` in #198) need a user settings store that MCP can reach. Drag to reorder favorites, a Recent section, groups of graphs, graph order, comment color, a comment re-fit after Format, and the live Warudo gesture comparison.
