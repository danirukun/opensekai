# Start screen check

Checked 2026-11-15 on macOS 27.2.1 (Apple silicon) in the Tauri debug app from `pnpm dev:desktop`, source commit `3670acf`. OBS 33.0.1 (obs-websocket 5.7.6, 1920 × 1080 at 60) used an isolated QA scene and browser source made by the local QA helper (`obs.mjs`). The QA scene was on program only during the OBS captures. Teardown restored the program scene `Scene`. Streaming and recording stayed off. Contract: [start screen](../../spdd/prompt/2026-11-15-start-screen.md).

Method. The app was driven with mouse clicks and key presses through System Events. Window captures came from `screencapture`. OBS captures came from `GetSourceScreenshot`. The recent list was read from `~/Library/Application Support/com.oshi-connect.opensekai/settings/recent-shows.json`. That file did not exist before the check.

## Results

| Check | Requirement | Result |
| --- | --- | --- |
| Fresh launch | R1, R2 | PASS. The Scene pane showed the logo, `Add character`, `Open show… ⌘O`, the `Templates` heading with `Stage Lights`, and the close control. There was no `Recent` heading, because the list file did not exist. |
| Template load | R5 | PASS. `Stage Lights` replaced the scene (5 lights and effects, Camera, Floor; 7 assets). The show name became `Stage Lights`. The start screen closed. Command+S opened the Save sheet with `Stage Lights.osekai`. |
| Recent list | R6, R7 | PASS. After a save to a `QA Shows` folder, the list file held that one absolute path. After a relaunch, `Recent` showed `Stage Lights` with the folder `QA Shows`. A click opened it, and the next Command+S wrote the same file without a sheet. |
| Missing recent file | R7, Safeguards | PASS. After the file was deleted and the app relaunched, a click on the entry showed the toast "Show file could not be opened". The list file became `{"shows":[]}`, the `Recent` heading went away, and the scene stayed `Untitled Show` with 2 assets. The start screen stayed open. |
| Add character | R3 | PASS. A click added `Character`, selected it, closed the start screen, and opened the "Import VRM avatar" chooser. The Catboy QA avatar (`DaniruKun - Catboy - ARKit.vrm`) loaded as "Catboy with black hoodie". |
| Escape | R2, R9 | PASS. Escape closed the start screen. The preview drew the default scene, and the frame-rate monitor showed 60 FPS. |
| OBS output | R9 | PASS. With the start screen up, the OBS capture was fully transparent (alpha maximum 0). 1 s after the `Stage Lights` click, the OBS capture showed the stage (alpha mean 0.43), and it was the same 3 s later. OBS reported 0 skipped output frames. With the QA scene on program, the OBS capture showed Catboy on a transparent background. |

## Not measured

- Whether OBS reloaded the browser source page. The check shows only that OBS kept drawing the output.
- A release build, Windows, and keyboard-only navigation through the start screen.
- The time from a template click to the first OBS frame below 1 s.
- The OBS browser source does not draw while its scene is not shown. The first two OBS captures were taken while the QA scene was not on program, and they were transparent for that reason. The OBS results above come from captures with the QA scene on program.
