# Guided Tracking Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A docked guide on a Character connects SelfReflect, iFacialMocap, or a generic VMC app, measures each ARKit channel, and saves the ranges, the smoothing, and the eye mode on the tracking source. Four new Blueprint nodes read tracking.

**Architecture:** The guide writes ordinary scene data through `scenePatch`. One new read call (`trackingProbe`) gives live smoothed channel values and run peaks from the session. One new live patch operation (`fitBlendShapeRanges`) turns the peaks into saved ranges in the session, so the editor and MCP get the same result. The guide's step logic is a pure reducer. Svelte only renders it.

**Tech Stack:** TypeScript (zod, vitest), Svelte 5 with `@oshi-connect/ui`, Rust (serde contracts crate, Tauri host router), MCP server in `apps/mcp`.

**Spec:** `docs/superpowers/specs/2026-10-21-tracking-setup-walkthrough-design.md`. Read it with this plan. The spec owns the behaviour; this plan owns names, files, and tests.

## Global Constraints

- Work in `.worktrees/tracking-setup-walkthrough` on branch `tracking-setup-walkthrough`. Verify `pwd` before each Git command. Do not use `git -C` or `cd … &&`.
- Do not attribute commits to an agent. No `Co-Authored-By` trailer, no "Generated with" line. Do not push.
- Commit subjects follow the repo style, for example `Add the tracking probe call (TRK-23 S1)`.
- pnpm only. Functional TypeScript, plain data. Comment only logic that is hard to follow.
- Each contract change goes in TypeScript (`packages/contracts`) and Rust (`crates/contracts`) in the same task. Rust structs use `deny_unknown_fields`, so a new optional field needs `#[serde(default, skip_serializing_if = "Option::is_none")]`.
- Update `ARCHITECTURE.md` in the same commit that adds a call, a data path, or a trust check.
- UI copy is short. No helper text that repeats a control. No card grid, gradient, badge, or side bar on the selected step. One primary action for each step.
- Spec values, copied exactly:
  - The rise threshold is 0.05.
  - Fit: `inputMin = min(neutral + 0.02, peak - 0.05)`, `inputMax = max(peak × 0.9, inputMin + 0.05)`, `outputMin = 0`, `outputMax = 1`.
  - The Relax countdown is 3 s.
  - An expression step is done 1 s after the peak stops rising. It is not sent when the channel is unchanged for 4 s while other channels change.
  - Eye conversion uses 20° horizontal and 15° vertical.
  - The guide polls at 10 Hz.
  - On Tracking Lost defaults to After = 2 s.
  - Presets bind `0.0.0.0`. SelfReflect and generic VMC use port 39539. iFacialMocap uses port 49983.
- Test commands:
  - `pnpm test:unit`
  - `pnpm test:integration`
  - `pnpm check`
  - `cargo test --workspace --no-fail-fast`
  - `cargo clippy --workspace --all-targets`
  - Keep the files you change clean for `cargo fmt`.

## Review Focus

1. **Two names for one channel.** A sender can send both `eyeBlink_L` and `eyeBlinkLeft`, as iFacialMocap variants do. The probe values, the peaks, and the fit must merge them by canonical name and take the max. Test in Task 3.
2. **The source restarts during the guide.** When the generation changes (the receiver restarts or the port changes), the old peaks are cleared. The fit must never use peaks from an earlier generation. Test in Task 3.
3. **A second character already uses VMC 39539.** The guide on character B asks for the phone's address. It never rebinds character A's source. Test in Task 8.
4. **Cancel after the show changed.** If the performer cancels after the fit, or after a `sceneReplace` removed the source, the cancel plan sends no operation for an entity that is gone. Test in Task 8.
5. **The sender goes stale during Relax.** If the sender stops during the countdown, the guide must not capture a neutral of zeros. It waits until the probe state is `receiving` again. Test in Task 7.

---

## Part 0: Spec-first contracts

### Task 1: Slice contracts and dependency plan

**Files:**
- Create: `spdd/analysis/2026-10-21-tracking-setup-walkthrough.md`
- Create: `spdd/prompt/2026-10-21-tracking-setup-s1-probe-fit.md`
- Create: `spdd/prompt/2026-10-21-tracking-setup-s2-guide.md`
- Create: `spdd/prompt/2026-10-21-tracking-setup-s3-selfreflect-gates.md`
- Create: `spdd/prompt/2026-10-21-tracking-setup-s4-tracking-nodes.md`

- [ ] **Step 1:** Read `spdd/prompt/2026-10-18-calibration-tracking-overrides.md` and `spdd/prompt/2026-10-18-blueprint-i-input-devices.md` as format examples.
- [ ] **Step 2:** Write the analysis with requirements R1…Rn taken from the spec sections:
  - Presets
  - Smoothing
  - Commands
  - Step behaviour
  - Range fit
  - Cancel
  - Eye movement
  - SelfReflect fixes
  - Coach
  - Guide UI
  - Blueprint nodes

  Record the two behaviour changes in their own section:
  - `useEyeBones` default `true` drops `eyeLook*` when eye bones are present.
  - A source with no mapping now gets the eye rule applied.
- [ ] **Step 3:** Write the four REASONS contracts. Each contract has all seven sections, lists its tasks from this plan, and names the interfaces from the Interfaces blocks below. In S4, record that it depends on S1 only through the contracts package.
- [ ] **Step 4:** Commit: `Add the guided tracking setup slice contracts (TRK-23)`.

---

## Part A: Slice 1, probe and fit

### Task 2: Eye movement mode

