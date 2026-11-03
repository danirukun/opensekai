# Check: one editor window

Slice: [one editor window](../../spdd/prompt/2026-11-02-single-window.md). Issue: [#251](https://github.com/danirukun/opensekai/issues/251).

## Before the merge

Purpose: the gate of operation 0. After the merge, a minimized editor is a minimized session owner. This check measures the current two-window build with the Scene window minimized.

Setup: commit 3e02e98 (main), `OPENSEKAI_EVALUATION=1 pnpm dev:desktop`, macOS 27.2, OBS 33.0.0 (1920 × 1080 at 60). `output_main` backend `webgpu`, quality profile `production_v1`. Scene: Catboy (`avatar_7b7c689e…`) on Bonnie_Stage (`scene_9a4451fa…`), built-in idle on. A VMC receiver on 127.0.0.1:39540 took `pnpm evaluate:vmc-feed` as the Catboy face source. A VMC sender sent the Catboy pose to 127.0.0.1:39541, read by `pnpm evaluate:vmc-feed --listen`. An isolated OBS Browser Source showed the output page. The sampler read MCP `app_status` and OBS `GetStats` each 15 s. The window state came from `CGWindowListCopyWindowInfo` (`kCGWindowIsOnscreen`). The owner minimized the Scene window by hand, because the terminal has no Accessibility access.

| Phase | Time | Session tick | `output_main` applied frames | OBS active FPS | OBS render skipped | VMC send | VMC receive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Scene window in front (other windows over it) | 110 s | 59.4 Hz (lowest 15 s interval 54.7 Hz) | 58.0 per s | 60.0 | 0 | 235 datagrams per s, 0 errors, state `sending` and sometimes `waiting` | 58.6 packets per s |
| Scene window minimized | 298 s | 60.0 Hz (lowest 15 s interval 59.7 Hz) | 57.1 per s | 60.0 | 0 | 223 datagrams per s, 0 errors, state `sending` | 59.1 packets per s |

Result: the gate passes. With the session owner minimized, the session tick, `output_main`, VMC send, and VMC receive did not slow down. `output_main` CPU time stayed at 2.2 to 3.0 ms.

Notes:

- The OBS source screenshots of the two phases are empty, because OBS does not draw a Browser Source in a scene that is not on program. A later screenshot with the QA scene on program showed Catboy on the stage. The applied frame count is the evidence for the output in the minimized phase.
- In the front phase, the VMC sender showed `waiting` (no pose for 1 s) in two of eight samples while the Scene window was covered. It did not show `waiting` while minimized. The cause is not known. This is the current behavior, not a change of this slice.
- The Scene preview stopped at sequence 8950 in the front phase while other windows covered it, as recorded before ([local QA note](environment-import.md)).
- MediaPipe camera tracking was not measured. It turns on the camera. Unknown.
