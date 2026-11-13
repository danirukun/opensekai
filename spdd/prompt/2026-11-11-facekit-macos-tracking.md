# REASONS: FaceKit tracking on macOS

Analysis: [FaceKit tracking on macOS](../analysis/2026-11-11-facekit-macos-tracking.md). Design: [FaceKit tracking on macOS](../../docs/superpowers/specs/2026-11-11-facekit-macos-tracking-design.md). Plan: [implementation plan](../../docs/superpowers/plans/2026-11-13-facekit-macos-tracking.md). Issue: [#260](https://github.com/danirukun/opensekai/issues/260) (TRK-24). Queue bundle B33.

The design owns the behaviour and the measured facts. This contract gives the requirements a number, so that a slice, a test, and a review can name them.

## R — Requirements

### Scene and status

1. A tracking source can have the kind `facekit`. Config: `{kind:'facekit', enabled:boolean, deviceId:string}`, `deviceId` at most 512 UTF-16 units, `''` for the system default camera. `defaultTrackingConfig('facekit')` gives `enabled:false`, `deviceId:''`. The validation is the same on each platform.
2. A `facekit` source can be only the face source of an avatar, with the rule of `ifacialmocap` and `openseeface`. It counts in the scene limit of 4 tracking entities.
3. `TrackingStatus.state` and `TrackingProbe.state` get `unavailable` and `permissionNeeded`. The session drops the sample of a source in `error`, `unavailable`, or `permissionNeeded`, and the composer keeps that state.
4. The session worker accepts a host update for a `facekit` source and refuses a local one.

### Host session

5. The host starts FaceKit only for an enabled `facekit` source. With no such source, the host does not load AppleCVA and does not open the camera.
6. At most one session runs. The source that holds the session keeps it. If no source holds it, the first enabled `facekit` source in scene order gets it. Each other enabled `facekit` source has `error` with "FaceKit used by <name of the holder>".
7. One reconcile runs for each scene revision. A new session starts when the generation or config of the holder changes. A source that failed starts again only when its generation or config changes. The reconcile does not block the publisher frame loop: the tracking manager sends the FaceKit part of the revision to one FaceKit worker and returns at once. The worker applies one revision at a time, stops the old camera before it opens the next camera, and skips a revision that a newer one replaced. The shutdown stops the worker and waits for it before it stops the camera.
8. Disable, removal, a camera change, a failure, and shutdown stop the capture and release the tracker. After a stop, no event of the old run changes a sample or a status.
9. States: `stopped` (disabled); `waiting` (started, no sample yet); `receiving` (a sample in the last 500 ms); `stale` (a sample before, none in the last 500 ms); `unavailable` with a reason (platform, library, function, name check, `Create`, output shape); `permissionNeeded` (camera denied or restricted); `error` with a reason (camera not found, cannot start, stopped, second source).
10. No code path enables, adds, or starts a different tracker when FaceKit fails. The host does not poll for a permission or a camera.

### Adapter

11. All Apple code is behind `FaceAdapter`. macOS has the real adapter in Rust with the `objc2` crates and `block2`. Each other platform has a stub that reports `unavailable` and an empty camera list. The build does not link AppleCVA and does not bundle an Apple file.
12. Start order: `dlopen` by absolute path and `dlsym` of four functions; `CopySemantics` name list equal to the 51 names in order; camera authorization; `Create` with the spike options; camera with the default format, `420f`, late frames discarded. The API version goes to the host log.
13. A face entry with a pose or blend shapes of an unexpected shape stops the session with `unavailable`. A face entry with no pose and no blend shapes, or no face entry, is a lost face.

### Output

14. Expressions: the 51 values of `raw_data.animation.blendshapes` with the canonical ARKit names, plus `tongueOut` when `tongue_out` is present. Each value is clamped to 0..1. A value that is not finite makes the callback invalid.
15. Head: the `head` bone, `space:'normalized'`, rotation = `raw_data.pose.rotation` with rows 2 and 3 negated, as a quaternion. No eye bones, no head position, no root.
16. `receivedAtMs` is the host clock at the callback. `packets` counts samples. `invalidPackets` counts callbacks with no usable face. `inferenceMs` is the time from `Process` to the callback.

### Privacy

17. No frame leaves the host process. `use_recognition` is false. `add_debug` is never set. The adapter copies only the fields of R14 and R15 out of the callback dictionary and never logs the dictionary. The records say "not read, not stored" for identity data. They do not say that identity is disabled.

### Editor and MCP

18. The Add menu shows "FaceKit Tracker" only on macOS. The asset list has the group "FaceKit Trackers".
19. The inspector of a `facekit` source has Start/Stop, the Camera select (host camera list with the TRK-22 patterns), the smoothing, calibration, and mapping sections of `openseeface`, and the line "Uses a private macOS API. It can stop after a macOS update." A saved camera that is not in the list shows as "Unavailable camera" and stays selected.
20. The inspector shows the reason text for `error` and `unavailable`, and an **Open Settings** button for `permissionNeeded` that opens the Camera pane of System Settings. The diagnostics show the inference time.
21. The host has the commands `facekit_camera_list` (ID and label) and `open_camera_settings`, for the main window only.
22. MCP `scene_patch` accepts the kind on each platform, and its description names it. No new MCP tool.

### Records

23. `docs/evaluation/facekit-feasibility.md`, `docs/evaluation/facekit-tracking.md`, the TRK-24 parity row, and `ARCHITECTURE.md` give the tested Mac, macOS version, camera, AppleCVA version, API version, outputs, lifecycle results, and each gap. A value that was not measured is "unknown".

Not in this slice: more than one face, body and hands, mirror, head position, resolution and frame rate control, a guided setup preset, Developer ID and notarization, the Lite API.

## E — Entities

- `TrackingConfig` (TS union and Rust enum): add `{kind:'facekit', enabled, deviceId}` (`TrackingConfig::FaceKit { enabled, device_id }`).
- `TrackingState`: add `Unavailable => "unavailable"`, `PermissionNeeded => "permissionNeeded"`. TS: `FAILED_TRACKING_STATES = ['error','unavailable','permissionNeeded']`.
- `CameraInfo { device_id, label }` (host, serialized camelCase).
- `FaceFrame { blendshapes: [f32; 51], tongue_out: Option<f32>, rotation: [[f32; 3]; 3] }`.
- `FaceEvent`: `Unavailable(String)`, `PermissionNeeded`, `CameraFailed(String)`, `Face { frame, inference_ms }`, `NoFace`.
- `FaceAdapter` (`cameras`, `start`) and `FaceRun` (drop stops the capture and releases the tracker).
- `FaceKitManager`: the session state machine, owned by `TrackingManager`.
- Constants: `FACEKIT_NAMES` (51), the library path, the stale limit of 500 ms.

## A — Approach

- Contracts change first, in TypeScript and Rust in one commit, with shared validation vectors.
- The mapping is a set of pure functions (name check, name conversion, shape check, rotation conversion, sample parts). The unit tests use the five measured rotations of the design and a numeric fixture from the spike.
- The session manager is plain Rust with a fake adapter in its unit tests. It records a run token for each start and ignores events with an old token.
- The macOS adapter starts on its own thread and reports through events. `Drop` of the run sets a cancel flag, stops the capture, and releases the tracker.
- The editor takes the camera list from a host command through an injected command object, and keeps the logic in pure functions with unit tests.

## S — Structure

- Changed: `packages/contracts/src/tracking.ts`, `crates/contracts/src/tracking.rs`, `fixtures/protocol/validation-vectors.json`, and their tests.
- Changed: `packages/session/src/tracking.ts` and session tests. Changed: `apps/mcp/src/server.ts` and an MCP integration test.
- New: `apps/desktop/src-tauri/src/tracking/facekit/` (`mod.rs`, `adapter.rs`, `mapping.rs`, `stub.rs`, `macos.rs`), `apps/desktop/src-tauri/tests/facekit_integration.rs`, `apps/desktop/src-tauri/examples/facekit_smoke.rs`.
- Changed: `apps/desktop/src-tauri/src/tracking/mod.rs`, `service/mod.rs`, `bootstrap.rs`, `lib.rs`, `build.rs`, `capabilities/main.json`, `Info.plist`, `Cargo.toml`, `Cargo.lock`.
- New: `apps/desktop/src/editor/facekit.ts`, `apps/desktop/src/editor/add-menu.ts`. Changed: `authoring.ts`, `asset-groups.ts`, `live-fields.ts`, `property-defaults.ts`, `tracking/hidden-cameras.ts`, `Hierarchy.svelte`, `Inspector.svelte`, `TrackingSourceFields.svelte`, `TrackingDiagnostics.svelte`, `EditorApp.svelte`, and their tests.
- New: `tools/facekit-probe/`, `fixtures/tracking/facekit-frames.json`, `docs/evaluation/facekit-feasibility.md`, `docs/evaluation/facekit-tracking.md`.
- Changed: `ARCHITECTURE.md`, `docs/warudo-parity.md` (TRK-24), `docs/testing.md`.
- No change: the show file version, the renderer, the output app, the MediaPipe path, the UDP decoders.

## O — Operations

Slices and their order. The plan gives the tasks, files, and tests.

| Slice | Content | Requirements | After |
| --- | --- | --- | --- |
| S1 Records | Probe tool, numeric fixture, feasibility record | R23 | — |
| S2 Contracts | Kind, states, vectors, session rule, MCP text | R1–R4, R22 | S1 |
| S3 Host | Mapping, manager, stub, macOS adapter, commands | R5–R17, R21 | S2 |
| S4 Editor | Add menu, inspector, camera list, settings button | R18–R20 | S2 |
| S5 Verification | Live checks, records, parity, pull request | R23 | S3, S4 |

S1 and S2 run in sequence in the feature worktree; the integrator owns them. S3 and S4 run at the same time in separate worktrees. S3 owns `apps/desktop/src-tauri/**`, `Cargo.lock`, and `ARCHITECTURE.md`. S4 owns `apps/desktop/src/**` and `apps/desktop/test/**`. S4 uses only the two command names of R21 from S3. S5 merges both and needs the owner at the camera.

## N — Norms

Rust: pure mapping functions, no panic and no `unwrap` on FaceKit output, each `unsafe` block with a comment that gives the reason it is sound, the `objc2` style of `capture/macos.rs`. TypeScript: functional, plain data, the compact style of the nearby tracking files. Controls come from `@oshi-connect/ui`. UI copy is the menu name, the group name, the inspector line, and the existing labels (constitution principle 1). Prose follows ASD-STE100. Unit tests cover each new function behaviour. The one integration test is at the AppleCVA boundary.

## S — Safeguards

- Do not link AppleCVA at build time. Do not copy or bundle an Apple framework, model, or header.
- Do not load AppleCVA or open the camera without an enabled `facekit` source.
- Do not start, enable, or add a different tracker when FaceKit fails.
- Do not read, store, log, or send `identity_coefficients`, `face_id`, a frame, or the callback dictionary.
- Do not open or copy AppleCVA-VTS code.
- Do not send frames through Tauri IPC or to the webview.
- Do not add a status field, a new MCP tool, or a show file version.
- Do not change the MediaPipe path or the UDP decoders.
- Do not break the build on Linux or Windows: each Apple item is under `cfg(target_os = "macos")`.
- Do not claim hardware, an operating system version, or a result that was not tested. Do not say that identity is disabled.
- Do not publish or start a live stream in a check.
