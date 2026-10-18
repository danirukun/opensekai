# Blueprint math analysis

Date: 2026-10-18. Scope: slice C of bundle B13 "Blueprint depth" (#81, BP-01, BP-13). Integer and float math, interpolation, smoothing, trigonometry, rounding, and Vector3 operations. Plan: [Blueprint depth](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md). Value model: [W0 contract](../prompt/2026-10-18-blueprint-w0-value-model.md).

## Problem

The Warudo palette has 183 nodes in Arithmetic. OpenSekai has 23 rows there ([node audit](../../docs/evaluation/blueprint-node-audit.md)). The gap has two causes:

- **Types.** Warudo has separate Integer and Float nodes. W0 added the `integer` port type, but no node makes or uses an integer value except the device nodes of slice I.
- **Operations.** OpenSekai has Add, Subtract, Multiply, Divide, Min, Max, Clamp, Abs, Round, Floor, and Random Number for floats, and Make, Break, Add, and Scale for Vector3. An operator who wants a smooth follow, a remap of a tracking value, a sine wave, or a direction from a rotation must build it from these nodes, or cannot build it.

## Facts from the code

- Math nodes are in `blueprint-nodes/math.ts`, `vector3.ts`, and `logic.ts`. Their evaluators are in `blueprint-eval/values.ts` and `blueprint-eval/vector3.ts`.
- `canConnect` lets an `integer` output enter a `number` input. A `number` output cannot enter an `integer` input. So each existing float node already accepts an integer value: Greater Than, Equal, Switch On Number, and Set Number Variable.
- An unconnected data input reads its inline value, else `NodeDefinition.inputDefaults`, else the type default (`0`).
- The runtime checks each data output against its type (W0 R7). A non-finite `number` or a non-safe `integer` fails the run with `Blueprint data could not be evaluated`. A failed run changes no state.
- `RunState.nodes` is the generic per-node state. `getNodeState` and `setNodeState` read and replace an entry.
- `runFlow` makes one `RunState` copy (`cloneState`) for each run. Each flow node input read has its own data cache (`readInput`). So one data node that two flow inputs read is evaluated two times in one run. Random Number gives a new value at each evaluation.
- `RunEnv.deltaSeconds` is the clamped tick time (0 to 0.1 s) in an On Update run, and 0 in each other run.
- Get Bone Rotation gives Euler degrees in YXZ order in the pose frame (right-handed, +Y up): rotation = Ry · Rx · Rz. `eulerToQuat` in `session/bone-offsets.ts` implements it.
- The state resets on install, on a logic change, and on enable (catalog contract R5).

## Decisions

- **Integer family.** New file `blueprint-nodes/integer.ts` with 16 node types: four float to integer conversions, eleven integer operations, and Is Even. The type prefix is `integer.`. The labels say "Integer" so that the palette shows the type, as Warudo does.
- **No integer compare nodes.** Integer values are safe integers. A float compare of two safe integers is exact. So Greater Than, Less Than, Equal, and the others give the same result as integer compare nodes would. A session test shows this. This avoids five duplicate nodes.
- **Integer division truncates toward zero, and Modulo has the sign of the dividend.** This is the C# and JavaScript `%` behavior, so Warudo graphs keep their results. `a = (a / b) * b + a % b` holds. A zero divisor fails the run with `Blueprint data could not be evaluated`. The division uses `(a - a % b) / b`, which is exact for each safe integer.
- **Overflow fails the run.** An integer result outside the safe-integer range fails the run. There is no wraparound.
- **Round to Integer uses `Math.round`.** A half goes toward positive infinity (2.5 → 3, −2.5 → −2). The existing float Round does the same. Unity `Mathf.RoundToInt` rounds a half to the even integer. This is an open question for the owner.
- **Float nodes go into `math.ts`.** The float extras are appended to `MATH_NODES` so that the float nodes stay together in the palette. Their evaluators are in a new file `blueprint-eval/math.ts`, so `values.ts` does not change.
- **Unity semantics where Warudo uses Unity.** Lerp and Inverse Lerp clamp to 0 to 1 (`Mathf.Lerp`, `Mathf.InverseLerp`). Inverse Lerp of an empty range gives 0. Move Towards and Smooth Damp follow `Mathf.MoveTowards` and `Mathf.SmoothDamp` (without a maximum speed). Smooth Step is the shader `smoothstep(min, max, value)`, because that is the common meaning of the name.
- **Angles in radians for trigonometry.** Sin, Cos, Tan, Asin, Acos, and Atan2 use radians, like `Mathf`. Degrees to Radians and Radians to Degrees convert. Rotate By Euler and Direction From Euler use degrees, like Get Bone Rotation.
- **Non-finite results fail.** Asin and Acos outside −1 to 1, Square Root of a negative number, Log of 0 or less, Power with a non-real result, Exp overflow, and float Modulo by 0 fail the run. This is the existing rule. There is no silent clamp.
- **Sign of 0 is 0.** `Mathf.Sign(0)` is 1, but a three-way sign is more useful for a direction, and the name does not promise the Unity value. Recorded as a difference.
- **Smooth Damp is stateful.** It keeps `{ value, velocity }` in `RunState.nodes`. The first evaluation starts at the target. It advances by `env.deltaSeconds` once for each run. A second evaluation in the same run gives the same value. The node keeps a per-run memo keyed by the run's `RunState` object, because the runtime data cache is per input read (see Facts) and the runtime belongs to slice D. A run with a delta of 0 (a manual or keystroke run) does not move it. The state resets with the graph state.
- **Vector3 nodes go into `vector3.ts`.** Subtract Vector3 is added too: Distance and direction graphs need it, and its absence makes Scale by −1 and Add necessary.
- **Normalize of a zero vector is the zero vector.** Clamp Length with a negative limit fails the run.
- **Direction From Euler rotates +Z.** +Z is the forward axis of a glTF and VRM 1.0 model. The rotation is the YXZ rotation of Get Bone Rotation.
- **Inline defaults.** Each new node with an input where 0 is not a useful start has an input default: Lerp `b` 1 and `t` 0.5, Clamp `max` 1, Remap `fromMax` and `toMax` 1, Smooth Damp `smoothTime` 0.3, Power `exponent` 2, Divide Integer `b` 1, Modulo Integer `b` 2, Modulo `b` 1, Clamp Length `maxLength` 1. The existing Clamp (`max` 1), Divide (`b` 1), Random Number (`max` 1), and Scale Vector3 (`factor` 1) get input defaults too. This changes only an unconnected input without an inline value. Before W0 such an input was a compile error, and W0 is not on `main`, so no saved graph changes.

## Rejected approaches

- **A generic numeric port that is integer or float.** The owner decision keeps the two types separate, with widening only.
- **Integer versions of each compare node.** They give the same result (see Decisions).
- **Floored modulo.** It is better for a wrap-around index, but it differs from Warudo. A user can add the divisor and take Modulo again.
- **A per-run data cache in `blueprint.ts`.** It would also change Random Number. It is in a file that this slice does not own. The local memo is enough for Smooth Damp.
- **A `maxSpeed` input on Smooth Damp.** An inline value must be finite, so "no limit" needs a special value. Not needed now.

## Risks

- The per-run memo depends on one `RunState` object for each run. A session test reads one Smooth Damp from two flow inputs in one tick and checks that it moves once. A runtime change that breaks the assumption fails this test.
- Smooth Damp advances only in runs that read it. A graph that reads it only on some ticks sees a slower motion. Documented.
- The Warudo names are not recorded, so each audit row has a `null` candidate.
