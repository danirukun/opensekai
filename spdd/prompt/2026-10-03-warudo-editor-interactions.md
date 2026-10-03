# REASONS: Warudo editor interactions

## Requirements

Use Warudo's separate scene window and asset/property editor. Keep a compact navigation rail, searchable asset list and property rows. Use a light neutral theme with precise borders and restrained violet selection. Use Avenir Next with Segoe UI and sans-serif fallbacks. Preserve shared UI controls. Do not add fake graph, import, create, delete or duplicate controls.

Select scene objects by clicking. Show preview-only move/rotate/scale gizmos and W/E/R tools. Freeze only the selected preview object during a gesture. Use persistent base transforms and evaluated start transforms to remove procedural motion from committed edits. Show transform drafts in the property editor. Commit once on release with the revision captured at gesture start. Escape, pointer cancellation, focus loss, changed revision or selection cancel without an edit. A failed commit returns to authoritative state and reports an error. No mutation replay.

Expose position, Euler rotation in degrees, positive scale, per-row reset and visibility in property rows. Numeric labels support horizontal scrubbing; ordinary input stays available. Panel borders support pointer capture, keyboard adjustment, bounded sizes and cancellation. Right-click menus support object tools, visibility and transform reset; cameras can become the active output camera. Menus support Escape, arrow navigation, Enter, focus return and viewport-edge placement. Shared kit lacks a context-menu primitive; use shared Button/Input and a small local menu.

The editor close button hides its window. The scene Editor button or Escape reopens it. Escape cancels an active scene gesture or editor interaction before it performs another action. Closing the scene owner exits the app. One worker remains in the scene owner. The editor window has only an operator connection and renderer output descriptor for clipboard copying. It cannot invoke bootstrap_session or shutdown_session. Production renderer output_main never enables interaction helpers. Read-only operator capabilities disable editing.

## Entities

EditorTool = 'translate' | 'rotate' | 'scale'. EditorTransformEdit = {entityId: Id; expectedRevision: number; transform: Transform}. EditorViewportState = {scene: SceneView | null; selectedId: Id | null; tool: EditorTool; enabled: boolean}.

RendererOptions.editor?: {onSelect(id: Id | null): void; onCommit(edit: EditorTransformEdit): Promise<Reply<{revision: number}>>; onDraft?(draft: {entityId: Id; transform: Transform} | null): void}. RendererHandle.editor?: {sync(state: EditorViewportState): void; cancel(): void}. Reject editor options unless outputId is preview_main and diagnostics is false. No engine object is exposed.

EditorModel gains setTransform(entityId, transform, expectedRevision?) and clearSelection(). Validate TransformSchema before transport. An explicit revision cannot be silently replaced by a newer model revision. Existing methods keep their signatures.

NativeEditorConnection = {operator: ConnectionDescriptor; output: ConnectionDescriptor; assets: AssetRecord[]; rendererMode: 'auto'|'force-webgl2'}. editor_connection returns this projection from the already-started service. Only main can bootstrap/shutdown. editor can call editor_connection/app_version. Both are local application windows. Use fixed-target show_editor (main caller only) and hide_editor (editor caller only) commands. Do not grant generic window hide/show/focus commands to the editor. Enforce caller labels in native commands as well as generated ACL.

UI event payloads contain selection, tool or transform drafts and a sync signal. Validate them, keep payloads small and coalesce draft notifications to at most20Hz. They never carry publisher descriptors or evaluated pose streams. Commits use the existing operator WebSocket API.

## Approach

Use three.js TransformControls in the existing retained preview scene. Keep the render queue and native wake clock unchanged. Persistent mutation remains in the scene worker through scenePatch. Keep two operator models synchronized by existing inspection plus small Tauri UI events. The secondary editor has no renderer or worker. Use Tauri static window definitions and narrowly scoped capabilities.

## Structure

Renderer lane owns packages/renderer/src/editor-viewport.ts, transform-edit.ts, renderer.ts, index.ts and scoped tests. UI lane owns Inspector.svelte, Hierarchy.svelte, ContextMenu.svelte, ResizeHandle.svelte, TransformFields.svelte, editor/interaction.ts and scoped tests. Native lane owns native editor projection, window setup, capabilities and focused tests. Root owns App.svelte, EditorApp.svelte, main.ts, bootstrap.ts, editor/model.ts, UI event bridge, app.css and integration tests/docs.

## Operations

1. Commit this contract and plan. Create isolated implementation lanes from that checkpoint.
2. Add pure transform/cancellation tests before renderer editor integration. Add stale explicit revision tests before model changes.
3. Implement editor controls and native connection projection independently. Review each lane before integration.
4. Compose the two windows with one worker. Integrate UI bridge, capability-aware tools and exact pointer/keyboard controls.
5. Run workspace checks and focused tests. Build release from current source, launch outside checkout, test copying the URL without logging it, scene selection, W/E/R dragging, scrub fields, reset, menus, cancellation, resizing, editor hide/reopen and OBS changes.
6. Run a targeted minimized smoke test since preview renderer composition changes. Preserve prior timing source attribution. Record current source, captures and parity scope; checkpoint locally.

## Norms

Follow the product constitution and frontend-design skill. Use pnpm, Svelte5, functional TypeScript, @oshi-connect/ui and existing Lucide icons. Do not edit the sibling UI kit or add a second primitive library. Use tests for math and state transitions. Native integration tests protect the actual projection/ACL boundary. Verify real flows through computer-use and OBS. Do not publish or stream.

## Safeguards

Keep renderer objects/camera retained; no new per-frame gizmo construction. Dispose controls/listeners/helpers before renderer resources. Cancel selection changes and external revisions. Validate finite transform values, normalized quaternions and positive scale. Limit one edit per gesture. Clear draft state on failure and disconnect. Clean owned OBS objects and restore the previous scene. Never log bearer URLs or clipboard contents. Do not claim minimum hardware, concert performance, graph support or full Warudo parity from this slice.

## Refresh behavior refinement

Background scene inspection uses a private loading flag. It does not disable active controls when a scene is already loaded. An older inspection reply cannot replace a newer revision. Equal identity, revision and authoritative transform snapshots preserve ordinary typed drafts. Displayed viewport drafts are separate from the authoritative base used to cancel property scrubs.

The local UI bridge accepts only bounded selection, tool, transform draft, refresh and ready messages. Drafts have one active send and one latest pending value, at no more than20 sends per second. The preview canvas keeps a16:9 pointer rectangle inside the scene window.
