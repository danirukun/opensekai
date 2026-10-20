# REASONS: Inspector reset and section index

Date: 2026-10-20. Scope: bundle B17 (#180 UX-02, #179 UX-01). Analysis: [inspector reset and section index](../analysis/2026-10-20-inspector-reset-and-index.md). Related: [live light editing](2026-10-18-live-light-editing.md), [camera workflow](2026-10-17-camera-workflow.md).

This file is the contract only. The implementation run starts after the owner merges it. The [Warudo asset overview](https://docs.warudo.app/docs/assets/overview) returned HTTP 503 on 2026-10-20. The behavior below comes from the UI audit 0.15.1 lines in the issues and from OpenSekai choices. The implementation run reads the handbook page again and records each difference in the evaluation file.

## R — Requirements

### Defaults (UX-02)

R1. A pure module `apps/desktop/src/editor/property-defaults.ts` gives the default of each reset field (R3) for an entity. The default is the value that `makeAuthoringEntity` gives a new entity of the same kind, or for a light, of the same light type (`DIRECTIONAL_LIGHT`, `POINT_LIGHT`, `SPOT_LIGHT`, `AMBIENT_LIGHT`). For a tracking source the defaults come from `defaultTrackingConfig(kind)`, `DEFAULT_TRACKING_SMOOTHING`, and `DEFAULT_TRACKING_MAPPING`. For a field with a schema fallback, the default is that fallback: Render Environment on, Anti-aliasing None, Reflections Intensity 1. The module reads these constants. It does not copy their values. Exception, the transform (R8): Position and Rotation reset to zero and identity, and Scale to one, as the transform row button does today, because the add position of a camera, light, or avatar depends on where the Add menu placed it. A haze Scale resets to `hazeTransform().scale`, because scale one makes the haze volume too small to use.
R2. A field differs from its default when its value is not equal to the default. Numbers are equal when `|a − b| ≤ 1e-9 × max(1, |b|)`. Colors are equal when their hex text is equal without case. Vectors are equal when each component is equal. A missing optional field is equal to its fallback.
R3. The reset fields are:
- Each entity except a tracking source: Visible (on), and the Position, Rotation, and Scale rows of the transform (R1 exception).
- Camera: Render Environment, Anti-aliasing, FOV, Near, Far, Control Mode (Free Look), Control Sensitivity.
- Light: Color, Intensity, Range, Angle, Penumbra, Volumetric, Affect Characters, Affect Props, Affect Environment, Shadow, Shadow Intensity, Soft Shadows, Bias, Normal Bias. Each field has a reset mark only when the Inspector shows it for the current light type.
- Haze: each haze slider.
- Environment: Reflections Intensity.
- Avatar: Idle animation (on). Each expression row has one reset mark: it shows when the expression has a stored settings entry, and it calls the existing `onsettings(avatarId, name, null, revision)`, so the expression returns to the default of `effectiveExpressionSettings`. The current expression Reset button becomes this mark.
- Tracking source: Bind address, Port, and Sender address or Phone address (default empty, stored as `null`) for VMC and iFacialMocap; the Face, Upper body, Hands, and Mirror boxes for MediaPipe; Enabled, Min cutoff (Hz), Beta, and Derivative cutoff (Hz) of Smoothing; Head intensity, each Head offset axis, Eye intensity, Sensitivity, and Linked blink of Face. Each blend shape range row has one reset mark; its reset removes the range of that name from `blendShapes`. The current row Reset becomes this mark. The current whole-group Smoothing Reset goes away, because each smoothing field has its own mark. The mark names in R5 use these labels exactly as the Inspector shows them.
R4. These fields have no reset mark: the entity name, Light Type, a model or environment source, the Body, Face, and Fingers sources, Focus Character, the MediaPipe camera device, and tracking calibration (it keeps its own Reset).

### Reset mark (UX-02)

R5. A reset field that differs from its default shows a reset mark next to its label. A field equal to its default shows no mark and keeps no empty space that moves the label. The mark is a ghost `Button` from `@oshi-connect/ui` with the lucide `RotateCcw` icon at 14 px, as the transform rows use today. Its accessible name and title are `Reset <field label>`. The mark is visible without hover. It is keyboard reachable in the order of the fields.
R6. One click on the mark sends the same `model.set…` call that a commit of that field sends, with only that field changed to its default and the other fields of the group unchanged. It sends one `scenePatch` with the current `expectedRevision` through the normal route ([command path](../../ARCHITECTURE.md#command-path)). It is not a live edit. On success the revision increases once and the mark goes away. On a failure the field shows the scene value and the Inspector shows the error as it does for a commit.
R7. The mark is disabled exactly when the control of its field is disabled (the same expression that the component uses for that control today), and also while a live edit of that same field is in flight. A reset of a Control Mode uses `navigationForMode('freeLook', …)`. For a group with draft text boxes (Lens Near and Far, the tracking receiver fields, the Face fields), the mark compares the scene value, not the draft text. A reset sends the group with the other values from the scene and discards the unsaved text of that group; the boxes then show the scene values of the new revision, as after a commit.
R8. The transform rows keep their button and their defaults. The button follows R5: it shows only when its row differs from its default. A transform reset still commits through `oncommit` as today.
R9. A value that changes from MCP, a Blueprint commit, or another edit updates the mark on the next scene revision. A Blueprint override that the session does not commit does not change the mark.

### Sections (UX-01)

R10. Below the entity name and the Visible box, the Inspector shows its groups as sections. Each section has a heading button with a chevron icon, the section name, `aria-expanded`, and `aria-controls`. A click or Enter or Space on the heading collapses or expands its section. A collapsed section keeps its fields mounted, so a running live edit or draft is not lost. The `hidden` attribute is on the section body wrapper of `InspectorSection.svelte`, not on a field component, because the field components set their own `display`. A collapsed Expressions section keeps its 500 ms poll, so the values are current when it opens.
R11. The sections, in order:
- Camera: Transform, Rendering (Render Environment, Anti-aliasing), Lens, Control, Screenshot. This is the current field order.
- Light: Transform, Light (Type, Color, Intensity, Range, Angle, Penumbra, Volumetric, Set Direction From Main Camera), Affect, Shadow. Shadow shows only when the type is not ambient.
- Haze: Transform, Haze.
- Environment: Transform, Environment.
- Avatar: Transform, Model, Expressions (only when the model has triggerable expressions), Tracking (sources and Idle animation).
- Tracking source: Receiver (the current `TrackingSourceFields`), Smoothing, Face (the current `TrackingMappingFields`), Diagnostics. The `Advanced` disclosure goes away. The existing `legend` and `h4` headings that repeat a section name go away (constitution principle 1).
R12. Each section starts expanded, except Smoothing, Face, and Diagnostics of a tracking source, which start collapsed. A change that the user makes is kept per user in the Editor window `localStorage` key `opensekai.inspector.sections` as `{ version: 1, collapsed: string[] }`, where each item is `<entity kind>:<section id>`. A missing, invalid, or larger-than-4-KiB value gives the start state. The show does not save it. A read or write error of `localStorage` does not stop the Inspector.

### Section index (UX-01)

R13. When the properties column is at least 520 px wide and the entity shows two or more sections, a section index shows at the left of the sections. It is a `nav` with the accessible name `Sections` and one button for each section in section order. It stays in view while the properties column scrolls (`position: sticky`). A narrower column or a single section shows no index.
R14. The current section is the last section whose top is at or above the top of the scroll area plus 8 px. When the scroll area is at its end, the current section is the last section. When no section top is above that line, it is the first section. A pure function `currentSection(tops, scrollTop, clientHeight, scrollHeight)` computes it. The Inspector updates it on scroll, on resize of the properties column, on a section collapse or expand, and on a change of the selected entity.
R15. The current entry has `aria-current="true"`, a heavier font weight, and the text color of the selected Hierarchy row. It has no side bar, background pill, or badge.
R16. A click on an entry expands its section when it is collapsed, saves that state (R12), scrolls the section heading to the top of the scroll area (smooth, or instant when `prefers-reduced-motion: reduce`), and moves focus to the section heading button. The current entry is that section after the scroll ends.
R17. A change of the selected entity scrolls the properties column to the top.

### Documents

R18. `docs/warudo-parity.md` records only the verified subset of UX-01 and UX-02. Both rows stay unchecked until the owner verifies them on macOS. `ARCHITECTURE.md` adds the `opensekai.inspector.sections` key next to the palette key.

## E — Entities

- `ResetField = { id: string; label: string; differs: boolean; reset: () => Promise<Reply<unknown> | undefined> }`, built in the component from `property-defaults.ts`.
- `property-defaults.ts`: `defaultsFor(entity: SceneEntity): EntityDefaults` (plain data for each kind, read from the existing constants), `sameValue(a: unknown, b: unknown): boolean` (R2), `resetFieldIds(entity: SceneEntity): string[]` (the R3 list for that entity and light type).
- `InspectorSection = { id: string; label: string }`. `sectionsFor(entity: SceneEntity, options: { expressions: boolean }): InspectorSection[]` (R11).
- `SectionState = { version: 1; collapsed: string[] }`. `parseSectionState(text: string | null): SectionState`, `isCollapsed(state, kind, id): boolean`, `toggleSection(state, kind, id): SectionState` (R12, start state included).
- `currentSection(tops: number[], scrollTop: number, clientHeight: number, scrollHeight: number): number` (R14).

## A — Approach

Write the pure modules first with unit tests: defaults and equality, section lists, section state, and the current-section rule. Then add one small `ResetMark.svelte` and one `InspectorSection.svelte` and use them in the existing field components and in `Inspector.svelte`. Then add the index. Check the whole flow in headless Chromium with the Editor window against a session, as earlier editor checks did. Leave the macOS look and feel to the owner.

## S — Structure

- `apps/desktop/src/editor/property-defaults.ts` (new), `editor/inspector-sections.ts` (new: section lists, state, `currentSection`).
- `apps/desktop/src/components/ResetMark.svelte` (new), `InspectorSection.svelte` (new), `InspectorIndex.svelte` (new).
- `apps/desktop/src/components/Inspector.svelte`, `TransformFields.svelte`, `CameraLensFields.svelte`, `CameraNavigationFields.svelte`, `LightFields.svelte`, `HazeFields.svelte`, `EnvironmentFields.svelte`, `AvatarSourceFields.svelte`, `AvatarExpressionFields.svelte`, `TrackingSourceFields.svelte`, `TrackingSmoothingFields.svelte`, `TrackingMappingFields.svelte`, `TrackingAdvanced.svelte` (removed or reduced to the Diagnostics body), `SliderField.svelte` and `ColorField.svelte` (an optional reset snippet next to the label).
- `apps/desktop/src/app.css` (index and section styles).
- `apps/desktop/test/property-defaults.test.ts` (new), `apps/desktop/test/inspector-sections.test.ts` (new).
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/inspector-reset-and-index.md` (new).

## O — Operations

1. `property-defaults.ts` with `defaultsFor`, `sameValue`, and `resetFieldIds`. Unit tests: each kind and each light type gives the values of `makeAuthoringEntity`; `resetFieldIds` gives exactly the R3 list for each kind and light type and none of the R4 fields; the R2 tolerance; a missing optional field equals its fallback.
2. `inspector-sections.ts` with `sectionsFor`, the section state functions, and `currentSection`. Unit tests: the R11 order for each kind, Shadow absent for ambient, Expressions only with expressions; the R12 start state, an invalid or oversize stored value, a toggle round trip; the R14 cases (top, middle, exact line, end of scroll, empty list).
3. `ResetMark.svelte` and the reset entry in each field component (R5–R9). Each component gets the defaults for its group as a prop and calls its existing commit path.
4. `InspectorSection.svelte` and the section layout in `Inspector.svelte` (R10–R12).
5. `InspectorIndex.svelte`: width check with a `ResizeObserver`, scroll follow, and jump (R13–R17).
6. Headless Chromium check of the Editor window connected to a session (evidence in `docs/evaluation/inspector-reset-and-index.md`):
   - Add a Point Light. No reset mark shows. Drag Intensity. The Intensity mark shows. Click it. Exactly one `scenePatch` goes out, the light intensity is 20, the revision increases by one, and the mark goes away.
   - Change Range through MCP `scene_patch`. The Range mark shows after the revision arrives.
   - The transform Position button shows only after a move and resets to zero.
   - With a light that has a shadow: the index lists Transform, Light, Affect, Shadow. Scrolling moves `aria-current`. A click on Shadow scrolls its heading to the top and focuses it. Collapse Affect, reload the editor, and Affect is still collapsed.
   - At a properties column width of 480 px the index does not show.
   - Each item records its raw result.
   - Also record the commit, the platform, the browser and render backend, the unit and headless tests run with their counts, the gaps, and the checks left for the owner.
7. Documents: the evaluation file with the commit, platform, browser and backend, each test and check with its result, the gaps, the owner checks, and the handbook differences; parity rows UX-01 and UX-02 with the verified subset only; `ARCHITECTURE.md`.

## N — Norms

- Unit tests for the pure modules (defaults, equality, section lists and state, current section). No unit test for static labels or for the Svelte wiring; the headless browser check covers the wiring (constitution principle 5).
- Controls and icons come from `@oshi-connect/ui` and the lucide icons already in use. No second primitive kit. The kit has no collapsible or accordion control on 2026-10-20, so the section heading is a native `button` inside the local `InspectorSection.svelte`, as `AvatarExpressionFields` does for its rows. If the kit adds one before the implementation run, use it.
- UI copy is the section name and the field label only. No helper text, no empty state, no count badge (constitution principles 1 and 2).
- Functional TypeScript and plain data. The pure modules have no DOM access.

## S — Safeguards

- Do not add a call, a patch operation, a schema field, or a Rust change. A reset is an ordinary edit through the normal route.
- Do not copy default values into a second table. Read the existing constants, so an add default and a reset default cannot differ.
- Do not unmount a collapsed section while it holds a live edit or a draft.
- Do not save the collapse state in the show.
- Do not claim a macOS result. These stay for the owner: the look of the reset marks and the index in the macOS Editor window, the scroll follow with a trackpad, a reset that OBS shows (for example a light Intensity), and Windows.
