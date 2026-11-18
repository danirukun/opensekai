# Face-only body motion analysis

Date: 2026-11-18. Design: [face-only body motion](../../docs/superpowers/specs/2026-11-18-face-only-body-motion-design.md). Reference: [Warudo face reference](../../docs/evaluation/warudo-face-reference/README.md).

## Problem

With a face source only, the head moves and the body stays still. Warudo moves the whole body from the head: the body turns with the head, the body leans, and the arms, hands, and fingers sway on pendulum chains. The owner wants the same result in OpenSekai, made from a Blueprint graph that the user can see and change.

## Current state

- The session compose step (`packages/session/src/tracking.ts`) smooths, calibrates, and maps each source, then mixes the body, face, and finger sources into one `AvatarPose` for each character. It applies a stale fade (full weight to 500 ms, 0 at 750 ms).
- The procedural idle (`idle.ts`) turns the chest on slow sine waves and puts the arms down.
- Blueprint nodes can read one bone rotation of the previous pose (`character.getBoneRotation`) and write one bone offset (`character.offsetBoneRotation`). Offsets on one bone multiply (`writeBoneOffset`). `previousPose` has no offsets.
- `math.smoothDamp` and `vector3.smoothDamp` exist and keep node state.
- No face source gives a head position. The iFacialMocap parser reads 6 head values and keeps 3. The MediaPipe face matrix has a translation that `retarget.ts` does not use. The renderer applies a `position` of a normalized bone, so a head position on the `head` bone would move the head.
- The "Upper Body Rotation" template turns chest, spine, and hips from head yaw (0.6, 0.4, 0.3).
- A graph has at most 128 nodes and 256 connections. A show has at most 8 graphs.
- The tracking guide applies scene patch operations. Graphs change through the Blueprint edit channel (`createGraph`, `removeGraph`).

## Decisions

1. A graph on top of the compose step (owner choice). The compose step does not change, except that it passes the head position on.
2. The head position is a new optional field `headPosition` on `TrackingSample` and `AvatarPose`, relative to a calibrated neutral. It is not a bone position, so the renderer does not apply it.
3. Three new nodes: `tracking.getHeadPose`, `tracking.pendulum`, `character.offsetBones`. The pendulum keeps its input list and arm list in settings, as Warudo does. One `character.offsetBones` node has one output group (bones, axis, intensity, offset); the template uses one node for each Warudo output group.
4. The pendulum chain model is OpenSekai's own model, made from the Warudo parameter names and tuned by comparison. The head rotation unit of a pendulum input is one constant, set by a measurement in Warudo.
5. "Face-Only Body Motion" replaces "Upper Body Rotation" in the Templates menu (owner choice). Saved graphs of the old template keep working.
6. The tracking guide adds the template for a face-only assignment and removes it on Cancel.

## Effects

- Contracts: sample, pose, and calibration fields; three node definitions; two field kinds (`rows`, `bones`).
- Rust: the iFacialMocap decoder and the contract mirror of the sample and calibration.
- Session: compose step passes `headPosition`; three evaluators; a pendulum module.
- Editor: two field editors; Templates menu; guide plan and cancel.
- MCP: a template option on `blueprint_import`.

## Risks

- The pendulum look depends on tuning. Mitigation: a side-by-side check with Warudo and an owner look review.
- A large time step (a throttled hidden window) can make a spring chain unstable. Mitigation: steps of at most 16 ms.
- A body source added later can double the body motion. Mitigation: the skip rule in `character.offsetBones`.
- The head position units of iFacialMocap and MediaPipe are not known. Mitigation: unit tests on decoded values and a live check.

## Out of scope

Imported idle clips, the look-at-camera layer, the idle head animation, root and head translation from the head position, Blink Receptors, named pendulum profiles.
