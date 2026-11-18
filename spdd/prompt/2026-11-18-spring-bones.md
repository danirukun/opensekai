# REASONS: Spring bones

Date: 2026-11-18. Scope: bundle B43 (#14 CHR-08, first subset). Analysis: [spring bones](../analysis/2026-11-18-spring-bones.md). Design: [spring bones design](../../docs/superpowers/specs/2026-11-18-spring-bones-design.md). Plan: [implementation plan](../../docs/superpowers/plans/2026-11-18-spring-bones.md). Evidence: [spring bones check](../../docs/evaluation/spring-bones.md) (checks 1 to 5; `TELEPORT_LIMITS` stays the same after the checks). Changes: the secondary motion rule of the [architecture design](../../docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md) and of the [minimum live VTubing contract](2026-10-03-minimum-live-vtubing.md).

The owner approved D1 to D3 on 2026-11-18. D4 to D12 are the design calls C1 to C9 and the builder choices; the owner can change each one in review. V1 to V4 are reversible choices of this contract.

## Decisions

| # | Decided | Rejected alternative |
| --- | --- | --- |
| D1 | Each renderer runs the same fixed-step spring solver. The session owns the inputs: the pose, the session time, and a reset count for each avatar | The session runs the solver and streams joint rotations; both modes |
| D2 | Design for 2 to 3 avatars and a later relay to about 100 clients from one Rust hub. No spring data on the wire | The local editor and OBS only |
| D3 | A scaled avatar scales its joint and collider values | A reset on a scale change |
| D4 | The three-vrm 3.5.5 solver, with no patch | The flat typed-array prototype |
| D5 | Step length 1/60 s, counted with the frame `tick` | The frame time step of each renderer |
| D6 | Reset after more than 15 due steps | Step through any gap |
| D7 | Teleport limits 0.1 m, 30°, and a scale ratio of 1.25 in one tick | A reset on each operator edit |
| D8 | `springResets` is a frame field | A field of `AvatarPose` |
| D9 | Interpolate the posed skeleton | Interpolate the `AvatarPose` data |
| D10 | No controls | Wind, gravity, and per-chain settings in this bundle |
| D11 | A fast gizmo drag can reset the hair on each commit | A whip on each commit |
| D12 | `springResets` has at most 2 entries, because a scene has at most 2 avatars | 8 entries |

### Interpretations (reversible)

| # | Chosen | Alternative |
| --- | --- | --- |
| V1 | A humanoid bone that is also a spring joint keeps the spring result, also on a frame with no step (R9) | The pose wins |
| V2 | The scale for D3 is the mean of the 3 axis scales of the avatar root (R13) | The largest axis scale |
| V3 | A model change keeps the count. The renderer resets because it installs a new binding (R5) | The count goes back to 0 |
| V4 | The due steps of a frame with a reset use the current record at fraction 1 (R7) | Interpolate from the record before the reset |

## Constants

| Name | Value | Use |
| --- | --- | --- |
| `SPRING_STEP_SECONDS` | 1/60 | The solver step length |
| `SPRING_MAX_STEPS` | 15 | More due steps than this give a reset |
| `TELEPORT_LIMITS.metres` | 0.1 | A larger root move in one tick is a teleport |
| `TELEPORT_LIMITS.degrees` | 30 | A larger root turn in one tick is a teleport |
| `TELEPORT_LIMITS.scaleRatio` | 1.25 | A larger root scale ratio in one tick is a teleport |
| `springResets` limit | 2 | The number of avatar entities in a scene |

## R — Requirements

### Schema

R1. `SpringResetSchema` is a strict object `{ avatarId: Id, count: integer 1..Number.MAX_SAFE_INTEGER }`. `RuntimeFrame` gets `springResets?: SpringReset[]`, with at most 2 entries and each `avatarId` one time. TypeScript (zod) and Rust accept and reject the same shapes, with the shared vectors in `fixtures/protocol/spring-resets.json`:
- accept: one entry; two entries;
- reject: a duplicate `avatarId`; count 0; count 1.5; count −1; three entries; a missing `count`; an unknown field.

R2. Rust omits the field when it is missing. A frame without a reset count has no field.

### Session

R3. The root world transform of an avatar is the entity transform times `pose.root`, or the entity transform when the avatar has no pose. Position: `T + R · (S ⊙ p)`. Rotation: `R · q`. Scale: the mean of the absolute axis scales of the entity.

R4. A teleport is a change between two frames of more than `TELEPORT_LIMITS.metres` in position, more than `TELEPORT_LIMITS.degrees` in rotation (`2 · acos(|q1 · q2|)`), or more than `TELEPORT_LIMITS.scaleRatio` in the scale ratio (larger to smaller or smaller to larger). A value equal to a limit is not a teleport.

R5. The session keeps the last root world transform, the asset ID, and the count of each avatar entity. The count goes up by 1 only when a previous value exists, the asset ID is the same, and R4 finds a teleport. A new avatar and an avatar with a changed asset get no count change; the count stays. A removed avatar leaves the state. The frame lists each avatar with a count above 0, in scene order.

### Renderer: time grid

R6. Step k is at session time `k × 1000 / 60` ms. A frame with `tick = k1` after a frame with `tick = k0` has the due steps k0 + 1 to k1. The renderer resets and runs no step on its first frame, on a new `sessionId`, when `k1 < k0`, and when more than `SPRING_MAX_STEPS` steps are due. With no due step, the solver does not run.

R7. When the reset count of the avatar changes, the renderer resets, then runs the due steps of that frame on the current record (V4).

### Renderer: solver input

R8. After `apply` and `place`, the stage records the local position, rotation, and scale of the instance root, the motion node, and each raw humanoid bone that is not a spring joint. For due step k, it sets these nodes to the interpolation between the previous record (frame time `t0`) and the current record (frame time `t1`) at `clamp((k × 1000/60 − t0) / (t1 − t0), 0, 1)`, or 1 when `t1 = t0`: slerp for rotations, lerp for positions and scales. Then it runs one step. After the last step, it sets the current record again. A reset removes the previous record.

R9. A raw humanoid bone that is also a spring joint keeps the last spring result. On a frame with no step, the stage writes that result again, because `apply` reset the bone (V1).

### Renderer: solver

R10. `createSpringRig(vrm)` returns null when the model has no `springBoneManager` or no joints. Otherwise it calls `setInitState()` one time, while the skeleton is at rest, and returns `{ joints, reset, step, setScale }`. `step(seconds)` calls `springBoneManager.update(seconds)`. `reset()` calls `springBoneManager.reset()`. Nothing calls `vrm.update`.

R11. For each avatar in each frame, the order is `apply`, `place` (or the editor drag transform), then `advanceSprings`, in the frame path and in the install path. `advanceSprings` runs also when the editor skips `place`.

R12. An avatar without a pose in the frame gets its due steps. Its record is the rest pose and the root transform.

### Renderer: scale

R13. The rig keeps the file values: `hitRadius`, `stiffness`, and `gravityPower` of each joint, and `radius` of each sphere and capsule collider shape. Before the steps, the stage calls `setScale(s)` with s the mean of the absolute axis scales of the instance root (V2). `setScale` sets each value to the file value times s, and does nothing when s did not change. Drag does not change.

### Renderer: warnings

R14. The loader gives no warning for `VRMC_springBone`. It keeps "VRMC_node_constraint simulation is disabled in renderer". For a file that uses `VRMC_springBone_limit`, it gives the `UNSUPPORTED` warning "VRMC_springBone_limit is not supported; spring bones move without limits".

### Documents and evidence

R15. The architecture design and the minimum live VTubing contract get the secondary motion rule of the design, in the first commit of this bundle.

R16. `ARCHITECTURE.md` describes the teleport count (tracking path, compose), the spring stage (tracking path, render), and the loader warnings (asset path, load).

R17. `docs/evaluation/spring-bones.md` records the acceptance checks 1 to 5 of the design, with the commit, the backend, the quality profile, and the asset IDs. CHR-08 in `docs/warudo-parity.md` becomes Partial: VRM-authored spring bones in the editor and OBS; controls, collisions with other objects, `VRMC_springBone_limit`, and non-uniform scale Later. `docs/vpoyo-gaps.md` gap 1 changes to match.

R18. The bundle claims no result that it did not measure. An unavailable measurement is unknown.

## E — Entities

- Contracts: `SpringResetSchema`, `SpringReset`, `RuntimeFrame.springResets`; Rust `SpringReset { avatar_id, count }` and `RuntimeFrame.spring_resets: Option<Vec<SpringReset>>`.
- Session (`packages/session/src/spring-resets.ts`): `TELEPORT_LIMITS`, `RootSample`, `avatarRoot`, `isTeleport`, `SpringResetState`, `advanceSpringResets`.
- Renderer: `spring-grid.ts` (`SPRING_STEP_SECONDS`, `SPRING_MAX_STEPS`, `SpringClock`, `SpringPlan`, `planSpringSteps`); `spring-pose.ts` (`PoseSample`, `capturePose`, `applyPose`); `spring-rig.ts` (`SpringRig`, `createSpringRig`); `spring-stage.ts` (`createSpringStage`); `createAvatarBinding(...).advanceSprings`; `extensionWarnings` in `assets.ts`.
- No new patch operation, entity kind, property key, limit, quality profile, or MCP tool.

## A — Approach

Documents first. Then the contract in TypeScript and Rust with shared vectors, because the host rejects an unknown frame field. Then the session teleport count. Then the pure renderer parts (step plan, record), the rig, and the stage with the renderer and loader changes. Then the acceptance checks on the owner's Mac and the evidence.

## S — Structure

- `spdd/analysis/2026-11-18-spring-bones.md`, this file; `docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md`; `spdd/prompt/2026-10-03-minimum-live-vtubing.md`.
- `fixtures/protocol/spring-resets.json` (new); `packages/contracts/src/schema.ts`, `types.ts`; `crates/contracts/src/lib.rs`; `packages/contracts/test/spring-resets.test.ts` (new); `crates/contracts/tests/spring_resets.rs` (new).
- `packages/session/src/spring-resets.ts` (new), `session.ts`; `packages/session/test/spring-resets.test.ts` (new).
- `packages/renderer/src/spring-grid.ts`, `spring-pose.ts`, `spring-rig.ts`, `spring-stage.ts` (new); `avatar-pose.ts`, `renderer.ts`, `assets.ts`; `packages/renderer/test/spring-grid.test.ts`, `spring-pose.test.ts`, `spring-rig.test.ts`, `spring-stage.test.ts`, `spring-warnings.test.ts`, `spring-fixture.ts` (new); `avatar-pose.test.ts`.
- `ARCHITECTURE.md`; `docs/evaluation/spring-bones.md` (new); `docs/warudo-parity.md`; `docs/vpoyo-gaps.md`.

## O — Operations

1. Contract and vectors (R1, R2).
2. Session teleport count (R3 to R5, R16 compose).
3. Step plan and record (R6 to R8).
4. Rig and scale (R10, R13).
5. Stage, binding, renderer, and warnings (R7 to R14, R16 render and load).
6. Acceptance checks on the owner's Mac (design checks 1 to 5), the evidence, and the parity rows (R17, R18).

## N — Norms

- Unit tests for the schema and its Rust mirror, the teleport rule, the step plan, the record, the rig scale, the warnings, and the stage (determinism, fewer frames, reset, scale, no `vrm.update`, no spring data, a humanoid joint, the same frame twice). No test for static copy.
- Functional TypeScript and plain data. No new dependency. No three-vrm patch.
- Long prose is Simplified Technical English. No UI change.

## S — Safeguards

- Do not call `vrm.update`. Do not call the spring manager outside the rig.
- Do not send spring joint data on the wire.
- Do not change the limits, the quality profiles, the benchmark fixture, the show file version, or the property registry.
- Do not change how a model without spring joints draws.
- Do not write a cost, OBS, or look result that was not measured. Write an unavailable measurement as unknown.
