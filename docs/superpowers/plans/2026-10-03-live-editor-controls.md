# Live editor controls implementation plan

> For agentic workers: use the preserved implementation workflow and bounded independent tasks. Root owns integration and live verification.

**Goal:** Add direct grouped sidebar controls and apply transform edits as the user changes them.
**Architecture:** Existing scene operations remain authoritative. Pure grouping derives sidebar sections. One active and one latest pending transform bound edit traffic.
**Tech stack:** Svelte5, shared Oshi UI, TypeScript, existing Tauri/Three.js runtime.
**Spec:** spdd/prompt/2026-10-03-live-editor-controls.md.

## Global constraints

No new dependencies or image IPC. One active commit and one latest pending transform. Minimum16ms flush interval. Current revisions, explicit conflict cancellation, preserved user scene. Private captures/phone/model remain ignored. No stream or push.

## Review focus

- Rapid X/Y/Z edits must retain the last full transform, even while a command is pending.
- Partial negative/exponent input and invalid scale must not reach the session.
- An external mutation or selection change must prevent queued stale transforms.
- Sidebar action buttons must not alter selection or break Arrow/Home/End navigation.
- Camera and visibility state must be visible in both preview and clean OBS.

## Task1: Grouped sidebar

Files: editor/asset-groups.ts, components/Hierarchy.svelte, test/asset-groups.test.ts.
- [x] Write grouping tests for mixed types, stable order, empty categories and hidden/search matches; run RED.
- [x] Implement groupEntities(entities,search) returning stable AssetGroup values.
- [x] Render collapsible sections with distinct selection, visibility and camera buttons. Derive active output from scene.outputs. Navigate selection buttons in grouped visible order.
- [x] Run focused tests and Svelte checks; review action propagation and accessibility.

## Task2: Bounded live transforms

Files: editor/live-transform.ts, editor/model.ts, components/TransformFields.svelte, Inspector.svelte, EditorApp.svelte; test/live-transform.test.ts and model tests.
- [x] Write deferred-command tests: offer A/B/C before flush sends C; offer D/E during active sends E after acknowledgement. Test failure, disposal, selection and external revision cancellation; run RED.
- [x] Add transformPending to EditorView. Keep ordinary command lock while allowing transform fields during their own mutation.
- [x] Implement coordinator over model.read/subscribe/setTransform with one active and one latest pending edit,16ms pacing and validated revision promotion.
- [x] Wire valid input, scrub and reset to the coordinator. Remove Apply. Preserve local focused field values across own commits. Restore authoritative values on failure/selection change.
- [x] Run focused unit tests and workspace checks. Inspect no redundant per-input API or event queue.

## Task3: Actual app and OBS

Files: ignored private acceptance helpers; docs/evaluation/live-editor-controls.md; docs/warudo-parity.md.
- [x] Save current private scene, run focused/full required checks, checkpoint source and build the macOS release.
- [x] Restore exact user assets/transforms/receiver configs/camera output after restart through the common API.
- [x] Verify grouped search/collapse, row eye hide/show and camera activation by actual UI actions.
- [x] Verify numeric position/rotation/scale without Apply, rapid edits, scrubbing and reset. Match current revision/camera in preview and OBS; retain images and hashes.
- [x] Clean owned OBS resources, update parity/evidence/plan and commit the final checkpoint.
