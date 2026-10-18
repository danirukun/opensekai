# Blueprint depth: parallel execution plan (bundle B13)

Date: 2026-10-18. Base: `main` at `2663f1d`. Integration branch: `opensekai/blueprint-depth`. Integrator: the lead session.

## Goal

Make the Blueprint runtime and editor closer to the depth of Warudo Blueprints. The [node audit](../../evaluation/blueprint-node-audit.md) shows the main gap: OpenSekai ports carry `number`, `boolean`, and `vector3` only, data inputs need a wire, and 23 of 33 Warudo palette categories have no OpenSekai node. This batch adds the value model first, then node families on top of it, plus editor authoring, transitions, and input devices.

## Owner decisions (2026-10-18)

1. Numbers match Warudo: separate `integer` and `float`. The existing `number` port type is the float type. An integer output connects to a float input with an implicit widening. A float value goes to an integer input only through Round, Floor, Ceil, or Truncate nodes.
2. One integration PR from `opensekai/blueprint-depth`, with one or more commits per slice. One `/local-qa-e2e` run on that PR.
3. Slice I (gamepad, MIDI, and pointer triggers) is in this batch.

## Slices and waves

Wave 1 starts at once. Wave 2 starts when W0 is merged into the integration branch.

| Wave | Slice | Branch / worktree | Scope | Issues |
| --- | --- | --- | --- | --- |
| 1 | W0 Value model | `opensekai/bp-w0-value-model`, `.worktrees/bp-w0-value-model` | Port types `integer`, `string`, and typed lists; variables of each type; inline values on unconnected data inputs; a generic per-node run state; new palette categories; file format version and migration; editor sockets and inline editors for each type | #81 |
| 1 | G Editor authoring | `opensekai/bp-g-editor-authoring` | Collapsible palette categories with counts and per-user favorites; Format Graph; box select; comments; duplicate graph | #176, #177, #198, #82, #83 |
| 1 | H Transitions | `opensekai/bp-h-transitions` | A session tween layer with easing; transition time and easing on property, camera Field of View, and expression nodes; Set BlendShape; Look At | #85 |
| 1 | I Input devices | `opensekai/bp-i-input-devices` | Gamepad, MIDI, and pointer triggers through the native input adapter | #86 |
| 2 | A Data | `opensekai/bp-a-data` | String nodes, list nodes with For Each, Switch On String and Switch On Integer, get and set for each variable type, conversions | #81 |
| 2 | C Math | `opensekai/bp-c-math` | Integer and float math, clamp, remap, lerp, smooth damp, trigonometry, rounding, modulo, min and max, Vector3 operations | #81 |
| 2 | D Flow and events | `opensekai/bp-d-flow-events` | Do Once, On Disable, Debounce, timer nodes, custom events between graphs, Enable, Disable, and Toggle Blueprint | #81, #83 |
| 2 | F Debug | `opensekai/bp-f-debug` | Log, Show Toast, Debug Value, Emit Debug Event, editor toast and debug output | #199 |

Not in this batch: #197, #190, BP-08 to BP-12 presets, and the BP-13 pass that records the live Warudo palette names.

## Rules for each slice agent

