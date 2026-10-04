# Scene camera frame design

The Scene viewer will show a thin frame at its exact canvas edge. A dark outer area and a 24 pixel margin separate the rendered image from the window. The transparent image keeps its checkerboard background. The frame is an inset DOM overlay with pointer events disabled.

The surface dimensions come from the existing 16:9 fit calculation with an optional inset. The canvas fills this surface. ResizeObserver updates the surface when the window changes. The renderer still uses the selected preview camera. If preview and output cameras differ, this frame describes the preview camera.

VRM rendering already uses the official three-vrm WebGPU path: WebGPURenderer plus MToonNodeMaterial supplied through MToonMaterialLoaderPlugin. No material rewrite is required. Confirm the actual runtime backend in the Scene owner and OBS. Preserve WebGL2 fallback.

Acceptance: all four frame edges visible, exact canvas alignment, wide and tall window layouts fit, canvas interaction remains available, and clean OBS output contains no UI frame. Tests cover margin fitting and collapsed areas. Visual checks cover styling and output isolation.
