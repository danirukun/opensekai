# Analysis: One editor window

Date: 2026-11-02. Issue: [#251](https://github.com/danirukun/opensekai/issues/251). Parity: UI-01. Mode: contract-first.

## Problem

OpenSekai has two windows. The Scene window holds the session worker, the preview renderer, the MediaPipe tracker, and the viewport gizmos. The Editor window holds the Hierarchy, the Inspector, Output, Blueprints, Resources, and Settings. The operator must move between two windows to select an asset and see the result. Realtime editors such as Unity and Blender use one window with a central viewport. The owner wants that layout.

## Owner decisions

From the issue comments (2026-10-28), the approved Figma mock (v2, [page](https://www.figma.com/design/WSkWz6AUxzNxbweU4Tjmkz/OpenSekai?node-id=4-2)), and the conversation of 2026-11-02:

1. One window. No pop-out preview window. OBS uses the Browser Source.
2. No split view. The main area changes fully between the scene and the other panels. A split view is Later.
3. The existing rail tabs select what the main area shows. No new tabs at the top.
4. Do not redesign the UI. Keep the existing Hierarchy, Inspector, and panel UI. Move the Scene window canvas and its toolbar into a pane between the Hierarchy and the Inspector on the Assets tab. Remove the Scene window **Editor** button.
5. The Inspector has a fixed width of 320 px while the scene pane shows.
6. **Instant pause, automatic resume** (2026-11-02). This replaces the 2-minute auto-pause in the issue comment and in the mock. When the operator leaves the Assets tab, the preview stops at once. When the operator comes back, the preview starts again without a click. The OBS output and the session never pause.

The mock frames "Preview paused while on Blueprints" and "Back on Assets while paused" show the old 2-minute rule. Decision 6 makes them obsolete. Their status copy ("Paused · output live", "Preview paused · output and world engine running") is not used.

## Current behavior

- `tauri.conf.json` has two windows: `main` (Scene, 760 × 640) and `editor` (`index.html?view=editor`, 900 × 720, minimum width 620). Both have `backgroundThrottling: "disabled"`. `main.ts` mounts `App.svelte` or `EditorApp.svelte` from the `view` query.
- Each window creates its own `EditorModel` and its own `createEditorPoll` over its own operator client. The two windows keep selection, the active tool, the gizmo draft, the asset load status, and the camera device list equal through Tauri events (`editor/ui-bridge.ts`, `editor/ui-message.ts`: `selection`, `tool`, `draft`, `refresh`, `ready`, `loadStatus`, `trackingDevices`).
- `bootstrap_session` (only `main`) returns the publisher, operator, preview, and output descriptors. `editor_connection` (only `editor`) returns the operator and output descriptors. The `main` window already holds every descriptor that the `editor` window holds. `editor_connection` returns the live asset records; `bootstrap_session` returns the startup snapshot.
- Most native commands check `require_window_label(..., "editor")`. `bootstrap_session`, `shutdown_session`, and `show_editor` check `"main"`. `show_scene`, `hide_editor`, and `confirm_close_editor` exist only for the two-window case.
- A close request on `main` runs `request_quit` (asks when the show has unsaved changes). A close request on `editor` asks Save, Discard, or Cancel and then hides the window. The native File menu shows the `editor` window and emits `show-command` to it. Focus loss on `editor` ends keystroke capture.
- `applyTrackingConfig` calls `show_scene` before it enables a MediaPipe source, so the Scene window is visible and not minimized while the camera runs.
- The preview pump has an enabled flag (the toolbar **Preview** toggle) and wake holds for screenshots ([preview off](2026-10-28-preview-off.md)).

## Findings

1. Moving the Scene window root into the Editor window root keeps every renderer, session, and host path. The trust boundary does not change: the single window gets the four descriptors that `main` gets today.
2. Two models and two polls become one. The cross-window messages become shared component state. This removes one round trip on each selection, tool change, and gizmo draft.
3. The preview canvas must stay in the document while another tab shows. Unmounting it disposes the renderer, and the assets load again. A hidden stage has a zero size. The drawing buffer comes from the output size and the quality profile, not from the stage. The stage sets only the CSS size (`fitPreview`), which the viewport pointer mapping reads, so the CSS size must keep its last value while it is hidden.
4. The pause rule is one expression: the pump applies frames when the Preview toggle is on and the Assets tab shows, or while a wake hold is open. The pump already has the hold count.
5. The preview, the Blueprint editor (Rete), and the Inspector now share one WebView main thread. Before, each window had its own web content process. A heavy editor action can delay a preview frame. It cannot delay `output_main`, which is a different page in OBS. The session tick is in a Worker.
6. The tracker runs on `setTimeout` at 30 Hz with a `<video>` element in the page. Before, an operator could minimize the Editor window and the Scene window kept the camera visible. Now the only window can be minimized. Whether WKWebView keeps the camera frames and the timer at full rate in a minimized window with `backgroundThrottling: "disabled"` is not known. It must be measured on macOS.
7. Window-level W, E, R shortcuts in the Scene window had no other listener. In the merged window they must not act while the Blueprint editor, an input, or another tab has the keyboard.
8. Local storage keys do not change. Both windows already used the same origin.

## Questions resolved without the owner (reversible)

- **Window.** One window with label `main`, title `OpenSekai`, 1440 × 900 at first launch (the mock size), minimum 960 × 600. Alternative: keep label `editor`. Rejected, because the session commands already check `main` and the close path already quits from `main`.
- **Close.** A close request runs the existing `request_quit` (Quit or Cancel when the show has unsaved changes), the same as Cmd+Q. `confirm_close_editor` and its Save choice go away. Alternative: keep Save, Discard, Cancel on close. Rejected to keep one quit path.
- **Status copy.** No pause text in the toolbar or the footer. The preview is never paused out of sight, so there is nothing to report. The dimmed canvas and the Preview toggle show a manual pause, as today.
- **Footers.** One footer: the existing Editor footer. The Scene footer ("Session connected", "W Move · E Rotate · R Scale") goes away. The tool names stay as button titles.
- **Hierarchy width.** Resizable as today (160 px minimum, 224 px default). Its maximum changes so that the scene pane keeps at least 320 px.
- **Command permissions.** One window must hold the union of the two command sets. The safeguard is the exact list test and no unused window permissions.
- **Old headless checks.** The checks under `docs/evaluation/*/` stay as evidence for their commits.
- **Tracking activation.** `applyTrackingConfig` no longer needs `show_scene`. The tracker is in the window that the operator uses.

## Risks

- Camera tracking in a minimized window (finding 6). If it stops, the owner decides the next step. The slice records the result and does not claim it.
- Preview frame time with the Blueprint tab work removed from its process (finding 5). Measure the preview and output frame rate in the Bonnie scene before and after.
- Hidden canvas size (finding 3). A zero CSS size on return can break pointer mapping until the next resize.
- OSE-05 is verified for a minimized Editor window, not for a minimized session owner. MED-09 lists a send with a minimized Scene window as open. The slice must measure this first.
- Old evidence names the Scene window and the Editor window. Evidence stays true for its commit. Only ARCHITECTURE.md and the parity checklist change text.
