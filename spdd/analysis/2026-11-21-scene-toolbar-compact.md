# Scene toolbar compact analysis

Date: 2026-11-21. Issue: [#327](https://github.com/danirukun/opensekai/issues/327). Spec: `docs/superpowers/specs/2026-11-21-scene-toolbar-compact-design.md`.

## Intent

The scene viewer top toolbar is 48px tall. The owner wants about half that height so the preview gets more vertical space.

## Current state

- `ScenePane.svelte` renders `header.scene-toolbar` above `.viewport`.
- `app.css` sets `.scene-toolbar{height:48px}` and toolbar buttons `min-height:30px` with `padding:6px 8px`.
- Toolbar icons use Lucide `size={17}`. `HelpButton` uses its own 16px icon and local padding overrides.
- `.show-toolbar` is already denser at 38px; out of scope for this slice.

## Scope

In: scene toolbar CSS density, ScenePane toolbar icon size, browser evidence.
Out: horizontal trim, blueprint/show toolbars, shared density tokens.
