# REASONS: Character Debug section

Date: 2026-11-20. Scope: owner request on the lilToon on WebGPU branch. Analysis: [character Debug section](../analysis/2026-11-20-character-debug-section.md). Related: [Inspector reset and section index](2026-10-20-inspector-reset-and-index.md), [lilToon on WebGPU](2026-11-19-liltoon-webgpu.md).

## R — Requirements

R1. The Inspector of an avatar entity with a model shows a last section, Debug, after Tracking. An avatar with no model has no Debug section.
R2. Debug starts collapsed for each user. It shows expanded only after the user expands it, and that choice is kept in `opensekai.inspector.sections` as an item of the optional list `opened`. A stored state with no `opened` list gives Debug collapsed.
R3. Debug shows the data of the loaded file of the avatar. When the renderer has no data for the asset (still loading, failed, or not loaded), Debug shows nothing but the Copy button, disabled.
R4. **File:** the VRM version (`1.0` from `VRMC_vrm.specVersion`, `0.x` for the `VRM` extension, else none), the generator, the glTF version, the size, and the sha256 of the asset record.
R5. **Extensions:** each name of `extensionsUsed`, in file order. A name that is also in `extensionsRequired` is marked required.
R6. **Meta:** the scalar fields and the string-array fields of `VRMC_vrm.meta` or `VRM.meta` (for example name, authors, license). Arrays join with a comma. Objects are left out.
R7. **Counts:** nodes, meshes, primitives, materials, textures, images, skins, joints (unique), humanoid bones, expressions, spring bones (VRM 1 springs or VRM 0 bone groups), spring colliders, node constraints, and animations.
R8. **Materials:** a picker of the materials of the file. For the picked material: the profile and unsupported features of the material report, the extension names, the alpha mode, the cull (`Off` when double sided, else `Back`), and for a lilToon material its spec version, lilToon version, shader variant, and render queue.
R9. **Properties:** the material properties as name and value rows: the core glTF fields, the fields of each material extension (nested keys joined with `.`), the lilToon `properties` (as their own names, for example `_Cutoff`), and the VRM 0 `materialProperties` (floats, vectors, keywords, tags). A search field filters the rows by name, case-insensitive.
R10. **Textures:** each texture slot of the picked material, with the image name, the MIME type, the bytes in the file, the decoded size (width × height), and the color space. The size and color space come from the live material. A slot with no live texture shows no size or color space.
R11. **Warnings:** the load warnings of this asset.
R12. **Copy:** one button copies the JSON of all shown data (all materials, not only the picked one) to the clipboard.
R13. **Bounds:** at most 64 extensions, 32 meta rows, 256 materials, 1024 property rows and 32 texture slots for each material, and 64 warnings. A string and a property path are cut to 256 characters, another name to 64.

## E — Entities

- `ModelInfo = { format: { vrm: string | null; generator: string | null; gltf: string | null }; extensions: { name: string; required: boolean }[]; meta: Row[]; counts: { key: string; value: number }[]; materials: MaterialInfo[] }`, `Row = { name: string; value: string }`.
- `MaterialInfo = { index; name; profile; unsupported: string[]; extensions: string[]; alphaMode: string; cull: 'Off' | 'Back'; lilToon: { specVersion: string | null; lilToonVersion: string | null; shaderVariant: string | null; renderQueue: number | null } | null; properties: Row[]; textures: TextureSlot[] }`, `TextureSlot = { slot: string; image: number | null; name: string; mimeType: string; bytes: number | null }`.
- `LiveTexture = { material: number; slot: string; width: number; height: number; colorSpace: string }`.
- `AssetDebug = { info: ModelInfo; textures: LiveTexture[]; warnings: AppError[] }`.
- `modelInfo(json: unknown): ModelInfo` in `packages/contracts/src/model-info.ts` (pure).
- `RendererHandle.modelInfo(assetId: string): AssetDebug | null`.

## A — Approach

The pure function reads the GLB JSON that the loader already parses. The loader adds the info, the live textures, and its warnings to its result. The renderer keeps the last result for each asset and gives it on request. The Editor reads it when the selected avatar or the load list changes.

## S — Structure

- `packages/contracts/src/model-info.ts` (new), `packages/contracts/src/index.ts`, `packages/contracts/test/model-info.test.ts` (new).
- `packages/renderer/src/assets.ts` (info and live textures), `packages/renderer/src/renderer.ts` (`modelInfo`).
- `apps/desktop/src/bootstrap.ts`, `apps/desktop/src/EditorApp.svelte`, `apps/desktop/src/components/Inspector.svelte`, `apps/desktop/src/components/AvatarDebugFields.svelte` (new).
- `apps/desktop/src/editor/inspector-sections.ts` and its test.
- `ARCHITECTURE.md`, `docs/handbook/characters.md`.

## O — Operations

1. `modelInfo` with unit tests: a VRM 1 file and a VRM 0 file give the version, meta, and counts; required marks; core and extension properties and the lilToon properties; texture slots with image name, MIME, and bytes; the bounds of R13.
2. Section state: `opened`, Debug last for an avatar with a model, Debug collapsed with an old stored state, and a toggle round trip. Unit tests in `inspector-sections.test.ts`.
3. Loader and renderer: keep `AssetDebug` for each loaded asset; read the live textures after the parse.
4. `AvatarDebugFields.svelte` and the Inspector wiring.
5. Check in the running app with the RORO lilToon and RORO MToon fixtures: Debug is last and collapsed, it shows the data after expand, the search filters, the material picker changes the rows, and Copy gives JSON.

## N — Norms

- Unit tests for the pure function and the section state. No unit test for the Svelte wiring; the check in the running app covers it (constitution principle 5).
- Controls come from `@oshi-connect/ui`. Rows use the read-only list style of `TrackingDiagnostics.svelte`. No badges, no pills, no card grid, no helper text (constitution principles 1, 2, 9).

## S — Safeguards

- No Rust change, no IPC call, no schema change, no record change.
- Do not keep the full JSON or the file bytes after the load.
- Do not show a value that the file does not have. An absent value shows no row.
