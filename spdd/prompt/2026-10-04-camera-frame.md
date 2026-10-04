# Scene camera frame contract

## Requirements
Show the exact preview render boundary in the Scene window. Keep all edges visible on resize. Do not put the frame in OBS output. Preserve direct canvas selection and gizmos. Use WebGPURenderer and MToonNodeMaterial for VRMs.

## Entities
The viewport is the available area. The preview surface holds the canvas and frame. The selected preview output camera defines the rendered image. Output remains 16:9 in this slice.

## Approach
Fit the surface to available width and height with a 24 pixel margin on each side. Clamp collapsed areas to zero. Put the checkerboard inside the surface. Use a dark background outside. Draw the frame with a pointer-transparent inset overlay.

## Structure
App.svelte owns surface dimensions and canvas binding. app.css owns frame appearance. fitPreview in editor/ui-message.ts owns fit calculations. ui-message.test.ts covers fit behavior. Existing backend.ts and assets.ts own the WebGPU and VRM material path.

## Operations
1. Add fit tests for margins and collapsed dimensions.
2. Extend fitPreview with an optional inset, default zero.
3. Size the surface with ResizeObserver; make the canvas fill the surface.
4. Add editor-only frame CSS.
5. Run focused unit tests, workspace checks, and a macOS build.
6. Preserve and restore the live scene across restart. Check the Scene frame and clean OBS output. Record actual backend and scoped evidence, then commit.

## Norms
Use Svelte 5 and existing UI styling. Add no redundant copy or new dependencies. Keep overlay outside the renderer. Keep the original VRM file unchanged.

## Safeguards
Frame dimensions must equal the canvas CSS rectangle. No frame border may reduce the rendered area. The overlay must not intercept pointer events. Verify resize, selection, and clean output visually. A WebGPU constructor alone does not prove the selected backend; inspect runtime status. Do not claim full material parity or hardware benchmark completion.
