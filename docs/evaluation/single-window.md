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

## After the merge

Purpose: the checks of operation 6 on the one-window build.

Setup: commit cfcdef0, `OPENSEKAI_EVALUATION=1 pnpm dev:desktop`, macOS 27.2, OBS 33.0.0 (1920 × 1080 at 60). Backend `webgpu`. Quality profile `production_v1` for `output_main` and `preview_v1` for `preview_main`. The scene, the VMC feeds, the OBS source, and the sampler are the same as in [Before the merge](#before-the-merge). The window was 1440 × 900 on a second display. Clicks and keys came from System Events (Accessibility) and from Quartz mouse events. The window screenshots came from `screencapture -l`.

### Editing

| Check | Result |
| --- | --- |
| Assets layout at 1440 × 900 | The Hierarchy (224 px), the scene pane, and the Inspector (320 px) show side by side. With Catboy selected the Inspector shows the Transform, Model, and Expressions sections. At 28 px Inspector padding the Position Y field cut off "0.2514". The padding is now 16 px; the field check after that change is open. The tracking guide was not checked at 320 px. |
| Select Catboy in the Hierarchy | The viewport shows the gizmo on Catboy. The toolbar and the Inspector show Catboy. |
| Select Camera in the Hierarchy, then click Catboy in the viewport | The Hierarchy row, the toolbar name, and the Inspector change to Catboy. |
| Drag the Y arrow of the Move gizmo | During the drag the Inspector shows the draft (Y 0.2514). After the release the scene has Y 0.2514. |
| E, R, W with the focus on the viewport | Rotate, Scale, and Move become active. |
| W and R typed in the show name with Rotate active | The text goes into the field. The tool stays Rotate. |
| W typed in the Blueprint node search, then back to Assets | The search shows "w". The tool stays Rotate. |
| Escape during a gizmo drag | The draft (Y 0.4935) goes back to Y 0.2514. The release after Escape commits nothing. |
| Tab change to Blueprints during a gizmo drag | The drag stops. On return the Inspector and the scene show Y 0.2514. The release on Blueprints and the return to Assets did not change the scene revision (175). |

During a drag the scene revision goes up, because the live transform sends the draft to the session (171 → 174). This is the current behavior. The cancel at the tab change sent the start value again (175).

### Tab changes

The sampler read `app_status` 1 s and 4 s after each tab change.

| Tab | `preview_main` sequence | `output_main` sequence |
| --- | --- | --- |
| Assets | 180112 → 180319 | 180112 → 180319 |
| Output | 180349 → 180349 | 180434 → 180640 |
| Blueprints | 180349 → 180349 | 180767 → 180973 |
| Resources | 180349 → 180349 | 181102 → 181308 |
| Settings | 180349 → 180349 | 181438 → 181643 |
| Assets again | 181767 → 181974 | 181768 → 181974 |

Result: the preview stops on each other tab and starts again on Assets with no operator input. `output_main` continues at 60 frames per second. After the return the selection (Catboy), the camera, and the six assets stay. The load overlay does not show.

Resize: on Blueprints the window changed from 1440 × 900 to 1100 × 760. On return to Assets the preview had the 16:9 size of the smaller stage, with no operator input.

### Frame rate and CPU time

Each phase is 30 s. The CPU time is `lastFrame.cpuMs` of each renderer (minimum to maximum of seven reads).

| Phase | `output_main` | `output_main` CPU | `preview_main` | `preview_main` CPU | VMC send |
| --- | --- | --- | --- | --- | --- |
| Assets, preview on | 59.9 per s | 3.5 to 4.0 ms | 59.9 per s | 4 to 5 ms | 288 datagrams per s, 0 errors |
| Blueprints | 60.0 per s | 3.3 to 3.6 ms | 0 | none (the last frame stays) | 281 datagrams per s, 0 errors |
| Assets, preview off | 60.0 per s | 3.4 to 3.6 ms | 0 | none (the last frame stays) | 285 datagrams per s, 0 errors |

The process CPU of the WebView was not measured, because the WebKit processes of this app cannot be told apart from those of other apps without root access. Unknown.

MCP `camera_screenshot` returned a 1920 × 1080 PNG of Catboy on the stage while Blueprints showed (revision 166) and with the preview off (revision 175).

### OBS output

| Case | Time | `output_main` | OBS active FPS | OBS render skipped |
| --- | --- | --- | --- | --- |
| 30 tab changes (Output, Blueprints, Resources, Settings, Assets; 2 s each) | 70.7 s | 60.0 per s | 60.0 | 0 |
| File › Open Show from Blueprints | 15.4 s | 60.0 per s | 60.0 | 0 |

The OBS source screenshot after the tab changes shows Catboy on the stage. After Open the main area changes to Assets. `openShow` did this before the merge too. Open stops the VMC sender, as the sender rules say. The check started it again through MCP before the minimized phase.

### File menu and quit

| Check | Result |
| --- | --- |
| File › Save As | The save sheet opened. The show went to the chosen folder under the typed name. |
| File › Save after a change | The file time changed. The file has the new show name. |
| File › Open while Blueprints shows | The other show loaded. The main area changed to Assets. |
| Cmd+Q with unsaved changes | The dialog "Unsaved changes" asks to quit without saving, with Cancel and Quit. Cancel keeps the app open. |
| Window close button with unsaved changes | The same dialog. Cancel keeps the app and the window open. |

### Minimized window

The window was minimized for 5 minutes (AXMinimized; `kCGWindowIsOnscreen` empty), then restored. The sampler read `app_status` and OBS `GetStats` each 15 s. The VMC listener wrote one line each second. The QA scene was on program in OBS.

| Phase | Time | Session tick | `output_main` applied frames | OBS active FPS | OBS render skipped | VMC send | VMC receive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Window in front | 47 s | 60.0 Hz (each interval 60.0) | 60.0 per s (each interval 60.0) | 60.0 | 0 | 296 datagrams per s, 0 errors, state `sending` | 59.2 packets per s |
| Window minimized | 298 s | 60.0 Hz (intervals 57.1 to 65.6) | 54.8 per s (6 of 18 intervals 39.7 to 51.7) | 60.0 | 0 | 235 datagrams per s, 0 errors, state `sending` and once `waiting` | 46.8 packets per s; 13 of 319 seconds had none |
| Window restored | 63 s | 60.0 Hz | 60.0 per s | 60.0 | 0 | 228 datagrams per s, 0 errors, state `sending` | 45.6 packets per s |

One read, about 15 s after the minimize, had no `output_main` frame and no tracking status, and the sender was `waiting`. `output_main` CPU time was 3.1 to 5.8 ms while minimized.

Result: R13 is not met. With the one window minimized, `output_main` slows down. The session tick keeps its average but has uneven intervals. OBS kept 60 FPS with no skipped frames, but OBS draws its own frames; that does not show that the output kept the motion. Before the merge, with only the Scene window minimized and the Editor window visible, `output_main` kept 57.1 per s (see [Before the merge](#before-the-merge)). The owner accepted this result as a known limit of the one-window build.

Notes:

- The load average was 6 to 12 during the run, mostly from the macOS indexer (`knowledgeconstructiond`, about 54 % CPU). `output_main` went back to 60.0 per s when the window was restored, while the load stayed high. The cause is not known. One possible cause is App Nap: when the only window is minimized, the app has no visible window. This was not checked.
- VMC send was 296 datagrams per s in front, 235 minimized, and 228 after the restore. VMC receive was 59.2, 46.8, and 45.6 packets per s. Both stayed low after the restore, so this check does not attribute their change to the minimized state.
- This was a dev build. A release build was not measured.

### Camera tracking

MediaPipe was not measured. In this dev build the camera request failed with `NotAllowedError`, and macOS did not show a camera prompt. The merge did not change the camera configuration. Camera tracking with the window minimized is unknown.
