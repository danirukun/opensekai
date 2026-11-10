# Tracked body parts check

Checked 2026-11-10 in a Linux cloud container (Ubuntu 24.04, x86_64, no GPU) on branch `claude/trk05-body-parts`, base `a78b27a`. Contract: [tracked body parts](../../spdd/prompt/2026-11-10-tracked-body-parts.md). Node 26.10.0, pnpm 12.8.1, HeadlessChrome 153 (Playwright 1.65.0, the Chromium build 1243 of the container).

No physical tracker, macOS, or OBS result is claimed. The part list was not compared with the Warudo handbook: the handbook was not reachable from this container.

This container was not the usual cloud environment. It could not download rustc 1.93.1 or the MediaPipe models, so the Rust checks ran on rustc 1.97.0 and `pnpm build` did not run.

## Composer check (unit tests, mock samples)

`packages/session/test/tracking-body-parts.test.ts` calls `createTrackingComposer` as the session calls it, with one character on a VMC body source, an iFacialMocap face source, and a MediaPipe finger source, and one sample from each.

- Without the group, and with all 8 parts at intensity 1, the pose is equal (R7).
- For each of the 8 parts in turn, a part that is off drops exactly the bones of that part, from each source that sent them, and the expressions stay (R5).
- `body` off drops the root. Other parts off keep it. With no part on, `bones` is empty and the expressions stay (R5).
- Intensity 0.5, 2, and 0 give half, double, and zero angles on hips, spine, chest, and upper chest (for example hips 20° about Y becomes 10°, 40°, and 0°). The other bones, the hips position, the weights, the root, and the expressions do not change (R6). A bone in the raw space keeps its rotation at each intensity.
- `setAvatarTracking` stores the parts in the fixed order and stores no group for the default; an intensity of 3 and a duplicate part are rejected with `INVALID_INPUT` and no change (R4).

## Editor controls (headless Chromium)

Method. A scratch Svelte page (not in the repository) mounted the real `Inspector` with a real `createEditorModel` on a real `createSession` (smoke scene with one VMC source, `performer` selected). Playwright used the controls.

Raw output (shortened):

```
parts: Head, Body, Left Arm, Right Arm, Left Fingers, Right Fingers, Left Leg, Right Leg | checked: 8
initial: revision 0, tracking without a body group, 0 patches
after Left Leg and Right Leg off: revision 2,
  patch [{kind: setAvatarTracking, entityId: performer, tracking: {bodySourceId: null, faceSourceId: null,
    body: {movementIntensity: 1, trackedParts: [head, body, leftArm, rightArm, leftFingers, rightFingers]}}}]
after Body Movement Intensity = 1.5: body {movementIntensity: 1.5, trackedParts: [the same 6 parts]}
after Body source = VMC: {bodySourceId: vmc, faceSourceId: null, body: {movementIntensity: 1.5, the same 6 parts}}
after Body Movement Intensity = 3 (out of range): no change
reset marks: Reset Idle animation, Reset Body Movement Intensity, Reset Tracked Body Parts
after Reset Tracked Body Parts: body {movementIntensity: 1.5, all 8 parts} | checked: 8
after Reset Body Movement Intensity: revision 6, tracking {bodySourceId: vmc, faceSourceId: null}
console errors: one 404 for a file that the scratch page does not have (no script error)
```

Result. Each change sends one `setAvatarTracking` patch that keeps the source IDs, and a source change keeps the group (R8). A value out of range sends no accepted change. The reset marks show only on the changed fields, and the scene drops the group when both fields are at the default (R4). The Reset Idle animation mark comes from the smoke scene, whose character has no idle animation. The slider drag was not operated.

## Checks

| Command | Result |
| --- | --- |
| `pnpm check` | 9 packages and `tsconfig.scripts.json`: pass. svelte-check: 0 errors, 0 warnings |
| `pnpm test:unit` | 1998 passed, 1 skipped (231 files). Base `a78b27a`: 1976 passed, 1 skipped (228 files) |
| `pnpm test:integration` | 73 passed, 4 failed, 4 skipped. The 4 failures are in `scripts/prepare-tracking.test.ts`: the MediaPipe model files are not in `artifacts/models`, because this container cannot reach their download host. The base gives the same 4 failures here |
| `cargo test -p opensekai-contracts --no-fail-fast` (rustc 1.97.0) | 120 passed, 0 failed |
| `cargo test --workspace --no-fail-fast` (rustc 1.97.0) | 458 passed, 1 failed, 2 ignored in the full run: `due_clocks_progress_under_sustained_control_without_credit_accumulation` (`clock_integration.rs`, a timing test) failed one time on this 2-core container. It passed in 3 runs of `cargo test -p opensekai-desktop --test clock_integration` (5 passed each). It does not use code that this change touches. The desktop crate needs the output and desktop bundles; they were built without the tracking model step |
| `cargo clippy --workspace --all-targets` (rustc 1.97.0) | Clean, 0 warnings |