**Files:**
- Modify: `packages/contracts/src/tracking.ts`: add `useEyeBones?: boolean` to `TrackingMapping` and `useEyeBones: z.boolean().optional()` to `TrackingMappingSchema`.
- Modify: `crates/contracts/src/tracking.rs`: replace the `object!(TrackingMapping …)` with a handwritten struct that has the same derives and `#[serde(default, skip_serializing_if = "Option::is_none")] pub use_eye_bones: Option<bool>`.
- Create: `packages/session/src/eye-movement.ts`
- Modify: `packages/session/src/tracking-mapping.ts`: `applyMapping` calls `applyEyeMovement` last. With `mapping === undefined`, it applies only the eye rule.
- Modify: `apps/desktop/src/components/TrackingMappingFields.svelte`: add a "Use bones for eye movement" checkbox. It commits `setTrackingMapping` with the flag. Unchecked means `false`; absent shows as checked.
- Modify: `apps/mcp/src/server.ts`: in the `scene_patch` description, add "and useEyeBones (default true: eye bones move the eyes; false: eyeLook blend shapes move the eyes)".
- Modify: `fixtures/protocol/tracking-overrides.json`: add one mapping with `"useEyeBones": false`.
- Test: `packages/session/test/eye-movement.test.ts`, `crates/contracts/src/tracking.rs` `#[cfg(test)]`

**Interfaces:**
- Produces:
  - `EYE_MAX_DEGREES = { horizontal: 20, vertical: 15 } as const`
  - `applyEyeMovement(sample: TrackingSample, useEyeBones: boolean): TrackingSample`
  - `eyeLookToRotation(values: {in: number; out: number; up: number; down: number}, side: 'left' | 'right'): Quat`
  - `rotationToEyeLook(rotation: Quat, side: 'left' | 'right'): {in: number; out: number; up: number; down: number}`

- [ ] **Step 1: Write the failing tests:**

```ts
test('bones mode drops eyeLook channels when the sample has eye bones', () => {
  const out = applyEyeMovement(sample({ bones: { leftEye: eye(10, 0), rightEye: eye(10, 0) }, expressions: { eyeLookOutLeft: .5, jawOpen: .3 } }), true);
  expect(out.expressions).toEqual({ jawOpen: .3 });
  expect(out.bones.leftEye).toBeDefined();
});
test('bones mode converts eyeLook into eye bones when the sample has no eye bones', () => {
  const out = applyEyeMovement(sample({ expressions: { eyeLookOutLeft: 1, eyeLookInRight: 1 } }), true);
  expect(yawDegrees(out.bones.leftEye!.rotation)).toBeCloseTo(20 * LEFT_SIGN, 3); // both eyes look to the character's left
  expect(out.expressions.eyeLookOutLeft).toBeUndefined();
});
test('blend shape mode converts eye bones into eyeLook and drops the bones', () => {
  const out = applyEyeMovement(sample({ bones: { leftEye: eye(0, 15), rightEye: eye(0, 15) } }), false);
  expect(out.expressions.eyeLookUpLeft).toBeCloseTo(1, 3);
  expect(out.bones.leftEye).toBeUndefined();
});
test('blend shape mode keeps sent eyeLook and drops the bones', () => { /* both present → eyeLook kept, bones removed */ });
test('the conversion clamps past the maximum angle', () => { expect(rotationToEyeLook(eyeQuat(40, 0), 'left').out).toBe(1); });
test('round trip', () => { /* rotationToEyeLook(eyeLookToRotation(v, side), side) ≈ v for v in {in:.5}, {down:.25} */ });
test('applyMapping with no mapping applies the eye rule with useEyeBones true', () => {});
test('a mapping without useEyeBones parses and reads as true', () => {});
```

  `LEFT_SIGN` and the axis convention come from the VRM normalized bone space, which is the same space as `eulerToQuat` in `bone-offsets.ts`. The test names the meaning ("looks to the character's left"). The implementer fixes the sign once and uses it in both directions. Each sender name is matched with `canonicalArkitName`.

  Add a Rust test: a mapping JSON with and without `useEyeBones` round-trips unchanged.
- [ ] **Step 2:** Run `pnpm test:unit -- eye-movement` and `cargo test -p opensekai-contracts`. Expected: the tests FAIL.
- [ ] **Step 3:** Implement the functions. Use horizontal `h = clamp(yaw / 20°, -1, 1)`, with + meaning the character's left, and vertical `v = clamp(pitch / 15°, -1, 1)`, with + meaning up:
  - Left eye: `out = max(0, h)`, `in = max(0, -h)`.
  - Right eye: `out = max(0, -h)`, `in = max(0, h)`.
  - Both eyes: `up = max(0, v)`, `down = max(0, -v)`.

  The inverse uses `yaw = (out - in) × 20°` for the left eye and `(in - out) × 20°` for the right eye, and `pitch = (up - down) × 15°`. Output bones use `space: 'normalized'`. `eyeIntensity` is already applied to the bones earlier in `applyMapping`. In blend shape mode, scale the converted `eyeLook*` values by `eyeIntensity` and clamp them to 0…1.
- [ ] **Step 4:** Run the same commands. Expected: PASS. Then run `pnpm check`.
- [ ] **Step 5:** Commit: `Add the eye movement mode to face mapping (TRK-23 S1, TRK-04)`.

### Task 3: Tracking probe call

