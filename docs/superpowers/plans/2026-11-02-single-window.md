# One Editor Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Scene window into the Editor window, so the scene preview is a pane on the Assets tab and the app has one window.

**Architecture:** The Editor root (`EditorApp.svelte`) starts the session the way `App.svelte` does today and owns one `EditorModel`. The Scene toolbar and viewport move into `components/ScenePane.svelte`, which stays in the document on every tab. A pure gate turns the preview pump off when another tab shows. The native side keeps one window labeled `main` with one capability.

**Tech Stack:** Svelte 5, TypeScript, vitest, Tauri 2, Rust, `@oshi-connect/ui`, `@lucide/svelte`.

**Spec:** `spdd/prompt/2026-11-02-single-window.md` (requirements R1–R13). Analysis: `spdd/analysis/2026-11-02-single-window.md`. Read both before each task.

## Global Constraints

- One window: label `main`, title `OpenSekai`, 1440 × 900 at first launch, minimum 960 × 600, `backgroundThrottling: "disabled"`.
- Assets tab: Hierarchy 160 px minimum, 224 px default, resizable; scene pane gets the rest, never less than 320 px; Inspector or tracking guide 320 px fixed.
- Pause rule: `toggleOn && assetsShown`, or an open wake hold. No timer, no delay, no second render loop.
- No new helper text, status text, badges, or labels. No pause copy. One footer (the Editor footer).
- No change to host roles, router, contracts, show format, MCP, the OBS page, or local storage keys.
- No `opener:` permission and no `core:window:allow-minimize` or `allow-unminimize` on `main`.
- pnpm only. Functional TypeScript. Match the dense one-line style of the surrounding Svelte and TypeScript files. Comments only where logic is hard to follow.
- Prose (docs, evidence, commit bodies) in ASD-STE100. No agent attribution in commits.
- Run commands from the worktree root. Do not use `git -C` or `cd … &&`.

## Review Focus

1. **Tab change during a gizmo drag.** Leaving Assets while a drag is active must cancel the drag and clear the draft, so no gesture or pending state sticks. Test: Task 3 Step 7 (manual) and the `editor.cancel()` call in the panel effect.
2. **W, E, R typed outside the viewport.** Typing in an Inspector field, a show name, or a Blueprint node search must not change the tool. Test: `scene-keys.test.ts` in Task 1.
3. **Window resized while the pane is hidden.** On return to Assets the preview must fit the new stage size, not the old one. Test: Task 6 macOS check, item "resize on Blueprints, return".
4. **Screenshot from MCP while another tab shows and the toggle is off.** The screenshot completes and the pump stops after it. Test: `preview-gate.test.ts` "a wake hold applies frames while the gate is closed" in Task 1, and Task 6 check.
5. **Show Open from the File menu while Blueprints shows.** `openShow` already sets `panel='assets'`; the preview must resume and show the new scene with no stale draft or selection. Test: Task 6 macOS check.

---

### Task 0: Minimized session gate (macOS, current build)

**Files:**
- Create: `docs/evaluation/single-window.md` (section "Before the merge")

No code. This step decides whether the slice continues (spec O0).

- [ ] **Step 1:** Load the memories `verify-with-running-build`, `running-dev-app-hmr`, and `qa-avatar-catboy`. Check `pgrep -fl OpenSekai` and do not disturb an owner session.
- [ ] **Step 2:** Start the current build (`pnpm dev:desktop`), open the Bonnie scene with the Catboy avatar, add an OBS test Browser Source from the Output tab URL (isolated OpenSekai source, local only, no stream).
- [ ] **Step 3:** Minimize the **Scene** window for 5 minutes. Record: OBS output motion (screenshot or local test recording at start and end), `app_status` frame counts from MCP each minute, VMC send datagram counts, network tracking state, and MediaPipe tracking status.
- [ ] **Step 4:** Write the results with backend, quality profile, fixture revision, and commit. An unavailable measurement is "unknown", never zero.
- [ ] **Step 5:** If the session or `output_main` slowed down, **stop** and report to the owner. Otherwise commit:

```bash
git add docs/evaluation/single-window.md spdd/analysis/2026-11-02-single-window.md spdd/prompt/2026-11-02-single-window.md docs/superpowers/plans/2026-11-02-single-window.md
git commit -m "Add the one editor window slice and the minimized session check"
```

### Task 1: Preview gate and scene keys (pure)

**Files:**
- Create: `apps/desktop/src/editor/preview-gate.ts`, `apps/desktop/src/editor/scene-keys.ts`
- Test: `apps/desktop/test/preview-gate.test.ts`, `apps/desktop/test/scene-keys.test.ts`

**Interfaces:**
- Produces: `previewActive(state:{toggleOn:boolean;assetsShown:boolean}):boolean`
- Produces: `toolForKey(key:{key:string;modifier:boolean;editableTarget:boolean},state:{assetsShown:boolean;editable:boolean}):Tool|null` (`Tool` from `editor/ui-message.ts`)

- [ ] **Step 1: Write the failing tests**

`preview-gate.test.ts`:
- `it('is active only with the toggle on and the Assets tab shown')`: the four combinations; only `{toggleOn:true,assetsShown:true}` is `true`.
- `it('a wake hold applies frames while the gate is closed')`: with the `manualScheduler` pattern from `preview-pump.test.ts`, `pump.setEnabled(previewActive({toggleOn:true,assetsShown:false}))`, offer a frame, tick → `apply` not called; `const release=pump.wake()`, tick → called once; `release()`, offer, tick → no new call.
- `it('a tab change back to Assets applies the newest frame on the next display frame')`: gate closed, offer frames A then B, set gate open, one tick → `apply` called once with B.

`scene-keys.test.ts`:
- `w`, `e`, `r` and `W` map to `translate`, `rotate`, `scale` when `assetsShown` and `editable`.
- Returns `null` for each: `modifier:true`; `editableTarget:true`; `assetsShown:false`; `editable:false`; key `q`; key `Escape`.

