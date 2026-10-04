# Default avatar idle contract

## Requirements
New VRM imports enable a subtle looping idle: relaxed arms, small chest breathing and sway. Add an Idle animation checkbox to avatar properties. Live tracking takes priority for each supplied bone. Sparse packets leave other idle bones active. Lost tracking fades back to idle. No default root movement, facial expression, leg motion or renderer clock. Existing avatars without a setting remain unchanged until enabled. Mixamo/VRMA clip import is later work.

## Entities
AvatarIdle is {kind:'builtin',enabled:boolean}. SceneEntity avatar has optional idleAnimation. Add setAvatarIdle with entityId and idleAnimation to the existing validated scene patch API. AvatarPose has optional baseBones, a map of normalized TrackingBone values without per-bone weight. Preserve bones for tracking values and weights. TypeScript and Rust contracts agree and reject raw or weighted base bones.

## Approach
A pure session idle function uses elapsedMs for phase. Relax upper arms with normalized Z rotations (left negative, right positive), and apply chest pitch/roll within one degree. No renderer-local animation mixer. Idle baseline uses canonical VRM1 axes; the renderer converts baseline rotation X/Z and position X/Z signs for VRM0 before blending, as the ThreeVRM animation adapter does. Existing raw and normalized tracking inputs retain their current rig-space semantics in this slice. Tracking composer accepts animation elapsedMs separately from tracking nowMs and emits a baseline for enabled idle avatars, including avatars without tracking configuration. Tracking ownership and stale timing stay unchanged. No scene revision changes per tick.

Renderer resets raw and normalized pose, seeds normalized idle baseline, blends supplied normalized tracking from baseline to sample by weight, and maps the result to the raw humanoid once. Raw tracking then blends from that current mapped baseline to its absolute packet values by weight. Existing avatars without a baseline retain the previous rest behavior. Resolve the idle baseline chest-to-spine fallback before tracking interpolation on chestless rigs. Full-weight spine tracking must replace idle on that effective node. Preserve the existing explicit tracked spine/chest composition. Preserve expression/root handling.

## Structure
Integrator owns packages/contracts and crates/contracts schemas and exports, session patch operation and protocol tests. Session worker owns packages/session/src/idle.ts, tracking.ts, session.advance clock wiring and focused tests. Renderer worker owns avatar-pose.ts and renderer tests. Editor worker owns avatar import factory, model method, avatar Idle switch and UI tests. Use separate worktrees and merge sequentially after common contract exists.

## Operations
1. Add additive optional contracts and validated patch operation; test acceptance, invalid baselines and wrong entity kinds.
2. Add deterministic bounded idle evaluation and compose baseline plus tracking; test no source, disabled, same phase, unchanged revision and sparse/stale packets.
3. Blend normalized/raw tracking over idle in the renderer; test full/partial weight, chestless rigs and independent bindings.
4. Enable idle in new imports and expose switch via shared UI; test import factory and model patch.
5. Run unit, integration, workspace and native contract checks. Build macOS. Verify actual avatar idle in preview and transparent OBS, switch, raw/normalized takeover and return, and continued OBS motion with editor minimized. Preserve saved user scene and receiver configuration.
6. Record source/backend/capture hashes and update parity. Commit verified checkpoint.

## Norms
No new dependencies, external clip downloads or per-frame image IPC. Keep private avatar, phone and local tokens out of Git. Use shared UI where it provides the control. The frozen kit has no checkbox; use a native inspector checkbox. Keep bounded frame queues. Keep phase numeric and bounded for long elapsed time. Two avatars remain within the existing scene budget.

## Safeguards
Missing/disabled idle gives no baseline and preserves frozen smoke fixture behavior. Validate finite animation time and normalized baseline bones. Required unit tests cover pure pose and composition logic; real protocol integration covers changed contracts. OBS evidence uses owned local source and restores prior settings. Actual arm direction must be checked on the supplied VRM before completion. Unknown timing remains unknown; one-avatar idle does not certify concert performance.

Rig orientation reference: [ThreeVRM animation adapter](https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm-animation/src/createVRMAnimationClip.ts). Actual supplied VRM0 has left arm rest direction negative X. Its baseline needs this adapter; reversing the global loop would break VRM1.
