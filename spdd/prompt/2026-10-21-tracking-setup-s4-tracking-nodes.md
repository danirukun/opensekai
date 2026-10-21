# REASONS: Guided tracking setup, slice 4 (tracking nodes)

Date: 2026-10-21. Scope: TRK-23 slice S4, with BP-05 and BP-06. Analysis: [guided tracking setup](../analysis/2026-10-21-tracking-setup-walkthrough.md). Design: [guided tracking setup](../../docs/superpowers/specs/2026-10-21-tracking-setup-walkthrough-design.md). Plan: [implementation plan](../../docs/superpowers/plans/2026-10-21-tracking-setup-walkthrough.md), Tasks 11 and 12. Related: [S1 probe and fit](2026-10-21-tracking-setup-s1-probe-fit.md), [Blueprint input devices](2026-10-18-blueprint-i-input-devices.md).

This file is the contract only. S4 depends on S1 only through the contracts package: it uses the exported `ArkitName` type from Task 3. It uses no session code, no host code, and no editor code of S1, S2, or S3. It can run in a parallel worktree after Task 3 merges. It touches no file of Parts A to C, except the contracts index, `session.ts`, and `ARCHITECTURE.md`. The integrator orders those contract changes and merges them. Task 13 (acceptance) spans all slices.

## Subset

- **BP-05 and BP-06 tracking subset:** a Tracking node category, one value node, and three event nodes.
- Not in it: a duplicate bone node (use `character.getBoneRotation`), a Set BlendShape mode that lowers a tracked value, generated Blueprints for the default tracking path, and any change to the default tracking path.

## R — Requirements

R1. `NODE_CATEGORIES` gets `'Tracking'` after `'Character'`. The entity field union gets the kind `'trackingSource'`. The editor renders it as a select of the tracking entities in the scene (`BlueprintNodeFields.svelte`). Rust needs no change for a node type: the palette and the MCP node docs come from the registry. Task 12 confirms that `apps/mcp/src/resources.ts` needs no change.
R2. **Get Tracking Blend Shape** (`tracking.getBlendShape`). Settings `{ entityId: Id; blendShape: ArkitName }`. Fields: `avatar`, and `blendShape` as a `choice` over `ARKIT_NAMES`. Output `value: number`. It reads `env.previousPose`, which is the previous tick's mapped pose, before expressions and Blueprint blend shapes. `trackedBlendShape(pose, name)` returns the maximum over the `pose.expressions` entries whose `canonicalArkitName` equals `name`, and 0 with no pose or no match.
R3. **On Blend Shape Threshold** (`tracking.onBlendShapeThreshold`). Settings `{ entityId; blendShape; threshold; release }`, each 0 to 1, with `release < threshold`. The defaults are 0.5 and 0.4 (the design default is threshold minus 0.1). Outputs `rise: flow`, `fall: flow`, and `value: number`. It fires `rise` once when the value crosses the threshold upward. It fires `fall` once when the value drops below the release. Between the release and the threshold, it fires nothing. The `value` output reads `trackedBlendShape`.
R4. **On Tracking Lost** (`tracking.onLost`). Settings `{ sourceId: Id; after: number }`, with `after` from 0.1 to 60 and a default of 2. Output `flow`. It fires once when the source state is not `receiving` for the `after` time, and only after the source was `receiving`. A stall shorter than `after` (for example a SelfReflect gap of 0.7 s) fires nothing.
R5. **On Tracking Found** (`tracking.onFound`). Settings `{ sourceId: Id }`. Output `flow`. It fires once when the source is `receiving` again after a Lost. It does not fire on the first `receiving`.
R6. `RunEnv` gets `trackingStatus?: (sourceId: Id) => TrackingStatus | null`. `Session` keeps `previousStatuses` from `live.trackingStatus` and passes `trackingStatus` in `env`.
R7. `BlueprintEvent` gets `{ kind: 'tracking' }`. The session pushes it after the device events and before `{ kind: 'update' }`. The runtime handles it after `device` and before `update`. For each enabled graph, the runtime calls `trackingTrigger` for each tracking event node, stores the edge on `entry.trackingEdges`, and calls `fire(entry, { nodeId, port }, instant)` when `port` is not `null`.
R8. `Active` gets `trackingEdges: Map<Id, TrackingEdge>`. A new `Active` (after an install or a logic change) starts empty. The edge state is in the node, so the nodes do not depend on the stale hold of S3.
R9. `ARCHITECTURE.md`, Blueprint runtime path, records the tracking trigger phase and its edge state.

