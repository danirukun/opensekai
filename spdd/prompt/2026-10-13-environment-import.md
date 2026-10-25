# REASONS: Environment import

Date: 2026-10-13. Scope: ENV-01 partial. One environment in each scene from a local `.glb`, `.gltf`, or `.zip`, with neutral environment lighting and Render Environment for each camera. Analysis: [environment import](../analysis/2026-10-13-environment-import.md). Design: [environment import](../../docs/superpowers/specs/2026-10-13-environment-import-design.md).

## R — Requirements

R1. The scene schema has an entity kind `environment` with the base fields and a required nullable key `assetId: Id | null`, in TypeScript (zod) and Rust. Scene validation fails with the existing budget message when a scene has more than one environment. A show without an environment validates without change.
R2. A camera has an optional `renderEnvironment: boolean`. An absent value means `true`. Rust and TypeScript accept and write the same shape.
R3. The operation `setEnvironmentModel { entityId, assetId: Id | null }` sets the model of an environment. It fails with `INVALID_INPUT` for an entity that is not an environment and with `NOT_FOUND` for an unknown entity.
R4. The operation `setCameraRenderEnvironment { entityId, renderEnvironment: boolean }` sets the flag. It fails with `INVALID_INPUT` for an entity that is not a camera and with `NOT_FOUND` for an unknown entity.
R5. `AssetRecord` has an optional key `credits: { title, author, license, sourceUrl }`, where each of the four keys is required and is `string | null`, in TypeScript and Rust. An absent key means no credits. `credits: null` is invalid, as for other optional keys. `sourceUrl` must be an `http` or `https` URL or null. Both sides accept only a lowercase `http://` or `https://` prefix. A library record without `credits` loads without change. Scene imports also write `licenseLabel` (`credits.license` or empty) and `sourceUrl` (`credits.sourceUrl`).
R6. The editor-only Tauri command `import_scene` opens a native dialog filtered to `.glb`, `.gltf`, and `.zip`. On macOS the dialog has no filter (the project-wide rfd workaround), and `pack_scene` rejects another extension with `INVALID_INPUT` ([gaps](2026-10-25-environment-import-gaps.md) G11). It takes no path argument. It uses the same window-label check as `import_avatar`. A cancelled dialog returns no record and makes no change.
R7. `pack_scene` accepts a `.glb`, or a `.gltf`, as the root. For a `.zip`, the root is the only `.gltf` or `.glb` at the archive root or one folder below it. No root or more than one root fails with `INVALID_INPUT`.
R8. `pack_scene` resolves each buffer and image `uri`. A `data:` URI is decoded (base64 only). A relative URI is percent-decoded and resolved against the folder of the root file. The result must stay below that folder after symlink resolution (folder source) or after path normalization (zip source). An absolute path, a URI scheme other than `data:`, a `..` that leaves the root, a symlink target outside the root, and a missing file fail with `INVALID_INPUT` and name the URI. A `uri` key in any other place than a buffer or an image, or one that is not a string, fails with `INVALID_INPUT` before any file is read, unless it is a `data:` URI. The message names its JSON pointer.
R9. A zip source with more than 4096 entries, or with more than 1 GiB uncompressed size in its central directory, fails with `INVALID_INPUT` before any entry is read. A zip entry name that leaves the archive fails with `INVALID_INPUT`. Only the entries that the root file refers to are read.
R10. An image that a texture uses as its core `source` must be PNG, JPEG, or WebP by its magic bytes. An image that no core `source` uses (for example, one that only `KHR_texture_basisu` or `EXT_texture_avif` uses) can also be KTX2 or AVIF. Other bytes fail with `INVALID_INPUT`. The packed image has `bufferView` and the matching `mimeType`. Images with the same `uri` are read once and share one buffer view.
R11. An entry in `extensionsRequired` that is not in the renderer support list fails with `INVALID_INPUT` and names the extension. The list excludes `KHR_draco_mesh_compression`, `EXT_meshopt_compression`, and `KHR_texture_basisu`. Optional extensions pass through unchanged.
R12. The packed output is one GLB with one BIN chunk. Each buffer view starts at a 4-byte boundary. The output has no `uri`. The output passes `validate_glb`. Accessor, mesh, material, node, and texture counts are the same as in the source.
R13. `MAX_IMPORT_BYTES` is 256 MiB and applies to the packed GLB and to VRM imports. A larger result fails with `INVALID_INPUT`. The GLB JSON limit stays 16 MiB.
R14. The registry stores a scene import as `scene_<sha256>.glb` with format `glb` and its JSON record. It writes to a temporary file in the library folder and renames it. An import with the same SHA-256 returns the existing record without a new write, only when its library file exists and its length equals the record `bytes`. Otherwise the registry writes the files again and replaces the entry, so a new import repairs a missing library file. The record name is `credits.title` when it is 1 to 128 code units after trim, else the root file stem, else `Scene`. Credits come from `asset.extras.title`, `author`, `license`, and `source`. A value that is not a string, is empty after trim, or is longer than 512 UTF-16 code units becomes null. A `source` that is not an `http` or `https` URL becomes null. When all four values are null, the record has no `credits` key.
R15. The import runs on a blocking task. It does not hold the app lifecycle lock, so the app can shut down during an import. The source files do not change.
R16. The renderer reconciles an environment with an `assetId` through the existing background load jobs, the load status overlay, `compileAsync`, and stale-result disposal. An environment with `assetId: null` or `visible: false` draws nothing.
R17. Each renderer client makes one PMREM map from `RoomEnvironment` the first time an environment loads. It sets the map as `envMap` on each lit (MeshStandardMaterial or MeshPhysicalMaterial) material of the environment model, on a copy for each instance. Unlit materials do not change. It does not set `scene.environment`. Avatar materials do not change. The map is released when the renderer is disposed. (Changed by [stage lights](2026-10-18-stage-lights.md) R4a: with an ambient light entity in the scene, the map gives only its reflections, times the ambient light.)
R18. Each renderer client draws through its output camera. It hides the environment when that camera has `renderEnvironment: false`. This applies to the Scene window preview and to the OBS output. A change of the flag applies in the next frame.
R19. The environment is not a viewport pick target. A pick ray that hits only the environment selects nothing.
R20. The Add menu has **Environment**. It creates `{ kind: 'environment', name: 'Environment', assetId: null, visible: true }` with an identity transform. The item is disabled while the scene has an environment.
R21. The Hierarchy shows an **Environment** group before **Cameras**.
R22. The Inspector for an environment shows Name, Visible, Transform, and a **Source** select. Its options are `Choose model…` (value empty, for null), one option for each library record whose ID starts with `scene_` (the asset name), `Missing model` when the asset ID is not in the editor asset list, and `Import file…` last. A record option or `Choose model…` sends `setEnvironmentModel`. `Import file…` opens `import_scene`; a returned record sends `setEnvironmentModel`, and a cancelled dialog keeps the current value. During the import the row shows `Importing…`. An import failure shows the `AppError` message under the select, at most 160 characters. The load status of the environment shows under the select, as for a character model.
R23. When the asset has credits, the Inspector shows the title, the author, and the license, and a **Copy credit** action. The copied text is `This work is based on "<title>" (<sourceUrl>) by <author> licensed under <license>`. A null field is left out with its words. When all four fields are null, the Inspector shows no credits block. The Inspector has no link, because the app has no link opener.
R24. The camera Inspector has a **Render Environment** switch that sends `setCameraRenderEnvironment`. When the call fails, the switch shows the scene value again.
R25. MCP `scene_patch` accepts both operations. `scene_inspect` returns the environment and the flag. Asset records in replies include `credits`. MCP replies do not list asset records in this slice, so MCP can set an asset ID only when the caller already has it. (Changed by the [asset registry concurrency](2026-10-15-asset-registry-concurrency.md) contract: MCP `asset_list` lists the records.)
R26. Save As and Open keep the environment and the camera flag. An environment with an unknown `assetId` opens and shows `Missing model`.

