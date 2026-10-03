# REASONS: Live editor controls

## R — Requirements

Implement the user's requested sidebar controls and live transform fields in the existing Warudo-style editor. Group by cameras, characters, props and individual receiver/tracker types. Omit empty groups, preserve scene order inside a group and keep collapsed state local. Search includes hidden assets and keeps matching groups visible. Direct row eye controls change entity.visible and do not delete assets or stop receiver sockets. Hidden assets remain selectable. Camera row buttons use the existing validated camera selection for output_main and preview_main and show the current output camera. Actions do not select another asset. All actions work by keyboard with accessible names.

Valid position, rotation and positive scale numeric input is applied as it changes; there is no Apply requirement. Scrubbing and row reset use the same authoritative live path. Renderers, including OBS, receive committed edits as evaluated frames. Empty, partial, nonfinite or invalid values remain local and cannot corrupt the scene. One active commit and one latest pending transform are allowed, paced to at most one offer flush per16ms. A burst ends at its last valid value. Edits use current scene revisions and stop on failure, selection change or external conflicting changes. Normal mutations remain locked while a live transform commit is active; transform input itself stays usable. Dispose clears unsent work. A command already sent can complete but cannot start further work after disposal.

## E — Entities

AssetGroup = {key:string;label:string;entities:SceneEntity[]}. EditorView has a transformPending boolean in addition to pending so live fields can remain enabled during their own commits. LiveTransform coordinator accepts {entityId,transform}, retains at most one pending edit and captures the expected revision. Its dependency is the existing EditorModel read/subscribe/setTransform API. It exposes offer, cancel and close, plus error and pending-state callbacks. Pending covers active and queued work so a field cannot reset to an earlier acknowledgement. Authoritative scene IDs and camera IDs remain unchanged.

## A — Approach

Derive groups with a pure helper. Render native collapsible sections with shared Button controls for the primary row, eye and camera action. Keyboard navigation targets asset selection buttons only and follows visible grouped order. Do not use nested buttons. Use the entity visibility and current output camera to render state.

Create a bounded coordinator separate from component markup. Coalesce before the first send, retain only the latest edit during an active commit, then advance its expected revision only when the successful own commit matches the inspected authoritative transform within1e-9 component tolerance for transport float rounding. Scene revision must still match exactly; numerical tolerance cannot permit a newer external revision. An external revision change, command failure or changed selection cancels pending work rather than overwriting newer state. Validation stays in existing contract schemas and editor model. Transform fields preserve in-progress input across their own acknowledgements; external failures restore authoritative values. Numeric values build one complete transform from current field values so rapid edits on different axes are retained. No speculative transform is broadcast to OBS.

## S — Structure

Root owns editor/model.ts, editor/live-transform.ts, TransformFields.svelte, Inspector.svelte, EditorApp.svelte and their tests. The sidebar task owns editor/asset-groups.ts, Hierarchy.svelte and asset-groups tests. Root owns specs, plan, final merge, dependencies, private scene recovery and actual app/OBS verification. No shared schema or native feature change is required.

## O — Operations

1. Record this contract and plan. Save a private current scene snapshot before restart.
2. Write failing pure grouping and bounded-coordinator tests. Verify coalescing, latest-value retention, validation, disposal, external conflict and selection cancellation.
3. Implement grouped sidebar visibility/camera actions and keyboard navigation.
4. Implement live fields and coordinator with bounded command flow. Verify no Apply requirement and no field disabling during own commit.
5. Run focused tests and workspace checks. Build a release with embedded source. Restore the user's scene through validated APIs.
6. Verify actual sidebar hide/show, grouping/search/collapse, camera activation and numeric/scrub/reset changes in preview and clean OBS. Record captures and edit-to-frame evidence without claiming a concert benchmark.
7. Update parity and evidence, clean owned OBS resources and commit a checkpoint.

## N — Norms

Use Svelte5, @oshi-connect/ui, pnpm and existing Lucide icons. No new dependencies, card grids, redundant helper text or badges. Keep the light utilitarian editor layout and current context menus. Tests cover pure logic and meaningful boundaries, not labels. Keep private avatar, phone address, descriptors and captures out of Git. Keep the agent rooted in ai-native and use the product worktree for Git.

## S — Safeguards

Do not reset the user's current scene. Do not stop native receivers solely because an asset is hidden. Failed visibility/camera/transform commands retain visible error state. Never resend a stale absolute transform after an external conflict. Never send every pointer event or create an unbounded queue. Never start streaming or change existing OBS settings. Continuous background webcam, saved projects, Windows and concert performance are separate checklist work.
