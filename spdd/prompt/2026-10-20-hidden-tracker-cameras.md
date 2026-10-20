# REASONS: Hidden tracker cameras

Analysis: [hidden tracker cameras](../analysis/2026-10-20-hidden-tracker-cameras.md). Issue: [#166](https://github.com/danirukun/opensekai/issues/166) (TRK-22). Queue bundle B18.

## R — Requirements

1. The Camera select of a MediaPipe source does not show a device whose label matches a hidden-camera pattern.
2. The operator edits the patterns in the MediaPipe source inspector: one `Textarea` "Hidden cameras", one pattern on each line, and one button "Restore defaults". A change applies to the Camera options at once, with no Apply. The field and the button are outside the source `<form>` and its `fieldset`, so a disabled source does not disable them, and the button has `type="button"`.
3. A pattern is a regular expression. The match is case-insensitive and unanchored. Empty lines and surrounding spaces are ignored.
4. The default list is `VSeeFace`, `VTube Studio`, `VMC`, `Unity Video Capture`, `OpenSekai`. "Restore defaults" sets the field to this list.
5. The list is per user and per computer: Editor window `localStorage` key `opensekai.tracking.hiddenCameras`, as a JSON array of strings. The show file, the scene, the contracts, and the host do not change. Each inspector instance reads one shared module store, so two instances never show different lists.
6. A device with an empty label is never hidden.
7. The device that the source draft selects (`draft.config.deviceId`) stays in the options with its label, also when a pattern matches it. "Default camera" and "Unavailable camera" do not change.
8. A pattern is invalid when it does not compile, when it matches the empty string, when it has more than 128 characters, or when it is after the 32nd pattern. An invalid pattern does not apply. The other patterns still apply. The field shows one alert, "Line N is not used.", for the first invalid line. The field keeps the text that the operator typed; the store saves the valid patterns only.
9. The Editor main thread never runs a user pattern. A Worker (`hidden-cameras-worker.ts`) gets the patterns and the labels and returns the hidden device IDs and the first invalid line. The Worker posts `{ready: true}` when its module has loaded. The Editor waits at most 100 ms for each match, counted from the post of the request to a ready Worker; the Worker start does not count. If the Worker cannot start, every device shows. On a timeout it terminates the Worker, shows every device, does not save the text, and shows the alert "Patterns take too long." The next change starts a new Worker. At start, a saved list that times out also shows every device.
10. The Scene window sends at most 16 devices in `trackingDevices` and stops before the message passes 4096 bytes. The Editor window accepts at most 16.
11. When `localStorage` fails, the default list applies and edits apply only until the Editor window closes. Values read from storage are checked again with requirement 8: a value that is not an array gives the default list; in an array, the entries that are not strings, are empty, or are longer than 128 characters are dropped, and the list is cut at 32. The Worker drops the entries that do not compile or that match the empty string, and the next save stores the result.
12. Known gaps, not in this slice: "Default camera" can resolve to a virtual webcam; a computer with more devices than fit in requirement 10 can lose a device at the end of the list.

## E — Entities

- `CameraDevice`: `{deviceId: string, label: string}` (exists, `tracking/mediapipe.ts`).
- `PatternCheck`: `{patterns: string[], invalidLine: number | null}`. `patterns` holds the valid patterns in order. `invalidLine` is the 1-based line of the first invalid entry.
- `MatchRequest`: `{text: string, labels: string[]}`. `MatchReply`: `{hidden: boolean[], patterns: string[], invalidLine: number | null}`. The Worker gets the raw field text, so `invalidLine` is the line number in the field, empty lines included. `patterns` holds the valid patterns, so the Editor can save them without running them.
- `WorkerPort`: `{postMessage, onmessage, terminate}`. A browser `Worker` and a Node worker thread (integration test) both fit it.
- `DEFAULT_HIDDEN_CAMERAS`: the default list in requirement 4.

## A — Approach

Pure functions in `apps/desktop/src/tracking/hidden-cameras.ts`:

- `checkPatterns(text): PatternCheck`: split lines, trim, drop empty lines, apply the count and length limits, compile with the `i` flag, reject an empty-string match. This function runs only in the Worker and in unit tests.
- `matchLabels(patterns, labels): boolean[]`: true when the label is not empty and a pattern matches it. Runs only in the Worker.
- `visibleCameras(devices, hidden, selectedId): CameraDevice[]`: keep a device when it is not hidden or when its ID equals `selectedId`. Keep the order. Runs in the Editor.
- `loadHiddenCameras(storage)`, `saveHiddenCameras(storage, patterns)`: try/catch; a missing, unparsable, or wrong-shape value gives the default list.
- `fitDevices(devices, limit, bytes)`: the first devices that fit in the count and the byte limit of requirement 10. Used by the Scene window.

`createHiddenCameras({spawn, storage, deadline})` in `hidden-cameras.ts` holds the raw text, the hidden device IDs, and the alert as plain data with a `subscribe`, so the unit and integration tests run it without Svelte. A new request terminates a Worker that is still busy; a reply for an old request is ignored. `hidden-cameras-store.svelte.ts` makes one module instance and mirrors its state in `$state`. The controller starts the Worker on each change of text or labels with the 100 ms deadline and saves the valid patterns. `TrackingSourceFields.svelte` reads the store and derives the options from `visibleCameras(...)`.

## S — Structure

- New: `apps/desktop/src/tracking/hidden-cameras.ts`, `hidden-cameras-worker.ts`, `hidden-cameras-store.svelte.ts`; `apps/desktop/test/hidden-cameras.test.ts`, `apps/desktop/test/hidden-cameras.integration.test.ts`.
- Changed: `apps/desktop/src/components/TrackingSourceFields.svelte`, `apps/desktop/src/App.svelte`, `apps/desktop/src/editor/ui-message.ts`, and its existing test.
- Changed: `ARCHITECTURE.md` (Editor window per-user state: add `opensekai.tracking.hiddenCameras` and the match Worker).
- Changed: `docs/warudo-parity.md` TRK-22 with only the verified behavior and the known gaps.
- No change: `packages/contracts`, `crates/contracts`, the host, the show format, MCP.

## O — Operations

1. Recheck the Warudo handbook MediaPipe page for the setting name and the default list. Record a difference in the analysis before code.
2. Add `hidden-cameras.ts` and unit tests: plain name, regex, case, empty label, compile error line, empty-string match, count and length limits, selected device kept, storage failure, wrong-shape storage, `fitDevices` byte limit.
3. Add the Worker and the store. Add an integration test that runs the Worker with `(a+)+$` against a 128-character label and proves that the store shows every device and the alert after the deadline.
4. Change the device cap on both sides. Add a `ui-message` test for 16 accepted and 17 rejected.
5. Wire the field and the options in `TrackingSourceFields.svelte`.
6. Run `pnpm check`, `pnpm test:unit`, and `pnpm test:integration`.
7. Run the Editor flow headless with stubbed devices (two real names, `VSeeFace Camera`, `OBS Virtual Camera`): the VSeeFace device is absent, the OBS device is present, a new line `obs` hides it, "Restore defaults" shows it again, and a reload keeps the edit.
8. Ask a reviewer on a different model for defects against these requirements.
9. Update the parity line and `ARCHITECTURE.md`.

## N — Norms

Functional TypeScript and plain data. Match the compact style of the nearby tracking files. Controls come from `@oshi-connect/ui`. UI copy is the field label, the button, and the two alerts, with no helper text (constitution principle 1). Prose follows ASD-STE100.

## S — Safeguards

- Do not save the pattern list in the show, the scene, or the host.
- Do not change a saved `deviceId` because of a pattern.
- Do not hide the selected device or a device without a label.
- Do not run a user pattern on the Editor main thread.
- Do not claim TRK-22 on macOS or Windows from the cloud run. The real device labels (AVFoundation names on macOS, DirectShow names on Windows) need an owner check with one virtual webcam installed (`accept:local`).
