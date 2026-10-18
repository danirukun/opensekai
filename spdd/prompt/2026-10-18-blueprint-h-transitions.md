# REASONS: Blueprint transitions

Date: 2026-10-18. Scope: slice H of bundle B13 (#85, BP-05). Transition time and easing for Blueprint writes, Set BlendShape, and Look At. Analysis: [Blueprint transitions](../analysis/2026-10-18-blueprint-h-transitions.md). Plan: [Blueprint depth](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md). Adds to [continuous Blueprints](2026-10-12-continuous-blueprints.md) R10 and R11 and to [character expressions](2026-10-10-character-expressions.md) R9 and R13.

## R — Requirements

R1. **Easing.** `@opensekai/contracts` exports `EASINGS`, the list of easing names, and a pure function `ease(name, t)`. The names are the DOTween `Ease` names: `Linear`, and `InX`, `OutX`, and `InOutX` for X in Sine, Quad, Cubic, Quart, Quint, Expo, Circ, Elastic, Back, and Bounce (31 names). The formulas are the Penner formulas as [easings.net](https://easings.net) gives them: Back uses the overshoot 1.70158 (InOutBack 1.70158 × 1.525), Elastic uses the period 2π/3 (InOutElastic 2π/4.5), and Bounce uses 7.5625 and 2.75. `t` is clamped to 0 to 1. `ease(name, 0)` is exactly 0 and `ease(name, 1)` is exactly 1 for each name. The default easing is `Linear`.

R2. **Transition settings.** A transition is `{ seconds, easing }`. These node settings are optional and new: `transitionSeconds` (a finite number from 0 to 600) and `easing` (an R1 name). They apply to Set Asset Property (`property.set`), Set Expression (`character.setExpression`), Toggle Expression (`character.toggleExpression`), Set BlendShape (R8), and Look At (R11). A node without `transitionSeconds` has no transition. A node without `easing` uses `Linear`. The node defaults do not add the two settings. A saved graph and a Blueprint file without them are valid, give the same logic key, and behave as before.

R3. **Property transitions.** When Set Asset Property runs with `transitionSeconds` greater than 0 and the property type is `number` or `vector3`, the session starts a property tween in place of the immediate override write.
- The session first checks the target value with the registry rule and the entity schema (continuous Blueprints R10). An invalid target becomes the runtime error of the graph, and no tween starts.
- The start value is the current evaluated value: the persistent value with the overrides applied, so a tween that replaces another tween starts where the old one is now.
- At each session advance, the session samples each tween at the session time: `p = clamp((now − start) / (seconds × 1000), 0, 1)` and `k = ease(easing, p)`. A `number` value is `from + (to − from) × k`. Position and Scale are a component-wise lerp. Rotation is a quaternion slerp on the shortest path from the start quaternion to the target quaternion, written back as Euler degrees (YXZ). A `range` value is clamped to its range, and each Scale component is at least 0.0001, so an overshoot ease (Back, Elastic) stays valid.
- The session writes the sampled value to the override layer at the session time, with the graph of the tween. When `p` is 1, the session writes the target value as given (so the result equals Set Asset Property without a transition) and removes the tween.
- A Boolean property (Visible, Render Environment) ignores the transition and writes at once. `transitionSeconds` 0 writes at once.
- A tween that cannot write (for example the entity is now invalid for the property) is removed, and its error becomes the runtime error of its graph.
- Get Asset Property reads the evaluated value, so it reads the intermediate value during a tween.

R4. **Replacement and cancel.** One tween at most exists for each entity and property. A new transition to the same target as the running tween keeps the running tween; it does not start again. A transition to a target equal to the current value starts no tween. A new transition to a different target replaces the old one and starts from the current evaluated value (R3). An immediate write to the same property (Set Asset Property without a transition, Move Entity for Position) removes the tween first. A scene patch that removes an override (continuous Blueprints R12) also removes the tween of that property. Removal of an entity removes its tweens. `sceneReplace` removes all tweens. At most 64 tweens are active. A new tween beyond the limit fails with the runtime error `Transition limit reached`; a replacement does not count as new.

R4a. **Repeated triggers.** The rules of R4 apply to each layer: a running expression fade (R7), blend shape fade (R8), or look-at fade (R11) to the same target (the same weight, and for Look At the same target entity) keeps running. A transition starts at the session time of the value that it starts from: the previous advance, at most 100 ms before the current one. So a transition that a graph starts on every tick (On Update) moves on that tick and reaches a constant target; with a target that changes on each tick it follows the target.

R4b. **Graph changes.** Each tween, expression transition, blend shape weight, and look-at entry records the graph that started it. When that graph is disabled, deleted, or its logic changes, the session removes its tweens (the last sample stays as an override and commits by R5), ends its expression transitions (the expression continues with its Fade time), and removes its blend shape weights and look-at entries. A tween write failure is the runtime error of its graph and stays in the Blueprint inspect errors until the graph changes or starts a new transition; a later clean run does not remove it. The session does not record an error for a graph that no longer exists. A Blueprint step that throws does not stop the tween samples or the idle commit of that tick.

R5. **Commit.** An override whose property has an active tween does not commit. When the tween ends, the override commits by the 250 ms rule (continuous Blueprints R11). So one tween changes the scene revision once, after it ends. During the tween the scene revision does not change.

R6. **Clock.** Tweens, expression fades, blend shape fades, and look-at fades use the session clock (`advance(elapsedMs)`). They continue at each advance without an editor, without a Blueprint run, and while the editor is minimized. A manual `blueprintRun` between ticks starts a transition at the session time of the last advance.

R7. **Expression transition.** When Set Expression or Toggle Expression has `transitionSeconds`, the effect carries the transition. The chosen expression fades from its current weight to its new target with that time and easing. Each other expression that the activation sets to target 0 on the same layer (character expressions R8) fades out with the same transition. `transitionSeconds` 0 sets the weight at once. Without `transitionSeconds`, the fade of character expressions R9 applies (linear, by the Fade time of the expression). A later trigger to a different target without a transition replaces the transition fade with the R9 fade from the current weight. A trigger to the same target keeps the running fade (R4a). `expressionSet` from the editor and MCP has no transition. The scene revision does not change.

R8. **Set BlendShape** (`character.setBlendShape`, category Character): settings `{ entityId, blendShape, transitionSeconds?, easing? }`; inputs `flow` and `weight` (number); output exit. The `entityId` field has the kind `avatar`. The `blendShape` field has a new kind `blendshape` (R10). Defaults: the first character and `blink`. The evaluator emits a new effect `setBlendShape { entityId, blendShape, weight, transition? }`.
- The session keeps a blend shape layer for each character: name → `{ weight, fade? }`, keyed to the model of the character. It is runtime state. It is not committed, not saved, and does not change the scene revision. A model change, removal of the character, and `sceneReplace` clear it.
- The weight is clamped to 0 to 1. A name that is not in `blendShapeNames` of the character's record (R10), or a character without a record, fails with `BlendShape not found`. A non-character fails as Set Expression does. At most 64 names are kept for each character; a new name beyond that fails with `BlendShape limit reached`.
- With a transition, the weight fades from its current value to the new weight (R3 sample). Without one, it changes at once.
- An entry whose weight is 0 and that has no fade leaves the layer.
- The frame pose merges each weight above 0 into `AvatarPose.expressions` after expressions (character expressions R11), with `max(output[name] ?? 0, weight)`. A character with no tracking gets a pose while a weight is above 0. The 64-key limit of the pose applies; names that do not fit are dropped.

R9. **Blend shape merge rule (Different).** A blend shape weight cannot hold a tracked blend shape below the tracking value, because the merge is `max`. A weight of 0 releases the blend shape.

R10. **Blend shape names.** `@opensekai/contracts` exports `blendShapeNames(record)`: the names of the record's expressions in record order, then the VRM preset names that tracking drives (`aa`, `ih`, `ou`, `ee`, `oh`, `blink`, `blinkLeft`, `blinkRight`, `lookUp`, `lookDown`, `lookLeft`, `lookRight`, `neutral`), then the 52 ARKit names, without duplicates (case-sensitive). `BlueprintField` gains the kinds `blendshape` and `easing` (one appended union member in `define.ts`). The editor shows a `blendshape` field as a select with `blendShapeNames` of the record of the character in `entityId`, with a `Missing` entry for a stored name that is not in the list, as for `expression`. The editor shows an `easing` field as a select of the R1 names, with `Linear` when the setting is absent. A `number` field with no stored value shows an empty input, and clearing an optional `number` field removes the setting. The Look At target select does not list the character of the node.

R11. **Look At** (`character.lookAt`, category Character): settings `{ entityId, targetId, transitionSeconds?, easing? }`; inputs `flow` and `weight` (number); output exit. `entityId` has the kind `avatar`. `targetId` has the kind `entity` (any entity other than tracking, also a camera). Defaults: the first character and the first camera. The evaluator emits a new effect `lookAt { entityId, targetId, weight, transition? }`.
- The session keeps one look-at entry for each character: `{ targetId, weight, fade? }`. It is runtime state, like R8.
- The weight is clamped to 0 to 1. A target equal to the character fails with `Look At target is the character`. An unknown character or target fails with `NOT_FOUND`. A non-character fails with `Entity is not a character`.
- The look rotation: the head point is the character position plus `[0, 1.4 × scale.y, 0]` turned by the character rotation. `d` is the target position minus the head point, turned into the character frame by the inverse character rotation. In the pose frame (+Y up, the character faces +Z), `yaw = atan2(d.x, d.z)` and `pitch = −atan2(d.y, hypot(d.x, d.z))`, in degrees. The yaw is clamped to ±70 and the pitch to ±45. The look quaternion is `eulerToQuat([pitch, yaw, 0])` (YXZ). Positions come from the evaluated scene (overrides applied).
- The output rotation is `slerp(identity, look, weight)`. With a transition, the output is `slerp(start, goal, ease(p))`, where `start` is the output rotation at the time of the effect and `goal` is the live output for the new target and weight. A target change with a transition therefore turns smoothly to the new target.
- At each advance after the Blueprint step, the session adds the output rotation to the `head` bone offset (character B5 R20), after the offsets of the Blueprint step: `combined = lookAt × earlier`. The layer is not committed or saved.
- An entry with weight 0 and no fade leaves the state. An entry whose character or target was removed leaves the state.
- Different from Warudo: no IK, no eyes, no neck share; the head point is an estimate; the rotation adds to the tracked head rotation. Record the node as Approximate.

R12. **Effects and rollback.** The new effects (`setBlendShape`, `lookAt`) and the transition on `setProperty` and the expression effects follow the run gate: a run whose effects fail leaves no tween, blend shape, or look-at change behind (continuous Blueprints, B5 R19).

R13. **Audit.** `docs/evaluation/blueprint-node-audit.json` has one row for `character.setBlendShape` (Warudo category BlendShapes, candidate `Set Character BlendShape`) and one for `character.lookAt` (Warudo category Characters, no recorded name), both with `evidence: "tests"`.

R14. **Tests.** Unit tests: each easing at 0, 0.5, and 1; the overshoot of Back and Elastic; the tween sample for number, Vector3, and rotation (slerp on the shortest path, not Euler); replacement from the current value; cancel by an immediate write and by a patch; the tween limit; the blend shape and look-at math. Session tests through `createSession`: a graph eases a camera Field of View and an entity Position over N ticks, the frames show the intermediate values, and the scene revision increases once after the end; ticks without a Blueprint run continue the tween; an expression fade with easing; a blend shape weight; a look-at weight. No test of static copy.

## Implementation notes (2026-10-18)

These notes record the reversible choices of the implementation. They add to the requirements above.

- R3 and R7: an expression weight and a blend shape weight are clamped to 0 to 1 at each sample, because `AvatarPose.expressions` accepts only that range. A Back or Elastic ease therefore does not overshoot a weight. A rotation sample can overshoot.
- R3: the tween writes through the same `writeOverride` function as an immediate write, so the follow rule of an Orbit Character camera (camera workflow R6a) applies to each sample.
- R4: an immediate write stops the tween only when the write is valid. A failed immediate write leaves the tween and becomes the runtime error of its graph.
- R8 and R11: `transitionSeconds` 0 on Set BlendShape or Look At changes the value at once, as without the setting.
- R2: the definition test now compares the fields of a node with the keys of its settings schema, not with the keys of its defaults, because the transition settings have no default.
- Tick order: Blueprint step, tween samples, idle commit, frame evaluation, expression, blend shape, and look-at advance, then pose composition (expressions, blend shapes, bone offsets with look-at).

## E — Entities

- `EASINGS`, `Easing`, `EasingSchema`, `ease(name, t)` (`packages/contracts/src/easing.ts`).
- Node settings: `transitionSeconds?: number`, `easing?: Easing` on `property.set`, `character.setExpression`, `character.toggleExpression`.
- Node types: `character.setBlendShape { entityId, blendShape, transitionSeconds?, easing? }` (in `flow`, `weight`), `character.lookAt { entityId, targetId, transitionSeconds?, easing? }` (in `flow`, `weight`).
- `BlueprintField`: adds `{ key, label, kind: 'blendshape' | 'easing' }`.
- `blendShapeNames(record)` (`packages/contracts/src/expressions.ts`).
- Session effects: `setProperty` and `setExpression` / `toggleExpression` gain `transition?: { seconds, easing }`; new `setBlendShape { entityId, blendShape, weight, transition? }` and `lookAt { entityId, targetId, weight, transition? }`.
- Session state (not protocol types): `TweenLayer` (entity and property → `{ from, to, startMs, seconds, easing, graphId }`), `ExpressionEntry.fade?`, `BlendShapeStates`, `LookAtStates`.
- No change to `SceneEntity`, `AvatarPose`, the patch operations, the Blueprint file format, or the Rust contracts.

## A — Approach

Add the easing module and the transition settings in the contracts first. Then the session interpolation module and the property tween layer next to the override layer, with the commit guard. Then the expression fade, the blend shape layer, and the look-at layer, which use the same sample. Then the evaluators, the run gate, and the tick order: Blueprint step, transitions, idle commit, frame. Then the editor fields. Keep each layer as plain data with pure functions, and keep tween state in the session, not in the Blueprint run state.

## S — Structure

- `packages/contracts/src/easing.ts` (new), `index.ts` (one export line), `expressions.ts` (`blendShapeNames`).
- `packages/contracts/src/blueprint-nodes/transition.ts` (new: the two optional settings), `properties.ts`, `character.ts`, `define.ts` (one appended `BlueprintField` member).
- `packages/session/src/tweens.ts` (new: sample and property tween layer), `blend-shapes.ts` (new), `look-at.ts` (new), `overrides.ts` (commit guard), `expressions.ts` (fade), `session.ts` (state, gate, tick), `blueprint.ts` (effect union and guard), `blueprint-eval/properties.ts`, `blueprint-eval/character.ts`.
- `apps/desktop/src/components/BlueprintNodeFields.svelte` (the two field kinds, empty number).
- Tests in `packages/contracts/test/` and `packages/session/test/`.
- `docs/evaluation/blueprint-node-audit.json`, `docs/evaluation/blueprint-h-transitions.md`.

## O — Operations

1. Contracts: easing, transition settings, the two nodes, the field kinds, `blendShapeNames`. Add unit tests for easing and names.
2. Session: interpolation and the property tween layer with replacement, cancel, limit, and the commit guard. Add unit tests.
3. Session: expression transition, blend shape layer, look-at layer. Add unit tests.
4. Session: evaluators, effect guard, run gate, tick order, patch and replace rules. Add session tests (R14).
5. Editor: the `blendshape` and `easing` fields and the empty number field.
6. Audit rows and the evaluation note. Run `pnpm check`, `pnpm test:unit`, and `pnpm test:integration`.
7. Owner macOS check in the integrated QA run: an eased camera push in OBS, an expression fade, a blend shape, Look At at the camera, motion with the editor minimized, and one revision after each transition.

## N — Norms

Write prose in ASD-STE100. Keep functional TypeScript and plain data. Use `@oshi-connect/ui` controls. Do not add UI copy other than the field labels Transition (s), Easing, BlendShape, Weight, and Target. Use pnpm.

## S — Safeguards

- Do not change the behavior or the logic key of a saved graph without the new settings.
- Do not commit an override while its tween is active. Do not change the scene revision during a transition.
- Do not let a renderer advance a transition. Renderers consume evaluated state.
- Do not store tweens, blend shape weights, or look-at state in a show or a Blueprint file.
- Do not interpolate a rotation as Euler angles.
- Do not let an overshoot ease write an invalid property value.
- Do not keep transition state in the Blueprint run state.
- Do not claim a macOS, OBS, or renderer result from the unit and session tests.
