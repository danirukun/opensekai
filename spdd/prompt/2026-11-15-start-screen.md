# REASONS: Start screen slice

Date: 2026-11-15. Scope: SCN-05 partial (recent shows and show templates), editor start screen. Analysis: [start screen](../analysis/2026-11-15-start-screen.md). Depends on: [show management](2026-10-07-scene-show-management.md).

The owner approved the design and the implementation plan on 2026-11-15.

## R — Requirements

R1. **Visibility.** The start screen shows in the Assets tab when all of these are true:
- the app started normally, not in fixture mode;
- the editor has polled the first show mark;
- no Open, Save, Save As, template load, recent open, or dismiss happened in this session;
- the show mark (show name, scene revision, Blueprint revision) equals the mark at editor start.

After it ends, it does not show again in the session, also when the mark returns to the start value.

R2. **Layout and copy.** The screen shows these items, from top to bottom:
- the full-colour OpenSekai logo in the centre;
- a primary `Add character` action;
- `Open show…`;
- a `Templates` heading with one row for each template;
- a `Recent` heading with one row for each recent show, only when the list is not empty;
- a close control with the title `Close`.

There are no helper sentences, no card grid, no gradients, and no badges. Focus goes to the primary action. Escape dismisses the screen.

R3. **Add character.** It adds a character entity through the scene tree add path, selects it, and opens the VRM chooser through the Inspector model path. A canceled chooser keeps the character without a model.

R4. **Open show.** It runs the existing Open Show action.

R5. **Templates.** A template is a version-1 show without asset references, bundled in the app resource directory under `templates/`. The window asks for it by ID. The host reads it with the show file checks. A load replaces the scene through the Open Show path, takes the template name, clears the host's current show path, and leaves no unsaved changes. The first template is `stage-lights` ("Stage Lights").

R6. **Recent list.** The host keeps at most 5 show paths, newest first, without duplicates, in `<app local data>/settings/recent-shows.json`. A successful Open, Save, Save As, or recent open moves its path to the top. A template load does not change the list. A corrupt file gives an empty list and is not overwritten until the next change.

R7. **Recent open.** The window gets each entry as a file name and a folder name, and opens an entry by its index. A successful open sets the current show path. When the file is missing or not a valid show, the open fails, the host removes the entry, and the current scene stays unchanged.

R8. **Trust checks.** The four new commands accept calls only from the `main` window. The template command accepts only a known template ID. The recent command accepts only an index in the current list. The window never sends a path.

R9. **Continuity.** The screen is a layer over the Scene pane viewport. It never unmounts, hides, or pauses the canvas, the preview, or the OBS output.

## E — Entities

`RecentShow` is `{ name, folder }`: the file stem and the name of the folder that holds the file. `ShowTemplate` is `{ id, name }`. The recent file is `{ "shows": [absolute path, …] }`. `ShowMark` is unchanged.

## A — Approach

Keep the recent list and the template table in the host, next to `ShowFile`. Read every file with `show::read_show`. Decide visibility in a pure TypeScript function over `ShowMark`. Render the screen as a snippet layer of `ScenePane`. Load templates and recent shows through one `openShowFrom` function that the Open Show action also uses.

## S — Structure

- Host: `apps/desktop/src-tauri/src/recent_shows.rs` and `templates.rs`; `ShowFile::clear_path` in `show.rs`; commands in `lib.rs`; permissions in `build.rs` and `capabilities/main.json`; the template file `resources/templates/stage-lights.osekai`.
- Editor: `apps/desktop/src/editor/start-screen.ts`, `components/StartScreen.svelte`, and wiring in `EditorApp.svelte`, `ScenePane.svelte`, and `bootstrap.ts`.

## O — Operations

1. Recent list module and commands, with tests at the file boundary.
2. Template table, resource file, `clear_path`, and commands, with tests.
3. Visibility rule and reply schemas, with unit tests.
4. Start screen component and editor wiring. Check the flow in the running macOS app and the OBS output.
5. Update ARCHITECTURE.md, the parity checklist, and the evidence.

## N — Norms

Use Svelte 5, `@oshi-connect/ui`, `@lucide/svelte`, and Tauri v2. Keep platform file operations in host commands. UI copy is labels only.

## S — Safeguards

- A missing or invalid recent file removes its entry and leaves the scene unchanged.
- A corrupt list file starts as an empty list and is not overwritten until the next change.
- The same path appears only once.
- After a template load, Save asks for a file.
- An edit from MCP or the Blueprint editor ends the screen.
- A template ID is looked up in the fixed table. It is never joined to a path.
- An index outside the list is rejected.

## Status

Implemented on branch `start-screen` (commits `67c2a9a`..`3670acf`). The live macOS check of R1–R9 passed; see [the start screen check](../../docs/evaluation/start-screen.md). Not verified: a release build, Windows, and keyboard-only navigation.
