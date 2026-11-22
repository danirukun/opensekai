# Pose presets for face-only tracking (#296)

Status: **pending OBS**. Unit and editor model checks exist on this branch. Do not mark the VPoyo gap or Warudo parity items Done until the macOS OBS checklist below has evidence.

## Code checks (done)

- Contracts: `AvatarAnimation` schema, `setAvatarAnimation` patch, Rust round-trip.
- Session: overlay libraries (including wave loop), hand poses, hand pin, `composeAvatarAnimation`, Face-Only writer skip via `animationMaskedBones`.
- Blueprint: `character.setOverlayPose`, `character.setHandPose`, `character.setHandPin`; Pose Hotkeys template (Control+Option+1..5).
- Editor: Animation Inspector section; `setAvatarAnimation` on the editor model.

## OBS checklist (pending)

Record backend, quality profile, fixture VRM revision, and commit. Keep app timing and OBS timing separate. An unavailable measurement is unknown, never zero.

1. Face-only character: head and chest still follow face tracking while an overlay (selfie or rest) holds the arms.
2. Switch overlay A→B over `overlayTransitionSeconds`: continuous blend, no snap.
3. Wave overlay: continuous motion while the editor is minimized (session clock).
4. Override Hand Poses with High Priority: tracked fingers replaced; High Priority off leaves tracking.
5. Hand Pin hold: wrists stay near pin targets while head yaw changes about ±30°.
6. Transparent OBS output: arms and hands visible with alpha as expected for the fixture.
