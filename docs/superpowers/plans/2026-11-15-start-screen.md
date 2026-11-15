# Start Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a start screen with the OpenSekai logo and start actions (Add character, Open show, templates, recent shows) in the Scene pane while a normal launch is untouched.

**Architecture:** The host gets two small modules: a recent-show list stored in `<app local data>/settings/recent-shows.json`, and bundled show templates in the resource directory. The window asks for both by index or ID, never by path. The editor decides visibility with a pure function over the existing `ShowMark` and renders a `StartScreen` layer over the Scene pane viewport. All loads go through the existing `openShowDocument` path.

**Tech Stack:** Tauri v2 (Rust), Svelte 5, `@oshi-connect/ui`, `@lucide/svelte`, zod (`@opensekai/contracts`), vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-11-15-start-screen-design.md`

## Global Constraints

- Svelte UI uses `@oshi-connect/ui` controls. No second primitive kit. Functional TypeScript; comment only hard logic.
- UI copy is labels only: `Add character`, `Open show…`, `Templates`, `Recent`, close title `Close`. No helper sentences, no empty Recent section, no card grid, no gradients, no badges.
- The Scene pane and its canvas stay mounted. The start screen never hides, unmounts, or pauses the renderer, the preview, or the OBS output.
- The window never sends a file path to the host. New commands accept calls only from the `main` window (`require_window_label(window.label(), "main")`).
- Template and recent files go through `show::read_show` (256 KiB limit, full validation).
- Recent list: at most 5 entries, newest first, file `<app local data>/settings/recent-shows.json`.
- First template: ID `stage-lights`, name `Stage Lights`, content equal to `fixtures/shows/stage-lights.osekai`, no asset references.
- Not shown in fixture mode.
- Each cargo, pnpm, or Tauri command that compiles Rust runs as `direnv exec . <command>`.
- Long prose (spec, PR text) uses ASD-STE100 Simplified Technical English.
- No agent attribution in commits or PRs.

## Review Focus

1. A recent show file was moved or deleted since the last launch → error toast, the entry leaves the list, the scene stays unchanged. (Task 2 test `open_missing_entry_removes_it`.)
2. `recent-shows.json` is corrupt, too large, or from a newer shape → the list is empty, the app starts, and the file is not overwritten until the next Open or Save. (Task 2 test `corrupt_file_loads_empty`.)
3. The same show opened or saved again → one entry, moved to the top, not a duplicate. (Task 2 test `touch_moves_existing_to_top`.)
4. Save As, then a template load, then Save → Save asks for a file and does not overwrite the earlier file. (Task 3 test `clear_path_forgets_current_file`.)
5. An MCP client or a Blueprint edit changes the show while the start screen shows → the screen ends and does not come back. (Task 4 tests `ends_on_scene_revision_change` and `ends_on_blueprint_revision_change`.)

---

### Task 1: Slice contract

**Files:**
- Create: `spdd/analysis/2026-11-15-start-screen.md`
- Create: `spdd/prompt/2026-11-15-start-screen.md`

**Interfaces:**
- Produces: requirement IDs R1–R9 that later commits and the parity line cite.

- [ ] **Step 1: Write the analysis.** Follow the shape of `spdd/analysis/2026-10-18-test-stage.md`. Source: the design doc. State the first-time-user intent and the three settled review calls.
- [ ] **Step 2: Write the REASONS contract.** Follow `spdd/prompt/2026-10-07-scene-show-management.md`. Requirements:
  - R1 visibility rule (normal launch, untouched full `ShowMark`, sticky end);
  - R2 layout and copy (Global Constraints);
  - R3 Add character;
  - R4 Open show reuse;
  - R5 templates by ID, path cleared;
  - R6 recent list (5, newest first, dedupe, file location);
  - R7 recent open by index, missing-file removal;
  - R8 trust checks;
  - R9 renderer continuity.
  
  Safeguards repeat the Review Focus items.
- [ ] **Step 3: Commit.** `git add spdd/analysis/2026-11-15-start-screen.md spdd/prompt/2026-11-15-start-screen.md && git commit -m "Add the start screen slice contract."`

### Task 2: Host recent-show list

**Files:**
- Create: `apps/desktop/src-tauri/src/recent_shows.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (module, `.manage`, setup load, `open_show`/`save_show`/`save_show_as` touch, two commands, `generate_handler!`)
- Modify: `apps/desktop/src-tauri/build.rs` (command list), `apps/desktop/src-tauri/capabilities/main.json` (`allow-recent-show-list`, `allow-open-recent-show`)

