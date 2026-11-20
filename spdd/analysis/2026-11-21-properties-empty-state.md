# Properties empty state analysis

Date: 2026-11-21. Issue: [#286](https://github.com/danirukun/opensekai/issues/286). Spec: `docs/superpowers/specs/2026-11-21-properties-empty-state-design.md`.

## Intent

Properties shows a blank body when nothing is selected. The user needs a next action that names Assets.

## Current state

- `Inspector.svelte` renders the heading always. The body is inside `{#if entity && view.scene && marks}`.
- Selection comes from the Assets list (`Hierarchy.svelte` heading `Assets`).
- No shared empty-state component exists.

## Scope

In: shared `EmptyState`, Properties no-selection copy, handbook line, browser evidence.
Out: other panes, OBS URL sharing, `@oshi-connect/ui` promotion.
