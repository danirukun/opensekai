# Analysis: normalized tracking bones on a VRM 0 character

Date: 2026-11-10. Scope: a defect of the pose composition. Found in the macOS acceptance of #283 ([evidence](../../docs/evaluation/vrm0-tracking-axes.md)). Related: [default avatar idle](../prompt/2026-10-04-default-avatar-idle.md), [VMC sender](../prompt/2026-10-21-vmc-sender.md).

## Problem

1. On a VRM 0 character, a tracked bone in the `normalized` space turns the wrong way about the X and Z axes. With MediaPipe and a webcam, arms that hang down show above the head, a nod down shows as a look up, and a head tilt goes to the wrong side. A turn about Y is correct. The same movements are correct on a VRM 1 character.
2. The sources do not know the VRM version of the character. The MediaPipe retargeter, the iFacialMocap parser, and the eye bones from blend shapes all make rotations with the VRM 1 axes: the character looks to +Z and its left side is +X.
3. three-vrm keeps the normalized bones of a VRM 0 model in the frame of the model, which looks to −Z. A rotation `(x, y, z, w)` with the VRM 1 axes is `(−x, y, −z, w)` in that frame. The renderer makes this change for the idle base bones and for the bone offsets, but not for the tracked bones. The idle contract kept the tracked bones in the frame of the rig, and no source makes values in that frame.

## Decision

- **A `normalized` bone has the VRM 1 axes, from each source.** The renderer changes the rotation to `(−x, y, −z, w)` and the position to `(−x, y, −z)` for a VRM 0 model, as it does for the base bones. `vmcSendPose` repeats the change. Alternative: each source makes values for the VRM version of its character. Rejected: a source can drive a character of each version, and the host parsers do not have the model.
- **A `raw` bone does not change.** A VMC receiver sends the local rotation of the bone of the model, which is already in the frame of the rig.
- **No change of the show file or of a wire contract.**

## Risks

- A source whose signs were set by eye on a VRM 0 character now turns the wrong way on that character. The code of the MediaPipe retargeter, the iFacialMocap parser (a change of handedness only), and the eye bones shows no such sign. iFacialMocap needs a check on a VRM 0 character with a phone.
- A show does not store tracked values, so no saved data changes.