**Files:**
- Modify: `packages/contracts/src/tracking.ts`: add `TrackingProbe`, `TrackingProbeParamsSchema`, and `TrackingProbeSchema`.
- Modify: `packages/contracts/src/schema.ts`: register `trackingProbe` in the param map (about line 497), the result map (about line 527), and the method list (about line 547).
- Modify: `packages/contracts/src/types.ts`: add `trackingProbe(params: TrackingProbeParams): Promise<Reply<TrackingProbe>>` to `AppApi`.
- Modify: `crates/contracts/src/tracking.rs`: add the `TrackingProbeParams` and `TrackingProbe` structs.
- Modify: `crates/contracts/src/lib.rs`: in the params validation (about line 2201), add `"trackingProbe"`, which requires `id_text_ok(&p.source_id)`. Add it to the method list (about line 2262). In the result validation (about line 2303), decode `TrackingProbe` and validate it.
- Modify: `packages/session/src/tracking.ts`: the composer keeps peaks for each source and adds `probe(...)`.
- Modify: `packages/session/src/session.ts`: add `probeTracking(params)`. Keep the last `trackingStatus` from `advance`.
- Modify: `packages/session/src/session-api.ts`: add `'trackingProbe'` to `SESSION_METHODS` and its handler.
- Modify: `apps/desktop/src-tauri/src/service/router.rs`: add `"trackingProbe"` to the two relay lists (about lines 207 and 372), next to `blueprintInspect`, with the same capability.
- Modify: `apps/mcp/src/tools.ts`: add `tracking_probe: 'trackingProbe'`.
- Modify: `apps/mcp/src/server.ts`: add a `tracking_probe` description. It reads the smoothed ARKit values of a source before calibration and mapping, the peaks since the last reset (`resetPeaks: true` resets them), the channels the sender includes, and whether it sends eye bones.
- Modify: `ARCHITECTURE.md`, Command path: `trackingProbe` relays like `blueprintInspect`. Tracking path: the session keeps run peaks for each source as runtime state that is never saved.
- Create: `fixtures/tracking/selfreflect-replay.json`: trim `selfreflect-probe.jsonl.gz` to about 60 packets that include the T-pose frame, one `jawOpen` rise, and one repeated-frame run. Then delete the `.gz` file. It was never committed.
- Test:
  - `packages/session/test/tracking-probe.test.ts`
  - `apps/mcp/test/tracking-probe.integration.test.ts` (boundary: MCP stdio to the session fixture, as in `calibration.integration.test.ts`)
  - `crates/contracts` `#[cfg(test)]`

**Interfaces:**
- Produces:
  - `TrackingProbeParams = { sourceId: Id; resetPeaks?: boolean }`
  - `TrackingProbe = { sourceId: Id; generation: number; state: TrackingStatus['state']; values: Partial<Record<ArkitName, number>>; peaks: Partial<Record<ArkitName, number>>; presentChannels: ArkitName[]; eyeBones: boolean }`. `ArkitName` is `typeof ARKIT_NAMES[number]`. Export it if it is not exported already.
  - The composer gets `probe(sourceId: string, nowMs: number, resetPeaks: boolean): Omit<TrackingProbe, 'state'> | null`.
  - `Session.probeTracking(params: TrackingProbeParams): Reply<TrackingProbe>`. It fails with `NOT_FOUND` for an unknown ID, and with `INVALID_INPUT` ("Entity is not a tracking source") for an entity that is not a tracking source.
  - `Session.runPeaks(sourceId: string): Partial<Record<ArkitName, number>>`, for Task 4.

- [ ] **Step 1: Write the failing tests:**

```ts
test('values are smoothed, canonical, and before mapping', () => { /* ingest with a mapping range on jawOpen; probe.values.jawOpen equals the smoothed raw value, not the mapped one */ });
test('two sender names for one channel merge by max', () => { /* expressions {eyeBlink_L:.2, eyeBlinkLeft:.6} → values.eyeBlinkLeft .6, presentChannels has eyeBlinkLeft once */ });
test('peaks keep the max until resetPeaks', () => { /* .1, .4, .2 → peak .4; probe with resetPeaks → next ingest .2 → peak .2 */ });
test('a generation change clears the peaks', () => { /* peak .4 at gen 1; setTrackingConfig → gen 2; first gen-2 sample .1 → peak .1 */ });
test('eyeBones is true only when leftEye and rightEye are in the sample', () => {});
test('probeTracking rejects an unknown id and an avatar id', () => {});
test('state comes from the last advance', () => { /* receiving, then stale after 500 ms without samples */ });
```

  Also write these tests:
  - **MCP integration:** `tracking_probe` returns values for a source that the fixture feeds.
  - **Rust:** the params validation rejects an empty `sourceId`, and the result validation rejects a value above 1.
- [ ] **Step 2:** Run `pnpm test:unit -- tracking-probe`, `pnpm test:integration -- tracking-probe`, and `cargo test -p opensekai-contracts`. Expected: the tests FAIL.
- [ ] **Step 3:** Implement. Update the peaks in `ingest` from the filtered sample. Keep a separate map for each source, keyed by canonical name. Clear the map when `dropSample` runs or the generation changes. `values` come from `currentSample` (500 ms or newer). Without a current sample, `values` is `{}`.
- [ ] **Step 4:** Run the same commands, and also `pnpm check`. Expected: PASS.
- [ ] **Step 5:** Commit: `Add the tracking probe call (TRK-23 S1)`.

### Task 4: Fit blend shape ranges

**Files:**
- Create: `packages/session/src/blend-shape-fit.ts`
- Modify: `packages/contracts/src/schema.ts`: add `z.strictObject({kind: z.literal('fitBlendShapeRanges'), entityId: IdSchema, neutral: z.partialRecord(z.enum(ARKIT_NAMES), n01)})` next to `calibrateTracking` (about line 257).
- Modify: `packages/contracts/src/types.ts`: add it to `LivePatchOp`.
- Modify: `crates/contracts/src/lib.rs`: add `PatchOp::FitBlendShapeRanges { entity_id, neutral: BTreeMap<String, f64> }`. Validate that each key is an ARKit name and each value is 0…1.
- Modify: `packages/session/src/scene-ops.ts:86`: add `case 'fitBlendShapeRanges': return failure('INVALID_INPUT','Blend shape fit needs a live session',[entity.id]);`.
- Modify: `packages/session/src/session.ts`: extend `resolveCalibrations`. It resolves the operation into `setTrackingMapping` with the same checks as `calibrateTracking`, and it rejects a fit in the same patch as `setTrackingConfig` or `removeEntity` for that source.
- Modify: `apps/desktop/src/editor/model.ts`: add `fitBlendShapeRanges(entityId: Id, neutral: Partial<Record<ArkitName, number>>, expectedRevision?: number)`, next to `calibrateTracking`.
- Modify: `apps/mcp/src/server.ts`: in the `scene_patch` description, add: "fitBlendShapeRanges sets the range of each ARKit blend shape whose peak since the last tracking_probe resetPeaks rose 0.05 above its neutral; it fails with INVALID_INPUT when no channel rose or the source has no current sample".
- Modify: `ARCHITECTURE.md`, Tracking path, step 3: `fitBlendShapeRanges` resolves in the live session like `calibrateTracking`.
- Test:
  - `packages/session/test/blend-shape-fit.test.ts`
  - Add a case to `apps/mcp/test/tracking-probe.integration.test.ts`
  - Rust `#[cfg(test)]`

