# REASONS: Camera preview guides

Date: 2026-10-20. Scope: bundle B16 ([#203](https://github.com/danirukun/opensekai/issues/203)). Analysis: [camera preview guides](../analysis/2026-10-20-camera-preview-guides.md). Related: [camera frame](2026-10-04-camera-frame.md), [camera workflow](2026-10-17-camera-workflow.md).

## R — Requirements

R1. The Scene window toolbar has one Guides button (grid icon, tooltip `Guides`). It opens a menu with two check items: **Center mark** and **Thirds**. Each item turns its guide on or off. The two guides are independent. Mouse and keyboard (Enter or Space on the button, arrow keys, Enter or Space on an item, Escape) work. A second press on the button closes its menu.
R2. The Guides button is in the on state when at least one guide is on. No badge or other indicator shows.
R3. **Center mark** is a crosshair at the frame center with arms of 12 CSS px on each side (shorter when the frame is smaller than 24 CSS px on a side). **Thirds** is two vertical and two horizontal lines at 1/3 and 2/3 of the frame, from edge to edge.
R4. The guides align to the camera frame (`.preview-surface`), not to the dark area around it. They follow a resize and an aspect change. Each line is at the center of a device pixel and is 1 device pixel wide. A change of the device pixel ratio at the same CSS size snaps the lines again.
R5. Each line is white at 70 % opacity on a black outline at 45 % opacity and 3 device pixels wide.
R6. The guides do not take pointer events. Selection, gizmo drag, navigation, and the context menu work through them.
R7. The state is per user in `localStorage` key `opensekai.scene.guides`. It persists across app restarts. A show open, a show save, or a scene change does not change it. A missing or invalid value means both guides off.
R8. The guides are an SVG overlay in the Scene window DOM. They never draw into a render target. The OBS page, output screenshots, and captures do not show them.

## E — Entities

- `GuideSettings`: `{ center: boolean; thirds: boolean }`.
- `GuideLine`: `{ x1, y1, x2, y2 }` in CSS pixels of the frame.

## A — Approach

A pure module computes the settings parse and serialization and the line geometry. `App.svelte` keeps the settings in state, writes them on change, and draws an SVG over the canvas inside `.preview-surface`. `ContextMenu` gets an optional `checked` flag on an action and an optional `anchor` element; a press on the anchor is not an outside press.

## S — Structure

- `apps/desktop/src/editor/guides.ts`: `GUIDE_STORAGE_KEY`, `readGuides`, `writeGuides`, `guidesOn`, `toggleGuide`, `guideLines`.
- `apps/desktop/src/components/GuideOverlay.svelte`: the SVG overlay.
- `apps/desktop/src/components/ContextMenu.svelte`: `checked` gives `role="menuitemcheckbox"` and `aria-checked`.
- `apps/desktop/src/App.svelte`: the Guides button, the menu, the overlay, and the storage.
- `apps/desktop/test/guides.test.ts`: unit tests.

## O — Operations

1. Add `guides.ts` and its unit tests (settings parse, toggle, geometry at 16:9, 9:16, 4:3, device pixel ratio 1, 2, and 1.5, small frames).
2. Add `checked` to `ContextMenu`.
3. Add the overlay and the toolbar button.
4. Run `pnpm check`, `pnpm test:unit`, and a headless browser check of the Scene window toolbar and overlay.
5. Update the architecture map, the parity checklist (no parity item), and the evidence.

## N — Norms

Use Svelte 5, the kit `Button`, and a lucide icon. Add no UI copy beyond the menu labels and the tooltip. Add no dependency. Functional TypeScript.

## S — Safeguards

- The overlay has `pointer-events: none` and is not in the tab order.
- No renderer, output, screenshot, or capture code reads the guide state.
- A storage failure (private mode, quota) does not stop the toggle; the state is then not saved.
- Do not claim the macOS restart check or the OBS check from the cloud.
