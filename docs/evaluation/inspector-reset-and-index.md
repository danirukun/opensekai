# Inspector reset and section index check

Date: 2026-10-20. Scope: UX-02 and UX-01, bundle B17 ([#180](https://github.com/danirukun/opensekai/issues/180), [#179](https://github.com/danirukun/opensekai/issues/179)). Contract: [inspector reset and section index](../../spdd/prompt/2026-10-20-inspector-reset-and-index.md). Base commit: 93144d5 plus the B17 implementation branch changes.

## Linux cloud (verified)

Environment: Ubuntu x86_64 cloud container, headless Chromium 156 (Playwright), viewport 1280 × 640, device scale factor 1. The Editor window frontend is the `vite preview` build of `apps/desktop` at `http://127.0.0.1:4173/?view=editor`. There is no Tauri host. The check script puts a small stand-in for the host in the page: it answers `editor_connection` with an operator descriptor and routes the operator WebSocket to a real `@opensekai/session` in the script process. Each scene command (`sceneInspect`, `scenePatch`) runs the session code. `appStatus` is made by the stand-in from the session revision. No renderer runs in this check; the Inspector does not need one.

Script: [headless-check.mjs](inspector-reset-and-index/headless-check.mjs). Raw output: [headless-check.txt](inspector-reset-and-index/headless-check.txt). Result: 18 pass, 0 fail.

| Check | Result |
| --- | --- |
| A Point Light added from the Add menu shows no field reset mark. Only the Position row button shows, because the add position is not the reset target (R1, R8) | Pass |
| A drag of Intensity shows the Intensity mark (R5) | Pass |
| A click on the mark sends exactly one `scenePatch` (`setLight`, current `expectedRevision`); Intensity is 20; the revision increases by one; the mark goes away (R6) | Pass |
| A `scenePatch` of Range sent to the session from outside the editor (the command that MCP `scene_patch` uses) shows the Range mark after the revision arrives (R9) | Pass |
| The Position button resets to zero and hides; it shows again after a move (R8) | Pass |
| With the shadow on, the index lists Transform, Light, Affect, Shadow (R11, R13) | Pass |
| Scroll moves `aria-current`: top, the Light heading, the end of the column (R14) | Pass |
| A click on Affect (reduced motion) scrolls its heading to the top and focuses it; Affect is current (R16) | Pass |
| A smooth jump to Shadow, where the column cannot scroll that far, ends with Shadow focused and current (R16) | Pass |
| Enter on the Affect heading collapses it; its fields stay mounted; the state is in `opensekai.inspector.sections` (R10, R12) | Pass |
| Affect is still collapsed after a page reload (R12) | Pass |
| Tab from the Range slider reaches the Range mark, then the next field (R5) | Pass |
| A VMC receiver shows Receiver open and Smoothing, Face, Diagnostics collapsed, with no Advanced disclosure (R11, R12) | Pass |
| A Beta reset changes only Beta, to 0.5 (R6) | Pass |
| A properties column of 487 px shows no index (R13) | Pass |
| A change of the selected entity scrolls the column to the top (R17) | Pass |

Screenshots: [new point light](inspector-reset-and-index/point-light-new.png), [index after scroll](inspector-reset-and-index/light-index-scrolled.png), [Affect collapsed after reload](inspector-reset-and-index/light-affect-collapsed.png), [tracking Smoothing](inspector-reset-and-index/tracking-smoothing.png).

Unit tests: `apps/desktop/test/property-defaults.test.ts` (8 tests: add defaults for each kind and light type, reset field lists for each kind and none of R4, the R2 tolerance, fallbacks for missing fields) and `apps/desktop/test/inspector-sections.test.ts` (5 tests: section order, start state, invalid and oversize stored values, toggle round trip, current section rule).

## Handbook

The [Warudo asset overview](https://docs.warudo.app/docs/assets/overview) loaded on 2026-10-20. It says only that the properties of a selected asset show in the right panel. It does not describe a reset mark, sections, a section index, or collapse. Thus there is no difference to record against the contract.

## Gaps

- Camera, haze, environment, avatar, and the iFacialMocap and MediaPipe receivers were not driven in the browser. The unit tests cover their defaults and field lists. The field components use the same mark and commit path as the light and smoothing fields that the browser check drove.
- The expression row mark was not checked: an avatar with triggerable expressions needs an imported model, which needs the host.
- The face mapping marks and the blend shape row mark were not driven in the browser.

## Not verified (owner on macOS)

- The look of the reset marks in the left gutter, the section headings, and the index in the macOS Editor window.
- The scroll follow of the index with a trackpad and with momentum scroll.
- The collapse state after an app restart in the Tauri WebView.
- A reset that OBS shows, for example a light Intensity reset.
- An expression row reset on a VRM with custom expressions.
- Windows is not checked.