**Interfaces:**
- Produces (Rust):
  - `pub struct RecentShows` (managed state) with:
    - `pub fn load(file: PathBuf) -> Self`
    - `pub fn touch(&self, path: PathBuf)`
    - `pub fn path_at(&self, index: usize) -> Option<PathBuf>`
    - `pub fn remove(&self, path: &Path)`
    - `pub fn entries(&self) -> Vec<RecentShow>`
  - `pub fn settings_path(app_local_data: &Path) -> PathBuf`
  - `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct RecentShow { name: String, folder: String }`
- Produces (commands):
  - `recent_show_list(window) -> Result<Vec<RecentShow>, AppError>`
  - `open_recent_show(window, index: usize) -> Result<serde_json::Value, AppError>`

- [ ] **Step 1: Write failing tests** in `recent_shows.rs` `mod tests` (tempfile, like `show.rs`):
  - `touch_keeps_newest_first_and_at_most_five`: touch `a`..`f` → entries names `f,e,d,c,b`.
  - `touch_moves_existing_to_top`: touch `a,b,a` → `a,b`, length 2.
  - `entries_show_file_stem_and_folder`: `/x/Shows/Friday stream.osekai` → `name == "Friday stream"`, `folder == "Shows"` (last folder name only).
  - `persists_and_reloads`: touch two paths, `RecentShows::load(same file)` → same entries.
  - `corrupt_file_loads_empty`: write `b"{"` to the file → `load` gives no entries, file bytes unchanged.
  - `remove_drops_entry_and_persists`.
- [ ] **Step 2: Run** `direnv exec . cargo test -p opensekai-desktop recent_shows` → FAIL (module missing).
- [ ] **Step 3: Implement `recent_shows.rs`.** `Mutex<Vec<PathBuf>>` plus the file path. Each change writes the whole list with `local_file::write_atomic`. Read with `local_file::read_bounded` (limit 64 KiB). JSON shape `{"shows":["/abs/path", …]}` with `deny_unknown_fields`. Load ignores entries that are not absolute paths. File location: `settings_path(data) = data.join("settings").join("recent-shows.json")`. Create the parent folder before the write.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Wire the host.**
  - In `setup`, after `data` is created: `app.manage(RecentShows::load(recent_shows::settings_path(&data)))`.
  - On success, `open_show`, `save_show`, and `save_show_as` call `touch(path)`.
  - `open_recent_show`: `require_window_label`; `path_at(index)` or `InvalidInput "Unknown recent show"`; `show::read_show(&path)` in `spawn_blocking`. On error: `remove(&path)` and return the error. On success: `ShowFile::set_path(path.clone())`, `touch(path)`, return the document.
  - Add both commands to `build.rs`, `main.json`, and `generate_handler!`.
- [ ] **Step 6: Add the missing-file test** `open_missing_entry_removes_it` at the module level. Touch a path that does not exist. `read_show` fails, `remove` runs, and `entries()` is empty. Test it through a free function `pub fn open_entry(list:&RecentShows, index:usize) -> Result<(PathBuf, Value), AppError>`, which the command then calls. Also add `open_unknown_index_is_invalid` (index 9 → `ErrorCode::InvalidInput`).
- [ ] **Step 7: Run** `direnv exec . cargo test -p opensekai-desktop recent_shows && direnv exec . cargo clippy -p opensekai-desktop` → PASS, no warnings.
- [ ] **Step 8: Commit** `"Keep a recent show list on the host."`

### Task 3: Host show templates

**Files:**
- Create: `apps/desktop/src-tauri/resources/templates/stage-lights.osekai` (byte copy of `fixtures/shows/stage-lights.osekai`)
- Create: `apps/desktop/src-tauri/src/templates.rs`
- Modify: `apps/desktop/src-tauri/src/show.rs` (`ShowFile::clear_path`), `apps/desktop/src-tauri/tauri.conf.json` (`"resources/templates/": "templates/"`), `lib.rs`, `build.rs`, `capabilities/main.json` (`allow-show-template-list`, `allow-open-show-template`)

**Interfaces:**
- Produces (Rust):
  - `pub const TEMPLATES: [ShowTemplate; 1]`, with `pub struct ShowTemplate { pub id: &'static str, pub name: &'static str, pub file: &'static str }` and the value `{id:"stage-lights", name:"Stage Lights", file:"stage-lights.osekai"}`
  - `pub fn template_path(resource_dir: &Path, id: &str) -> Result<PathBuf, AppError>`
  - `ShowFile::clear_path(&self)`
