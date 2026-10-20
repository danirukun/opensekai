# Hidden tracker cameras check

Date: 2026-10-20. Scope: TRK-22, bundle B18 ([#166](https://github.com/danirukun/opensekai/issues/166)). Contract: [hidden tracker cameras](../../spdd/prompt/2026-10-20-hidden-tracker-cameras.md). Base commit: 8b59685 plus the B18 implementation branch changes.

## Linux cloud (verified)

Environment: Ubuntu x86_64 cloud container, headless Chromium (Playwright), viewport 1280 × 800. The Editor window frontend is the `vite preview` build of `apps/desktop` at `http://127.0.0.1:4173/?view=editor`. There is no Tauri host. The check script puts a small stand-in for the host in the page: it routes the operator WebSocket to a real `@opensekai/session`, and it delivers the `trackingDevices` UI message as the Scene window does. The device labels are stubs: `FaceTime HD Camera`, `USB Webcam`, `VSeeFace Camera`, `OBS Virtual Camera`, and a 128-character label `a…a!` for the slow pattern. The match Worker is the real module Worker of the build.

Script: [headless-check.mjs](hidden-tracker-cameras/headless-check.mjs). Raw output: [headless-check.txt](hidden-tracker-cameras/headless-check.txt). Result: 11 pass, 0 fail.

| Check | Result |
| --- | --- |
| With the default list, the VSeeFace device is absent and the OBS device is present (R1, R4) | Pass |
| The field shows the default list (R4) | Pass |
| A new line `obs` hides the OBS device at once, with no Apply and no `scenePatch` (R2, R3) | Pass |
| The valid patterns are saved in `opensekai.tracking.hiddenCameras` (R5) | Pass |
| A reload keeps the edit (R5) | Pass |
| "Restore defaults" shows the OBS device again and sends no `scenePatch` (R2, R4) | Pass |
| An invalid line shows "Line 2 is not used."; the other lines apply; the field keeps the text; only valid patterns are saved (R8) | Pass |
| `(a+)+$` shows "Patterns take too long.", shows every device, and does not save (R9) | Pass |
| The next change matches again in a new Worker (R9) | Pass |
| The device that the draft selects stays with its label when a pattern matches it (R7) | Pass |
| The field and the button are outside the source form; the button has `type="button"` (R2) | Pass |

Screenshots: [defaults](hidden-tracker-cameras/defaults.png), [invalid line](hidden-tracker-cameras/invalid-line.png), [too long](hidden-tracker-cameras/too-long.png), [selected device kept](hidden-tracker-cameras/selected-kept.png).

Unit tests: `apps/desktop/test/hidden-cameras.test.ts` (match rule, empty label, invalid line, length and count limits, selected device, storage failure and wrong shape, `fitDevices` byte limit against `parseUIMessage`, store save and restore, store timeout). `apps/desktop/test/ui-message.test.ts`: 16 devices accepted, 17 rejected. Integration test: `apps/desktop/test/hidden-cameras.integration.test.ts` runs the match code in a real Node worker thread; `(a+)+$` against the 128-character label times out, the store shows every device and the alert, keeps the saved list, and matches again in a new thread.

## Handbook

The [Warudo MediaPipe handbook page](https://docs.warudo.app/docs/mocap/mediapipe) loaded on 2026-10-20. It does not describe a hidden-camera setting. There is no difference to record against the contract.

## Gaps

- "Default camera" can resolve to a virtual webcam. The browser does not name the default before `getUserMedia`.
- A computer with more devices than fit in one 4096-byte message (at most 16) can lose the last devices.
- The Scene window side (`fitDevices` in `App.svelte`) has a unit test only. No camera ran in the cloud.

## Not verified (owner on macOS)

- Real AVFoundation labels with one virtual webcam installed (for example the OBS Virtual Camera or VSeeFace).
- The look of the field and the alerts in the macOS Editor window.
- The saved list after an app restart in the Tauri WebView.
- Windows (DirectShow labels) is not checked.
