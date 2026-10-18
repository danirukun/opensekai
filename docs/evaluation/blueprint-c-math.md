# Blueprint math check

Slice C of bundle B13 ([contract](../../spdd/prompt/2026-10-18-blueprint-c-math.md), [analysis](../../spdd/analysis/2026-10-18-blueprint-c-math.md)). Checked 2026-10-18 on macOS 27.0.1 (arm64), Node 26.12.0, pnpm 12.8.1, on branch `opensekai/bp-c-math` from base `3e0a7ea` (the integration branch after slice I). Only automated checks ran. The desktop app, the renderer, and OBS did not run, so no visual, macOS, or OBS result is claimed.

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm check` | Passed: all packages and `tsconfig.scripts.json`; svelte-check 0 errors, 0 warnings |
| `pnpm test:unit` | 1142 passed in 149 files, 0 failed |
| `pnpm test:integration` | 41 passed, 2 skipped in 18 files (17 passed, 1 skipped), with `artifacts/models/` copied from the main checkout |

New and changed tests:

- `packages/session/test/blueprint-math-nodes.test.ts` (20, unit): table-driven tests of each new evaluator. Float to integer conversion with −0, half values, and values outside the safe-integer range. Integer add, subtract, and multiply overflow. Truncating division and dividend-sign modulo in all four sign cases, with the identity `a = (a / b) * b + a % b`, and a zero divisor. Random Integer: inclusive range, the seeded generator, a one-value range, a range wider than 2^53, and an empty range. Float Clamp01, Remap (with and without clamp, reversed and empty ranges, overflow), Lerp, Inverse Lerp, Smooth Step, Move Towards, trigonometry, conversions, Power, Square Root, Exp, Log, Sign, and Modulo, with each non-finite result. Smooth Damp steps (reached target, zero delta, overshoot stop, zero smooth time, monotonic approach), the first read, and one step per run state. Vector3 Subtract, Length, Distance, Dot, Cross, Normalize (zero and very small vectors), Lerp, Move Towards (negative distance), Clamp Length (zero and negative limits), Rotate By Euler and Direction From Euler (YXZ order, the round trip with the Get Bone Rotation conversion).
- `packages/session/test/blueprint-math-session.test.ts` (7, runtime): Random Integer → Modulo Integer → Switch On Number runs through widening, for 24 seeds, and reaches both cases. Integer outputs go into the five float compare nodes, also at `Number.MAX_SAFE_INTEGER`. A `number` output on an `integer` input fails to compile. Unconnected inputs read the node input defaults. A division by zero fails the run with `Blueprint data could not be evaluated`, and the next run draws the same random integer as a fresh state (the failed draw was not kept). An integer overflow fails the run. Smooth Damp moves toward a held-key target over 120 On Update ticks, and a graph that reads it from two flow inputs gives the same value to both and moves at the same rate. Smooth Damp keeps its state on a reinstall with the same logic and resets on a settings change and on disable and enable.
- `packages/contracts/test/blueprint-definitions.test.ts`: catalog count 68 → 118.
- `apps/desktop/test/node-search.test.ts`, `palette.test.ts`: the search "random" also finds Random Integer.

## What the macOS and OBS run must check

Use the integrated QA build. Record the backend, the quality profile, and the commit.

1. Open the palette. The Math section lists the new float, Vector3, and integer nodes; Logic lists Is Even. Search "lerp", "smooth", "integer", and "euler".
2. Add Lerp with no wires. The inline editors show `b` 1 and `t` 0.5. Add Divide Integer: `b` shows 1, and the editor accepts only whole numbers.
3. Drag a wire from Random Integer `result` to Greater Than `a` and to Set Number Variable `value`: both connect. Drag from Add `result` to Add Integer `a`: the wire does not connect.
4. Build: Manual Trigger → Switch On Number (cases 0, 1) ← Modulo Integer (`b` 2) ← Random Integer (0 to 9). Case 0 shows a marker, case 1 hides it. Run it several times; the marker changes.
5. Build: On Update → Set Asset Property (camera, Field of View) ← Smooth Damp (`smoothTime` 0.5) ← Multiply (`b` 30) ← Key Axis (S, W), then Add (`b` 40). Hold W. In OBS the view zooms smoothly to 70 degrees with no snap, and goes back when W is released. Minimize the editor while W is held; the OBS output keeps moving.
6. Build: On Update → Set Asset Property (prop, Position) ← Add Vector3 (base position) ← Scale Vector3 (`factor` 0.5) ← Direction From Euler ← Get Bone Rotation (head). The prop moves in front of the face direction as the head turns.
7. Set Divide Integer `b` to 0 in a running graph. The Blueprint panel shows `Blueprint data could not be evaluated`; the scene does not change. Set `b` to 1; the error clears on the next successful run.
8. Change a Smooth Damp graph setting while it moves (for example the Key Axis keys). The value jumps to the target, because the state resets.

## Gaps

- No renderer, macOS, or OBS evidence.
- Each Warudo name candidate is `null`. The BP-13 live palette pass records the names and compares the behavior.
- Round to Integer rounds a half toward positive infinity (`Math.round`), as the existing Round does. Unity `Mathf.RoundToInt` rounds a half to the even integer. Owner decision pending.
- Smooth Damp moves only in a run that reads it, and once for each such run. It has no maximum speed.
