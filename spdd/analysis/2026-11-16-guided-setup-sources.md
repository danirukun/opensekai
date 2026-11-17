# Analysis: Guided motion capture setup with a face and body choice

Date: 2026-11-16. Scope: bundle B42, issue [#167](https://github.com/danirukun/opensekai/issues/167) (TRK-23). Contract: [guided setup sources](../prompt/2026-11-16-guided-setup-sources.md). Related: the guided tracking setup design (`docs/superpowers/specs/2026-10-21-tracking-setup-walkthrough-design.md`), the slice contracts `spdd/prompt/2026-10-21-tracking-setup-s1…s4-*.md`, the B5 contract (tracking receive, two performers), the B6 contract (calibration and overrides), and [FaceKit tracking on macOS](../prompt/2026-11-11-facekit-macos-tracking.md) (TRK-24).

The facts below come from the code at commit `06dce38`. **[V]** marks a fact that was read in the code or in a local document. **[I]** marks an inference, or a fact known only from a web page summary.

## Problem

Issue #167 asks for four things:

1. The character inspector starts a guided setup.
2. The user selects the face source and the body source.
3. The setup creates the tracker assets and the wiring that drives the character.
4. A tracker that the user adds by hand shows a tip that it does not create this wiring.

Most of this work is done. PR #235 merged the guided setup on 2026-10-26. The gaps are these:

- The guide does not let the user select a face source and a body source. It offers only three phone and VMC apps.
- The webcam trackers (MediaPipe and FaceKit) and OpenSeeFace are not in the guide.
- A tracker that the user adds by hand shows no tip.

## Current behavior

### What ships (PR #235, merge `745b550`)

- **[V]** The 2026-10-21 design and its plan are implemented in full (slices S1 to S4).
- **[V]** **Entry.** A secondary Button "Set up tracking" is the last control of the character Tracking section (`apps/desktop/src/components/AvatarSourceFields.svelte:20`).
  - It calls `onguide(entityId)`.
  - `EditorApp.svelte:83,261-262` keeps `guideFor` and shows `TrackingGuide` in the properties column in place of the Inspector.
  - Open show is disabled while the guide is open.
- **[V]** **Files.**
  - Guide component: `apps/desktop/src/components/TrackingGuide.svelte`.
  - Pure reducer: `apps/desktop/src/editor/tracking-guide.ts`.
  - Pure patch plans: `apps/desktop/src/editor/tracking-guide-plan.ts` (`planConnect`, `planCancel`).
  - View helpers: `tracking-guide-view.ts`.
  - Coach: `CoachFace.svelte` and `editor/coach-face.ts`.
  - Meter: `GuideMeter.svelte`.
  - Tests: `apps/desktop/test/tracking-guide*.test.ts`, `coach-face.test.ts`.
- **[V]** **Steps.** `pick`, `connect`, `relax`, `expressions`, `review` (`TrackingGuide.svelte:14`). Step 1 shows one tile for each entry of `TRACKING_PRESETS` (`packages/contracts/src/tracking-presets.ts`):
  - SelfReflect: VMC on `0.0.0.0:39539`, slots body, face, and fingers, `positions: 'rotationsOnly'`.
  - iFacialMocap: `0.0.0.0:49983`, slot face, asks for the phone address.
  - Other VMC app: the same as SelfReflect, with no position rule.
- **[V]** **Writes.**
  - At Connect: one `scenePatch` (`createEntity` or `setTrackingConfig`, `setTrackingSmoothing`, `setTrackingMapping` with `useEyeBones`, `setAvatarTracking`).
  - At the end of Relax: `calibrateTracking`, for the iFacialMocap preset only (`tracking-guide.ts:132` compares `preset.id`).
  - After the last expression step: one `scenePatch` with `fitBlendShapeRanges`.
  - The guide polls `trackingProbe` every 100 ms for one source (`TrackingGuide.svelte:88`).
- **[V]** **Failed states.** The Connect step shows a source error only when the probe state is `error` (`TrackingGuide.svelte:145`). For the TRK-24 states `unavailable` and `permissionNeeded`, it shows "Waiting for data" and does not stop.
- **[V]** **Evidence.** `docs/evaluation/tracking-setup-walkthrough.md`: a live SelfReflect run on macOS, with OBS on WebGPU. TRK-23 is "Partial" (`docs/warudo-parity.md:116`).

### How a tracker drives a character

- **[V]** No graph drives tracking. A character has `tracking: { bodySourceId, faceSourceId, fingersSourceId?, body? }` (`packages/contracts/src/tracking.ts:33`). On each tick, the session composes each avatar from its bound sources. `setAvatarTracking` writes the binding (`packages/session/src/scene-ops.ts:71`).
- **[V]** The 2026-10-21 design does not let a generated Blueprint drive the default tracking path. Reason: a deleted wire or a disabled graph must never stop tracking. Thus "the wiring" in issue #167 is the binding and the source entity. TRK-23 records this as **Different**, not as a gap.
- **[V]** The B5 template Upper Body Rotation (`packages/contracts/src/blueprint-templates/upper-body-rotation.json`) is optional. Tracking works without it.

### Tracker kinds

- **[V]** `TrackingConfig` kinds (`tracking.ts:7`): `vmc`, `ifacialmocap`, `openseeface`, `mediapipe` (`deviceId`, `face`, `upperBody`, `hands`, `mirror`), and `facekit` (`deviceId`).
- **[V]** Face-only kinds: `ifacialmocap`, `openseeface`, `facekit` (`FACE_ONLY_TRACKING_KINDS`, `tracking.ts:41`).
- **[V]** Add menu (`apps/desktop/src/editor/add-menu.ts`): VMC Receiver, iFacialMocap Receiver, OpenSeeFace Receiver, MediaPipe Tracker. "FaceKit Tracker" shows on macOS only (`isMac(currentPlatform())`, `apps/desktop/src/blueprints/keystroke-format.ts:3-4`).
- **[V]** Calibrate shows for each kind except VMC (`TrackingSourceFields.svelte`, `calibrates`).
- **[V]** **MediaPipe.**
  - It runs in the Editor window (`apps/desktop/src/tracking/mediapipe.ts`).
  - Its camera list is the browser list `devices` (`EditorApp.svelte:81`).
  - It reports `receiving` when a sample has bones or expressions (`mediapipe.ts:61`).
- **[V]** **FaceKit.**
  - It runs in the host.
  - The camera list comes from `facekit_camera_list`. `open_camera_settings` opens the Camera pane (`EditorApp.svelte:80`, `editor/facekit.ts`).
  - At most one session runs. Each other enabled `facekit` source has `error` with "FaceKit used by <name>" (FaceKit contract R6).
  - It sends the 51 ARKit values, `tongueOut` when present, and the head. It sends no eye bones (FaceKit contract R14, R15).
  - The FaceKit contract excludes "a guided setup preset" from its slice.
  - FaceKit and MediaPipe on the same camera passed on macOS (TRK-24 row, `docs/warudo-parity.md:117`).
  - The inspector line is "Uses a private macOS API. It can stop after a macOS update."

### Two performers and limits

- **[V]** A scene has at most 2 avatars and 4 tracking sources (`packages/contracts/src/schema.ts:265`).
- **[V]** A source belongs to one avatar. A patch whose end state shares a source between two avatars fails with "Tracking source used by another avatar" (`scene-ops.ts:113`). One avatar can use one source in more than one slot.
- **[V]** The character selects disable a source that the other character uses (`apps/desktop/src/editor/live-fields.ts:14-18`).
- **[V]** `planConnect` never rebinds a source of another character. It selects a source in this order:
  1. a same-kind source in the preset slots of this character;
  2. a free same-kind source (one on the preset port first);
  3. a new source.

  When the endpoint cannot be shared, a VMC source moves to the next free port from 39540, and iFacialMocap asks for the phone address (`tracking-guide-plan.ts:38-87`).

### Second run on the same character

- **[V]** A second run updates the setup in place. A reused source gets `setTrackingConfig` only when the config is different. The fit replaces the ranges of the measured channels and keeps the other ranges.
- **[V]** **Gap.** When a second run selects a different kind, the run unbinds the old source but does not stop it. It keeps its port or camera and counts toward the limit of 4 (`tracking-guide-plan.ts:72-86`).
- **[V]** **Deferred defect from PR #235.** × leaves the preset position rule on a reused source that was disabled before the run. `planCancel` restores the mapping and the bindings, but not the config (`tracking-guide-plan.ts:89-106`).

### Hand-added tracker

- **[V]** `TrackingSourceFields.svelte`, `Inspector.svelte`, and `Hierarchy.svelte` show no text that says that a source drives no character.

### Fake senders

- **[V]** `pnpm evaluate:vmc-feed` sends the VRM 0 clips `Blink` and `A I U E O` (`tools/evaluation/src/vmc-feed.ts`). These are not ARKit names. With this feed, each guide expression step ends as "not sent".
- **[V]** The repository has no iFacialMocap test sender.
- **[V]** The iFacialMocap text form (`apps/desktop/src-tauri/src/tracking/parser.rs:365-420`):
  - Channels are separated by `|`.
  - An expression is `name-value` (0 to 100) or `name&value`.
  - Bones are `head#rx,ry,rz,tx,ty,tz`, `leftEye#rx,ry,rz`, and `rightEye#rx,ry,rz`.
  - A packet has at most 8192 bytes and 64 channels.

### UI kit

- **[V]** `@oshi-connect/ui` has no checkbox. The editor uses a native checkbox in a label (`TrackingMappingFields.svelte:32`, `<label class="option"><input type="checkbox" …>`). The kit `Select` has no disabled option, so `AvatarSourceFields.svelte:18` marks options with an attach.

## Reference behavior

- **[V]** The 2026-10-17 UI audit did not see the Warudo setup flow, because Warudo crashed when it loaded a character. The Warudo screens and labels are not confirmed.
- **[I]** The Warudo handbook (mocap overview, face tracking, and body tracking pages, read on 2026-11-13) says:
  - There are two entry points. The Onboarding Assistant removes the old setup when it runs again. Character → Setup Motion Capture adds a setup.
  - The user selects a face tracking system and a pose tracking system. MediaPipe is the beginner recommendation.
  - Warudo generates the Blueprints "Face Tracking - <system>" and "Pose Tracking - <system>".
  - A mocap asset that the user adds with Add Asset does not drive the character.

## Decision

The owner accepted these items on 2026-11-13:

1. Step 1 has a Face select and a Body select. The Body options are Same as face, Webcam, SelfReflect, Other VMC app, and None. A Hands checkbox shows for a webcam body. The app tiles go.
2. OpenSeeFace is in the guide.
3. The run stops each source that it unbinds when no character uses that source after the run. The run reuses an unbound source of the same kind.
4. The tip text is "No character uses this source. Use Set up tracking on a character." It is text only.
5. "Body follows head" is deferred.
6. The orchestrator checks the VMC and iFacialMocap paths with a fake sender. The webcam paths stay `accept:local`.
7. The integrator moves "Set up tracking" to the top of the Tracking section.

FaceKit merged after the recon. The contract adds it as follows, in agreement with these decisions:

- FaceKit is a Face option on macOS only, as in the Add menu.
- FaceKit is face-only. Thus Body "Same as face" is disabled for it, as for iFacialMocap and OpenSeeFace.
- The FaceKit option is disabled when another character binds an enabled `facekit` source, because only one session runs.
- The FaceKit Connect step shows the host camera list and the private API line.
- The guide shows the reason for `error` and `unavailable`, and the Open Settings button for `permissionNeeded`.
- The first-run Face default on macOS is an open owner question. Until the owner answers, the contract uses Webcam on all platforms.

## Risks

- **Open owner question.** What is the default Face source on macOS: Webcam (MediaPipe) or FaceKit? Recommendation: Webcam. TRK-24 is an opt-in private API that can stop after a macOS update.
- **[I] MediaPipe with no face.** A MediaPipe source with face, upper body, and hands can report `receiving` when the body is in view and the face is not. Relax then captures a neutral with no face values, and each expression step ends as "not sent". The guide does not stop, and the fit writes nothing.
- **[I] Two MediaPipe sources on one camera.** This is not checked. The contract adds no camera rule for MediaPipe.
- **[I] Local iFacialMocap fake.** With the phone address `127.0.0.1`, the handshake from the host can come back to the host socket and count as an invalid packet. The check records the counts.
- **[I] OpenSeeFace.** OpenSeeFace sends 15 ARKit weights, so most expression steps end as "not sent". This is correct behavior.
- **[I] Frame cost.** The cost of MediaPipe, a probe of two sources at 10 Hz, and the preview in one WebView is unknown.
- **Cancel with two sources.** Two sources double the cancel cases. The snapshot must hold each source that the run touches and each source that it releases.
- **B40 overlap.** B40 (language and dark mode) can change strings and colors in the same three components.
