# REASONS: Guided tracking setup, slice 1 (probe and fit)

Date: 2026-10-21. Scope: TRK-23 slice S1, with TRK-01 and TRK-04. Analysis: [guided tracking setup](../analysis/2026-10-21-tracking-setup-walkthrough.md). Design: [guided tracking setup](../../docs/superpowers/specs/2026-10-21-tracking-setup-walkthrough-design.md). Plan: [implementation plan](../../docs/superpowers/plans/2026-10-21-tracking-setup-walkthrough.md), Tasks 2 to 6. Related: [calibration and tracking overrides](2026-10-18-calibration-tracking-overrides.md), [S2 guide](2026-10-21-tracking-setup-s2-guide.md), [S3 gates](2026-10-21-tracking-setup-s3-selfreflect-gates.md), [S4 nodes](2026-10-21-tracking-setup-s4-tracking-nodes.md).

This file is the contract only. Implementation follows the plan tasks. The rules of the B5 and B6 contracts stay in force unless a requirement below changes them.

Status, 2026-10-26: implemented. Live check on macOS with SelfReflect: the probe, the 256-message OSC bundle limit, and the fit (40 of 40 ranges equal to `fitRanges` through MCP) pass. The eye bones option works in OBS. See the [evaluation](../../docs/evaluation/tracking-setup-walkthrough.md) and TRK-01 and TRK-04 in the parity checklist.

## Dependency plan

- S1 has no dependency inside this project. It comes first.
- S2 and S3 depend on S1. They can run in parallel.
- S4 depends on S1 only through the contracts package (the exported `ArkitName`). It can run in a parallel worktree after Task 3 merges.
- The integrator owns the contracts package, the lockfiles, `session.ts`, and `ARCHITECTURE.md`. Contract changes stay sequential.
- Task 13 (acceptance) spans S1 to S4 and runs last.

## Subset

This slice delivers and verifies these items. The parity notes use these words.

- **TRK-23 data and calls:** the presets, the `trackingProbe` call, the `fitBlendShapeRanges` operation, and the VRM eye-bone flag.
- **TRK-04 eye subset:** `useEyeBones`, the eye conversion, and the two behavior changes below.
- **TRK-01:** a SelfReflect recording replays through the VMC receiver in a Rust integration test. A real VMC sender on macOS is checked in S3 and Task 13.

Not in it: the guide (S2), the SelfReflect gates (S3), and the Blueprint nodes (S4).

## R — Requirements

### Eye movement (Task 2)

R1. `TrackingMapping` gets an optional field `useEyeBones: boolean`. A missing field reads as `true`. TypeScript (`packages/contracts`) and Rust (`crates/contracts`) accept and write the same shape. In Rust, `TrackingMapping` becomes a handwritten struct with `#[serde(default, skip_serializing_if = "Option::is_none")]` on `use_eye_bones`, so a missing field is not written back as `null`.
R2. `applyEyeMovement(sample, useEyeBones)` is a pure function. `applyMapping` calls it last, after the blend shape ranges. When a source has no mapping, `applyMapping` applies only the eye rule, with `useEyeBones` set to `true`.
R3. **Bones mode (`true`).** When the sample has eye bones, the output keeps them and drops each `eyeLook*` channel. When the sample has no eye bones, `eyeLookToRotation` converts the `eyeLook*` values into a rotation for each eye, and the output drops the `eyeLook*` channels.
R4. **Blend shape mode (`false`).** When the sample has `eyeLook*` channels, the output keeps them and drops the eye bones. When the sample has none, `rotationToEyeLook` converts each eye bone rotation into `eyeLook*` values, and the output drops the eye bones. `eyeIntensity` scales the converted `eyeLook*` values, and the values stay in 0 to 1.
R5. The conversion uses `EYE_MAX_DEGREES = { horizontal: 20, vertical: 15 }`. The horizontal value is `h = clamp(yaw / 20, -1, 1)`, with + for the character's left. The vertical value is `v = clamp(pitch / 15, -1, 1)`, with + for up. For the left eye, `out = max(0, h)` and `in = max(0, -h)`. For the right eye, `out = max(0, -h)` and `in = max(0, h)`. Both eyes use `up = max(0, v)` and `down = max(0, -v)`. The inverse uses `yaw = (out - in) x 20` degrees for the left eye, `(in - out) x 20` for the right eye, and `pitch = (up - down) x 15`. Output bones use `space: 'normalized'`. The code matches each sender name with `canonicalArkitName`.
R6. The inspector Face group of a tracking source (`TrackingMappingFields.svelte`) gets a "Use bones for eye movement" checkbox. It sends one `setTrackingMapping` with the flag. Unchecked means `false`. A missing value shows as checked. The `scene_patch` description in MCP names `useEyeBones`.