One unit test failed one time in a run that shared the CPU with a Rust build: `apps/desktop/test/hidden-cameras.test.ts`, "hides matches, saves only valid patterns, and restores the defaults". It passed in the next 3 runs and in the full run above. It does not use code that this change touches.

## Local acceptance (owner, macOS)

1. Connect a body source (VMC or MediaPipe) to a character with Idle animation on. In Tracking, turn Left Leg and Right Leg off. The legs take the idle pose and the other parts follow the tracker, in the preview and in OBS.
2. Turn Body off. The torso takes the idle pose, the root motion stops, and the arms and the head still follow.
3. Set Body Movement Intensity to 0, 1, and 2 while you lean left and right. The lean of the character is zero, equal, and about double. Calibrate first for a webcam source.
4. Turn Head off. The head bones take the idle pose, and the face blend shapes still follow.
5. Save, close, and open the show. The settings are on the character. A VMC Sender on that character sends the filtered pose.

## Review

Reviewer: Claude Opus (a different model from the implementer), on the diff, the contract, and the issue.

| Finding | Action |
| --- | --- |
| The intensity scaled raw VMC bones about the identity. The renderer blends a raw bone from the rest pose of the model, so intensity 0 moved a torso with a rest rotation off its rest pose | Fixed: only bones in the normalized space scale. R6 changed. Unit test added. Intensity for a VMC body is a later slice |
| A show that is opened or replaced keeps a `body` group that is not in the normal form, and the reset mark then showed a change for the same parts in another order | Fixed for the reset mark: it compares the parts in the fixed order. The stored form of an opened show is not changed; the composer does not depend on the order |
| Look-at and bone offsets from Blueprints still act on a head that is not tracked | Not changed. They are Blueprint layers, not tracking, and R5 covers the bones that the sources send |

## macOS local acceptance (2026-11-10)

Checked on the owner's Mac by a local review agent, on commit `3050ca7`. This section records only what was seen on this machine. Each item that was not seen has the status "not checked".

- Machine: MacBook Pro (Mac15,6), Apple M3 Pro, 36 GB, macOS 27.2 (26B123). OBS 33.0.1 (obs-websocket 5.7.6), one Browser Source in an isolated scene, no stream.
- App: `pnpm dev:desktop` (debug build) with `OPENSEKAI_EVALUATION=1`. rustc 1.93.1, Node 26.13.0, pnpm 12.8.1. Backend WebGPU, preview `preview_v1`, OBS source `production_v1`.
- Fixtures: character `fixture_vrm0_arkit` (sha256 `7b7c689e…`), Idle animation on. Stage: the library asset "OpenSekai Test Stage" `scene_6eb17002…`, hidden for the captures.
- Tracker, first session: no webcam result. The camera request of the development build failed with `NotAllowedError` when this session started the build. No VMC application was on this Mac. The body source was a scripted VMC peer: OSC over UDP at 60 Hz with a root that moves 0.4 m to each side, a torso lean, a head turn, bent arms, a lifted leg, closed fingers, eye bones, and the `Blink` and `A` values.
- Tracker, second session: the FaceTime camera with MediaPipe (face and upper body, hands off, mirror on), with the build started from Terminal, which has the camera permission. See "Webcam check".

### Commands

| Command | macOS result | Difference from the pull request text |
| --- | --- | --- |
| `pnpm i`, `pnpm build` | Pass. `pnpm-lock.yaml` did not change | The cloud run did not run the build |
| `pnpm check` | Pass: 10 packages and `tsconfig.scripts.json`; svelte-check 0 errors, 0 warnings | The text says 9 packages |
| `pnpm test:unit` | 1998 passed, 1 skipped (231 files) | None. `hidden-cameras.test.ts` passed |
| `pnpm test:integration` | 77 passed, 0 failed, 4 skipped | Cloud: 73 passed, 4 failed |
| `cargo fmt --all -- --check` | Clean, exit code 0 | — |
| `cargo clippy --workspace --all-targets` | 0 warnings | None |
| `cargo test --workspace --no-fail-fast` | First run: 457 passed, 4 failed, 2 ignored. Second run: 461 passed, 0 failed, 2 ignored | Cloud (rustc 1.97.0): 458 passed, 1 failed |

The 4 failures of the first run have two causes.

