# Inspector reset and section index analysis

Date: 2026-10-20. Scope: bundle B17 (#180 UX-02 reset a property to its default, #179 UX-01 inspector section index). Contract: [inspector reset and section index](../prompt/2026-10-20-inspector-reset-and-index.md).

## Sources

- The UI audit 0.15.1 lines in the two issues. UX-02: "A property that differs from its default shows a reset mark next to its label. One click on the mark restores the default." UX-01: "Beside the inspector, a list of its sections follows the scroll position and jumps to a section on click. Each section collapses."
- [Warudo asset overview](https://docs.warudo.app/docs/assets/overview). The page returned HTTP 503 on 2026-10-20, so this run did not read it. The implementation run reads it again. When it gives a detail that this contract does not match, the implementation run records the difference in the evaluation file and does not change behavior without an owner decision.
- The audit did not record the reset icon, the width at which the index hides, or the collapse state after a restart. Those values in the contract are OpenSekai choices.

## Current state

- **Inspector layout.** `components/Inspector.svelte` shows the entity name, a Visible box (not for tracking sources), `TransformFields` (not for tracking sources), and then the fields of each kind in one flat column. The field groups are camera (Render Environment, Anti-aliasing, Lens, Control, screenshot buttons), light (`LightFields`), haze (`HazeFields`), environment (`EnvironmentFields`), avatar (Model, Expressions, `AvatarSourceFields` with sources and Idle animation), and tracking source (`TrackingSourceFields`, then `TrackingAdvanced`, a closed `<details>` "Advanced" with Smoothing, Face mapping, and Diagnostics). The properties column (`.properties-column` in `app.css`) is the scroll container.
- **Section headings.** Only some groups have a heading: `legend` "Lens", "Smoothing", "Face", `h4` "Expressions", "Diagnostics". Other groups have none.
- **Reset today.** `TransformFields` already has a reset button for each row (Position, Rotation, Scale). It is a ghost `Button` with the lucide `RotateCcw` icon and the title "Reset <row>". It shows on hover or focus of the row, also when the row already has its default. It resets Position and Rotation to zero and Scale to one. Three groups have a Reset too: an expression row (`onsettings(…, null, …)` removes its stored settings), Smoothing (all smoothing fields to `DEFAULT_TRACKING_SMOOTHING`), and each blend shape range row. The tracking calibration has its own Reset, which removes the saved calibration.
- **Defaults today.** There is no one table of defaults. The add defaults are in `editor/authoring.ts` (`makeAuthoringEntity`), `editor/lights.ts` (one `LightSettings` constant for each light type, `HAZE`), `editor/cameras.ts` (`DEFAULT_NAVIGATION`), and `@opensekai/contracts` (`DEFAULT_TRACKING_SMOOTHING`, `DEFAULT_TRACKING_MAPPING`, `defaultTrackingConfig`). Some fields have a schema fallback when they are missing: `renderEnvironment` (true), `antiAliasing` (`none`), `reflectionsIntensity` (1).
- **Edit route.** Each Inspector field commits through a `model.set…` function that sends one `scenePatch` with `expectedRevision`. Sliders and the color field also send live edits through `editor/live-edit.ts`. A reset can use the same functions. It needs no new call, patch operation, or schema field.
- **Per-user editor state.** The Blueprint palette keeps collapsed sections and favorites in the Editor window `localStorage` key `opensekai.blueprint.palette`. The show does not save them.

## Decisions

These decisions are reversible. The owner can change each one in review of this contract before code exists.

1. **The default is the value that the Add menu gives a new entity of the same kind and type.** For a light it is the constant of its current light type (for example a Point light Intensity resets to 20). For a tracking source it is `defaultTrackingConfig(kind)` and the contract defaults. A field with a schema fallback uses that fallback. Alternative: a default for each field in the zod schema. That changes `packages/contracts` and the Rust mirror for UI behavior only.
2. **Reset is an ordinary edit.** A reset sends the same `model.set…` call that a commit of that field sends, with the default value in place of the field value. Thus it uses the normal patch route, increases the revision once, syncs to MCP and OBS, and fails as a normal edit fails. No new call. Alternative: a `resetProperty` patch operation. That puts editor defaults into the session and the Rust mirror.
3. **Fields with a reset mark** are value fields with a fixed default: sliders, number fields, checkboxes, the color field, and selects whose options do not name another entity. Fields without a reset mark: the name, Light Type (the type selects the default set), a model or environment source, tracking source and Focus Character references, the MediaPipe camera device, and calibration (it has its own Reset). Alternative: also reset Light Type to Directional.
4. **The transform rows follow the same rule, with their own defaults.** The existing row button stays, with the same icon and defaults (zero, identity, one), but it shows only when the row differs from its default. Today it shows on hover also when it can do nothing. The add position depends on placement, so it is not a useful reset target. A haze Scale resets to the add scale, because scale one makes the volume too small. Alternative: the add transform of each kind.
5. **The existing Reset buttons become marks.** The expression row Reset and the blend shape row Reset become the reset mark of their row. The Smoothing group Reset goes away, because each smoothing field gets a mark. The calibration Reset stays; it is an action, not a default.
6. **Sections.** The Inspector puts each group under a section heading. The entity name and the Visible box stay above the sections. The tracking source `Advanced` disclosure goes away: Smoothing, Face, and Diagnostics become sections. Sections that are inside the closed `Advanced` today start collapsed, so the first view does not grow.
7. **The collapse state is per user, per entity kind, and per section**, in the Editor window `localStorage` key `opensekai.inspector.sections`, as the Blueprint palette does. The show does not save it. Alternative: per entity ID, or not kept after a restart.
8. **The index shows at the left of the sections in the properties column** when the column is at least 520 px wide and the entity has two or more sections. A narrower column shows the sections without the index. Alternative: always show the index and let the fields get narrow.
9. **The current index entry** has a heavier text weight and the text color of the selected Hierarchy row. It has no colored side bar and no badge (constitution principle 2).

## Effects

- An operator sees at a glance which values differ from a new entity, and restores one value with one click. MCP and OBS see the reset as a normal edit.
- An operator with a long Inspector (a light with a shadow, a tracking source) can jump to a section and fold the sections that they do not use.
- No change to the show format, the call API, the session, the host, or MCP.

## Risks

- The defaults live in the editor. A new field that has no default entry gets no reset mark. A unit test lists the reset fields for each kind, so a missing entry shows in review.
- A slider drag can stop near the default (for example 2.999 for 3). Then the mark stays. The comparison is exact, with a tolerance only for floating point noise.
- The scroll position follow uses the layout of the properties column. A layout change (for example a resize) can make the current entry wrong until the next scroll event. The implementation updates it on resize too.
- The handbook was not read in this run. A Warudo detail can differ.

## Out of scope

Undo and redo, a reset for a whole section or a whole entity, a reset of the Blueprint node fields, search in the Inspector, and the other UX rows (UX-03 to UX-06).