### Tracking probe (Task 3)

R7. A new read call `trackingProbe` takes `{ sourceId, resetPeaks? }` and returns `{ sourceId, generation, state, values, peaks, presentChannels, eyeBones }`.
  - `values` holds the current smoothed expressions, before calibration and mapping, keyed by canonical ARKit name. Each value is 0 to 1. A sample that is older than 500 ms, or a missing sample, gives `{}`.
  - `peaks` holds the maximum of each channel since the last reset.
  - `presentChannels` lists the canonical channels that the sender includes. A name appears once.
  - `eyeBones` is `true` only when the sample has both `leftEye` and `rightEye`.
  - `state` is the last tracking state that `advance` produced.
R8. Two sender names for one channel merge by canonical name and take the maximum, in `values`, in `peaks`, and in `presentChannels`.
R9. The session keeps the peaks for each source as runtime state. The state is never saved, never committed, and never put in a frame. The composer updates the peaks in `ingest` from the filtered sample. The session clears the peaks when `dropSample` runs, when the generation of the source changes, and when `resetPeaks` is `true` (after it reads them).
R10. `Session.probeTracking(params)` fails with `NOT_FOUND` for an unknown ID. It fails with `INVALID_INPUT` ("Entity is not a tracking source") for an entity that is not a tracking source. `Session.runPeaks(sourceId)` returns the peaks of a source, for R12.
R11. The host relays `trackingProbe` as it relays `blueprintInspect`, with the same capability. TypeScript and Rust both validate the params (a non-empty ID) and the result (each value in 0 to 1). MCP gets a `tracking_probe` tool, with a description that names the values, the peaks, the present channels, `resetPeaks`, and `eyeBones`.

### Range fit (Task 4)

R12. A new live patch operation `fitBlendShapeRanges { entityId, neutral }` follows the `calibrateTracking` pattern. The session resolves it before `applyOperations` into `setTrackingMapping`, with the same checks as `calibrateTracking`. It uses `runPeaks` and the `neutral` values (ARKit names, each 0 to 1). It fails with `INVALID_INPUT` and the source ID when no channel rose, or when the source has no current sample. A patch that has `fitBlendShapeRanges` and also `setTrackingConfig` or `removeEntity` for the same source fails with `INVALID_INPUT`. Offline, `applyOperations` fails with "Blend shape fit needs a live session". The revision rises once.
R13. `fitRanges(neutral, peaks)` is a pure function. A channel has risen when `peak - neutral >= RISE`, with `RISE = 0.05`. A missing neutral counts as 0. For each risen channel: `inputMin = min(neutral + 0.02, peak - 0.05)`, `inputMax = max(peak x 0.9, inputMin + 0.05)`, `outputMin = 0`, `outputMax = 1`. Each range satisfies the existing schema: `0 <= inputMin < inputMax <= 1`. A channel that did not rise gets no range, and an existing range for it stays.
R14. `mergeFit(mapping, fitted)` starts from `DEFAULT_TRACKING_MAPPING`, keeps the existing ranges and fields, and replaces only the fitted channels.

