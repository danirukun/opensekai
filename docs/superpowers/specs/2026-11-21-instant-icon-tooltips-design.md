# Instant icon tooltips

Icon-only controls in the editor use the native `title` attribute. The OS shows that tip after a long delay. Some icon controls have an accessible name and no tip. Labeled buttons do not need a tip that repeats the label.

Before this spike, the left rail and the show toolbar already had instant CSS tips. Rules in `app.css` drew `content:attr(title)` in `button[title]::after`. These rules had three problems:

- Each control showed two tips: the CSS tip and, after the delay, the native `title` tip.
- A disabled button gets no pointer events, so the CSS tip did not show on disabled Open and Save.
- The scene toolbar had no CSS tip. It showed only the delayed native tip.

The kit `Tooltip` replaces the CSS tips. The spike removes the `button[title]::after` rules and their reduced-motion entries.

This spike makes the tip near-instant for one proof surface. It also adds a shared `Button` API in `@oshi-connect/ui`.

## Requirement

- Icon-only and unlabeled controls show a near-instant tip on hover and on focus.
- Labeled buttons do not get a tip that only repeats the visible label.
- Use the kit `Tooltip` for the tip. Do not rely on native `title` for this spike surface.
- OpenSekai uses the kit. Do not add a second tooltip primitive in the product.

## Choices

### Kit `Button`

Add optional `tooltip?: string` on `Button` in `oshi-connect-ui`.

- When `tooltip` is set, wrap the control in the existing `Tooltip` with `text={tooltip}`.
- Do not set native `title` when `tooltip` is set. That avoids a second tip and the OS delay.
- Keep `title?: string` for rare cases that are not tips. If both props are set, use `tooltip` and ignore `title`.
- Keep current `Tooltip` behavior: hover and focus open the tip; the wrapper still receives pointer events when the control is disabled.
- When `tooltip` is set and `aria-label` is not set, use the `tooltip` text as the button `aria-label`. An explicit `aria-label` has priority.
- Add optional `tooltipPlacement` on `Button`. `Button` sends it to `Tooltip` `placement`. The default is `top`.

### Kit `Tooltip` placement

`placement` accepts these values:

- `top` (default): above the trigger, centered.
- `bottom`: below the trigger, centered.
- `bottom-end`: below the trigger, right edge aligned with the trigger. Use it for a control near the right edge of the window.
- `right`: to the right of the trigger, centered vertically. Use it for a control in a vertical rail at the left edge.

The kit exports the `TooltipPlacement` type.

### OpenSekai proof surface

In this worktree, change `title` to `tooltip` only on:

- Left rail panel icons in `EditorApp.svelte` (Assets, Output, Blueprints, Resources, Settings), with `tooltipPlacement="right"`
- Show toolbar Open and Save in `EditorApp.svelte`, with `tooltipPlacement="bottom-end"`
- Scene toolbar icons in `ScenePane.svelte` (Move, Rotate, Scale, Guides, performance monitor, preview), with the default `top` placement

Do not change `HelpButton`, Hierarchy row actions, blueprint icon `<button>` elements, or labeled buttons in this spike.

### Dependency

Rebuild `@oshi-connect/ui` into OpenSekai’s linked `.local/ui` (or the worktree equivalent) so the desktop app loads the new `Button` API.

## Out of scope

- Full pass over all icon-only controls
- Manual `Tooltip` wraps for raw `<button>` in this spike (follow-up)
- Change of tip delay or animation beyond the current kit `Tooltip`
- SPDD slice contract (promote after the spike if the pattern stays)

## Verification

- Kit: unit test that `tooltip` renders `role="tooltip"` and that native `title` is absent when `tooltip` is set. Unit tests for the `aria-label` default and for each placement class.
- Desktop: hover the rail and the scene toolbar; the tip appears without the long OS delay. Keyboard focus also shows the tip. Disabled Open/Save still shows the tip through the wrapper.
- No new end-to-end test for this spike.

## Follow-up

After the spike, convert remaining icon-only `Button` call sites to `tooltip`, and wrap raw icon `<button>` elements with kit `Tooltip` where needed.

Open items from the branch review:

- The `Tooltip` wrapper `span` takes the button `class` layout context. Check flex and width rules on wrapped buttons.
- A screen reader can read the name twice: once from `aria-label` and once from `aria-describedby` on the wrapper.
- On Windows, `group-focus-within` can keep the tip visible after a click, until focus moves.
- Escape does not dismiss the tip.
