# Analysis: Spring bones

Date: 2026-11-18. Scope: bundle B43, issue #14 (CHR-08, first subset). Contract: [spring bones](../prompt/2026-11-18-spring-bones.md). Design: [spring bones design](../../docs/superpowers/specs/2026-11-18-spring-bones-design.md). Plan: [implementation plan](../../docs/superpowers/plans/2026-11-18-spring-bones.md).

## Request

Issue #14 asks for hair and spring-bone simulation. The parity row CHR-08 says "First benchmark subset; full controls Later". The owner wants the spring bones of the model to move in the editor and in the OBS output, first to check the Roro avatar fix from another session. The design must stay efficient with 2 to 3 avatars. It must also fit a later plan: one origin Rust hub sends the live scene to about 100 client devices, and each device renders the scene.

## Sources

| Source | What it gives | Status |
| --- | --- | --- |
| [Spring bones design](../../docs/superpowers/specs/2026-11-18-spring-bones-design.md) | Goals, decisions O1 to O3, calls C1 to C9, the design, and the verification | Approved by the owner on 2026-11-18 |
| [Research evidence](../../docs/evaluation/spring-bones/research/README.md) | Joint counts, solver cost, frame-rate dependence, convergence, and the fewer-frames measurement | Measured on 2026-11-18 on the owner's Mac |
| @pixiv/three-vrm-springbone 3.5.5 source | `VRMSpringBoneJoint.update` reads `settings` on each step and calculates the bone length on each step. `calculateCollision` reads the shape `radius` on each step and does not scale it. `reset()` puts the tail at the rest position under the current parent | Read on 2026-11-18 |
| VRM specification and vrm-c/UniVRM#2411 | The reference algorithm has no fixed step. Drag applies once for each step | Read on 2026-11-18 |

## Current state

- The loader builds `vrm.springBoneManager`, but nothing calls its `update`. The loader gives the warning "VRMC_springBone simulation is disabled in renderer" (`packages/renderer/src/assets.ts:149`).
- `createAvatarBinding(vrm)` (`packages/renderer/src/avatar-pose.ts`) builds `root → motion → vrm.scene`. `apply(pose)` resets the raw humanoid bones, applies the pose, the offsets, and the expressions, and updates the world matrices. A test checks that it never calls `vrm.update`.
- The renderer calls `apply`, then `place` (the entity transform, scale included) for each avatar in each frame (`renderer.ts:384-388` and `:402-406`). The editor skips `place` for an entity that the operator drags.
- The session sets `tick = floor(elapsedMs × 60 / 1000)` (`session.ts:516`). `elapsedMs` does not go back in one session. The host asks for a frame at 60 Hz and skips late ticks.
- The frame has `avatarPoses` (at most 2). A scene has at most 2 avatar entities (`schema.ts:294`). The Rust mirror rejects unknown frame fields.
- The architecture design and the minimum live VTubing contract say that the session settles spring-bone state and that a renderer must not run spring bones separately.

## Decisions

### Owner (2026-11-18)

| # | Decision | Rejected alternative |
| --- | --- | --- |
| O1 | Each renderer runs the same fixed-step spring solver. The session owns the inputs | The session runs the solver and streams joint rotations; both modes (kept as a later option) |
| O2 | Design for 2 to 3 avatars and for a later relay to about 100 client devices from one Rust hub | The local editor and OBS only |
| O3 | A scaled avatar scales its joint and collider values (C8) | A reset on a scale change, and correct spring bones only at scale 1 |

O1 changes an architecture rule. This bundle amends the architecture design and the minimum live VTubing contract in its first commit.

### Integrator (2026-11-18)

The design calls C1 to C9 apply as written. In short:

| # | Call |
| --- | --- |
| C1 | Use the three-vrm solver |
| C2 | Step length 1/60 s, counted with the frame `tick` |
| C3 | Reset after more than 15 due steps |
| C4 | Teleport limits 0.1 m, 30°, and a scale ratio of 1.25 in one tick |
| C5 | `springResets` is a frame field, not a part of `AvatarPose` |
| C6 | Interpolate the posed skeleton, not the `AvatarPose` data |
| C7 | No controls |
| C8 | Scale the joint and collider values with the avatar, with no three-vrm patch |
| C9 | A fast gizmo drag can reset the hair on each commit |

The builder choices of the design are set here:

- `springResets` has at most 2 entries, because a scene has at most 2 avatars.
- The record and the step state live in a small stage object next to the avatar binding.
- The teleport function is `advanceSpringResets` in `packages/session/src/spring-resets.ts`.
- The Rust mirror is `SpringReset { avatar_id, count }`. The shared vectors are in `fixtures/protocol/spring-resets.json`.
- One pull request with small commits in the plan order. The contract commit lands before the session emits the field.

### Interpretations (reversible)

| Item | Chosen meaning | Alternative |
| --- | --- | --- |
| A humanoid bone that a VRM 0.x bone group also lists as a joint | The spring result wins. The stage keeps the last result and writes it again on a frame with no step, because `apply` resets the raw bone | The pose wins, and the joint does not move |
| Scale for C8 | The mean of the 3 axis scales of the avatar root | The largest axis scale |
| Model change | The session keeps the count. The renderer resets, because it installs a new binding | Reset the count to 0 |
| A frame with a reset and due steps | The steps use the current record at fraction 1 | Interpolate from the record before the reset |

## Cost

- Solver time for one 60 Hz step with 3 heavy avatars (about 920 joints): 0.38 ms mean in JavaScriptCore and 0.45 to 0.50 ms mean in V8, from the research. The target is 1 ms or less.
- The record is about 55 bones and 2 roots for each avatar. The interpolation is one lerp and one slerp for each node and each step.
- No new data on the wire except `springResets`, which has an entry only after a teleport.
- The renderer cost inside WKWebView and the OBS browser source is not measured yet. Task 7 measures `FrameApplied.cpuMs`.

## Risks

- **Gizmo drag.** A fast drag can reset the hair on each commit (C9). The acceptance check records what the hair does.
- **Teleport limits.** Live tracking can be faster than the expected half of each limit. The acceptance check uses live tracking. A change of a limit goes into the contract with its reason.
- **JIT shape.** One V8 process that first ran 7 models was 3 times slower for the same 3 avatars. The stage must not add avoidable polymorphism.
- **Non-uniform scale.** It gives an approximate result. This is a known limit.

## Out of scope

- Spring bone controls: wind, gravity overrides, per-chain settings, and an on/off switch.
- Collision with other characters, props, or the floor (CHR-09).
- `VRMC_node_constraint` and `VRMC_springBone_limit`. Both give a warning.
- A third posed avatar.
- Spring bones in the VMC sender.
- The relay and the hub.
