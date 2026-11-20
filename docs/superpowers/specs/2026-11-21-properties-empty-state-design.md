# Properties empty state design

Date: 2026-11-21. Status: design, waiting for owner approval. Issue: [GitHub #286](https://github.com/danirukun/opensekai/issues/286) (comment [7051858924](https://github.com/danirukun/opensekai/issues/286#issuecomment-7051858924)).

## Intent

When no asset is selected, the Properties pane shows only its heading. The body is blank. A new user does not know what to do next. This slice puts short guidance in that empty body and adds a shared empty-state component for later panes.

## Goals

- When Properties has no selected entity, show: `Select an asset from Assets to view or edit its properties.`
- Keep the Properties heading and Help button as they are today.
- Add one shared `EmptyState` component in `apps/desktop` so other panes can reuse the same look later.
- Keep selected-entity Properties behaviour unchanged.

## Non-goals

- Full empty-pane audit (asset lists, blueprints, search). Later slices reuse `EmptyState`.
- OBS URL sharing (issue #286 section 2).
- A new control in `@oshi-connect/ui`. Promote later only if another product needs the same component.
- Icons, badges, pills, cards, or decorative empty-state art.
- Empty-state copy for every other pane in this slice.

## Constraints

- Constitution principle 1: do not add helper text that only repeats a visible control label. This copy names the next action and the place (`Assets`).
- Constitution principle 2: no card grid, decorative gradient, or badge for the empty state.
- Svelte 5 in `apps/desktop`. Use design tokens (`--ds-color-text-muted`) already used in the editor.
- No unit test for static copy. Verify in the browser. Attach before and after screenshots in the PR.

## Approaches

1. **Desktop-local `EmptyState` + Properties wire-up (chosen).** One component in `apps/desktop/src/components`. Properties uses it when nothing is selected. Fast, stays in this repo, ready for later panes.
2. **Add `EmptyState` to `@oshi-connect/ui` first.** Shared across products, but needs a UI-kit change and a local package bump before this slice ships.
3. **Hardcode the sentence in `Inspector.svelte` only.** Fastest, but skips the shared component the issue asks for and lets later panes drift.

The owner chose approach 1.

## Decided design

### Shared component

- Path: `apps/desktop/src/components/EmptyState.svelte`.
- Props: `message: string` only.
- Render: one short paragraph.
- Style: centred in the available pane area, about 12–13px, `color: var(--ds-color-text-muted)`, enough horizontal padding for wrap. No icon.

### Properties wiring

- File: `apps/desktop/src/components/Inspector.svelte`.
- Keep the heading row (`Properties` + Help).
- When there is no selected `entity`, render `EmptyState` with the fixed message above.
- When an entity is selected (and scene and reset marks are present as today), render the existing inspector body.
- Do not change Help topic mapping (`scene` with no selection).

### Copy

Exact string (owner choice A):

`Select an asset from Assets to view or edit its properties.`

`Assets` matches the Assets list heading in `Hierarchy.svelte`.

## Verification

- Browser: empty Properties shows the guidance line; with a selection, fields match today.
- PR: before and after screenshots of empty Properties.
- No unit test for the static string.

## Out of scope follow-ups

- Other empty panes from issue #286 section 1, each with its own message through `EmptyState`.
- OBS URL sharing (section 2), after the open question on that flow is answered.
