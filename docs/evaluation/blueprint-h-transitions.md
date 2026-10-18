# Blueprint transitions check

Slice H of bundle B13 ([contract](../../spdd/prompt/2026-10-18-blueprint-h-transitions.md)). Checked 2026-10-18 on macOS 27.0.1 (arm64), Node 26.12.0, pnpm 12.8.1, on branch `opensekai/bp-h-transitions` from base `671e2f8`. Only automated checks ran. The desktop app, the renderer, and OBS did not run, so no visual, macOS, or OBS result is claimed.

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm check` | Passed: all packages and `tsconfig.scripts.json`; svelte-check 0 errors, 0 warnings |
| `pnpm test:unit` | 1070 passed in 141 files, 0 failed (after the merge of W0) |
| `pnpm test:integration` | 38 passed, 2 skipped in 16 files, when the local tracking models are present. In a new worktree without the ignored `artifacts/models/` files, the 4 tests of `scripts/prepare-tracking.test.ts` fail with `ENOENT … face_landmarker.task`. With the files copied from the main checkout, they pass. This slice does not change that script |

New tests (27):

- `packages/contracts/test/easing.test.ts` (5): exact ends, clamped progress, easings.net values at 0.25 and 0.5, InOut symmetry, Back and Elastic overshoot, range of the other families, `blendShapeNames` order, and node settings that load with and without a transition.
- `packages/session/test/tweens.test.ts` (13): a tween that a graph retargets on each tick moves on each tick; a running tween to the same target keeps running; number, Vector3, and rotation samples (slerp through 180 degrees where an Euler lerp would pass 0); overshoot clamp; replacement from the current value; cancel by an immediate write, by Move Entity, and by a patch; zero seconds and Boolean properties; the 64-tween limit; the commit guard; a failed write; blend shape set, fade, clamp, release, and model change; look-at yaw, pitch, clamp, character rotation, weight fade, release, and errors.
- `packages/session/test/transitions-session.test.ts` (9), through `createSession`: On Update triggers all four layers on every tick and each reaches its target, with one Field of View commit; disabling a graph stops its tween, blend shape, and look-at, and the last sample commits; one manual run eases the camera Field of View (InOutSine) and an entity Position over 20 ms ticks with no further Blueprint run; the frames show the intermediate values; the revision stays 0 during the transition and becomes 1 at the first tick 250 ms after the end; an old graph without the settings stays immediate; a patch stops a transition; an expression fade with InQuad; a blend shape weight; a Look At head offset; rollback of a failed run.

## What the macOS and OBS run must check

Use the integrated QA build. Record the backend, the quality profile, and the commit.

1. Build a graph: On Keystroke Pressed → Set Asset Property (camera, Field of View, value 25, Transition (s) 2, Easing InOutSine). Press the key. In OBS, the view pushes in smoothly over about 2 s, with no snap at the start or the end. The scene revision increases by one after the push, not during it.
2. Add a second Set Asset Property on the same camera for Position with Transition (s) 2. The camera moves and the Field of View changes together in OBS.
3. Press the key again during a push with a different value. The move continues from where it is, with no jump.
4. Minimize the editor during a 5 s transition. The OBS output continues to move.
5. Drag the camera with the viewport during a transition. The drag wins; the transition does not pull the camera back.
6. Set Expression with Transition (s) 1 and Easing InQuad on a character with a triggerable expression. The expression fades in the Scene preview and in OBS.
7. Set BlendShape on `blink` with weight 1 and Transition (s) 0.5, then weight 0. The eyes close and open smoothly. Check a perfect sync model with an ARKit name (for example `mouthSmileLeft`).
8. Look At (character, target the output camera, weight 1, Transition (s) 1). The head turns toward the camera. Move the camera; the head follows. Set weight 0; the head returns. Note the result as Approximate (head only, estimated head point).
9. Save and open the show. No transition, blend shape, or look-at state is in the file; the committed property values are.
10. In the editor, check the Transition (s) field (empty on an old node), the Easing select (Linear when not set), and the BlendShape select (with Missing for an unknown name).

## Gaps

- No renderer, macOS, or OBS evidence. The visual feel of each easing is not checked.
- Set BlendShape lists VRM expression, VRM preset, and ARKit names only. A mesh morph target with another name cannot be set.
- Look At turns only the head, from an estimated head point, and adds to the tracked head rotation. No eyes and no IK.
- The Warudo node names are candidates.
