# Instant icon tooltips

Icon-only controls in the editor use the native `title` attribute. The OS shows that tip after a long delay. Some icon controls have an accessible name and no tip. Labeled buttons do not need a tip that repeats the label.

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

### OpenSekai proof surface

In this worktree, change `title` to `tooltip` only on:

- Left rail panel icons in `EditorApp.svelte` (Assets, Output, Blueprints, Resources, Settings)
- Show toolbar Open and Save in `EditorApp.svelte`
- Scene toolbar icons in `ScenePane.svelte` (Move, Rotate, Scale, Guides, performance monitor, preview)

Do not change `HelpButton`, Hierarchy row actions, blueprint icon `<button>` elements, or labeled buttons in this spike.

### Dependency

Rebuild `@oshi-connect/ui` into OpenSekai’s linked `.local/ui` (or the worktree equivalent) so the desktop app loads the new `Button` API.

## Out of scope

- Full pass over all icon-only controls
- Manual `Tooltip` wraps for raw `<button>` in this spike (follow-up)
- Change of tip delay or animation beyond the current kit `Tooltip`
- SPDD slice contract (promote after the spike if the pattern stays)

## Verification

- Kit: unit test that `tooltip` renders `role="tooltip"` and that native `title` is absent when `tooltip` is set.
- Desktop: hover the rail and the scene toolbar; the tip appears without the long OS delay. Keyboard focus also shows the tip. Disabled Open/Save still shows the tip through the wrapper.
- No new end-to-end test for this spike.

## Follow-up

After the spike, convert remaining icon-only `Button` call sites to `tooltip`, and wrap raw icon `<button>` elements with kit `Tooltip` where needed.