- Produces (commands):
  - `show_template_list(window) -> Result<Vec<{id,name}>, AppError>` (camelCase serde)
  - `open_show_template(window, id: String) -> Result<serde_json::Value, AppError>`

- [ ] **Step 1: Write failing tests.**
  - In `show.rs`: `clear_path_forgets_current_file`. Call `set_path` then `clear_path` → `path()` is `None`.
  - In `templates.rs`:
    - `every_template_is_a_valid_show_without_assets`: for each `TEMPLATES` entry, `show::read_show(&manifest_dir.join("resources/templates").join(file))` is ok, and the JSON has no `assetId` string value at any depth;
    - `template_name_matches_document`: the document `name == template.name`;
    - `unknown_template_is_invalid`: `template_path(dir, "../x")` → `ErrorCode::InvalidInput`.
- [ ] **Step 2: Run** `direnv exec . cargo test -p opensekai-desktop templates clear_path` → FAIL.
- [ ] **Step 3: Implement.** `template_path` looks up the ID in `TEMPLATES` only; it never joins the raw ID. `open_show_template`: `require_window_label`; path from `app.path().resource_dir()?.join("templates")`; `read_show` in `spawn_blocking`; on success `show_file.clear_path()`. A template does not touch the recent list. Copy the fixture file. Add the resources map entry and the command and permission entries.
- [ ] **Step 4: Run** the tests, then `direnv exec . cargo clippy -p opensekai-desktop` → PASS.
- [ ] **Step 5: Commit** `"Bundle the Stage Lights show template."`

### Task 4: Start-screen state logic

**Files:**
- Create: `apps/desktop/src/editor/start-screen.ts`
- Test: `apps/desktop/test/start-screen.test.ts`

**Interfaces:**
- Consumes: `ShowMark`, `showDirty` from `apps/desktop/src/editor/show-management.ts`.
- Produces:
  - `export function startScreenOpen(input:{fixtureMode:boolean;ended:boolean;start:ShowMark|null;current:ShowMark}):boolean`. It is true only when `!fixtureMode && !ended && start!==null && current.revision!==null && !showDirty(start,current)`.
  - `export function startScreenEnds(input:{start:ShowMark|null;current:ShowMark}):boolean`. It is true when `start!==null && showDirty(start,current)`. The caller makes `ended` sticky with it.
  - `export const RecentShowSchema=z.object({name:z.string().max(256),folder:z.string().max(256)}).strict()`, `export const ShowTemplateSchema=z.object({id:z.string().max(64),name:z.string().max(128)}).strict()`, and their inferred types `RecentShow`, `ShowTemplate`.

- [ ] **Step 1: Write failing tests.** `start` is `{name:'Untitled Show',revision:3,blueprintRevision:1}`.
  - `opens_on_untouched_normal_launch` → `true`.
  - `stays_closed_in_fixture_mode` → `false`.
  - `stays_closed_before_first_poll` (`start:null`) → `false`.
  - `ends_on_scene_revision_change` (current revision 4) → `startScreenEnds` `true`.
  - `ends_on_blueprint_revision_change` (blueprintRevision 2) → `true`.
  - `ends_on_rename` (name `'Live'`) → `true`.
  - `stays_ended_after_undo`: with `ended:true` and current equal to start → `startScreenOpen` `false`.
  - `rejects_unknown_recent_fields`: `RecentShowSchema.safeParse({name:'a',folder:'b',path:'/x'}).success` is `false`.
- [ ] **Step 2: Run** `pnpm vitest run --project unit apps/desktop/test/start-screen.test.ts` → FAIL.
- [ ] **Step 3: Implement** the two functions and schemas.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `"Add the start screen visibility rule."`

### Task 5: Start screen UI and editor wiring

**Files:**
- Create: `apps/desktop/src/components/StartScreen.svelte`
- Modify: `apps/desktop/src/bootstrap.ts` (return `fixtureMode` from `info.fixtureMode`), `apps/desktop/src/components/ScenePane.svelte` (optional `children` snippet rendered as a layer over `.viewport`), `apps/desktop/src/EditorApp.svelte`

**Interfaces:**
- Consumes: Task 2 and Task 3 commands, Task 4 functions and schemas.
- Produces: `StartScreen` props `{recent:RecentShow[];templates:ShowTemplate[];disabled:boolean;onaddcharacter:()=>void;onopen:()=>void;ontemplate:(id:string)=>void;onrecent:(index:number)=>void;onclose:()=>void}`.

