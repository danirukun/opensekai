# REASONS: Character expressions

Date: 2026-10-10. Scope: the first CHR-03 slice. Triggered VRM expressions, layered fades, tracking suppression, and triggers from the editor, MCP, and Blueprints. Analysis: [character expressions](../analysis/2026-10-10-character-expressions.md).

## R — Requirements

R1. `AssetRecord` has a required `expressions` array of `{ name, preset }`, in TypeScript and Rust. `name` is 1 to 128 UTF-16 code units. `preset` is a boolean. The array has at most 64 entries and no duplicate names. A GLB record has an empty array.
R2. Import reads the names from the VRM JSON. VRM 1.0: the keys of `VRMC_vrm.expressions.preset` (`preset: true`), then the keys of `VRMC_vrm.expressions.custom` (`preset: false`), in document order. VRM 0.x: each entry of `VRM.blendShapeMaster.blendShapeGroups`. A known `presetName` maps to the VRM 1.0 name as in three-vrm: `joy`→`happy`, `angry`→`angry`, `sorrow`→`sad`, `fun`→`relaxed`, `a`→`aa`, `i`→`ih`, `u`→`ou`, `e`→`ee`, `o`→`oh`, `blink`→`blink`, `blink_l`→`blinkLeft`, `blink_r`→`blinkRight`, `lookup`→`lookUp`, `lookdown`→`lookDown`, `lookleft`→`lookLeft`, `lookright`→`lookRight`, `neutral`→`neutral` (`preset: true`). An `unknown` or missing `presetName` uses `name` (`preset: false`). Import drops an entry with an empty name, a duplicate name, or a name that tracking drives (R3), and then keeps the first 64 entries. Warudo imports every VRM expression, so the tracked names must not use the limit: a perfect sync model has more than 64 clips, and its modeler clips come last. A library record without `expressions`, or with a tracked name in `expressions` (a list from the first importer), gets the list from its stored `.vrm` file when the library loads. The registry writes the record back. A file that does not parse gives an empty list.
R3. A shared TypeScript function `triggerableExpressions(record)` returns the record entries that tracking does not drive, in record order. It excludes `aa`, `ih`, `ou`, `ee`, `oh`, `blink`, `blinkLeft`, `blinkRight`, `lookUp`, `lookDown`, `lookLeft`, `lookRight`, `neutral`, the OVR visemes `sil`, `PP`, `FF`, `TH`, `DD`, `kk`, `CH`, `SS`, `nn`, `RR`, and each name whose canonical ARKit form is one of the 52 ARKit names. The comparison ignores case. The Rust function `is_tracked_expression` uses the same list. `fixtures/protocol/tracked-expressions.json` is the shared test vector.
R4. An avatar entity has an optional `expressions` key: a map from expression name to `ExpressionSettings`, with at most 64 keys. `ExpressionSettings` is `{ layer, fadeSeconds, suppress: { blink, mouth, brow } }`. `layer` is an integer from 0 to 15. `fadeSeconds` is a number from 0 to 5. The `suppress` values are booleans. This applies in TypeScript (zod) and Rust (`deny_unknown_fields`). An existing show without the key validates without change.
R5. The default settings of a triggerable expression: a preset is on layer 0. A custom expression is on layer `min(1 + i, 15)`, where `i` is its index among the triggerable custom expressions of the record. `fadeSeconds` is 0.4. All `suppress` values are false. An entry in the avatar `expressions` map replaces the default for that name.
R6. A scene operation `setAvatarExpression { entityId, name, settings: ExpressionSettings | null }` sets or removes the entry for `name`. When the last entry is removed, the `expressions` key is removed. It fails with `INVALID_INPUT` for an entity that is not an avatar and with `NOT_FOUND` for an unknown entity. It accepts a name that the current model does not have, so settings stay when a model is replaced and then restored. MCP sends it through `scene_patch`.
R7. A method `expressionGet { avatarId }` returns `{ avatarId, expressions: ExpressionView[] }`. `ExpressionView` is `{ name, preset, layer, fadeSeconds, suppress, active, weight }`, one per triggerable expression of the character's current model, in record order, with the effective settings (R5). `active` is true when the target is 1. `weight` is the current fade weight from 0 to 1. A character with no model, or with a model whose record the session does not have, returns an empty list. The method fails with `NOT_FOUND` for an unknown entity and `INVALID_INPUT` for an entity that is not an avatar.
R8. A method `expressionSet { avatarId, name, active }` sets the target of the expression to 1 or 0 and returns the same result as `expressionGet`. When the target becomes 1, each other expression of that character on the same layer gets the target 0. A name that is not a triggerable expression of the current model fails with `INVALID_INPUT`. The method does not change the scene revision.
R9. On each session advance, each weight moves toward its target by `elapsedSeconds / fadeSeconds`, clamped to 0 and 1. When `fadeSeconds` is 0, the weight is equal to the target. Elapsed time comes from the session clock. An entry with target 0 and weight 0 leaves the state.
R10. The active state of a character is cleared when its `assetId` changes, when it is removed, and when `sceneReplace` runs (show open). Show save does not store it. A layer change of an active expression applies at its next activation.
R11. The tracking composer builds `AvatarPose.expressions` in this order. (1) The tracking weights as they are now. (2) For each group, `s` is the largest weight among the active or fading expressions whose settings suppress that group. Each tracking weight in the group is multiplied by `1 − s`. The groups, by case-insensitive name: blink is `eyeBlink*` and `blink*`; mouth is `jaw*`, `mouth*`, `cheek*`, `tongueOut`, `aa`, `ih`, `ou`, `ee`, `oh`, and the OVR visemes; brow is `brow*`. (3) For each expression with a weight above 0, the output is `max(output[name] ?? 0, weight)`. A character with no tracking and no idle animation gets a pose while one of its expressions has a weight above 0.
R12. The session holds the asset records. The Scene window passes them at session start and each time the record list changes.
R13. The Blueprint catalog has `character.setExpression` (label Set Expression; inputs `flow` and `active: boolean`; output exit) and `character.toggleExpression` (label Toggle Expression; input `flow`; output exit). Both have the settings `{ entityId, expression }` and the category Character. A new field kind `expression` lists the triggerable expressions of the character in `entityId`. The evaluators emit the runtime effects `setExpression { entityId, expression, active }` and `toggleExpression { entityId, expression }`. The session applies these to the expression state with the R8 rules, not as scene operations. A failed expression effect, such as an unknown name, becomes the runtime error of the graph, as a failed scene effect does now (`session.ts` `runtimeErrors`). Expression effects of a run apply only when all scene effects of that run apply.
R14. MCP has the tools `expression_get` and `expression_set`. Their input schemas are `ParamSchemas.expressionGet` and `ParamSchemas.expressionSet`. They call the same validated methods as the editor.
R15. The Inspector shows an **Expressions** group under the Model row when the selected character has triggerable expressions. The group is absent otherwise. Each row has the expression name and a switch. The switch sends `expressionSet` and shows `active`. A disclosure on each row shows **Layer**, **Fade (s)**, the checkboxes **Blink**, **Mouth**, and **Brow** under **Suppress tracking**, and **Reset**. A settings change sends `setAvatarExpression`. **Reset** sends `setAvatarExpression` with `settings: null`.
R16. The editor reads `expressionGet` for the selected character when the selection changes, after each `expressionSet` that it sends, and at the existing editor poll interval while the Expressions group is visible.
R17. Show save and open keep the avatar `expressions` settings.

