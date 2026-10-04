# One Euro Filter Implementation Plan

Goal: Smooth all three tracking sources and export a reusable core for blueprint nodes.
Architecture: Stateless options and instance-local transient history. The session filters each accepted sample before avatar composition.
Tech stack: TypeScript, Vitest, existing macOS Tauri/OBS evaluation.
Spec: spdd/prompt/2026-10-04-one-euro-filter.md.

## Constraints and review focus

No schema, dependency or tuning UI change. Use source receipt milliseconds. Never filter during render/evaluate. Check duplicate times, sparse channels, coordinate-space changes, quaternion sign changes and reset after source restart.

## Task 1 — Core

- [x] Create packages/session/test/one-euro-filter.test.ts. Verify second scalar output 2*pi*.1/(1+2*pi*.1) for 0→1 over100ms with beta0; beta1 responds faster; equal/old time holds; reset and gap reseed. Verify vector isolation and normalized shortest-arc quaternion output.
- [x] Run pnpm exec vitest run --project unit packages/session/test/one-euro-filter.test.ts. Expect missing module failure.
- [x] Implement packages/session/src/one-euro-filter.ts factories and export from index.ts. Validate before mutation; use first sample seed and bounded time-gap reset.
- [x] Run focused tests. Expect pass.

## Task 2 — Sample integration

- [x] Create packages/session/test/tracking-filter.test.ts. For vmc, ifacialmocap and mediapipe, submit two real validated samples and assert smoothed values in evaluated pose. Check repeat evaluation, independent source state, generation/stop reset, sparse channels and raw/normalized switch.
- [x] Run focused tests. Expect smoothing assertion failure.
- [x] Implement createTrackingSampleFilter in tracking-filter.ts, owning bounded channel maps. Integrate into tracking.ts only after sample validation/source/generation/order checks. Clear alongside sample lifecycle. Export adapter from index.ts.
- [x] Run focused tests, pnpm test:unit, pnpm test:integration and pnpm check. Expect pass.

## Task 3 — Runtime and checkpoint

- [x] Build macOS with pnpm build:mac. Use existing private scene recovery and OBS mock helpers. Preserve original scene and OBS configuration. Check motion and return to idle in clean output; record backend and source commit.
- [x] Record scoped evidence, update docs/warudo-parity.md and commit named files. Do not include private captures, tokens or avatar files.

Additional user requirement: direct 52-channel ARKit mapping implemented under spdd/prompt/2026-10-04-arkit-morphs.md and verified in generated meshes and selected actual OBS poses. See docs/evaluation/one-euro-filter.md for scoped evidence.