- The 3 tests of `crates/contracts/tests/body_tracking.rs` failed with ``unknown field `body` ``. The shared Cargo target directory held the contracts library of another worktree, built a short time before, and Cargo did not build it again. After `cargo clean` for the workspace packages, the tests passed. This is a hazard of the shared target directory, not a defect of this change.
- `due_clocks_progress_under_sustained_control_without_credit_accumulation` (`clock_integration.rs`) failed one time with `unsolicited frames accumulated credits: 2`. It is the test that failed one time in the cloud run. It passed in the second full run and in 3 more runs of the test file. It fails at times on a 12-core Mac also, so the cause is not only a slow container.

### Steps of the pull request

| Step | Result | What was seen |
| --- | --- | --- |
| 1. Left Leg and Right Leg off in the Inspector | Fail in the Inspector. Pass through `scene_patch` | A click on the Left Leg checkbox shows it as off, but the revision does not change and the character has no `body` group. With the same group set through MCP, the legs take the idle pose and the other parts follow the VMC peer in the OBS source |
| 2. Body off | Fail in the Inspector. Pass through `scene_patch` | The torso takes the idle pose and the root stops: the centre of the character in the OBS source moves from x 827 to 1127 with Body on and stays at 956.8 with Body off. The arms and the head follow |
| 3. Body Movement Intensity 0, 1, 2 with MediaPipe | Pass through `scene_patch`, with the hips in view of the camera. No effect at a desk. Fail in the Inspector | With the hips in view, the torso roll is 0° at intensity 0, 18° to 21° at 1, and 41° at 2. At a desk the source sends no torso bone, so the intensity changes nothing. In the Inspector, a slider drag and a typed value send no patch. See "Webcam check" |
| 4. Head off | Fail in the Inspector. Pass through `scene_patch` | The head takes the idle pose, and the blink and the mouth still follow ([image](tracked-body-parts/macos-obs-head-off-face.jpg)). The eye bones also stop, because they are in the Head part |
| 5. Save, close, open; VMC Sender | Pass for the show. Partly checked for the sender | The saved `.osekai` file and the opened show have the group, with the parts in the fixed order. The VMC Sender sends the filtered pose for Head off (head, neck, and eye bones at 0°, blend values still sent) and Left Fingers off (left finger bones at 0°, right at 50°). With a full-body VMC source the sender sends nothing; see "Other findings" |

### Each part, through `scene_patch`

One OBS capture for all parts on, each of the 8 parts off, no part on, and no source ([image](tracked-body-parts/macos-obs-parts-off.jpg): first row all, Head, Body, Left Arm, Right Arm, Left Fingers off; second row Right Fingers, Left Leg, Right Leg off, no part, no source). The part that is off takes the idle pose, the other parts keep the pose of the peer, and no capture shows a T-pose or a twisted bone. "No part" is equal to "no source". The change to off and back to on has no fade, as the contract says.

With only the Body part on a VMC source, intensity 0, 1, and 2 give the same sender output (hips 12°, spine 10°, chest 8°, upper chest 5°). The intensity has no effect on a VMC body, which is the stated limit.

### Inspector controls in the real editor

- A checkbox click and a typed intensity send no `setAvatarTracking` patch. A reset mark was not operated. The control shows the new value and the scene keeps the old one.
- A mouse drag of the Body Movement Intensity slider sends no patch, and the slider goes back.
- When a character has a `body` group, a change of the Fingers source select sends no patch (the select shows None and the scene keeps the source). Without the group, the same change works. This is a regression of the source selects.
- The console of the web view was not read. The probable cause, from the code, is `structuredClone` on a Svelte state proxy in `withBodyTracking` and `withSource` (`apps/desktop/src/editor/live-fields.ts`), and a `SliderField` that gets only `oncommit` (`AvatarSourceFields.svelte`).

### Tracking guide

Pass for the VMC path. With a group on the character (intensity 1.5, legs off), Set up tracking, then Other VMC app, then Close keeps the group. The same path to Done keeps the group ([image](tracked-body-parts/macos-guide-vmc.jpg)). The SelfReflect and iFacialMocap paths were not checked.

### Warudo comparison

Read from the Warudo handbook and from the files of the Warudo installation in the QA virtual machine (Steam application 2079120; the localization files and the type names of `Assembly-CSharp.dll`). Warudo was not started.

