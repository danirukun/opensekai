# FaceKit tracking check (B33)

Dates of the runs: 2026-11-13 and 2026-11-15. Scope: TRK-24, bundle B33 ([#260](https://github.com/danirukun/opensekai/issues/260)). Contract: [FaceKit tracking on macOS](../../spdd/prompt/2026-11-11-facekit-macos-tracking.md). Design: [FaceKit tracking on macOS](../superpowers/specs/2026-11-11-facekit-macos-tracking-design.md). Feasibility facts: [FaceKit feasibility check](facekit-feasibility.md).

This record gives the platform verification of the FaceKit source in OpenSekai. The feasibility record gives the facts about the private framework. This record does not repeat them.

## Platform and build

- **Host.** MacBook Pro Mac15,6 (Apple M3 Pro), macOS 27.2 (26B123).
- **Camera.** Built-in FaceTime HD Camera. The host camera list also had OBS Virtual Camera, VCam, NDI Virtual Camera, and Makusu Camera.
- **Framework.** AppleCVA 1003.0.4. The host log line was "FaceKit API version 42".
- **Build.** Debug dev build (`tauri dev`) at `33e74eb`, started from Terminal.app. Terminal.app is the responsible process for the camera permission. The Open Settings layout fix `517945a` changes only `apps/desktop/src/components/TrackingSourceFields.svelte`. It was checked live through a Vite update on 2026-11-15.
- **Avatar.** The Catboy ARKit VRM, with the FaceKit Tracker as its face source.
- **Tools.** MCP (`scene_inspect`, `scene_patch`, `app_status`) for state changes and state reads. The OBS WebSocket at `ws://127.0.0.1:4455` for the OBS check. The owner was at the camera and reported the camera light and the avatar.
- **Not recorded.** The renderer backend of the OBS browser source, the OBS version, and the quality profile.

## Apple-only boundary

- The source is opt-in. A new FaceKit source is disabled. The host loads AppleCVA only for an enabled FaceKit source.
- The host loads the private framework from the system at run time with `dlopen` by its absolute path. The build does not link AppleCVA. The app bundles no Apple file.
- Camera frames stay in the host process. The host sends only the face sample (the head and the expressions) and the status in the clock message. No frame goes through Tauri IPC or to the webview.
- OpenSekai does not read or store identity data (`identity_coefficients`, `face_id`, a faceprint). This record does not say that FaceKit stops its identity computation (see the feasibility record).
- The Inspector shows "Uses a private macOS API. It can stop after a macOS update."

## Live checks

All checks passed. The table gives each check and its result. Times are from the MCP state logs unless the text gives another source.

| Check | What was done | Result |
| --- | --- | --- |
| Add menu and receiving | The owner added "FaceKit Tracker" from the Add menu, chose FaceTime HD Camera, and set it as the Catboy face source. | The state was `receiving`. At the check: 7609 samples, inference time 3.9 to 4.0 ms, 6 invalid callbacks. The owner said: "everything seems to work really well". |
| Hidden Editor window | The Editor window was hidden for about 6 s. | Tracking samples +162 and the `output_main` sequence +318 in that time. The `preview_main` preview stopped, as the hidden-window throttle expects. |
| Shutdown and camera release | The owner quit the app (SIGTERM path of `tauri dev`). | The camera light went off. |
| OBS continuity | A script made an isolated OBS scene with a browser source on the OpenSekai output and took 480-pixel source screenshots. It started and stopped the FaceKit source 3 times through MCP `scene_patch`, 6 s apart. A "hold" is the time that the output image did not change. | 6926 samples, mean interval 7 ms. Baseline maximum hold 24 ms over 5.0 s. Maximum hold from −0.5 s to +3 s around each change: starts 23, 40, 37 ms; stops 36, 35, 40 ms. Overall maximum 40 ms. The script restored the program scene ("Scene") and removed its scene and input. No stream or recording started. |
| No face before the first face | The source started with no face in front of the camera. | The state stayed `waiting` for 61 s. The invalid count rose to 1686 (about 28 each second). The state became `receiving` at +61.0 s. |
| Lost face | The owner covered the camera after the source was `receiving`. | The state became `stale` at +64.4 s. The owner saw the avatar go to the neutral expression. |
| Camera change | With MediaPipe off, the camera changed from FaceTime HD Camera to OBS Virtual Camera, then back, through MCP. | OBS Virtual Camera: `waiting` 0.6 s after the change, with no-face callbacks only. The owner saw the FaceTime light go off and come on again. Back on FaceTime HD Camera: `receiving` 1.7 s after the change. |
| Second source and takeover | A second enabled FaceKit source on the same camera was added while the first ran. Then the first source was stopped. | The second source had `error` "FaceKit used by FaceKit Tracker" 0.4 s after the add, and it did not open the camera. After the stop of the first source, the second source was `waiting` in 0.5 s and `receiving` 1.6 s later. |
| MediaPipe with FaceKit | A MediaPipe source and the FaceKit source used the FaceTime HD Camera at the same time, with the app in front. | FaceKit: `receiving`, 30.0 faces each second, 4.0 ms. MediaPipe: `receiving`, 27.3 faces each second, 11 ms. Screenshot: [FaceKit and MediaPipe in one scene](facekit-tracking/facekit-and-mediapipe.png). |
| Unavailable library | Debug build with `OPENSEKAI_FACEKIT_LIBRARY=/missing`. Start. | The state was `unavailable` 0.7 s after the start. The Inspector showed "unavailable" and "FaceKit library not found" in red, and the private-API line. No camera prompt came, and no other tracker started. Screenshot: [unavailable](facekit-tracking/unavailable.png). |
| Denied permission and Open Settings | After `tccutil reset`, Start showed the macOS camera prompt. The owner chose Don't Allow. | The state was `permissionNeeded` 2.1 s after the start (shown as "permission needed"), with the Open Settings button. Open Settings opened the Camera pane of System Settings. The owner then allowed Terminal again. |
| Open Settings layout (`517945a`) | The owner found the runtime row (Stop, state, Calibrate, Open Settings) too narrow: Open Settings went past the Inspector edge. The fix puts the button on its own line. | After the fix, "permission needed" is on one line, Open Settings is on its own line under the row, and nothing goes past the Inspector edge. Screenshots: [before](facekit-tracking/permission-needed-before-fix.png), [after](facekit-tracking/permission-needed-layout-fix.png). |

The first OBS run stopped when the app quit during the run, and the script did not clean up. The OBS scene was restored by hand (program "Scene", the test scene and input removed). The script was then changed: it uses a lock for the OBS requests, and it stops the sampler first. The table gives the second run.

The 6 invalid callbacks in the first check are not explained by a test. The adapter smoke run (below) had 4 no-face callbacks at the start of the run.

### Adapter smoke run

`apps/desktop/src-tauri/examples/facekit_smoke.rs` ran the macOS adapter alone on 2026-11-13 at 20:54. This was before the review commits `bf54230` to `33e74eb`. It is not a result for `33e74eb`.

| Run | Result |
| --- | --- |
| 10 s | First face at about 3 s. 185 faces at 10 s, inference time 3.8 to 4.2 ms. The drop of the run took 70 ms. No event after the drop. The camera light went off. |
| Stop after 200 ms | The drop took 976 ms, during the start. No event after the drop. The camera light went off. |
| `OPENSEKAI_FACEKIT_LIBRARY=/missing` | `Unavailable("FaceKit library not found")` at 0 ms. No prompt and no camera light. |
| `--device bogus` | `CameraFailed("Camera not found")` at 16 ms. No camera light. |

These drop times are the reason for the FaceKit worker: the publisher frame loop must not wait for a camera stop or start.

## Linux

Linux aarch64 container, Ubuntu 24.04, rustc 1.93.1, source at `33e74eb`. The macOS adapter is not compiled. The stub adapter runs.

| Command | Result |
| --- | --- |
| `cargo test --workspace --no-fail-fast` | Exit 0. 534 passed, 0 failed, 3 ignored. Ignored: `loads_applecva_and_creates_a_tracker` ("FaceKit needs macOS"), `pinned_fixture_benchmark_cancel_replay_stale_timer_summary_and_history` (needs local pinned smoke fixtures), `youtube_live_gate` (needs the network). The 23 `tracking::facekit` unit tests (with `stub_reports_unavailable`), `facekit_update_is_in_the_snapshot`, and `facekit_config_and_states_round_trip` passed. |
| `cargo clippy --workspace --all-targets -- -D warnings` | Exit 0. |

The run script also counted the lines that contain "facekit" in the test log (26). These lines are the 25 test names and one test binary name. The count is not a check of the binary symbols.

## Findings not fixed here

1. **Revision guard after a session restart (pre-existing).** After a session restart with a lower revision (for example a Vite reload), `TrackingManager` skips each scene with `scene.revision <= life.revision` (`apps/desktop/src-tauri/src/tracking/mod.rs`, the reconcile). A tracking source then stays `waiting` and does not start. Stop and Start do not help. An app restart repairs it. This also applies to the UDP trackers. The same check is on `main` at `8dea8a3`. A follow-up issue must make the guard use the session too.
2. **MediaPipe in a window behind another window.** With the app window behind Terminal, MediaPipe fell to about 1 face each second (WebView throttle). FaceKit stayed at about 30 each second.
3. **"Patterns take too long." when the Editor is inactive (pre-existing, B18).** The [after](facekit-tracking/permission-needed-layout-fix.png) screenshot shows this alert under Hidden cameras with the default list. It came after a Vite update while the window was inactive (preview 8 FPS). The match deadline is 100 ms (`MATCH_DEADLINE` in `apps/desktop/src/tracking/hidden-cameras.ts`). The [before](facekit-tracking/permission-needed-before-fix.png) screenshot (active window, 60 FPS) has no alert.
4. **Vite dependency reload (development only).** The first MediaPipe use in this worktree made Vite optimize `@mediapipe/tasks-vision` and reload the WebView. The session started again at revision 0, which caused finding 1.

A Cmd+Q took more than 20 s. The owner said that a dialog for an unsaved show was open. This was not a shutdown delay.

## Unknown

- Windows: not run. The result is unknown, not zero. The stub adapter compiles and runs on Linux only.
- Other macOS versions (14 through 26 and later than 27.2) and Intel Macs.
- External cameras. The OBS Virtual Camera was used only for the camera change, and it gave no face.
- More than one face. This is future work.
- The side of each head axis on the avatar was not recorded one by one. The unit tests check the five measured rotations. The owner judged the tracking on the avatar as a whole.
- A notarized Developer ID build and the legal scope of the Apple developer agreement (see the feasibility record).
- The OBS renderer backend, the OBS version, GPU time, and OBS timing other than the hold times above.
- CPU use of the FaceKit source in the app.
