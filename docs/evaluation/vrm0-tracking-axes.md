# VRM 0 tracking axes check

Checked 2026-11-10 on macOS on branch `fix/vrm0-tracking-sign`, base `a78b27a`. Contract: [VRM 0 tracking axes](../../spdd/prompt/2026-11-10-vrm0-tracking-axes.md).

- Machine: MacBook Pro (Mac15,6), Apple M3 Pro, 36 GB, macOS 27.2 (26B123). OBS 33.0.1, one Browser Source in an isolated scene, no stream.
- App: `pnpm dev:desktop` (debug build) with `OPENSEKAI_EVALUATION=1`, started from Terminal (which has the camera permission). Backend WebGPU, OBS source `production_v1`.
- Tracker: the FaceTime camera with MediaPipe (face and upper body, hands off, mirror on). The owner did the movements, with spoken cues.
- Models: VRM 0 `fixture_vrm0_arkit` (sha256 `7b7c689e…`) and the VRM 1 sample `fixture_vrm_1`.

## Before the change

Seen in the macOS acceptance of #283, whose build has the pose code of `main`.

| Movement of the owner | VRM 0 character | VRM 1 character |
| --- | --- | --- |
| Chin down on the chest | Looks up | Looks down |
| Look up at the ceiling | Looks down | Looks up |
| Tilt of the head to the left shoulder | Tilts to the right of the screen | Tilts to the left of the screen |
| Turn of the head to the left | Turns to the left of the screen | Not measured |
| Arms down, hips in view | Arms above the head: left upper arm −60° to −78° in the VMC Sender output, where the idle pose with the arms down is +55° | Not measured |

Images: [head](vrm0-tracking-axes/macos-obs-head-before.jpg) (first row VRM 0, second row VRM 1; chin down, look up, tilt), [arms](vrm0-tracking-axes/macos-obs-arms-before.jpg) (VRM 0; the first five captures are with the arms of the owner down).

An offline run of the real retargeter with a pose that has the arms down gives a left upper arm of −84° about Z in the normalized space, which is the direction of the idle base bone (−55°). The sent pose of a VRM 0 rig kept −84°, and the base bone became +55°.

## After the change

One OBS capture for each hold ([image](vrm0-tracking-axes/macos-obs-head-after.jpg): first row VRM 0, second row VRM 1; chin down, look up, tilt to the left shoulder, turn to the left).

| Movement of the owner | VRM 0 character | VRM 1 character |
| --- | --- | --- |
| Chin down on the chest | No look up. The angle is small in this capture | Looks down |
| Look up at the ceiling | Looks up | Looks up |
| Tilt of the head to the left shoulder | Tilts to the left of the screen | Tilts to the left of the screen |
| Turn of the head to the left | Turns to the left of the screen | Turns to the left of the screen |

The VRM 0 character now moves as the VRM 1 character does. The VRM 1 character did not change.

## Checks

| Command | Result |
| --- | --- |
| `pnpm check` | 10 packages and `tsconfig.scripts.json`: pass. svelte-check: 0 errors, 0 warnings |
| `pnpm test:unit` | 1978 passed, 1 skipped (228 files). Base: 1976 passed |
| `pnpm test:integration` | 77 passed, 0 failed, 4 skipped |
| The 4 changed tests on the old code | Failed: the VRM 0 sign and the arms in `avatar-pose.test.ts` (2 tests) and in `vmc-send.test.ts` (2 tests) |

No Rust file changed, and the Rust checks were not run.

## Not checked

- The arms and the torso lean after the change. The camera did not track the arms in the standing part of the check, and the owner stopped there. The unit tests cover the arms (hands below the shoulders on a VRM 0 and a VRM 1 rig).
- iFacialMocap on a VRM 0 character. Its head and eye bones use the same normalized path, and the parser makes a change of handedness only. A phone check is necessary before the merge.
- The eye bones from blend shapes, the finger bones of MediaPipe hands, and Windows.
