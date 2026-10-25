# REASONS: Guided tracking setup, slice 2 (guide)

Date: 2026-10-21. Scope: TRK-23 slice S2. Analysis: [guided tracking setup](../analysis/2026-10-21-tracking-setup-walkthrough.md). Design: [guided tracking setup](../../docs/superpowers/specs/2026-10-21-tracking-setup-walkthrough-design.md). Plan: [implementation plan](../../docs/superpowers/plans/2026-10-21-tracking-setup-walkthrough.md), Tasks 7 to 9. Related: [S1 probe and fit](2026-10-21-tracking-setup-s1-probe-fit.md), [S3 gates](2026-10-21-tracking-setup-s3-selfreflect-gates.md).

This file is the contract only. S2 depends on S1 (Tasks 3, 4, and 5 give `trackingProbe`, `fitBlendShapeRanges`, and the presets). S3 can run in parallel with S2. Task 13 (acceptance) spans all slices.

## Subset

- **TRK-23 guide:** the state machine, the connect and cancel plans, the coach, the docked panel, and the entry button.
- Not in it: the SelfReflect gates and their fixes (S3), the Blueprint nodes (S4), more presets, and a second 3D render in the guide.

## Controller rulings

- **Connect stays until data arrives.** The `connected { sourceId }` event stores the source and stays in the Connect step. The guide enters Relax at the first probe whose state is `receiving`. The plan test "connected enters relax" reads as "connected stores the source and stays in Connect".
- **Eye checkbox check.** The running-app check of Task 9 also verifies the inspector checkbox "Use bones for eye movement" (the S1 control in `TrackingMappingFields.svelte`).

## R — Requirements

### State machine (Task 7)

R1. The guide is a pure reducer in `apps/desktop/src/editor/tracking-guide.ts`. `guideStep(state, event)` returns the next state and a list of effects. It never reads the clock. Time comes only from `nowMs` in an event. A change of a channel means that its value differs from the value in `previous` by more than 0.
R2. The steps are `pick`, `connect`, `relax`, `expressions`, and `review`.
R3. **Pick.** A `pick` event stores the preset and moves to `connect`. It emits a `connect` effect with the preset. A `connected { sourceId }` event stores the source ID and keeps the step at `connect`.
R4. **Connect.** The step waits. It enters `relax` at the first `probe` event whose state is `receiving` and whose `sourceId` is the stored source. The state records `relaxStartMs` from that event.
R5. **Relax.** The step counts 3000 ms from `relaxStartMs`. At the end, the guide stores `probe.values` as the neutral and emits `resetPeaks`. For the iFacialMocap preset it also emits `calibrate`. When the probe state is not `receiving` at or after 3000 ms, the guide does not capture. It captures at the first `receiving` probe after that time, so it never stores a neutral of zeros.
R6. **Expressions.** The step runs the preset steps in order. For each step, the main value is the maximum over the `main` channels of the step. A step ends as one of these:
  - `done`: the main value rose above `neutral + 0.05`, and its peak did not rise for 1000 ms.
  - `notSent`: no `main` channel is in `presentChannels` (at once), or the main value did not change for 4000 ms while another channel changed.
  - `skipped`: a `next` event. Skip is always available.
  A main value that is unchanged while no channel changes keeps the step open. `lookAround` with only eye bones waits for `next`. `lookAround` with no `eyeLook*` channel and no eye bones is `notSent`.
R7. After the last step, the guide emits `fit` with the neutral. A `fitted` event moves to `review`. A `fitFailed` event moves to `review` and stores `fitError`.

### Plans (Task 8)

