# Character expressions analysis

Date: 2026-10-10. Scope: the first CHR-03 slice. Triggered VRM expressions over face tracking.

## Problem

Face tracking drives expression weights from MediaPipe, iFacialMocap, and VMC. The operator cannot trigger an authored expression, such as Happy or a custom model clip, during a show. The editor does not know which expressions a model has. A Blueprint can only change persistent scene state, so a hotkey cannot start a temporary facial expression.

Warudo has expressions on each character ([Character](https://docs.warudo.app/docs/assets/character)). It imports VRM expressions. VRM presets go on layer 0 and modeler clips go on layers 1, 2, 3, and so on. An expression fades in and out (0.4 s default). Expressions on the same layer replace each other. Expressions on different layers can overlap. An expression can disable blink, mouth, or brow tracking. Hotkey Blueprints and a Toggle Character Expression node trigger expressions.

## Decisions

- The session owns the active expression state. It is runtime state. It does not change the scene revision, and show save does not store it. Expression settings are scene state and save with the show.
- The importer reads the expression names of a VRM into the asset record. The session, the editor, and MCP can then validate names without a renderer.
- Only expressions that tracking does not drive are triggerable. Visemes, blink, look, neutral, and the 52 ARKit names stay with tracking.
- Defaults follow Warudo: presets on layer 0, each custom expression on its own layer, a 0.4 s fade, and no tracking suppression. The character stores only the settings that the operator changed.
- The session blends expressions in the tracking composer. It multiplies suppressed tracking channels by `1 − s` and merges expression weights with `max`. The renderer continues to apply `AvatarPose.expressions` as it does now.
- New methods `expressionGet` and `expressionSet` go through the validated command API. MCP gets two tools for them. Settings use a new scene operation through `scene_patch`.
- Two Blueprint nodes, Set Expression and Toggle Expression, emit runtime effects. The existing keystroke event node triggers them, so no new hotkey code is necessary.
- The Inspector shows an Expressions group for a character whose model has triggerable expressions.

## Rejected approaches

- Renderer-owned fades. They break the rule of one authoritative simulation. The preview and the OBS output could disagree.
- Active state as a scene operation. Each hotkey press would change the scene revision, conflict with editor edits, and mark the show as changed. A saved show would open with an expression active.

## Effects

- Existing shows open without change. The `expressions` key on an avatar is optional.
- Asset records without an expression list get one when the library loads.
- A character with no tracking source and no idle animation gets a pose while an expression is active or fades out.
- The VRM expression manager continues to apply the model's own `overrideBlink`, `overrideMouth`, and `overrideLookAt` values for VRM expressions. Suppression in the session also covers ARKit morphs that the renderer writes directly.

## Out of scope

Custom expressions made from raw blendshapes, trigger conditions from tracking thresholds, Warudo "High priority", separate enter and exit durations and delays, binary mode, expression thumbnails, and expression import or export between characters.
