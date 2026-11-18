# Spring bones (hair and cloth secondary motion)

Date: 2026-11-18. Status: approved by the owner on 2026-11-18. Issue: [#14](https://github.com/danirukun/opensekai/issues/14). Parity: CHR-08 (first subset). Research evidence: [spring-bones research](../../evaluation/spring-bones/research/README.md).

## Intent

The VRM files of the owner have spring bones: hair, skirts, ribbons, tails, and accessories that swing when the character moves. OpenSekai loads this data but does not use it. The loader gives the warning "VRMC_springBone simulation is disabled in renderer" (`packages/renderer/src/assets.ts:149`). A character without secondary motion looks stiff. The VPoyo gap analysis lists this as gap 1 (`docs/vpoyo-gaps.md`).

The owner wants the spring bones of the model to move in the editor preview and in the OBS output. The first use is to check the Roro avatar fix from another session. The design must stay efficient with 2 to 3 avatars, and it must fit a later plan: one origin Rust hub sends the live scene to about 100 client devices, and each device renders the scene.

## Goals

1. The spring bones that a VRM 0.x or VRM 1.0 file defines move in each renderer: the editor (the preview and the viewport are one renderer instance) and the OBS page. The model's own parameters apply: stiffness, gravity, drag, hit radius, colliders, and center. An avatar with a uniform scale moves as a scaled copy of the same avatar at scale 1.
2. The motion does not depend on the frame rate of a renderer. A 30 fps OBS output, a 60 fps preview, and a later 120 Hz client show the same motion.
3. Two renderers that get the same session frames show the same spring pose. A renderer that gets fewer frames stays close (the targets are in Verification).
4. The session owns every input of the motion: the pose, the session time, and the reset signal. No spring data goes on the wire, so the design scales to many clients.
5. The OBS output keeps its motion while the editor is minimized.
6. The cost stays small: a target of 1 ms or less for each renderer for each 60 Hz step with 3 heavy avatars on the owner's Mac.

## Non-goals

- Controls. Warudo's Character asset page has no spring bone settings. Wind is a separate asset in Warudo. Wind, gravity overrides, per-chain settings, and an on/off switch are later slices ("full controls Later" in CHR-08).
- Collision with other characters, props, or the floor (CHR-09).
- `VRMC_node_constraint`. It stays disabled and keeps its warning.
- `VRMC_springBone_limit`. three-vrm 3.5.5 does not support it (open PR pixiv/three-vrm#1632). The loader gives a warning for a model that has it.
- A third posed avatar. The frame schema allows 2 avatar poses (`avatarPoses.max(2)`, `packages/contracts/src/schema.ts:491`). A raise is a separate contract change.
- Spring bones in the VMC sender. The VMC protocol sends humanoid bones only, and receivers run their own spring bones.
- The relay and the hub. This design only keeps them possible.

## Anti-goals

- Hair that moves differently in the preview and in OBS for the same session frames.
- Motion that changes with the frame rate (for example, more swing at 30 fps).
- A violent whip or a flip of the hair after the operator moves the character to a new place.
- A per-frame stream of spring joint rotations from the session to each renderer.

## Decisions made with the owner

| # | Decision | Rejected alternative | Date |
| --- | --- | --- | --- |
| O1 | Each renderer runs the same fixed-step spring solver. The session owns the inputs (option 2) | The session runs the solver and streams joint rotations (option 1); both modes (option 3), which stays a later option for clients that cannot simulate | 2026-11-18 |
| O2 | Design for 2 to 3 avatars and for a later relay to about 100 client devices from one Rust hub | Design for the local editor and OBS only | 2026-11-18 |
| O3 | A scaled avatar scales its joint and collider values (C8) | A reset on a scale change, and correct spring bones only at scale 1 | 2026-11-18 |

O1 changes an architecture rule. See "Architecture amendment".

## Research facts

All measurements are on the owner's Mac (Apple M3 Pro, macOS 27.2.1, Node v26.13.0), three 0.187.0, @pixiv/three-vrm 3.5.5 with the project patch. Raw output and scripts: [research](../../evaluation/spring-bones/research/README.md). The models are in the owner's asset library. They are not redistributable, so the evidence records counts and timings, not files.

### Joint counts of the owner's models

Joints are the bones that three-vrm simulates. Colliders and collision checks come from the file data.

| Model | VRM | Joints | Colliders | Collision checks per step |
| --- | --- | --- | --- | --- |
| RORO_vrm_arkit_02 (latest import) | 0.x | 30 | 3 | 60 |
| Catboy with black hoodie | 0.x | 56 | 22 | 1,012 |
| VRM1_Constraint_Twist_Sample | 1.0 | 57 | 13 | 529 |
| 止丸式初音ミクNT | 0.x | 214 | 7 | 698 |
| Nina | 0.x | 242 | 73 | 12,670 |
| Nemimi Yane | 0.x | 287 | 12 | 1,401 |
| Xiulang Long | 0.x | 395 | 52 | 4,586 |

Nina puts the same root bones in two bone groups, so two joints drive one bone. The VRM 1.0 specification forbids this, but three-vrm accepts it. The last joint wins.

### Cost

Spring solver time for one 60 Hz step, 3 heavy avatars together (Nina, Xiulang, Nemimi: about 920 joints, about 19,000 collision checks), one solver in each fresh process:

| Engine | three-vrm `springBoneManager.update` | Flat typed-array prototype | Skeleton pose (humanoid update and world matrices) |
| --- | --- | --- | --- |
| JavaScriptCore (macOS `jsc` shell) | 0.38 ms mean, 0.42 to 0.44 ms p99 | 0.30 ms mean | 0.09 ms |
| V8 (Node 26) | 0.45 to 0.50 ms mean, 0.51 to 1.43 ms p99 | 0.41 ms mean | 0.08 to 0.12 ms |

Each cell is the range of 2 runs.

- The prototype gives the same result as three-vrm (0.000° difference) when three-vrm uses the exact bone length. It is only 10 to 22% faster. three-vrm 3.3.0 already has the large speed fix (pixiv/three-vrm#1539).
- One V8 process that first ran 7 different models gave 1.74 ms for the same 3 avatars. Type feedback from many models can slow the JIT. The renderer must not make this worse with avoidable polymorphism.
- Conclusion: the CPU cost is not the deciding factor. Use three-vrm.

### Frame-rate dependence

The VRM reference algorithm multiplies stiffness and gravity by the time step, but it applies the drag once for each step. The specification states no fixed step. UniVRM issue vrm-c/UniVRM#2411 ("sway depends on frame rate") is open.

Measured with three-vrm on smooth motion: a solver that steps one time for each received frame (dt = 2/60 at 30 fps) differs from a solver that steps at 60 Hz. The worst joint differs by 3.4° to 25.8° (p95). At 15 fps (dt = 4/60) the worst joint differs by 9.8° to 58.2°. With a 0.5 m jump every 2 s, bones flip by up to 180°. A renderer-local solver must step on a fixed grid.

### Convergence

The solver loses energy (drag), so the state forgets its start:

- A start with every tail moved by 5 cm reaches less than 1° difference after 0.8 s to 2.1 s, and stays below 0.1° after 0.9 s to 2.8 s.
- A 1e-9 m change of the start gives 0.000° difference. The solver is not chaotic.

### A renderer that gets fewer frames

The reference solver steps every 60 Hz tick. A second solver gets every Nth frame and uses one of 3 modes:

- **One step:** one step of N/60 s on the newest pose.
- **Fixed, hold:** N fixed steps of 1/60 s, all on the newest pose.
- **Fixed, interpolate:** N fixed steps of 1/60 s on poses interpolated between the last two received poses.

Smooth motion, 20 s, the first 5 s ignored. Worst joint for each frame, p95:

| Model | Frames received | One step | Fixed, hold | Fixed, interpolate |
| --- | --- | --- | --- | --- |
| Nina | 1 of 2 | 25.80° | 25.41° | 0.29° |
| Nina | 1 of 4 | 58.15° | 51.46° | 1.32° |
| Xiulang | 1 of 2 | 3.42° | 65.64° | 0.91° |
| Xiulang | 1 of 4 | 9.84° | 89.73° | 2.15° |
| Nemimi | 1 of 2 | 4.67° | 27.10° | 0.33° |
| Nemimi | 1 of 4 | 16.14° | 46.15° | 1.92° |

The mean over all joints (p95) with fixed steps and interpolation is 0.04° to 0.07° at 1 of 2 frames and 0.20° to 0.32° at 1 of 4 frames.

- Fixed steps with interpolation keep renderers together. Fixed steps without interpolation are worse than one step for each frame.
- A 0.5 m jump of the character in one tick (a teleport) makes large differences in all modes. A teleport needs a reset that the session announces.

### Practice in other products

- VRChat runs PhysBones on each client: parameters "are already updated on both the local and remote machines, as both will be running PhysBones" ([PhysBones](https://creators.vrchat.com/common-components/physbones)).
- The VMC protocol sends humanoid bones only ([marionette spec](https://protocol.vmc.info/marionette-spec)). Receivers run their own spring bones.
- UniVRM FastSpringBone runs one job for each spring (vrm-c/UniVRM#1263). VRChat limits PhysBone "collision checks" by performance rank ([ranking](https://creators.vrchat.com/avatars/avatar-performance-ranking-system/)): Poor on PC is 512. Nina has 12,670.
- No Rust VRM spring solver supports VRM 0.x, capsules, center, and WASM together (bevy_vrm1, bevy_vrm, vrm-runtime-rs).
- Bandwidth: a smallest-three quaternion is 29 bits (Glenn Fiedler, [Snapshot Compression](https://gafferongames.com/post/snapshot_compression/)). 55 humanoid bones are about 200 B for each avatar frame. The owner's heavy models have 240 to 395 joints, so streamed spring results would be 4 to 7 times the humanoid pose.

## Current code facts

- The host clock asks the publisher for a frame at 60 Hz with one frame in flight, and it skips late ticks (`apps/desktop/src-tauri/src/service/mod.rs:1666`). The session time step is not constant. Each frame has `tick = floor(elapsedMs × 60 / 1000)`, and `elapsedMs` never goes back in one session (`packages/session/src/session.ts:516`).
- Each frame has `elapsedMs` (session time) and `avatarPoses` (`RuntimeFrameSchema`, `packages/contracts/src/schema.ts:483`). The Rust mirror validates each frame (`crates/contracts/src/lib.rs:1447`). The frame limit is 256 KiB.
- The session emits a pose only for an avatar that has tracking or idle animation (`packages/session/src/tracking.ts:103`). Other avatars stay in the rest pose.
- The renderer applies a pose with `createAvatarBinding(vrm).apply(pose)` (`packages/renderer/src/avatar-pose.ts`). Then it places the root from the entity transform, scale included (`place`, `renderer.ts:388`; `applyTransform`, `renderer.ts:553`). The editor viewport skips `place` for an entity that the operator drags (`editor.frozen`). A gizmo drag commits to the scene at most every 33 ms (`GIZMO_COMMIT_MS`, `packages/renderer/src/editor-viewport.ts`).
- The editor has one renderer instance (`preview_main`, `apps/desktop/src/bootstrap.ts`). The viewport controls are on that instance.
- three-vrm scales the bone length with the avatar, but not the collider radius, the hit radius, the stiffness, or the gravity (`calculateCollision` and `VRMSpringBoneJoint.update` in `@pixiv/three-vrm-springbone` 3.5.5). At scale 2 the colliders are half their correct size, and the hair goes into the body.
- The OBS page can apply only every other frame (output frame limit 30 or 60, `apps/output/src/frame-pacer.ts`). The editor preview applies the newest frame on each animation frame, and it stops when Preview is off (`apps/desktop/src/preview-pump.ts`).
- `VRMLoaderPlugin` already builds `vrm.springBoneManager`. Nothing calls its `update`. A test checks that the binding never calls `vrm.update` (`packages/renderer/test/avatar-pose.test.ts:36`).
- The loader rotates a VRM 0.x model with `VRMUtils.rotateVRM0` after the parse.

## Approaches

1. **The session runs the solver and streams joint rotations.** All views are equal, and thin clients do no physics. But the session worker needs three-vrm and the skeleton of each model, frames need a binary layout, and the hub egress for each client grows 4 to 7 times. Rejected for now (O1).
2. **Each renderer runs the same fixed-step solver, and the session owns the inputs.** No new per-frame data except a small reset count. The measured difference between renderers is below 1° on average. This matches VRChat and VMC practice. Chosen (O1).
3. **Both modes.** Option 2, plus a later mode in which the session or the hub streams results to a client that cannot simulate. Kept as a later option: the solver interface below allows it.

## Design

### Architecture amendment

The architecture design says: "Settle animation, expression, retargeting, and spring-bone state in the session" and "Do not run separate avatar physics in OBS and the editor" (`docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md`, lines 55 and 74). The minimum live VTubing contract says: "Do not call VRM spring-bone simulation separately in each renderer" (`spdd/prompt/2026-10-03-minimum-live-vtubing.md`, R line 35).

The new rule for secondary motion:

> Secondary motion (VRM spring bones) is a deterministic function of session-owned inputs: the evaluated pose, the session time, and the reset count of each avatar. Each renderer computes it with the same solver on a fixed time grid in session time. A renderer never advances it with its own clock. Interpolation between received frames is permitted for the solver input. Other avatar physics (ragdoll, collision with props, cloth with its own state) stays in the session until a design changes it.

The same commit changes the three documents. A decision record in this file keeps the reason.

### Inputs that the session owns

1. **Pose.** No change. The renderer interpolates the posed skeleton, not the `AvatarPose` data (see "Solver input").
2. **Session time.** No change: the frame `elapsedMs`.
3. **Reset count.** New optional frame field `springResets`: an array of `{ avatarId, count }`. The array has an entry only for an avatar with a count above 0. Each entry ID is an avatar entity of the frame scene, and each ID occurs one time. The session increases the count of an avatar when it detects a teleport.
4. Later: wind, gravity overrides, and per-chain parameters are scene data, so they are also session inputs.

**Teleport rule (session, pure function).** The root world transform of an avatar is the entity transform times `pose.root`, or the entity transform when the avatar has no pose. Its scale is the mean of the 3 axis scales. Between two session ticks, a teleport is one of these:

- a position change of more than 0.1 m,
- a rotation of more than 30°,
- a scale ratio of more than 1.25 (larger to smaller or smaller to larger).

A spring bone tail moves less than the root in one tick, so a short jump also whips the hair. Tracking and idle animation are expected to move the root less than half of these limits in one tick (3 m/s and 900°/s). The acceptance checks confirm this with live tracking. The session keeps the last root world transform of each avatar. A new avatar entity, or an avatar whose asset changed, starts without a previous value and does not count as a teleport. The renderer resets an avatar it installs in any case.

A fast gizmo drag can move the avatar more than 0.1 m between two commits. Then each commit resets the spring bones, in OBS and in the editor. The editor viewport moves the avatar smoothly with the drag, but the hair snaps back to rest at each commit (every 33 ms) until the drag slows down. This is accepted: the alternative is a whip on each commit.

### Time grid

- Step k is at session time `k × 1000 / 60` ms. Step length is 1/60 s. The frame `tick` is the index of the last step at or before the frame time.
- When a renderer applies a frame with `tick = k1` after a frame with `tick = k0`, the due steps are k0 + 1 to k1. Two renderers that apply the same frames run the same steps.
- If more than 15 steps are due (0.25 s, for example a preview that resumes after a pause), or if `k1 < k0` (a new session), the renderer resets instead of stepping.
- If no step is due, the renderer does not run the solver. The spring joints keep their last rotations.

### Solver input (interpolation)

- After `apply(pose)` and `place`, the renderer records the posed skeleton of the avatar: the local rotation and position of each humanoid raw bone, of the motion node, and the world transform of the instance root. The spring joints and the nodes that the pose does not touch are not in the record.
- For each due step k, the renderer sets the skeleton to the interpolation between the previous record (frame time `t0`) and the current record (frame time `t1`) at `(k × 1000/60 − t0) / (t1 − t0)`, limited to 0 to 1: slerp for rotations, lerp for positions and scale. Then it runs one solver step of 1/60 s.
- A reset removes the previous record. The steps of the frame that brings a reset use the current record without interpolation. Interpolation across a teleport would sweep the avatar through the jump and whip the hair.
- After the last step, it sets the skeleton to the current record again. The spring joints keep the result of the last step.
- The record holds about 55 bones and 2 roots. This avoids applying expressions, offsets, and look-at again for each step.

### Solver

- Interface (renderer package, plain functions on plain state):
  - `createSpringRig(vrm)` returns `{ reset(), step(dtSeconds), joints }` or nothing when the model has no spring joints.
  - The first implementation calls `vrm.springBoneManager.update(1/60)` for `step` and `vrm.springBoneManager.reset()` for `reset`. It never calls `vrm.update`.
  - The interface lets a later flat solver, a WASM build, or a streamed result (option 3) replace the implementation without a change to the callers.
- Order for one frame and one avatar: `apply(pose)`, `place` (or the editor drag transform), record, reset if necessary, scale the values (see "Scale"), due steps, restore the current record, render.
- Install: call `springBoneManager.setInitState()` one time, while the skeleton is in the rest pose and after `rotateVRM0`. Then reset after the first `apply` and `place`, so that the tails start at the posed position.
- Reset: on install, on a change of the `springResets` count of the avatar, on the gap rule above, and when the time goes back. A reset puts each joint at its initial local rotation and each tail at the rest position under the current parent. The next due step continues from there.
- An avatar that has no pose in the frame still gets its due steps: its record is the rest pose and the root transform.
- The editor viewport uses the drag transform while the operator drags. Only the editor shows the swing from a drag that has not committed. This is accepted.

### Scale

- The rig keeps the file values of each joint and each collider shape.
- Before each due step, the rig sets the hit radius, the stiffness, and the gravity power of each joint, and the radius of each collider shape, to the file value times s. s is the mean of the 3 axis scales of the avatar root world transform. Drag is a ratio, so it does not change. Collider offsets and capsule tails already scale with the bone transform.
- The rig sets these values only when s changes. three-vrm reads them on each step, so no patch to three-vrm is necessary.
- A non-uniform scale gives an approximate result. This is a known limit.

### Warnings

- Remove "VRMC_springBone simulation is disabled in renderer".
- Keep the `VRMC_node_constraint` warning.
- Add an `UNSUPPORTED` warning when the file uses `VRMC_springBone_limit`: "VRMC_springBone_limit is not supported; spring bones move without limits".

### The relay later

A relay client needs the frame `elapsedMs`, the avatar pose, the scene, and `springResets`. It needs no spring data on the wire. It runs the same renderer stage. The hub needs no solver. For a client that cannot simulate (for example a low-end phone), option 3 adds a streamed result behind the same `createSpringRig` interface. Measure phones before that decision.

## Calls made by the designer

These are reversible. The owner can change each one in review.

| # | Call | Reason |
| --- | --- | --- |
| C1 | Use three-vrm's solver, not the flat prototype | Same result, only 10 to 22% slower, tested for VRM 0.x and 1.0, center, capsules, and extended colliders |
| C2 | Grid step 1/60 s, counted with the frame `tick` | The session clock is 60 Hz, and the session already computes the step index. VRM authors tune their models at 60 fps in most tools |
| C3 | Reset after more than 15 due steps (0.25 s) | Stepping with stale input for longer gives no better state than a reset, and it costs time on the frame that resumes |
| C4 | Teleport limits 0.1 m, 30°, and scale ratio 1.25 in one tick | A hair tail moves less than the root in one tick, so a jump of 0.2 m already whips. Tracking stays below half of each limit. A reset on each one-time edit, whatever its size, needs the origin of each transform change and a larger contract change |
| C5 | `springResets` is a frame field, not part of `AvatarPose` | An avatar without tracking or idle animation has no pose, but the operator can still move it |
| C6 | Interpolate the posed skeleton, not the `AvatarPose` data | `AvatarPose` has weights, raw and normalized spaces, offsets, and absent bones. The posed skeleton has one form |
| C7 | No controls in this slice | Warudo has none on the Character asset; CHR-08 says controls Later |
| C8 | Scale the joint and collider values with the avatar, with no three-vrm patch | A scaled avatar must look like the same avatar. three-vrm reads the values on each step, so the rig can set them |
| C9 | A fast gizmo drag can reset the hair on each commit | A whip on each commit looks worse than hair near rest during the drag |

## Left to the builder

- The array limit of `springResets` (equal to the limit of avatar entities, if one exists; otherwise 8).
- Where the record and the step state live (a small per-avatar object next to the binding is the expected place).
- The exact form of the teleport function and its inputs in `packages/session`.
- The Rust mirror field names and the validation vectors.
- A change of the teleport limits after the acceptance checks. Record the new values and the reason in the slice contract.

## Verification

Unit tests (pure logic, required by the session test rule):

1. Due steps: ticks to steps, the gap rule, and the time-back rule.
2. Interpolation of the record at a fraction, and no interpolation after a reset.
3. Teleport rule: below and above each limit (position, rotation, scale), a new avatar, a changed asset.
4. Scale: joint and collider values at s = 1, 2, and 0.5, and no change when s does not change.
5. Schema: `springResets` accepted and rejected in TypeScript and Rust (validation vectors).
6. Renderer stage, with a VRM built in the test as `avatar-pose.test.ts` does, plus a spring chain and a sphere collider:
   - The same frames give the same joint rotations in two instances.
   - An instance that gets every second frame stays within 1° mean of an instance that gets every frame.
   - A change of the reset count returns the joints to the rest state under the current parent.
   - An instance at scale 2 gives the same joint rotations as an instance at scale 1.
   - The binding still never calls `vrm.update`.

Local acceptance on macOS (the owner's host):

1. Roro and Catboy in the editor with tracking: hair and accessories move with head and body motion. Screenshot or recording. Use a Roro import with 30 joints (for example `avatar_c116520b…`). The oldest Roro import (`avatar_f16f7e96…`) has no spring data.
2. OBS capture at the 60 fps and 30 fps output limit: the motion looks the same, and the alpha stays correct around the hair.
3. Editor minimized: the OBS hair keeps its motion.
4. With the Inspector, move the character by 0.3 m and by 2 m, turn it by 45°, and change its scale from 1 to 1.5: no whip or flip in the preview or in OBS. Drag the gizmo fast and slow, and record what the hair does.
5. Renderer CPU time (`FrameApplied.cpuMs`) with spring bones and without them (a build of the parent commit), 1 and 2 avatars, under the benchmark contract. App timing and OBS timing stay separate. The backend, the quality profile, and the commit are recorded. A difference inside the noise is reported as such.

Documents in the same change: the architecture design (amendment), the minimum live VTubing contract, `ARCHITECTURE.md` (tracking path, render step), the parity checklist row CHR-08 (Partial: VRM-authored spring bones; controls, collisions, `VRMC_springBone_limit`, and non-uniform scale Later), and `docs/vpoyo-gaps.md` gap 1.

## Candidate slices

One slice with 2 commits:

1. Contract and session: `springResets` (TypeScript, Rust, validation vectors), the teleport rule, the documents, and the SPDD analysis and contract.
2. Renderer: the time grid, the record and interpolation, `createSpringRig`, the scale values, the warnings, the tests, and the evidence.

## Unknown

- Cost on a phone or a low-end Windows laptop. Not measured.
- Cost inside WKWebView and the OBS browser source. The `jsc` shell and Node are close proxies, not the same runtime.
- How cluster, VirtualCast, and Resonite sync secondary motion.
- Visual difference between renderers in a long live session with real tracking noise. The research used generated motion.
