# Start screen design

Date: 2026-11-15. Status: design, waiting for owner approval. A builder review on 2026-11-15 found three gaps. They are settled below and marked as builder's calls.

## Intent

A first-time user opens OpenSekai and sees an editor with a Directional Light, a Camera, and an empty viewport. Nothing tells them where to start. The start screen gives them that first step. It shows the OpenSekai logo in the centre of the Scene pane and a short list of start actions, like the welcome page in Cursor.

The audience is a first-time user. A returning user gets a fast path back to recent shows, but that is not the main goal.

## Goals

- When the editor starts with an untouched scene, the Scene pane shows the logo and these actions:
  - **Add character**: the primary action. It adds a character and opens the VRM chooser.
  - **Open show…**: the existing Open Show action.
  - **Start from a template**: one entry for each bundled template. The first template is Stage Lights.
  - **Recent shows**: the shows that the user opened or saved last, newest first.
- Every action uses the same command path as the editor controls and the File menu.
- The rail, the scene tree, and the Inspector stay visible and usable while the start screen shows.

## Non-goals

- No first-run tutorial, tour, or coach marks.
- No File › Open Recent menu in this slice. The recent list must not prevent one later.
- No templates that bring assets (characters, environment models, textures). The owner chose stages without assets.
- No MCP command for the start screen. It is editor UI. Open Show and scene edits already have their API paths.
- No new window, and no change to the Scene or Output windows.

## Anti-goals

The design fails, even when it works, if:

- the renderer, the preview, or the OBS output stops, restarts, or reloads because of the start screen;
- the start screen comes back after the user has started work in that session;
- the window can make the host read a file path that the user did not choose;
- the screen adds helper text that only repeats the action labels (constitution principle 1), or uses a card grid, decorative gradients, or badges (principle 2).

## Constraints

- Constitution and project rules: Svelte 5 with `@oshi-connect/ui` controls, functional TypeScript, pnpm, Tauri v2.
- The Scene pane stays mounted on every tab, so the renderer and its loaded assets stay (`EditorApp.svelte`, R5 of the existing editor layout). The start screen is a layer in the Scene pane. It does not unmount or hide the canvas element.
- Show files follow the show management contract (`spdd/prompt/2026-10-07-scene-show-management.md`). The editor never sends a file path to the host. The host keeps the current show path.
- Show files are at most 256 KiB and are validated in Rust and TypeScript.
- macOS first. Paths and storage must also work on Windows.

## Approaches

Three placements were considered:

1. **In the Scene pane (chosen).** The start screen covers the viewport area while the scene is untouched. The rest of the editor stays visible, so a first-time user sees where everything is. No new window, and no new trust boundary apart from the recent list.
2. **A full-window sheet at launch.** This hides the editor that the user is about to learn, and it needs its own focus and dismiss handling.
3. **A separate welcome window before the editor** (like Xcode). This needs a new native window, capability and label checks, and a handoff to the main window. That is too much new boundary for a menu.

The owner chose approach 1.

For templates, three options were considered: stages without assets (chosen), templates that bring assets from the app bundle or the asset CDN, and no templates yet. The owner chose stages without assets: they always open correctly, need no download or licence work, and lead the user to add their own character.

## Decided design

### When it shows

- It shows in the Assets tab while the show is untouched. Untouched means all of these are true (builder's call, settled in review):
  - the app started normally, not in fixture mode, so the scene is the default empty scene;
  - no show was opened, saved, or loaded from a template in this session;
  - the full unsaved-changes mark (`showDirty`: scene revision, Blueprint revision, and show name) still equals the mark at editor start.
- It hides for the rest of the session after the first change to that mark (a scene edit from the editor or from MCP, a Blueprint edit, or a rename), an Open, a Save or Save As, a template load, or a dismiss. It does not come back when the user undoes to the start state.
- Because any Blueprint edit hides the screen, a template load can never replace a graph that the user made in this session.
- Fixture mode is excluded so that the concert benchmark, preview screenshots, and MCP-driven QA keep a clear viewport.
- The user can dismiss it with Escape or a close control. After a dismiss, the empty viewport shows as it does today.

### Layout

```
┌──────────────────────────────┐
│            [logo]            │
│ Create your dream VTuber world │
│                              │
│   Add character              │  ← primary
│   Open show…            ⌘O   │
│                              │
│   Templates                  │
│   Stage Lights               │
│                              │
│   Recent                     │
│   Friday stream   ~/Shows    │
└──────────────────────────────┘
```

- The logo is the existing OpenSekai mark (`apps/desktop/src/assets/opensekai-logo.svg`), centred.
- One clear primary action: Add character. The other actions are quieter rows.
- The Recent section shows only when the list has entries. A first-time user does not see an empty Recent section.
- No helper sentences. Labels only. The one exception is the subtitle `Create your dream VTuber world` under the logo, which the owner asked for on 2026-11-15.

### Add character

It creates a character entity through the same path as the scene tree add menu, selects it, and opens the VRM chooser through the same path as the Inspector model field (`import_avatar`). If the user cancels the chooser, the character stays in the scene without a model, as it does after the add menu.

### Open show

It runs the existing `openShow` action. No change to the host command.

### Templates

- A template is a version-1 show document without asset references. The first template is the Stage Lights show (`fixtures/shows/stage-lights.osekai`), copied into app resources.
- The app bundles the templates as resources. The host reads them from the resource directory and validates them like any show file.
- The window asks for a template by its ID. It does not send a path.
- A template loads through the same scene replacement path as Open Show (`openShowDocument`). The show takes the template name.
- A template load clears the host's current show path (a new `ShowFile` operation). The first Save after a template asks for a file, like Save As, and can never overwrite an earlier file. (Builder's call, settled in review. Save also ends the start screen, so this is a second guard.)
- After a template loads, the show has no unsaved changes, as at editor start.

### Recent shows

- The host keeps a recent list of at most 5 shows in the app config directory, as a small JSON file. Each entry has the path and the time it was last opened or saved.
- A successful Open, Save, or Save As moves that path to the top of the list.
- The window gets the list as display entries: the show file name and a short folder label, plus the index or an opaque ID. The window opens a recent show by index or ID. It never sends a path.
- When a recent file is missing or is not a valid show, the open fails with an error toast. The host removes that entry from the list. The current scene stays unchanged.
- A recent open sets the current show path, as Open Show does.

### Trust checks

- New host commands accept calls only from the `main` window, like the existing show commands.
- The template command accepts only a known template ID.
- The recent command accepts only an index or ID that is in the current list.
- Template and recent files go through the same size and schema validation as Open Show.

## Left to the builder

- The exact command names, the recent file name, and its JSON shape.
- Index or opaque ID for recent entries.
- How the editor knows the start revision (for example, from the first poll that sets `savedMark` today).
- The close control and the focus order. Escape must dismiss. Keyboard focus must go to the primary action when the screen shows.
- Visual details within the constitution: type, spacing, and motion that respects reduced motion.
- Whether the start screen is a new component that the Scene pane renders or a layer in `EditorApp.svelte`.
- The REASONS slice contract in `spdd/`, the parity checklist entry, the ARCHITECTURE.md update for the new host state file and resource directory, and the tests (unit tests for the recent list logic and the start-screen visibility rule; an integration test at the file boundary for the recent and template commands; a check of the running flow in the app).
