# Scene toolbar compact contract

Date 2026-11-21 · Issue #327 · Analysis: `spdd/analysis/2026-11-21-scene-toolbar-compact.md`

## R: Requirements
- R1. `.scene-toolbar` height is about 24px (half of 48). If controls clip, raise only as far as needed and keep at or under about 28px.
- R2. Transform tools, selection name, guides, performance monitor, preview toggle, and help stay visible, usable, and unclipped.
- R3. The `Scene` title and control order stay as they are today.
- R4. Do not change `.show-toolbar`, `.blueprint-toolbar`, or the editor rail in this slice.
- R5. PR includes before/after screenshots and the measured toolbar height.

## E: Entities
- No new entities. Existing `ScenePane` header and CSS classes only.

## A: Approach
- Densify `.scene-toolbar` and its button rules in `app.css`.
- Drop Lucide toolbar icons in `ScenePane.svelte` from 17 to 14.
- Browser-check height and clipping; raise height only if needed.

## S: Structure
- New: this analysis, this contract, `docs/evaluation/scene-toolbar-compact/`.
- Changed: `apps/desktop/src/app.css`, `apps/desktop/src/components/ScenePane.svelte`.

## O: Operations
- No new host commands. No new session API.

## N: Norms
- Height only. No new UI copy. STE for PR prose.

## S: Safeguards
- Browser check of toolbar height and each control.
- No unit test for CSS layout.
