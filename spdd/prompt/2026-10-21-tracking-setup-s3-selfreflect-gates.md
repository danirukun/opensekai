# REASONS: Guided tracking setup, slice 3 (SelfReflect gates)

Date: 2026-10-21. Scope: TRK-23 slice S3, with TRK-01. Analysis: [guided tracking setup](../analysis/2026-10-21-tracking-setup-walkthrough.md). Design: [guided tracking setup](../../docs/superpowers/specs/2026-10-21-tracking-setup-walkthrough-design.md). Plan: [implementation plan](../../docs/superpowers/plans/2026-10-21-tracking-setup-walkthrough.md), Task 10. Related: [S1 probe and fit](2026-10-21-tracking-setup-s1-probe-fit.md), [S2 guide](2026-10-21-tracking-setup-s2-guide.md).

This file is the contract only. S3 depends on S1. It can run in parallel with S2, but the gates need the guide of S2 to set up the character, so the run of Step 1 waits for S2 or uses MCP to write the same setup. Task 13 (acceptance) spans all slices.

## Subset

- **TRK-23 gates:** three checks with a real SelfReflect stream, the evidence file, and the SelfReflect smoothing values.
- A fix is in the subset only when its gate fails. The position rule, the stale hold, and new smoothing values are candidates with a selection gate. They are not decided behavior.
- Not in it: the guide (S2), the Blueprint nodes (S4), and any body calibration.

## R — Requirements

R1. **Gate 1, positions.** Load the character, run a real SelfReflect stream, and look at the arms and the hips height. The renderer applies bone positions. SelfReflect sends hand positions on a centimeter scale and a hips position below the floor. Record what you see and a screenshot. The gate fails when the arms are broken or the character is sunk.
R2. **Fix for gate 1.** When gate 1 fails, add a position rule to the VMC config: `positions?: 'all' | 'rotationsOnly' | 'hipsOnly'`. A missing value means `'all'`. TypeScript and Rust accept and write the same shape, with the serde default attributes. A pure function `applyPositionRule(sample, rule)` runs in the composer before calibration. `rotationsOnly` removes every position. `hipsOnly` keeps only the hips position (the neutral offset can come from Relax). The SelfReflect preset sets the selected rule. `fixtures/protocol/validation-vectors.json` and `ARCHITECTURE.md` record it.
R3. **Gate 2, stalls.** Watch the face and the body for 2 minutes of a real SelfReflect stream. SelfReflect stops sending for up to 0.7 s, and the stale limit is 500 ms. Record any flicker toward neutral, with the time stamps of the stalls (from `trackingProbe` state changes). The gate fails when the character flickers.
R4. **Fix for gate 2.** When gate 2 fails, add `staleMs?: number` (500 to 2000) to the tracking source entity, in TypeScript and Rust. The composer uses it in place of 500 for the stale state and for the start of the fade. The SelfReflect preset sets it. `ARCHITECTURE.md` records it.
R5. **Gate 3, smoothing.** Compare the default smoothing values with at least one stronger setting (for example `minCutoff` 2 and `beta` 0.3) in the same 2 minute run. The character must move without visible jitter and without a jump after each gap. Record which setting looks better and why. The SelfReflect preset keeps the values that look best. When the defaults are enough, the preset keeps the defaults and its test stays unchanged. When other values win, the preset and its test change.
R6. The evidence file `docs/evaluation/tracking-setup-walkthrough.md` records the backend, the quality profile, the fixture revision, the commit, and a result for each gate. An unavailable measurement is unknown, never zero. The selected smoothing values and the reason go in it. Each gate result also goes in the TRK-23 parity line.
R7. The replay fixture and the Rust replay test of S1 do not replace the gates. A gate result comes from a real stream only.

## E — Entities

- Optional, only when a gate fails:
  - `VmcConfig.positions?: 'all' | 'rotationsOnly' | 'hipsOnly'`.
  - `applyPositionRule(sample: TrackingSample, rule: 'all' | 'rotationsOnly' | 'hipsOnly'): TrackingSample`.
  - Tracking source entity: `staleMs?: number`, 500 to 2000.
  - SelfReflect preset values: `config.positions`, `staleMs`, and `smoothing`.
- Consumed from S1: `TRACKING_PRESETS`, `trackingProbe`, and the SelfReflect replay fixture.
- Evidence file: `docs/evaluation/tracking-setup-walkthrough.md`.

## A — Approach

Run the gates first, on the dev build, with a character that the guide or MCP set up. Record each result. Then, for each failed gate, write the unit test first and add the fix. Keep the fix behind an optional field so an old show loads as before. Run the full test suite, then commit the evidence and the fixes in one commit.

## S — Structure

- `docs/evaluation/tracking-setup-walkthrough.md` (new).
- Only if gate 1 fails: `packages/contracts/src/tracking.ts`, `crates/contracts/src/tracking.rs`, `packages/session/src/tracking.ts`, `packages/contracts/src/tracking-presets.ts`, `fixtures/protocol/validation-vectors.json`, `ARCHITECTURE.md`.
- Only if gate 2 fails: the same contract files for `staleMs`, `packages/session/src/tracking.ts`, the SelfReflect preset, `ARCHITECTURE.md`.
- Only if gate 3 selects other values: `packages/contracts/src/tracking-presets.ts` and `packages/contracts/test/tracking-presets.test.ts`.
- `docs/warudo-parity.md` (TRK-23 and TRK-01 lines), through Task 13.

## O — Operations

1. Run the dev build with a real SelfReflect stream. Set up a character with the guide (or with the same patches through MCP).
2. Gate 1: look at the arms and the hips height. Record the result and a screenshot.
3. Gate 2: watch for 2 minutes. Record the flicker and the stall time stamps.
4. Gate 3: compare the defaults with one stronger setting in the same run. Record the choice and the reason.
5. For each failed gate, write the test first, then the fix. Tests: `applyPositionRule rotationsOnly removes every position`; `hipsOnly keeps only hips`; `staleMs 1000 keeps a 700 ms gap at full weight`; a Rust round trip for each new field; a preset test for the selected values.
6. Run `pnpm test:unit`, `cargo test --workspace --no-fail-fast`, and `pnpm check`.
7. Commit the evidence and the selected fixes together: `Record the SelfReflect gates (TRK-23 S3)`.

## N — Norms

- Use pnpm, functional TypeScript, and plain data. Write prose in ASD-STE100.
- Record the backend, the quality profile, the fixture revision, and the commit. Keep app timing and OBS timing separate.
- A fix is a unit test first, then code. A gate result is evidence, not a test.
- A new field is optional, with the serde default attributes in Rust.

## S — Safeguards

- Do not add the position rule, the stale hold, or new smoothing values when their gate passes.
- Do not claim a gate result without a real SelfReflect stream. Record a gate that did not run as unknown.
- Do not change the default for a source that is not a SelfReflect source. Only the SelfReflect preset sets the new values.
- Do not make an old show fail to load.
- Do not start or publish a live stream for a check. The local OBS rules of the project apply.
