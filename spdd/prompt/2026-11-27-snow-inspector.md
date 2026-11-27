# REASONS: Snow Inspector section

Analysis: [Snow Inspector analysis](../analysis/2026-11-27-snow-inspector.md). Design: [snow design](../../docs/superpowers/specs/2026-11-26-snow-design.md). This contract is the Inspector part of slice 5, brought forward by the owner on 2026-11-27.

## R — Requirements

- R1. A snow entity has two Inspector sections in this order: Transform, Physics. The owner chose the name Physics on 2026-11-27, after the first build had the name Snow.
- R2. The Physics section has one slider for each of `rate`, `fallSpeed`, `flakeSize`, `flutter`, `windDirection`, `windSpeed`, `buildUpSeconds`, `meltSeconds`, and `thickness`. The hard limits of each slider are the limits of `SnowSettingsSchema`.
- R3. A slider drag sends live `setSnow` patches. The end of the drag, or a typed value, sends one committed `setSnow` patch. Each patch carries the whole group and changes only the edited field.
- R4. The section has one checkbox, Settle On Characters, for `settleOnCharacters`. A change sends one committed patch.
- R5. `settleOnProps` and `settleOnEnvironment` have no control. A patch from the section keeps their values.
- R6. Each field of R2 and R4 has a reset mark when its value is not the `DEFAULT_SNOW` value. A reset sends the default of that field only.
- R7. `model.setSnow` refuses an entity that is not a snow and a group that `SnowSettingsSchema` refuses. It sends no patch in those cases.

## E — Entities

No new data. `SnowSettings`, `SnowSettingsSchema`, `DEFAULT_SNOW`, and the `setSnow` operation come from slice 1.

## A — Approach

Follow the Haze section. A `SnowFields` component draws the fields from a table of key, label, and range. The Inspector binds it to a new `model.setSnow`. The reset helpers get a snow branch.

## S — Structure

- `apps/desktop/src/editor/slider.ts`: the snow ranges in `SLIDERS`.
- `apps/desktop/src/editor/inspector-sections.ts`: the Physics section.
- `apps/desktop/src/editor/property-defaults.ts`: the values, the defaults, and the reset fields of a snow entity.
- `apps/desktop/src/editor/model.ts`: `setSnow`.
- `apps/desktop/src/components/SnowFields.svelte`: the fields.
- `apps/desktop/src/components/Inspector.svelte`: the binding.

## O — Operations

1. Record the change of order in the design. 2. Write failing tests for the sections, the ranges, the reset helpers, and `model.setSnow`. 3. Write the code. 4. Check the section in the running app: a slider drag changes the snow in the preview, a reset mark shows and resets, and the checkbox removes the build-up. 5. Update the parity checklist.

## N — Norms

Kit `SliderField` and the `visibility-control` checkbox pattern. No helper text. Functional TypeScript. A unit test for each new function behavior, no test of static copy.

## S — Safeguards

- No control for a setting that has no effect.
- The section adds no renderer code and no contract change.
- The checkbox has no live path, because the change compiles materials.
- The Transform section does not change. Its scale reset gives a box of 1 m, because no add default exists before Add › Snow of slice 5.
- The gate of slice 1 stays open; this slice makes no claim about the look or the cost.
