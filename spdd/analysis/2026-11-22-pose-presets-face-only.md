# Analysis: Pose presets for face-only tracking

Date: 2026-11-22. Issue [#296](https://github.com/danirukun/opensekai/issues/296).

## Problem

Face-only streamers need upper-body poses (rest, selfie, wave, mic, controller) while the head and torso still follow the face. VPoyo exposes this as a Pose tab. OpenSekai has Face-Only Body Motion and idle, but no Warudo-like overlay / hand pose / hand pin stack.

## Warudo

Override Hand Poses (finger shapes), Idle + Overlaying Animations (masked clips, transition time), Body IK (pin hands). Wave is an animation, not a hand pose.

## Decision

Mirror those three character Animation controls. Built-in overlay bone libraries (wave = short loop). No clip import in this slice. Hand Pin in the first PR.

## Hand targeting (follow-up)

Per-joint Z curl replaces chain-total degrees. Left hand mirrors as `[x,-y,-z]` (YXZ sagittal). Pinch shapes use measured tip closure on Rem and Catboy. Compose emits a pose when animation is active without idle/tracking; enabled hand bones join Face-Only mask skips.
