# REASONS: Character mesh toggles

Analysis: [character mesh toggles](../analysis/2026-10-28-character-mesh-toggles.md). Issue: [#88](https://github.com/danirukun/opensekai/issues/88) (BP-08, slice 1). Queue bundle B26.

Status: contract. Not implemented.

## R — Requirements

1. The asset record of a VRM gets `meshes`: the list of the mesh nodes of the model, in glTF node order. Each entry is `{node, name}`. `node` is the glTF node index of a node that has a `mesh`. `name` is the node name, trimmed. An empty name becomes `Mesh <node>`. A name that an earlier entry already has gets ` (2)`, ` (3)`, and so on, until it is unique. A name is at most 128 characters; a longer node name is cut to 128 characters before the unique step. The list has at most 256 entries; the importer keeps the first 256 in node order and logs the count that it drops.
2. The importer writes `meshes` at each VRM import. The registry backfills `meshes` for a VRM record that does not have it, from the stored file, and writes the record again, as it does for `rig`. A record that it cannot read keeps no `meshes` and is not written again for this field. A GLB scene record does not get `meshes` in this slice.
3. The `avatar` entity gets an optional `hiddenMeshes`: a list of unique names, at most 256, each 1 to 128 characters. No field and an empty list both mean that all meshes show. A show saved before this slice keeps its look. The schema version of the show and the scene stays 1.
4. A new patch op `setHiddenMeshes {entityId, hiddenMeshes}` replaces the list of one avatar. It fails with `Entity not found` for a missing entity and `Entity is not an avatar` for another kind. An empty list removes the field from the entity. The session applies it as one committed patch with one undo step, as `setVisibility`. The op does not check the names against the asset (R5).
5. A name in `hiddenMeshes` that the asset record of the avatar does not list has no effect. It stays in the scene, so a change back to the first model shows the first state again. The Inspector does not show it. A change of `assetId` does not change `hiddenMeshes`.
6. The renderer hides each mesh node whose name is in `hiddenMeshes`, on each renderer client (Scene preview, Editor viewport, OBS page, and screenshot capture). At load, it writes the glTF node index on each object that `parser.associations` maps to a node (`userData.gltfNode`), so a clone keeps it. It sets `object.visible = false` on the object of each hidden node, and `true` on the object of each other listed node. Children of a hidden node are hidden with it (Warudo hides a GameObject the same way). The entity `visible` flag still hides the whole avatar. A mesh toggle does not reload the model and does not change the pose, the expressions, or the tracking.
7. Blueprint node `character.toggleMeshes`, label `Toggle Character Meshes`, category Character. Settings `{entityId, meshes}`. Ports: input `flow`, output `exit`. For each listed name, a name in `hiddenMeshes` is removed and another name is added. The run emits one `setHiddenMeshes` effect for the avatar.
8. Blueprint node `character.setMeshesVisible`, label `Set Character Meshes Visible`, category Character. Settings `{entityId, meshes}`. Ports: inputs `flow` and `visible` (boolean, inline default `true`), output `exit`. `visible: true` removes each listed name from `hiddenMeshes`; `false` adds each one. The run emits one `setHiddenMeshes` effect.
9. Both nodes: `entityId` is an `avatar` field. `meshes` is a new field kind `meshes`: a list of 1 to 16 unique names, each 1 to 128 characters. The editor offers the meshes of the asset record of the selected avatar, in record order, with a `+` control to add an entry and a remove control on each entry. A saved name that the record does not list shows as missing, as a missing expression does. A node whose avatar is missing or not an avatar fails its run with `Entity not found` or `Entity is not an avatar`, with no state change. A run that emits a list equal to the current list emits no patch.
10. Effects of two mesh nodes on the same avatar in one run apply in order on one working list, so the run commits one `setHiddenMeshes` with the final list. The commit follows the existing Blueprint commit rule for scene effects (the `setVisibility` path in `scene-ops.ts`).
11. The Inspector of an avatar with a loaded asset record that has `meshes` gets a `Meshes` section, after the expressions section. It has one checkbox for each mesh, labeled with the mesh name, checked when the mesh shows. A click sends one `setHiddenMeshes` patch. The section is collapsible, as the other Inspector sections, and the section index lists it. An avatar whose record has no `meshes` (no asset, or a record that could not be backfilled) has no section. Controls come from `@oshi-connect/ui`. No helper text.
12. MCP gets one read tool, `mesh_list {avatarId}` (session method `meshList`, routed as `expressionGet`). It returns the meshes of the asset record of that avatar, in record order, each as `{name, hidden}`, and the names in `hiddenMeshes` that the record does not list as `unknown`. It fails with `Entity not found`, `Entity is not an avatar`, or `Asset has no mesh list` (no asset, or no `meshes` in the record). `scene_patch` accepts `setHiddenMeshes`; its description names the op in one sentence. `asset_list` does not change. The node catalog (`opensekai://blueprint-nodes`) shows the two nodes and the `meshes` field from the node definitions.
13. Known gaps, not in this slice: a prop on a human bone or a transform path (Warudo Transform Attachment, CHR-07 and ENV-03, after #242), prop meshes, Default BlendShapes and Default Material Properties, Throw Prop At Character and other prop interactions with collision and ragdoll (needs physics, CHR-09 and BP-10), a list data input for meshes, and mesh toggles on a GLB character.

## E — Entities

- `AssetMeshSchema`: `{node: u32, name: string(1..128)}`. `AssetRecordSchema.meshes?: AssetMesh[]` (at most 256, names unique). Rust: `AssetMesh` and `AssetRecord.meshes: Option<Vec<AssetMesh>>` with `skip_serializing_if = "Option::is_none"`.
- `MeshNameSchema`: `string(1..128)`. `AvatarEntity.hiddenMeshes?: MeshName[]` (unique, at most 256). Rust: `hidden_meshes: Option<Vec<String>>`, `rename = "hiddenMeshes"`.
- `MeshList`: `{meshes: {name, hidden}[], unknown: MeshName[]}`.
- `PatchOp` `setHiddenMeshes`: `{op: 'setHiddenMeshes', entityId: Id, hiddenMeshes: MeshName[]}` (unique, at most 256). Rust `PatchOp::SetHiddenMeshes`.
- Blueprint settings `{entityId: Id, meshes: MeshName[]}` (1 to 16, unique). `BlueprintField` gains `{key, label, kind: 'meshes'}`.
- Blueprint effect `{kind: 'setHiddenMeshes', entityId: Id, hiddenMeshes: MeshName[]}`.
- Pure helpers in `packages/contracts/src/meshes.ts`: `meshNames(record)`, `toggleMeshes(hidden, names)`, `setMeshesVisible(hidden, names, visible)`. The two edit helpers keep the order of the current list and add new names at the end.

## A — Approach

- Contracts: add the schemas, the patch op, the two node definitions in `blueprint-nodes/character.ts`, the field kind, and `meshes.ts`. Mirror the schema, the op, and the record field in `crates/contracts/src/lib.rs`. Add validation vectors for a valid list, a repeated name, a 257-entry list, an empty name, and the op on a non-avatar.
- Host: `vrm.rs` gets `vrm_meshes(json) -> Vec<AssetMesh>` with the R1 rules. `registry.rs` calls it at import and in the backfill branch for a VRM record without `meshes`. The host validates `setHiddenMeshes` through the Rust contract types, as it validates `setVisibility`.
- Session: `scene-ops.ts` applies the op and the effect. The two evaluators in `blueprint-eval/character.ts` read the current list from the working scene and emit the effect.
- Renderer: in `assets.ts`, after the VRM load, copy the node index from `parser.associations` into `userData.gltfNode`. In `renderer.ts`, keep for each avatar root a map from node index to object, built once at bind. Apply `hiddenMeshes` through the record names when the scene or the record changes. No new material, no reload.
- Editor: `BlueprintNodeFields.svelte` gets the `meshes` field kind with the choices from the record of the selected avatar. A new `AvatarMeshFields.svelte` gives the Inspector section; `Inspector.svelte` and the section index list it.
- Session method `meshList {avatarId}` in `session-api.ts` beside `expressionGet`, answered from the scene and the asset records that the session holds (`setAssetRecords`). The schema goes in `schema.ts` (method params and result) and in `crates/contracts/src/lib.rs` (`MeshListParams`, `MeshList`, the method and result checks); the host router lists `meshList` where it lists `expressionGet`.
- MCP: `mesh_list` maps to `meshList` in `apps/mcp/src/tools.ts`, with a description in `server.ts`. One sentence in the `scene_patch` description.

## S — Structure

- New: `packages/contracts/src/meshes.ts`; `packages/contracts/test/meshes.test.ts`; `crates/contracts/tests/character_meshes.rs`; `packages/session/test/character-meshes.test.ts`; `apps/desktop/src/components/AvatarMeshFields.svelte`; `apps/mcp/test/character-meshes.integration.test.ts`; `docs/evaluation/character-mesh-toggles.md` and its headless check script.
- Changed: `packages/contracts/src/schema.ts`, `types.ts`, `index.ts`, `blueprint-nodes/character.ts`, `blueprint-nodes/define.ts`; `fixtures/protocol/validation-vectors.json`; `crates/contracts/src/lib.rs`; `apps/desktop/src-tauri/src/assets/vrm.rs` and `registry.rs` the host patch path, and `service/router.rs`; `packages/session/src/scene-ops.ts`, `session-api.ts`, `session.ts`, `blueprint.ts`, `blueprint-eval/character.ts`; `packages/renderer/src/assets.ts` and `renderer.ts`; `apps/desktop/src/components/BlueprintNodeFields.svelte`, `Inspector.svelte`, `InspectorIndex.svelte`; `apps/mcp/src/server.ts` and `apps/mcp/src/tools.ts` (`mesh_list` and the `scene_patch` description); `docs/evaluation/blueprint-node-audit.md` and the audit data.
- Changed: `ARCHITECTURE.md` (the asset record holds the mesh list; the renderer hides mesh nodes by name from `hiddenMeshes`).
- Changed: `docs/warudo-parity.md` BP-08 and CHR-07 with only the verified behavior. BP-08 stays unchecked.
- No change: the show schema version, the frame format, the OBS page, Tauri IPC for images, the tracking path.

## O — Operations

1. Add `vrm_meshes` with Rust unit tests: node order, the empty name, repeated names, the 128-character cut, the 256-entry limit. Run it on both fixture VRMs: `fixture_vrm_1` gives `Body`, `Face`, `Hair`; `fixture_vrm0_arkit` gives 57 entries.
2. Add the backfill with a Rust test: a stored VRM record without `meshes` gets it at registry load and is written again; a record whose file is missing keeps no `meshes`.
3. Add the schemas, the op, and the vectors. Run the TypeScript and Rust vector tests.
4. Add `meshes.ts` with unit tests: toggle adds and removes; set visible and set hidden; order is kept; a repeated name in the input has one effect.
5. Add the session op and the node evaluators with unit tests: the op on a missing entity and on a camera fails; an empty list removes the field; one undo restores the list; a toggle run twice restores the list; two nodes in one run commit one patch with the final list; a run that changes nothing emits no patch; a node with a missing avatar fails with no state change.
6. Add the renderer map and a renderer test on the `fixture_vrm_1` scene graph (headless, no GPU draw needed): `hiddenMeshes: ['Hair']` hides the `Hair` object and keeps `Body` and `Face`; an unknown name has no effect; an empty list shows all; the entity `visible: false` still hides the root.
7. Add the node field kind and the Inspector section. Check the Editor flow headless where WebGL works: load `fixture_vrm_1`, clear the `Hair` checkbox, see the patch and one undo step; build On Keystroke Pressed → Toggle Character Meshes with `Hair`, run it with Manual Trigger, and see `hiddenMeshes` change twice. If the flow cannot run headless, the parity line stays partial and names the flow that is not checked.
8. Add the MCP integration test: `mesh_list` on the smoke avatar gives its meshes, all with `hidden: false`; `scene_patch` with `setHiddenMeshes` on the smoke avatar, read `mesh_list` and see `hidden: true` on that mesh; a name that the record does not list shows in `unknown`; build a Toggle Character Meshes graph through `blueprint_edit`, trigger it, and see the list change; a `setHiddenMeshes` on a camera returns `Entity is not an avatar`.
9. Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo fmt --check`, `cargo clippy`, and `cargo test --workspace`.
10. Ask a reviewer on a different model for defects against these requirements.
11. Update the parity lines with the source commit, the platform, the tests and captures, and the remaining gaps. Update `ARCHITECTURE.md`.

## N — Norms

Functional TypeScript and plain data. Match the compact style of `blueprint-nodes/scene.ts`, `expressions.ts`, and `vrm.rs`. Controls come from `@oshi-connect/ui`. UI copy is the node labels, the section title, and the mesh names, with no helper text or empty state (constitution principle 1). No badge on a hidden mesh (principle 2). The mesh list is a JSON field on the entity and on the asset record, not new columns (principle 7). Unit tests for the name rules and the list edits; integration tests at the Rust record, the MCP boundary, and the renderer scene graph; no test of static copy. Prose follows ASD-STE100.

## S — Safeguards

- Do not change the show schema version or the meaning of `visible`.
- Do not drop or rewrite a `hiddenMeshes` name when the model changes or the name is unknown.
- Do not reload or re-import a model to hide a mesh. Do not change a material to hide a mesh.
- Do not send mesh or image data through Tauri IPC on the output path.
- Do not add a prop attachment, a physics body, or a collider in this slice.
- Do not claim BP-08 on macOS or in OBS from the cloud run. The hidden mesh on the OBS output with alpha, the Inspector flow in the macOS app, and a hotkey toggle during tracking need an owner check on macOS (`accept:local`).
