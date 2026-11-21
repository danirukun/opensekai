# Bouncy Live2D motion analysis

Date: 2026-11-21. Issue: [#294](https://github.com/danirukun/opensekai/issues/294). Design: [bouncy Live2D motion](../../docs/superpowers/specs/2026-11-21-bouncy-live2d-motion-design.md). Plan: [bouncy Live2D motion plan](../../docs/superpowers/plans/2026-11-21-bouncy-live2d-motion.md). Gap: [VPoyo gap 2](../../docs/vpoyo-gaps.md).

## Problem

VPoyo moves a VRM like a Live2D model. The upper body sinks when the chin drops and the jaw opens. It rises again when the chin comes up. OpenSekai has no such motion. The Face-Only Body Motion template turns and leans the body, but it does not move the body up and down.

## Current state

- The bone offset layer holds rotation only. `AvatarPose.boneOffsets` and the `offsetBone` effect have no translation and no scale.
- `tracking.pendulum` shows the pattern for a stateful node: plain data in node state, steps of at most 16 ms, and a read of the previous pose.
- `character.offsetBones` skips a bone that a body or finger source covers.
- The Face-Only Body Motion template has the Warudo chains and the graph variables for body follows head and Pendulum Intensity.
- The renderer and the VMC send compose the pose from the same `AvatarPose` data.

## Decisions

1. The owner chose Blueprint nodes and the template (design decision O6). The session owns the spring. No renderer runs a second spring.
2. The effect works on a face-only character (O1). The bounce writers skip a bone that a body source covers.
3. The bounce moves the spine and the chest on local Y, and scales them uniformly with the same spring (O2, O3). Hips stay.
4. The drive is a weighted sum of head pitch and `jawOpen` (O4). Chin down and jaw open give a negative value (sink).
5. The effect adds to the other outputs of the template (O5).
6. The controls are two graph variables, `Bouncy Motion` (default false) and `Bouncy Intensity` (default 0.5). There is no new Inspector row and no new MCP tool.
7. The bone offset layer grows to translation (`boneTranslations`) and uniform scale (`boneScales`). The contracts in TypeScript and Rust change together.
8. The VMC send applies translation. It does not apply scale, because the VMC pose has no scale. This is a known difference.

## Effects

- Contracts: two pose fields; three node definitions (`tracking.bouncySpring`, `character.offsetBoneTranslation`, `character.offsetBoneScale`); template variables.
- Rust: the pose mirror and its checks.
- Session: the spring module, three evaluators, the writers of the bone layer, the VMC send pose.
- Renderer: the pose apply step adds translation and scale on the raw bones.
- Template: the Face-Only Body Motion graph gets the optional bouncy chain. A saved graph of the older template stays valid and has no bounce.
- Graph tick budget: the template counts 24 effects. The limit is 64.

## Risks

- The spring gains are a builder choice. Mitigation: unit tests, and a check in OBS at 60 FPS.
- A bone scale can invert a mesh in a bad graph. Mitigation: the scale clamp 0.5 to 1.5 in the evaluator, the pose schema, and the Rust check.
- A VMC receiver does not show the squash. Mitigation: record it as a known difference.
- The look at 60 FPS in OBS is not checked yet. Mitigation: the OBS check is Task 9 of the plan.

## Out of scope

Bounce with a body source. New avatar fields. Eye jiggle (#295). Controls for spring bones (#14). Hips or root bounce. A node that hides the spring and the writers.
