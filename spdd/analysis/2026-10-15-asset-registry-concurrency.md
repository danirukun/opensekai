# Asset registry concurrency, import memory, and MCP asset list analysis

Date: 2026-10-15. Scope: bundle B2 (#151, #152, #155). Follows the [environment import](2026-10-13-environment-import.md) slice (PR #150).

## Problem

1. **Lock scope (#151).** The host keeps the asset registry behind one mutex. `ServicePorts::import_scene` calls `store_scene` while it holds the lock. `store_scene` hashes, validates, writes, and syncs a GLB of up to 256 MiB. `GET /assets/{id}` calls `AssetRegistry::read` while it holds the lock, and `read` reads and hashes the whole file. `import_avatar` also copies, hashes, and syncs the source file while it holds the lock. During each of these, every other asset request waits. The environment import contract (Operations step 4) says that asset reads continue during an import. This is true only for the pack step.
2. **Import memory (#152).** `pack_scene` keeps about four copies of a GLB root: the source bytes, a copy of the BIN chunk (`split_glb`), the new BIN, and the final GLB. Two of these copies are not necessary. Also, `read_bounded` and the BIN buffer grow by doubling, so their capacity can be up to two times the data.
3. **MCP asset list (#155).** An MCP client can set an environment model only when it already has the asset ID. MCP has no call that lists the asset records.

## Decisions

- Split each registry write into two parts. The **stage** part runs without the lock: it reads, hashes, validates, and writes and syncs temporary files in the library folder. The **commit** part takes the lock: it checks deduplication again, renames the temporary files, and inserts the record. A rename is short.
- Split each registry read into two parts. The **locate** part takes the lock and copies the resolved path and the record. The **verify** part runs without the lock: it reads the file and checks the size, the SHA-256, and `validate_glb`.
- Give the service a test hook that runs at each long step without the lock. Integration tests use it to stop one request in that step and show that another request completes. The hook is empty in the product.
- `pack_scene` owns the root bytes, borrows the BIN chunk from them, and releases them after it copies the buffer views. The BIN buffer gets its exact size for the buffer views before the copy. File reads use the file size (or the zip entry size) as the first capacity.
- Add the call `assetList` (read capability). The host answers it from `AssetRegistry::records()` and does not relay it to the publisher. A reply has at most 64 summaries and at most 192 KiB of JSON. The `after` cursor gives the next page.
- A summary has `id`, `kind`, `name`, and `credits` when the record has credits. `kind` comes from the ID prefix: `avatar_` is `avatar`, `scene_` is `scene`, and other IDs (smoke fixtures) are `fixture`. This is the same grouping that the editor uses for the environment Source select.

## Effects

- Asset reads continue during the store step of an import, and two reads do not wait for each other's hash.
- Peak memory of a GLB root import goes down from about 4N to about 2N.
- An MCP client can list the stored assets and use a listed ID in `scene_patch`.
- The wire API has one new method. Old clients do not call it. No file format changes.

## Risks

- Two imports of the same file can stage at the same time. Both renames write the same bytes, so the result is the same. The commit step checks deduplication again under the lock.
- A file can change between locate and verify. Verify checks the size and the SHA-256, so a changed file still fails as before.

## Out of scope

MCP import, asset deletion, asset rename, a streaming GLB writer, and memory of the renderer.
