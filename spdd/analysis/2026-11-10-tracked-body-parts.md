# Tracked body parts and body movement intensity analysis

Date: 2026-11-10. Scope: #22 TRK-05, slice 2. Slice 1 (B6) gave saved calibration, a head rotation offset, and a finger source next to a body source ([analysis](2026-10-18-calibration-tracking-overrides.md)).

## Problem

1. **A character takes each bone that its sources send.** A webcam source gives arm and torso estimates that are wrong when the performer sits at a desk, and a full-body VMC sender moves legs that the show does not need. The operator cannot keep one part on the idle pose. Warudo has Tracked Body Parts for this (named in the out-of-scope list of slice 1).
2. **The torso motion has one fixed strength.** A small lean of the performer gives a small lean of the character. Warudo has Body Movement Intensity. A stage show needs more motion than a desk stream, with the same tracker.

## Current state

- `createTrackingComposer().evaluate` (`packages/session/src/tracking.ts`) makes one `AvatarPose` for each character from its body, face, and finger sources, after smoothing, the position rule, calibration, and the face mapping.
- The renderer applies `baseBones` (idle) first and then each bone of `bones`. A bone that is not in `bones` keeps the idle pose or the rest pose.
- `AvatarTracking` holds the three source IDs. `setAvatarTracking` replaces it.
- After a calibration, the neutral pose of hips to head is the identity rotation, so a scale of a torso rotation is a scale about the neutral pose.

## Decisions

- **The settings are on the character, not on the source.** A character mixes up to three sources, and the operator thinks about the parts of the character. `AvatarTracking` gets one optional group `body` with `movementIntensity` and `trackedParts` (constitution principle VII: one JSON group). A missing group means intensity 1 and all parts, which is the current behavior. Alternative: a group on each tracking source; rejected, because two sources can give one part.
- **Eight parts:** `head` (neck, head, eyes, jaw), `body` (hips, spine, chest, upper chest, and the root motion), `leftArm` and `rightArm` (shoulder to hand), `leftFingers` and `rightFingers` (the 15 finger bones of a hand), `leftLeg` and `rightLeg` (upper leg to toes). The Warudo handbook was not reachable from the run that wrote this slice, so the part list follows the bone groups that the composer already uses (face bones, finger bones) and the humanoid chains. The owner can correct the list in review; the list is data in one place.
- **A part that is not tracked sends no bone.** The composer drops the bones of the part from `bones`, and drops `root` when `body` is not tracked. The idle pose or the rest pose then shows on that part. Face expressions (blend shapes) do not belong to a part and stay.
- **Body Movement Intensity scales the rotations of the `body` part** (hips, spine, chest, upper chest) about the identity, 0 to 2, with the shortest-arc scale that the head intensity uses (`scaleRotation`). Positions and the root do not change: a hips position is absolute in VMC, and a scale would change the height of the character.
- **Order.** The part filter and the intensity run after the source mix and before the stale-fade weight is written, so they act on the bones that the character gets, from whichever source.
- **Normal form.** The scene drops a `body` group that is equal to the default, and stores `trackedParts` in the fixed part order without duplicates, so equal settings give equal scenes and fingerprints.
- **The VMC sender needs no change.** It sends the pose that the session made, so it sends the filtered pose.

## Effects

- An operator can turn parts off for each character and set the torso strength, in the Inspector, with MCP `scene_patch` (`setAvatarTracking`), and in the show.
- The wire API gets one optional group on `AvatarTracking`. Old shows load without change. No new patch operation.

## Risks

- A part that goes off during a performance changes the pose in one tick, with no fade.
- With `leftArm` on and `body` off, the arm follows the tracker on an idle torso. This is the wanted behavior for a desk stream, but a raw-space VMC arm can look different on a moving idle torso.
- Checked with mock samples only. The look with a physical tracker stays unknown until the owner checks it.

## Out of scope

Head translation, Body Rotation Type (the Upper Body Rotation template of B5 covers the first form), a fade when a part changes, intensity for arms or legs, VMC retargeting changes, Quick Calibration on the character, and the physical camera check of TRK-07.
