# REASONS: Environment file lights

Date: 2026-11-22. Scope: ENV-01 gap B (#39). Analysis: [environment file lights](../analysis/2026-11-22-environment-file-lights.md). Changes: [environment import](2026-10-13-environment-import.md) R11 and Safeguards; [light entities](2026-10-17-light-entities.md) R16 and Safeguards.

This file is the contract. Implementation follows the Operations order after the owner accepts the plan shape.

## R — Requirements

R1. The scene importer **keeps** `KHR_lights_punctual` on the packed GLB. It no longer calls `strip_lights`. Optional and required extension lists may still name `KHR_lights_punctual`. The packed file must still pass `validate_glb`.
R2. A packed environment may hold at most **8** punctual lights (`directional`, `point`, or `spot` in the glTF lights array). More than 8 fails the import with a clear `AppError` that names the count and the limit. Spot lights from the file are allowed as three.js spot lights under the environment root.
R3. At most **2** file lights may cast shadows. When the loaded glTF yields more than 2 lights with `castShadow`, the renderer keeps shadows on the first two in traversal order and turns `castShadow` off on the rest. File lights do **not** count toward the scene light budget (32 / 8 lit / 2 shadow).
R4. An environment entity has an optional `allowLightsToAffectCharacters: boolean`. A missing field means `false`. The patch `{ kind: 'setEnvironmentLighting', entityId, allowLightsToAffectCharacters }` sets it, with the same entity errors as `setEnvironmentModel`. TypeScript (zod) and Rust accept the same shape; shared validation vectors cover present true, present false, and absent.
R5. After the environment model loads, the renderer finds each three.js light under the environment root (not scene `light` entities). Those file lights:
- always contribute to the **environment** material `lightsNode` group;
- contribute to the **characters** group only when `allowLightsToAffectCharacters` is true;
- never contribute to the **props** group;
- do not become Hierarchy entities and have no editor helpers of their own.
R6. A change of `allowLightsToAffectCharacters` rebuilds the character / environment light node sets (same path as a scene-light affect-flag change). Hiding the environment entity hides its mesh and its file lights with it.
R7. The environment Inspector shows **Allow Lights To Affect Characters** under Reflections Intensity. The control sends `setEnvironmentLighting`. UI copy is the control label only.
R8. Library GLBs packed before this slice have no file lights. The operator re-imports the source to get them. Documents say so in the evaluation file.
R9. Amend [environment import](2026-10-13-environment-import.md) R11: remove the sentence that the importer removes `KHR_lights_punctual`. Amend its Safeguards the same way. Amend [light entities](2026-10-17-light-entities.md) R16 to point at this contract. Amend that file’s Safeguards: file lights are imported under this contract’s caps.
R10. `docs/warudo-parity.md` ENV-01 records only the verified subset (file lights kept, Allow Lights To Affect Characters, caps). `ARCHITECTURE.md` notes environment-owned file lights and the flag. Evidence: `docs/evaluation/environment-file-lights.md`.

## E — Entities

- Environment: adds `allowLightsToAffectCharacters?: boolean`.
- `PatchOp`: `setEnvironmentLighting { kind, entityId, allowLightsToAffectCharacters }`.
- Renderer: file lights collected from the loaded environment `Object3D` root; folded into `lightGroups` / node-set rebuild alongside scene lights.

## A — Approach

Contracts and vectors first. Then importer (drop strip, add count reject). Then session op. Then renderer attach + flag. Then Inspector. Then tests and docs. Leave macOS/OBS look checks to the owner when a sample with punctual lights is available.

## S — Structure

- `packages/contracts` schema/types; `crates/contracts`; `fixtures/protocol/validation-vectors.json`.
- `apps/desktop/src-tauri/src/assets/scene_import.rs` (remove/replace `strip_lights`, count lights).
- `packages/session/src/scene-ops.ts`.
- `packages/renderer/src/scene-lights.ts`, `renderer.ts` (and any environment load path that holds the root).
- `apps/desktop` Inspector / `SceneModelFields.svelte` / `model.ts` / property-defaults.
- Prior contracts R11/R16; `ARCHITECTURE.md`; `docs/warudo-parity.md`; `docs/evaluation/environment-file-lights.md`.

## O — Operations

1. Contracts + Rust + vectors for the field and the op.
2. Importer: keep lights; reject >8; unit tests (kept lights, over-cap).
3. Session: `setEnvironmentLighting`.
4. Renderer: collect file lights; group rules R5; signature includes the flag; tests on software adapter when feasible.
5. Editor checkbox + model method.
6. Amend prior contracts; evaluation + parity + ARCHITECTURE.

## N — Norms

- Unit tests for schema, importer caps, session op, and pure grouping helpers.
- Functional TypeScript. UI label only.
- STE100 for long prose in docs.

## S — Safeguards

- Do not turn file lights into scene `light` entities.
- Do not count file lights toward the scene light budget.
- Do not put file lights in the props group.
- Do not claim macOS/OBS evidence without a recorded check.
- Do not change show `schemaVersion`.
