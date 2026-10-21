# Output size, render scale, and frame limit analysis

Issue: [#173](https://github.com/danirukun/opensekai/issues/173) (CAM-16). Queue bundle B22. Mode: contract-first. This is slice 1 of CAM-16.

## Problem

Warudo 0.15.1 (UI audit, 2026-10-17, Windows 11) has settings for window size presets, a fixed window size, a render resolution multiplier, a frame limit, V-Sync, and Pause Render with Render Next Frame. An operator uses them to fit the output to the stream and to the GPU budget.

OpenSekai has no such control. Each scene output is fixed at 1920 × 1080 and 60 FPS by the contract. The OBS page draws each frame that the host sends. An operator with a weak GPU, or a stream at 720p or 30 FPS, cannot lower the cost without a change to the code.

## Handbook recheck

The handbook was read on 2026-10-21. The [performance tutorial](https://docs.warudo.app/docs/tutorials/optimizing-performance) says: "The recommended resolution is 1920 x 1080". "If 1920 x 1080 is still too demanding on your GPU, you can try 1280 x 720." The window size is in "Menu → Settings → Window Width/Height". The frame limit is in "Menu → Settings → Limit FPS", and the tutorial names 30 FPS for a 30 FPS platform. It tells the operator to turn V-Sync off. The handbook has no page for the render multiplier, Pause Render, or Render Next Frame. The UI audit stays the only source for them.

## Existing material

- `packages/contracts/src/schema.ts` `OutputSpecSchema`: `{id, cameraId, width: 1920, height: 1080, fps: 60}` as literals. `crates/contracts/src/lib.rs` checks the same values in the scene validation and in `impl Validate for OutputSpec` (`invalid output spec`). Each scene has `output_main` (OBS page) and `preview_main` (Scene window).
- `packages/renderer/src/renderer.ts` sets the drawing buffer to `output.width × quality.resolutionScale` by `output.height × quality.resolutionScale` on each frame.
- `packages/contracts/src/quality.ts` (B8): frozen quality profiles. A profile is a renderer-client setting from the OBS URL (`?quality=`), not a show setting, because it is a measurement setting.
- `apps/output/src/main.ts` applies each host frame and sends the acknowledgment. It has no frame pacing.
- The host (`service/mod.rs`) sends the clock at 60 Hz. The session ticks on the clock. The host keeps at most 2 unacknowledged frames for each renderer (`STATE_CAPACITY`), and accepts an acknowledgment of the newer frame only ("A coalescing renderer can acknowledge the newer delivered frame only").
- `FrameApplied.width` and `.height` are at most 1920 and 1080. Capture metadata, the evaluation captures (`crates/evaluation/src/captures.rs`), and the PNG byte limits use the same bound. Screenshots are 1920 × 1080 always.
- `apps/desktop/src/editor/ui-message.ts` `fitPreview` and the camera frame assume 16:9.
- `apps/desktop/src/components/OutputControls.svelte` has the output camera, the Quality select, and Copy OBS URL.
- The benchmark contract names 1920 × 1080 at 60 FPS as the target. `tools/evaluation/src/obs.ts` makes the OBS test source at that size and rate.
- `service/mod.rs` `current_output` returns the last acknowledgment of an output and refuses one older than 500 ms. It does not return the output spec.

## Findings

1. The scene output already holds `width`, `height`, and `fps`. They are the natural place for the output size and the frame limit. A change through a scene patch reaches the OBS page live, and MCP reaches it through `scene_patch`. An OBS URL parameter needs a new paste in OBS for each change.
2. A buffer larger than 1920 × 1080 breaks the `FrameApplied`, capture, evaluation, and PNG bounds. A render multiplier above 1 and a 4K output need those bounds changed together. That is a separate slice.
3. A size that is not 16:9 breaks `fitPreview`, the camera frame, the guides, and the screenshot size. The four 16:9 sizes 960 × 540, 1280 × 720, 1600 × 900, and 1920 × 1080 need none of those changes.
4. The simulation must stay at 60 Hz (one authoritative simulation). A frame limit is a render limit. The OBS page can apply fewer frames and acknowledge only the frames that it applies, because the host accepts a coalescing renderer. The host does not change.
5. If the OBS page waits for the next host frame to apply a held frame, it can stall: the host sends a frame only while fewer than 2 frames are unacknowledged, so a held frame plus one early arrival stops the host. One timer at the end of the interval removes that case.
6. A browser page has no V-Sync control. The WebView and the OBS Browser Source present at the compositor rate, and OBS has its own frame rate setting. OpenSekai cannot offer a V-Sync switch that does something.
7. Pause Render is a runtime state. If a show saves it, a show opens with a frozen OBS image. It needs a runtime gate in the host or the renderer client and a new call, which is a separate slice.
8. A non-default output makes a benchmark run not comparable. The benchmark must refuse it.

## Questions resolved without the owner (reversible)

- **Scene output, not URL.** Size, frame limit, and render scale are fields of `output_main` in the scene, saved in the show. Alternative: OBS URL parameters as for the quality profile (no show format change, but a new paste in OBS for each change, and no MCP control). The scene already holds width, height, and fps, so the format change is a relaxed literal plus one optional field.
- **Sizes.** Four 16:9 presets: 960 × 540, 1280 × 720, 1600 × 900, 1920 × 1080 (default). Alternative: free width and height fields. Rejected for this slice by findings 2 and 3. A free size and 4K are gaps.
- **Frame limit.** 30 or 60 FPS (default 60). Alternative: 24, 50, or a free number. The simulation is 60 Hz, so a value above 60 has no effect, and 30 is the value the handbook names.
- **Render scale.** An optional `renderScale` of 0.5, 0.75, or 1. A missing value means 1. It multiplies the quality profile scale. Alternative: a value above 1 for supersampling, rejected by finding 2.
- **Only `output_main`.** The operation changes the OBS output only. `preview_main` stays 1920 × 1080 at 60 FPS and display rate. Alternative: one setting for both, as in Warudo, where the window is the output. The Scene preview is an editor view and already has its own profile.
- **V-Sync.** No control (finding 6). The parity line names it as not applicable to a browser output.
- **Pause Render and Render Next Frame.** Not in this slice (finding 7). A CAM-16 slice 2 contract takes them.
- **OBS Browser Source size.** The OBS URL does not change. The operator sets the Browser Source size in OBS. If the sizes differ, the page scales the canvas to the source. The evidence file says this; the UI does not (constitution principle 1).

## Risks

- An older build rejects a show with a non-default output. This is the same as for each new entity kind. `schemaVersion` stays 1, because each older show stays valid.
- The pacing gate can drop the frame of a revision change at 30 FPS. The newest frame always wins, so the next applied frame shows the change. A capture waits for the expected revision, as it does now.
- OBS can render the page at a different rate from the limit. OBS timing is an owner check (`accept:local`).
- A lower size or scale lowers the image quality in OBS. The visual result is an owner check.
