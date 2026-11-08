# Chat thin tools analysis

Design: [OpenSekai Chat](../../docs/superpowers/specs/2026-11-07-opensekai-chat-design.md), slice 1. Dependency plan: [Chat dependency plan](../../docs/superpowers/plans/2026-11-08-opensekai-chat-dependency-plan.md). Mode: contract-first.

## Problem

A small local model (2B to 9B) must change the scene and the Blueprints from a sentence. The current MCP surface is too large for it: `scene_patch` has about 30 operation kinds and a long description, and `blueprint_edit` has about 20 graph operations over 77 node types. The model must also not write coordinates, colors, or entity IDs.

Chat also needs one change to apply as one unit. Today a new camera, a Blueprint that moves it, and the output switch are three calls (`scenePatch`, `blueprintEdit`, `cameraSelect`). A failure between them leaves half a proposal in the show and in OBS.

## Existing material

- `packages/contracts/src/schema.ts`: `ScenePatchSchema` (1 to 32 operations, `expectedRevision`), `PatchOpSchema`, `SceneEntitySchema`, `LIMITS` (8 cameras, 8 lights, 2 shadow lights, 1 haze). `createEntity` takes the full entity with a caller ID.
- `packages/contracts/src/blueprint-ops.ts`: `BlueprintBatchSchema` (1 to 64 ops) and the pure `applyBlueprintOps(graphs, ops)`. `createGraph` takes a whole graph with its nodes and connections in one op.
- `packages/session/src/session.ts`: `applyPatch` checks `expectedRevision` against the whole scene revision, applies with `applyOperations`, and commits. `commit` only swaps state and cannot fail after the revision overflow check. `editBlueprints` calls `store.edit`, which does not read the scene. `selectCamera` checks the whole revision.
- `crates/contracts/src/lib.rs`: `validate_call` and `validate_result` mirror each method. `service/router.rs` lists the scene methods in three places and maps edit methods to `Capability::Edit`.
- `packages/contracts/src/blueprint-templates/camera-sway.json`: a chain of `property.set` nodes with `transitionSeconds` and `easing`, linked by the `transitionEnd` port. Camera moves use the same nodes.
- `property-registry.ts`: camera targets `position`, `rotation` (Euler degrees, YXZ), and `fovDegrees`.
- `apps/desktop/src-tauri/src/assets/scene_import.rs`: `read_credits` reads `asset.extras.title|author|license|source` from the glTF at import. `AssetSummary` returns `credits`.
- `apps/mcp/src/tools.ts`: one MCP tool per `AppApi` method, through `invokeTool`. Tests start a real stdio MCP process against a real session (`apps/mcp/test/session-fixture.ts`).

## Findings

1. The scene revision goes up for viewport navigation, gizmo drags, and tween ends. A check against the whole revision makes Accept fail for unrelated changes. The check must cover only the entities and Blueprints that the proposal touches.
2. A content fingerprint of each touched entity and graph is enough for that check. The session can compare it with the current value without history. Both the compiler (TypeScript, in the editor and in MCP) and the session compute it, so it lives in `packages/contracts`. The Rust side only checks its shape.
3. Atomic apply is possible without a rollback. Order: check the fingerprints, apply the scene operations to a copy, select the camera on the copy, run `store.edit` (the only step that can fail and change state), then commit the copy (which cannot fail after the overflow check).
4. `createEntity` takes caller IDs. When the compiler assigns the new IDs, the apply command does not need placeholder references. This is simpler than the design text ("resolves references to new entities inside the batch"). The design is updated to say so.
5. A Blueprint `event.enable` trigger also fires when a show loads. A camera move that must play once on Accept should use a manual trigger that the caller runs one time after apply.
6. Asset descriptions and tags can come from the same glTF `asset.extras` object as the credits. Fixture builders write them before import. No new write method is needed.
7. Short references must stay the same between two calls, or a model that read `@e3` before a change may hit a different entity after it. An append-only table (an ID gets a reference once and keeps it) solves this.

## Questions resolved without the owner (reversible)

- **New IDs.** The compiler assigns them (`chat_<kind>_<random>`), through an injected generator for tests. `proposalApply` takes plain operations.
- **Conflict check.** `expect.entities` and `expect.blueprints` carry `{id, fingerprint}`; `fingerprint: null` means "must not exist". Fingerprint: FNV-1a 64-bit over canonical JSON (sorted keys), 16 hex characters. Alternative: SHA-256. Rejected because the session runs in a browser worker with no synchronous SHA-256 and the check is not a trust boundary.
- **Limits.** `sceneOps` 0 to 64, one Blueprint batch (1 to 64 ops) or none, `expect.entities` at most 64, `expect.blueprints` at most 16. At least one change.
- **Asset catalog.** Optional `catalog: {description, tags}` on `AssetRecord` and `AssetSummary`, read from `asset.extras.description` (at most 280 UTF-16 units) and `asset.extras.tags` (at most 8 strings, each 1 to 32 units, lower case). Alternative: a sidecar index file. Rejected because the file already travels with the asset and the import path already reads extras. Assets without extras show name and kind only.
- **References.** `@e<n>` entities, `@b<n>` Blueprints, `@a<n>` assets. The MCP server keeps one table per process. Chat (slice 4) keeps one per Chat session.
- **MCP thin tools apply at once**, like `scene_patch`. Each call is one proposal. The teacher builds a scene with several calls; the eval compares the final scene. In the app, one model turn compiles all its intents into one proposal.
- **Camera move playback.** The graph has an `event.manual` trigger named Play and no `event.enable` trigger. Play first sets the camera to its start pose (position, rotation, and field of view, 0 s), then runs the steps. After apply, the caller runs Play one time (`blueprintRun`). With `loop: true`, the last step connects back to the start pose.
- **Chat-owned Blueprints.** `blueprint_build` creates new graphs. It replaces a graph only when the reference is in the owned set of the reference table. Persistence of ownership across app restarts is a slice 4 question.
- **`sky_set`** is not in slice 1 (blocked on #148). **`ask`** is an MCP tool that validates and returns the question; the slice 2 harness answers it.
- **Word values.** The words are enums in the intent schemas. The numbers behind them live in one file (`words.ts`) and are the builder's choice (design: Left to the builder). Tests check order (for example dim < soft < normal < bright), not exact values.
