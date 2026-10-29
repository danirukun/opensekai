# Analysis: Turn off the Scene preview

Date: 2026-10-28. Source: the Bonnie scene spike ([#240](https://github.com/danirukun/opensekai/issues/240)).

## Problem

The Scene window renders the `preview_main` output at display rate. In the Bonnie scene, the preview used 19 to 27 ms of CPU time for each frame, and `output_main` used 2 to 7 ms. While the preview rendered, both outputs ran at the same frame rate (about 44 to 54 FPS against a 60 FPS target). An operator who watches the OBS output does not need the preview while they stream. There is no control to stop it. A covered Scene window stops the preview only by accident (`docs/evaluation/environment-import.md`).

## Current behavior

- The Scene window holds the session worker and the preview renderer. The worker runs on host clock messages, not on `requestAnimationFrame`, so the simulation does not depend on the preview.
- The preview pump (`apps/desktop/src/preview-pump.ts`) applies the newest offered frame once on each display frame and never starts a second one while one is in progress.
- The host sends a renderer at most two frames without an acknowledgement and keeps only the newest two frames to send (`service/queues.rs`). A renderer that stops acknowledging stops getting frames. Its next acknowledgement releases the newest frame.
- MCP `camera_screenshot` goes to the `preview_main` renderer and waits until that renderer applied the expected revision.
- The viewport gizmos, picking, camera navigation, the asset load status, and the preview FPS counter all run in the preview submission.

## Choices

| Choice | Selected | Reason |
| --- | --- | --- |
| Stop the pump, keep the WebSocket and the renderer | Yes | No scene reload and no asset reload when the preview comes back. No change to the host or the contracts. |
| Close the preview renderer | No | The assets load again when the preview comes back. Screenshots need the renderer. |
| A lower preview frame rate | Later | It does not remove the cost. It is a separate control. |
| Remember the state between launches | No | Pause is runtime state ([output format analysis](2026-10-21-output-format.md)). A frozen viewport at launch looks like a fault. |

## Consequences

While the preview is off, the viewport shows the last frame and does not change. Gizmos, picking, and camera navigation in the viewport stop. The asset load status in the Editor does not advance until the preview comes back. MCP `camera_screenshot` still works: the pump runs until the screenshot is done.
