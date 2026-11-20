# Scene toolbar compact design

Date: 2026-11-21. Status: approved. Issue: [GitHub #327](https://github.com/danirukun/opensekai/issues/327).

## Intent

The top panel above the scene viewer is too tall. The owner wants a denser bar so the preview gets more vertical space, without dropping controls or changing the control set.

## Goals

- Reduce `.scene-toolbar` height from 48px toward about 24px (half of today).
- If controls clip or hit targets fail at 24px, raise the bar only as far as needed, and keep it at or under about 28px.
- Keep transform tools, selection name, guides, performance monitor, preview toggle, and help reachable and unclipped.
- Keep the `Scene` title and the current control order.
- Record before and after screenshots (and measured height) in the PR.

## Non-goals

- Horizontal trim (drop title, reorder, or remove controls). Height only.
- Changes to `.show-toolbar`, `.blueprint-toolbar`, or the editor rail.
- New controls or copy.
- A shared toolbar density token across all editor bars (out of scope for this slice).

## Constraints

- Constitution principle 1: do not add helper text.
- Constitution principle 2: no new pills, badges, cards, or decorative chrome.
- Svelte 5 in `apps/desktop`. Prefer CSS density over markup restructure.
- No unit test for layout CSS. Verify in the browser.

## Approaches

1. **CSS densify + smaller icons (chosen).** Lower `.scene-toolbar` height and button padding/min-height in `app.css`. Drop Lucide icon size from 17 to 14 in `ScenePane.svelte`. Small diff; matches how density is already handled for this bar.
2. **Mirror `.show-toolbar` first, then push down.** Reuse show-bar density (~38px) then tune lower. More consistency with the show bar, but that bar is still taller than half and adds churn.
3. **Markup restructure.** Regroup tools for a shorter chrome. Higher risk; not needed for a height-only change.

The owner chose approach 1, with target height choice C (aim for ~24px; land just above only if clipping appears) and width scope A (height only).

## Decided design

### CSS (`apps/desktop/src/app.css`)

| Rule | Now | Proposed |
|------|-----|----------|
| `.scene-toolbar` height | 48px | 24px (raise only if clipped; cap ~28px) |
| horizontal padding | `0 12px` | `0 8px` |
| gap | 10px | 6px |
| `.scene-title` margin-right | 10px | 6px |
| toolbar button padding | `6px 8px` | `2px 4px` |
| toolbar button min-height | 30px | 20px |

Keep flex row and `align-items: center`. Do not add overflow scroll on the bar. Active-tool styles stay the same. Viewport / preview sizing rules stay the same; a shorter toolbar only frees space for `.viewport`.

### Icons (`apps/desktop/src/components/ScenePane.svelte`)

- Lucide icon `size` on toolbar controls: 17 → 14.

### Markup

- No structural change to the header. Same children and order.

## Verification

- Browser: Assets/scene view. Confirm toolbar computed height (~24px, or the raised value if needed). Click Move, Rotate, Scale, Guides, Perf, Preview, and Help. Nothing clipped.
- Evidence: before and after screenshots plus measured height under `docs/evaluation/scene-toolbar-compact/` for the PR.
- No unit test for the CSS change.

## Out of scope follow-ups

- Horizontal compaction or removing the `Scene` title.
- Aligning blueprint and show toolbars to the same density.
- Shared density tokens for all editor toolbars.
