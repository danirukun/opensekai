# Analysis: Snow Inspector section

Date: 2026-11-27. Scope: the Inspector section of slice 5 of the snow design, brought forward by the owner. Contract: [Snow Inspector](../prompt/2026-11-27-snow-inspector.md). Design: [snow design](../../docs/superpowers/specs/2026-11-26-snow-design.md).

## Request

The owner ran the spike in the Editor and could not change a snow setting. Slice 1 gives the snow entity only a Transform section. The settings change only through MCP `scene_patch` with `setSnow`. The owner must tune the look to accept it, so the owner asked for the Inspector section now.

## Current state

Each fact was read in the code on 2026-11-27.

- `sectionsFor` returns only `transform` for a snow entity (`apps/desktop/src/editor/inspector-sections.ts:17`).
- The Haze section is the model. `HazeFields.svelte` draws one `SliderField` for each number of the group. A slider sends a live patch during a drag and a committed patch at the end. `Inspector.svelte` binds it to `model.setHaze` (`apps/desktop/src/components/Inspector.svelte:145`).
- `model.setHaze` parses the group with `HazeSettingsSchema`, refuses an entity of another kind, and sends one `setHaze` patch (`apps/desktop/src/editor/model.ts:171`). The model has no `setSnow`.
- `SLIDERS` in `apps/desktop/src/editor/slider.ts` holds the field ranges. Its hard limits are the contract limits.
- `valuesFor`, `defaultsFor`, and `resetFieldIds` in `apps/desktop/src/editor/property-defaults.ts` give the reset marks. They have no snow branch, so a snow entity has reset marks only for the transform, with a default scale of 1 m on each axis.
- `setSnow` is in `PatchOpSchema` and in `LivePatchOp`, and the session handles it (`packages/session/src/scene-ops.ts`). The renderer reads each number setting as a uniform. At the time of this analysis a change of `settleOnCharacters` disposed or made the build-up and compiled the character materials again. Since the review fixes of 2026-11-27 only the first change to on compiles them.
- The Add menu has no Snow item. No add default exists for the snow box.
- `settleOnProps` and `settleOnEnvironment` have no effect before slice 4.

## Decisions

1. The section has the name Physics and comes after Transform. The first build had the name Snow, which repeats the name of the entity; the owner chose Physics on 2026-11-27.
2. Each number setting is a slider with the contract range. `buildUpSeconds` and `meltSeconds` use the cubic curve with a slider end of 120 s, so the short times have fine control. A typed value can go to 600 s.
3. `settleOnCharacters` is a checkbox with the label Settle On Characters. It commits one patch and has no live path, because the first change to on compiles materials.
4. The checkboxes for props and for the environment are not shown before slice 4. A control with no effect is a false control.
5. Each shown field has a reset mark with the `DEFAULT_SNOW` value.
6. `TransformFields` makes its own reset marks from the default scale. The first build had no default box, so the scale reset gave a box of 1 m. The review fixes of 2026-11-27 added the default box (R8 of the contract).

## Risks

- A slider drag sends many live patches. Each one replaces the whole group. The renderer sets uniforms only, so the drag does not compile. The rate slider also changes the flake count, which is a draw count and not a pipeline.
- The gate of slice 1 is open. This section does not close it and does not depend on it.
