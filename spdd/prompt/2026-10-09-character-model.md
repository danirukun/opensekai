# REASONS: Character model

Date: 2026-10-09. Scope: characters as normal scene assets, background model loading, and load status. Analysis: [character model](../analysis/2026-10-09-character-model.md).

## R — Requirements

R1. The Assets panel **Add** menu has a **Character** item. It creates an avatar entity with the name `Character` (or `Character N` when the name exists), `assetId: null`, no tracking sources, and the built-in idle animation enabled. The panel has no separate Import button.
R2. The avatar schema accepts `assetId: Id | null` in TypeScript (zod) and Rust. The key is required. An existing show with a string `assetId` validates without change.
R3. A scene operation `setAvatarModel { entityId, assetId: Id | null }` sets the model of an avatar. It fails with `INVALID_INPUT` for an entity that is not an avatar, and with `NOT_FOUND` for an unknown entity.
R4. The Inspector shows a **Model** row for an avatar. The control shows the asset name, `Choose VRM…` when `assetId` is null, and `Missing model` when the asset ID is not in the editor asset list. Activation opens the native VRM picker (`import_avatar`). A selected file sends `setAvatarModel` with the imported asset ID. A cancelled picker makes no change. An import failure shows the existing footer error.
R5. `AssetRecord` has a required `name` string of 1 to 128 UTF-16 code units, in TypeScript and Rust. Import takes it from `VRMC_vrm.meta.name`, then `VRM.meta.title`, then the file stem. A library record without `name` gets it from the VRM meta of its stored `.vrm` file at load, then `Avatar`, because the original file name is unknown. The registry writes the record back.
R6. The renderer creates no object for an avatar with `assetId: null`. When `assetId` changes, the renderer keeps the old model visible until the new model is ready (R9), then replaces it in one frame and releases the old model.
R7. Show save and open accept a character with no model.
R8. The Resources panel shows the asset name instead of the asset ID.
R9. Frame submission does not wait for a model load. The renderer starts one background load job for each entity and asset pair, renders the frame without that model, and adds the model in the first frame after the job is complete. This applies to avatars and asset meshes, in the preview and in the OBS output.
R10. A load job prepares GPU pipelines for the new model (`compileAsync`) before the model joins the scene. If the entity is removed, or its asset changes, before the job is complete, the renderer disposes the result and does not add it.
R11. The renderer reports load status through `onLoadStatus(listener)`. Each entry has `entityId`, `assetId`, `stage`, and `progress`. The stages are `download`, `textures`, `prepare`, and `failed`. `progress` is a number from 0 to 1 when the stage has a known total, else `null`. Download progress uses the response byte count and `Content-Length`. Texture progress uses decoded images against the GLB image count. A `failed` entry has an error message. A complete job leaves the list. `ResourceHost.readAsset` accepts an optional progress callback.
R12. The Scene window shows a centered overlay card over the preview while the list has entries. Each row shows `Loading <character name>`, the stage line (`Downloading`, `Textures 12 of 24`, `Preparing`, or the error), and a progress bar. The bar is determinate when `progress` is known, else indeterminate. A failed row has a **Dismiss** control. A new asset for the entity also removes the failed row. The overlay is DOM outside the canvas, so it is not in captures. The OBS output has no overlay.
R13. The Scene window sends the load status to the editor through the UI bridge. The editor Model row shows the same stage line and bar. The character's Assets row shows a spinner in place of its icon while a job runs. During the native import, the Model row shows `Importing…` with an indeterminate bar.

## E — Entities

