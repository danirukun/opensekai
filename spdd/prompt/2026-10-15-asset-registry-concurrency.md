# REASONS: Asset registry concurrency, import memory, and MCP asset list

Date: 2026-10-15. Scope: bundle B2 (#151, #152, #155). Analysis: [asset registry concurrency](../analysis/2026-10-15-asset-registry-concurrency.md). Previous slice: [environment import](2026-10-13-environment-import.md).

## R — Requirements

R1. `GET /assets/{id}` holds the registry lock only to resolve the ID to a path and a record. It reads the file, checks the length and the SHA-256, and runs `validate_glb` without the lock. The response codes do not change.
R2. `import_scene` holds the registry lock only for the commit step: the deduplication check, the renames of the GLB and the JSON record, and the insert. Packing, hashing, `validate_glb`, record validation, and the write and sync of the temporary files run without the lock.
R3. `import_avatar` follows R2: the copy, the hash, the VRM validation, and the sync run without the lock.
R4. Deduplication and the repair rule of the environment import contract (R14) still hold. The commit step checks deduplication again under the lock. When an intact entry exists, the commit drops the temporary files and returns the existing record.
R5. The smoke fixture check reads each fixture under R1.
R6. `pack_scene` keeps at most about 2N bytes for a GLB root of N bytes. The root bytes and a new BIN of exact size can be alive together. After the buffer views are copied, the root bytes are released before the final GLB is built. Source reads use the file length or the zip entry size as the first capacity. The packed output does not change.
R7. The call `assetList { after?: Id }` needs the `read` capability. The host answers it and does not relay it to the publisher. It returns `{ assets: AssetSummary[], next: Id | null }`. The summaries are in ascending ID order and have an ID greater than `after` when `after` is set. A page has at most 64 summaries and at most 192 KiB of serialized summaries. `next` is the ID of the last summary when more records follow, else null.
R8. `AssetSummary` is `{ id, kind: 'avatar' | 'scene' | 'fixture', name, credits? }`. `kind` is `avatar` for an `avatar_` ID, `scene` for a `scene_` ID, else `fixture`. `credits` is present only when the record has credits. TypeScript and Rust validate the same shape, with shared vectors.
R9. MCP has the tool `asset_list`, which maps to `assetList` through the same validated call path as the other tools.
R10. `ARCHITECTURE.md` says which calls the host answers itself.

## E — Entities

- `AssetSummary`: `{ id: Id, kind: 'avatar' | 'scene' | 'fixture', name: string, credits?: AssetCredits }`.
- `AssetListParams`: `{ after?: Id }`. `AssetList`: `{ assets: AssetSummary[] (max 64), next: Id | null }`.
- Rust `StagedAsset`: the record and the temporary files with their target names. `AssetRegistry::commit(StagedAsset)`.
- Rust `AssetRegistry::locate(id) -> (PathBuf, AssetRecord)` and `read_located(path, record)`.
- Rust service `AssetHook`: an optional callback with an `AssetStep` (`Read { id }` or `Store`), called without the lock. Tests only.

## A — Approach

Change the registry first: split write paths into stage and commit, and the read path into locate and verify. Move the service callers to the split functions. Add the hook. Then change `pack_scene` ownership and capacities, and measure peak memory with a counting allocator. Then add the contract for `assetList` in TypeScript and Rust with vectors, the host answer in the router, and the MCP tool.

## S — Structure

- `apps/desktop/src-tauri/src/assets/registry.rs`, `assets/scene_import.rs`, `service/mod.rs`, `service/router.rs`.
- `apps/desktop/src-tauri/tests/import_integration.rs` (lock scope), `tests/import_memory_integration.rs` (new, peak memory), `tests/service_integration.rs` (`assetList` over WebSocket).
- `packages/contracts/src/schema.ts`, `types.ts`; `crates/contracts/src/lib.rs`; `crates/contracts/tests/vectors.rs`; `packages/contracts/test/schema.test.ts`; `fixtures/protocol/validation-vectors.json`.
- `apps/mcp/src/tools.ts`, `apps/mcp/test/stdio-fixture.ts`, `apps/mcp/test/*.integration.test.ts`.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `spdd/prompt/2026-10-13-environment-import.md` (R25 note).

## O — Operations

1. Registry: `locate`, `read_located`, `stage_scene`, `stage_avatar`, `commit`. Keep `read` and `store_scene` as wrappers for the unit tests.
2. Service: use the split functions in `GET /assets/{id}`, `import_scene`, `import_avatar`, and the smoke fixture check. Add the hook.
3. Integration tests: a GET of a small asset completes while an import is stopped in its store step; a GET completes while another GET is stopped in its verify step. Show that each test fails when the hook runs under the lock.
4. Importer: owned root, borrowed BIN, exact capacities. Add the peak memory test with a generated GLB and record the value.
5. Contracts, vectors, router answer, MCP tool, and tests: a Rust WebSocket test and an MCP stdio test that lists the records and sets an environment model with a listed ID through `scene_patch`.
6. Update `ARCHITECTURE.md` and the parity checklist.

## N — Norms

Write prose in ASD-STE100. Keep functional TypeScript. Use the existing `object!` and zod patterns. Do not add UI.

## S — Safeguards

- Do not loosen `validate_glb`, `inspectContainer`, or the asset service URI checks. The verify step runs the same checks as before.
- Do not accept a path from MCP. `assetList` returns no path, no hash, and no size.
- Do not relay `assetList` to the publisher.
- Do not change the stored file format or the record format.
- Do not claim a macOS memory result. The peak memory value is from the Linux test allocator.