### Presets and the asset flag (Task 5)

R15. `TRACKING_PRESETS` is plain data in `packages/contracts/src/tracking-presets.ts`, in the order SelfReflect, iFacialMocap, Other VMC app. Each preset has `id`, `label`, `config`, `slots`, `connect`, `smoothing`, and `steps`. Each `config` passes `TrackingConfigSchema` with `enabled: true`. VMC presets bind `0.0.0.0` on port 39539. The iFacialMocap preset binds `0.0.0.0` on port 49983, has `slots` equal to `['face']`, and has `connect` equal to `'askPhone'`. Each `smoothing` equals `DEFAULT_TRACKING_SMOOTHING` until S3 changes the SelfReflect values.
R16. `EXPRESSION_STEPS` maps each of the nine step IDs to its `main` and `also` channels, with explicit Left and Right names, as the design table lists. `lookAround` has the eight `eyeLook*` names in `main` and an empty `also`. Each preset lists all nine steps in the design table order. Each channel is in `ARKIT_NAMES`.
R17. `AssetRecord` gets an optional `eyeBones: boolean`, in TypeScript and Rust (`Option<bool>` with the serde default attributes). The VRM parser writes `true` when the humanoid bone list (VRM 0 and VRM 1) has both `leftEye` and `rightEye`, and `false` otherwise.

### SelfReflect replay (Task 6)

R18. `fixtures/tracking/selfreflect-replay.json` is a trim of the probe recording: about 60 packets with the T-pose frame, one `jawOpen` rise, and one run of repeated frames. The large `.gz` file is deleted before the commit. A Rust integration test sends each packet as OSC over a real UDP socket to a VMC endpoint on `127.0.0.1` with an ephemeral port, through the host tracking manager. It checks that `originalHips` is absent and `hips` is present, that the thumb names are remapped, that `jawOpen` is present and no `eyeLook*` channel is present, that `leftEye` and `rightEye` are present, and that the packet count matches. A parser defect that the test shows is recorded for S3.

R18a. The replay showed a parser defect: every SelfReflect bundle has 102 OSC messages, and the VMC reader refused a bundle with more than 64. The reader now accepts up to 256 messages in one bundle (`MAX_OSC_MESSAGES`). The 8192-byte datagram limit, the depth limit of 4, and the 64-item limits for bones, expressions, and iFacialMocap channels do not change. This overrides the 64-message limit in the 2026-10-03 and 2026-10-18 tracking contracts. The largest replay packet is 6696 bytes (82% of the datagram limit). A sender that adds the `eyeLook*` channels to a full frame comes near that limit. S3 records this margin in its evidence.

### Behavior changes

R19. These changes alter an existing show. The TRK-04 parity line records them.
  - `useEyeBones` defaults to `true`, so the output drops `eyeLook*` when eye bones are present. A sender that sends both kinds no longer drives the `eyeLook*` morphs.
  - A source with no mapping now gets the eye rule applied (R2).
  - A VMC bundle with 65 to 256 messages was refused and is now read (R18a). The TRK-01 parity line records this.

### Documents

R20. `ARCHITECTURE.md` records `trackingProbe` in the command path (it relays like `blueprintInspect`), the run peaks in the tracking path (runtime state, never saved), and `fitBlendShapeRanges` in step 3 of the tracking path (it resolves in the live session like `calibrateTracking`). Each update goes in the commit that adds the call or the operation.

## E — Entities

