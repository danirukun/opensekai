# Camera preview guides analysis

Date: 2026-10-20. Scope: bundle B16 ([#203](https://github.com/danirukun/opensekai/issues/203)). Contract: [camera preview guides](../prompt/2026-10-20-camera-preview-guides.md).

## Sources

- Issue #203 gives the behavior and the acceptance criteria.
- Warudo: the 0.15.1 UI audit in [the parity checklist](../../docs/warudo-parity.md) and the [Camera handbook page](https://docs.warudo.app/docs/assets/camera) do not record composition guides. This is an OpenSekai editor requirement, not a parity item.
- [Camera frame contract](../prompt/2026-10-04-camera-frame.md) (UI-10): the Scene window sizes `.preview-surface` to the camera frame (`fitPreview`), and `.camera-frame` is a pointer-transparent overlay inside it.

## Current state

- The Scene window (`apps/desktop/src/App.svelte`) has a toolbar with the transform tools, a performance monitor toggle (UI-11), and the Editor button.
- `.preview-surface` has the exact size of the rendered canvas. Output is 1920 × 1080, so the surface is 16:9 today. B22 (#173) can change the output size later.
- The performance monitor state is per user in the Scene window `localStorage` key `opensekai.scene.perfMonitor`. The Blueprint palette uses the same pattern. No show file holds editor view state.
- The UI kit `Dropdown` closes after a choice and has only `menuitem` rows. It has no check state. The local `ContextMenu.svelte` already gives a keyboard menu (arrow keys, Home, End, Escape) with kit `Button` rows.
- The OBS page (`apps/output`) and the screenshot path (`renderer/src/screenshot.ts`) draw from the renderer only. They do not read the Scene window DOM.

## Decisions

These decisions are reversible. The owner can change each one in review.

1. **Storage.** The guide state is in the Scene window `localStorage` key `opensekai.scene.guides` as `{"center":boolean,"thirds":boolean}`. This matches the performance monitor and the palette. It is per user and per app install, and a show open does not touch it. Alternative: a host-side user settings file. No such file exists yet.
2. **Menu.** The Guides button opens the local `ContextMenu` under the button. `ContextMenu` gets an optional `checked` flag on each action, which gives a `menuitemcheckbox` row with `aria-checked` and a check mark. The menu closes after a choice, as a macOS menu does. Alternative: the kit `Dropdown`. It has no check state, so the user cannot see which guide is on. A checkable kit menu is a later kit change.
3. **Geometry.** A pure function gives the guide lines in CSS pixels of the frame. It puts each line at the center of a device pixel, so a 1 px line is sharp. The center mark arms are 12 CSS px long on each side, and shorter on a frame that is too small. Alternative: CSS percentage lines. They blur on a fractional device pixel.
4. **Look.** Fixed colors: a white line at 70 % opacity on a black outline at 45 % opacity, 3 device pixels wide. No setting. The issue asks whether color and opacity must be a setting; a fixed look is the smaller first step.
5. **Out of scope.** Safe area and golden ratio lines (open questions in #203) are not in this slice. They can use the same geometry function later.

## Effects

- The operator can show a center mark and a rule-of-thirds grid in the Scene preview.
- The show format, the call API, the renderer, and the OBS output do not change.

## Risks

- The aspect ratios 9:16 and 4:3 do not exist in the app yet. The cloud run proves alignment at those ratios with unit tests and with a headless browser check of the overlay at a forced surface size. The owner checks the 16:9 frame on macOS.
- `localStorage` in a Tauri WebView persists across app restarts on macOS. The owner confirms this in the local check.
