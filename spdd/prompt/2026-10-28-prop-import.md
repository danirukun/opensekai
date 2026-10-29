# REASONS: Prop import

Date: 2026-10-28. Scope: ENV-03 slice 1. Props from the scene model library, each with its own transform, any number in each scene, and one model for more than one prop. Analysis: [prop import](../analysis/2026-10-28-prop-import.md). Issue: [GitHub #41](https://github.com/danirukun/opensekai/issues/41).

## R — Requirements

R1. The asset source of a `mesh` entity is `{ kind: 'asset', assetId: Id | null }` in TypeScript (zod) and Rust. The key is required. A show with a box source or an asset source with an ID validates without change.
R2. The operation `setMeshModel { entityId, assetId: Id | null }` sets the source of a mesh to `{ kind: 'asset', assetId }`. It fails with `INVALID_INPUT` for an entity that is not a mesh and with `NOT_FOUND` for an unknown entity. It is in `PatchOp`, `LivePatchOp`, and the Rust `PatchOp`.
R3. The renderer draws nothing for a mesh with an asset source and `assetId: null`. A mesh with a box source draws the box, as before.
R4. The lit materials of a prop copy get the PMREM room map, as the environment does. This changes R17 of the [environment import](2026-10-13-environment-import.md) contract, which gave the map to the environment only. The reflections intensity of each prop is the `reflectionsIntensity` of the environment entity of the scene, or 1 when the scene has no environment or the value is absent. A change of that value applies to the props in the next frame. With an ambient light entity, the room map of a prop follows the same rule as the environment ([stage lights](2026-10-18-stage-lights.md) R4a).
R5. Props stay in the `props` light group. A light with Affect Props off does not light them. Props cast and receive shadows as before. A prop is a viewport pick target, and the transform gizmo moves it.
R6. The Add menu has **Prop** after **Environment**. It creates `{ kind: 'mesh', name: 'Prop', visible: true, source: { kind: 'asset', assetId: null } }` with an identity transform. A second prop is `Prop 2`, as for the other kinds. The item is disabled only by the 64-entity scene limit.
R7. The Inspector for a mesh with an asset source shows Name, Visible, Transform, and a **Prop** section with a **Source** select. The options, the import row, the load status, the failure message, and the credits are the same as for the environment (environment contract R22 and R23). A record option or `Choose model…` sends `setMeshModel`. The Prop section has no Reflections Intensity. The Inspector for a mesh with a box source shows Name, Visible, and Transform only.
R8. `Import file…` in the Prop section opens `import_scene`. A returned record sends `setMeshModel` for that prop. The environment and the other props do not change. A cancelled dialog keeps the current value. The dialog title is `Import model`, and its filter (not on macOS) is `Model`.
R9. One library record can be the source of the environment and of any number of props. Duplicate of a prop keeps its source. Each prop draws its own copy. The asset loads once for each renderer client.
R10. MCP `scene_patch` accepts `createEntity` with a mesh and `setMeshModel`. The `asset_list` description names `setMeshModel` next to `setEnvironmentModel`. The `scene_patch` description says how to add a prop.
R11. Save As and Open keep each prop and its source. A prop with an unknown `assetId` opens and shows `Missing model`.
R12. Blueprint Get Asset Property, Set Asset Property (Position, Rotation, Scale, Visible), and Move Entity accept a prop. The property registry already allows `mesh`; this slice adds no code for it.

## E — Entities

- `SceneEntity` (mesh): `{ id, name, visible, transform, kind: 'mesh', source: { kind: 'box' } | { kind: 'asset', assetId: Id | null } }`.
- `PatchOp`: `setMeshModel { kind, entityId, assetId }`.
- `AddKind`: adds `prop`.
- `InspectorSection`: a mesh with an asset source has `transform` and `prop` (label `Prop`).

## A — Approach

Reuse the environment parts. The Prop section is the environment source field without Reflections Intensity. The editor import handler chooses `setEnvironmentModel` or `setMeshModel` from the kind of the target entity. The renderer applies the room map to each scene-model copy and reads the reflections intensity of props from the environment entity once each frame. No new asset format, record kind, or Tauri command.

## S — Structure

- `packages/contracts`: `schema.ts` (mesh source, `PatchOpSchema`), `types.ts` (`LivePatchOp`).
- `crates/contracts`: `MeshSource::Asset` with `Option<Id>`, `PatchOp::SetMeshModel`.
- `packages/session`: `scene-ops.ts` applies `setMeshModel`.
- `packages/renderer`: `renderer.ts` (null asset source, room map and reflections for props).
- `apps/desktop/src`: `editor/live-fields.ts` (`AddKind`), `editor/authoring.ts` (factory), `components/Hierarchy.svelte` (Add item), `editor/inspector-sections.ts`, `components/Inspector.svelte`, `editor/model.ts` (`setMeshModel`), `EditorApp.svelte` (import target).
- `apps/desktop/src-tauri/src/lib.rs`: dialog title and filter label.
- `apps/mcp/src/server.ts`: descriptions.

## O — Operations

1. Contracts: schema, types, Rust mirror, and their tests.
2. Session: `setMeshModel` and its test.
3. Renderer: null source, room map, and reflections for props, with tests.
4. Editor: Add item, factory, sections, Inspector, model method, import target, with unit tests.
5. Tauri dialog title and MCP descriptions.
6. macOS check in the running build with the Bonnie props, through the Editor and MCP: Add › Prop, Source, Import file…, Duplicate, two props from one model, a prop and the environment from separate models, the transform gizmo, Affect Props, Reflections Intensity, Save As and Open, and OBS output.
7. Evidence, parity checklist, and ARCHITECTURE.md when its text becomes false.

## N — Norms

Use `@oshi-connect/ui` controls. Keep UI copy to the labels in R6 to R8. Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript. Follow the one-operation-for-each-property pattern. Do not commit third-party models.

## S — Safeguards

- Do not change the asset record format, the library folder, or the import limits.
- Do not change the look of avatars or of the environment.
- Do not claim Attach To, Override Hand Pose, BlendShapes, material properties, mesh switches, collision, or Windows support from this slice.
- An old build does not open a show with a prop that has no model. Record this in the evidence.
