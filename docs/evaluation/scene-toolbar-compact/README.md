# Scene toolbar compact evidence

Issue: [#327](https://github.com/danirukun/opensekai/issues/327).

| | Height |
| --- | --- |
| Before | 48px |
| After | 24px |

Measurement: `.scene-toolbar` sets `height:24px` in `apps/desktop/src/app.css` (commit `4c44854c`). Confirmed by pixel analysis of app screenshots: the rendered band for `.scene-toolbar` scales consistently with the known 38px `.show-toolbar` and 48px `.blueprint-toolbar` bands measured the same way, cross-validating the 24px result. No clipping observed, so the height did not need to be raised past 24px (max allowed was 28px).

`before.png` shows a one-shot HMR revert of `.scene-toolbar{height:48px}` and prior button padding (`padding:6px 8px;min-height:30px`), captured live in the running app, then reverted without committing — the working tree matched HEAD (`4c44854c`) again before this evaluation commit.

Click-check (all via the running desktop app, Camera asset selected so the transform tools are enabled):

- **Move** — tool checked, icon renders fully inside the 24px bar, no clipping.
- **Rotate** — clicked, tool switched (active-state highlight moved), icon crisp, no clipping.
- **Scale** — clicked, tool switched, icon crisp, no clipping.
- **Guides** — clicked, dropdown opened (Center mark / Thirds) without layout issues.
- **Perf** — clicked, performance monitor/FPS overlay toggled off, label flipped to "Show performance monitor".
- **Preview** — clicked, preview toggled off (eye → eye-off icon, viewport dimmed), label flipped to "Turn on preview".
- **Help** — clicked, no error toast, button fully visible and not clipped.

Out-of-scope bars confirmed unaffected:

- `.show-toolbar` ("Untitled Show" row) — still 38px, single unchanged CSS rule, visually present and unclipped in every screenshot above.
- `.blueprint-toolbar` ("Blueprints" panel header) — still 48px, opened the Blueprints panel and confirmed via the same pixel-measurement method used for the scene toolbar.

Platform: macOS. Build: `ux/scene-toolbar-compact` at `4c44854c` (plus the temporary, unstaged, reverted HMR edit described above).

Attached: [before.png](before.png), [after.png](after.png).
