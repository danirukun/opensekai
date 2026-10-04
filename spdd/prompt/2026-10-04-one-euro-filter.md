# REASONS: One Euro tracking filter

## R — Requirements

Apply a basic One Euro Filter to VMC, iFacialMocap and MediaPipe in the authoritative session. Export reusable scalar, Vec3 and quaternion factories with filter(value, timeMs) and reset(). No platform dependencies or new library. No saved-schema change or tuning UI in this slice.

## E — Entities

OneEuroOptions: minCutoff Hz (positive), beta (nonnegative), derivativeCutoff Hz (positive), resetAfterMs (positive). Defaults: 1 Hz, beta 0.1, 1 Hz, 500 ms. Scalar and vector units retain their input units; quaternion speed uses radians per second. Filter instances own transient state.

## A — Approach

Follow the original algorithm: low-pass the raw derivative, then use cutoff = minCutoff + beta * absolute filtered derivative; alpha = 1 / (1 + 1 / (2*pi*cutoff*dtSeconds)). First sample passes unchanged. Quaternion adapter uses filtered angular speed and shortest-path slerp. Vectors use independent scalar axes.

## S — Structure

packages/session/src/one-euro-filter.ts owns reusable math. tracking-filter.ts adapts complete samples and owns channel state. tracking.ts filters accepted samples before composition. index.ts exports the factories. Pure and session tests cover all three source kinds.

## O — Operations

1. Record analysis, design and plan. 2. Add failing core tests, then implement. 3. Add failing composer tests, then integrate. 4. Run checks and unit/integration suites. 5. Build macOS, check rendered mock tracking in OBS, restore the original scene, and record evidence. 6. Update parity and commit.

## N — Norms

Follow the project constitution and current user instructions. Use pnpm, functional TypeScript and unit tests for mathematical behavior. Keep app timing separate from OBS timing. Do not expose mutable engine objects to future blueprint users.

## S — Safeguards

Validate options and finite values/time before changing state. Reject zero-length quaternions. Normalize quaternion output. Equal or older timestamps hold the previous result without advancing state. Gaps greater than 500 ms reset each channel. Explicit reset clears history. Source disable/removal, generation replacement, error or stop clears sample and filter state. Absent channels are removed; coordinate-space changes reset bone state. Never synthesize missing channels. Bound channel maps to current validated sample keys. Do not mutate input. Filter once per accepted sample, never in evaluate. Preserve source status, idle baseline, confidence and stale fade. Physical phone and detected-person MediaPipe checks are not required for deterministic source integration evidence; distinguish these from mock checks.

Reference: https://gery.casiez.net/1euro/
