# REASONS: Chat thin tools

Analysis: [Chat thin tools](../analysis/2026-11-08-chat-thin-tools.md). Design: [OpenSekai Chat](../../docs/superpowers/specs/2026-11-07-opensekai-chat-design.md), slice 1. Plan: [slice 1 plan](../../docs/superpowers/plans/2026-11-08-opensekai-chat-slice-1-thin-tools.md).

## R — Requirements

1. **Atomic apply.** A new call `proposalApply` applies scene operations, at most one Blueprint batch, and at most one output camera change as one unit. If any part fails, nothing changes: not the scene, not the Blueprints, not the output camera, not the revisions.
2. **Scoped conflict check.** `proposalApply` has no `expectedRevision`. It carries `expect.entities` and `expect.blueprints`: `{id, fingerprint}`, where `fingerprint` is the current `fingerprint(entity)` or `fingerprint(graph)`, or `null` for "must not exist". For a graph, the session fingerprints the stored document (the graph that `blueprintInspect` returns). It does not fingerprint the last valid compile. Thus a graph whose stored document does not compile can still be replaced. When one expectation fails, the call fails with `CONFLICT`, message `Proposal target changed`, and the IDs of all failed expectations. A change to an entity or graph that is not in `expect` does not block the call.
3. **Limits.** `sceneOps` 0 to 64 (each a `PatchOp`), `blueprint` a `BlueprintBatch` or `null`, `output` `{outputId, cameraId}` or `null`, `expect.entities` at most 64, `expect.blueprints` at most 16. A call with no scene ops, no batch, and no output is `INVALID_INPUT`. TypeScript and Rust validate the same shape; the validation vectors cover each limit.
4. **Result.** `{revision, blueprint}`: the scene revision after the call, and the `blueprintEdit` result of the batch (or `null`). The router learns keystrokes, held keys, devices, and the YouTube flag from `blueprint` exactly as it does for `blueprintEdit`. `proposalApply` needs `Capability::Edit` and relays to the publisher like `scenePatch`.
5. **Fingerprint.** `fingerprint(value)` is FNV-1a 64-bit over canonical JSON (object keys sorted, arrays in order, no spaces), as 16 lower-case hex characters. Equal values give equal fingerprints; key order does not matter. A key whose value is `undefined` is skipped, as `JSON.stringify` does.
6. **Intents.** `@opensekai/assist` defines strict zod schemas for the tools `light_setup`, `camera_add`, `camera_move`, `environment_set`, `prop_place`, `haze_set`, `output_camera`, `blueprint_build`, `ask`, and `look_up`, with `TOOL_CONTRACT_VERSION = 1`. Fields are word enums, references, short names, and small integers only. No intent field takes coordinates, colors as hex, durations in seconds, or raw IDs. `sky_set` waits for ENV-02 (#148).
7. **Words.** One table maps each word to numbers. Order holds: intensity `dim < soft < normal < bright`; haze `off < light < medium < thick` (`off` is density 0); framing distance `extremeCloseUp < closeUp < medium < wide`; duration `quick < normal < slow < verySlow`; height `low < eye < high`. Color words map to `#rrggbb`; the temperature words go from warm to cool (`candle`, `warm`, `neutral`, `daylight`, `cool`).
8. **References.** A reference table gives each entity `@e<n>`, each Blueprint `@b<n>`, and each asset `@a<n>`. An ID keeps its reference for the life of the table; a reference is never reused. The compiler rejects a reference that is not in the table, or that has the wrong kind for the field, with `INVALID_INPUT` and the reference in `ids`.
9. **Scene summary.** One text block with the scene ID, the output camera, the selection, one line per entity (`@e3 Key light · light`), one line per Blueprint (`@b1 Camera Sway · blueprint`), and at most 12 assets (`@a4 Concert stage · scene · concert, stage, night`). No transforms, light values, or graph content. Assets are ranked by the number of their tags and name words that occur in the prompt, then by name; avatars and environments in the scene come first. Only an asset that an avatar or environment entity uses gets this boost. An asset that only a prop mesh uses does not.
10. **Look up.** `look_up` returns a short text for one reference: for an entity, its kind, name, rounded position, and kind values (light type, color, intensity, shadow; camera field of view; environment asset name); for a Blueprint, name, enabled, and node type counts; for an asset, kind, name, description, tags, and credits. When the credit title or author is `null`, the text omits that part.
11. **Compiler.** `compileIntents(intents, context)` turns a list of intents into one `Proposal` in order. A later intent can use a reference that an earlier intent in the same list created. The compiler checks the scene limits (cameras, lights, shadow lights, haze) and the Blueprint limit (8 graphs, `BlueprintSetSchema`) on its working copies and returns `INVALID_INPUT` with a message that names the limit. It gives a shadow to a key light only when a shadow light slot is free, else it adds the note `shadowSkipped`. A target or `near` reference must be an avatar, mesh, camera, light, or environment entity; another kind gives `INVALID_INPUT` with the reference in `ids`. A missing target falls back to the selection, then the first avatar, then the origin, with the note `targetDefaulted`. The fallback skips a selection that is not one of these kinds.
12. **Scene intents.** `light_setup` creates a light (or changes the light in `replace`) placed by direction, height, and role around the target, aimed at it. `camera_add` creates a camera placed by framing, side, and height, aimed at the target. `environment_set` changes the model of the existing environment entity or creates one. `prop_place` creates 1 to 8 mesh entities from an asset near a reference. `haze_set` changes the existing haze or creates one. `output_camera` selects the camera on the first output.
13. **Camera move.** `camera_move` creates one Blueprint: an `event.manual` node named Play, then a start snap, then a chain of steps. The start snap sets the camera to its pose at compile time with `transitionSeconds` 0: node `start` sets the position, `start_rotation` the rotation, and `start_fov` the current `fovDegrees`. The `transitionEnd` of `start` starts the first step. Each step is a `property.set` node for `position` and one for `rotation` (linked by `exit`). The `transitionEnd` of a step starts the next step. The field of view changes only in the last step, and only when `endFraming` is set. An orbit splits its angle into steps of at most 15°. Each step faces the target. Dolly, push-in, pull-out, and crane are one straight step. A dolly moves along the view line to the `medium` framing distance (or to `endFraming`). `TOOL_CONTRACT_VERSION` 1 has no direction field for a dolly. A push-in moves along the view line to the `closeUp` distance, and a pull-out to the `wide` distance (or each to `endFraming`). The distance is from the camera to the aim point. A push-in must move the camera nearer, and a pull-out must move it farther. Otherwise the compiler returns `INVALID_INPUT` with the camera reference in `ids`. The step durations add up to the duration word. With `loop`, the last step connects back to `start`. The proposal lists the Play node in `play`; the caller runs it one time after apply.
14. **Blueprint build.** `blueprint_build` creates one graph from a trigger (hotkey, manual, custom event, YouTube event, or show start) and 1 to 8 actions in sequence (expression on, off, or toggle; show, hide, or toggle visibility; switch camera; wait; emit an event). A hotkey accelerator needs a Control, Alt, or Meta modifier; otherwise `INVALID_INPUT`. It replaces a graph only when `replace` is a reference in the owned set of the table; otherwise `INVALID_INPUT`. Created graphs go into the owned set.
15. **Apply params.** `toApplyParams(proposal, context, batch)` gives `expect` from the context: each touched existing entity and graph with its fingerprint, and each created ID with `null`.
16. **Asset catalog.** At import, the host reads `asset.extras.description` (trimmed, 1 to 280 UTF-16 units) and `asset.extras.tags` (at most 8 strings, trimmed, lower case, 1 to 32 units each; others dropped) into optional `catalog` on `AssetRecord`, and `AssetSummary` returns it. TypeScript and Rust validate the same shape.
17. **MCP.** The MCP server adds `scene_summary {sceneId, prompt?}`, `look_up {sceneId, ref}`, `ask {question, choices}`, and one tool per scene or Blueprint intent (`{sceneId, ...intent fields}`). Each intent tool reads the scene, the Blueprints, and the asset list, compiles that one intent, calls `proposalApply`, runs Play for a camera move, and returns `{revision, created, notes}`. When Play fails after the apply, the call still succeeds and `notes` has `playFailed` with the reference of the Blueprint. The MCP server keeps one reference table for its process. Existing tools do not change.

## E — Entities

- `ProposalApplyParams`: `{sceneId, expect: {entities: {id, fingerprint: string | null}[], blueprints: {id, fingerprint: string | null}[]}, sceneOps: PatchOp[], blueprint: BlueprintBatch | null, output: {outputId, cameraId} | null}`.
- `ProposalApplyResult`: `{revision: number, blueprint: BlueprintEditResult | null}`, where `BlueprintEditResult` is the existing `blueprintEdit` data shape.
- `AssetCatalog`: `{description: string | null, tags: string[]}`. Optional `catalog` on `AssetRecord` and `AssetSummary`.
- `Ref`: a string `@e<n>`, `@b<n>`, or `@a<n>`.
- `RefTable`: `{entities: Record<Id, Ref>, blueprints: Record<Id, Ref>, assets: Record<Id, Ref>, next: {e: number, b: number, a: number}, owned: Id[]}`. Plain data.
- `Intent`: discriminated union on `tool`. `TOOL_CONTRACT_VERSION = 1`.
- `CompileContext`: `{scene: SceneView, blueprints: BlueprintGraph[], assets: AssetSummary[], refs: RefTable, selection: Id | null, newId: (kind: string) => Id}`.
- `Proposal`: `{sceneOps: PatchOp[], blueprintOps: BlueprintOp[], output: {outputId, cameraId} | null, play: {graphId, nodeId}[], touched: {entities: Id[], blueprints: Id[]}, created: {entities: Id[], blueprints: Id[]}, notes: Note[], refs: RefTable}`.
- `Note`: `{code: 'targetDefaulted' | 'shadowSkipped' | 'replacedExisting' | 'countClamped' | 'playFailed', ref?: Ref}`.

## A — Approach

- Contracts: `fingerprint.ts` and the `proposalApply` schema, types, method list, capability, and result schema in `packages/contracts`. Rust mirror in `crates/contracts/src/lib.rs`, with the scene op checks of `ScenePatch` moved into one shared function with a limit argument. Vectors in `fixtures/protocol/validation-vectors.json`.
- Session: `applyProposal` in `session.ts`: parse, check the scene ID, check every expectation, apply `sceneOps` to a copy with `applyOperations`, set the output camera on the copy, check the revision overflow, run `store.edit` through the existing `editBlueprints` path when there is a batch, then commit the copy. Drop overrides and tweens for the scene ops as `applyPatch` does.
- Router: add `proposalApply` to the edit capability list and the two scene relay lists. Learn keystrokes from `data.blueprint` like `blueprintEdit`.
- New package `packages/assist` (`@opensekai/assist`), plain functions and data, no Svelte, no Node built-ins. It depends on `@opensekai/contracts` only, so the editor (slice 4) and MCP can both use it.
- Camera aim: a look-at rotation from camera position to target point (avatar: position plus a head height from the framing; other kinds: entity position). Euler degrees YXZ for `property.set` `rotation`, as `property-registry.ts` defines.
- Host import: `read_catalog` next to `read_credits` in `scene_import.rs`; `AssetSummary::of` copies it.
- MCP: `apps/mcp/src/assist-tools.ts` registers the new tools. It reads all asset pages (at most 8 pages) before compile.

## S — Structure

- New: `packages/contracts/src/fingerprint.ts`, `packages/contracts/src/proposal.ts`, `packages/contracts/test/proposal.test.ts`, `crates/contracts/tests/proposal.rs`, `packages/session/test/proposal-apply.test.ts`.
- New: `packages/assist/` with `package.json`, `tsconfig.json`, `src/index.ts`, `src/intents.ts`, `src/words.ts`, `src/refs.ts`, `src/summary.ts`, `src/aim.ts`, `src/compile.ts`, `src/compile-scene.ts`, `src/camera-move.ts`, `src/blueprint-build.ts`, `src/apply-params.ts`, and one test file for each source file in `packages/assist/test/`.
- New: `apps/mcp/src/assist-tools.ts`, `apps/mcp/test/assist-tools.integration.test.ts`, `crates/contracts/tests/asset_catalog.rs`.
- Changed: `packages/contracts/src/index.ts`, `schema.ts`, `types.ts`; `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`; `packages/session/src/session.ts`, `session-api.ts`; `apps/desktop/src-tauri/src/service/router.rs`; `apps/desktop/src-tauri/src/assets/scene_import.rs` and `registry.rs` (only where the record is built); `apps/mcp/src/server.ts`, `apps/mcp/package.json`.
- Changed: `ARCHITECTURE.md` (workspace map: `packages/assist`; command path: `proposalApply` and the scoped check; asset path: `catalog`). `docs/warudo-parity.md` gets a Chat line with only the verified behavior. The design spec Apply rules: the compiler assigns new IDs.
- No change: the editor UI, the renderer, the OBS page, the show format, existing MCP tools.

## O — Operations

1. Contract: `fingerprint`, `proposalApply` params and result, Rust mirror, router lists, vectors. Run the vector tests on both sides.
2. Session: `applyProposal` with unit tests for each requirement in R1 to R4, then an MCP-free integration through `sessionApi`.
3. `packages/assist`: intents and words, then references and the summary, then the scene compiler, then camera move and Blueprint build, then apply params. Unit tests for each.
4. Host: asset catalog from extras, Rust tests, vectors.
5. MCP: the new tools and the integration test through the real stdio process.
6. Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo fmt --check`, `cargo clippy --workspace -- -D warnings`, and `cargo test --workspace`.
7. Running app check: start the desktop app, connect the MCP server, and build the basic concert scene with the thin tools (key, fill, and rim light, haze, a camera, an orbit with push-in, output camera). Record an OBS recording of the move, the tool calls, the revisions, and the commit in `docs/evaluation/chat-thin-tools.md`.

## N — Norms

Functional TypeScript and plain data. Match the compact style of `packages/contracts` and `packages/session`. A comment only where the logic is hard to follow (the conflict order, the orbit steps). No UI change and no UI copy in this slice. Prose follows ASD-STE100. pnpm only.

## S — Safeguards

- Do not add an edit path that skips the session validation. `proposalApply` uses `applyOperations`, the same scene validation, and `store.edit`.
- Do not change state before every check passes. `store.edit` is the last step that can fail; the scene commit comes after it.
- Do not let a model write coordinates, hex colors, seconds, or raw IDs through an intent.
- Do not put full `SceneView` or graph JSON in the summary.
- Do not change existing MCP tool names, shapes, or descriptions.
- Do not claim a Chat parity item from MCP checks alone. The parity line says "thin tools through MCP" and names what is not verified (local model, UI, Windows).
