# Camera workflow analysis

Date: 2026-10-17. Scope: bundle B7 (#49 CAM-01 first subset, #50 CAM-02 first, #53 CAM-05 first evaluation path). Contract: [camera workflow](../prompt/2026-10-17-camera-workflow.md).

## Sources

- [Warudo Camera](https://docs.warudo.app/docs/assets/camera). The cloud run could not reach this page (DNS failure). The owner must check the page before the implementation run starts.
- UI audit 0.15.1 lines in [the parity checklist](../../docs/warudo-parity.md): control modes are None, Free Look (right mouse button and WASD, Q and E), and Orbit Character (left or right mouse button to orbit, wheel to zoom, middle button to pan). Each camera has Take Screenshot and Open Screenshots Folder.

## Current state

- **Camera entities (CAM-01).** A scene can hold camera entities (`kind: 'camera'`) with a transform and a lens (`fovDegrees` 1–179, `near` above 0, `far` above `near`). The Assets menu adds a camera at `[0, 1.2, 3]` with FOV 40. The Inspector edits the lens (`CameraLensFields.svelte`) and the transform. Blueprint property targets read and write `fovDegrees`.
- **Navigation (CAM-01).** There is no camera navigation. The editor viewport draws the `preview_main` camera, which is also the output camera. The only way to move that camera is a gizmo drag or the Inspector transform fields. A gizmo drag keeps a local draft and sends one `setTransform` patch on release.
- **Selection (CAM-02).** The `cameraSelect` call sets the camera of one output. `model.selectCamera` sets `output_main` and then `preview_main`. The Hierarchy row button, the Hierarchy menu item "Use as output camera", the Output panel Camera select, and MCP `camera_select` use it. Removal of the output camera is rejected. The renderer reads the output camera for each frame, so a cut takes effect on the next frame. No evidence file records a multi-camera cut with continued motion.
- **Screenshots (CAM-05).** Only the evaluation path exists: `captureFrame` asks the connected `output_main` renderer (normally OBS) for a PNG of at most 2 MiB, at most once per second, and stores it as evidence. There is no user screenshot, no file in a user folder, and no capture of a camera that is not the output camera.

## Decisions

These decisions are reversible. The owner can change each one in review of this contract before code exists.

1. **Navigation mode is a persisted camera setting.** As in Warudo, each camera has a control mode. The camera gets an optional `navigation` field: `{ mode: 'none' }`, `{ mode: 'freeLook' }`, or `{ mode: 'orbitCharacter', targetId, pivotOffset }`. A missing field means `none`, so an old show does not change. A camera that the editor adds gets `orbitCharacter` with the first character as the target (or `null`). Alternative: keep the mode as editor-only state that the show does not save.
2. **Navigation moves the camera entity.** The viewport camera is the output camera. Thus navigation changes the camera transform through the normal patch route, and OBS follows. Alternative: a separate editor-only viewport camera. That is a larger change, and Warudo does not do it for the main camera.
3. **Commits during a gesture.** A gesture keeps a local draft, as a gizmo drag does. While the gesture continues, the editor sends one `setTransform` patch at most every 100 ms, and only after the previous reply. It sends a last patch at the end of the gesture. Thus OBS follows the motion at about 10 Hz, and the revision does not increase at the frame rate. A pan sends the transform and the pivot in one patch. When another edit changes the scene during a gesture, the other edit wins and the gesture ends. Alternative: one patch at the end only, as a gizmo drag does. Then OBS jumps at the end.
4. **Orbit pivot.** The pivot is the target character root position plus `pivotOffset` (default `[0, 1.3, 0]`, about chest height). With no target, the pivot is `pivotOffset` in world space. A pan changes `pivotOffset`. The pivot does not follow an animated bone. Alternative: the head or hips bone of the evaluated pose. That needs bone data in the editor and makes the math depend on the pose.
5. **Removal of a target character** sets `targetId` to `null` on each camera that uses it, in the same operation. This matches the removal of a tracking source.
6. **Screenshots render in the Scene window.** A screenshot must work without OBS. The Scene window renderer client renders one extra frame for the given camera at the output size (1920 × 1080) with a transparent background, encodes a PNG, and sends it to the host over the existing WebSocket as base64 JSON, as `captureReply` does. It is a one-shot frame, at most one each second for the whole host. It uses the `Edit` capability, because `Capture` exists only in evaluation mode, and a screenshot is a normal operator action. It does not use Tauri IPC and it does not change the OBS output path. Alternative: ask the OBS renderer, as `captureFrame` does. That fails when OBS is not connected.
7. **Screenshot folder** is `<app local data>/screenshots/`. The file name is `<UTC time>-<camera ID>.png`. The PNG limit is 8 MiB (12 MiB message with base64). The implementation run measures a real PNG before it keeps this limit. Alternative: the user Pictures folder.
8. **Open Screenshots Folder** uses the official Tauri opener plugin (`tauri-plugin-opener`) through its Rust API, from an editor-only command. The command takes no path from the frontend, and the frontend gets no `opener:` permission. Alternative: a platform adapter that runs `open` on macOS. This adds one dependency, so the owner must accept it in review.
9. **CAM-02 needs evidence, not a new feature.** The selection paths exist. This slice adds an integration test for a cut between two cameras and records the cut in OBS with continued motion. The separate output windows of Warudo are CAM-03 (Later).

## Effects

- An operator can move the output camera in the viewport with the Warudo control modes. OBS shows the result.
- An operator can save a transparent PNG of any camera from the Inspector or from MCP, and can open the folder.
- The show format gets one optional camera field. The call API gets one call (`cameraScreenshot`) and one patch operation (`setCameraNavigation`). Old shows load without change.

## Risks

- Commits at 10 Hz during a gesture can conflict with another edit at the same time. A conflict ends the gesture and keeps the scene value.
- The extra screenshot frame costs one render at 1920 × 1080 in the Scene window. A preview frame can be late for that time. The cost is unknown until the owner measures it on macOS.
- A 1920 × 1080 PNG with alpha can be larger than the 2 MiB diagnostic limit. The 8 MiB limit is an estimate until the implementation run measures it. A larger image fails with `INVALID_INPUT`. A larger renderer socket limit lets a renderer client send a larger message; each other message kind keeps its own size check.
- The handbook page was not read in this run. A control detail (speeds, modifier keys, zoom limits) can differ from Warudo.

## Out of scope

Camera follow, focus, and gamepad (CAM-11), handheld motion (CAM-12), projection and layers (CAM-13), separate output windows (CAM-03), screenshot resolution or format choices, a screenshot gallery, and a keyboard shortcut for screenshots.
