# Scene Show Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save and reopen a show with its scene and one Blueprint, while keeping missing asset references.

**Architecture:** A versioned JSON contract joins `SceneView` with one optional graph. Tauri owns native file dialogs and atomic disk writes. A revision-checked session command replaces scene state without restarting renderer connections; the editor adopts the loaded graph after that command succeeds.

**Tech Stack:** TypeScript, Zod, Svelte 5, Tauri v2, Rust, Vitest, Cargo.

**Spec:** [Scene show management design](../specs/2026-10-07-scene-show-management-design.md) and [REASONS contract](../../../spdd/prompt/2026-10-07-scene-show-management.md).

## Global Constraints

- Version 1 stores a name, one `SceneView`, and at most one `BlueprintGraph` in 256 KiB.
- `sceneReplace` requires edit capability and the current scene revision.
- Keep output connections, frame sequence, and monotonic clock alive during Open.
- Preserve unavailable asset IDs in entities; reject invalid output cameras.
- Use the existing Svelte UI kit and Tauri file boundary. Do not stream rendered images through IPC.

## Review Focus

- A newer or malformed show returns an error before scene state changes.
- A stale expected revision returns `CONFLICT` and keeps the current scene.
- A canceled chooser returns null and keeps the current scene and graph.
- A failed atomic write preserves the previous show file.
- A missing avatar asset ID survives Open and appears as a repairable scene entity.

### Task 1: Show and replacement contracts

**Files:** `packages/contracts/src/show.ts`, `packages/contracts/src/schema.ts`, `packages/contracts/src/types.ts`, `crates/contracts/src/lib.rs`, contract tests.

**Interfaces:** `ShowDocumentSchema`; `sceneReplace({scene, expectedRevision}): Reply<SceneView>`.

- [x] Add a failing TypeScript contract test: a show with two graphs, unsupported version, or invalid output camera fails; one graph with a missing `assetId` passes.
- [x] Add the strict show schema and `sceneReplace` method; include it in method validation and the edit capability set.
- [x] Add Rust call/result validation for `sceneReplace` using existing `SceneView::validate` and a revision parameter. Run contract tests.

### Task 2: Authoritative scene replacement

**Files:** `packages/session/src/session.ts`, `packages/session/src/worker.ts`, `packages/session/test/show-replace.test.ts`, editor model test.

**Interfaces:** `Session.replaceScene(scene, expectedRevision): Reply<SceneView>`.

- [x] Add a failing test: replace after one frame, then advance again; tick and sequence increase, scene ID and entities change, missing asset ID remains, and stale revision fails.
- [x] Implement replacement by validating the new scene, checking the current revision, assigning the next revision, and resetting tracking composition. Route the call from the worker.
- [x] Update the editor model to accept the returned scene directly and clear a selection missing from it. Run session and editor tests.

### Task 3: Native bounded file store

**Files:** `apps/desktop/src-tauri/src/show.rs`, `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/capabilities/editor.json`, native module tests.

**Interfaces:** `save_show_as(document)` and `open_show()` Tauri commands; both return `None` on chooser cancel.

- [x] Add file-boundary tests: valid round trip, invalid version/content rejection, and an existing target survives an invalid replacement. The 256 KiB budget is validated by the codec.
- [x] Implement a 256 KiB read limit, native file chooser, same-directory temporary write, `sync_all`, and atomic persist. Register commands and editor-only permissions.
- [x] Run focused Cargo tests and confirm only the editor window can call the file commands.

### Task 4: Editor Save As and Open flow

**Files:** `apps/desktop/src/EditorApp.svelte`, `apps/desktop/src/components/BlueprintPanel.svelte`, `apps/desktop/src/editor/model.ts`, UI tests and evidence.

**Interfaces:** Editor show actions call `sceneInspect`, `save_show_as`, `open_show`, and `sceneReplace`; the Blueprint panel exposes its current plain graph.

- [x] Verify Save As/Open orchestration in the native editor: a graph and scene round-trip, cancel leaves state intact, and failed replacement does not adopt a new graph. Contract, model, and native tests cover the separate boundaries.
- [x] Add compact Open and Save As controls. Validate before native save and before scene replacement. Show concise errors. Preserve the graph if Open fails.
- [x] Run sequential package checks, unit/integration tests, desktop build, Rust workspace tests, formatting, and strict Clippy. In macOS Tauri, save a scene with an entity and Blueprint, reopen it, run the Blueprint, and verify the restored entity and an unresolved avatar reference. Record remaining gaps in SCN-05/BP-01/BP-02 evidence.
- [x] Produce and launch a release macOS bundle through `pnpm build:mac`. The app reached Session connected and an enabled Save As dialog. The script disables symbol stripping to avoid malformed generated Rust proc-macro dylibs on this host.
