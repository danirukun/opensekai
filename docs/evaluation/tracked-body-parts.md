# Tracked body parts check

Checked 2026-11-10 in a Linux cloud container (Ubuntu 24.04, x86_64, no GPU) on branch `claude/trk05-body-parts`, base `a78b27a`. Contract: [tracked body parts](../../spdd/prompt/2026-11-10-tracked-body-parts.md). Node 26.10.0, pnpm 12.8.1, HeadlessChrome 153 (Playwright 1.65.0, the Chromium build 1243 of the container).

No physical tracker, macOS, or OBS result is claimed. The part list was not compared with the Warudo handbook: the handbook was not reachable from this container.

This container was not the usual cloud environment. It could not download rustc 1.93.1 or the MediaPipe models, so the Rust checks ran on rustc 1.97.0 and `pnpm build` did not run.

## Composer check (unit tests, mock samples)

`packages/session/test/tracking-body-parts.test.ts` calls `createTrackingComposer` as the session calls it, with one character on a VMC body source, an iFacialMocap face source, and a MediaPipe finger source, and one sample from each.

- Without the group, and with all 8 parts at intensity 1, the pose is equal (R7).
- For each of the 8 parts in turn, a part that is off drops exactly the bones of that part, from each source that sent them, and the expressions stay (R5).
- `body` off drops the root. Other parts off keep it. With no part on, `bones` is empty and the expressions stay (R5).
- Intensity 0.5, 2, and 0 give half, double, and zero angles on hips, spine, chest, and upper chest (for example hips 20° about Y becomes 10°, 40°, and 0°). The other bones, the hips position, the weights, the root, and the expressions do not change (R6).
- `setAvatarTracking` stores the parts in the fixed order and stores no group for the default; an intensity of 3 and a duplicate part are rejected with `INVALID_INPUT` and no change (R4).

## Editor controls (headless Chromium)

Method. A scratch Svelte page (not in the repository) mounted the real `Inspector` with a real `createEditorModel` on a real `createSession` (smoke scene with one VMC source, `performer` selected). Playwright used the controls.

Raw output (shortened):

```
parts: Head, Body, Left Arm, Right Arm, Left Fingers, Right Fingers, Left Leg, Right Leg | checked: 8
initial: revision 0, tracking without a body group, 0 patches
after Left Leg and Right Leg off: revision 2,
  patch [{kind: setAvatarTracking, entityId: performer, tracking: {bodySourceId: null, faceSourceId: null,
    body: {movementIntensity: 1, trackedParts: [head, body, leftArm, rightArm, leftFingers, rightFingers]}}}]
after Body Movement Intensity = 1.5: body {movementIntensity: 1.5, trackedParts: [the same 6 parts]}
after Body source = VMC: {bodySourceId: vmc, faceSourceId: null, body: {movementIntensity: 1.5, the same 6 parts}}
after Body Movement Intensity = 3 (out of range): no change
reset marks: Reset Idle animation, Reset Body Movement Intensity, Reset Tracked Body Parts
after Reset Tracked Body Parts: body {movementIntensity: 1.5, all 8 parts} | checked: 8
after Reset Body Movement Intensity: revision 6, tracking {bodySourceId: vmc, faceSourceId: null}
console errors: one 404 for a file that the scratch page does not have (no script error)
```

Result. Each change sends one `setAvatarTracking` patch that keeps the source IDs, and a source change keeps the group (R8). A value out of range sends no accepted change. The reset marks show only on the changed fields, and the scene drops the group when both fields are at the default (R4). The Reset Idle animation mark comes from the smoke scene, whose character has no idle animation. The slider drag was not operated.

## Checks

| Command | Result |
| --- | --- |
| `pnpm check` | 9 packages and `tsconfig.scripts.json`: pass. svelte-check: 0 errors, 0 warnings |
| `pnpm test:unit` | 1997 passed, 1 skipped (231 files). Base `a78b27a`: 1976 passed, 1 skipped (228 files) |
| `pnpm test:integration` | 73 passed, 4 failed, 4 skipped. The 4 failures are in `scripts/prepare-tracking.test.ts`: the MediaPipe model files are not in `artifacts/models`, because this container cannot reach their download host. The base gives the same 4 failures here |
| `cargo test -p opensekai-contracts --no-fail-fast` (rustc 1.97.0) | 120 passed, 0 failed |
| `cargo test --workspace`, `cargo clippy` | Not run on this branch in this container; see the pull request |

One unit test failed one time in a run that shared the CPU with a Rust build: `apps/desktop/test/hidden-cameras.test.ts`, "hides matches, saves only valid patterns, and restores the defaults". It passed in the next 3 runs and in the full run above. It does not use code that this change touches.

## Local acceptance (owner, macOS)

1. Connect a body source (VMC or MediaPipe) to a character with Idle animation on. In Tracking, turn Left Leg and Right Leg off. The legs take the idle pose and the other parts follow the tracker, in the preview and in OBS.
2. Turn Body off. The torso takes the idle pose, the root motion stops, and the arms and the head still follow.
3. Set Body Movement Intensity to 0, 1, and 2 while you lean left and right. The lean of the character is zero, equal, and about double. Calibrate first for a webcam source.
4. Turn Head off. The head bones take the idle pose, and the face blend shapes still follow.
5. Save, close, and open the show. The settings are on the character. A VMC Sender on that character sends the filtered pose.
