# MediaPipe tracking assets

The application bundles Google MediaPipe Tasks Vision 1.0.1 and its matching WASM files. The package declares Apache-2.0. Google model cards state Apache License, Version 2.0 for the model components listed below. The full license is in LICENSE.Apache-2.0.txt. The asset manifest records the official version-1 download URL, byte count and SHA-256 for each task bundle. It also records the hashes of all six WASM package files. These files are copied without changes.

Google model documentation and license sources, checked 2026-10-03:

- Face bundle: [official guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker). [BlazeFace short-range card](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf), page 1; [Face Mesh V2 card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf), page 1; [Blendshape V2 card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf), page 1.
- Pose lite bundle: [official guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker). [BlazePose GHUM 3D card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf), page 2.
- Hand full bundle: [official guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker). [Hand Tracking Lite/Full card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf), page 2.
- [MediaPipe source license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE).
- [MediaPipe privacy notice](https://goo.gle/mediapipe-privacy).

Preparation uses the existing local cache by default. Run `pnpm exec tsx scripts/prepare-tracking.ts --download` once when that cache is absent. A download must match the committed manifest before it can enter the cache or public directory. A wrong package version, missing file or hash mismatch fails the build. Model and WASM binary files remain in ignored local/build directories. Runtime model loading uses only the application's `/tracking/` origin. Camera images stay in the local inference worker.

Retargeting scope: face rotation is relative to the first valid frame after Start or calibration. ARKit category names remain exact. Body rotations use a right-handed Y-up basis, T-pose arm directions, and parent-local child rotations. Hands use a palm basis and parent-local finger directions. Mirror swaps anatomical side channels and reflects rotations across X. This provides upper-body animation; it does not estimate locomotion, feet or absolute root position. Physical camera accuracy and packaged WebView camera access require separate evaluation.
