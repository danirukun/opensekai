# Warudo editor interactions implementation plan

> For agentic workers: use subagent-driven development. Preserve the user's authorization for parallel agents with isolated ownership and lower effort.

**Goal:** Build Warudo-style windows with direct transforms, property scrubbing, border resizing and context menus.
**Architecture:** Keep one authoritative worker in the scene window. Add a separate operator-only editor and preview-only gizmos. Keep the native pose/output path unchanged.
**Tech stack:** Tauri2, Svelte5, shared Oshi UI, three.js180 TransformControls.
**Spec:** spdd/prompt/2026-10-03-warudo-editor-interactions.md.

## Global constraints

Production output_main cannot enable editor helpers. Only preview_main with diagnostics false can enable them. Commit once per gesture with its initial revision. Cancel Escape, pointer loss, focus loss, selection changes and external revisions. Keep normalized rotations and positive scale. Use shared controls. Preserve OBS and never print the URL/token. One worker; no pose/image stream over Tauri events.

## Review focus

- Animated transform changes during dragging must not become persistent offsets.
- Concurrent edits must conflict without replay.
- A released pointer outside the control must settle or cancel the gesture.
- Secondary editor connection must not expose publisher/shutdown capabilities.
- Narrow windows and edge menus must stay usable with keyboard input.

## Task1: Preview interactions

Files: renderer editor-viewport.ts/transform-edit.ts/renderer.ts/index.ts plus tests.
Interfaces: RendererOptions.editor and RendererHandle.editor are defined exactly in the contract.
- [x] Add failing pure math tests for animated-base translation, delta rotation, positive scaling and invalid transforms.
- [x] Add tests for preview-only scope, gesture cancellation and current revision.
- [x] Build retained TransformControls with raycast selection. Freeze selected preview root during gesture; commit once; cancel correctly; dispose helpers and listeners.
- [x] Run renderer tests/typecheck and commit the scoped lane.

## Task2: Editor controls

Files: Inspector/Hierarchy/ContextMenu/ResizeHandle/TransformFields and editor/interaction.ts plus tests.
Interfaces: existing EditorPanelProps; new model.setTransform(entityId,transform,expectedRevision?) and clearSelection. Components can add optional onselect(id), ontool(tool) and draft props. ContextMenu owns focus/keyboard/edge placement. ResizeHandle has value/min/max/orientation/onchange.
- [x] Add failing pure tests for clamped sizes, scrub conversion, finite/positive scale and menu placement.
- [x] Build numeric position/rotation/scale rows with scrub labels and reset; searchable Assets list; no unsupported toolbar actions.
- [x] Build local context-menu primitive using shared Buttons. Preserve a usable keyboard path, selection before action, and Escape/focus restoration.
- [x] Build border resize component with pointer capture and cancellation. Remove width sliders.
- [x] Run component checks/scoped logic tests and commit.

## Task3: Native window boundary

Files: native bootstrap/lib, static Tauri windows/capabilities, focused native tests.
Interfaces: editor_connection -> NativeEditorConnection defined in contract. Both windows are local. main alone receives full bootstrap and shutdown. editor can obtain only its operator/output projection.
- [x] Add a failing projection test that ensures publisher and preview descriptors are absent.
- [x] Add editor command and scoped capabilities. Add main scene and editor windows; editor URL index.html?view=editor. Scene close exits app; fixed caller-checked native commands hide/reopen the editor.
- [x] Run scoped Rust checks/Clippy; commit the lane.

## Task4: Compose and test live

Root files: model.ts/EditorApp.svelte/App.svelte/main.ts/bootstrap.ts/editor bridge/app.css and tests/docs.
- [x] Add explicit revision regression before model.setTransform implementation; add clearSelection.
- [x] Compose runtime and editor, bounded validated selection/tool/draft bridge, editor hide/reopen and W/E/R.
- [x] Apply Warudo-style light theme and asset/property layout. Verify narrow sizes and focus states.
- [x] Run tests/workspace checks; review integrated source; checkpoint and build release with current metadata.
- [x] Exercise actual UI gestures and right-click/keyboard menus, inspect OBS edits and absence of gizmos, copy URL under explicit authorization without logging it, test editor hide/reopen and menu cancellation. Active pointer Escape has unit coverage; live automation could not establish it.
- [x] Run targeted minimized smoke, preserve exact build evidence, update scoped parity/results, and make final checkpoint.

## Verification scope

See [actual UI and rendering checks](../../evaluation/warudo-editor-interactions.md). The temporary scene-only and compact configurations are evaluation harnesses. Active pointer Escape remains a live verification gap. This plan completion does not mark broad Warudo parity complete.
