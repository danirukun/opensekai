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

## SelfReflect gates (S3)

Commit: ea2ea3c, plus the position rule in the S3 commit. Backend: webgpu. Quality profile: preview_v1 (Scene window) and production_v1 (OBS page). Date: 2026-10-26. Platform: macOS, worktree dev build (`pnpm dev:desktop`) in fixture mode (`OPENSEKAI_FIXTURE_MANIFEST`, fixture `smoke_v1`). Sender: SelfReflect on the performer's iPhone, live VMC over the home network to port 39539. The replay fixture `fixtures/tracking/selfreflect-replay.json` (66a7a0a) gave the numbers for gate 1 only. It did not give a gate result (R7).

The shared asset library holds avatar records with a `rig` field. This branch skips those records when it loads the library, so it showed no library avatar (see the concerns below). Runs A and B therefore used `fixture_vrm_1` (VRM1 Constraint Twist Sample, no ARKit shapes). From run C on, the character is Catboy (`avatar_7b7c…`, VRM0 with perfect-sync ARKit shapes and eye bones), which the performer imported again at the Mac. The `reference` box gave HTTP 400 in the first fixture-mode session. The cause was the QA setup: the manifest file was in a different folder from the fixture files, and the registry serves files only below the manifest folder. A self-contained folder fixed it at the next start. It is not a product defect.

### Gate 1, positions: fail, then pass with the fix

| Run | Result | Evidence |
| --- | --- | --- |
| Run B, source with all positions (no rule) | Fail. With the SelfReflect source on, the character left the camera view at each step. With the source off, Catboy stands in the view. | `16-gate1-source-on-character-gone.png`, `25-runB-try-it-character-gone.png`, `17-gate1-source-off.png` |
| Run C, source with `positions: 'rotationsOnly'` | Pass. Catboy stays in the frame with the feet on the floor, and the arms follow the performer with no broken joints. | `18-gate1-rotations-only-wide.png`, `22-obs-arms-smoothing-a-to-d.png` |

The replay fixture shows why the positions break the pose:

- `Hips` y is −0.64 m to −0.80 m (+1.0 m only in the T-pose frame), and z is −0.40 m to −0.51 m. The Catboy hips rest height is 0.9375 m, so the character sinks below the floor.
- `LeftHand` and `RightHand` are on a centimeter scale: ±67.7, 143.5, −6 in the T-pose frame, and 20 to 36, −59 to 18, −36 to −73 later.
- Every other bone position is (0, 0, 0), and the root position is always 0.

The selected rule is `rotationsOnly`. `hipsOnly` would keep a hips height on a different scale from the character, and the Relax step has no hips neutral to remove it. The SelfReflect preset sets the rule (S3 R2). The guide connect plan writes the preset rule for a new or a disabled source, and an enabled source that the guide uses again keeps its own rule, as for smoothing (ruling R22). Run C created source `69dfadee…` with `positions: 'rotationsOnly'` from the preset.

### Gate 2, stalls: pass

From 20:23:45 to 20:25:45, `tracking_probe` read the source 1184 times (10 Hz). Each read gave `receiving`. There was no state change, so there are no stall time stamps. The On Tracking Lost graph (`after` 2 s, Show Toast) was running and showed no toast. Because no stall occurred, the composer had no stale state and did not fade toward neutral. No frame-by-frame visual review of this window was done. The stale hold (S3 R4) is not added.

This window used SelfReflect's in-app smoothing before the performer set it to its lowest value at about 20:25:50.

### Gate 3, smoothing: defaults kept

The runner changed the source smoothing with `setTrackingSmoothing`, the same patch that the inspector sends. It used labels that a toast showed to the performer, 20 s each, in two rounds (20:40:08 to 20:42:49). SelfReflect's in-app smoothing was at its lowest. The labels are minCutoff / beta / derivativeCutoff:

| Label | Values | Face channel step at rest (eyeBlinkLeft, browInnerUp, mouthSmileLeft; mean of the quietest 25 % of 1 s windows, rounds 1 and 2) |
| --- | --- | --- |
| A (default) | 5 / 0.5 / 1 | 0.0045 to 0.0046, 0.0013 to 0.0014, 0.0005 to 0.0015 |
| B | 8 / 2 / 1 | 0.0016 to 0.0035, 0.0007 to 0.0013, 0.0004 to 0.0006 |
| C | 12 / 4 / 2 | 0.0026, 0.0000 to 0.0005, 0.0000 to 0.0005 |
| D | smoothing off | 0.0000 to 0.0022, 0.0000 to 0.0009, 0.0000 to 0.0002 |

The performer selected A: it had the least arm lag with no visible jitter at rest. At rest, the face channels move less than 0.005 for each 100 ms step with every label, so the probe shows no jitter difference that a viewer can see. The probe does not read bone rotations, so the bone jitter is unknown. The SelfReflect preset keeps the default smoothing, and its test does not change (S3 R5).

Earlier, the performer had set the source to 5 / 1.601 / 0.57 by hand. The source was set back to A after the run.