## Implementation notes (2026-10-17, bundle B4)

These notes record the reversible choices of the implementation. They add to the requirements above.

- R1: the Rust registry reads VRM 1.0 keys in document order with a streaming key visitor, because `serde_json::Value` sorts object keys. The smoke fixture manifest (`fixtures/smoke/manifest.json`) lists the 18 preset names of the pinned VRM. A local test manifest without the list gets it from the VRM file when the registry loads.
- R8 and R14: `expressionSet` needs the `edit` capability, as `blueprintRun` does. `expressionGet` needs `read`.
- R11: `AvatarPose.expressions` has at most 64 keys. When tracking and expressions together pass this limit, the composer drops the expression keys that do not fit, in record order.
- R12: after `import_avatar` or `import_scene`, the host sends the new record to the Scene window as the Tauri event `asset-record`. The Scene window sends the merged record list to the session worker (`{ kind: 'assets', records }`). The first list goes with the start message.
- R13: the `entityId` field of the two Character nodes uses a new field kind `avatar`, which lists only characters. Node defaults use the first character whose model has a triggerable expression.
- R10: the session also drops the state of a character when its model changes and changes back before the next frame.

## E — Entities

- `AssetRecord`: adds `expressions: { name: string; preset: boolean }[]`.
- `ExpressionSettings`: `{ layer: number; fadeSeconds: number; suppress: { blink: boolean; mouth: boolean; brow: boolean } }`.
- `SceneEntity` (avatar): adds `expressions?: Record<string, ExpressionSettings>`.
- `ScenePatch` operation: `setAvatarExpression { kind, entityId, name, settings }`.
- Methods: `expressionGet { avatarId }` and `expressionSet { avatarId, name, active }`. Result: `{ avatarId, expressions: ExpressionView[] }`.
- `ExpressionView`: `{ name, preset, layer, fadeSeconds, suppress, active, weight }`.
- Session `ExpressionState`: for each avatar, a map from name to `{ target: 0 | 1; weight: number }`. Not a protocol type.
- `BlueprintEffect`: adds `setExpression` and `toggleExpression`.
- Blueprint field kind: adds `expression`.

