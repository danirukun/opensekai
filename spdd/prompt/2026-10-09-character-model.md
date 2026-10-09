# REASONS: Character model

Date: 2026-10-09. Scope: characters as normal scene assets. Analysis: [character model](../analysis/2026-10-09-character-model.md).

## R — Requirements

R1. The Assets panel **Add** menu has a **Character** item. It creates an avatar entity with the name `Character` (or `Character N` when the name exists), `assetId: null`, no tracking sources, and the built-in idle animation enabled. The panel has no separate Import button.
R2. The avatar schema accepts `assetId: Id | null` in TypeScript (zod) and Rust. The key is required. An existing show with a string `assetId` validates without change.
R3. A scene operation `setAvatarModel { entityId, assetId: Id | null }` sets the model of an avatar. It fails with `INVALID_INPUT` for an entity that is not an avatar, and with `NOT_FOUND` for an unknown entity.
R4. The Inspector shows a **Model** row for an avatar. The control shows the asset name, `Choose VRM…` when `assetId` is null, and `Missing model` when the asset ID is not in the editor asset list. Activation opens the native VRM picker (`import_avatar`). A selected file sends `setAvatarModel` with the imported asset ID. A cancelled picker makes no change. An import failure shows the existing footer error.
R5. `AssetRecord` has a required `name` string of 1 to 128 UTF-16 code units, in TypeScript and Rust. Import takes it from `VRMC_vrm.meta.name`, then `VRM.meta.title`, then the file stem. A library record without `name` gets it from the VRM meta of its stored `.vrm` file at load, then `Avatar`, because the original file name is unknown. The registry writes the record back.
R6. The renderer creates no object for an avatar with `assetId: null`. When `assetId` changes, the renderer releases the old model and loads the new one.
R7. Show save and open accept a character with no model.
R8. The Resources panel shows the asset name instead of the asset ID.

## E — Entities

- `SceneEntity` (avatar): `assetId: Id | null`.
- `ScenePatch` operation: `setAvatarModel { kind, entityId, assetId }`.
- `AssetRecord`: adds `name`.
- Editor: `makeCharacter(id, entities)` replaces `makeImportedAvatar`.

## A — Approach

Change the contract first, in TypeScript and Rust together, with shared validation vectors. Then change session scene operations, the renderer, the native registry, and the editor UI. Reuse the existing `import_avatar` command. Keep the operation in the same validated command path for the editor and MCP.

## S — Structure

- `packages/contracts/src/schema.ts`, `types.ts`; `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`; `fixtures/smoke/manifest.json`.
- `packages/session/src/scene-ops.ts`.
- `packages/renderer/src/renderer.ts`.
- `apps/desktop/src-tauri/src/assets/registry.rs`.
- `apps/desktop/src/editor/authoring.ts`, `model.ts`, `live-fields.ts`; `components/Hierarchy.svelte`, `Inspector.svelte`, `AvatarSourceFields.svelte`, `AssetList.svelte`; `EditorApp.svelte`.
- `docs/warudo-parity.md` and an evaluation note.

## O — Operations

1. Contracts: nullable `assetId`, `setAvatarModel`, and `AssetRecord.name` in TypeScript and Rust. Add validation vectors and contract tests.
2. Session: apply `setAvatarModel`. Add a scene-operations test.
3. Renderer: skip a character with no model, and replace the model on change. Add renderer tests.
4. Native registry: store `name` at import and fill it for records that have none. Add Rust tests. Update the fixture manifest.
5. Editor: Add › Character, the Model row, removal of Import, and asset names in Resources. Add editor model tests.
6. Verify in the running macOS app: add a character, choose the Rem VRM, replace it with a second VRM, save the show, open it, and check the OBS output. Record evidence and parity.

## N — Norms

Use `@oshi-connect/ui` controls. Keep UI copy to the control labels in R4. Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript.

## S — Safeguards

- Do not make `assetId` optional; it stays a required nullable key so that the Rust shape check stays strict.
- Do not render a placeholder for a character with no model.
- Do not add a second import path or expose file import to MCP.
- Do not change existing show documents on load.
- The registry must not fail to load because one legacy record has no name; it uses the VRM meta and then `Avatar`.
