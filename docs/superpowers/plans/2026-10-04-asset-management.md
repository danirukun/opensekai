# Asset Management Implementation Plan

> Use the existing user-authorized execution method: bounded parallel work after shared contracts, with an integrator owning schemas and final checks.

**Goal:** Complete the scoped create, rename, duplicate and remove workflow on macOS.

**Architecture:** Session operations own rename and remove. Copy preparation calls createEntity. All edits use revisions and the existing selection bridge.

**Tech Stack:** TypeScript, Svelte 5, Rust, Tauri v2, shared UI.

**Spec:** spdd/prompt/2026-10-04-asset-management.md

## Constraints and review focus

No new dependency. Keep existing scene budgets. Copies must not activate tracking or share mutable settings. Removing a source must clear both performer references. Referenced cameras must remain. Stale commands and invalid names must be atomic. Context actions must respect pending/read-only state; text entry must not trigger scene shortcuts.

## Tasks

- [x] Contracts: add renameEntity and removeEntity to TS types/schema. Test strict shapes, blank/long names and accepted trimmed names. Native owner adds matching Rust variants, validation and roundtrip tests in a separate worktree after interface checkpoint.
- [x] Session: test rename, deletion, source repair, referenced-camera rejection, stale revision and rollback in packages/session/test/asset-management.test.ts. Add switch cases in session.ts. Commands use {kind:'renameEntity',entityId,name} and {kind:'removeEntity',entityId}.
- [x] Editor logic: implement makeEntityCopy(entity,id,entities) in editor/asset-management.ts; clone, unique name, disabled tracker and cleared avatar assignments. Test settings isolation and name collisions. Add model renameEntity/removeEntity/duplicateEntity, revision validation and selection handling.
- [x] UI: extend Hierarchy.svelte menus and inline name input. Enter commits; Escape/blur cancel. Pass selection/clear changes to Scene from EditorApp. Show command errors in the existing footer. Check current menus and keyboard navigation remain usable.
- [x] Renderer resource fix: share immutable texture data for repeated VRM instances with safe disposal. Test independent rig/material state and retained textures after one instance is removed. Reproduce the native memory failure and verify the repeated-copy path.
- [x] Verification: run focused tests then unit/integration/check/native/fmt/Clippy and build:mac. Use actual native UI to rename/duplicate/remove temporary assets, verify camera guard and source cleanup. Check OBS, restore the original scene, add bounded evidence and update SCN-01.

Accepted source `dca1d16`; see docs/evaluation/asset-management.md for failures, corrections, acceptance limits and restoration. Save/load is the next slice.
