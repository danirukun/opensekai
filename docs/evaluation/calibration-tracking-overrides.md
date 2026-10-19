# Calibration and tracking overrides check (B6)

Date: 2026-10-19. Contract: [calibration and tracking overrides](../../spdd/prompt/2026-10-18-calibration-tracking-overrides.md). Issues: #21 (TRK-04 subset), #22 (TRK-05 first subset), #24 (TRK-07 calibration part).

## Setup

- **Platform.** Linux cloud container (Ubuntu, x86_64), no GPU, no macOS, no OBS, no phone, no webcam, no VMC application. Node 26.10.0, pnpm 12.8.1, rustc 1.93.1.
- **Commit.** The head of `claude/b6-calibration-overrides-impl` named in the pull request.
- **Fixtures.** `fixture_vrm_1`, `fixture_vrm0_arkit`, and `fixture_glb_stage` were ready (`fixtures:` line of setup). This slice uses no fixture model.
- **Browser.** Playwright Chromium from `/opt/pw-browsers`, headless. The editor check mounted the real `Inspector` on a real session and a real editor model in a temporary Vite page. The page was not committed.
- **Samples.** All samples are mock samples. They prove the math and the editor flow. They do not prove the look with a real phone, a real camera, or OBS.
- **Session clock.** The headless page has no Rust host, so the browser client's `tracking.submit` has no session clock. The page sends the mock MediaPipe samples to `session.ingestTracking` and calls `session.advance` each 50 ms, and it gives the frame `trackingStatus` to the Inspector. This is the same session path after the host. The `tracking.submit` path itself is not checked here.

## Results

| Check | Requirement | Result |
| --- | --- | --- |
| TypeScript and Rust accept a source with `calibration` and `mapping` and an avatar with `fingersSourceId`; reject 0 or 7 entries, a bone outside the set, a non-unit quaternion, each mapping limit, a non-ARKit key, an iFacialMocap or missing finger source; the fixture with and without the fields round-trips in both languages with no added `null` | R1, R2, R8, R9, R12, O1 | PASS. `packages/contracts/test/tracking-overrides.test.ts` (4 tests), `crates/contracts/tests/tracking.rs` (`b6_*`, 2 tests), `fixtures/protocol/tracking-overrides.json`. Rust writes `0` as `0.0`; the Rust test compares numbers by value. |
| Capture takes only the six bones; apply makes the neutral identity, skips another space, leaves other bones; 30° after 10° reads 20°; MediaPipe chest and head: `chest' × head'` equals `inverse(chestN × headN) × (chest × head)` within 1e-6, and the world face reads 30° when the chest does not move | R4, O2 | PASS. `packages/session/test/tracking-overrides.test.ts`, `calibration`. |
| Head intensity 0, 0.5, 1, 2 on 40° (0°, 20°, 40°, 80°); 2 on 130° gives 260° about the same axis; offset `[0, 15, 0]` gives `[0, sin 7.5°, 0, cos 7.5°]`; `[10, 15, 0]` equals `qY(15°) × qX(10°)`; eye intensity; range 0.2..0.8 (0.5 → 0.5, 0.1 → 0, 0.9 → 1); output max 0; sensitivity 2 clamps; `eyeBlink_L` and `eyeBlinkLeft` share a range and keep their names; linked blink; default mapping is identity | R10, O3 | PASS. Same file, `mapping`. |
| Composer order (calibration, mapping, fade); a stale source fades the mapped value; MediaPipe head and chest composition with a calibrated chest; the finger source gives finger bones only; a left-hand-only finger sample keeps the body's right fingers; no live finger input falls back to the body; two avatars with own finger sources | R4, R10, R13, O4 | PASS. Same file, `composer`. |
| `calibrateTracking` writes one revision and the captured value; fails with the source ID before the first `advance`, on a stopped source, on a sample 601 ms old, on an old generation, on a sample with no calibration bone, and with `setTrackingConfig` or `removeEntity` for the source in the same patch; a second capture replaces; `setTrackingConfig` keeps it except a MediaPipe mirror change; `removeEntity` of a finger source clears the slot; the share rule covers the finger slot; one source in body and finger slots of one avatar passes | R3, R5, R12, R14, O5 | PASS. Same file, `session calibrateTracking` and `session finger slot`. |
| MediaPipe retargeter: a first face matrix turned 30° reads 30°; a face along the camera axis reads identity; expression clamp | R6, O6 | PASS. `apps/desktop/test/tracking-retarget.test.ts`. The new test fails on the old retargeter (`expected +0 to be close to 0.2588`). |
| Mapping draft parse; `sourceOptions` with `'fingers'`; the finger ID stays when the body changes | R11, R15, O7 | PASS. `apps/desktop/test/tracking-overrides-fields.test.ts` (6 tests). |
| Editor, headless: Calibrate disabled while the source waits, enabled while it receives; Calibrate then Reset each change the revision by 1 and Reset goes away; a Head intensity change and a jawOpen row change each commit one `setTrackingMapping`; the second character's Fingers and Body selects disable `camera` and `vmc-a` (the first character's finger and body sources) | R7, R11, R15, O7 | PASS (headless). No page errors. [Waiting](calibration-tracking-overrides/waiting.png), [calibrated](calibration-tracking-overrides/calibrated.png), [Face group](calibration-tracking-overrides/face-group.png), [Fingers select](calibration-tracking-overrides/fingers-select.png). |
| MCP `scene_patch` names the operations; `calibrateTracking` on a source with no sample returns `INVALID_INPUT` with the source ID; `setTrackingMapping` and `setTrackingCalibration` save | R16, O8 | PASS. `apps/mcp/test/calibration.integration.test.ts` (real stdio process and real session, as the other MCP tests). |

## Gaps

- The raw head offset (iFacialMocap, VMC) turns about the parent axes of the sender's head node. It is not checked against a real sender.
- The neutral is one smoothed sample. With smoothing off, a noisy frame becomes the neutral.
- A MediaPipe head now has no first-frame neutral. When the camera is not in front of the user, the head looks turned until the user calibrates.
- Not checked (owner on macOS): Calibrate with an iPhone (iFacialMocap) makes a straight-ahead head neutral, and it stays after an app restart with the saved show; Calibrate with a physical webcam (MediaPipe) does the same for the head and the upper body; head intensity, head offset, a blend shape range, sensitivity, and linked blink look correct on a perfect sync VRM in the preview and in OBS with alpha; MediaPipe fingers with a VMC body on one character; continued motion while the editor is minimized. These results are unknown.
