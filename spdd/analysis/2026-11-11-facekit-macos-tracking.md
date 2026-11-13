# FaceKit tracking on macOS analysis

Issue: [#260](https://github.com/danirukun/opensekai/issues/260) (TRK-24). Queue bundle B33. Mode: feasibility spike, then contract-first. Date: 2026-11-11. Design: [FaceKit tracking on macOS](../../docs/superpowers/specs/2026-11-11-facekit-macos-tracking-design.md). Contract: [FaceKit tracking on macOS](../prompt/2026-11-11-facekit-macos-tracking.md).

## Problem

The webcam face tracker of OpenSekai is MediaPipe. The owner finds that the Apple face model gives better tracking than MediaPipe. macOS has that model in the private framework AppleCVA (FaceKit). It gives the ARKit blend shapes and a head pose from an RGB camera with no iPhone. Issue #260 asks for a native macOS source that uses it, if a feasibility check passes.

## Sources

- Issue #260 and its acceptance criteria. Related: #21, #135, #136.
- The feasibility spike of 2026-11-11 on the owner's Mac (Mac15,6, M3 Pro, macOS 27.2 26B123, FaceTime HD Camera, AppleCVA 1003.0.4). The design holds the measured values ("Facts from the spike") and the interface (Appendix A and B).
- Public descriptions of the AppleCVA face tracking interface. The GPL project AppleCVA-VTS was read for interface facts only. No code from it is in this repository, and a builder must not open a copy of it.
- The owner's decisions in the design review of 2026-11-11 to 2026-11-13.

## Existing material

- `packages/contracts/src/tracking.ts` and `crates/contracts/src/tracking.rs` define `TrackingConfig` (`vmc`, `ifacialmocap`, `openseeface`, `mediapipe`), the face-only kinds, and `TrackingStatus` with five states.
- `apps/desktop/src-tauri/src/tracking/mod.rs` (`TrackingManager`) reconciles the UDP sources once for each scene revision and gives a `TrackingUpdate` snapshot to the clock message. It skips `mediapipe` sources.
- `packages/session/src/worker.ts` accepts a host update for each kind other than `mediapipe` and a local update only for `mediapipe`. `packages/session/src/tracking.ts` composes the status and drops the sample of a source in `error` or `stopped`.
- `apps/desktop/src-tauri/src/capture/` has the pattern for a platform adapter: a trait, a macOS implementation with the `objc2` crates, and a stub for other platforms and for unit tests.
- The editor shows each kind through `authoring.ts`, `asset-groups.ts`, `live-fields.ts`, `property-defaults.ts`, `Hierarchy.svelte`, `TrackingSourceFields.svelte`, and `TrackingDiagnostics.svelte`. TRK-22 gives the hidden-camera patterns.

## Findings

1. FaceKit works from a normal process on the test Mac: `dlopen` by absolute path, four C functions, no entitlement other than camera access. It also works under the hardened runtime with an ad hoc signature.
2. The output has 51 blend shapes with the ARKit set and order known from `CopySemantics`, a `tongue_out` value, and a 3x3 head rotation. This fits the existing `TrackingSample` (ARKit expressions and a `head` bone). No contract change is necessary for the sample.
3. The status needs two new states. `unavailable` and `permissionNeeded` are not the same as `error`: the user cannot repair the first, and the user repairs the second in System Settings.
4. The caller must supply the camera frame and a face rectangle. The spike used AVFoundation and Vision in the same process. A capture in the webview would need a frame stream through IPC, which the product rules forbid.
5. The first `Create` takes 1.6 to 1.9 s. The camera prompt can stay open for a long time. A start must not block the scene reconcile.
6. The result arrives on a FaceKit thread after `Process` returns. A result can arrive after the capture stops.
7. `identity_coefficients` is always in the output, also with `use_recognition` false. The spike cannot show that the identity computation stops.
8. The framework is private. A macOS update can remove it or change its output. The name list from `CopySemantics` is the strongest available check.
9. No local host builds the Rust workspace for Linux or Windows. The Linux check needs a container or a cloud run.

## Decisions

The design lists the owner's decisions and the 15 calls of the designer. The owner approved all of them on 2026-11-13. This plan adds these builder decisions; the owner can change each one in the plan review.

- **One host module.** `apps/desktop/src-tauri/src/tracking/facekit/` holds the adapter trait, the pure mapping, the session manager, the macOS adapter, and the stub. `TrackingManager` owns the manager, so the service wiring does not change.
- **Events, not return values.** `FaceAdapter::start` returns at once. The adapter reports progress and failures as `FaceEvent` values through a sink. Reason: findings 5 and 6.
- **Run token.** Each start gets a new token. The manager ignores an event with an old token. Reason: finding 6 and the "no stale output" criterion.
- **Failure is sticky.** A source that failed starts again only when its generation or config changes (stop and start, or a camera change). An unrelated scene edit does not open the camera again. The conflict of a second enabled source is not a failure in this sense: each reconcile decides it again, so the second source gets the session when the holder stops.
- **Start order.** Library and name check, camera authorization, `Create`, camera. A Mac where FaceKit is broken shows `unavailable` and never shows the camera prompt.
- **`tongueOut` is optional.** If `tongue_out` is in neither `raw_data.animation` nor `smooth_data.animation`, the sample has no `tongueOut` value.
- **Commands.** `facekit_camera_list` and `open_camera_settings`, both for the main window only.
- **Development override.** `OPENSEKAI_FACEKIT_LIBRARY` replaces the library path only in a debug build. A release build does not read it.
- **Camera authorization text.** "OpenSekai uses the camera for local avatar tracking after you start a camera tracker."
- **State text.** The inspector shows `permissionNeeded` as "permission needed".

## Risks

- **A macOS update breaks the tracker.** Mitigation: the name check, the shape check at run time, the `unavailable` state, and the inspector line. No fallback tracker starts.
- **Apple developer agreement.** The use of a private API can conflict with a notarized Developer ID distribution. The public build is ad hoc signed today. Recorded as unknown; the feature is opt-in.
- **Wrong axis or side on the avatar.** Mitigation: unit tests against the five measured rotations, and a live check with the Catboy avatar.
- **Camera stays on.** Mitigation: each stop path drops the run; unit tests count the drops; the live check looks at the camera indicator.
- **Two capture owners.** MediaPipe (webview) and FaceKit (host) can open the same camera. macOS permits this. The live check records the result.
- **Other hardware.** Intel Macs, macOS 14 to 26, external cameras, and virtual cameras are not tested. The records claim only the tested Mac.
- **Linux and Windows build.** The stub compiles and runs in the unit tests on macOS. A Linux build is checked in a container or a cloud run, or the record says unknown. Windows is unknown.