| Topic | Warudo | This slice |
| --- | --- | --- |
| Part list | `TrackedBodyPart`: Head, Pelvis, LeftArm, RightArm, LeftFingers, RightFingers, LeftLeg, RightLeg | The same 8 parts in the same order. The second part has the name Body |
| Location | "Track Full Body" (Yes or No) and "Tracked Body Parts" are options of each pose tracking asset (MediaPipe, VMC, and others), so that two trackers can drive different parts | One list on the character, for all sources |
| Root | "If the character needs to move around in the scene, this option must be enabled" (Track Full Body) | The root stops only when Body is off |
| Body Movement Intensity | An option of the face tracking asset: "the intensity of the automatic body movement due to head movement". Range 0 to 1, default 0.5 in the default scene | A scale of the torso rotations of a source with normalized bones. Range 0 to 2, default 1 |
| Bones of each part | Not read (not in the handbook; needs Warudo in operation) | The table in `packages/contracts/src/tracking.ts` |

### Other findings

- **VMC Sender with a full-body VMC source (not caused by this change).** When the body source of the character is a VMC receiver that gets the full pose of the peer, the sender of that character goes to `waiting` and sends no datagram. It sends with the body slot empty, with one tracked part, and with all parts but the fingers (24 bones). It stops with the fingers of one hand added. The build of `claude/cam06-camera-grading`, which does not have this change, gives the same result. The cause was not found.

### Webcam check (MediaPipe, second session)

The owner did the movements in front of the FaceTime camera. Spoken cues gave the timing. The group was set through `scene_patch`, because the Inspector controls send no patch. Calibrate (`calibrateTracking`) ran first, with the owner upright. The values are from the VMC Sender output of the character (about 54 samples each second): the roll is the rotation about the forward axis of hips × spine × chest × upper chest, and the range is the 95th minus the 5th percentile in a phase of 8 s to 12 s. MediaPipe inference was 26 ms.

Run 1, at a desk (the camera sees the head and the shoulders):

- The torso roll range is 0.8° (the idle animation) at intensity 1, 0, and 2. The upper arms do not move when the owner waves. The lean of the owner shows only in the head (28° of roll).
- Cause: `apps/desktop/src/tracking/retarget.ts` makes the chest bone and the arm bones only when the pose has the two shoulders and the two hips. At a desk the hips are not in view, so the source sends the head and the face only. The source never sends hips, spine, or upper chest, so the intensity can scale the chest only.

Run 2, about 2 m from the camera (head to hips in view), with a continuous lean to the left and to the right:

| Phase | Torso roll range | Head roll range, in the world | Other |
| --- | --- | --- | --- |
| Intensity 1 | 17.6° | 31.2° | — |
| Intensity 0 | 0.0° | 13.3° | — |
| Intensity 2 | 40.6° | 41.0° | — |
| Intensity 1, second time | 21.0° | 21.2° | — |
| Body off | 0.8° (idle) | 9.9° | The arms follow |
| Head off | 23.0° | 23.0° (the head has no rotation of its own) | 8 blend values move |
| All parts, hands waved | — | — | Upper arm range: left 105°, right 99° |
| Left Arm off | — | — | Left upper arm 0° (idle), right 68° |
| Right Arm off | — | — | Left upper arm 104°, right 0° (idle) |

- The lean is zero at intensity 0. At 2 it is 2.1 times the mean of the two phases at 1 (40.6° against 19.3°). The lean of the owner was not the same in each phase (17.6° and 21.0° at intensity 1).
- With intensity 0 and with Body off, the head of the character does not get the lean of the torso: the head roll in the world goes from 31° to 13° and 10°. The source sends the head relative to the chest, and the composer does not put the chest rotation back when the chest is scaled or dropped. At intensity 2 the head roll in the world also grows (41°).
- A part that is off takes the idle pose and the other parts follow, as with the VMC peer.
- One OBS capture for each phase is in [the image](tracked-body-parts/macos-obs-webcam-phases.jpg) (intensity 1, 0, 2, Body off, Head off, all parts, Left Arm off, Right Arm off). In the lean phases the captures show the two arms of the character above its head, and the owner's arms were down. See "Other findings".
- In development mode, the first MediaPipe use in a new worktree makes Vite load the app again, and the scene is lost. The scene was made again after that.

- **MediaPipe arms are opposite on this VRM 0 character (not caused by this change).** With the owner's arms down, the left upper arm of the character is at −60° to −78° about the forward axis in the VMC Sender output, and the idle pose with the arms down is +55°. An offline run of the real retargeter with a pose that has the arms down gives −84° in the normalized space, which is the correct direction there (the idle base bone is −55°). `packages/renderer/src/avatar-pose.ts` gives the VRM 0 sign (x and z negative) to the base bones and to the offsets, but not to the normalized tracking bones, and `packages/session/src/vmc-send.ts` repeats this. For a VRM 1 rig the same sample gives the arms down. The owner saw the movement as opposite in the preview. The direction of the torso lean and of the head was not measured.

### Not checked

A VMC application of another vendor, the SelfReflect and iFacialMocap paths of the guide, the Inspector values after an open, and Windows.
