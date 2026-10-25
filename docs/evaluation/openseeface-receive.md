# OpenSeeFace receive check (B20)

Date: 2026-10-25. Scope: TRK-08 first subset, bundle B20 ([#25](https://github.com/danirukun/opensekai/issues/25)). Contract: [OpenSeeFace receive](../../spdd/prompt/2026-10-21-openseeface-receive.md). Analysis: [OpenSeeFace receive](../../spdd/analysis/2026-10-21-openseeface-receive.md). Base commit: `86686e0` plus the B20 implementation branch changes.

## Setup

- **Platform.** Linux cloud container (Ubuntu, x86_64), no GPU, no macOS, no OBS, no webcam, no OpenSeeFace tracker. Node 26.10.0, pnpm 12.8.1, rustc 1.93.1.
- **Tracker source.** OpenSeeFace `master` at `50c0974` (`tracker.py`, `facetracker.py`, `Unity/OpenSee.cs`, `Unity/OpenSeeIKTarget.cs`), read for the record layout and the head frame. The tracker was not run.
- **Records.** All records are hand-built by `scripts/openseeface-packet.ts` or by the Rust test helper. The checked-in record `fixtures/protocol/openseeface-one-face.bin` is one face that looks straight at the camera, with both eyes open and MouthOpen 0.5. No record holds camera data.
- **Browser.** Playwright Chromium from `/opt/pw-browsers`, headless, 1280 × 800.

## Results

| Check | Requirement | Result |
| --- | --- | --- |
| TypeScript and Rust accept an `openseeface` source; `defaultTrackingConfig('openseeface')` is `127.0.0.1`, `11573`, no sender, stopped; an unknown field (`phoneAddress`) is rejected; the source is accepted in the face slot and rejected in the body and finger slots, in both languages through the shared vectors | R1, R2 | PASS. `packages/contracts/test/live-tracking.test.ts`, vectors `openseeface-face-source`, `openseeface-body-source`, `openseeface-fingers-source` in `fixtures/protocol/validation-vectors.json` (`crates/contracts/tests/vectors.rs`, `packages/contracts/test/schema.test.ts`). |
| Decoder: 1 to 4 records are valid; 0, 1784, 1786, and 8925 bytes are invalid; a NaN feature, an infinite eye value, or a NaN quaternion is invalid; a usable quaternion of length 0.4 or 2.1 is invalid and one of 1.5 is normalized; a failed fit (success 0, zero quaternion) is valid and keeps the sample; the lowest usable face ID wins; each of the 15 ARKit names and each clamp; steepness is not mapped; no eye bones and no root | R4, R5, R6 | PASS. `tracking::parser::openseeface_tests` (9 tests). |
| Head frame: identity facing the camera; a 30° turn to the performer's left turns the avatar face toward its left (+X, 0.5); 20° up gives +Y 0.342; a 15° tilt to the left moves the top of the head toward +X (0.259); a mixed pose matches the matrix path within 1e-5 | R6 | PASS. Same tests. The records come from a port of the tracker's `matrix_to_quaternion` on the solvePnP rotation for each pose. |
| Head frame against OpenCV: the tracker model, projected for a known pose, swapped to (row, column), solved with `cv2.solvePnP` (OpenCV 5.0.0), and converted, gives the pose back for identity, yaw 30° left, pitch 20° up, roll 15° left, and a mixed pose | R6 | PASS on a square image (matrix error below 1e-7). [Script](openseeface-receive/axis-check.py), [output](openseeface-receive/axis-check.txt). On a 4:3 image the neutral reads 9.5° off; see Gaps. |
| Endpoint plan: two `openseeface` sources with two sender addresses share one endpoint; a third with no sender address gets "Endpoint used by"; a VMC source on the same port does not join | R3 | PASS. `tracking::endpoints::tests::two_openseeface_senders_share_one_endpoint_and_a_third_without_address_conflicts`. |
| Real UDP boundary: the checked-in 1785-byte record sent to the bound endpoint reaches the credited publisher clock as a normalized identity head and `jawOpen` 0.5 with no root; a 1000-byte datagram then gives `invalidPackets: 1`, `packets: 2`, state `receiving` | R3, R4, R6 | PASS. `tracking_integration::openseeface_record_reaches_credited_clock_and_bad_length_is_invalid`. |
| MCP: `scene_patch` creates an `openseeface` source through the shared schema; `setAvatarTracking` with it as the body source is rejected (`INVALID_INPUT`); as the face source it commits | R2, R9 | PASS. `apps/mcp/test/calibration.integration.test.ts` (real stdio process and real session). |
| Editor units: Add label, group label and order, face-only source options (body and fingers exclude it), `parseTrackingConfig` writes `senderAddress`, the draft reads it, reset field IDs | R2, R8 | PASS. `apps/desktop/test/authoring.test.ts`, `asset-groups.test.ts`, `live-fields.test.ts`, `property-defaults.test.ts`. |
| Editor, headless: Add › OpenSeeFace Receiver; the defaults; the group "OpenSeeFace Receivers"; Bind address, Port, Sender address with no phone or computer address; Apply commits the sender address; Start shows `waiting` and Calibrate is disabled; after a record the state is `receiving`, Calibrate is enabled and saves a head neutral in one revision; the Face source select lists the source and the Body source select does not; choosing it commits | R2, R3, R7, R8 | PASS (headless), 14 pass, 0 fail, no page error. [Script](openseeface-receive/editor-check.mjs), [output](openseeface-receive/editor-check.txt). Screenshots: [waiting](openseeface-receive/waiting.png), [receiving](openseeface-receive/receiving.png), [face source](openseeface-receive/face-source.png). |

**Editor method.** The `vite preview` build of `apps/desktop` at `http://127.0.0.1:4173/?view=editor`, with the stand-in host of the B18 and B19 checks: the operator WebSocket goes to a real `@opensekai/session`. The stand-in does not decode UDP. It reports `waiting` for the enabled source, and after the "send" step it reports `receiving` and gives the session the sample that the Rust integration test reads from the checked-in record. The UDP decode is proven by the Rust integration test, not by this check.

## Handbook

The [Warudo OpenSeeFace page](https://docs.warudo.app/docs/mocap/openseeface) was read for the contract on 2026-10-21. Warudo runs the tracker inside the app and has its own sensitivity settings. This subset receives from a tracker that the operator starts, and it uses the B6 face mapping for sensitivity (contract R10).

## Gaps

- **Neutral offset.** The tracker solves the pose with the principal point at (width/2, height/2) on swapped (row, column) landmarks. On a 4:3 camera the solvePnP check reads 9.5° away from identity for a face that looks straight ahead. A real face also has its own neutral. **Calibrate** removes both. Without a calibration the head looks a little turned.
- **Left and right.** The eye values and the features are taken as the performer's right and left, as in `OpenSee.cs`. This is not checked with a real face.
- Not checked (owner on macOS): a real OpenSeeFace tracker and webcam; the direction of the head for a turn, a nod, and a tilt; the blink and mouth sides; Calibrate with a real face; the look in the preview and in OBS with alpha; continued motion while the editor is minimized. These results are unknown.
- Windows is not checked.
