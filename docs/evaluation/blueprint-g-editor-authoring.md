# Blueprint editor authoring check (slice G)

Contract: [REASONS](../../spdd/prompt/2026-10-18-blueprint-g-editor-authoring.md). Analysis: [analysis](../../spdd/analysis/2026-10-18-blueprint-g-editor-authoring.md). Batch: B13 Blueprint depth.

## Run

- Base: `opensekai/blueprint-depth` at `671e2f8`. Branch: `opensekai/bp-g-editor-authoring`.
- Platform: macOS (Darwin 27), Node and pnpm from the repository, Playwright Chromium (headless shell 1248).
- The desktop app and the Rust host did not run. The live macOS check is part of the integrated B13 QA run (see **macOS steps**).
- Renderer backend, quality profile, and OBS: not applicable and not measured. This slice does not change the output path.

## Automatic checks

| Command | Result |
| --- | --- |
| `pnpm check` | Pass. svelte-check: 0 errors, 0 warnings. |
| `pnpm test:unit` | 1041 passed (140 files). The base had 1017 (136 files). |
| `pnpm test:integration` | 40 passed, 2 skipped (17 files). New: `packages/session/test/blueprint-authoring.integration.test.ts` (2) and `apps/mcp/test/blueprint-authoring.integration.test.ts` (1). |
| `cargo test -p opensekai-contracts --no-fail-fast` | 65 passed, 0 failed. New: `crates/contracts/tests/blueprint_authoring.rs` (2). Only this crate was built, in a separate target directory. |
| `cargo clippy -p opensekai-contracts --all-targets` | Clean. |

`scripts/prepare-tracking.test.ts` fails in a new worktree because `artifacts/models/` is a local, ignored artifact. With the models copied from the main checkout, the test passes. This slice does not change it.

## Unit and integration coverage

| Requirement | Test |
| --- | --- |
| R1–R5 palette sections, counts, search across collapsed sections, favorites order, per-user storage | `apps/desktop/test/palette.test.ts` |
| R6–R7 layered layout, flow back edge, data layer, groups, sizes, stable second Format | `apps/desktop/test/layout.test.ts` |
| R8 box hit test | `apps/desktop/test/comments.test.ts` |
| R9–R11 comment schema bounds, optional field, comment operations, `duplicateGraph` IDs, name, limit | `packages/contracts/test/blueprint-authoring.test.ts` |
| R12–R15 comment containment, drag batch, wrap, copy and paste, delete, undo | `apps/desktop/test/comments.test.ts` |
| R16 file export and import with comments | `packages/contracts/test/blueprint-authoring.test.ts` |
| R18 Rust structure checks | `crates/contracts/tests/blueprint_authoring.rs` |
| A comment edit does not reset graph state; a duplicate compiles and runs when enabled | `packages/session/test/blueprint-authoring.integration.test.ts` |
| R19 MCP `blueprint_edit` with comments and `duplicateGraph`; export keeps the comment | `apps/mcp/test/blueprint-authoring.integration.test.ts` |

## Headless editor check

A temporary Vite page mounted the real `BlueprintPanel` on a real session with the `counter` fixture. Playwright drove real pointer and key events in headless Chromium. The page was not committed. Each item passed:

- Each palette section shows its count (`Events (4)`). A header click and Left and Right arrows collapse and expand it. A search for `random` opens the collapsed Math section with `(1/15)`. Clearing the search collapses it again.
- A star adds a **Favorites** section first. Favorites and collapsed sections stay after a page reload. **Expand all** opens each section. [Palette](blueprint-g-editor-authoring/palette-favorites.png).
- Shift-drag on empty canvas draws the rectangle, selects 4 of 7 nodes, and does not pan. Delete removes the 4 nodes and ⌘Z brings them back. [Box select](blueprint-g-editor-authoring/box-select.png).
- **Format** in the canvas menu moves the nodes; one ⌘Z restores each position. [Format](blueprint-g-editor-authoring/format.png).
- **Add comment** wraps the box selection. The inspector text is saved on blur. A header drag moves the comment and the 4 nodes inside by the same amount, and one ⌘Z puts all of them back. The corner handle resizes it. ⌘C and ⌘V paste a second comment. The comment menu **Delete** removes one. [Comment](blueprint-g-editor-authoring/comment.png).
- **Duplicate blueprint** adds `Counter copy`, disabled, with the comment, and selects it. [Duplicate](blueprint-g-editor-authoring/duplicate.png).
- No page errors.

A headless browser check does not prove the behavior in the Tauri WKWebView on macOS.

## macOS steps for the integrated QA run

Use the running app (`pnpm dev:desktop`), the Blueprint panel, and MCP.

1. **Palette.** Open the Nodes drawer. Each category shows `Name (n)`, including the categories that W0 and wave 2 add. Collapse two sections with a click and with Left Arrow. Search a node in a collapsed section; the section opens with `(m/n)`. Clear the search; the sections collapse again. Star two node types; **Favorites** shows them first, in star order. Right-click the canvas and release a wire on empty canvas; both searches show the same sections and stars. Quit and start the app again; the favorites and the collapsed sections stay. Open another show; they do not change.
2. **Box select.** Shift-drag on empty canvas over three nodes; the three are selected and the canvas does not pan. Shift-⌘-drag over one more node adds it. A plain drag still pans. With the box selection: ⌘C and ⌘V, ⌘D, Delete, ⌘Z, and ⇧⌘Z. Record that the gesture is the candidate in the contract (Rete has no built-in box select; the live Warudo gesture is not recorded).
3. **Format.** Make a messy graph of about 10 nodes with flow and data wires. Canvas menu → **Format**; the flow chain lines up from left to right and data nodes sit left of their consumers. ⌘Z restores the layout in one step. Select three nodes → node menu → **Format** moves only those three.
4. **Comments.** Select nodes → canvas menu → **Add comment**. Type text in the inspector. Drag the comment header; the nodes inside move with it; ⌘Z restores all in one step. Resize with the corner handle. Click the header and press Delete. Undo it. Copy a comment with ⌘C and paste it into another Blueprint.
5. **Persistence.** With comments in two Blueprints, **Save As** the show, start a new show, then **Open** the saved show. The comments and their text, position, and size come back. Edit a comment while a Counter-type graph runs; the variable does not reset.
6. **Files.** Export a Blueprint with comments, import the file into another show; the comments come back. Import an older file without comments; it works as before.
7. **Duplicate.** Click **Duplicate blueprint** on a row. `<name> copy` appears, disabled, selected, with the same nodes, wires, variables, and comments. Enable it; its hotkey runs it. With 8 Blueprints the button is disabled. Through MCP, send `blueprint_edit` with `{ kind: 'duplicateGraph', graphId, newGraphId }`; the editor shows the copy.
8. **Rust host.** The steps above go through the host, so they also check that the host accepts the `comments` key and the four new operations. Run `cargo test --workspace` once.
