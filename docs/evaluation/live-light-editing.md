# Live light editing check (B12)

Date: 2026-10-18. Contract: [live light editing](../../spdd/prompt/2026-10-18-live-light-editing.md). Issue: #45 (ENV-07).

Platform: macOS (Darwin 27.0.0, Apple silicon, Retina display), debug build from `pnpm dev:desktop` (WKWebView, WebGPU). OBS 32.2.2 (obs-websocket 5.7.4, 1920 × 1080 at 60), with an isolated QA scene and browser source made by the local QA helper (`obs.mjs`). The QA scene was on program only during the OBS captures, and teardown restored the program scene. Streaming and recording stayed off. Quality profiles: `preview_v1` for the Scene preview and `production_v1` for `output_main`. three.js 0.180.0. Fixture: the library avatar "Nina" (VRM) on an 8 m box floor, made with MCP `scene_patch`.

Method. The app was driven with real mouse and key events (Quartz `CGEvent`) and with the accessibility tree of the Editor window. MCP `scene_inspect` and `app_status` read the scene and the frame acknowledgments while the mouse button was still down. Window captures came from `screencapture -l`, and OBS captures came from `GetSourceScreenshot`. Commits: `4e95bf6` for the gizmo, slider, and color checks; `3546c53` for the shadow box outline; `d743055` for the typed values and the demo recording.

## Gizmo drag (R1 to R8)

| Check | Requirement | Result |
| --- | --- | --- |
| Point light Move drag, 264 pt to the left. While the button is down, the scene has moved on. | R1 | PASS. The revision went from 1 to 34 and x from 0.8 to −0.389 before the release. The release sent no extra commit, because the end pose equals the last sent pose. |
| The preview draws the light and its shadow at the gizmo pose during the drag. | R7 | PASS. During the drag, the point-light shadow of the avatar falls to the right on the floor; before the drag, it fell to the left. |
| OBS follows during the drag. | R1, R7 | PASS. `output_main` acknowledged revision 58, then 82, while the button was down. The three OBS captures (before, mid, after) show the shadow and the shading move. OBS draws no helper. Alpha stays 0 outside the scene. |
| Directional light Rotate drag on the view ring. | R1, R7 | PASS. While the button was down, the rotation changed and the revision went from 123 to 147. The directional shadow turned longer and to the left in the preview and in OBS before the release. |
| The gesture's own revisions do not cancel it. | R2 | PASS. Each drag kept going through 24 to 48 of its own revisions. |
| Continued motion with the Editor minimized. | project rule | PASS. With the Editor minimized, about 205 frames were acknowledged on each of `preview_main` and `output_main` in about 3.5 s. |

Not measured: the OBS frame rate during a drag, and the time from a move to the OBS frame. Escape after a sent commit (R3) and a foreign revision during a drag (R2) have unit tests only (`editor-viewport.test.ts`).

## Directional shadow focus (R9, R10)

| Check | Requirement | Result |
| --- | --- | --- |
| Wide camera (0, 9, 24), floor 40 m. The light at (−1.6, 2.2, 0) gives the avatar a directional shadow. With the light moved to (14, 2.2, 0) and the same rotation, the avatar is outside the 20 m box and has no directional shadow. | R9 | PASS |
| The helper outline of the shadow box shows when the shadow is on. | R10 | FAIL at `4e95bf6`: no outline. Cause: three.js 0.180 does not draw a `LineLoop` (its renderer logs "Objects of type THREE.LineLoop are not supported"). Fixed in `3546c53` with `LineSegments`, with a unit test. PASS at `3546c53`: the white edges show, and the part below the floor is hidden. |

## Inspector controls (R11 to R16)

| Check | Requirement | Result |
| --- | --- | --- |
| Point light Inspector: color swatch and hex field, Intensity and Range sliders with number fields. No added text. | R11, R12, R16 | PASS. The accessibility tree shows an `AXColorWell` "Color" and an `AXSlider` for each slider field. |
| Slider position of the scene value. | R12, R15 | PASS. Intensity 20 (slider end 100) and Range 10 (slider end 50) are both at 585/1000, the cube root of 0.2. Min cutoff 5 (0.01 to 20) is at 630/1000. |
| Intensity slider drag. | R12, R13 | PASS. The intensity went 20 → 39.54 → 69.79 while the thumb was down (revisions 18 and 32). The number field followed. |
| Typed 500 (above the slider end, below the hard limit). | R12 | FAIL at `4e95bf6`: no commit. Cause: the kit number input binds a number, and `parseInRange` called `.trim()` on it. Fixed in `d743055`. PASS at `d743055`: the light took 500, and the slider stayed at 1000/1000. |
| Typed 1001 (above the hard limit). | R12 | PASS at `d743055`. Rejected; no new revision; the field went back to 500. |
| Native color popover. | R11 | PASS. A click on the swatch opens the macOS color popover with "Show Colors…". A swatch pick set `#0433ff` (revision 33). |
| System color panel drag (Show Colors…, color wheel). | R11, R13 | PASS. While the wheel drag continued, the light went `#9327fe` → `#ff00c0` → `#ff0000` (revisions 41, 49, 56). OBS showed the new color mid-drag. Thus WKWebView fires `input` during the pick. |
| Tracking Smoothing: sliders and Reset, no Apply. Min cutoff drag. | R15 | PASS. Min cutoff went 5 → 2.18 (mid-drag) → 0.63, and the number field followed. |

Not checked on macOS: Environment Reflections Intensity, Control Sensitivity, FOV, and Expression Fade sliders (no environment, a free-look camera, and an avatar without triggerable expressions in the fixture). They use the same `SliderField` and the same live helper.

## Other findings

- In the dev build, a Vite reload of the Scene window ends at "Session startup failed". The loopback service then stops answering, and the app must be started again. This is not new in B12. It showed when this check edited files in the checkout of a running dev app.
- A tracking source selection disables the viewport, so a click in the viewport does not select a light while a tracking source is selected. This is the existing rule.
- The shadow box outline is a square normal to the light direction. Most of the square is under the floor or outside a close camera, so it reads best from a wide camera.

## Tests

`pnpm vitest run --project unit`: 920 tests; 919 pass. The failing test, `tools/evaluation/test/node-audit.test.ts` (two Blueprint nodes not audited: `character.setExpression`, `character.toggleExpression`), fails on `main` too; B12 does not change its files. `pnpm vitest run --project integration`: 35 tests pass. `pnpm -r check`: no errors.

Demo: a 13 s screen recording of the gizmo drag, a color pick, and a slider drag (kept outside the repository).