- [ ] **Step 1: Build `StartScreen.svelte`.**
  - Centred column: the colour logo from `src/assets/opensekai-logo.svg` (imported as a URL, `<img alt="OpenSekai">`, about 96 px).
  - `Button` primary `Add character`, then ghost `Open show…` with a `⌘O` hint, a `Templates` heading with one ghost row per template, and a `Recent` heading with rows (`name` and a quieter `folder`) only when `recent.length>0`.
  - A ghost close `Button` (lucide `X`, title `Close`) in the top-right corner.
  - On mount, focus the primary button. Opaque background from the theme surface token, so the viewport does not show through. Fade in with `prefers-reduced-motion` respected, like `panelIn` in `EditorApp.svelte`.
- [ ] **Step 2: Wire `EditorApp.svelte`.**
  - Set `startMark:ShowMark|null` once, at the same poll that first sets `savedMark`.
  - `startEnded=$state(false)`. An `$effect` sets `startEnded=true` when `startScreenEnds({start:startMark,current:currentMark()})`.
  - `const startOpen=$derived(panel==='assets'&&startScreenOpen({fixtureMode,ended:startEnded,start:startMark,current:currentMark()}))`.
  - Change `add` to return the new entity ID.
  - `addCharacter = async()=>{startEnded=true;const id=await add('character',view.scene!.revision);if(id)await chooseModel(id);}`.
  - Extract the body of `openShow` into `openShowFrom(load:()=>Promise<unknown|null>)`. `openShow` uses `invoke('open_show')`. Templates use `invoke('open_show_template',{id})`. Recents use `invoke('open_recent_show',{index})`. Each sets `startEnded=true` after a successful load.
  - `saveShow` sets `startEnded=true` on success.
  - After bootstrap, and after each successful open or save, refresh `recent` from `invoke('recent_show_list')` parsed with `RecentShowSchema.array()`. Load `templates` once from `show_template_list`.
  - The `key` handler: on `Escape` with `startOpen`, `startEnded=true`.
  - A failed recent open shows an error toast with the host message, then refreshes the list.
  - Render `<StartScreen …/>` through the ScenePane `children` snippet when `startOpen`.
- [ ] **Step 3: Run** `pnpm --filter @opensekai/desktop check && pnpm test:unit` → PASS.
- [ ] **Step 4: Run the flow in the app.** `pgrep -fl opensekai-desktop` first, then `direnv exec . pnpm dev:desktop` in the background. Check the items below by window screenshots and AX scripting (see memory `local-qa-without-computer-use`). Record the results for Task 6.
  1. A fresh launch shows the start screen with the logo; Recent is absent when the list file does not exist.
  2. Stage Lights loads. The show name is `Stage Lights`, the screen is gone, and Save asks for a file.
  3. Save the show, relaunch: Recent lists it, and a click opens it.
  4. Delete that file, relaunch, click it: an error toast appears, the entry is gone, and the scene is unchanged.
  5. Add character opens the VRM chooser. Use the Catboy VRM (memory `qa-avatar-catboy`).
  6. Escape dismisses the screen. The preview kept drawing the whole time (FPS counter visible).
  7. With an OBS browser source on the output URL, the output did not reload during the actions. Use the local OBS WebSocket with an isolated test source.
- [ ] **Step 5: Commit** `"Show the start screen on an untouched launch."`

### Task 6: Documentation and evidence

**Files:**
- Modify: `ARCHITECTURE.md` (host state file `recent-shows.json`, resource dir `templates/`, four new main-window commands and their trust checks), `docs/warudo-parity.md` SCN-05 line (recent shows and templates partial, start screen, the checks verified in Task 5), `spdd/prompt/2026-11-15-start-screen.md` (status and evidence)
- Create: `docs/evaluation/start-screen.md` (what Task 5 Step 4 verified, commit, macOS version; unknowns stated as unknown)

- [ ] **Step 1: Update the three docs and write the evaluation note.** Claim only verified behavior.
- [ ] **Step 2: Run** `pnpm check && pnpm test:unit && direnv exec . cargo test -p opensekai-desktop` → PASS.
- [ ] **Step 3: Commit** `"Record the start screen evidence."`
- [ ] **Step 4: Finish.** `direnv exec . cargo sweep --time 7`. Then push and open a PR (memory `finish-branch-default-pr`). The PR text is in STE. No schema migration.