1. Work only in your worktree. Verify `pwd` before each Git command. Do not use `git -C` or `cd … &&` chains.
2. Read `AGENTS.md`, `docs/constitution.md`, `ARCHITECTURE.md`, `docs/qa.md`, `docs/testing.md`, the [catalog contract](../../../spdd/prompt/2026-10-09-blueprint-catalog.md), and the [continuous contract](../../../spdd/prompt/2026-10-12-continuous-blueprints.md) first.
3. Write the requirements in `spdd/analysis/2026-10-18-blueprint-<slice>.md` and the seven REASONS sections in `spdd/prompt/2026-10-18-blueprint-<slice>.md` before code. Commit the contract first.
4. Put new node types in new family files: `packages/contracts/src/blueprint-nodes/<family>.ts` and `packages/session/src/blueprint-eval/<family>.ts`. Append one line to each `index.ts`. Do not reorder existing lines.
5. Add one row to `docs/evaluation/blueprint-node-audit.json` for each new node type. Each Warudo name is a candidate (`evidence: "tests"` until a macOS run).
6. Add unit tests for new function behavior and session integration tests for runtime behavior. Do not test static copy.
7. Do not edit `docs/warudo-parity.md`, `ARCHITECTURE.md`, `pnpm-lock.yaml`, or `Cargo.lock` unless your slice brief says so. Put the parity and architecture changes you need in your final report. The integrator applies them.
8. Do not edit files that another slice owns (see the ownership table). If you need a change there, stop and report it.
9. Before you report done, run `pnpm check` and `pnpm test:unit`, the session integration tests, and `cargo test --workspace` if you changed Rust. Report each result with its numbers.
10. Make small commits. Do not push, open a PR, or attribute commits to an agent.

## Ownership

| Path | Owner |
| --- | --- |
| `blueprint-nodes/define.ts`, `blueprint.ts`, `blueprint-file.ts`, `blueprint-ops.ts`, `blueprint-eval/types.ts`, `blueprint-eval/values.ts`, `apps/desktop/src/blueprints/fields.ts`, socket and inline input rendering in `rete-editor.ts` | W0 |
| Palette, node search, layout, selection, comments, graph list (`node-search.ts`, `selection-ops.ts`, `placement.ts`, the rest of `rete-editor.ts`, palette and graph list Svelte components) | G |
| `session/overrides.ts`, the tick in `session.ts`, `blueprint-nodes/character.ts`, `blueprint-nodes/properties.ts`, `blueprint-nodes/scene.ts` and their evaluators | H |
| `apps/desktop/src-tauri` input module, `blueprint-nodes/input.ts`, `blueprint-eval/input.ts`, input contract types | I |
| `blueprint-runtime.ts`, `blueprint-nodes/flow.ts`, `blueprint-nodes/events.ts` and their evaluators | D (wave 2) |
| Effect union in `session/blueprint.ts`, editor toast and debug output | F (wave 2) |
| New family files for strings, lists, conversions, switches, variables | A (wave 2) |
| `blueprint-nodes/math.ts`, `vector3.ts`, `logic.ts` and their evaluators | C (wave 2) |
| `docs/warudo-parity.md`, `ARCHITECTURE.md`, lockfiles, the two `index.ts` registration files at merge, `blueprint-node-audit.json` at merge | Integrator |

## Wave 1 interfaces that wave 2 uses

W0 publishes these in its contract, and wave 2 contracts cite them:

- `PortType` includes `integer`, `string`, and list types for each scalar type, and a rule for which output type connects to which input type.
- `BlueprintValue` covers each port type. Each port type has a default value.
- A node stores inline values for unconnected data inputs. The runtime reads the inline value when the input has no wire.
- `RunState` has one generic per-node state map, so a new stateful node does not change `RunState`.
- `NodeCategory` has the categories that wave 2 needs.
- `BlueprintField` has editor kinds for each new type.

## Integration

1. The integrator reviews each slice branch with `/code-review`, then merges it into `opensekai/blueprint-depth` and resolves the append conflicts in the two `index.ts` files and the audit file.
2. After each merge: `pnpm check`, `pnpm test:unit`, the integration tests, and `cargo test --workspace` when Rust changed.
3. The integrator updates `docs/warudo-parity.md` and `ARCHITECTURE.md` from the slice reports and claims only verified behavior.
4. One PR to `main`. Then `/local-qa-e2e` with one show that uses a string variable, a list, a custom event between two graphs, an eased camera move, a device trigger, and a debug toast, with OBS output.

## Disk

Only slice I and the final QA build Rust. Slice I uses a shared `CARGO_TARGET_DIR` so a new worktree does not make another large `target/`.