**Interfaces:**
- Consumes: `Session.runPeaks` (Task 3).
- Produces:
  - `RISE = .05`
  - `fitRanges(neutral: Partial<Record<ArkitName, number>>, peaks: Partial<Record<ArkitName, number>>): Partial<Record<ArkitName, BlendShapeRange>>`
  - `mergeFit(mapping: TrackingMapping | undefined, fitted: Partial<Record<ArkitName, BlendShapeRange>>): TrackingMapping`. It starts from `DEFAULT_TRACKING_MAPPING`, keeps the existing ranges and fields, and replaces only the fitted channels.

- [ ] **Step 1: Write the failing tests:**

```ts
test('SelfReflect jawOpen', () => expect(fitRanges({ jawOpen: 0 }, { jawOpen: .187 }).jawOpen).toEqual({ inputMin: .02, inputMax: .187 * .9, outputMin: 0, outputMax: 1 }));
test('a channel below the rise gets no range', () => expect(fitRanges({ cheekPuff: 0 }, { cheekPuff: .04 })).toEqual({}));
test('a high resting value stays valid', () => { const r = fitRanges({ eyeSquintLeft: .3 }, { eyeSquintLeft: .36 }).eyeSquintLeft!; expect(BlendShapeRangeSchema.safeParse(r).success).toBe(true); expect(r.inputMin).toBeCloseTo(.31); });
test('a full peak stays inside 0..1', () => { const r = fitRanges({ eyeBlinkLeft: 0 }, { eyeBlinkLeft: 1 }).eyeBlinkLeft!; expect(r.inputMax).toBeCloseTo(.9); });
test('a missing neutral counts as 0', () => {});
test('mergeFit keeps other ranges and fields', () => {});
test('the live patch saves the merged mapping and increases the revision once', () => {});
test('no channel rose → INVALID_INPUT with the source id', () => {});
test('offline apply fails with "Blend shape fit needs a live session"', () => {});
```

  For each fitted range, assert that `inputMin` is at least 0, `inputMin` is less than `inputMax`, and `inputMax` is at most 1.
- [ ] **Step 2:** Run `pnpm test:unit -- blend-shape-fit` and `cargo test -p opensekai-contracts`. Expected: the tests FAIL.
- [ ] **Step 3:** Implement as the Interfaces block says. The fit counts as risen when `peak - neutral >= RISE`.
- [ ] **Step 4:** Run the tests, `pnpm test:integration -- tracking-probe`, and `pnpm check`. Expected: PASS.
- [ ] **Step 5:** Commit: `Add the blend shape range fit (TRK-23 S1)`.

### Task 5: Presets and the asset eye-bone flag

**Files:**
- Create: `packages/contracts/src/tracking-presets.ts`, exported from the package index.
- Modify: `packages/contracts/src/types.ts:135` and `crates/contracts/src/lib.rs:499`: add `eyeBones?: boolean` to `AssetRecord` (Rust: `Option<bool>` with the serde default attributes).
- Modify: `apps/desktop/src-tauri/src/assets/vrm.rs`: set `eyeBones` to true when the humanoid bone list (VRM 0 `humanBones`, VRM 1 `humanBones`) has both `leftEye` and `rightEye`. Write it where the record is built.
- Test: `packages/contracts/test/tracking-presets.test.ts`, `vrm.rs` `#[cfg(test)]`

**Interfaces:**
- Produces:
  - `type TrackingPresetId = 'selfreflect' | 'ifacialmocap' | 'vmc'`
  - `type ExpressionStepId = 'blink' | 'mouthWide' | 'browsUp' | 'smile' | 'frown' | 'pucker' | 'puffCheeks' | 'tongueOut' | 'lookAround'`
  - `interface TrackingPreset { id: TrackingPresetId; label: string; config: TrackingConfig; slots: readonly ('body' | 'face' | 'fingers')[]; connect: 'showAddress' | 'askPhone'; smoothing: TrackingSmoothing; steps: readonly ExpressionStepId[] }`
  - `TRACKING_PRESETS: readonly TrackingPreset[]`, in the order SelfReflect, iFacialMocap, Other VMC app.
  - `EXPRESSION_STEPS: Record<ExpressionStepId, { main: readonly ArkitName[]; also: readonly ArkitName[] }>`, with the channels from the spec table expanded to explicit Left and Right names. `lookAround` has `main` set to the 8 `eyeLook*` names and an empty `also`.

- [ ] **Step 1: Write the failing tests:**
  - Each preset's `config` passes `TrackingConfigSchema` with `enabled: true`.
  - Each `smoothing` passes `TrackingSmoothingSchema` and equals `DEFAULT_TRACKING_SMOOTHING`. Task 10 can change the SelfReflect values.
  - The iFacialMocap preset has `slots` equal to `['face']` and `connect` equal to `'askPhone'`.
  - Each step channel is in `ARKIT_NAMES`.
  - Each preset lists all nine steps in the spec table order.
  - **Rust:** a VRM 1 JSON with eye bones gives `eye_bones: Some(true)`. Without them, it gives `Some(false)`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the data and the flag.