R8. `planConnect(scene, avatarId, preset, phoneAddress, eyeBones, newId)` returns `{ operations, sourceId, created, needsPhone, port }`. `port` is the port of the chosen source after the plan. The source choice follows the design order:
  1. A same-kind source in the own slot of the character is reused. It sends `setTrackingConfig` only when the config differs.
  2. A free same-kind source is adopted, bound, and set to the preset config.
  3. When another character uses the target endpoint (same port; the host lets different kinds on one port conflict), the bindings of the other character stay, and:
     - VMC: the source uses the next port from 39540 up that no tracking source in the scene uses. `needsPhone` is `false`.
     - iFacialMocap: without a phone address, the result is `needsPhone: true` with no operations. With a phone address, the source gets it as `phoneAddress`. A phone address that a source on that endpoint already has gives `needsPhone: true` with no operations.
  4. Otherwise a new source is created.
  The endpoint check applies to the target endpoint in cases 1 and 2 too. It uses the host's share rule (ruling R14): the chosen source stays on the port only when every other enabled source on that port, bound or not, has the same kind and an address, and all addresses differ. A layout that already meets the rule is kept. A source that this character binds in a slot that the preset does not fill is not free. Among free sources, one already on the preset endpoint wins; then scene order.
R9. Each connect plan enables the config. It binds only the slots of the preset (iFacialMocap binds `faceSourceId` and keeps body and fingers). It writes `setTrackingSmoothing` with the preset values when the source is new, or when the source has `smoothing.enabled === false`. An absent `smoothing` counts as on and stays (ruling R4). It writes `setTrackingMapping` with `useEyeBones: eyeBones` only when `eyeBones` is a boolean, and keeps the existing mapping fields. An unknown flag (a record from before `eyeBones`) changes nothing (ruling R8).
R10. `planCancel(scene, snapshot, fitSent)` returns the operations for a close before Done:
  - A source that the run created gives `removeEntity`, and `setAvatarTracking` with the snapshot bindings (ruling R11). The `removeEntity` is sent also when the avatar is gone.
  - A reused or adopted source gives `setAvatarTracking` with the snapshot bindings, and always `setTrackingMapping` with the snapshot mapping, because the connect plan can change the mapping (ruling R3). `fitSent` does not change the result. A snapshot mapping of `undefined` uses `DEFAULT_TRACKING_MAPPING`.
  - A binding to a source that is no longer in the scene becomes `null`. A reused source that is no longer in the scene gets no operation. An avatar that is gone gets no binding operation.

### Coach, panel, and entry (Task 9)

R11. `coachShape(values)` maps ARKit values to `CoachShape`. All fields are 0 to 1, except `pupil`, which is -1 to 1. The view is a mirror view: the performer's left shows on the screen's left. `eyeBlinkLeft` 1 gives `lidScreenLeft` 1 and `lidScreenRight` 0. `jawOpen` 1 gives `jaw` 1. `eyeLookOutLeft` 1 with `eyeLookInRight` 1 gives a negative `pupil[0]`.
R12. `COACH_LOOPS` gives each step a loop of keyframes. Each loop reaches 1 on each `main` channel of its step at some frame. `sampleLoop(loop, tMs)` interpolates linearly and wraps at `loopMs`.
R13. `CoachFace.svelte` draws the face as plain SVG and uses `requestAnimationFrame`. A ring around the face fills as the step progresses. With `prefers-reduced-motion`, the face shows the target pose with no loop. The code adds no animation library and no authored animation file.
R14. `TrackingGuide.svelte` renders the guide state. It runs the effects through `model` and `api.trackingProbe`. It polls every 100 ms while it is open and stops when it closes. The LAN address comes from `appStatus.localAddresses`. A close button before Done runs `planCancel`. Done commits nothing more and closes the guide.
R14a. The guide stays open, with its state, until Done or ×. A switch of the rail panel hides it and does not cancel the run (ruling R15). Only × before Done runs `planCancel`. If the cancel patch fails, the guide stays open and shows the error. While the guide is open, Open show is not available, because a new scene would make the snapshot wrong (ruling R16).
R15. The screen copy is short:
  - Pick: three tiles with the preset labels.
  - Connect: "Send VMC to" with the large address and port (the first address after `rankAddresses`: 192.168, then 10, then 172.16 to 172.31, then other addresses, then 100.64/10 and addresses that end in .0; the other addresses show small below), or a phone address `Input` for iFacialMocap and for `needsPhone`. "Waiting for data" shows a `Spinner`.
  - Relax: "Relax your face" with the countdown.
  - Expressions: one short imperative for each step, the meter with a peak tick, and Skip. The Look around step also shows the "Use bones for eye movement" checkbox. It sends `setTrackingMapping` at once.
  - Review: Eyes, Mouth, and Brows meters, and Done.
