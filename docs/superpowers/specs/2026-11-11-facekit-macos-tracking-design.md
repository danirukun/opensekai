# Native FaceKit face tracking on macOS

Date: 2026-11-11. Status: draft for owner approval. Issue: [#260](https://github.com/danirukun/opensekai/issues/260). Parity: TRK-24 (new row), TRK-04. Candidate slice: B33.

## Intent

The owner wants better webcam face tracking on a Mac than MediaPipe gives. Apple ships a face tracker named FaceKit inside the private framework AppleCVA. It returns ARKit-style blend shapes and a head pose from an ordinary RGB camera. The owner judges its quality to be better than MediaPipe.

This project adds FaceKit as one more face tracking source. The source is opt-in, it runs only on macOS, and it fails with a clear state when FaceKit is not usable. It uses the same character face slot, smoothing, calibration, and mapping as the other sources.

## The feasibility gate

Issue #260 has a gate question: is private-API dependence acceptable for the intended distribution, and is there a permitted, maintainable integration path?

- The owner answered the first part on 2026-11-11: the public GitHub-release build can call the private API, on the condition that the source is opt-in and fails gracefully.
- A throwaway spike on the owner's Mac answered the technical part. The facts are in "Facts from the spike" below.
- Two parts stay open and are recorded as unknown, not as passed: a notarized Developer ID build, and the legal scope of the Apple developer agreement for private API use outside the App Store. The current release is ad hoc signed, so these do not block the first version.

## Goals

1. A new tracking source kind, `facekit`, that a Character can use in its face slot.
2. The host process owns the camera and FaceKit. Samples go down the host clock path that VMC and OpenSeeFace use. Tracking continues while the editor is minimized.
3. The source sends head rotation, the 51 FaceKit blend shapes with canonical ARKit names, and `tongueOut`. The existing smoothing, calibration, and face mapping apply without a change.
4. Explicit states for each failure: FaceKit unavailable, camera permission needed, camera failure, and lost face. OpenSekai never starts a different tracker in its place.
5. Build, link, packaging, and run time are gated to macOS. Windows and Linux builds stay functional. A show with a FaceKit source opens on each platform.
6. The editor and MCP use the same validated command API for the new kind.
7. A committed feasibility record and a platform verification record that claim only what was observed.

## Non-goals

- More than one tracked face. See "Future expansion".
- Body or hand tracking from the camera.
- A mirror option. iFacialMocap and OpenSeeFace sources have none.
- Head position (translation). The source sends rotation only, as OpenSeeFace does.
- A capture resolution or frame rate control.
- The guided setup (TRK-23) does not offer FaceKit as a preset.
- Developer ID signing, notarization, or hardened runtime for the release.
- Intel Macs and macOS versions other than the one that was tested. The code does not block them. The records mark them unknown.
- The FaceKit "Lite" API. Its symbols changed in each recent macOS release.

## Anti-goals

The work fails, even if it runs, when one of these is true:

- OpenSekai links AppleCVA at build time, or copies or bundles an Apple framework or model file.
- A scene that does not have a FaceKit source loads AppleCVA or opens the camera.
- A missing or changed FaceKit makes the app crash, hang, or fail to start.
- A FaceKit failure makes another tracker start without a user action.
- A changed FaceKit output drives the avatar with wrong channels.
- A camera frame, an identity coefficient, or a face identifier goes to disk, to a log, to the network, or to the webview.
- The source code contains code from AppleCVA-VTS (GPL-3.0-or-later).
- The Windows or Linux build breaks.
- The parity checklist claims a Mac model, macOS version, or camera that was not tested.

## Decisions made with the owner

- Private-API dependence is acceptable in the public build when the source is opt-in and fails gracefully.
- FaceKit is an entry in the Add menu on macOS only. Nothing selects it by default.
- It is a face-only source, with a camera picker in its inspector.
- Two new explicit states: "unavailable" and "permission needed". A camera failure is an error. A lost face shows as stale.
- OpenSekai reads frames and FaceKit output in memory and drops them. It stores nothing.
- Multi-face tracking is a future expansion. It is not in scope and it was not measured. The design must not prevent it.
- The first version claims only the owner's Mac. Other hardware stays unknown.

## Facts from the spike

A throwaway Objective-C command-line tool ran on 2026-11-11. Hardware: MacBook Pro Mac15,6 (M3 Pro), macOS 27.2 (26B123), built-in FaceTime HD Camera, AppleCVA 1003.0.4. The tool was ad hoc signed and started from Terminal.app. One guided run of 70 s with voice prompts, and nine short variant runs.

Access:

- The binary is in the dyld shared cache at `/System/Library/PrivateFrameworks/AppleCVA.framework/Versions/A/AppleCVA`. `dlopen` with that path works.
- Four C functions are sufficient: `CVAFaceTrackingGetAPIVersion`, `CVAFaceTrackingCreate`, `CVAFaceTrackingProcess`, and `CVAFaceTrackingCopySemantics`. These names exist in macOS 11.3 through 27.2. `GetAPIVersion` returned 42.
- `Create` returned 0 with no entitlement. The first call took 1.6 to 1.9 s. Later calls took about 16 ms.
- `Create` also returned 0 under the hardened runtime with the camera entitlement (ad hoc signature).
- `CopySemantics` returns `blendshape_names` with 51 names in this order: `eyeBlink_L eyeBlink_R eyeSquint_L eyeSquint_R eyeLookDown_L eyeLookDown_R eyeLookIn_L eyeLookIn_R eyeWide_L eyeWide_R eyeLookOut_L eyeLookOut_R eyeLookUp_L eyeLookUp_R browDown_L browDown_R browInnerUp browOuterUp_L browOuterUp_R jawOpen mouthClose jawLeft jawRight jawForward mouthUpperUp_L mouthUpperUp_R mouthLowerDown_L mouthLowerDown_R mouthRollUpper mouthRollLower mouthSmile_L mouthSmile_R mouthDimple_L mouthDimple_R mouthStretch_L mouthStretch_R mouthFrown_L mouthFrown_R mouthPress_L mouthPress_R mouthPucker mouthFunnel mouthLeft mouthRight mouthShrugLower mouthShrugUpper noseSneer_L noseSneer_R cheekPuff cheekSquint_L cheekSquint_R`.

Input that worked:

- Create options: `num_tracked_faces=1`, `rgb_only=true`, `robust_tongue=true`, `network_failure_threshold_multiplier=1.0`, `failure_fov_modifier=0.5`, `use_recognition=false`.
- For each frame, a dictionary with: `rgb` (an NV12 `420f` pixel buffer, 1920x1080), `rgb_camera` (`intrinsics` 3x3 and `extrinsics` with identity rotation and zero translation), `RgbMetadata` (`LuxLevel` 150), `meta` (`version` 1), `timestamp` (a CMTime dictionary), `DetectedFacesArray` (one entry with `Rect`, `AngleInfoRoll`, `FaceID`), and `callback` (a block that receives one dictionary).
- The face rectangle came from Vision `VNDetectFaceRectanglesRequest`. `Rect` is normalized with a top-left origin, so the Vision rectangle needs a vertical flip.
- A synthetic focal length is sufficient. A change of the focal length changed only the translation depth. Rotation and blend shapes did not change.
- FaceKit can find the face itself (`use_face_detector=true`), but the callback latency went to 41 ms median and 355 ms at the 95th percentile. Vision is the better choice.

Output:

- `Process` returns immediately. FaceKit calls the block one time for each `Process` call (2083 of 2083) on its own thread.
- The callback dictionary has `tracked_faces`, an array. One entry has `confidence`, `failure_type`, `face_id`, `identity_coefficients`, `raw_data` (`animation`, `pose`), and `smooth_data` (`animation`, `geometry`, `pose`).
- `animation` has `blendshapes` (204 bytes: 51 `float32` values), `tongue_out`, `gaze`, and eye pitch and yaw. `pose` has `rotation` (3 arrays of 3 numbers) and `translation`.
- The frame-to-frame change at a neutral face was 0.0055 for each channel in `raw_data` and 0.0030 in `smooth_data`.

Timing and cost at 1920x1080, 26 to 30 frames per second:

- Callback latency: median 4.8 to 6.9 ms, 95th percentile 10 to 24 ms.
- CPU: 38% of one core in the 70 s run (capture, Vision, and FaceKit together). 45 to 53% in the 5 s runs, which include the start.
- `force_cpu`: median latency 10.8 ms and 61% of one core.
- A lower capture resolution did not take effect in the spike. Its cost is unknown.

Conventions, inferred from the one guided run. The performer reacted 2.5 to 3.5 s after each prompt, so these are not yet verified on an avatar:

- The neutral rotation is near `diag(1, -1, -1)`. In the run, the neutral head was about -13° on X.
- Let `M` be the rotation with rows 2 and 3 negated (outer array index = row). Then `M` as a row-major matrix gives: head turn to the performer's left = +Y (+32° seen), to the right = -Y (-40°); chin down = +X (+15°); tilt to the right shoulder = +Z (+22°), to the left shoulder = -Z (-20°). The chin-up prompt gave no clear row; its sign (-X) follows from the chin-down row. These signs are the VRM 1 normalized head axes when the performer's left is the avatar's left. Appendix B has the rows.
- `eyeBlink_L` follows the performer's left eye (0.84 to 0.88 with the right eye at 0.25). `eyeBlink_R` follows the right eye.
- Peaks seen: `mouthSmile_L/R` +0.6, `tongue_out` 0.87, `jawOpen` 0.43 to 0.63 with a wide-open jaw.
- Neutral offsets seen: `browDown_L/R` 0.22 to 0.43, `eyeSquint_L/R` 0.11 to 0.25, `mouthShrugLower` about 0.1, `jawOpen` 0.02.

Lost face:

- With the camera covered, `tracked_faces` became empty. One callback in the transition had a face entry with `failure_type` 1 and no pose or blend shapes.
- The face came back about 1.8 s after the prompt to uncover. This time includes the reaction of the performer.

Identity data:

- `identity_coefficients` (2004 bytes) is in each face entry, also with `use_recognition=false`, with fitting off, and with both. No faceprint key and no `debug` key was in a run.
- Thus the spike could not show that FaceKit stops the identity computation. See "Privacy".

Camera permission:

- A process that the agent session starts cannot get the camera prompt. A start from Terminal.app works, and then Terminal.app is the responsible process. This applies to the dev build too.

Prior art and limits:

- Apple's `/usr/libexec/relatived` uses the same functions and keys. There is no public macOS API for this tracker.
- The only open-source caller is AppleCVA-VTS (GPL-3.0-or-later). Its code must not be copied. The bridge is written from the interface facts in this document and in Appendix A.

Where the spike is:

- The spike source, its logs, and its recordings are in a session temporary directory: `/private/tmp/claude-501/-Users-danirukun--paradev-worktrees-opensekai-work-e442d792/eea7e4cb-4ff8-407f-a5f3-68cc33a3f76d/scratchpad/spike/` (`facekit_spike.m`, `Info.plist`, `guided.jsonl`, and the variant files). macOS can delete this directory. Slice 1 moves the tool and a numeric excerpt into the repository.
- The designer wrote `facekit_spike.m` from exported symbol names and key strings. It contains no third-party code. It is an accepted base for the probe tool and for the adapter.
- The directory `untrusted_applecva_vts/` beside it is the GPL project. A builder must not open it.

## Current code facts that the design uses

- `TrackingConfig` is a tagged union with the kinds `vmc`, `ifacialmocap`, `openseeface`, and `mediapipe`. It is mirrored in `packages/contracts/src/tracking.ts` and `crates/contracts/src/tracking.rs`. `FACE_ONLY_TRACKING_KINDS` limits a kind to the face slot.
- A source is a `SceneEntity::Tracking`. `enabled` in its config starts and stops it. Smoothing, calibration, and mapping are on the entity.
- `TrackingStatus.state` is `stopped | waiting | receiving | stale | error`. A `TrackingUpdate` holds at most 4 samples and 4 statuses.
- The host `TrackingManager` (`apps/desktop/src-tauri/src/tracking/mod.rs`) reconciles UDP sources one time for each scene revision, skips `mediapipe`, takes at most 4 sources, and changes `receiving` to `stale` in `snapshot()` when the last sample is older than 500 ms. `service/mod.rs` calls `reconcile` and puts `snapshot()` in each clock message.
- The session worker accepts a local tracking update only for a `mediapipe` source and a host update for each other kind (`packages/session/src/worker.ts`).
- `createTrackingComposer` (`packages/session/src/tracking.ts`) has kind checks only for a `vmc` position rule and a `mediapipe` head and chest rule. A sample from another kind with a normalized `head` bone and ARKit expression names gets smoothing, calibration, mapping, and slot mixing. The composer computes the state again and gives special handling only to `error` and `stopped`, so it needs a change for the two new states.
- Scene validation (`crates/contracts/src/lib.rs`) permits at most 4 tracking entities of all kinds in a scene. This is the effective limit; the `take(4)` in the host is not a separate limit.
- An enabled MediaPipe source starts the camera when a show opens or when MCP enables it. No arm step exists for a tracking camera. macOS camera permission is the gate.
- For a UDP endpoint conflict, the source that holds the endpoint keeps it, and other sources join in scene order (`tracking/endpoints.rs`).
- `canonicalArkitName` accepts the `_L` and `_R` name style. The Rust side has `ARKIT_NAMES` in `crates/contracts/src/lib.rs`.
- The desktop capture code is the template for native macOS code: an adapter trait, a macOS implementation with `objc2` crates under `cfg(target_os = "macos")`, a stub for other platforms, and `CaptureError::{PermissionNeeded, NotFound, Unsupported, Failed}`. `block2` is already a dependency.
- A new Tauri command needs an entry in `build.rs`, in `capabilities/main.json`, and in the test `main_capability_has_the_exact_permission_list`.
- `Info.plist` has one `NSCameraUsageDescription` text. It names MediaPipe.
- The MediaPipe camera select hides virtual cameras with an editable pattern list (TRK-22).

## Design

### The source in the scene

- Config: `{kind: 'facekit', enabled: boolean, deviceId: string}`. `deviceId` is the unique ID of the capture device from the host. An empty string selects the system default camera.
- `facekit` is in the face-only kinds. A Character can use it only in the face slot.
- The default is `enabled: false` and `deviceId: ''`.
- The validation is the same on each platform. Thus a show from a Mac opens on Windows and Linux, and the source shows as unavailable there.

### States

`TrackingStatus.state` gets two new values. This is a contract change in TypeScript and Rust.

| State | When |
| --- | --- |
| `stopped` | The source is disabled. The camera is released. |
| `unavailable` | The platform is not macOS, the library or a function is missing, the start-up check fails, `Create` fails, or the output does not have the expected shape. `error` holds a short reason. |
| `permissionNeeded` | macOS denied or restricted the camera. |
| `waiting` | The permission prompt is open, or the camera runs and no face was found yet. |
| `receiving` | A sample arrived in the last 500 ms. |
| `stale` | The camera runs, a face was found before, and no sample arrived in the last 500 ms. |
| `error` | The camera is not found, cannot start, or stops, or a second FaceKit source is enabled. `error` holds a short reason. |

- The composer and all other consumers treat `unavailable` and `permissionNeeded` as states with no sample, the same as `error`.
- A FaceKit source that fails stays failed. No code path enables or adds a different source.
- Recovery is a user action: the user stops and starts the source, or changes its camera. Each of these is a scene revision. The host does not poll the permission and does not listen for a camera that connects again. After the user grants the permission in System Settings, the user starts the source again.
- A saved `deviceId` that is not connected is an `error` ("Camera not found"). The source does not change to the default camera.
- An enabled FaceKit source starts the camera when a show opens and when MCP enables it, as MediaPipe does. There is no arm step. macOS camera permission is the gate.

### The host session

- A FaceKit session lives in the Rust host, beside the UDP receiver. The session is separate from the scene source: the session owns the camera, Vision, and the FaceKit tracker, and the source reads face 0 from it.
- At most one session runs. If a scene has two enabled FaceKit sources, the source that holds the session keeps it. If no source holds it, the first in scene order gets it. The other source gets `error` with the name of the holder. This is the rule of the UDP endpoint conflict.
- The session follows the reconcile pattern of `TrackingManager`: one reconcile for each scene revision, a new session when the generation or config of the source changes, and a retry after a failure only on a later revision.
- The scene limit of 4 tracking entities includes FaceKit sources. The FaceKit sample and status go in the same `TrackingUpdate` in the clock message.
- The platform boundary is an adapter trait with a macOS implementation and a stub, as in `capture/`. The stub reports `unavailable`. All Apple-specific code is behind this adapter.
- The macOS implementation is Rust with the `objc2` crates and `block2`. There is no Swift or Objective-C source file.

### Loading and the start-up check

The adapter loads AppleCVA only when a FaceKit source is enabled for the first time.

1. `dlopen` the absolute path. `dlsym` the four functions. A failure gives `unavailable`.
2. Call `CopySemantics`. The `blendshape_names` list must be equal to the 51 names above, in that order. A difference gives `unavailable`.
3. Call `Create` with the spike options. A result other than 0 gives `unavailable`.
4. At run time, a face entry that has pose or blend shapes with an unexpected shape (not 51 `float32` values, not a 3x3 rotation) stops the session and gives `unavailable`. A face entry with no pose and no blend shapes is a lost face, not a failure.

`GetAPIVersion` is read and written to the host log at each session start. It is not a gate: the spike has only one value (42), and the name check is the stronger test. It is not a new field in `TrackingStatus`. The verification record gives the value.

### Camera and permission

- The adapter uses AVFoundation capture in the host with the default format of the device, `420f` output, and late frames discarded. On the test camera this is 1920x1080.
- The adapter asks AVFoundation for camera authorization when the source starts. Not determined: the system prompt opens and the state is `waiting`. Denied or restricted: `permissionNeeded`.
- The inspector shows one button for `permissionNeeded` that opens the Camera pane of System Settings.
- The `NSCameraUsageDescription` text changes so that it does not name one tracker.
- The host gives the editor a camera list (ID and label) through one new command. The editor applies the hidden-camera patterns of TRK-22 to this list.
- Stop, disable, source removal, a camera change, and app shutdown stop the capture session and release the FaceKit tracker. The camera indicator of macOS must go off.

### Output mapping

For each callback with a usable face 0:

- **Expressions.** The 51 values from `raw_data.animation.blendshapes`, with the canonical ARKit names (`eyeBlink_L` becomes `eyeBlinkLeft`), plus `tongueOut` from `tongue_out`. Each value is clamped to 0..1. A value that is not finite makes the callback invalid.
- **Head.** The `head` bone with `space: 'normalized'`. The rotation is `raw_data.pose.rotation` with rows 2 and 3 negated, converted to a quaternion. The performer's left is the avatar's left.
- **Eyes.** The `eyeLook*` channels are in the 51 values. The source sends no eye bones.
- **Time.** `receivedAtMs` is the host clock at the callback.
- **Not read.** `identity_coefficients`, `face_id`, `geometry`, `gaze`, `translation`, and all keys that are not in this list.

Status counters: `packets` counts samples. `invalidPackets` counts callbacks with no usable face. `inferenceMs` is the time from `Process` to the callback.

The source uses `raw_data`, not `smooth_data`, so the One Euro filter of the source is the only filter. The neutral offsets and the low `jawOpen` peak are a job for calibration and for the ranges in the face mapping. The source does not correct them.

### Privacy

- Frames stay in the host process. No frame goes to the webview, to a file, or to the network.
- `use_recognition` is `false`. The adapter never sets `add_debug`.
- The adapter copies only the fields in "Output mapping" out of the callback dictionary. It does not log the dictionary.
- The honest claim is: OpenSekai does not read or store identity data. The spike could not show that FaceKit stops the identity computation, because `identity_coefficients` is always in the output. The records must say this. They must not say that identity is disabled.

### Editor and MCP

- The Add menu shows "FaceKit Tracker" only on macOS.
- The inspector has the enable control, the Camera select, the same smoothing, calibration, and mapping sections as OpenSeeFace, and one line: "Uses a private macOS API. It can stop after a macOS update."
- The diagnostics show the two new states and the reason text.
- MCP `scene_patch` accepts the new kind on each platform. Its description names the kind.

### Future expansion: more than one face

FaceKit takes `num_tracked_faces` and returns an array of faces with a `face_id`. The spike had one face only, so nothing is known about the behaviour with more faces. The first version asks for one face. Because the session is separate from the source, a later version can ask for more faces and let more sources read from the one session. That version needs its own design for how a source selects a face.

## Calls made by the designer

The owner did not decide these. Each can change at the review.

1. The kind is `facekit` and the menu name is "FaceKit Tracker".
2. The bridge is Rust with `objc2`, not a Swift or Objective-C shim.
3. The source reads `raw_data`.
4. The start-up check compares the 51 names. The API version is not a gate.
5. One FaceKit session for each scene. A second enabled source is an error.
6. A missing saved camera is an error, with no change to the default camera.
7. No mirror option and no head position in the first version.
8. The capture uses the default format of the camera (1080p on the test camera).
9. One line of text in the inspector tells the user about the private API.
10. A lost face uses the existing `stale` state. There is no new "lost" state.
11. The spike tool becomes a small committed probe tool (`tools/facekit-probe/`), so the feasibility record is reproducible. Its raw recordings are not committed. A short numeric excerpt becomes a test fixture.
12. The claim about identity data is "not read, not stored". The issue asks to verify the identity-disable path. That path cannot be verified, and the records say so.
13. An enabled FaceKit source in a show or from MCP starts the camera with no arm step, as MediaPipe does.
14. Recovery from a failure is a user action (stop and start the source). The host does not poll.
15. The API version goes to the host log and the records, not to the status contract.

Calls 2, 5, and 11 set the slice structure. When the owner approves this document, all calls are final for the plan.

## Left to the builder

- Module and file layout, type names, command names, and the thread model in the host.
- How the FaceKit session and the UDP manager share the snapshot.
- The `objc2` crates and exact pins for AVFoundation and Vision.
- The fixture format for the recorded rotation and blend shape rows.
- Whether `raw_data.animation` has `tongue_out`. If it does not, `tongueOut` comes from `smooth_data`.
- The exact text of the reason strings.

## Verification

Unit tests (all platforms):

- Contract validation for the new kind and the two states, in TypeScript and Rust, with the shared validation vectors.
- The name table and the start-up name check, including a changed list.
- The rotation conversion against the rows in Appendix B: each row gives the sign and the approximate angle in the table.
- Value handling: clamp, a value that is not finite, a wrong byte length, `tongueOut`.
- The session state machine with a fake adapter: unavailable, permission needed, camera not found, camera stop, lost face to stale and back, disable, enable again, camera change, source removal, two sources, and shutdown. Each stop releases the adapter.
- The session worker accepts host updates for `facekit` and refuses local updates.

Integration test (macOS only, not in the Linux cloud baseline): load AppleCVA, read the API version, compare the names, and create and release a tracker. No camera. The test is reported as skipped, not passed, where it cannot run.

Live verification on the owner's Mac, with the Catboy avatar and a dev build that starts from Terminal.app. The owner must be in front of the camera:

- Each head direction, each eye, the jaw, the smile, and the tongue move the avatar the correct way. This check makes the inferred conventions verified, or corrects them.
- Calibration, smoothing, and mapping ranges work on the source.
- Start, stop, restart, a change to and from MediaPipe and a UDP source, source removal, and app quit. The camera indicator goes off each time, and no old sample drives the avatar.
- The avatar moves in the OBS output while the editor is minimized.
- Permission denied and granted again.
- The unavailable state, with a development-only override of the library path. A release build has no override.
- A MediaPipe source and a FaceKit source on the same camera.
- CPU, callback latency, and frame rate, as observed. No pass threshold is invented.

Records:

- `docs/evaluation/facekit-feasibility.md`: the spike record (hardware, camera, OS, outputs, blockers, unknowns).
- `docs/evaluation/facekit-tracking.md`: the platform verification record.
- `docs/warudo-parity.md`: a TRK-24 row that claims only the tested Mac.
- `ARCHITECTURE.md`: the tracking path, the Apple-only adapter boundary, and the mobile constraint (a private macOS framework has no path to iOS or Android; a mobile build keeps the stub).
- SPDD: `spdd/analysis/2026-11-11-facekit-macos-tracking.md` and `spdd/prompt/2026-11-11-facekit-macos-tracking.md`.

## Candidate slices

1. **Records.** The feasibility record, the probe tool, and the SPDD analysis and contract.
2. **Contracts** (integrator, sequential). The `facekit` kind and the two states in TypeScript and Rust, the fixtures, the session worker rule, and the MCP description.
3. **Host adapter.** The adapter trait, the stub, the macOS implementation, the session, and the mapping, with unit tests.
4. **Editor.** The Add menu entry, the inspector fields, the camera list command, the settings button, and the diagnostics.
5. **Verification and documents.** The live checks, the records, the parity row, and `ARCHITECTURE.md`.

Slices 3 and 4 can run in parallel in separate worktrees after slice 2.

## Unknown

- A notarized Developer ID build with the hardened runtime.
- The legal scope of the Apple developer agreement for this use.
- Intel Macs, and macOS 14 through 26.
- External and virtual cameras.
- The cost at a lower capture resolution.
- Which compute unit FaceKit uses.
- Whether FaceKit can stop the identity computation.
- More than one face.

## Appendix A: interface facts for the bridge

These facts come from the spike source. They are sufficient to write the bridge with no other reference.

Functions (C, resolved with `dlsym`):

```c
typedef const struct __CVAFaceTracking *CVAFaceTrackingRef;
uint32_t CVAFaceTrackingGetAPIVersion(void);
int32_t  CVAFaceTrackingCreate(CFAllocatorRef allocator, CFDictionaryRef options, CVAFaceTrackingRef *out);
int32_t  CVAFaceTrackingProcess(CVAFaceTrackingRef tracker, CFDictionaryRef input);
int32_t  CVAFaceTrackingCopySemantics(CFDictionaryRef options /* NULL */, CFDictionaryRef *out);
```

- A result of 0 is success. The spike used `kCFAllocatorDefault`.
- The tracker is a Core Foundation object. The spike released it with `CFRelease` after the capture session stopped. The caller owns the dictionary from `CopySemantics` and releases it.
- The spike called `Create` before `CopySemantics`. The other order was not tested.
- All dictionaries are `CFDictionary` with `CFString` keys (the spike used `NSDictionary` through toll-free bridging).

Create options: `num_tracked_faces` integer 1; `rgb_only` boolean true; `robust_tongue` boolean true; `network_failure_threshold_multiplier` double 1.0; `failure_fov_modifier` double 0.5; `use_recognition` boolean false. The guided run did not set `use_recognition`. A variant run set it to false and tracking worked.

Input dictionary for each frame:

| Key | Value |
| --- | --- |
| `rgb` | The `CVPixelBuffer` of the frame, format `kCVPixelFormatType_420YpCbCr8BiPlanarFullRange`. |
| `rgb_camera.intrinsics` | 3 arrays of 3 numbers: `[[fx, 0, (w-1)/2], [0, fx, (h-1)/2], [0, 0, 1]]` with `fx = 400 * w / 640`, `w` and `h` in pixels. |
| `rgb_camera.extrinsics` | `rotation`: the identity as 3 arrays of 3 numbers. `translation`: `[0, 0, 0]`. |
| `RgbMetadata` | `{LuxLevel: 150}` (integer). |
| `meta` | `{version: 1}` (integer). |
| `timestamp` | `CMTimeCopyAsDictionary(CMTimeMakeWithSeconds(pts - firstPts, 600))`, where `pts` is the presentation time of the sample buffer in seconds. |
| `DetectedFacesArray` | An empty array when Vision finds no face. Otherwise one dictionary: `Rect` = `CGRectCreateDictionaryRepresentation` of the normalized rectangle with a top-left origin (`y = 1 - box.y - box.height` from the Vision box); `AngleInfoRoll` = the `roll` of the Vision observation as a double (radians); `FaceID` = integer 0. |
| `callback` | A copied block `void (^)(CFDictionaryRef result)`. |

- Vision: `VNDetectFaceRectanglesRequest` on the pixel buffer with orientation `Up`, first observation.
- Capture: `AVCaptureSession` with one `AVCaptureDeviceInput` and one `AVCaptureVideoDataOutput` (`alwaysDiscardsLateVideoFrames` true, a serial delegate queue). `Process` was called on that queue.
- The callback ran on a thread named `com.apple.applecva.facekit.1`. The spike read the result dictionary only inside the callback. Whether the dictionary is valid after the callback returns is unknown; the adapter copies the values inside the callback.
- In the result, `tracked_faces[0].raw_data.pose.rotation` is 3 arrays of 3 numbers, and `raw_data.animation.blendshapes` is data with 51 native-endian `float32` values.
- Camera list: `AVCaptureDeviceDiscoverySession` with the device types built-in wide angle, external, and Continuity Camera.

## Appendix B: rotation rows from the guided run

`raw_data.pose.rotation` as delivered, and the rotation vector (degrees, X Y Z) of the matrix after rows 2 and 3 are negated. The performer moved late after each prompt, so the label is the movement that the row shows, not the prompt of that moment.

| Movement | Rotation as delivered | Vector after the conversion |
| --- | --- | --- |
| Turn to the performer's left | `[[0.8462, -0.0219, 0.5323], [-0.0012, -0.9992, -0.0391], [0.5328, 0.0325, -0.8456]]` | [-2.2, 32.2, 0.7] |
| Turn to the performer's right | `[[0.7688, -0.051, -0.6375], [-0.0596, -0.9982, 0.008], [-0.6368, 0.0318, -0.7704]]` | [-0.7, -39.6, 3.4] |
| Chin down | `[[0.9991, -0.0333, -0.0268], [-0.0255, -0.9676, 0.2512], [-0.0343, -0.2503, -0.9676]]` | [14.5, -1.8, 1.7] |
| Tilt to the right shoulder | `[[0.886, -0.3471, -0.3074], [-0.3749, -0.9265, -0.0343], [-0.2729, 0.1456, -0.9509]]` | [-5.4, -17.3, 21.5] |
| Tilt to the left shoulder | `[[0.9308, 0.3381, 0.139], [0.3535, -0.9293, -0.1073], [0.0929, 0.149, -0.9845]]` | [-7.5, 6.8, -20.3] |

The expected avatar result in VRM 1 normalized axes (+X = the avatar's left, +Y = up, +Z = forward): +Y turns the face to the avatar's left, +X moves the chin down, and +Z tilts the head to the avatar's right shoulder.