## E — Entities

- Node types: `tracking.getBlendShape`, `tracking.onBlendShapeThreshold`, `tracking.onLost`, `tracking.onFound`.
- `trackedBlendShape(pose: AvatarPose | null, name: ArkitName): number`.
- `TrackingEdge = { kind: 'threshold'; above: boolean } | { kind: 'presence'; seen: boolean; lost: boolean; notReceivingSinceMs: number | null }`.
- `trackingTrigger(node: BlueprintNodeOf<'tracking.onBlendShapeThreshold' | 'tracking.onLost' | 'tracking.onFound'>, edge: TrackingEdge | undefined, env: StepEnv, nowMs: number): { edge: TrackingEdge; port: 'rise' | 'fall' | 'flow' | null }`.
- `RunEnv.trackingStatus`, `BlueprintEvent { kind: 'tracking' }`, `Active.trackingEdges`.
- Consumed from S1: `ArkitName` (contracts package only).
- No change to the show format, to the Rust contracts, or to the default tracking path.

## A — Approach

Add the Tracking category, the field kind, and the value node first. They need only the contracts package and `env.previousPose`. Then add the event nodes with their edge state, the `RunEnv` field, and the tracking phase in the runtime. Keep the edge logic in one pure function so a unit test covers each transition without a session. Then add one session-level case that checks the phase order.

## S — Structure

- `packages/contracts/src/blueprint-nodes/define.ts` (category, field kind), `tracking.ts` (new), `index.ts`.
- `packages/session/src/blueprint-eval/tracking.ts` (new), `blueprint-eval/index.ts` (`EVALUATORS`), `blueprint-eval/types.ts` (`RunEnv`), `blueprint-runtime.ts` (event, edges, phase), `session.ts` (event order, `previousStatuses`, `env`).
- `apps/desktop/src/components/BlueprintNodeFields.svelte` (the `trackingSource` select).
- `apps/mcp/src/resources.ts` (confirm only).
- Tests: `packages/session/test/tracking-nodes.test.ts`, `packages/session/test/blueprint-session.test.ts`.
- `ARCHITECTURE.md`.

## O — Operations

1. **Task 11.** Unit tests: the node reads 0.6 from a previous pose with `{eyeBlink_L: .6}` for `eyeBlinkLeft`; it reads 0 with no pose; the definition parses its defaults; the palette lists it under Tracking (the existing node-search helper test pattern).
2. **Task 12.** Unit tests: threshold fires `rise` once on the way up and `fall` once below the release, with the sequence 0.3, 0.6, 0.7, 0.45, 0.35, 0.6 giving rise at 0.6, fall at 0.35, and rise at 0.6; no second fire between release and threshold; Lost fires once after `after` seconds without `receiving` and only after the source was `receiving` (receiving, stale 700 ms, receiving gives nothing; then stale 2000 ms gives one `flow`); Found fires once on `receiving` after a Lost and not on the first `receiving`; a reinstalled graph starts with empty edges. A session test: a graph with On Blend Shape Threshold on `jawOpen` runs Set Expression in the tick order (after devices, before On Update).
3. Run `pnpm test:unit` and `pnpm check` after each task.
4. Acceptance (Task 13, Step 3): in the running app, a graph with On Blend Shape Threshold on `jawOpen` toggles an expression live, and a graph with On Tracking Lost shows a toast when the phone app stops and shows none during the normal gaps of SelfReflect.

## N — Norms

- Use pnpm, functional TypeScript, Zod 4, and Vitest. Put edge logic in pure functions that take state and return state.
- Write prose in ASD-STE100. UI copy is the node labels, field labels, and option labels only.
- Use `character.getBoneRotation` for tracked bones. Do not add a duplicate bone node.
- Keep each node family in its own file, as the device nodes do.

## S — Safeguards

- The default tracking path never depends on a graph. A deleted wire or a disabled graph must not stop face or body tracking.
- Lost means the app stopped, not that one packet was late. The `after` time guards a stalling sender.
- Edge state is runtime state. Do not save it in the show.
- Do not change the order of the existing phases: the tracking phase runs after devices and before On Update.
- Do not touch a file of S1, S2, or S3, except the shared files that the integrator merges.
- Do not add a dependency, a CI job, or a vendor service.