- [ ] **Step 4:** Run `pnpm test:unit -- tracking-presets`, `cargo test --workspace --no-fail-fast`, and `pnpm check`. Expected: PASS.
- [ ] **Step 5:** Commit: `Add the tracking presets and the VRM eye-bone flag (TRK-23 S1)`.

### Task 6: SelfReflect replay through the host

**Files:**
- Modify: `apps/desktop/src-tauri/tests/tracking_integration.rs`
- Possibly create: a helper that encodes OSC from the replay JSON.

**Interfaces:**
- Consumes: `fixtures/tracking/selfreflect-replay.json` (Task 3).

- [ ] **Step 1: Write the failing test** `selfreflect_replay_decodes_bones_and_lowercase_arkit`. It encodes each replay packet as OSC, sends it over UDP to a VMC endpoint on `127.0.0.1` with an ephemeral port, and checks the following. The boundary is a real UDP socket through the host tracking manager.
  - `originalHips` is absent and `hips` is present.
  - The thumb names are remapped.
  - `jawOpen` is present, and no `eyeLook*` channel is present.
  - `leftEye` and `rightEye` are present.
  - The packet count matches.
- [ ] **Step 2:** Run `cargo test -p opensekai-desktop --test tracking_integration selfreflect`. Expected: the test FAILS (it is not written yet), or the parser shows a defect. In that case, stop and record the defect for Task 10.
- [ ] **Step 3:** Make the test pass. Change only the test helper, unless the parser has a defect.
- [ ] **Step 4:** Run `cargo test --workspace --no-fail-fast`. Expected: PASS.
- [ ] **Step 5:** Commit: `Replay a SelfReflect recording through the VMC receiver (TRK-23 S1, TRK-01)`.

---

## Part B: Slice 2, the guide

### Task 7: Guide state machine

**Files:**
- Create: `apps/desktop/src/editor/tracking-guide.ts`
- Test: `apps/desktop/test/tracking-guide.test.ts`

**Interfaces:**
- Consumes: `TrackingPreset`, `EXPRESSION_STEPS`, `TrackingProbe`.
- Produces:
  - `type GuideStep = 'pick' | 'connect' | 'relax' | 'expressions' | 'review'`
  - `type StepResult = 'done' | 'notSent' | 'skipped'`
  - `interface GuideState { step: GuideStep; preset: TrackingPreset | null; sourceId: Id | null; relaxStartMs: number | null; neutral: Partial<Record<ArkitName, number>>; index: number; stepPeak: number; stepStartMs: number; lastRiseMs: number | null; lastMainChangeMs: number; lastOtherChangeMs: number | null; previous: TrackingProbe | null; results: Partial<Record<ExpressionStepId, StepResult>>; fitError: string | null }`
  - `type GuideEvent = { kind: 'pick'; preset: TrackingPreset } | { kind: 'connected'; sourceId: Id } | { kind: 'probe'; probe: TrackingProbe; nowMs: number } | { kind: 'next'; nowMs: number } | { kind: 'fitted' } | { kind: 'fitFailed'; message: string }`
  - `type GuideEffect = { kind: 'connect'; preset: TrackingPreset } | { kind: 'resetPeaks' } | { kind: 'calibrate' } | { kind: 'fit'; neutral: Partial<Record<ArkitName, number>> }`
  - `initialGuide(): GuideState`
  - `guideStep(state: GuideState, event: GuideEvent): { state: GuideState; effects: GuideEffect[] }`
  - `mainValue(probe: TrackingProbe, step: ExpressionStepId): number`: the max over `main`.

- [ ] **Step 1: Write the failing tests** (`t` is ms):

```ts
test('pick emits connect; connected enters relax', () => {});
test('connect waits until the probe state is receiving', () => {});
test('relax captures probe.values as neutral at 3000 ms and emits resetPeaks', () => {});
test('relax with iFacialMocap also emits calibrate', () => {});
test('relax does not capture while the probe is stale; it captures at the first receiving probe after 3000 ms', () => {}); // Review Focus 5
test('a step is done 1000 ms after the peak stops rising above neutral + .05', () => {});
test('a step whose main channels are absent from presentChannels is notSent at once', () => {});
test('a step whose main value is unchanged for 4000 ms while another channel changes is notSent', () => {});
test('a step whose main value is unchanged while no channel changes stays open', () => {});
test('next skips a step', () => {});
test('lookAround with only eye bones waits for next; with neither eyeLook nor eye bones it is notSent', () => {});
test('after the last step: emits fit with neutral; fitted enters review; fitFailed enters review with fitError', () => {});
```