- [ ] **Step 2:** Run `pnpm test:unit apps/desktop/test/preview-gate.test.ts apps/desktop/test/scene-keys.test.ts`. Expected: FAIL, modules not found.
- [ ] **Step 3:** Implement both functions. `toolForKey` lowercases `key` and uses the same map as `App.svelte` line 43.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add apps/desktop/src/editor/preview-gate.ts apps/desktop/src/editor/scene-keys.ts apps/desktop/test/preview-gate.test.ts apps/desktop/test/scene-keys.test.ts` and `git commit -m "Add the preview gate and the scene tool keys"`.

### Task 2: Extract `ScenePane.svelte` (no behavior change)

**Files:**
- Create: `apps/desktop/src/components/ScenePane.svelte`
- Modify: `apps/desktop/src/App.svelte` (use the pane; keep the session code), `apps/desktop/src/app.css` (rename `.scene-window` layout rules only if needed)

**Interfaces:**
- Produces: `ScenePane` props:
  - `$bindable`: `canvas:HTMLCanvasElement`, `counterHost:HTMLDivElement`, `monitorHost:HTMLDivElement`
  - values: `tool:Tool`, `canEdit:boolean`, `available:boolean`, `pending:boolean`, `selectedName:string`, `selectedEditable:boolean` (a selection exists and is not `tracking`), `previewOn:boolean`, `perfVisible:boolean`, `loads:AssetLoadStatus[]`, `names:Record<string,string>`, `hidden:boolean`
  - callbacks: `ontool(tool:Tool)`, `onpreviewtoggle()`, `onperftoggle()`, `ondismissload(entityId:string)`
- The pane owns: the guides state and its `localStorage` key, the guides menu, the context menu (Move, Rotate, Scale only; no **Open editor**), the stage `ResizeObserver` and `previewSize`. It ignores a zero stage size (R7): when `hidden` is true or `fitPreview` returns width 0, keep the last `previewSize`.
- The pane has no **Editor** button and no footer. The `App.svelte` footer stays for this task only.

- [ ] **Step 1:** Move the toolbar and viewport markup and their local state from `App.svelte` into the pane. `App.svelte` passes its state and keeps `bootstrapDesktop`, the tracker, the model, and the bridge.
- [ ] **Step 2:** Run `pnpm check` and `pnpm test:unit`. Expected: PASS.
- [ ] **Step 3:** Start `pnpm dev:desktop`. In the two-window app, check: gizmo drag, W/E/R, guides menu, performance monitor, Preview toggle, context menu, load overlay. Expected: same as before, minus the **Editor** button and **Open editor** item.
- [ ] **Step 4: Commit** `git commit -m "Move the scene toolbar and viewport into a pane component"`.

### Task 3: Merge the roots

**Files:**
- Modify: `apps/desktop/src/EditorApp.svelte`, `apps/desktop/src/main.ts`, `apps/desktop/src/bootstrap.ts`, `apps/desktop/src/editor/ui-message.ts`, `apps/desktop/src/editor/load-status.ts`, `apps/desktop/src/editor/tracking-activation.ts`, `apps/desktop/src/app.css`
- Delete: `apps/desktop/src/App.svelte`, `apps/desktop/src/editor/ui-bridge.ts`
- Test: `apps/desktop/test/ui-message.test.ts`, `apps/desktop/test/load-status.test.ts`, `apps/desktop/test/hidden-cameras.test.ts`, `apps/desktop/test/tracking-activation.test.ts`

**Interfaces:**
- Consumes: `ScenePane` (Task 2), `previewActive`, `toolForKey` (Task 1).
- Produces: `bootstrapDesktop(...)` unchanged in signature. `bootstrapEditor` and `NativeEditorConnection` removed. `applyTrackingConfig(entityId,config,revision,{commit})` with no `activate`.
- `ui-message.ts` keeps only `Tool`, `Draft`, `fitPreview`. `load-status.ts` keeps only `stageLabel`.

- [ ] **Step 1: Update the tests first.**
  - `ui-message.test.ts`: keep the two `fitPreview` tests; delete the parser, draft sender, and load status parser tests. Move "preserves the selected output backend in copied URLs" to the test file of `output-url.ts` if that file exists, otherwise keep it here.
  - `load-status.test.ts`: keep "labels each stage"; delete the sender and clamp tests.
  - `hidden-cameras.test.ts`: drop the `parseUIMessage` import and the two lines that use it; keep the `fitDevices` assertions (at most 16 devices, at most 4096 bytes).
  - `tracking-activation.test.ts`: replace the activation tests with `it('commits enabled MediaPipe with the captured revision')` and keep "rejects invalid configuration"; no test passes `activate`.
- [ ] **Step 2:** Run `pnpm test:unit apps/desktop/test`. Expected: FAIL in `tracking-activation.test.ts` (old signature) only.
- [ ] **Step 3: `main.ts`** mounts `EditorApp` with no query check. **`tracking-activation.ts`** drops `activate` and the "Scene window is unavailable" text. **`ui-message.ts`** and **`load-status.ts`** are reduced as above. **`bootstrap.ts`** deletes `bootstrapEditor`.
- [ ] **Step 4: `EditorApp.svelte`**:
  - Replace `bootstrapEditor()` with `bootstrapDesktop(canvas, editorOptions, probe, counterHost)` using the callbacks from `App.svelte` lines 58–69. One model, one poll; merge the two poll callbacks (status, `available`, `savedMark`, cancel the drag when unavailable). Keep `api`, `assets` (from `value.assets`), `outputUrl`, `canEdit`, Blueprint sync, debug feed, live edits.
  - Move the tracker setup (`createMediaPipeTracker`, `onClock`, `reconcileTracking`, `fitDevices`) from `App.svelte`. `devices` is set directly.
  - Delete `notify`, `listenUI`, and every `sendUI` call. Selection: `select(id)` also calls `model.select`/`clearSelection` and the viewport sync. Tool: `setTool` sets `tool` and calls the viewport sync. Draft: `onDraft` sets `draft` directly. Loads: `onLoadStatus` sets `loads` directly. `onGestureEnd` and `onNavigateEnd` call `model.load()`.
  - The viewport sync is the `sync()` function of `App.svelte` line 38, called on model change, selection, tool, and availability change.
- [ ] **Step 5: Layout.** On the Assets tab: Hierarchy, `ResizeHandle`, `ScenePane`, then the Inspector or tracking guide in a 320 px column (`flex:none;width:320px`). Set `maxWidth` so the pane keeps 320 px: `Math.max(160,Math.min(360,shell.clientWidth-320-320))`. Render `ScenePane` outside the `{#if panel==='assets'}` blocks with `hidden={panel!=='assets'}` so it stays mounted; the CSS rule for the pane wrapper `[hidden]` is `display:none`. The Scene footer goes away.
- [ ] **Step 6: Gate and keys.**
  - `$effect(()=>{session?.setPreviewEnabled(previewActive({toggleOn:previewOn,assetsShown:panel==='assets'}))})`.
  - `$effect` on `panel`: when it is not `assets` and a drag is active, call `session.editor.cancel()`, set `dragging=false` and `draft=null`.
  - `<svelte:window onkeydown>`: if `defaultPrevented`, return. `toolForKey` with `modifier` = Ctrl, Meta, or Alt; `editableTarget` = target inside `input,textarea,select,[contenteditable="true"]`; `assetsShown`; `editable` = `canEdit&&available`. A tool → `preventDefault` and `setTool`. Escape during a drag → `session.editor.cancel()`. Escape does nothing else.
- [ ] **Step 7:** Run `pnpm check` and `pnpm test:unit`. Expected: PASS. The app does not start until Task 4 (the `editor` window calls `bootstrap_session`, which checks `main`).
- [ ] **Step 8: Commit** `git commit -m "Merge the scene preview into the editor window root"`.

### Task 4: One native window

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/capabilities/main.json`, `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/src/bootstrap.rs`
- Delete: `apps/desktop/src-tauri/capabilities/editor.json`

**Interfaces:**
- Produces: commands `bootstrap_session`, `shutdown_session`, and every former editor command require label `main`. Removed: `editor_connection`, `show_editor`, `show_scene`, `hide_editor`, `confirm_close_editor`, and their permissions.

- [ ] **Step 1: Write the failing Rust tests** in `command_boundary_tests`, replacing `scene_focus_permission_is_granted_only_to_editor`:
  - `fn the_only_window_is_main()`: parse `tauri.conf.json` (`include_str!`); `app.windows` has one entry with `label == "main"`, `title == "OpenSekai"`, `width == 1440`, `height == 900`, `minWidth == 960`, `minHeight == 600`, `backgroundThrottling == "disabled"`, and no `url`. `app.security.capabilities == ["main"]`.
  - `fn main_capability_has_the_exact_permission_list()`: `windows == ["main"]`; the permission set equals: `allow-app-version`, `allow-bootstrap-session`, `allow-shutdown-session`, `allow-set-keystroke-capture`, `allow-open-input-monitoring-settings`, `allow-open-screenshots-folder`, `allow-import-avatar`, `allow-import-scene`, `allow-save-show`, `allow-save-show-as`, `allow-open-show`, `allow-set-show-dirty`, `allow-import-blueprint-file`, `allow-export-blueprint-file`, `core:event:allow-listen`, `core:event:allow-unlisten`. Assert no entry starts with `opener:` and none is `core:window:allow-minimize` or `core:window:allow-unminimize`. No `core:event:allow-emit-to`: after Task 3 no frontend code calls `emitTo`.
  - Change `editor_commands_and_owner_commands_reject_other_window_labels`: `("editor","main")`, `("remote","main")`, `("","main")` are `Forbidden`; `("main","main")` is ok.
  - In `bootstrap.rs` tests: `bootstrap_session` returns the live asset records after an import (the same check that exists for `editor_connection` at lines 306–335, moved to the session path), then delete the `editor_connection` tests.
- [ ] **Step 2:** Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml command_boundary_tests`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `tauri.conf.json`: one window as in the test; `security.capabilities: ["main"]`.
  - `capabilities/main.json`: the exact list; description "Local scene owner and editor". Delete `editor.json`. Remove the five deleted commands from the command list in `apps/desktop/src-tauri/build.rs` (lines 37–40 and the `show_scene`, `confirm_close_editor` entries); `permissions/autogenerated/` regenerates on build.
  - `lib.rs`: every `require_window_label(…, "editor")` → `"main"`. Delete the five commands and their `generate_handler!` entries. `send_show_command` gets `main`, shows, unminimizes, focuses, and emits `show-command` to `main`. `on_window_event`: focus loss on `main` ends keystroke capture; the `main` close request keeps `request_quit`. `asset-record` already goes to `main`.
  - `bootstrap.rs`: the session bootstrap returns `service.asset_records()` (live), not `ready.assets`. Remove `editor_connection` and `NativeEditorConnection`.
- [ ] **Step 4:** Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` and `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`. Expected: PASS.
- [ ] **Step 5:** Run `pnpm dev:desktop`. Expected: one window opens, the scene pane shows the session, the Inspector edits it, and closing the window with unsaved changes asks Quit or Cancel.
- [ ] **Step 6: Commit** `git commit -m "Keep one native window for the editor and the session"`.

### Task 5: Documentation map

**Files:**
- Modify: `ARCHITECTURE.md`, `README.md`, `.agents/skills/local-qa-e2e/SKILL.md`, `.agents/skills/recording-demos/SKILL.md`

- [ ] **Step 1:** `ARCHITECTURE.md`: diagram has one `Editor window (Tauri WebView) — session worker = publisher, operator client, preview renderer`. Update the Session worker, Clients, and Renderers bullets (the pump also stops when another tab shows), the `apps/desktop/src` row (one root, `ScenePane.svelte`, no UI bridge, Scene guides key unchanged), and every other "Scene window" or "Editor window" line (12 today). Note that one window holds the union of the command permissions.
- [ ] **Step 2:** `README.md` lines 56–57, 76, 88: one window. Skills: replace "tile both app windows" and the Scene window capture targets with the one window.
- [ ] **Step 3:** `grep -n -i "scene window\|editor window" ARCHITECTURE.md README.md .agents/skills/*/SKILL.md`. Expected: no line that describes two windows as current.
- [ ] **Step 4: Commit** `git commit -m "Describe the one editor window in the code map and the QA skills"`.

### Task 6: macOS verification, evidence, and parity

**Files:**
- Modify: `docs/evaluation/single-window.md` (section "After the merge"), `docs/warudo-parity.md` (UI-01, OSE-05, MED-09, SHOW-06 text that names the Scene window as a place of an open check, and the evidence table)

- [ ] **Step 1:** Read `docs/qa.md` and `docs/testing.md`. Use the `local-qa-e2e` skill steps with the running build, MCP, computer use or AX scripting, and the local OBS WebSocket.
- [ ] **Step 2:** Check and record each item of spec O6:
  - Hierarchy and viewport selection both ways; gizmo drag with the Inspector draft; W, E, R; W typed in the show name and in a Blueprint node search does not change the tool; Escape during a drag.
  - Each tab change: the preview stops on Output, Blueprints, Resources, Settings and resumes on Assets; camera, selection, and assets stay; no asset reload in the load overlay.
  - Resize the window on Blueprints, return: the preview fits the new stage.
  - Tab change during a gizmo drag: the drag cancels and nothing stays pending.
  - Preview and output frame rate and CPU time on Assets, on Blueprints, and with the toggle off (Bonnie scene).
  - MCP `camera_screenshot` while Blueprints shows and the toggle is off.
  - OBS output through tab changes, through File › Open while Blueprints shows, and with the window minimized for 5 minutes (same measures as Task 0, including MediaPipe).
  - File › Open, Save, Save As; Cmd+Q and the window close with unsaved changes.
- [ ] **Step 3:** Record a short demo of the tab changes with the `recording-demos` skill for the PR (#144).
- [ ] **Step 4:** Write the evidence with backend, quality profile, fixture revision, and commit. Change UI-01 to the one-window layout with the evidence link. Change OSE-05 only to what was measured. Claim nothing for Windows.
- [ ] **Step 5: Commit** `git commit -m "Record the one editor window check on macOS"`.
