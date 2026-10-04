# Scene camera frame check

Checked on macOS on 2026-10-04. The user VRM0 and six-asset scene were restored after app restart. Entity settings and output cameras match the saved scene; source generations changed at startup.

The Scene window shows all four frame edges at the exact canvas boundary. Normal and native zoomed layouts were inspected. A click on the avatar selected it and showed the transform gizmo. Unit tests cover wide, tall, and collapsed fit calculations. The frame has no pointer events and does not change canvas dimensions.

The existing renderer follows [three-vrm WebGPU guidance](https://github.com/pixiv/three-vrm#use-with-webgpurenderer): WebGPURenderer and MToonNodeMaterial through MToonMaterialLoaderPlugin. Runtime status reported webgpu for preview_main and output_main, revision 10, with no warnings. The clean OBS source image shows the VRM without the UI frame, checkerboard, or gizmos. OBS 32.2.2 was restored to its prior scene and owned sources were removed. The first capture was too early for the OBS compositor; the accepted capture was taken after presentation settled.

Verification: 69 focused unit tests passed. Workspace checks found zero errors and zero Svelte warnings. macOS release build passed. Private capture hashes and quality settings are in camera-frame-evidence.json. The source checkpoint is the feature commit that contains this report.

This verifies the current preview camera boundary. A separate free camera, overscan, full material parity, Windows, GPU timing, and concert performance remain outside the result.
