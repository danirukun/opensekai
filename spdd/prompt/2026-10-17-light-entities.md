# REASONS: Light entities

Date: 2026-10-17. Scope: bundle B9 (#45 ENV-07 first subset, #39 ENV-01 lighting part). Analysis: [light entities](../analysis/2026-10-17-light-entities.md). Related: [environment import](2026-10-13-environment-import.md), [Blueprint property targets](2026-10-15-blueprint-property-targets.md), [quality controls](2026-10-16-quality-controls.md).

This file is the contract only. The implementation run starts after the owner merges it. The [Warudo Lights](https://docs.warudo.app/docs/assets/lights) and [Warudo Environment](https://docs.warudo.app/docs/assets/environment) pages were read on 2026-10-17. They name the light types, Color, Intensity, the three affect settings, Shadow, the default directional light in a new scene, and the environment settings. They do not give defaults, ranges, or a light limit; those are OpenSekai choices.

## R — Requirements

### Light entity (ENV-07)

R1. The scene schema has an entity kind `light` with the base fields and a required `light` group: `{ type: 'directional' | 'point', color, intensity, range, affectCharacters, affectProps, affectEnvironment, shadow }`. `color` is a lowercase `#rrggbb` sRGB string. `intensity` is a finite number from 0 to 1000. `range` is a finite number from 0 to 1000 in meters; 0 means no limit; a directional light ignores it. The three affect flags are booleans. `shadow` is `{ enabled: boolean, intensity: 0..1, soft: boolean, bias: -0.01..0.01, normalBias: 0..1 }`. TypeScript (zod, strict objects) and Rust accept and write the same shape. A show without a light loads without change.
R2. The `SceneViewSchema` budget rule and the Rust `SceneView::validate` reject a scene with more than 8 light entities, or with more than 2 lights that have `shadow.enabled: true`. Hidden lights count toward both limits. Thus `scenePatch` (including `createEntity`), `sceneReplace`, and show load all reject it with the existing budget message. Rust validates each `LightSettings` field with the same ranges and the same color pattern as zod.
R3. The patch operation `{ kind: 'setLight', entityId, light }` replaces the group. It fails with `INVALID_INPUT` for an entity that is not a light and with `NOT_FOUND` for an unknown entity. It goes through the normal patch route ([command path](../../ARCHITECTURE.md#command-path)). MCP reaches it through `scene_patch`, and `scene_inspect` returns lights. The `scene_patch` tool description in `apps/mcp` names `setLight` and `setEnvironmentReflections`. `setTransform`, `setVisibility`, `renameEntity`, `removeEntity`, and Duplicate work on a light as on other entities; Duplicate copies the group without change.
R4. A light shines along its local −Z axis. A directional light lights each affected material from that direction; its position has no effect on its light. The renderer places the three.js `DirectionalLight` at the world origin − 50 m × the direction and its `target` at the world origin, and it updates both from the entity rotation on each frame. A point light lights from its position with physical falloff (three.js `decay` 2) and `distance` = `range`. Each three.js light and each directional target stays in the scene graph, so that matrices and shadows update.
R4a. Light entities do not go through the asset load path, the load status overlay, or `applyTransform` of `renderer.ts`. `scene-lights.ts` reconciles them. The Rust `SceneEntity` helpers (ID, name, transform) handle the new variant.
R5. When a scene has no `light` entity, each renderer client adds the built-in directional light as today (white, intensity 3, from `[2, 4, 3]` toward the origin), which affects all materials and has no shadow. When a scene has at least one light entity, the renderer draws only those lights and the ambient light; when all of them have their affect flags off, only the ambient light remains. The ambient light (white, intensity 1, on all materials) does not change.
R6. The renderer puts each lit material in one group: characters (avatar entities), props (`mesh` entities), or environment (the `environment` entity). For each group it sets `material.lightsNode` to one `lights([...])` node with the ambient light and each light whose matching affect flag is true. Prop and environment instances get per-instance copies of each lit material (standard, physical, Phong, Lambert, toon, and MToon), not only of standard materials as `environment-light.ts` does today, and each copy is disposed with its instance. Thus a change for one instance does not change another instance of the same asset. A material that a reload or model change replaces gets its group `lightsNode` before `compileAsync`. Unlit materials do not change.
R7. A light with `visible: false` stays in its node sets with intensity 0, so a visibility change does not recompile a material. A hidden light with a shadow keeps `castShadow`, so it still renders its shadow map; this cost is accepted to avoid a recompile. A change of `type`, of an affect flag, of `shadow.enabled`, or of the light count rebuilds the node sets. A change of color, intensity, range, transform, or another shadow value updates the three.js light only.
R8. When at least one light has a shadow, the renderer turns on its shadow map (PCF filter), and each avatar, prop, and environment mesh casts and receives shadows. A directional shadow uses a 2048 px map and an orthographic shadow camera of 20 m × 20 m centered on the world origin, from 0.5 m to 100 m along the light direction. A point shadow uses a 1024 px map for each face. `shadow.intensity`, `bias`, and `normalBias` map to the three.js `LightShadow` fields. `soft: true` sets the shadow radius to 4, `soft: false` to 1. A shadow shows only on the materials that the light affects (R6). On WebGPU, a node-set rebuild with a shadow compiles the scene before the next draw, because three.js 0.180 leaves a directional shadow that is first set up during a draw empty; WebGL 2 does not compile there, because that compile leaves a later shadow empty ([evidence](../../docs/evaluation/light-entities.md#renderer-probe-o3)). An object that the renderer hides (for example the environment for a camera with `renderEnvironment: false`) casts no shadow. The quality profiles do not change.
R9. The renderer applies a light change on the next frame. The Scene window preview and the OBS output draw the same lights. The OBS output draws no editor helper.
R9a. (Added after the owner QA on #202, option 3.) On WebGPU, when a render pipeline fails to compile, the renderer logs one `Pipeline compile failed` line with the error, the label, and the deepest bracket nesting, followed by the vertex and fragment WGSL, once for each distinct shader pair (at most 16). Each frame acknowledgment carries the warning `UNSUPPORTED Pipeline compile failed` until the next node-set rebuild. The renderer does not try to recover; recovery is a later decision.

### Editor (ENV-07)

R10. The Add menu has **Directional Light** and **Point Light**. A directional light is `{ type: 'directional', color: '#ffffff', intensity: 3, range: 0, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 } }` with the rotation of the built-in light: quaternion `[-0.3890, 0.2648, 0.1178, 0.8745]` (−Z along the normalized −`[2, 4, 3]`, no roll; tests compare with a tolerance of 1e-4). Its position is `[2, 4, 3]`, so the helper shows near the old light. A point light has `type: 'point'`, intensity 20 (5 at 2 m with decay 2, near the ambient level), range 10, position `[0, 2, 1]`, and the same other values. Both items are disabled at 8 lights.
R11. `makeEmptyScene` adds one Directional Light entity with the R10 values, so a new scene starts with a directional light, as in Warudo. The run updates the desktop tests that count the empty-scene entities (`apps/desktop/test/authoring.test.ts` and the tests that use `makeEmptyScene().entities`). The Rust smoke scene, the evaluation scenes, and the protocol vectors for existing scenes do not change.
R12. The Hierarchy shows a **Lights** group after **Environment** and before **Cameras**.
R13. The Inspector for a light shows Name, Visible, Transform, Type (select), Color (kit `Input`, `#rrggbb`), Intensity, Range (point only), Affect Characters, Affect Props, Affect Environment, and Shadow. When Shadow is on, it shows Shadow Intensity, Soft Shadows, Bias, and Normal Bias. Each change sends `setLight`. A rejected change (for example a third shadow) shows the scene value again. A directional light has a **Set Direction From Main Camera** action that sends one `setTransform` with the light position and the rotation of the `output_main` camera.
R14. The editor viewport draws a pickable helper for each light: a disc for a point light, a disc and an arrow along −Z for a directional light, in the light color. A click selects the light. For a point light the gizmo moves it. For a directional light the gizmo turns it; a move changes only the helper place, which has no effect on the light (R4). The helpers exist only in the editor viewport (`assertEditorScope`).

### Environment lighting (ENV-01)

R15. An environment entity has an optional `reflectionsIntensity`: a finite number from 0 to 2. A missing field means 1. The patch operation `{ kind: 'setEnvironmentReflections', entityId, reflectionsIntensity }` sets it, with the same errors as `setEnvironmentModel`. The renderer sets `envMapIntensity` on each environment material copy (R17 of the environment import contract). The environment Inspector shows **Reflections Intensity** under Source.
R16. File lights stay removed at import. The environment import contract does not change.

### Blueprints

R17. The property registry adds `light` to the kinds of `position`, `rotation`, and `visible`, not of `scale`. It adds `{ key: 'intensity', label: 'Intensity', kinds: ['light'], type: 'number', rule: { kind: 'range', min: 0, max: 1000 } }`. Set Asset Property and Get Asset Property read and write it through the existing override path. `PROPERTY_KEYS`, `readProperty`, and the write function get the key. `overrides.ts` commits an idle `intensity` override with one `setLight` that carries the full group with the new intensity. An exported Blueprint file names a light reference with the kind `light`. No Blueprint node type is added, so the node audit table (`tools/evaluation`) does not change; the registry tests change for the new key. The node audit table and the Blueprint catalog change only where the registry feeds them.

### Documents

R18. `docs/warudo-parity.md` records only the verified subset. ENV-07 and ENV-01 stay unchecked until the owner verifies the macOS and OBS parts. `ARCHITECTURE.md` replaces the fixed-light sentence with the light entities, the built-in light rule, the `lightsNode` groups, and the shadow map.

## E — Entities

- `LightShadow = { enabled: boolean; intensity: number; soft: boolean; bias: number; normalBias: number }`.
- `LightSettings = { type: 'directional' | 'point'; color: string; intensity: number; range: number; affectCharacters: boolean; affectProps: boolean; affectEnvironment: boolean; shadow: LightShadow }`.
- `SceneEntity` (light): `{ id, name, visible, transform, kind: 'light', light: LightSettings }`. Rust: `SceneEntity::Light { light: LightSettings }`.
- `SceneEntity` (environment): adds `reflectionsIntensity?: number`.
- `PatchOp`: `setLight { kind, entityId, light }`, `setEnvironmentReflections { kind, entityId, reflectionsIntensity }`. Rust: `PatchOp::SetLight`, `PatchOp::SetEnvironmentReflections`.
- `PropertyKey`: adds `intensity`.
- Editor: `AddKind` adds `directionalLight` and `pointLight`.
- Renderer (pure): `lightGroups(entities) → { characters: Id[]; props: Id[]; environment: Id[] }` and `lightSignature(entities) → string` (the values in R7 that rebuild the node sets).

## A — Approach

Add the contracts first in TypeScript and Rust with shared vectors. Then the session operations and the property registry. Then check in a headless WebGPU render on the software adapter that MToon accepts `lightsNode` and receives a shadow; stop and ask the owner if it does not. Then the renderer: light reconcile, groups, node sets, shadows, and the built-in light rule. Then the editor: Add menu, Hierarchy, Inspector, helpers, and Set Direction From Main Camera. Leave the macOS and OBS checks to the owner.

## S — Structure

- `packages/contracts/src/schema.ts` (light group, entity, budget rule, environment field, patch operations), `types.ts`, `index.ts`, `property-registry.ts`; `packages/contracts/test/light-entity.test.ts` (new).
- `crates/contracts/src/lib.rs`; `crates/contracts/tests/light.rs` (new); `fixtures/protocol/validation-vectors.json`.
- `packages/session/src/scene-ops.ts`, `overrides.ts`; `packages/session/test/light-patch.test.ts` (new).
- `packages/renderer/src/scene-lights.ts` (new: reconcile, groups, node sets, shadows), `renderer.ts`, `environment-light.ts` (reflections intensity, prop copies), `editor-viewport.ts` (helpers and picks); renderer tests.
- `apps/desktop/src/editor/authoring.ts`, `live-fields.ts`, `model.ts`; `components/Hierarchy.svelte`, `Inspector.svelte`, `LightFields.svelte` (new), `EnvironmentFields.svelte`; desktop tests.
- `apps/mcp` tests for `scene_patch` with `setLight`.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/light-entities.md` (new).

## O — Operations

1. Contracts: the light group, the light entity, the budget rule (R2), the environment field, and the two operations. Rust mirror. Vectors: a directional light, a point light, a bad color, an intensity above 1000, nine lights (reject), three shadow lights (reject), an environment with and without `reflectionsIntensity`, and both operations.
2. Session: apply `setLight` and `setEnvironmentReflections`. Property registry: R17. Tests for each error and for a Blueprint override of `intensity`.
3. Renderer probe: a headless WebGPU render of the fixture VRM on a box floor with one directional light with a shadow. Check that MToon pixels change when `affectCharacters` changes, and that the floor under the character is darker than the floor away from it. Repeat with a point light shadow. Record the result in the evidence file. If MToon does not accept `lightsNode` or a directional or point shadow, stop and ask the owner.
4. Renderer: `scene-lights.ts` with the pure `lightGroups` and `lightSignature`, reconcile of three.js lights from the frame, the node sets (R6, R7), the shadow setup (R8), the built-in light rule (R5), and reflections intensity (R15). Unit tests for the pure functions. Headless render checks: a point light brightens a box; a light change shows in the next applied frame; `affectEnvironment: false` keeps the environment pixels of the fixture stage as with the light hidden; a visibility change does not change `lightSignature`.
5. Editor: R10 to R14 and the Reflections Intensity field. Model tests for the factories, the disabled items, and Set Direction From Main Camera. Headless Chromium check of the editor flow: add a point light, change its color, pick its helper, and drag it.
6. Documents: `docs/evaluation/light-entities.md` with the commit, platform, backend, each check and its raw result, and the gaps; parity rows for ENV-07 and ENV-01 with the verified subset only (the ENV-01 lighting part stays open until the owner check); a note in the evidence file that the built-in light comes back with no signal in the Inspector or MCP when the last light is removed; `ARCHITECTURE.md` (R18).

## N — Norms

- Unit tests for the schemas, the Rust mirror, the patch operations, the registry key, the light groups, and the signature. Shared vectors keep TypeScript and Rust equal.
- Headless render checks on the software adapter are functional checks only. They do not prove the look or the cost on a real GPU.
- UI copy is the control label only (constitution principle 1). Controls come from `@oshi-connect/ui`.
- Functional TypeScript and plain data. The pure light functions have no three.js object state.

## S — Safeguards

- Do not change the show file version or the quality profiles.
- Do not change an old show's lights: a scene without a light entity renders as today (R5).
- Do not import `KHR_lights_punctual` lights. Do not loosen the import checks.
- Do not draw an editor helper in the OBS output or in a capture.
- Do not read images back in the OBS output path.
- Do not claim a macOS, OBS, or GPU result. These stay for the owner: the light look on MToon and on the environment in WebGPU on macOS, a character shadow on an environment floor in OBS with alpha, the MToon look under a point light, shadow acne and the bias defaults on a real GPU, the look of soft (radius 4) and hard (radius 1) shadows at 2048 px and 1024 px, the frame cost of 8 lights and of 2 point shadows (12 shadow passes) at 60 fps in OBS, the recompile hitch in OBS when a light is added, and continued motion while the editor is minimized.
