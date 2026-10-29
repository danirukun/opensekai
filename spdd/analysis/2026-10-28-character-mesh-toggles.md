# Character mesh toggles analysis

Issue: [#88](https://github.com/danirukun/opensekai/issues/88) (BP-08). Queue bundle B26. Mode: contract-first. This is slice 1 of BP-08. It covers clothes and accessory toggles on a character model. Prop interactions are known gaps.

## Problem

BP-08 names three things: clothes, accessory toggles, and prop interactions. OpenSekai can show or hide a whole entity, but it cannot show or hide one part of a character model. An operator who has a jacket, a hat, or headphones as a separate mesh in a VRM cannot remove it during a stream. The issue is a roadmap issue, not a task contract, so it needs a bounded slice first.

## Handbook recheck

The handbook was read on 2026-10-28.

- [Toggling Clothing & Accessories](https://docs.warudo.app/docs/blueprints/tutorials/toggle-meshes): On Keystroke Pressed (Ctrl+Shift+J) → **Toggle Character Meshes**. The node has a **Character** selector and a **Meshes** list (the **+** button adds an entry; each entry selects one mesh of the model). Each press toggles each listed mesh. A copy of the two nodes with Ctrl+Shift+H and the "headphones" mesh gives a second toggle. "Models exported from VRoid Studio only have two meshes: Body and Face." Detailed models split clothes, accessories, tails, and animal ears into separate meshes.
- [Character asset](https://docs.warudo.app/docs/assets/character): "You can toggle meshes and skinned meshes on the model." The Meshes section of the asset also has Default BlendShapes and Default Material Properties. Toggle Character Meshes is the only mesh node that the page names.
- [Prop asset](https://docs.warudo.app/docs/assets/prop): a prop is "a 3D model that can be placed freely within a scene or attached to a character as an accessory". Transform Attachment attaches a prop to a human bone, or to any transform with Attachment Type Transform Path, with an optional hand pose. Collision Detection is off by default. A prop also has a Meshes section. "A prop asset is a persistent model in the scene, and it does not have a physics body."
- [Squashing the Head with Props](https://docs.warudo.app/docs/blueprints/tutorials/squashing) and [Buried by Plushies](https://docs.warudo.app/docs/blueprints/tutorials/buried): **Throw Prop At Character** makes a temporary physics object (not a prop asset) that hits the character. They also use Get Random Prop, Activate Character Ragdoll, Set Character Bone Scale, Multi Gate, and For Loop.

## Existing material

- `packages/contracts/src/schema.ts`: the `avatar` entity has `assetId`, `tracking`, `idleAnimation`, and `expressions`. `visible` (from the entity base) is the only visibility flag, and it covers the whole entity. Entity kinds: `mesh` (the prop kind, a box or a stored GLB), `avatar`, `tracking`, `environment`, `light`, `haze`, `fpsCounter`, `vmcSender`, `camera`. No entity has a parent or a bone attachment.
- `AssetRecordSchema` stores `expressions`, `eyeBones`, and `rig`. It stores no list of meshes, materials, or nodes.
- `apps/desktop/src-tauri/src/assets/vrm.rs` reads the glTF JSON of a VRM at import (expressions, rig, eye bones). `registry.rs` backfills fields that an older record does not have from the stored file (name, expressions, rig) in two paths: `load_library` writes the record again, and `AssetRegistry::load(manifest)` (fixture manifests) backfills in memory only.
- Patch ops for an entity: `createEntity`, `removeEntity`, `renameEntity`, `setTransform`, `setVisibility`, and others. The Rust mirror (`crates/contracts/src/lib.rs`) uses `deny_unknown_fields`, so a new field or op needs a Rust change. Validation vectors are in `fixtures/protocol/validation-vectors.json`, read by Rust and TypeScript.
- Blueprint nodes `scene.setVisibility` and `scene.toggleVisibility` (`blueprint-nodes/scene.ts`) emit effects that `session/src/scene-ops.ts` turns into a `setVisibility` patch. The result is committed scene state (a new revision), not a runtime override. `applyEffects` resolves a toggle against the running scene of the run. OpenSekai has no scene undo; only Blueprint graph edits have undo (OSE-09 is open). The `character.*` nodes take an avatar field (`avatar` kind) and an expression field whose choices come from the asset record (`BlueprintNodeFields.svelte`, `expressionChoices`). The Rust host checks a node type only by its shape, so a new node type needs no Rust change.
- The renderer sets `object.visible` on the entity root only (`renderer.ts` `applyTransform`). VRMs load through `GLTFLoader` with `VRMLoaderPlugin` (`assets.ts`). `parser.associations` maps each loaded object to its glTF node index. Avatars are built from the loaded VRM and are not cloned; only props and environments are cloned. The renderer has no asset record, only the asset bytes, so it must make the mesh names from the glTF JSON itself.
- No physics, collider, raycast into the scene, ragdoll, or prop attachment exists. Spring bones are off in the renderer (CHR-08). CHR-07 (bone attachment points and visibility/material control), CHR-09 (collision), and ENV-03 (prop import and attachments) are open. An owner pull request (#242, ENV-03 slice 1) adds props from a model library and is not merged.
- Fixtures: `fixture_vrm_1` has three mesh nodes (`Body`, `Face`, `Hair`). `fixture_vrm0_arkit` has 57 mesh nodes (`Face`, `Body`, `Hair001` to `Hair055`).

## Findings

1. The clothes and accessory toggles of the tutorial need two things that do not exist: a list of the meshes of a character model, and a scene field that hides some of them. The Blueprint node, the Inspector control, and MCP can then use the normal patch path.
2. A glTF mesh is a node with a `mesh` index. The node name is the name that an operator sees in Unity and in Warudo. The node index is stable for one stored file (an asset is content addressed by its SHA-256). Names can be empty or repeated, so the importer must make each name unique.
3. A mesh toggle is a scene state that the operator expects to stay after a save, as Set Visibility does. A runtime override (the B13 H layer) would drop the state at the next show open. So the toggle is a committed patch, as Set Visibility is.
4. A hidden node in three.js hides its children too. A glTF mesh node can have child mesh nodes (for example a hat with a ribbon). Warudo hides the GameObject, which also hides its children in Unity. The behavior is the same.
5. The mesh list belongs to the asset, so the importer reads it once. Records from before this slice need a backfill from the stored file, as the registry already does for the rig. The renderer cannot read the record, so the name rule must exist in Rust and in TypeScript, with shared vectors so that the two give the same names.
6. Prop interactions in Warudo (Throw Prop At Character, collisions, ragdoll) need a physics body, colliders on the character, and temporary objects. OpenSekai has none of them (CHR-09, BP-10). They are prerequisites, not toggle work.
7. An accessory as a prop on a bone (Transform Attachment) is CHR-07 and ENV-03 work. The owner pull request #242 changes the prop model now. A bone attachment in this slice would conflict with it. A prop that exists in the scene can already be toggled with Toggle Visibility.

## Questions resolved without the owner (reversible)

- **Slice scope.** Slice 1 is the character mesh toggles only. Prop attachment to a bone waits for ENV-03 (#242). Prop interactions wait for physics (finding 6). Alternative: one contract for all three. Rejected, because the attachment would conflict with #242 and the physics part has no engine to stand on.
- **Mesh identity.** The glTF node index is the key in the asset record. The unique node name is the key in the scene and in the Blueprint. Alternative: the node index in the scene. Rejected, because a show is easier to read and to edit through MCP with names, and the asset of an avatar does not change under a name.
- **Unique names.** Lengths count UTF-16 code units, as the other name checks do. An empty name becomes `Mesh <node index>`. A repeated name gets ` (2)`, ` (3)`, and so on, in node order. Alternative: the raw name, with the first match only. Rejected, because a second mesh with the same name could not be toggled.
- **Scene field.** The avatar entity gets `hiddenMeshes`, a list of names. The default (no field, or an empty list) shows all meshes, so each saved show keeps its look. Alternative: a map of name to boolean. A list is smaller and has one meaning for each name.
- **Unknown names.** A hidden name that is not in the asset (after a model change) is kept in the scene and has no effect. The Inspector does not show it. Alternative: drop it at the model change. Rejected, because a change back to the first model would lose the state.
- **Patch op.** One op, `setHiddenMeshes {entityId, hiddenMeshes}`, that replaces the list. Alternative: a show and hide op for each mesh. One op gives one revision for each Inspector click, and a run of several nodes commits one revision.
- **Node effects.** The nodes emit deltas (toggle these names, or set these names visible), and `applyEffects` resolves them against the running scene. An absolute list from the node would lose the change of an earlier node in the same run, because the working scene advances only after the run.
- **Nodes.** `Toggle Character Meshes` (as in Warudo) and `Set Character Meshes Visible` with a boolean input (as Set Visibility). Warudo has only the toggle. The set node gives a reset path without a toggle state, and it is the same pair that OpenSekai has for entity visibility.
- **Mesh list on the node.** A node field of kind `meshes`: a list of at most 16 names, chosen from the meshes of the selected avatar. Alternative: a list data input. Rejected for this slice, because the B13 list type has no mesh element type, and the tutorial uses a fixed list.
- **Inspector.** A `Meshes` section on an avatar with one checkbox for each mesh. Alternative: no Inspector control (Warudo has one, so it stays).
- **MCP read.** A new read tool `mesh_list {avatarId}` gives the mesh names of a character and their state, as `expression_get` does for expressions. Alternative: add the mesh list to `asset_list`. Rejected, because a page of summaries would carry up to 256 names for each avatar.
- **Default BlendShapes and Default Material Properties.** Not in this slice (CHR-07, CHR-03). They do not change visibility.

## Risks

- A record written with `meshes` does not load in an older app build, because the Rust record type rejects an unknown field. An owner who goes back to an older build loses those avatars from the library until a re-import. The same is true for each earlier record field (rig, eye bones).
- The fixture checks run only where `fixtures/local` has the VRMs; the name rule and the renderer test use vectors and a glTF built in the test, so they run everywhere.

- A model with many mesh nodes (the fixture has 57) gives a long Inspector list. The list is in a collapsible section and has no extra copy. A search field is a later change.
- A hidden mesh that a VRM expression uses (for example a material color bind) keeps the expression state; only the draw stops. This matches Warudo.
- A mesh that the first-person settings of a VRM hide in a first-person view is not affected; OpenSekai does not use VRM first-person layers.
- The look of a hidden jacket on the OBS output, with alpha, needs an owner check on macOS (`accept:local`).