- `TrackingMapping`: adds `useEyeBones?: boolean`.
- `EYE_MAX_DEGREES = { horizontal: 20, vertical: 15 } as const`.
- `applyEyeMovement(sample: TrackingSample, useEyeBones: boolean): TrackingSample`.
- `eyeLookToRotation(values: {in; out; up; down}, side: 'left' | 'right'): Quat`.
- `rotationToEyeLook(rotation: Quat, side: 'left' | 'right'): {in; out; up; down}`.
- `TrackingProbeParams = { sourceId: Id; resetPeaks?: boolean }`.
- `TrackingProbe = { sourceId: Id; generation: number; state: TrackingStatus['state']; values: Partial<Record<ArkitName, number>>; peaks: Partial<Record<ArkitName, number>>; presentChannels: ArkitName[]; eyeBones: boolean }`. `ArkitName` is `typeof ARKIT_NAMES[number]`, and the package exports it.
- `AppApi.trackingProbe(params): Promise<Reply<TrackingProbe>>`.
- Composer: `probe(sourceId: string, nowMs: number, resetPeaks: boolean): Omit<TrackingProbe, 'state'> | null`.
- Session: `probeTracking(params): Reply<TrackingProbe>` and `runPeaks(sourceId): Partial<Record<ArkitName, number>>`.
- `LivePatchOp` and Rust `PatchOp`: adds `fitBlendShapeRanges { entityId, neutral }` (Rust: `neutral: BTreeMap<String, f64>`).
- `RISE = .05`.
- `fitRanges(neutral, peaks): Partial<Record<ArkitName, BlendShapeRange>>`.
- `mergeFit(mapping: TrackingMapping | undefined, fitted): TrackingMapping`.
- `TrackingPresetId = 'selfreflect' | 'ifacialmocap' | 'vmc'`.
- `ExpressionStepId = 'blink' | 'mouthWide' | 'browsUp' | 'smile' | 'frown' | 'pucker' | 'puffCheeks' | 'tongueOut' | 'lookAround'`.
- `TrackingPreset = { id; label; config: TrackingConfig; slots: readonly ('body' | 'face' | 'fingers')[]; connect: 'showAddress' | 'askPhone'; smoothing: TrackingSmoothing; steps: readonly ExpressionStepId[] }`.
- `TRACKING_PRESETS: readonly TrackingPreset[]`.
- `EXPRESSION_STEPS: Record<ExpressionStepId, { main: readonly ArkitName[]; also: readonly ArkitName[] }>`.
- `AssetRecord.eyeBones?: boolean`.
- Fixture: `fixtures/tracking/selfreflect-replay.json`. Protocol fixture: `fixtures/protocol/tracking-overrides.json` gets one mapping with `"useEyeBones": false`.

## A — Approach

Add the eye movement mode first, because it changes the mapping contract and two existing behaviors. Then add the probe call across TypeScript, Rust, the router, the session, and MCP. Then add the fit, which uses the run peaks of the probe. Then add the presets and the asset flag, which need no session change. Last, replay the SelfReflect recording through the host. Each task is one commit. Each contract change goes in TypeScript and Rust in the same task.

## S — Structure

- `packages/contracts/src/tracking.ts` (`useEyeBones`, probe schemas), `tracking-presets.ts` (new), `schema.ts` (the probe in the three maps, `fitBlendShapeRanges`), `types.ts` (`AppApi`, `LivePatchOp`, `AssetRecord`), `index.ts`; tests in `packages/contracts/test/`.
- `crates/contracts/src/tracking.rs` (handwritten `TrackingMapping`, probe structs), `lib.rs` (params and result validation, method list, `PatchOp::FitBlendShapeRanges`, `AssetRecord`); `#[cfg(test)]` tests.
- `packages/session/src/eye-movement.ts` (new), `tracking-mapping.ts`, `blend-shape-fit.ts` (new), `tracking.ts` (peaks, `probe`), `session.ts` (`probeTracking`, `runPeaks`, `resolveCalibrations`), `session-api.ts`, `scene-ops.ts`; tests in `packages/session/test/`.
- `apps/desktop/src-tauri/src/service/router.rs` (two relay lists), `assets/vrm.rs` (eye-bone flag), `tests/tracking_integration.rs` (replay).
- `apps/desktop/src/components/TrackingMappingFields.svelte` (checkbox), `apps/desktop/src/editor/model.ts` (`fitBlendShapeRanges`).
- `apps/mcp/src/tools.ts`, `server.ts` (descriptions, `tracking_probe`); `apps/mcp/test/tracking-probe.integration.test.ts`.
- `fixtures/tracking/selfreflect-replay.json`, `fixtures/protocol/tracking-overrides.json`.
- `ARCHITECTURE.md`.