## E — Entities

- `SceneEntity` (environment): `{ id, name, visible, transform, kind: 'environment', assetId: Id | null }`.
- `SceneEntity` (camera): adds `renderEnvironment?: boolean`.
- `PatchOp`: `setEnvironmentModel { kind, entityId, assetId }`, `setCameraRenderEnvironment { kind, entityId, renderEnvironment }`.
- `KHR_lights_punctual`: the importer removes it from the root and node `extensions` and from `extensionsUsed` and `extensionsRequired`, so the renderer creates no file lights. When one of the two lists is then empty, the importer removes the list, because glTF requires at least one item.
- `AssetRecord`: adds optional `credits?: AssetCredits`.
- `AssetCredits`: `{ title: string | null, author: string | null, license: string | null, sourceUrl: string | null }`.
- Rust `SceneSource` trait: `read(relative: &str) -> Result<Vec<u8>, AppError>` and `root_name() -> &str`, with `FolderSource` and `ZipSource`.
- Rust `PackedScene`: `{ glb: Vec<u8>, credits: Option<AssetCredits>, stem: String }`.
- Editor: `makeAuthoringEntity('environment', id, entities)`; `creditLine(credits): string | null`.

## A — Approach

Change the contracts first, in TypeScript and Rust together, with shared validation vectors. Then the session operations. Then the native importer as a pure packing function over a source trait, with unit tests for each rejection. Then the registry command and the limit. Then the renderer. Then the editor. Keep one validated command path for the editor and MCP. Keep the three URI checks unchanged; the importer removes every external reference before the file enters the library.

