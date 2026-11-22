# REASONS: Pose presets for face-only tracking

Date: 2026-11-22. Scope: [#296](https://github.com/danirukun/opensekai/issues/296). Analysis: [pose presets](../analysis/2026-11-22-pose-presets-face-only.md). Design: [pose presets](../../docs/superpowers/specs/2026-11-22-pose-presets-face-only-design.md). Plan: [pose presets plan](../../docs/superpowers/plans/2026-11-22-pose-presets-face-only.md).

## R — Requirements

R1. Avatar optional `animation: AvatarAnimation` with `overlayingPoses` (max 8, unique ids), `overlayTransitionSeconds` (0..5, default 1), `overrideHandPoses` (left/right), `handPin` (left/right). Patch `setAvatarAnimation` replaces the group.
R2. Overlay ids: `rest`, `selfie`, `wave`, `mic`, `controller`. Wave is a short procedural loop; others are held. Full overlay list; later list entry wins on overlapping bones.
R3. Hand pose ids include at least Open, Fist, Grab, Hold 1/2, Peace, Idle (Warudo-shaped set in contracts). Weight 0..1; High Priority over tracked fingers when set. Finger curls are per-joint degrees (Z curl); left mirrors as `[x,-y,-z]` in YXZ so thumb fold stays palm-side.
R4. Hand Pin `preset` | `hold` per hand; in the first PR with overlays and hand poses.
R5. Compose after tracking, before Blueprint bone offsets. Active overlay arm/finger bones and enabled hand-pose finger bones suppress Face-Only arm/finger pendulum writers for those bones (`animationMaskedBones`). Tracking still emits an avatar pose entry when overlay, hand pose, or hand pin is active even if idle and tracking are both off (`needsAnimationPose`).
R6. Inspector / hotkey / Blueprint switch paths; blend unit tests; saved in show.
R7. No Mixamo/AGIA import. No full Look At / foot IK. OBS evidence later; do not claim Done until checked.

## E — Entities

`AvatarAnimation`, `OverlayPoseEntry`, `HandOverride`, `HandPin`, `setAvatarAnimation`, overlay/hand libraries, compose runtime, Blueprint set nodes.

## A — Approach

Contracts first, then libraries, pin, compose, Blueprint, Inspector, docs.

## S — Structure

See plan file map.

## O — Operations

Tasks 1–8 of the plan.

## N — Norms

Constitution, pnpm, `direnv exec` for Rust, functional TypeScript, ASD-STE100 for long prose.

## S — Safeguards

Reject unknown pose ids and >8 overlays. Finite quats. High Priority only when enabled. Gap stays In progress until OBS check.
