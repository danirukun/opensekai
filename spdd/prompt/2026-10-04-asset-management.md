# REASONS: Asset management

## R — Requirements

Add Rename, Duplicate and Remove to each asset context menu. Rename uses an inline input, Enter commits, Escape cancels, and blur cancels. Names are trimmed, nonempty and at most 128 UTF-16 code units. Invalid names leave the scene unchanged. Existing names are not migrated.

Duplicate creates a new ID and a unique name using “Copy” then “Copy 2”, “Copy 3”. Copy persistent type settings and transforms without shared references. Tracking copies start disabled with generation zero before session creation assigns a new generation. Avatar copies have null body and face assignments. Copying a camera does not change output selection. Multiple instances of the same VRM must share immutable decoded texture resources within each renderer while rig, expression and material state remain independent. Reference-count shared resources so removal cannot damage another instance. Bound decoded texture size to 1024 pixels on the preview and 2048 pixels on production output, preserving aspect ratio and source files. Apply resizing before GPU upload and before shared canonical image resolution. Permit at most two image decode/resize jobs in flight per renderer loader. Small images remain unchanged. Resize failure must release the original decoded image and report UNSUPPORTED rather than silently changing material content. User texture-quality overrides remain a later slice. Existing two-avatar, four-source and 64-entity limits apply.

Remove deletes one entity. Removing a tracking source clears all matching avatar body and face references atomically. Reject removal of any camera referenced by an output. UI disables that action with a title that says to choose another output camera. Prepared assets and files are retained. Reconciliation releases removed ECS IDs and packed transform storage. Selection clears after deletion; duplication selects the new entity. All operations use expectedRevision and common scenePatch. If appStatus reports a lower authoritative revision after owner reload, the editor must accept a fresh inspection and clear invalid selection/drafts. Older inspections from before that reset must not replace the new snapshot. Normal out-of-order responses remain rejected. Read-only, pending and live transform states disable actions.

## E — Entities

Existing SceneEntity and SceneView. New operations renameEntity {entityId,name} and removeEntity {entityId}. Duplicate uses createEntity. Editor helpers prepare copies; session operations enforce state and references.

## A — Approach

Extend TypeScript and Rust patch contracts. Keep copy preparation in a pure desktop editor module. Add editor model rename/remove/duplicate methods. Session removal repairs only source assignments; camera reference failure is atomic. Reuse ContextMenu and shared Input. Preserve the separate Scene/Editor selection bridge after copy/removal.

## S — Structure

contracts types/schema and Rust enum/validation; session applyPatch; desktop editor asset-management.ts and model.ts; Hierarchy.svelte and EditorApp.svelte; focused unit tests; native contract tests; renderer texture lifetime tests; actual packaged UI and OBS checks.

## O — Operations

1. Add contract variants and focused schema tests.
2. Add session rename/remove tests, then implementation. Verify atomic failure and tracking reference cleanup.
3. Add copy helper and model tests, then implementation.
4. Add sidebar menu actions and inline input. Handle selection bridge and local error display.
5. Fix the measured duplicate-VRM memory limit through bounded shared resource lifetimes and verify surviving instances after removal.
6. Run checks, native tests, format, Clippy and macOS build. Check actual UI and OBS, restore original scene, update parity and checkpoint.

## N — Norms

Use functional TypeScript, Svelte 5 and the shared UI kit. No new packages. Keep original user assets private. Unit tests cover pure state and copy logic; actual UI checks cover interaction. Keep the agent rooted in ai-native. Use isolated worktrees for any concurrent implementer.

## S — Safeguards

No deletion of prepared files, no tracking activation during copy, no unexpected source sharing, no dangling source references, no output interruption from referenced-camera removal. Invalid/stale operations leave the revision unchanged. Test long/blank names, duplicate name collisions, scene limits and stale IDs. No public push or stream. Save/load, undo and manual groups remain open.