## S — Structure

- `packages/contracts/src/schema.ts`, `types.ts`; `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`.
- `packages/session/src/scene-ops.ts`.
- `apps/desktop/src-tauri/src/assets/scene_import.rs` (new), `assets/registry.rs`, `assets/mod.rs`, `bootstrap.rs`, `service/mod.rs`, `lib.rs`, `capabilities/editor.json`, `Cargo.toml` (`zip` crate, `percent-encoding`).
- `apps/desktop/src-tauri/tests/import_integration.rs` (the test writes its own multi-file glTF to a temporary folder).
- `packages/renderer/src/renderer.ts`, `load-jobs.ts`, a new `environment-light.ts`, `editor-viewport.ts` (pick filter).
- `apps/desktop/src/editor/authoring.ts`, `asset-groups.ts`, `live-fields.ts`, `model.ts`; `components/Inspector.svelte`, a new `components/EnvironmentFields.svelte`, `CameraLensFields.svelte`, `Hierarchy.svelte`.
- `docs/warudo-parity.md`, `docs/evaluation/environment-import.md` (new), `ARCHITECTURE.md`.

## O — Operations

1. Contracts: the environment kind, the camera flag, the two operations, and `credits`, in TypeScript and Rust. Add validation vectors for one environment, two environments, the absent flag, and a record without credits.
2. Session: apply both operations. Add scene-operation tests.
3. Native importer: `pack_scene`, `FolderSource`, `ZipSource`. Add unit tests for R7 to R12 and R14 credits and name.
4. Registry and command: `import_scene`, `MAX_IMPORT_BYTES` 256 MiB, atomic write, deduplication, and library load of `scene_` records. Pack outside the registry lock, so asset reads continue during an import. (The store step was still under the lock; the [asset registry concurrency](2026-10-15-asset-registry-concurrency.md) contract moves it out.) Add the integration test: import, `GET /assets/{id}`, no `uri` in the served GLB, and restart.
5. Renderer: environment load, the neutral map, Render Environment, and no pick. Add unit tests for envMap scope and the flag with a fake loader.
6. Editor: Add › Environment, the Hierarchy group, the environment Inspector with Source and credits, and the camera switch. Add editor model tests for the entity factory, the disabled item, and the credit line.
7. Live macOS check with computer use and MCP (design, Testing and evidence). Record evidence, parity, and the measured import time.
8. Update `ARCHITECTURE.md` for the scene import path.

## N — Norms

Use `@oshi-connect/ui` controls. Keep UI copy to the labels in R20 to R24 and the import failure fallback `Could not import model`. Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript. Follow the existing one-operation-for-each-property pattern.

## S — Safeguards

- Do not loosen `validate_glb`, `inspectContainer`, or the asset service URI checks.
- Do not accept a path from the frontend or from MCP.
- Do not follow a symlink or a zip entry outside the source root.
- Do not read a zip entry that the root file does not refer to.
- Do not change the source files.
- Do not set `scene.environment` or change avatar materials.
- Do not change the transparent output of a scene without an environment.
- Do not import `KHR_lights_punctual` lights.
- Do not claim Sketchfab, sky, props, or Windows support from this slice.
- Do not claim a memory or frame-time result that was not measured; record it as unknown.
