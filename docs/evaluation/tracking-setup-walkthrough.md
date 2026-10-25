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
| The fit writes the ranges | Pass. Run 3: jawOpen 0.187 to 0.54, mouthPucker 0.198 to 0.54, smile, frown, blink, and browInnerUp ranges. Run 1 gave no jawOpen range because 0.187 is less than 0.05 above the base frame (0.167). In run 1 the mouth step ended as not sent because of the reducer rule for a main channel that does not change for 4 s while other channels change. The script held jawOpen constant, so this rule applied. The guide has no rule for a small rise. | `08-try-it-run1-jaw-not-fitted.png` |
| In Try it the character opens its mouth fully | Unknown. The Mouth meter is full (jawOpen 0.6 maps to 1). The replayed body pose bends the head down, and the hoodie collar hides the mouth. The screen locked before a closer camera check. | `08-try-it-mouth-full.png`, `11-camera-replay-body-pose.png` |
| Done sends no patch | Pass. Revision 7 before and after Done. | — |
| Close restores the old state | Pass before the fit: run 2 closed at Look around, and the scene entities were equal to the entities before the run. Close after the fit: unknown in the running app. | — |
| A restart of the sender brings tracking back with no steps | Pass. The replay stopped (state `stale`) and started again (state `receiving`). The revision did not change and the guide did not open. | — |
| Save and reopen keep the tracking | Unknown. The screen locked before this check. | — |
| The inspector checkbox shows checked with no `useEyeBones`, and a change survives a reopen | Pass at 2353f39. See the re-check below. | `12-inspector-eye-bones-default-checked.png`, `13-inspector-eye-bones-off-after-reopen.png` |

The camera render in `11-camera-replay-body-pose.png` shows the character low in the frame with the head bent down. This comes from the hips and head bones of the fixture frame. The guide does not change bones.

### Re-check after the review fixes

Commit: 2353f39. Backend: webgpu. Quality profile: preview_v1. Fixture: `fixtures/tracking/selfreflect-replay.json` at 66a7a0a. Date: 2026-10-25. Platform: macOS, worktree dev build. The scene started with `camera_main` and `light_main`. `avatar_qa` (Catboy) was revision 1.

Rule R15 replaces the earlier unmount result: an unmount of the guide stops the probe only. It does not cancel the run. Only the close button before Done cancels.

| Check | Result | Evidence |
| --- | --- | --- |
| The inspector checkbox shows checked for a source with no `useEyeBones` | Pass. Source `vmc_r2` (disabled, no mapping) at revision 2. The Face checkbox showed checked. One click sent one `setTrackingMapping` (revision 2 to 3, `useEyeBones` false, the other fields at their defaults). | `12-inspector-eye-bones-default-checked.png` |
| The checkbox value survives a reopen | Pass. The saved show had `"useEyeBones":false`. The live value was then set to true through MCP (revision 4). Open show loaded the file (revision 5, `useEyeBones` false), and the checkbox showed clear. | `13-inspector-eye-bones-off-after-reopen.png` |
| A rail panel switch keeps the guide at its step | Pass. At Look around, the rail went to Output, Blueprints, Resources, and back to Assets. The heading was still Look around. The revision stayed at 7 (the connect patch), so no cancel occurred. | `14-panel-switch-output.png`, `15-panel-switch-back-look-around.png` |
| The close button still cancels after a panel switch | Unknown. The screen locked before this check. | — |
| In Try it the mouth opens (face channels only) | Unknown. The screen locked before this check. | — |
| Save, reopen, and a replay restart keep the tracking with no steps | Unknown. The screen locked before this check. | — |
| Close after the fit restores the old mapping | Unknown. The screen locked before this check. | — |
