# Lens Inspector: Preset Select and depth diagram

Date: 2026-11-22. Status: implemented (bb28b97e). Issue: [#343](https://github.com/danirukun/opensekai/issues/343) follow-on UI. Parent: [physical lens design](./2026-11-21-camera-physical-lens-design.md). Figma: [OpenSekai-UI · always-on minimal strip](https://www.figma.com/design/WSkWz6AUxzNxbweU4Tjmkz/OpenSekai-UI?node-id=80-10) (board `#343 Lens inspector · picker + diagram sketch`).

## Intent

Replace the wrapping preset button row with one Select. Add a small greyscale side-view depth diagram under Preset that updates with the lens fields and lets the operator drag focus distance.

## Current state

- `CameraLensFields.svelte` renders five ghost `Button`s for Default / Portrait / Wide / Cinematic / Concert (`LENS_PRESETS` + `applyLensPreset` / `lensPresetOperations`).
- Physical lens fields and presets already work; Sensor already uses `@oshi-connect/ui` `Select`.
- No depth diagram in the Inspector.

## Decisions (owner, 2026-11-22)

| Topic | Decision |
| --- | --- |
| Approach | **A** — Select + SVG strip |
| Preset UI | One `Select` labeled Preset (same pattern as Sensor) |
| Diagram visibility | Always visible |
| Diagram placement | Under Preset, above focal length / f-stop / focus sliders |
| Diagram look | Minimal (~72 px), greyscale (ink / muted / wash); no legend, no title |
| Diagram interaction | Display follows sliders; drag focus marker to set `focusDistance` |
| Autofocus + drag | Disable drag while autofocus is on |
| Out of scope | WebGL diagram, drag FOV/DoF handles, Effects-tab DoF UI, Sensor/FOV layout moves |

## Goals

1. Preset Select applies the same one-patch preset path as today (`lensPresetOperations`).
2. Depth strip always shows FOV cone, DoF band, and focus plane from the current lens.
3. Dragging the focus marker uses the same live/commit path as the Focus Distance slider.
4. Colors stay greyscale and match Inspector ink/muted tones; no new accent palette.
5. Pure geometry helpers are unit-tested; no large UI unit suite.

## Non-goals

- Matching Lightroom pixel-for-pixel.
- Teaching copy, tooltips, or empty-state narration on the strip.
- Changing preset math, effect groups, or session persistence.

## Layout (Inspector Lens block)

1. Section header Lens (unchanged).
2. **Preset** `Select`.
3. **Depth strip** (SVG).
4. Focal Length, Aperture, Focus Distance, Autofocus, Sensor, FOV readout, Near/Far, Apply (unchanged order after the strip).

## Preset Select

- Options: Default, Portrait, Wide, Cinematic, Concert — labels from `LENS_PRESETS`.
- On change: `onpreset` → `applyLensPreset` → `lensPresetOperations` (one revision).
- When lens/effects no longer match a named preset after manual edits: do not add a Custom badge or helper text. Keep showing the last selected option until the next Select change, or leave the control without a matched highlight if the kit requires a value — prefer the simplest Select binding that avoids new copy (implementation picks the least noisy option that stays valid HTML).

## Depth strip

### Visual

- Side view, left = camera, right = depth.
- Greyscale fills/strokes only (Inspector ink ≈ `#35333D`, muted ≈ `#66636F`, wash / axis ≈ light gray).
- Elements: camera mark, FOV cone (angle from derived FOV / focal length), translucent DoF band (thinner at lower f-stop), focus plane line, small focus marker.
- No labels on the strip; slider values already show the numbers.

### Mapping

| Input | Diagram |
| --- | --- |
| `focalLengthMm` / `fovDegrees` | Cone half-angle |
| `fStop` | DoF band half-width (lower f-stop → thinner band) |
| `focusDistance` | Marker / plane x along depth axis |

Geometry lives in pure functions (contracts or a small desktop helper next to the component) so unit tests can cover scale clamps and ordering without mounting Svelte.

### Interaction

- Pointer down/move/up on the focus marker (or a narrow hit target on the focus plane) maps x → `focusDistance` in the slider range, then `onlive` / `oncommit` like `SliderField`.
- While `autofocus` is true, drag is disabled (marker still shows the current distance).
- Keyboard: optional arrow nudge on a focused marker is nice-to-have, not required for v1.

## Components

| Piece | Location |
| --- | --- |
| Preset Select + field order | `apps/desktop/src/components/CameraLensFields.svelte` |
| SVG strip + drag | `apps/desktop/src/components/LensDepthDiagram.svelte` (new) |
| Geometry helpers | Pure TS beside the diagram or under `apps/desktop/src/editor/` |
| Preset apply | Unchanged (`lens-presets.ts`, Inspector `applyOperations`) |

## Verification

- Browser: Preset Select applies Portrait (85 mm, f/1.8, autofocus, DoF on); strip cone narrows and DoF band thins vs Default.
- Drag focus marker updates Focus Distance field and scene lens; with autofocus on, drag does nothing.
- Greyscale only under typical light Inspector theme.
- Unit tests for geometry helpers (cone angle monotonic with focal length; DoF width monotonic with f-stop; x↔distance round-trip in range).

## Self-review

- No TBDs for placement, color, or drag rules.
- No conflict with the physical-lens parent design (presets and lens fields stay).
- Scope stays Inspector UI + pure helpers; no renderer/schema change required.
