# Camera orbit node and main camera selection analysis

Date: 2026-11-07. Scope: bundle B32, the rest of #49 (CAM-01) and #50 (CAM-02). Mode: contract-first. Contract: [camera orbit and selection](../prompt/2026-11-07-camera-orbit-selection.md). Earlier slice: [camera workflow](2026-10-17-camera-workflow.md) (B7).

## Sources

- [Warudo Camera](https://docs.warudo.app/docs/assets/camera), read again on 2026-11-07. It gives: up to 8 cameras for each scene; a default camera in each scene; a new camera does not become the main camera; the camera icon before the name or Tab and Ctrl+Tab select the main camera, and a solid icon marks it; Control Mode is Free Look (default), Orbit Character, or None; Focus Character sets the orbit character; Control Sensitivity sets the speed; Field Of View; Orthographic Projection; Chroma Key, Transparent Background, and Render Characters, Props, and Environment; Handheld Movement; post-processing effects; outputs for each camera; Screenshot.
- [Animating the Camera](https://docs.warudo.app/docs/blueprints/tutorials/camera), as read for B24 on 2026-10-27 ([analysis](2026-10-27-camera-animation-example.md)): the Camera Orbit Character node with Align Target With Main Camera, Transition Time, Transition Easing, and On Transition End; Switch Main Camera with an optional fade. Finding 7 of that analysis says: "An orbit node is a separate slice with CAM-01."
- [Bonnie scene spike](../../docs/superpowers/specs/2026-10-28-bonnie-scene-spike.md): "The orbit offset and camera noise need a check."
- B7 evidence: [camera workflow check](../../docs/evaluation/camera-workflow.md) and its Gaps section.

## Handbook audit

Each statement of the Camera page that belongs to CAM-01 (camera entities, lens controls, navigation) or CAM-02 (multiple cameras and selection), and its state on `main` at 99ecae5.

| Handbook statement | State on main | In this slice |
| --- | --- | --- |
| Up to 8 cameras for each scene | Done (B7 R12a), Linux evidence | No |
| A scene has a camera by default | Done: each output needs a camera, and a new scene has one | No |
| A new camera does not become the main camera | Done: Add does not call `selectCamera` | No |
| Camera icon before the name selects the main camera; a solid icon marks it | Done: Hierarchy row button with `aria-pressed` | No |
| Tab and Ctrl+Tab select the next and previous camera | Linux evidence only (B7 R12, while the viewport canvas has focus); macOS WebView not checked | Local check only |
| Control Mode, Focus Character, Control Sensitivity | Linux evidence only (B7 R1–R11), plus the macOS orbit follow check; macOS feel not checked | Local check only |
| Field Of View; near and far | Done | No |
| Camera Orbit Character node (tutorial) | Gap: no node. Set Asset Property moves along a line (Approximate) | **Yes** |
| Switch Main Camera node | Partial: Switch Camera cuts one output. A cut of `output_main` leaves the editor viewport on the old camera, but every editor path (`model.selectCamera`, two `cameraSelect` calls) moves both outputs | **Yes** |
| Switch Main Camera fade | Gap | No: SHOW-01 (director transitions) |
| Orthographic Projection, Chroma Key, Transparent Background, render layers | Gap | No: CAM-13 |
| Handheld Movement | Gap | No: CAM-12 |
| Outputs for each camera | Gap | No: CAM-03, CAM-09 |
| Post-processing | Partial | No: CAM-06, CAM-07, CAM-08 |
| Screenshot | Done (B7) | No: CAM-05 |

Thus the code gaps of CAM-01 and CAM-02 are the orbit node and the main camera rule of the Switch Camera node. The other open items are owner checks on macOS and OBS. This slice also lists them, so the owner can close both issues after one local run.

## Current state

- `packages/renderer/src/camera-navigation.ts` has the pure orbit math: `rotationOf`, `anglesOf`, `orbitPivot`, `orbitFromTransform`, and `transformFromOrbit`. The viewport uses it. The session cannot import the renderer package.
- `packages/session/src/tweens.ts` has one property tween for each entity and property key. A tween writes to the override layer on each advance. A scene patch that touches the property, an immediate write, or a graph change stops it. An end output runs on the clock step after the end.
- `packages/session/src/camera-follow.ts` moves an Orbit Character camera with its target (B7 R6a). The camera's own position override wins over the follow.
- `camera.switch` emits `{ kind: 'selectCamera', outputId, cameraId }`. `applyEffects` sets the camera of that one output.
- The Blueprint file format lists `camera` and `output` references and remaps them on import.

## Decisions

These decisions are reversible. The owner can change each one in review of this contract before code exists.

1. **Node shape.** A new node `camera.orbitCharacter`, label Camera Orbit Character, category Scene (the OpenSekai category of Switch Camera). Settings: Camera, Transition (s), Easing. Data inputs with inline values: Yaw (°), Pitch (°), Distance (m). Outputs: Exit and On Transition End. Alternative: settings only, with no data inputs. Data inputs let a graph compute the orbit (for example Random Number), as Set Asset Property does with its value.
2. **Angle convention.** Yaw 0° puts the camera on the +Z side of the pivot, looking toward −Z. Yaw increases counter-clockwise when seen from above (the same sign as a rotation about +Y). Pitch is positive when the camera is above the pivot and looks down. These are the user values; the session converts them to the internal `OrbitState` of `camera-navigation.ts` (internal pitch = −Pitch). Alternative: the internal sign (positive pitch looks up). That is less clear for an operator.
3. **Mode rule.** The node acts only on a camera in Orbit Character mode. For another mode the run fails with `INVALID_INPUT` and the camera ID, and nothing changes. Alternative: the node switches the camera to Orbit Character. That is a scene change that the operator did not ask for, and the handbook does not say which one Warudo does.
4. **Pivot and follow.** The node works in persistent coordinates, as a B7 orbit gesture does: the pivot is the persistent root position of the Focus Character plus `pivotOffset`, and the follow offset of a Blueprint-moved character is added on top when the frame is evaluated. Today `followed()` skips the follow for a camera with its own position override, so an orbit write that used the evaluated pivot would count the character offset twice after the idle commit and the camera would jump. The node marks its override as follow-relative, and `followed()` adds the offset to it. The node samples the pivot again at each advance. Alternative: a pivot fixed at the start of the move. Then a walk during the move leaves the camera behind until the end. The pivot height question from the Bonnie spike stays open (see Candidates).
5. **Interpolation.** The tween eases Yaw, Pitch, and Distance, as finding 7 of the B24 analysis says Warudo does. Yaw goes the short way (a change of at most 180°). A full turn needs two nodes. Alternative: the raw difference. Then 350° to 10° turns 340° the long way.
6. **Start value.** The start is the orbit of the current camera position around the current pivot (`orbitFromTransform`). Thus a move starts where the camera is, also after a viewport drag or an Inspector edit. A camera that does not look at the pivot turns to it on the first advance (Approximate). Alternative: also ease the rotation from the start rotation. That needs a second interpolation and is not in the tutorial.
7. **One tween for each camera.** An orbit tween writes the camera position and rotation together. The layer stores the one record under both keys, so the existing busy check and stop paths work by key. It owns both keys: a new orbit tween on the same camera replaces it (or joins it when the target is equal), and a Set Asset Property write to that camera's Position or Rotation stops it, as a write stops a property tween today. A scene patch that changes the camera transform or its `navigation` stops it, so a viewport gesture takes manual control, as in Warudo. For `navigation` this needs `setCameraNavigation` in `touchedProperties`; today that operation touches no property.
8. **Commit.** As for a property tween, the override under an orbit tween does not commit. The idle commit after the end writes the last transform once.
9. **Use current value.** The node has a Use current value button, as Set Asset Property has. It writes the current Yaw, Pitch, and Distance of the camera around its pivot into the three inline inputs with `setNodeInput`, in one undo step. It is disabled when the camera is not in Orbit Character mode. This gives Warudo's Align Target With Main Camera for the camera of the node. Alternative: three separate buttons.
10. **Switch Camera and the main camera.** A Switch Camera node with Output `output_main` sets `output_main` and `preview_main` in one revision. The editor paths (`model.selectCamera` for the Hierarchy, the Output panel, and Tab) already move both outputs, with two calls. MCP `camera_select` names one output and stays as it is. A Switch Camera node with Output `preview_main` sets only `preview_main`. Saved graphs keep their shape; only the effect changes. This matches Warudo Switch Main Camera, which changes the main window and the output together. Alternative: keep the one-output cut. Then a hotkey cut leaves the editor on the old camera, and a later Tab cycles from a camera that the output does not show.

## Candidates

- **Orbit pivot height.** The pivot uses the root position plus `pivotOffset` (default chest height, B7 decision 4). Warudo may orbit around a bone. Selection gate: the owner compares one Warudo orbit and one OpenSekai orbit of the same character on macOS. Until then this stays Approximate, and this slice does not change it.
- **Switch Main Camera fade.** Belongs to SHOW-01. Not in this slice.

## Effects

- An operator can move an Orbit Character camera around its character from a Blueprint, with a transition, an easing, and a chain through On Transition End. The B24 Camera Sway template keeps working.
- A Blueprint cut of the main output also moves the editor viewport, as every other selection path does.
- No scene schema change. No show file change. One new Blueprint node type; graphs saved before it load without change.

## Risks

- A long orbit tween keeps a position and rotation override on the camera. Without the follow-relative rule (decision 4) the camera would jump after the idle commit while a Blueprint moves the character. The contract asks for a continuity test across the end and the idle commit.
- A wrong angle sign is easy to make and hard to see in numbers. The contract asks for a round-trip unit test and a headless render that shows the character from each side.
- The visual result in OBS and the feel of InOutSine on a real GPU need the owner (`accept:local`).

## Out of scope

The fade of Switch Main Camera (SHOW-01), orthographic projection, chroma key, and render layers (CAM-13), handheld movement (CAM-12), outputs for each camera (CAM-03, CAM-09), post-processing (CAM-06, CAM-07), Camera Orbit Character on a camera that is not in Orbit Character mode, and a change of the orbit pivot.
