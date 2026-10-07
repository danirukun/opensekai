# REASONS: Scene show management slice

Date: 2026-10-07. Scope: SCN-05 partial, BP-01/BP-02 persistence subset.

## R — Requirements

R1. Define a bounded version-1 show document with name, scene, and zero or one Blueprint graph.
R2. Save the current authoritative scene and graph through a native Save As chooser and atomic replacement.
R3. Open only a fully valid show. A canceled or failed open leaves the current scene and draft untouched.
R4. Replace scene state through an edit-capability, revision-checked command without restarting renderer clients or resetting stream sequence.
R5. Preserve scene entities whose asset IDs are unavailable locally. Reject invalid camera/output references.
R6. Keep one graph in the editor after Open and allow its Manual Trigger to run against restored entity IDs.

## E — Entities

`ShowDocument` contains `schemaVersion: 1`, a trimmed name, a `SceneView`, and an array of at most one `BlueprintGraph`. `SceneReplaceParams` contains a scene snapshot and the current expected revision. Its result is the accepted scene snapshot. A file path is local UI state and is not part of a scene or graph.

## A — Approach

Validate the show in TypeScript before Save and after Open. Validate scene and show envelope in Rust before disk operations. Use a native dialog and same-directory temporary file for atomic replacement. Add `sceneReplace` to the existing operator API and session worker. The worker keeps its clock and client connection, commits the loaded scene at the next revision, and resets tracking composition. The editor adopts the loaded graph after command success.

## S — Structure

Add a show contract in `packages/contracts`, a session replacement operation in `packages/session`, matching Rust validation in `crates/contracts`, native file commands in `apps/desktop/src-tauri`, and a small Show menu in the desktop editor. Keep the current Rete adapter as the graph serializer.

## O — Operations

1. Add show and `sceneReplace` schemas, capability checks, and boundary tests.
2. Implement revision-checked replacement in the worker and test output continuity and missing references.
3. Implement bounded native Save As/Open with atomic replacement and file-boundary tests.
4. Connect editor Show actions to a fresh scene snapshot and current graph; check the path in the running macOS app.
5. Update parity, evidence, and linked issue status for only the verified subset.

## N — Norms

Use pnpm, Svelte 5, `@oshi-connect/ui`, and Tauri v2. Keep platform file operations behind native commands. Keep all graph and scene identifiers stable in files. Do not send rendered frames through IPC.

## S — Safeguards

Limit show files to 256 KiB. Validate the full document before scene replacement. Reject newer schema versions. Require edit capability for `sceneReplace`. On write failure, leave the existing file intact. On load failure or stale revision, leave the current scene and editor graph intact. Preserve missing asset IDs as repairable references.