- `SceneEntity` (avatar): `assetId: Id | null`.
- `ScenePatch` operation: `setAvatarModel { kind, entityId, assetId }`.
- `AssetRecord`: adds `name`.
- `AssetLoadStatus`: `{ entityId, assetId, stage: 'download' | 'textures' | 'prepare' | 'failed', progress: number | null, count?: { done, total }, message?: string }`. `count` carries the texture numbers for the `Textures 12 of 24` line. Renderer and editor local; not a protocol type.
- `RendererHandle`: adds `onLoadStatus(listener)` and `dismissLoad(entityId)`. The Scene overlay **Dismiss** control calls `dismissLoad`.
- UI bridge message: `{ kind: 'loadStatus', entries: AssetLoadStatus[] }`.
- Editor: `makeCharacter(id, entities)` replaces `makeImportedAvatar`.

## A — Approach

Change the contract first, in TypeScript and Rust together, with shared validation vectors. Then change session scene operations, the native registry, the renderer, and the editor UI. Reuse the existing `import_avatar` command. Keep the operation in the same validated command path for the editor and MCP.

In the renderer, separate loading from frame submission. A load job table, keyed by entity ID, holds the asset ID, the job promise, and the status. `submit` reconciles the table with the frame: it starts jobs, cancels stale jobs, and installs complete results. The job reports status as it goes. The Scene window owns the overlay and forwards the status to the editor.

## S — Structure

- `packages/contracts/src/schema.ts`, `types.ts`; `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`; `fixtures/smoke/manifest.json`.
- `packages/session/src/scene-ops.ts`.
- `packages/browser-client/src/client.ts` (download progress).
- `packages/renderer/src/renderer.ts`, `assets.ts`, and a new `load-jobs.ts` for the job table and status.
- `apps/desktop/src-tauri/src/assets/registry.rs`.
- `apps/desktop/src/App.svelte`, `bootstrap.ts`, and a new `components/LoadOverlay.svelte` (Scene window).
- `apps/desktop/src/editor/authoring.ts`, `model.ts`, `live-fields.ts`, `ui-message.ts`; `components/Hierarchy.svelte`, `Inspector.svelte`, `AvatarSourceFields.svelte`, `AssetList.svelte`; `EditorApp.svelte`.
- `docs/warudo-parity.md` and an evaluation note.

## O — Operations

1. Contracts: nullable `assetId`, `setAvatarModel`, and `AssetRecord.name` in TypeScript and Rust. Add validation vectors and contract tests.
2. Session: apply `setAvatarModel`. Add a scene-operations test.
3. Native registry: store `name` at import and fill it for records that have none. Add Rust tests. Update the fixture manifest.
4. Browser client: report download progress from `readAsset`. Add a test.
5. Renderer: background load jobs, GPU preparation, swap on ready, stale-result disposal, and `onLoadStatus`. Add unit tests with a controllable fake loader.
6. Scene window: the load overlay and the UI bridge status message.
7. Editor: Add › Character, the Model row with status, the Assets row spinner, removal of Import, and asset names in Resources. Add editor model tests.
8. Measure in Safari that a model load does not stall frames after `compileAsync`. Record the result; if a stall remains, record it as a residual risk.
9. Verify in the running macOS app: add a character, choose the Rem VRM, watch the overlay stages while the preview moves, replace the model with a second VRM, save the show, open it, and check that the OBS output keeps rendering without an overlay. Record evidence and parity.

## N — Norms

Use `@oshi-connect/ui` controls. Keep UI copy to the labels in R4, R12, and R13. Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript.

## S — Safeguards

- Do not make `assetId` optional; it stays a required nullable key so that the Rust shape check stays strict.
- Do not render a placeholder for a character with no model.
- Do not add a second import path or expose file import to MCP.
- Do not change existing show documents on load.
- The registry must not fail to load because one legacy record has no name; it uses the VRM meta and then `Avatar`.
- Do not put the overlay or any status text in the canvas, captures, or the OBS output.
- Send load status over the UI bridge only when a stage changes, and send progress changes at most 5 times per second. Do not send image data or per-frame status.
- Do not let a stale or cancelled job add a model or leak GPU resources.
- Do not claim that GPU preparation removes the first-frame stall unless the Safari measurement shows it.