- [ ] **Step 2:** Run `pnpm test:unit -- tracking-guide`. Expected: FAIL.
- [ ] **Step 3:** Implement `guideStep` as a pure function. It never reads the clock; time comes only from `nowMs`. A "change" means that a value differs from the value in `previous` by more than 0.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Add the tracking guide state machine (TRK-23 S2)`.

### Task 8: Connect and cancel plans

**Files:**
- Create: `apps/desktop/src/editor/tracking-guide-plan.ts`
- Test: `apps/desktop/test/tracking-guide-plan.test.ts`

**Interfaces:**
- Consumes: `TrackingPreset`, the tracking source entity builder in `apps/desktop/src/editor/authoring.ts` (about line 31), and `AssetRecord.eyeBones`.
- Produces:
  - `interface ConnectPlan { operations: PatchOp[]; sourceId: Id; created: boolean; needsPhone: boolean }`
  - `planConnect(scene: SceneView, avatarId: Id, preset: TrackingPreset, phoneAddress: string | null, eyeBones: boolean | undefined, newId: Id): ConnectPlan`
  - `interface GuideSnapshot { avatarId: Id; tracking: AvatarTracking | undefined; sourceId: Id; created: boolean; mapping: TrackingMapping | undefined }`
  - `planCancel(scene: SceneView, snapshot: GuideSnapshot, fitSent: boolean): PatchOp[]`

- [ ] **Step 1: Write the failing tests.** `planConnect` must follow the order from the spec's Commands section, and the tests check that order:
  1. A same-kind source in the character's own slot is reused, and `setTrackingConfig` is sent only when the config differs.
  2. A free same-kind source is adopted.
  3. Character A holds VMC on 39539. For B, the result is `needsPhone: true` and no operations, and A's bindings are untouched (Review Focus 3). With a phone address, a new source gets `senderAddress` (VMC) or `phoneAddress` (iFacialMocap).
  4. Otherwise, a new source is created.

  Each plan has these properties:
  - It enables the config.
  - It binds only the preset's slots. iFacialMocap binds `faceSourceId` and keeps body and fingers.
  - It writes `setTrackingSmoothing` with the preset values unless `smoothing?.enabled === true`.
  - It writes `setTrackingMapping` with `useEyeBones: eyeBones ?? true`, and it keeps the existing mapping fields.

  `planCancel` has these rules:
  - A created source gives `removeEntity`.
  - A reused source gives `setAvatarTracking` with the snapshot, plus `setTrackingMapping` with the snapshot mapping when `fitSent` is true. When the snapshot mapping is `undefined`, it uses `DEFAULT_TRACKING_MAPPING`.
  - If the source is no longer in `scene`, the plan has no operation for it. If the avatar is gone, the plan is empty (Review Focus 4).
- [ ] **Step 2:** Run `pnpm test:unit -- tracking-guide-plan`. Expected: FAIL.
- [ ] **Step 3:** Implement. "Same endpoint" means the same kind and the same port, used by another avatar's `tracking`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Plan the tracking guide connect and cancel patches (TRK-23 S2)`.

### Task 9: Coach, guide panel, and entry

