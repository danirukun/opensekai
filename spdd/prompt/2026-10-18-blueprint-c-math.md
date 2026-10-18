# REASONS: Blueprint math (C)

Date: 2026-10-18. Scope: slice C of bundle B13 ([plan](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md)): integer and float math, interpolation, smoothing, trigonometry, rounding, and Vector3 operations. Analysis: [Blueprint math](../analysis/2026-10-18-blueprint-c-math.md). Issue: #81. Parity items: BP-01, BP-13. This contract uses the [W0 published interfaces](2026-10-18-blueprint-w0-value-model.md#published-interfaces): the `integer` port type, `canConnect`, inline inputs, `NodeDefinition.inputDefaults`, and `getNodeState` / `setNodeState`.

## R — Requirements

R1. Float to integer. These nodes have input `value` (number) and output `result` (integer). Category Math.
    - **Round to Integer** (`integer.round`): `Math.round` (a half goes toward positive infinity).
    - **Floor to Integer** (`integer.floor`), **Ceil to Integer** (`integer.ceil`), **Truncate to Integer** (`integer.truncate`): toward negative infinity, positive infinity, and zero.
    - A result outside the safe-integer range fails the run. A result of −0 is 0.
R2. Integer arithmetic. Inputs and outputs are `integer`. Output `result`. Category Math.
    - **Add Integer** (`integer.add`), **Subtract Integer** (`integer.subtract`), **Multiply Integer** (`integer.multiply`): inputs `a`, `b`.
    - **Divide Integer** (`integer.divide`): inputs `a`, `b` (default 1). The quotient truncates toward zero.
    - **Modulo Integer** (`integer.modulo`): inputs `a`, `b` (default 2). The remainder has the sign of `a` (`a = (a / b) * b + a % b`).
    - A zero `b` in Divide Integer or Modulo Integer fails the run with `Blueprint data could not be evaluated`.
    - **Negate Integer** (`integer.negate`), **Abs Integer** (`integer.abs`): input `value`.
    - **Min Integer** (`integer.min`), **Max Integer** (`integer.max`): inputs `a`, `b`.
    - **Clamp Integer** (`integer.clamp`): inputs `value`, `min`, `max` (default 1). `min > max` fails the run.
    - **Random Integer** (`integer.random`): inputs `min`, `max` (default 1). It gives an integer from `min` to `max`, both included, from the seeded `RunState.random` (catalog contract R9), one draw for each evaluation. `min > max` fails the run.
    - **Is Even** (`integer.isEven`, category Logic): input `value` (integer), output `result` (boolean).
    - A result outside the safe-integer range fails the run. There is no wraparound.
R3. Integer compare. No integer compare node is added. An integer output connects to each float compare node and to Switch On Number by the W0 widening rule. Safe integers compare exactly as floats.
R4. Float math. Inputs and outputs are `number`. Output `result` unless stated. Category Math. Appended to `MATH_NODES`.
    - **Clamp01** (`math.clamp01`): `value` to 0 to 1.
    - **Remap** (`math.remap`): inputs `value`, `fromMin`, `fromMax` (default 1), `toMin`, `toMax` (default 1), `clamp` (boolean). `toMin + t · (toMax − toMin)`, where `t` is the Inverse Lerp of `value` (unclamped unless `clamp`). An empty source range gives `t = 0`.
    - **Lerp** (`math.lerp`): inputs `a`, `b` (default 1), `t` (default 0.5). `t` is clamped to 0 to 1.
    - **Inverse Lerp** (`math.inverseLerp`): inputs `a`, `b` (default 1), `value`. Clamped to 0 to 1. `a = b` gives 0.
    - **Smooth Step** (`math.smoothStep`): inputs `min`, `max` (default 1), `value`. `t²(3 − 2t)` with `t` the clamped Inverse Lerp. `min = max` gives 0 below `min`, else 1.
    - **Move Towards** (`math.moveTowards`): inputs `current`, `target`, `maxDelta` (default 1). `Mathf.MoveTowards`.
    - **Smooth Damp** (`math.smoothDamp`): inputs `target`, `smoothTime` (default 0.3). See R6.
    - **Sin**, **Cos**, **Tan** (`math.sin`, `math.cos`, `math.tan`), **Asin**, **Acos** (`math.asin`, `math.acos`): input `value`, radians.
    - **Atan2** (`math.atan2`): inputs `y`, `x`; radians.
    - **Degrees to Radians** (`math.degreesToRadians`), **Radians to Degrees** (`math.radiansToDegrees`): input `value`.
    - **Pi** (`math.pi`): no input; output `value`.
    - **Power** (`math.pow`): inputs `base`, `exponent` (default 2). **Square Root** (`math.sqrt`), **Exp** (`math.exp`), **Log** (`math.log`, natural): input `value`.
    - **Sign** (`math.sign`): input `value`; −1, 0, or 1.
    - **Modulo** (`math.modulo`): inputs `a`, `b` (default 1); JavaScript `%` (the sign of `a`).
    - A non-finite result fails the run (W0 R7). The existing Clamp, Abs, Min, and Max cover the float forms of those operations.
