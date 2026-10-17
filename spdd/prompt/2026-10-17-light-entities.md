# REASONS: Light entities

Date: 2026-10-17. Scope: bundle B9 (#45 ENV-07 first subset, #39 ENV-01 lighting part). Analysis: [light entities](../analysis/2026-10-17-light-entities.md). Related: [environment import](2026-10-13-environment-import.md), [Blueprint property targets](2026-10-15-blueprint-property-targets.md), [quality controls](2026-10-16-quality-controls.md).

This file is the contract only. The implementation run starts after the owner merges it. The [Warudo Lights](https://docs.warudo.app/docs/assets/lights) and [Warudo Environment](https://docs.warudo.app/docs/assets/environment) pages were read on 2026-10-17. They name the light types, Color, Intensity, the three affect settings, Shadow, the default directional light in a new scene, and the environment settings. They do not give defaults, ranges, or a light limit; those are OpenSekai choices.

## R — Requirements

### Light entity (ENV-07)

R1. The scene schema has an entity kind `light` with the base fields and a required `light` group: `{ type: 'directional' | 'point', color, intensity, range, affectCharacters, affectProps, affectEnvironment, shadow }`. `color` is a lowercase `#rrggbb` sRGB string. `intensity` is a finite number from 0 to 1000. `range` is a finite number from 0 to 1000 in meters; 0 means no limit; a directional light ignores it. The three affect flags are booleans. `shadow` is `{ enabled: boolean, intensity: 0..1, soft: boolean, bias: -0.01..0.01, normalBias: 0..1 }`. TypeScript (zod, strict objects) and Rust accept and write the same shape. A show without a light loads without change.
R2. The `SceneViewSchema` budget rule rejects a scene with more than 8 light entities, or with more than 2 lights that have `shadow.enabled: true`. Thus `scenePatch` (including `createEntity`), `sceneReplace`, and show load all reject it with the existing budget message.
R3. The patch operation `{ kind: 'setLight', entityId, light }` replaces the group. It fails with `INVALID_INPUT` for an entity that is not a light and with `NOT_FOUND` for an unknown entity. It goes through the normal patch route ([command path](../../ARCHITECTURE.md#command-path)). MCP reaches it through `scene_patch`, and `scene_inspect` returns lights. `setTransform`, `setVisibility`, `renameEntity`, `removeEntity`, and Duplicate work on a light as on other entities; Duplicate copies the group without change.
R4. A light shines along its local −Z axis. A directional light lights each affected material from that direction; its position has no effect on its light. A point light lights from its position with physical falloff (three.js `decay` 2) and `distance` = `range`.
R5. When a scene has no `light` entity, each renderer client adds the built-in directional light as today (white, intensity 3, from `[2, 4, 3]` toward the origin), which affects all materials and has no shadow. When a scene has at least one light entity, the renderer draws only those lights and the ambient light. The ambient light (white, intensity 1, on all materials) does not change.
R6. The renderer puts each lit material in one group: characters (avatar entities), props (`mesh` entities), or environment (the `environment` entity). For each group it sets `material.lightsNode` to one `lights([...])` node with the ambient light and each light whose matching affect flag is true. Prop instances get per-instance material copies, as environment instances do (`environment-light.ts` pattern). Unlit materials do not change.
R7. A light with `visible: false` stays in its node sets with intensity 0, so a visibility change does not recompile a material. A change of `type`, of an affect flag, of `shadow.enabled`, or of the light count rebuilds the node sets. A change of color, intensity, range, transform, or another shadow value updates the three.js light only.
R8. When at least one light has a shadow, the renderer turns on its shadow map (PCF filter), and each avatar, prop, and environment mesh casts and receives shadows. A directional shadow uses a 2048 px map and an orthographic shadow camera of 20 m × 20 m centered on the world origin, from 0.5 m to 100 m along the light direction. A point shadow uses a 1024 px map for each face. `shadow.intensity`, `bias`, and `normalBias` map to the three.js `LightShadow` fields. `soft: true` sets the shadow radius to 4, `soft: false` to 1. A shadow shows only on the materials that the light affects (R6). The quality profiles do not change.
R9. The renderer applies a light change on the next frame. The Scene window preview and the OBS output draw the same lights. The OBS output draws no editor helper.

### Editor (ENV-07)

R10. The Add menu has **Directional Light** and **Point Light**. A directional light is `{ type: 'directional', color: '#ffffff', intensity: 3, range: 0, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 } }` with the rotation of the built-in light (−Z along the normalized −`[2, 4, 3]`). A point light has `type: 'point'`, intensity 10, range 10, position `[0, 2, 1]`, and the same other values. Both items are disabled at 8 lights.
R11. `makeEmptyScene` adds one Directional Light entity with the R10 values, so a new scene starts with a directional light, as in Warudo.
R12. The Hierarchy shows a **Lights** group after **Environment** and before **Cameras**.
R13. The Inspector for a light shows Name, Visible, Transform, Type (select), Color (kit `Input`, `#rrggbb`), Intensity, Range (point only), Affect Characters, Affect Props, Affect Environment, and Shadow. When Shadow is on, it shows Shadow Intensity, Soft Shadows, Bias, and Normal Bias. Each change sends `setLight`. A rejected change (for example a third shadow) shows the scene value again. A directional light has a **Set Direction From Main Camera** action that sends one `setTransform` with the light position and the rotation of the `output_main` camera.
R14. The editor viewport draws a pickable helper for each light: a disc for a point light, a disc and an arrow along −Z for a directional light, in the light color. A click selects the light, and the gizmo moves or turns it. The helpers exist only in the editor viewport (`assertEditorScope`).

### Environment lighting (ENV-01)

R15. An environment entity has an optional `reflectionsIntensity`: a finite number from 0 to 2. A missing field means 1. The patch operation `{ kind: 'setEnvironmentReflections', entityId, reflectionsIntensity }` sets it, with the same errors as `setEnvironmentModel`. The renderer sets `envMapIntensity` on each environment material copy (R17 of the environment import contract). The environment Inspector shows **Reflections Intensity** under Source.
R16. File lights stay removed at import. The environment import contract does not change.

### Blueprints

R17. The property registry adds `light` to the kinds of `position`, `rotation`, and `visible`, not of `scale`. It adds `{ key: 'intensity', label: 'Intensity', kinds: ['light'], type: 'number', rule: { kind: 'range', min: 0, max: 1000 } }`. Set Asset Property and Get Asset Property read and write it through the existing override path. The node audit table and the Blueprint catalog change only where the registry feeds them.

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
3. Renderer probe: a headless WebGPU render of the fixture VRM on a box floor with one directional light with a shadow. Check that MToon pixels change when `affectCharacters` changes, and that the floor under the character is darker than the floor away from it. Record the result in the evidence file.
4. Renderer: `scene-lights.ts` with the pure `lightGroups` and `lightSignature`, reconcile of three.js lights from the frame, the node sets (R6, R7), the shadow setup (R8), the built-in light rule (R5), and reflections intensity (R15). Unit tests for the pure functions. Headless render checks: a point light brightens a box; `affectEnvironment: false` keeps the environment pixels of the fixture stage as with the light hidden; a visibility change does not change `lightSignature`.
5. Editor: R10 to R14 and the Reflections Intensity field. Model tests for the factories, the disabled items, and Set Direction From Main Camera. Headless Chromium check of the editor flow: add a point light, change its color, pick its helper, and drag it.
6. Documents: `docs/evaluation/light-entities.md` with the commit, platform, backend, each check and its raw result, and the gaps; parity rows for ENV-07 and ENV-01 with the verified subset only; `ARCHITECTURE.md` (R18).

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
- Do not claim a macOS, OBS, or GPU result. These stay for the owner: the light look on MToon and on the environment in WebGPU on macOS, a character shadow on an environment floor in OBS with alpha, the frame cost of 8 lights and of 2 shadows, the recompile hitch when a light is added, and continued motion while the editor is minimized.
