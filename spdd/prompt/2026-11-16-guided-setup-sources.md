# REASONS: Guided setup with a face and body choice

Date: 2026-11-16. Analysis: [guided setup sources](../analysis/2026-11-16-guided-setup-sources.md). Issue: [#167](https://github.com/danirukun/opensekai/issues/167) (TRK-23). Queue bundle B42. This contract changes the guided tracking setup of the 2026-10-21 design. Where the two differ, this contract wins. Base: `06dce38`, after B33.

## R — Requirements

### Entry and tip

1. "Set up tracking" is the first control of the character Tracking section. It has the same Button, variant, and disabled rule as before.
2. The Receiver section of a tracking source starts with the text "No character uses this source. Use Set up tracking on a character." when no avatar binds the source in any slot. The text is not a button, a link, a badge, or an alert. When a character binds the source, the text goes.

### Step 1: Choose

3. Step 1 has a Face select, a Body select, a Hands checkbox, and a primary Button "Next". The app tiles go.
4. Face options, in this order: Webcam, FaceKit, iFacialMocap, SelfReflect, Other VMC app, OpenSeeFace, None. FaceKit shows only when `isMac(currentPlatform())` is true. The FaceKit option is disabled when an avatar other than this one binds an enabled `facekit` source.
5. Body options, in this order: Same as face, Webcam, SelfReflect, Other VMC app, None. "Same as face" is disabled when the face choice is face-only (FaceKit, iFacialMocap, OpenSeeFace) or None. When the face choice changes to one of these and Body is "Same as face", Body changes to None.
6. The Hands checkbox, with the label "Hands", shows only when the body resolves to Webcam (Body Webcam, or Body Same as face with Face Webcam). It is a native checkbox in the `option` label pattern of `TrackingMappingFields.svelte`.
7. Initial values:
   - When the character binds no face source and no body source: Face Webcam, Body Same as face, Hands on. (Default: owner question Q1, see `issues.md`.)
   - Otherwise, the values come from the bindings:
     - `vmc` with `positions: 'rotationsOnly'` gives SelfReflect.
     - Other `vmc` gives Other VMC app.
     - `mediapipe` gives Webcam.
     - `facekit`, `ifacialmocap`, and `openseeface` give their own names.
     - A body source with the same ID as the face source gives Same as face.
     - `null` gives None.
     - Hands is on when the fingers slot holds the webcam source.
8. "Next" is disabled when Face and Body are both None.

### Presets

9. `TrackingPresetId` gets `webcam`, `openseeface`, and `facekit`. Each preset gets `calibrate: boolean` (false for `selfreflect` and `vmc`, true for the others). `connect` gets the values `pickCamera` (webcam) and `pickHostCamera` (facekit). OpenSeeFace uses `showAddress` with `127.0.0.1:11573` (`defaultTrackingConfig('openseeface')`). The existing presets keep their configs.

### Plan

10. `resolveSetup(choice)` gives zero, one, or two parts. Each part is `{ preset, roles: ('face'|'body'|'fingers')[], config }`.
    - A webcam part sets `face`, `upperBody`, and `hands` from its roles. It keeps `mirror` and `deviceId` from a reused source.
    - When Face and Body resolve to the same preset, the result is one part with both roles.
    - Fingers go to the body part when the body is SelfReflect, Other VMC app, or Webcam with Hands on. Otherwise, the fingers slot is `null`.
11. `planSetup(scene, avatarId, parts, phoneAddress, eyeBones, newId)` gives one patch for all parts. For each part, the plan selects a source in this order:
    1. a source of the same kind that this avatar binds in any slot;
    2. a source of the same kind that no avatar binds (for VMC, OpenSeeFace, and iFacialMocap, one on the preset port first);
    3. a new source.

    The plan never selects a source that another avatar binds. The endpoint rules of `planConnect` stay the same. One source never serves two parts.
12. Each source that this avatar bound before the run, that no avatar binds after the run, and that is enabled gets `setTrackingConfig` with `enabled: false` in the same patch.
13. When the patch would make more than 4 tracking sources, `planSetup` gives `blocked: 'sourceLimit'`. The guide shows the alert "Tracking source limit reached" on Step 1 and sends no patch.

### Connect

14. The Connect step shows one block for each part, Face first.
    - VMC and OpenSeeFace: the address and port, as today.
    - iFacialMocap: the phone address field, as today.
    - Webcam: a Camera select from the browser camera list, with the hidden-camera rule of the inspector.
    - FaceKit: a Camera select from `faceKit.list()`, and the line "Uses a private macOS API. It can stop after a macOS update."

    A camera change writes `setTrackingConfig` to the source of that part.
15. The guide polls `trackingProbe` every 100 ms for each part (at most 2 calls in each poll). The Connect step ends when each part is `receiving`.
16. For each part in `error` or `unavailable`, the block shows an alert with `status.error` (or the state label of `trackingStateLabel` when the error is `null`). For `permissionNeeded`, the block shows a secondary Button "Open Settings" that calls `faceKit.openSettings()`. The guide does not start, enable, or select another tracker when a part fails.

### Relax, expressions, review

17. At the end of Relax, the guide sends `calibrateTracking` once for each part whose preset has `calibrate: true`. When a face part exists, the Relax heading is "Relax your face". When no face part exists, it is "Sit straight".
18. Only the face part drives the expression steps, the coach, and `fitBlendShapeRanges`. Without a face part, the guide goes from Relax to Review and sends no fit.

### Cancel and second run

19. × and Cancel restore:
    - the bindings of the avatar;
    - the mapping of the face source, as today;
    - the config and smoothing of each source that the run changed and did not create (released sources included).

    The guide removes each source that the run created. This fixes the deferred position-rule defect.
20. A second run on the same character updates in place under R11 and R12. A run on the second character never changes a source of the first character.

### Test sender and records

21. `tools/evaluation/src/tracking-feed.ts` sends a fake VMC or iFacialMocap stream:
    - first a neutral phase (all expressions 0, a small head sway);
    - then each ARKit expression target of `EXPRESSION_STEPS` at full value in sequence, with `eyeLook*` channels;
    - never `cheekPuff` or `tongueOut`.

    Script: `pnpm evaluate:tracking-feed --kind vmc|ifacialmocap --host <ip> --port <n> --neutral-seconds <s> --seconds <s>`.
22. `ARCHITECTURE.md`, the TRK-23 parity row, and `docs/evaluation/guided-setup-sources.md` agree with the code. A value that was not measured is "unknown".

Not in this slice:
- "Body follows head";
- more phone presets;
- a camera rule for MediaPipe;
- a change to a schema, the session, MCP, the host, or the show file version.

## E — Entities

- `TrackingPreset`: add `calibrate: boolean`. `connect` gets `'showAddress' | 'askPhone' | 'pickCamera' | 'pickHostCamera'`.
- `FaceChoice = 'webcam' | 'facekit' | 'ifacialmocap' | 'selfreflect' | 'vmc' | 'openseeface' | 'none'`.
- `BodyChoice = 'same' | 'webcam' | 'selfreflect' | 'vmc' | 'none'`.
- `SetupChoice { face: FaceChoice; body: BodyChoice; hands: boolean }`.
- `SetupPart { preset: TrackingPreset; roles: ('face'|'body'|'fingers')[]; config: TrackingConfig }`.
- `SetupPlan`: `{ ops, parts: { role, sourceId, created }[], released: Id[] } | { blocked: 'sourceLimit' }`.
- `GuideSnapshot`: add `sources: Record<Id, { config, smoothing }>` and `created: Id[]`.
- Guide state: `parts` in place of the one `preset` and `sourceId`. `faceSourceId: Id | null`.

## A — Approach

- Pure functions first: presets, `initialChoice`, `faceOptions`, `bodyOptions`, `resolveSetup`, `planSetup`, `planCancel`, `sourceUsers`. A unit test covers each behavior.
- An integration test applies the `planSetup` patches to a real session. It checks the scene validation boundary: the limit, the share rule, and face-only kinds in the body slot.
- The reducer changes from one source to a list of parts. The effects carry a `sourceId`.
- The component keeps the IO: probes, patches, camera lists, and the settings command. `EditorApp` passes `devices` and `faceKit` as it does to the Inspector.
- The fake sender reuses `encodeMessage` and `encodeBundle` from `vmc-feed.ts`.

## S — Structure

- Changed:
  - `packages/contracts/src/tracking-presets.ts` and `packages/contracts/test/tracking-presets.test.ts`.
  - `apps/desktop/src/editor/tracking-guide.ts`, `tracking-guide-plan.ts`, `tracking-guide-view.ts`, `live-fields.ts`, and their tests.
  - `apps/desktop/src/components/TrackingGuide.svelte`, `AvatarSourceFields.svelte`, `TrackingSourceFields.svelte`, `apps/desktop/src/EditorApp.svelte`.
- New:
  - `apps/desktop/src/editor/tracking-guide-setup.ts` and `apps/desktop/test/tracking-guide-setup.test.ts`.
  - `apps/desktop/test/tracking-guide-setup.integration.test.ts`.
  - `tools/evaluation/src/tracking-feed.ts` and `tools/evaluation/test/tracking-feed.test.ts` (use the folder of the `vmc-feed` tests).
  - `docs/evaluation/guided-setup-sources.md`.
- Changed: `ARCHITECTURE.md` (the guide sentence), `docs/warudo-parity.md` (TRK-23), and the `package.json` that defines `evaluate:vmc-feed`.
- No change: `packages/contracts/src/tracking.ts`, `schema.ts`, `packages/session/**`, `apps/mcp/**`, `apps/desktop/src-tauri/**`.

## O — Operations

One slice, in one worktree, in this order: presets → setup model → plan and cancel → reducer → UI → sender → records. The plan gives the tasks, files, tests, and commits. B33 merges first.

## N — Norms

- Functional TypeScript and plain data, in the compact style of the nearby tracking files.
- Controls come from `@oshi-connect/ui`. The only native control is the Hands checkbox.
- UI copy is only:
  - the option names;
  - "Hands", "Next", "Open Settings";
  - "Relax your face" and "Sit straight";
  - "Tracking source limit reached";
  - the FaceKit line;
  - the tip.
- No card grid, no badge, no colored side bar.
- Prose follows ASD-STE100.
- Unit tests cover each new function behavior. Integration tests are only at the session boundary.

## S — Safeguards

- Do not add a Blueprint, a graph, or a template to the setup.
- Do not bind a source that another avatar binds. Do not change a source of another avatar.
- Do not start, enable, or select another tracker when a source fails.
- Do not stop a source that another avatar binds, or a source that this avatar did not bind before the run.
- Do not change a schema, the show file version, the session, MCP, or the host.
- Do not send camera frames through IPC.
- Do not launch the app as the executor. Do not publish or start a live stream in a check.
- Do not claim a webcam or FaceKit result that the owner did not check at the camera.
