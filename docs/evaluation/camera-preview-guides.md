# Camera preview guides check

Date: 2026-10-20. Scope: UI-12, bundle B16 ([#203](https://github.com/danirukun/opensekai/issues/203)). Contract: [camera preview guides](../../spdd/prompt/2026-10-20-camera-preview-guides.md). Base commit: 6cc30e9 plus the B16 branch changes.

## Linux cloud (verified)

Environment: Ubuntu x86_64 cloud container, headless Chromium (Playwright 1.64.1), device scale factor 2. The Scene window frontend is the `vite preview` build of `apps/desktop` at `http://127.0.0.1:4173/`. There is no Tauri host, so the session does not start and the window shows a startup error. The toolbar, the preview surface, and the guide overlay do not need the session.

Script: [headless-check.mjs](camera-preview-guides/headless-check.mjs). Raw output: [headless-check.txt](camera-preview-guides/headless-check.txt).

| Check | Result |
| --- | --- |
| The Guides menu has two `menuitemcheckbox` rows, Center mark and Thirds, with `aria-checked` | Pass |
| Mouse: Thirds turns on 4 lines; the button gets the on state | Pass |
| Keyboard: Enter opens the menu with focus on Center mark; Enter turns it on (6 lines) | Pass |
| Keyboard: Space opens, ArrowDown, Space turns Thirds off (2 lines); the button stays on | Pass |
| Escape closes the menu | Pass |
| A second click on the Guides button closes its menu (`aria-expanded` false) | Pass |
| The overlay rectangle equals `.preview-surface` at 1280 × 800 and after a resize to 900 × 900 | Pass |
| The state is in `opensekai.scene.guides` and comes back after a page reload | Pass |
| Forced frames of 360 × 640 (9:16) and 640 × 480 (4:3): lines at 1/3 and 2/3, each on a device pixel center (x.25 at ratio 2) | Pass |
| `pointer-events: none`; the element at a thirds crossing is the preview canvas | Pass |

Screenshots: [16:9](camera-preview-guides/guides-16x9.png), [9:16](camera-preview-guides/guides-9x16.png), [4:3](camera-preview-guides/guides-4x3.png).

Unit tests: `apps/desktop/test/guides.test.ts` (settings parse, toggle, geometry at 16:9, 9:16, 4:3, and device pixel ratios 1, 1.25, 1.5, 2).

## Not verified (owner on macOS)

- The Tauri WebView keeps the state across an app restart, and a show open does not change it.
- Selection, gizmo drag, and navigation with guides on, with a loaded scene.
- The guides snap again when the window moves to a display with another pixel ratio at the same CSS size. Unknown: the `matchMedia` change event does not fire under Playwright viewport emulation, so the cloud could not check it.
- With both guides on, OBS and a camera screenshot show no guide pixels. By design the guides are DOM in the Scene window and no renderer code reads them, but no capture was made.
