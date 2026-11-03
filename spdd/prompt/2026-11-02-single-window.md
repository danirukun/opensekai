# REASONS: One editor window

Date: 2026-11-02. Scope: merge the Scene window into the Editor window. The scene preview becomes a pane on the Assets tab. Issue: [#251](https://github.com/danirukun/opensekai/issues/251). Analysis: [one editor window](../analysis/2026-11-02-single-window.md).

## R — Requirements

R1. The app has one window. Its label is `main`, its title is `OpenSekai`, its first size is 1440 × 900, and its minimum size is 960 × 600. `backgroundThrottling` stays `"disabled"`. `index.html` mounts one root component. There is no `view` query.

R2. The window starts the session as the Scene window does today: `bootstrap_session` (which returns the live asset records, as `editor_connection` does today, not the startup snapshot), the session worker, the operator client, the `preview_main` renderer with the editor viewport, the MediaPipe tracker, the asset records listener, and `shutdown_session` on unmount. The window has one `EditorModel` and one `createEditorPoll`. The `editor_connection` command and `bootstrapEditor` go away.

R3. The Assets tab shows, from left to right: the Hierarchy (resizable, 160 px minimum, 224 px default), the scene pane (all remaining width, never less than 320 px), and the Inspector or the tracking guide (320 px fixed). The scene pane has the Scene toolbar and the viewport of `App.svelte` with no change of function: Move, Rotate, Scale, the selection name, Guides, the performance monitor, the Preview toggle, the guide overlay, the FPS counter host, the load overlay, the context menu, the camera frame, and the dimmed and inert state when the preview is off.

R4. The scene pane has no **Editor** button. The context menu has no **Open editor** item. Escape does not open or focus a window. Escape still cancels a gizmo drag.

R5. The Output, Blueprints, Resources, and Settings tabs fill the area right of the rail, as in the Editor window today. The scene pane stays in the document while they show: the canvas, the renderer, its loaded assets, the editor viewport camera, and the selection stay. The window never reloads the scene on a tab change.

R6. The preview pump applies frames only when the Preview toggle is on and the Assets tab shows, or while a wake hold is open. A tab change takes effect on the next display frame. On return to the Assets tab the pump applies the newest frame without operator input. The Preview toggle keeps its state across tab changes. `camera_screenshot` works on every tab and with the toggle off (R5 of [preview off](2026-10-28-preview-off.md)).

R7. While the scene pane is hidden, the preview keeps its last CSS size (`previewSize`). The stage `ResizeObserver` does not apply a zero size. The drawing buffer does not depend on the stage (`drawingBufferSize(output, quality)`), so it does not change.

R8. W, E, and R select Move, Rotate, and Scale only when the Assets tab shows, editing is available, no modifier key is down, and the keyboard focus is not in an input, a text area, a select, a content-editable element, or the Blueprint editor.

R9. Selection, the active tool, the gizmo draft, the asset load status, and the camera device list are shared state in the window. `editor/ui-bridge.ts`, the `UIMessage` type, `parseUIMessage`, `createDraftSender`, and `createLoadStatusSender` go away, with their tests. `ui-message.ts` keeps `Tool`, `Draft`, and `fitPreview` (or they move to a module with a better name). `test/hidden-cameras.test.ts` checks `fitDevices` without `parseUIMessage`. A Hierarchy selection selects in the viewport, a viewport pick selects in the Hierarchy and the Inspector, and a gizmo drag shows its draft in the Inspector Transform fields, as today.

R10. Native commands that checked the `editor` label check `main`. `show_editor`, `show_scene`, `hide_editor`, `confirm_close_editor`, and `editor_connection` go away. The capability files become one `main` capability with the permissions that the remaining commands need. This gives the session window the editor commands (file pickers, show save and open, `open_screenshots_folder`); one window must have both sets. The capability has no `opener:` permission and no `core:window:allow-minimize` or `allow-unminimize`. The Rust test `scene_focus_permission_is_granted_only_to_editor` is replaced by a test of the exact permission list of `main` and of the single window in `tauri.conf.json`. The File menu shows and focuses `main` and emits `show-command` to it. Focus loss on `main` ends keystroke capture. A close request on `main` runs `request_quit`. `asset-record` goes to `main`.

R11. `applyTrackingConfig` enables a MediaPipe source without a window activation step. Its error text does not name the Scene window.

R12. No change to the host roles, the router, the contracts, the show format, MCP, the OBS page, or the local storage keys.

R13. OSE-05 (stable output while the editor is minimized) is verified for two windows. After the merge, a minimized editor is a minimized session owner. When the window is minimized, the session, `output_main`, VMC send, and network tracking keep the same motion as with the window in front. Camera (MediaPipe) tracking in a minimized window is measured and recorded. It is not claimed unless it is measured. Result at cfcdef0 (dev build, macOS): with the window minimized, `output_main` fell to 39.7 to 51.7 frames per second in 6 of 18 intervals and VMC send fell from 296 to 235 datagrams per second; MediaPipe was not measured. The owner accepted this as a known limit of the one-window build ([check](../../docs/evaluation/single-window.md#minimized-window)).

## E — Entities

- `PreviewGate` (pure): `previewActive({ toggleOn, assetsShown }) = toggleOn && assetsShown`. The window passes the result to `setPreviewEnabled`. Wake holds stay in the pump.
- `PreviewPump`: no change to its interface (`offer`, `setEnabled`, `wake`, `stop`).
- `Panel`: `'assets' | 'output' | 'blueprints' | 'resources' | 'settings'`, as in `EditorApp.svelte` today.

## A — Approach

1. Extract the Scene toolbar and viewport from `App.svelte` into `components/ScenePane.svelte`. It takes the shared state (model, view, tool, available, canEdit, loads, guides, perf monitor) as props and callbacks. It owns the canvas, the stage `ResizeObserver`, the guides menu, and the context menu.
2. Move the session start from `App.svelte` into `EditorApp.svelte`. `bootstrapDesktop` gives the operator client to the one model, the poll, Blueprint sync, the debug feed, live edits, and the import and show actions that use `api` today.
3. Replace each `sendUI` and `listenUI` path with a direct state change or a function call in `EditorApp.svelte`.
4. Keep the scene pane mounted with `hidden` (or an equivalent that keeps the element) when another tab shows. Skip a resize when the stage size is zero.
5. Set the pump state from `previewActive` in one `$effect`.
6. Change the Tauri configuration, the capability, and the Rust labels. Delete the two-window commands.
7. Update ARCHITECTURE.md (diagram, Session worker, Renderers, `apps/desktop/src` row, every Scene window or Editor window line) and the parity checklist (UI-01 and lines that name the Scene window as a place of a check that is still open).

## S — Structure

- `apps/desktop/src/main.ts`, `EditorApp.svelte`, `App.svelte` (removed or reduced to the pane), `components/ScenePane.svelte` (new), `bootstrap.ts`, `editor/ui-bridge.ts` and `editor/ui-message.ts` (removed or reduced), `editor/load-status.ts`, `editor/tracking-activation.ts`, new `editor/preview-gate.ts`.
- `apps/desktop/test/`: `preview-gate.test.ts` (new); tests of removed modules removed; `tracking-activation.test.ts` changed.
- `apps/desktop/src-tauri/tauri.conf.json`, `capabilities/main.json`, `capabilities/editor.json` (removed), `src/lib.rs`, and the Rust tests that check window labels.
- `ARCHITECTURE.md`, `docs/warudo-parity.md` (UI-01, OSE-05, and open checks that name the Scene window), `docs/evaluation/single-window.md` (new evidence).
- `README.md` (diagram and window text), `.agents/skills/local-qa-e2e/SKILL.md`, `.agents/skills/recording-demos/SKILL.md` (window tiling and capture targets).

## O — Operations

0. Gate: measure the current build with the Scene window minimized for 5 minutes (session tick, `output_main` in OBS, VMC send, network tracking, MediaPipe). If the session or `output_main` slows down, stop and go back to the owner before step 2.
1. `preview-gate.ts` with unit tests: every combination of toggle and tab, a wake hold with the gate closed, a tab change while a screenshot hold is open.
2. Extract `ScenePane.svelte` with no change of behavior. The two-window app still works at this step.
3. Merge the roots: one model, one poll, one session. Remove the UI bridge. Mount the pane on the Assets tab and keep it in the document on the other tabs.
4. Native: one window, one capability, label checks, removed commands, menu, focus, close. `cargo test` for the label checks.
5. Typecheck, unit tests, and `cargo test`. The headless checks under `docs/evaluation/*/` that load `?view=editor` stay as evidence for their commits and are not updated. A new check for this slice goes in `docs/evaluation/single-window/` if a headless check helps.
6. macOS check in the running build with the Catboy QA avatar and the Bonnie scene (`docs/qa.md`):
   - Select in the Hierarchy and in the viewport; gizmo drag with the Inspector draft; W, E, R; Escape during a drag.
   - Tab changes: the preview stops on each other tab and starts again on Assets; camera, selection, and loaded assets stay; no asset reload.
   - Preview and output frame rate and CPU time on Assets, on Blueprints, and with the toggle off.
   - `camera_screenshot` from MCP while Blueprints shows.
   - OBS output continues through tab changes, through Open of a show, and with the window minimized. Record VMC send and network tracking while minimized. Measure MediaPipe tracking while minimized.
   - File menu Open, Save, Save As; Cmd+Q and a window close with unsaved changes.
   - A short recording of tab changes for the PR (#144).
7. Evidence, ARCHITECTURE.md, and the parity checklist in the same commit as the behavior.

## N — Norms

Keep the existing UI. Use `@oshi-connect/ui` controls already in use. No new helper text, labels, badges, or empty states. No colored side bar on the selected rail tab. Functional TypeScript. Prose in ASD-STE100. Small verified commits: the pane extraction, the merge, the native change, and the evidence can be separate.

## S — Safeguards

- Do not add a second render loop, a timer, or a delay for the pause. Use the one `requestAnimationFrame` pump.
- Do not unmount the preview renderer on a tab change.
- Do not pause the session, `output_main`, VMC send, or tracking from the window state.
- Do not add image readback, an image stream, or a new data path through Tauri IPC.
- Do not widen the trust scope beyond the union of the two windows. The window gets the descriptors that `main` gets today and the commands that `editor` gets today, minus the removed commands.
- Do not claim Windows behavior or minimized camera tracking without a measurement.