R16. `AvatarSourceFields.svelte` gets a "Set up tracking" `Button` from `@oshi-connect/ui` that calls `onguide?.(entityId)`. On a character with bound sources, the same button runs the guide again. While a guide is open for an avatar, the properties column renders `TrackingGuide` in place of the Inspector. The scene view does not change.

## E — Entities

- `GuideStep = 'pick' | 'connect' | 'relax' | 'expressions' | 'review'`.
- `StepResult = 'done' | 'notSent' | 'skipped'`.
- `GuideState = { step; preset: TrackingPreset | null; sourceId: Id | null; relaxStartMs: number | null; neutral; index; stepPeak; stepStartMs; lastRiseMs: number | null; lastMainChangeMs; lastOtherChangeMs: number | null; previous: TrackingProbe | null; results: Partial<Record<ExpressionStepId, StepResult>>; fitError: string | null }`.
- `GuideEvent = { kind: 'pick'; preset } | { kind: 'connected'; sourceId } | { kind: 'probe'; probe; nowMs } | { kind: 'next'; nowMs } | { kind: 'fitted' } | { kind: 'fitFailed'; message }`.
- `GuideEffect = { kind: 'connect'; preset } | { kind: 'resetPeaks' } | { kind: 'calibrate' } | { kind: 'fit'; neutral }`.
- `initialGuide(): GuideState`, `guideStep(state, event): { state; effects }`, `mainValue(probe, step): number`.
- `ConnectPlan = { operations: PatchOp[]; sourceId: Id; created: boolean; needsPhone: boolean; port: number }`.
- `planConnect(scene: SceneView, avatarId: Id, preset: TrackingPreset, phoneAddress: string | null, eyeBones: boolean | undefined, newId: Id): ConnectPlan`.
- `GuideSnapshot = { avatarId: Id; tracking: AvatarTracking | undefined; sourceId: Id; created: boolean; mapping: TrackingMapping | undefined }`.
- `planCancel(scene: SceneView, snapshot: GuideSnapshot, fitSent: boolean): PatchOp[]`.
- `CoachShape`, `CoachFrame = { atMs; values }`, `COACH_LOOPS`, `coachShape`, `sampleLoop`.
- Consumed from S1: `TrackingPreset`, `EXPRESSION_STEPS`, `TrackingProbe`, `AssetRecord.eyeBones`, `fitBlendShapeRanges`, and `model.fitBlendShapeRanges`.
- No change to the contracts package, the session, or Rust.

## A — Approach

Write the reducer first, with unit tests, because it holds the rules that the anti-goals name. Then write the two plans as pure functions on the scene. Then write the coach functions. Last, build the Svelte components that render the state and run the effects, and check the flow in the running app. The guide writes only ordinary scene data through `scenePatch`, so S2 adds no contract.

## S — Structure