## A — Approach

Change the contracts first, in TypeScript and Rust together, with shared validation vectors. Then add the registry extraction, the session expression state and composer change, the methods and router forwarding, MCP tools, the Blueprint nodes, and the editor UI. Keep expression state in the session as runtime state beside the tracking composer. Keep the renderer unchanged except for tests: expression names are VRM expression names and already reach the VRM expression manager.

## S — Structure

- `packages/contracts/src/schema.ts`, `types.ts`, a new `expressions.ts` (`triggerableExpressions`, default settings, groups); `packages/contracts/src/blueprint-nodes/` (a new `character.ts`, `define.ts`, `index.ts`); `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`; `fixtures/smoke/manifest.json`.
- `apps/desktop/src-tauri/src/assets/registry.rs`; `apps/desktop/src-tauri/src/service/router.rs`.
- `packages/session/src/` — a new `expressions.ts` (state, fades, effective settings), `tracking.ts`, `scene-ops.ts`, `session.ts`, `worker.ts`, `blueprint.ts`, `blueprint-eval/`.
- `apps/mcp/src/tools.ts`, `server.ts`.
- `apps/desktop/src/App.svelte` or `bootstrap.ts` (asset records to the session); `editor/model.ts`, `live-fields.ts`; `components/Inspector.svelte`, a new `components/AvatarExpressionFields.svelte`, `BlueprintNodeFields.svelte`.
- `docs/warudo-parity.md` and an evaluation note.

## O — Operations

1. Contracts: `AssetRecord.expressions`, `ExpressionSettings`, avatar `expressions`, `setAvatarExpression`, `expressionGet`, and `expressionSet` in TypeScript and Rust; `triggerableExpressions` and defaults in TypeScript. Add validation vectors and contract tests.
2. Native registry: extract names for VRM 1.0 and 0.x at import and fill them for records without them. Add Rust tests. Update the fixture manifest.
3. Session: expression state, fades, clearing, and composer blending. Add unit tests.
4. Session and router: apply `setAvatarExpression`; handle `expressionGet` and `expressionSet`; receive asset records. Add unit tests.
5. Blueprint: the two nodes, the field kind, evaluators, and runtime effects. Add unit tests.
6. MCP: the two tools. Add an integration test through the real router and session.
7. Editor: the Expressions group, the settings disclosure, and the polling rule. Add editor model tests.
8. Verify in the running macOS app: toggle an expression in the Inspector and see the fade, trigger it from a keystroke Blueprint, check blink suppression with face tracking, save and open the show, and check the OBS output. Record evidence and parity.

## N — Norms

Use `@oshi-connect/ui` controls. Keep UI copy to the labels in R15. Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript and plain data.

## S — Safeguards

- Do not change the scene revision with `expressionSet` or with Blueprint expression effects.
- Do not store the active expression state in a show document.
- Do not let a renderer advance fades. Renderers consume `AvatarPose.expressions`.
- Do not send expression state over the UI bridge on each frame.
- Do not change existing show documents on load. Do not make the avatar `expressions` key required.
- The registry must not fail to load because a record has no expression list or because its `.vrm` file does not parse.
- Do not trigger expressions that tracking drives (R3).
- Do not add raw blendshape authoring, threshold triggers, or high-priority expressions in this slice.
