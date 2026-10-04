# Minimum live VTubing analysis

Date: 2026-10-03. User authorized continued implementation after UI checkpoint e080744.

The minimum useful app must import a local VRM, create VMC and iFacialMocap receiver assets, control an avatar with external sender apps, create and edit a camera, render the scene in OBS, and create/use a MediaPipe webcam tracker. Repeatable mock motion data is authorized. Request real sender connection details when required for live verification.

The current release has a static smoke fixture, transforms, preview gizmos, camera selection, transparent OBS rendering and MCP. It has no dynamic import, entity creation, receiver sockets, runtime bone/expression data or webcam inference. Source control is checkpointed. The user example is a self-contained 91,619,676-byte VRM0 model with 53 humanoid bones, 20 meshes, 23 materials and 14 textures. Do not commit its bytes or private path.

Use native managed import and UDP receivers, a worker for MediaPipe inference, and the existing authoritative session for source mixing. Keep high-rate motion out of persistent edits. VMC raw local bone rotations and MediaPipe normalized T-pose deltas must have distinct space tags. Preserve a VRM binding per instance; the current scene-only clone cannot drive its original VRM rig.

Primary references: [VMC](https://protocol.vmc.info/marionette-spec), [iFacialMocap](https://www.ifacialmocap.com/for-developer/), [Warudo MediaPipe](https://docs.warudo.app/docs/mocap/mediapipe), [Google face](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js), [pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js), [hands](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js), [VRM humanoid](https://pixiv.github.io/three-vrm/docs/classes/three-vrm.VRMHumanoid.html).

Risks: raw VMC sender rig compatibility, iFacial angle conventions, VRM0 orientation and expression presets, large model startup memory, WKWebView camera permission and worker/WASM loading, tracking loss, late start after Stop, receiver rebind conflicts, and hidden-window inference scheduling. Mock packet tests establish decoded motion; they do not establish a physical phone or webcam connection. Real app and OBS checks must identify that distinction.

## Implementation contract

[REASONS contract](../../../spdd/prompt/2026-10-03-minimum-live-vtubing.md) owns exact interfaces and acceptance. The existing architecture now prioritizes this user-defined minimum before the concert foundation. The approved separate Scene/Editor layout remains.
