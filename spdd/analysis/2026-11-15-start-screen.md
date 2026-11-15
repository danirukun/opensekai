# Start screen analysis

Date: 2026-11-15. Scope: a start screen in the Scene pane for a first-time user, with recent shows and show templates (SCN-05 subset). Contract: [start screen](../prompt/2026-11-15-start-screen.md). Design: [start screen design](../../docs/superpowers/specs/2026-11-15-start-screen-design.md).

## Sources

- Owner request, 2026-11-15: when the editor starts with an empty scene, show a short start menu like the one in Cursor, with the logo in the centre and quick actions: open a scene, open recent scenes, add an asset, and open a template.
- Owner decisions, 2026-11-15:
  - The main purpose: a first-time user knows where to start.
  - Templates are stages without assets. The first template is Stage Lights.
  - The start screen is in the Scene pane. It is not a full-window sheet or a separate window.
  - The owner approved the design document.
- [Show management](../prompt/2026-10-07-scene-show-management.md): the editor never sends a path; the host keeps the current show path; show files are at most 256 KiB and are validated in Rust and TypeScript.

## Current state

- Each launch starts "Untitled Show" with a Directional Light and a Camera. Fixture mode starts the smoke scene.
- Open Show uses a native chooser. The host keeps only the current path, and only until quit. There is no recent list.
- `fixtures/shows/stage-lights.osekai` has no asset references. `fixtures/shows/test-stage.osekai` refers to private fixture assets, so it cannot be a user template.
- The full-colour logo `apps/desktop/src/assets/opensekai-logo.svg` exists and is not used.

## Decisions

1. **Untouched means the full show mark.** The scene revision, the Blueprint revision, and the show name must all equal their values at editor start. A Blueprint edit or a rename ends the screen. Then a template load cannot replace a graph that the user made. (Builder review, 2026-11-15.)
2. **Fixture mode does not show the screen.** The benchmark, preview screenshots, and MCP-driven QA keep a clear viewport. (Builder review.)
3. **A template load clears the current show path.** The next Save asks for a file and cannot overwrite an earlier file. Save also ends the screen. (Builder review.)
4. **The recent list is host state.** It is in `<app local data>/settings/recent-shows.json`, next to `integrations.json`. The window gets file names and folder names only, and opens an entry by index.
5. **Templates are app resources.** They are in the resource directory under `templates/`, and the window asks for one by ID.
