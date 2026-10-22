# Tracking setup walkthrough evaluation (TRK-23)

## Guide (S2)

Commit: 112f3a5. Backend: webgpu. Quality profile: preview_v1. Fixture: `fixtures/tracking/selfreflect-replay.json` at 66a7a0a. Date: 2026-10-21. Platform: macOS, worktree dev build (`pnpm dev:desktop`).

### Method

A `tsx` script in the scratchpad sent OSC bundles over UDP to 127.0.0.1:39539 every 33 ms. It did not use a phone. The base frame is packet 1 of the fixture. On top of the base frame, the script set these synthesised values:

| Pose | Values |
| --- | --- |
| Blink | eyeBlinkLeft and eyeBlinkRight 0.93 |
| Open your mouth wide | jawOpen 0.187 (run 1), 0.6 (runs 2 and 3) |
| Raise your brows | browInnerUp 0.314 |
| Smile | mouthSmileLeft and mouthSmileRight 0.278 (run 1), 0.5 (run 3) |
| Frown | mouthFrownLeft and mouthFrownRight 0.25 (run 1), 0.5 (runs 2 and 3) |
| Pucker your lips | mouthPucker 0.4 (run 1), 0.6 (runs 2 and 3) |
| Puff your cheeks, Stick out your tongue | cheekPuff and tongueOut 0, with eyeWideLeft and eyeWideRight + 0.03 · sin(4t) so that other channels change |
| Look around | LeftEye and RightEye bone rotation about Y of 15° · sin(1.5t), no eyeLook channel |
| Try it | jawOpen 0.6 |

Run 3 sent all the expression values at the same time after the relax step. A script that reads the guide heading through accessibility was too slow to follow each step in runs 1 and 2. The character is `avatar_qa` with the Catboy asset (ARKit shapes and eye bones, no `eyeBones` flag in the asset record). MCP `scene_inspect`, `tracking_probe`, and `app_status` gave the scene and tracking data.

### Results

| Check | Result | Evidence |
| --- | --- | --- |
| The guide docks in the properties column | Pass | `01-entry-set-up-tracking.png`, `02-pick.png`, `08-try-it-mouth-full.png` |
| Connect shows the home network address first | Pass (after the fix in 112f3a5) | `03-connect-waiting.png` |
| The scene stays at full size | Pass. The Scene window keeps its full canvas while the guide is open in the Editor window. | `09-scene-full-size-guide-open.png` |
| The coach moves | Pass when the Editor window is visible. The two frames differ in the eye region. WebKit stops animation frames and CSS transitions in a hidden window. | `05-blink-coach-open.png`, `05-blink-coach-closed.png` |
| cheekPuff and tongueOut skip by themselves | Pass. Both steps ended without Skip. The fit gave no range for these channels. | `10-puff-cheeks-auto-skip.png`, `10-tongue-out-auto-skip.png` |
| Look around with eye bones only shows Next and the checkbox | Pass | `07-look-around-next.png` |
| The Look around checkbox sends one `setTrackingMapping` | Pass. Revision 4 to 5 (`useEyeBones` false), then 5 to 6 (true). The other mapping fields did not change. | `07-look-around-eye-bones-off.png` |
| The fit writes the ranges | Pass. Run 3: jawOpen 0.187 to 0.54, mouthPucker 0.198 to 0.54, smile, frown, blink, and browInnerUp ranges. Run 1 gave no jawOpen range because 0.187 is less than 0.05 above the base frame (0.167). | `08-try-it-run1-jaw-not-fitted.png` |
| In Try it the character opens its mouth fully | Unknown. The Mouth meter is full (jawOpen 0.6 maps to 1). The replayed body pose bends the head down, and the hoodie collar hides the mouth. The screen locked before a closer camera check. | `08-try-it-mouth-full.png`, `11-camera-replay-body-pose.png` |
| Done sends no patch | Pass. Revision 7 before and after Done. | — |
| Close restores the old state | Pass before the fit: run 2 closed at Look around, and the scene entities were equal to the entities before the run. An unmount (a hot reload) also removed the created receiver. Close after the fit: unknown in the running app. | — |
| A restart of the sender brings tracking back with no steps | Pass. The replay stopped (state `stale`) and started again (state `receiving`). The revision did not change and the guide did not open. | — |
| Save and reopen keep the tracking | Unknown. The screen locked before this check. | — |
| The inspector checkbox shows checked with no `useEyeBones`, and a change survives a reopen | Unknown. The screen locked before this check. | — |

The camera render in `11-camera-replay-body-pose.png` shows the character low in the frame with the head bent down. This comes from the hips and head bones of the fixture frame. The guide does not change bones.