R5. Vector3. Category Math. Appended to `VECTOR3_NODES`.
    - **Subtract Vector3** (`vector3.subtract`): `a`, `b` → `result` (vector3).
    - **Vector3 Length** (`vector3.length`): `value` → `result` (number).
    - **Vector3 Distance** (`vector3.distance`): `a`, `b` → `result` (number).
    - **Dot Product** (`vector3.dot`): `a`, `b` → `result` (number). **Cross Product** (`vector3.cross`): `a`, `b` → `result` (vector3).
    - **Normalize Vector3** (`vector3.normalize`): `value` → `result`. A zero vector gives the zero vector.
    - **Lerp Vector3** (`vector3.lerp`): `a`, `b`, `t` (number, default 0.5, clamped) → `result`.
    - **Move Towards Vector3** (`vector3.moveTowards`): `current`, `target`, `maxDistance` (number, default 1) → `result`. `Vector3.MoveTowards`.
    - **Smooth Damp Vector3** (`vector3.smoothDamp`): `target`, `smoothTime` (number, default 0.3) → `result`. See R6.
    - **Rotate By Euler** (`vector3.rotateByEuler`): `value`, `euler` (degrees, YXZ, the convention of Get Bone Rotation) → `result`. The rotation is Ry · Rx · Rz.
    - **Direction From Euler** (`vector3.directionFromEuler`): `euler` → `result`, the forward axis +Z rotated by `euler`.
    - **Clamp Vector3 Length** (`vector3.clampLength`): `value`, `maxLength` (number, default 1) → `result`. A negative `maxLength` fails the run.
R6. Smooth Damp. The float and the Vector3 node keep `{ value, velocity }` in `RunState.nodes` under the node ID.
    - The first evaluation after a reset gives the target and stores it with velocity 0.
    - Else the node advances by `env.deltaSeconds` with the `Mathf.SmoothDamp` algorithm (no maximum speed; `smoothTime` below 0.0001 is 0.0001) and stores the new value and velocity. When the step reaches past the target, the value is the target and the velocity is 0.
    - The node advances at most once for each run. Another evaluation in the same run gives the same value and does not advance.
    - A run with `deltaSeconds` 0 does not move the value.
    - The state resets with the graph state (catalog contract R5): on install, on a logic change, and on enable. A failed run does not keep it (catalog contract R7).
R7. Inline input defaults. The inputs in R2, R4, and R5 that state a default use `NodeDefinition.inputDefaults`. The existing nodes get these defaults: Clamp `max` 1, Divide `b` 1, Random Number `max` 1, Scale Vector3 `factor` 1. The ports, settings, and behavior with a wire or an inline value do not change.
R8. Audit. `docs/evaluation/blueprint-node-audit.json` has one row for each new node type: Warudo category `Arithmetic`, candidate `null`, evidence `tests`.
R9. Tests.
    - Unit: table-driven tests of each new evaluator, with edge cases: NaN and infinity, zero vectors, integer overflow, divide and modulo by zero, negative modulo, empty ranges, and Smooth Damp steps.
    - Session: Random Integer → Modulo Integer → Switch On Number runs through widening; integer outputs into the float compare nodes; a `number` output into an `integer` input fails to compile; Smooth Damp converges over On Update ticks, moves once in a tick with two reads, and resets on a logic change and on enable; divide by zero fails the run and changes no state.

## E — Entities

- New node types: 16 `integer.*`, 22 `math.*`, 12 `vector3.*` (50 in total).
- Smooth Damp state: `{ value: number; velocity: number }` or `{ value: Vec3; velocity: Vec3 }` as `NodeState`.
- No change to `RunState`, `PortType`, `BlueprintValue`, the effect union, or the file format.

## A — Approach

Add the definitions in the contracts package, then the evaluators in the session package, then the audit rows and the catalog count. Put the pure numeric functions (Smooth Damp steps, rotation) next to the evaluators and export them for unit tests. Throw a `RangeError` in an evaluator for each failure, so the runtime fails the run with the existing message and keeps no state.

## S — Structure

- `packages/contracts/src/blueprint-nodes/integer.ts` (new), `math.ts`, `vector3.ts`; one entry in `NODE_DEFINITIONS` in `blueprint-nodes/index.ts`.
- `packages/session/src/blueprint-eval/integer.ts` (new), `math.ts` (new), `vector3.ts`; one import and one entry in `EVALUATORS` in `blueprint-eval/index.ts`.
- Tests: `packages/session/test/blueprint-math-nodes.test.ts` (unit, evaluators), `packages/session/test/blueprint-math-session.test.ts` (runtime and session), the catalog count in `packages/contracts/test/blueprint-definitions.test.ts`, and search expectations in `apps/desktop/test` when a new label matches.
- `docs/evaluation/blueprint-node-audit.json`, `docs/evaluation/blueprint-c-math.md`.

## Published interfaces

```ts
// packages/session/src/blueprint-eval/math.ts
export interface Damped<T> { value: T; velocity: T }
export const smoothDampStep: (current: number, target: number, velocity: number, smoothTime: number, deltaSeconds: number) => Damped<number>;
// packages/session/src/blueprint-eval/vector3.ts
export const smoothDampVectorStep: (current: Vec3, target: Vec3, velocity: Vec3, smoothTime: number, deltaSeconds: number) => Damped<Vec3>;
export const rotateByEuler: (value: Vec3, euler: Vec3) => Vec3;
```

## O — Operations

1. Commit this contract and the analysis.
2. Integer family: definitions, evaluators, unit tests.
3. Float math: definitions, evaluators, input defaults, unit tests.
4. Vector3: definitions, evaluators, unit tests.
5. Session tests, audit rows, catalog count.
6. Evaluation note, `pnpm check`, `pnpm test:unit`, `pnpm test:integration`.

## N — Norms

Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript and plain data. Keep UI copy to labels and port names. Keep edits in shared files to one line for each family.

## S — Safeguards

- Do not convert a float to an integer implicitly. Do not add a float input to an integer port.
- Do not change the ports, settings, or connected behavior of an existing node type.
- Do not let a failed run keep state. Do not let an integer leave the safe-integer range.
- Do not edit `flow.ts`, `events.ts`, `blueprint-runtime.ts`, `session/blueprint.ts`, the text, list, switch, or variable families, `docs/warudo-parity.md`, `ARCHITECTURE.md`, or a lockfile.