## O — Operations

1. **Task 2, eye movement.** Unit tests: bones mode drops `eyeLook*` when the sample has eye bones; bones mode converts `eyeLook*` into eye bones when it has none; blend shape mode converts eye bones and drops them; blend shape mode keeps sent `eyeLook*` and drops the bones; the conversion clamps past the maximum angle; the round trip holds; `applyMapping` with no mapping applies the eye rule with `true`; a mapping without `useEyeBones` parses and reads as `true`. A Rust test round-trips a mapping JSON with and without the field unchanged. The implementer fixes the sign of the left axis once and uses it in both directions.
2. **Task 3, probe.** Unit tests: values are smoothed, canonical, and before mapping; two sender names merge by maximum; peaks keep the maximum until `resetPeaks`; a generation change clears the peaks; `eyeBones` needs both eye bones; `probeTracking` rejects an unknown ID and an avatar ID; the state comes from the last `advance`. Rust tests: an empty `sourceId` fails, and a result value above 1 fails. An integration test (boundary: MCP stdio to the session fixture, as in `calibration.integration.test.ts`) checks that `tracking_probe` returns values for a source that the fixture feeds.
3. **Task 4, fit.** Unit tests: SelfReflect `jawOpen` 0.187 gives `inputMin` 0.02 and `inputMax` 0.1683; a channel below the rise gets no range; a high resting value stays valid; a full peak stays in 0 to 1; a missing neutral counts as 0; `mergeFit` keeps other ranges and fields; the live patch saves the merged mapping and raises the revision once; no risen channel gives `INVALID_INPUT` with the source ID; the offline apply fails with the live-session message. Each fitted range satisfies the schema. A case in the MCP integration test and a Rust test cover the operation.
4. **Task 5, presets.** Unit tests: each config passes the schema with `enabled: true`; each smoothing passes its schema and equals the default; the iFacialMocap slots and Connect mode; each step channel is in `ARKIT_NAMES`; each preset lists the nine steps in order. A Rust test: a VRM 1 JSON with eye bones gives `eye_bones: Some(true)`, and one without gives `Some(false)`.
5. **Task 6, replay.** The Rust integration test of R18. The reason for an integration test: a real UDP socket and the host tracking manager are process and protocol boundaries.
6. Run `pnpm test:unit`, `pnpm test:integration`, `pnpm check`, `cargo test --workspace --no-fail-fast`, and `cargo clippy --workspace --all-targets` after each task that the plan names.

## N — Norms

- Use pnpm, functional TypeScript, plain data, Zod 4, and Vitest. Pure functions take a sample and return a sample.
- Write prose in ASD-STE100. UI copy is the control label only: the checkbox label is "Use bones for eye movement".
- Rust structs use `deny_unknown_fields`. A new optional field has `#[serde(default, skip_serializing_if = "Option::is_none")]`.
- Update `ARCHITECTURE.md` in the commit that adds a call, a data path, or a trust check.
- Commit subjects follow the plan, for example `Add the tracking probe call (TRK-23 S1)`. Do not attribute a commit to an agent.

## S — Safeguards

- Do not save, commit, or put the run peaks in a frame.
- Do not let the fit use peaks from an older generation.
- Do not change `TrackingSample`, `TrackingStatus`, or `AvatarPose`.
- Do not make an old show fail to load. Each new field is optional.
- Do not add a dependency, a CI job, or a vendor service.
- Do not claim a real-sender result. The replay proves the parser and the host path. A real SelfReflect stream is checked in S3 and Task 13.
- Do not add a second Set BlendShape mode or lower a tracked value.
