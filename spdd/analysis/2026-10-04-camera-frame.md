# Scene camera frame analysis

The transparent preview and its surrounding checkerboard have the same background. Users cannot see the exact image boundary. The Scene viewer already uses the preview output camera. It has no separate free camera. The canvas rectangle is the exact render boundary.

Use a fitted canvas wrapper, an inset frame, and a dark outer area. Keep a small margin so all four edges remain visible. A renderer overlay would add GPU work and could enter output captures. A full camera view with overscan needs a separate editor camera and is outside this slice.

The user also requires three-vrm WebGPU support. The current backend uses WebGPURenderer. The VRM loader supplies MToonNodeMaterial through MToonMaterialLoaderPlugin as the official guide requires. Preserve this path and verify the runtime backend. Keep the existing WebGL2 fallback.