- `apps/desktop/src/editor/tracking-guide.ts` (new), `tracking-guide-plan.ts` (new), `coach-face.ts` (new), `tracking-guide-view.ts` (new: the relax countdown, the coach ring progress, the lookAround wait for Next, the Try it group levels after the source ranges, and the address order). `editor/model.ts` gets `applyOperations`, which sends a group of operations in one `scenePatch`.
- `apps/desktop/src/components/CoachFace.svelte`, `TrackingGuide.svelte`, `GuideMeter.svelte` (new), `AvatarSourceFields.svelte`, `Inspector.svelte`; `apps/desktop/src/EditorApp.svelte`.
- Tests: `apps/desktop/test/tracking-guide.test.ts`, `tracking-guide-plan.test.ts`, `coach-face.test.ts`, `tracking-guide-view.test.ts`.
- Evidence: `docs/evaluation/tracking-setup-walkthrough/` (window screenshots), and the guide section of `docs/evaluation/tracking-setup-walkthrough.md`.

## O — Operations

1. **Task 7.** Unit tests for the reducer: pick emits `connect`; `connected` stores the source and stays in Connect; Connect waits until a probe is `receiving`; the first `receiving` probe enters Relax; Relax captures the neutral at 3000 ms and emits `resetPeaks`; Relax with iFacialMocap also emits `calibrate`; Relax does not capture while the probe is stale and captures at the first `receiving` probe after 3000 ms; a step is done 1000 ms after the peak stops rising above `neutral + 0.05`; a step with absent main channels is `notSent` at once; a step with a main value that is unchanged for 4000 ms while another channel changes is `notSent`; a step with an unchanged value while no channel changes stays open; `next` skips; `lookAround` with eye bones only waits for `next`, and with neither is `notSent`; after the last step `fit` is emitted, `fitted` enters Review, and `fitFailed` enters Review with `fitError`.
2. **Task 8.** Unit tests for `planConnect` (the four cases in order, the phone address for a shared endpoint, the other character's bindings untouched, the slots, the smoothing rule, the mapping rule) and for `planCancel` (created source, reused source, `fitSent`, default mapping, source gone, avatar gone).
3. **Task 9.** Unit tests for `coachShape` (mirror view, jaw, pupil), `sampleLoop` (midpoint, wrap), and `COACH_LOOPS` (each main channel reaches 1).
4. **Running-app check.** Check `pgrep -fl "tauri|vite"` first. If the owner's dev app runs from the main checkout, do not touch the main checkout. Run `pnpm dev:desktop` in this worktree. Feed tracking with the SelfReflect phone app, or replay `fixtures/tracking/selfreflect-replay.json` over UDP with a small `tsx` script in the scratchpad. Go through the five steps and check: the guide docks in the properties column; the scene stays at full size; the coach moves; `cheekPuff` and `tongueOut` skip by themselves; in Review the character opens its mouth fully; Cancel restores the old mapping; after a save, a reopen, and a restart of the phone app, tracking returns with no steps. Also check the inspector checkbox "Use bones for eye movement": it shows checked for a source with no `useEyeBones`, and a change sends one `setTrackingMapping` and survives a reopen. Save window screenshots in `docs/evaluation/tracking-setup-walkthrough/`.
5. Run `pnpm test:unit` and `pnpm check` after each task.

## N — Norms

- Use pnpm, functional TypeScript, plain data, Svelte 5, and `@oshi-connect/ui` (Button, Input, Select, Spinner). The kit has no stepper, progress bar, or meter. Keep those as small local components.
- UI copy is short. Do not add helper text that repeats a control. Do not use a card grid, a gradient, a badge, or a side bar on the selected step. Each step has one primary action.
- Write prose in ASD-STE100. Test the reducer and the plans as pure logic. Do not test static copy.
- Check the changed UI in the running app (constitution principle 15).

## S — Safeguards

- The performer never types or picks a channel name.
- The guide never stops and waits for a move that the app never sends: `notSent` and Skip always end a step.
- The performer never runs the guide again after an app restart or after the show opens again. The guide writes only scene data.
- A deleted wire or a disabled graph never stops tracking: the guide generates no graph.
- Never rebind the source of another character. Ask for the phone address instead.
- Never send an operation for an entity that is gone.
- Never capture a neutral from a stale probe.
- Do not claim a real-device result that the check did not cover. Replay data proves the flow and not the look with a real phone.