**Files:**
- Create: `apps/desktop/src/editor/coach-face.ts`: pure shape and keyframe functions.
- Create: `apps/desktop/src/components/CoachFace.svelte`: an SVG face with `requestAnimationFrame`. With `prefers-reduced-motion`, it shows only the target pose.
- Create: `apps/desktop/src/components/TrackingGuide.svelte`: renders `GuideState` and runs the effects through `model` and `api.trackingProbe`. It polls every 100 ms while it is open and stops when it closes.
- Create: `apps/desktop/src/components/GuideMeter.svelte`: a bar with a peak tick. There is no kit component for this.
- Modify: `apps/desktop/src/components/AvatarSourceFields.svelte`: add a "Set up tracking" `Button` from `@oshi-connect/ui` that calls `onguide?.(entityId)`.
- Modify: `apps/desktop/src/components/Inspector.svelte` and `apps/desktop/src/EditorApp.svelte`: while a guide is open for an avatar, the properties column renders `TrackingGuide` in place of the Inspector. The scene view does not change.
- Test: `apps/desktop/test/coach-face.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 5, 7, and 8.
- Produces:
  - `interface CoachShape { jaw: number; mouthWidth: number; mouthCurve: number; pucker: number; lidScreenLeft: number; lidScreenRight: number; browScreenLeft: number; browScreenRight: number; cheekPuff: number; tongue: number; pupil: [number, number] }`. All values are 0…1, except `pupil`, which is -1…1.
  - `coachShape(values: Partial<Record<ArkitName, number>>): CoachShape`
  - `interface CoachFrame { atMs: number; values: Partial<Record<ArkitName, number>> }`
  - `COACH_LOOPS: Record<ExpressionStepId, { loopMs: number; frames: readonly CoachFrame[] }>`
  - `sampleLoop(loop: { loopMs: number; frames: readonly CoachFrame[] }, tMs: number): Partial<Record<ArkitName, number>>`, with linear interpolation that wraps at `loopMs`.

- [ ] **Step 1: Write the failing tests:**
  - **Mirror view:** `coachShape({eyeBlinkLeft: 1}).lidScreenLeft === 1` and `lidScreenRight === 0`. The performer's left shows on the screen's left.
  - `coachShape({jawOpen: 1}).jaw === 1`.
  - `coachShape({eyeLookOutLeft: 1, eyeLookInRight: 1}).pupil[0] < 0`, so the pupils move to the screen's left.
  - `sampleLoop` at `loopMs / 2` between frames 0 and 1 gives the midpoint, and at `loopMs + 10` it gives the value at 10.
  - Each `COACH_LOOPS` step reaches 1 on each of its `main` channels at some frame.
- [ ] **Step 2:** Run `pnpm test:unit -- coach-face`. Expected: FAIL.
- [ ] **Step 3:** Implement the pure functions. Then build the components. The screen copy for each step:
  - **Pick:** three tiles with the preset labels.
  - **Connect:** "Send VMC to" with the large address and port, or a phone address `Input` for iFacialMocap and for `needsPhone`. "Waiting for data" uses a `Spinner`.
  - **Relax:** "Relax your face" with the countdown.
  - **Expressions:** one short imperative for each step ("Blink", "Open your mouth wide", "Raise your brows", "Smile", "Frown", "Pucker your lips", "Puff your cheeks", "Stick out your tongue", "Look around"), the meter, and Skip. Look around also shows the "Use bones for eye movement" checkbox. It writes `setTrackingMapping` at once.
  - **Review:** Eyes, Mouth, and Brows meters, and Done.

  The guide gets the LAN address from `appStatus.localAddresses`. A close button runs `planCancel`.
- [ ] **Step 4:** Run `pnpm test:unit -- coach-face` and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Running-app check.**
  1. Check `pgrep -fl "tauri|vite"`. If the owner's dev app is running from the main checkout, do not touch the main checkout. Run this worktree's own dev build.
  2. Run `pnpm dev:desktop` in this worktree.
  3. Feed tracking with the iPhone SelfReflect app. Without the phone, replay `fixtures/tracking/selfreflect-replay.json` over UDP with a small `tsx` script in the scratchpad.
  4. Go through all five steps and check each one:
     - The guide docks in the properties column.
     - The scene stays at full size.
     - The coach moves.
     - `cheekPuff` and `tongueOut` auto-skip.
     - In Review, the character opens its mouth fully.
     - Cancel restores the old mapping.
     - Save, reopen, and restart the phone app: tracking returns with no steps.
  5. Take window screenshots into `docs/evaluation/tracking-setup-walkthrough/`.
- [ ] **Step 6:** Commit: `Add the guided tracking setup panel and coach (TRK-23 S2)`.

---

## Part C: Slice 3, SelfReflect gates

### Task 10: Run the three gates; add a fix only when a gate fails

**Files:**
- Create: `docs/evaluation/tracking-setup-walkthrough.md`: the evidence (backend, quality profile, fixture revision, commit, and a result for each gate).
- Modify, only if gate 1 fails:
  - `packages/contracts/src/tracking.ts` and `crates/contracts/src/tracking.rs`: VMC config `positions?: 'all' | 'rotationsOnly' | 'hipsOnly'`. Absent means `'all'`.
  - `packages/session/src/tracking.ts`: a pure `applyPositionRule(sample, rule)` before calibration.
  - The SelfReflect preset.
  - `fixtures/protocol/validation-vectors.json`.
  - `ARCHITECTURE.md`.
- Modify, only if gate 2 fails: the tracking entity `staleMs?: number` (500…2000) in TypeScript and Rust. `packages/session/src/tracking.ts` uses it in place of 500 for stale and the fade start. The SelfReflect preset sets it. Update `ARCHITECTURE.md`.
- Modify, only if gate 3 selects other values: the SelfReflect `smoothing` in `tracking-presets.ts`, and its test.

- [ ] **Step 1:** Run the dev build with the real SelfReflect stream. Set up a character with the guide.
- [ ] **Step 2: Gate 1 (positions).** Look at the arms and the hips height. Record what you see and a screenshot.
- [ ] **Step 3: Gate 2 (stalls).** Watch the character for 2 min. Record any flicker toward neutral and the time stamps of the stalls (`trackingProbe` state changes).
- [ ] **Step 4: Gate 3 (smoothing).** Compare the defaults with one stronger setting (for example `minCutoff` 2, `beta` 0.3) in the same run. Record which one looks better and why.
- [ ] **Step 5:** For each failed gate, apply the fix above with tests first. For example: `applyPositionRule rotationsOnly removes every position` and `hipsOnly keeps only hips`, or `staleMs 1000 keeps a 700 ms gap at full weight`. Then run `pnpm test:unit`, `cargo test --workspace --no-fail-fast`, and `pnpm check`.
- [ ] **Step 6:** Commit: `Record the SelfReflect gates (TRK-23 S3)`. Add the fixes the gates selected to the same commit.

---

## Part D: Slice 4, tracking nodes

Part D can run in a parallel worktree after Task 3 merges (it uses the exported `ArkitName`). It touches no file in Parts A to C, except the contracts index, `session.ts`, and `ARCHITECTURE.md`; the integrator merges those.

### Task 11: Tracking category and Get Tracking Blend Shape

**Files:**
- Modify: `packages/contracts/src/blueprint-nodes/define.ts:9`: add `'Tracking'` to `NODE_CATEGORIES` after `'Character'`. Add the field kind `'trackingSource'` to the entity field union (line 15).
- Create: `packages/contracts/src/blueprint-nodes/tracking.ts`, registered in `blueprint-nodes/index.ts`.
- Create: `packages/session/src/blueprint-eval/tracking.ts`, registered in `blueprint-eval/index.ts` `EVALUATORS`.
- Modify: `apps/desktop/src/components/BlueprintNodeFields.svelte:53-86`: render `trackingSource` as a select of the scene's tracking entities.
- Test: `packages/session/test/tracking-nodes.test.ts`

**Interfaces:**
- Produces:
  - Node `tracking.getBlendShape`:
    - Label "Get Tracking Blend Shape".
    - Settings `{ entityId: Id; blendShape: ArkitName }`.
    - Fields: `avatar`, and `blendShape` as a `choice` over `ARKIT_NAMES`.
    - Output `value: number`.
  - `trackedBlendShape(pose: AvatarPose | null, name: ArkitName): number`: the max over `pose.expressions` entries whose `canonicalArkitName` equals `name`, else 0.

- [ ] **Step 1: Write the failing tests:**
  - The node reads `.6` from a previous pose with `{eyeBlink_L: .6}` for `eyeBlinkLeft`.
  - It reads 0 with no pose.
  - The definition parses its defaults.
  - The palette lists it under Tracking. Use the existing node-search helper test pattern.
- [ ] **Step 2:** Run `pnpm test:unit -- tracking-nodes`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use `env.previousPose`, as `character.getBoneRotation` does.
- [ ] **Step 4:** Run the tests and `pnpm check`. Expected: PASS.
- [ ] **Step 5:** Commit: `Add the Get Tracking Blend Shape node (TRK-23 S4, BP-05)`.

### Task 12: Threshold, Lost, and Found event nodes

**Files:**
- Modify: `packages/contracts/src/blueprint-nodes/tracking.ts`
- Modify: `packages/session/src/blueprint-eval/types.ts`: add `trackingStatus?: (sourceId: Id) => TrackingStatus | null` to `RunEnv`.
- Modify: `packages/session/src/blueprint-runtime.ts`:
  - Add `{ kind: 'tracking' }` to `BlueprintEvent`.
  - Add `trackingEdges: Map<Id, TrackingEdge>` to `Active`. A new `Active` (after an install or a logic change) starts empty.
  - Handle the tracking event after `device` and before `update`.
- Modify: `packages/session/src/session.ts`:
  - Push `{ kind: 'tracking' }` between the device events and `{ kind: 'update' }` (line 350).
  - Keep `previousStatuses` from `live.trackingStatus` (line 375).
  - Pass `trackingStatus` in `env` (line 118).
- Modify: `packages/session/src/blueprint-eval/tracking.ts`
- Modify: `apps/mcp/src/resources.ts`: no change is needed if the node docs come from the registry. Confirm this.
- Modify: `ARCHITECTURE.md`, Blueprint runtime path: the tracking trigger phase and its edge state.
- Test: `packages/session/test/tracking-nodes.test.ts`, and add a session-level case to `packages/session/test/blueprint-session.test.ts`.

**Interfaces:**
- Produces:
  - Node `tracking.onBlendShapeThreshold`:
    - Label "On Blend Shape Threshold".
    - Settings `{ entityId; blendShape: ArkitName; threshold: number; release: number }`, with 0…1 and `release < threshold`. Defaults are `.5` and `.4`.
    - Outputs `rise: flow`, `fall: flow`, `value: number`.
  - Node `tracking.onLost`:
    - Label "On Tracking Lost".
    - Settings `{ sourceId: Id; after: number }`, with 0.1…60. The default is 2.
    - Output `flow`.
  - Node `tracking.onFound`:
    - Label "On Tracking Found".
    - Settings `{ sourceId: Id }`.
    - Output `flow`.
  - `type TrackingEdge = { kind: 'threshold'; above: boolean } | { kind: 'presence'; seen: boolean; lost: boolean; notReceivingSinceMs: number | null }`
  - `trackingTrigger(node: BlueprintNodeOf<'tracking.onBlendShapeThreshold' | 'tracking.onLost' | 'tracking.onFound'>, edge: TrackingEdge | undefined, env: StepEnv, nowMs: number): { edge: TrackingEdge; port: 'rise' | 'fall' | 'flow' | null }`

- [ ] **Step 1: Write the failing tests:**

```ts
test('threshold fires rise once when the value crosses up, and fall once below release', () => { /* .3,.6,.7,.45,.35,.6 → rise at .6, fall at .35, rise at .6 */ });
test('threshold does not fire again between release and threshold', () => {});
test('lost fires once after `after` seconds without receiving, only after the source was receiving', () => { /* receiving, stale 700 ms, receiving → nothing; then stale 2000 ms → flow once */ });
test('found fires once on receiving after a lost, not on the first receiving', () => {});
test('a reinstalled graph starts with empty edges', () => {});
test('session: a graph with On Blend Shape Threshold on jawOpen runs Set Expression in the same tick order (after devices, before On Update)', () => {});
```

- [ ] **Step 2:** Run `pnpm test:unit -- tracking-nodes blueprint-session`. Expected: FAIL.
- [ ] **Step 3:** Implement. Handle the tracking event like this:
  1. For each enabled graph, call `trackingTrigger` for each tracking event node.
  2. Store the edge on `entry.trackingEdges`.
  3. Call `fire(entry, { nodeId, port }, instant)` when `port` is not null.
  4. The threshold `value` output reads `trackedBlendShape`.
- [ ] **Step 4:** Run the tests, `pnpm test:unit`, and `pnpm check`. Expected: PASS.
- [ ] **Step 5:** Commit: `Add the tracking threshold, lost, and found nodes (TRK-23 S4, BP-06)`.

---

## Part E: Acceptance

### Task 13: OBS, MCP, and parity

**Files:**
- Modify: `docs/evaluation/tracking-setup-walkthrough.md`: add an OBS section, an MCP section, and a Blueprint section.
- Modify: `docs/warudo-parity.md`: update the TRK-23, TRK-01, TRK-04, BP-05, and BP-06 lines. Add a row to the evidence table. Claim only the behaviour that was verified.
- Modify: `spdd/prompt/2026-10-21-tracking-setup-s*.md`: sync the source and evidence status.

- [ ] **Step 1: MCP.** With the dev build running, drive the setup through `pnpm mcp`:
  1. `scene_patch` with the connect operations.
  2. `tracking_probe` with `resetPeaks: true`.
  3. Perform the faces.
  4. `scene_patch` with `fitBlendShapeRanges`.

  Check that the saved ranges equal `fitRanges` on the probed neutral and peaks.
- [ ] **Step 2: OBS.** Use the local WebSocket at `ws://127.0.0.1:4455` with an isolated OpenSekai test source. Do not stream. Keep the existing OBS settings.
  1. Check the transparent output with the SelfReflect-tracked character: full mouth open, gaze with the eye toggle on and off, and no broken arms.
  2. Record the backend, quality profile, fixture revision, and commit.
  3. Record a character with only `eyeLook*` morphs as checked or unknown.
- [ ] **Step 3: Blueprint.**
  1. Build a graph where On Blend Shape Threshold on `jawOpen` toggles an expression live.
  2. Build a graph where On Tracking Lost shows a toast when the phone app stops. It must not toast during SelfReflect's normal gaps.
  3. Record the results.
- [ ] **Step 4:** Run the full suite:
  - `pnpm test:unit`
  - `pnpm test:integration`
  - `pnpm check`
  - `cargo test --workspace --no-fail-fast`
  - `cargo clippy --workspace --all-targets`

  Record the counts.
- [ ] **Step 5:** Commit: `Record the guided tracking setup evidence and parity (TRK-23)`.
