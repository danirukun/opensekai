# Hidden tracker cameras analysis

Issue: [#166](https://github.com/danirukun/opensekai/issues/166) (TRK-22). Queue bundle B18. Mode: contract-first.

## Problem

The MediaPipe source inspector shows each `videoinput` device that the browser reports. A streaming computer often has virtual webcams: the webcam output of VSeeFace, VTube Studio, a VMC tool, Unity Video Capture, or OpenSekai itself later (CAM-14, #171). An operator can select one by mistake. The tracker then reads an avatar image, not the face of the performer, and the avatar follows itself.

Warudo 0.15.1 (UI audit, 2026-10-17, Windows 11) hides each camera whose name matches an editable list of patterns. The patterns are regular expressions. The default list holds common virtual webcams.

## Existing material

- `apps/desktop/src/tracking/mediapipe.ts` calls `enumerateDevices` after the first `getUserMedia` of a run and sends each `videoinput` as `{deviceId, label}` through `onDevices`.
- `apps/desktop/src/App.svelte` (Scene window) keeps the first 8 devices, cuts each ID to 512 and each label to 128 characters, and sends `trackingDevices` to the Editor window.
- `apps/desktop/src/editor/ui-message.ts` accepts at most 8 devices and at most 4096 bytes in one message.
- `apps/desktop/src/components/TrackingSourceFields.svelte` makes the Camera options: "Default camera" (empty ID), each reported device, and "Unavailable camera" for a saved ID that the list does not have.
- The saved `TrackingConfig.deviceId` is the browser device ID. It is in the show file.
- Per-user editor choices already use `localStorage` with a try/catch (`blueprints/palette-prefs.ts`, the Blueprint drawer, the Scene performance monitor).
- `@oshi-connect/ui` has `Textarea`, `Input`, `Select`, and `Button`.

## Handbook recheck

The [Warudo MediaPipe handbook page](https://docs.warudo.app/docs/mocap/mediapipe) was read again on 2026-10-20. It does not describe a hidden-camera setting, patterns, or a default list. The UI audit of Warudo 0.15.1 stays the only source. There is no difference to record against the contract.

## Findings

1. The 8-device limit applies before any filter. On a computer with many virtual webcams, a real camera can be absent from the list. A filter in the Editor window cannot show a device that the Scene window did not send.
2. The device list is machine-local. A show file can move to a different computer with different cameras. The pattern list is an operator preference of this computer, not scene data.
3. "Default camera" asks the browser for its default device. The browser can pick a virtual webcam. The app cannot filter the default because the browser does not name it before `getUserMedia`.
4. A label is empty until the camera permission is granted. An empty label cannot match a pattern.
5. A user regular expression can be invalid. A bad expression can also take a long time (catastrophic backtracking). Labels are at most 128 characters, which limits the cost, but the count and the length of patterns must also have limits.
6. A saved `deviceId` can point to a camera that a pattern now hides. If the option disappears, the Select shows "Unavailable camera" and the operator thinks the camera is gone.

## Questions resolved without the owner (reversible)

- **Where the list lives.** Per user, in the Editor window `localStorage` key `opensekai.tracking.hiddenCameras`. Not in the show file and not in the scene. Alternative: a show-level setting. Rejected because device names belong to a computer, and a show change would need a contract, Rust mirror, and migration change.
- **Where the editor shows it.** In the MediaPipe source inspector, under the Camera select, as one `Textarea` labelled "Hidden cameras", one pattern on each line, and one ghost button "Restore defaults". Alternative: an app Settings panel. OpenSekai has no Settings panel yet.
- **Match rule.** Each non-empty line, trimmed, is a JavaScript regular expression without flags in the text. The match is case-insensitive and unanchored (`new RegExp(line, 'i').test(label)`). A plain camera name is a valid pattern. Alternative: anchored or case-sensitive match. Warudo users type plain names, so a substring match is the safer default.
- **Default list.** `VSeeFace`, `VTube Studio`, `VMC`, `Unity Video Capture`, `OpenSekai`. The first four come from the issue. `OpenSekai` prepares for CAM-14. Alternative: add `OBS Virtual Camera`. Rejected because operators often route a real camera through the OBS virtual camera.
- **Selected camera.** A camera that the saved config selects stays in the options with its own label, also when a pattern matches it. The filter changes the choice list. It does not change a saved config.

## Risks

- A bad pattern blocks the editor. A short label does not prevent catastrophic backtracking: `(a+)+$` on 128 `a` characters does not finish. A limit on the count and the length of patterns is not sufficient. Therefore the Editor main thread never runs a user pattern. A small Worker compiles the patterns and matches them against the current labels. The Editor waits at most 100 ms. On a timeout it terminates the Worker, shows every device, and shows the alert. A saved bad pattern can then not hang the next start.
- A pattern that matches an empty string (`a|`, `.*`) hides every camera. The Worker treats such a pattern as invalid.
- The Scene window cap hides a real camera. Today the Scene window keeps the first 8 devices and the Editor rejects a larger message. Change: the Scene window sends at most 16 devices and stops before the message passes 4096 bytes; the Editor accepts at most 16. A computer with more devices than fit can still lose a device at the end. This is a known limit; the filter cannot run in the Scene window because the patterns are an Editor preference.
- "Default camera" can resolve to a virtual webcam. The browser does not name the default before `getUserMedia`. This slice does not change it. It is a known gap in the parity line.
- `localStorage` is not available. The filter then uses the default list for this session and does not save.
