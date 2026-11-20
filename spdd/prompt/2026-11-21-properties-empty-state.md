# Properties empty state contract

Date 2026-11-21 · Issue #286 · Analysis: `spdd/analysis/2026-11-21-properties-empty-state.md`

## R: Requirements
- R1. When Properties has no selected entity, the body shows exactly: `Select an asset from Assets to view or edit its properties.`
- R2. The Properties heading and Help button stay visible with no selection. Help topic stays `scene` (existing `topicForKind(null)`).
- R3. When an entity is selected, Properties behaviour matches today (fields, sections, index, reset marks).
- R4. Empty-state look uses one shared `EmptyState` component: centred muted text, no icon, badge, or card.
- R5. Other panes may reuse `EmptyState` later; this slice wires Properties only.

## E: Entities
- `EmptyState` props: `{ message: string }`.

## A: Approach
- New Svelte component in `apps/desktop`. Inspector renders it in the `{:else}` of the entity body branch.
- Inspector fills the properties column height so the empty message can centre in the pane.

## S: Structure
- New: `EmptyState.svelte`, this analysis, this contract, evaluation screenshots folder.
- Changed: `Inspector.svelte`, `app.css` (inspector fill), `docs/handbook/scene.md`.

## O: Operations
- No new host commands. No new session API.

## N: Norms
- Copy restraint: one actionable sentence. No field helper text.
- STE for handbook and PR prose.

## S: Safeguards
- Browser check: empty and selected Properties.
- No unit test for the static string.
