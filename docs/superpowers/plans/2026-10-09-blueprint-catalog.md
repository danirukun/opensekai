# Blueprint Catalog and Editor Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every Blueprint node type into one definition, add 28 node types and per-graph variables, and give the Blueprint editor context menus, a search palette, keyboard shortcuts, copy and paste, and undo.

**Architecture:** `@opensekai/contracts` gets a `blueprint-nodes/` module with one definition per node type (schema, ports, defaults, fields, label, category, keywords); everything else derives from it. The session replaces its node switch with an evaluator table and a per-graph `RunState` (variables, gates, loops, random generator) that resets on install, logic change, or enable and then fires On Enable. The desktop editor adds pure helpers (search, clipboard, undo diff, shortcut map) and thin Svelte components on top of the existing Rete adapter and `blueprintEdit` sync path; the protocol gets only the `variables` key and three variable operations.

**Tech Stack:** TypeScript, zod 4.6.5, Svelte 5 runes, Rete 2 (`rete-area-plugin` 2.3.2, `rete-connection-plugin` 2.0.5, `rete-svelte-plugin` 2.1.2), `@oshi-connect/ui`, Vitest, Rust (`opensekai-contracts` crate, serde_json), MCP server SDK.

**Spec:** `docs/superpowers/specs/2026-10-09-blueprint-catalog-design.md`. REASONS: `spdd/prompt/2026-10-09-blueprint-catalog.md`. Analysis: `spdd/analysis/2026-10-09-blueprint-catalog.md`.

## Global Constraints

- Branch `opensekai/blueprint-catalog`. Run every command from the repository root `/Users/danirukun/ghq/github.com/oshi-connect/opensekai`. Do not use `git -C` or `cd … && …`. Do not push.
- End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Use pnpm. Svelte 5 runes. Functional TypeScript, plain data. Match the surrounding code: one-space indentation and compact lines in the Blueprint files; add a comment only when the logic is hard to follow.
- Use `@oshi-connect/ui` controls (`Input`, `Select`, `Button`, `Dropdown`) where they fit. The pointer menu and the search result list are product components styled in `apps/desktop/src/app.css`.
- UI copy is limited to node labels, category names, field labels, and these menu items: `Paste`, `Select all`, `Delete`, `Duplicate`, `Copy`, `Disconnect all`, `Run`. Placeholder of the search field: `Search nodes`. Variables section heading: `Variables`; add control label: `Add variable`.
- Prose in docs is ASD-STE100.
- Do not change the `type`, `version`, or settings of the 14 existing node types.
- Limits (exact): 32 variables per graph; variable name 1–64 characters after trim; 512 flow visits per event; 1024 flow visits and 64 effects per tick; 32 pending delays per graph; 64 iterations per loop entry; 64 undo steps per graph; 64 operations per batch; undo merge window 500 ms; duplicate offset 24 px.
- Random: mulberry32 seeded from the 32-bit FNV-1a hash of the graph ID.
- No protocol command for undo; no system clipboard; no Rust copy of node settings; no new scene effect.
- Verification commands: `pnpm exec vitest run --project unit <paths>`, `pnpm test:unit`, `pnpm test:integration`, `pnpm check`, `cargo test -p opensekai-contracts`, `cargo test -p opensekai-desktop`.

## Review Focus

1. A Backspace or Delete typed in an Inspector field, a variable name, or the search field must not delete nodes. Pinned in Task 9 (`keys.test.ts`, input, textarea, select, and contenteditable targets).
2. Undo after another client removed the node: the step is dropped, nothing crashes, and redo does not hold a step that cannot apply. Pinned in Task 9 (`undo.test.ts`, "drops a step that no longer applies").
3. A show saved before this slice (no `variables` key) opens and runs unchanged, in TypeScript and in Rust. Pinned in Task 3 (contract and Rust tests for a graph without `variables`).
4. A right-click on a node also bubbles to the canvas; the operator must see one menu, for the node. Pinned in Task 8 (`rete-editor.test.ts`, node then root `contextmenu` with the same event).
5. A paste with more than 64 operations is split into ordered batches, and a paste over the 128-node limit is rejected with no partial graph. Pinned in Task 9 (`blueprint-sync.test.ts`).

---

### Task 1: Node definitions for the existing 14 types

**Files:**
- Create: `packages/contracts/src/blueprint-nodes/define.ts`, `events.ts`, `values.ts`, `math.ts`, `logic.ts`, `flow.ts`, `scene.ts`, `index.ts`
- Delete: `packages/contracts/src/blueprint-nodes.ts`
- Modify: `packages/contracts/src/blueprint.ts`, `packages/contracts/src/blueprint-ops.ts` (imports only)
- Test: `packages/contracts/test/blueprint-definitions.test.ts`

**Interfaces:**
- Produces (all exported from `@opensekai/contracts`): `PortType`, `PortShape`, `NodeCategory`, `NODE_CATEGORIES`, `DefaultRefs`, `BlueprintField`, `NodeDefinition`, `defineNode`, `NODE_DEFINITIONS`, `BlueprintKind`, `BlueprintNode`, `BlueprintNodeOf<K>`, `BlueprintNodeSchema`, `BlueprintPositionSchema`, `nodeDefinition(type)`, `blueprintPorts(node)`, `ownPort`, `connectionType`, `BLUEPRINT_LABELS`, `defaultBlueprintSettings(kind, refs)`, `KEYSTROKE_CODES`, `KeystrokeSettingsSchema`, `KeystrokeSettings`, `keystrokeAccelerator`, `keystrokeHasModifier`. Internal helpers exported from `define.ts` for later tasks: `IdSchema`, `finite`, `empty`, `exit`, `numbered(prefix, count)`.
- `DefaultRefs` gains optional `variables?: readonly { id: string; type: 'number' | 'boolean' }[]` (used from Task 6).

- [ ] **Step 1: Write the failing test**

`packages/contracts/test/blueprint-definitions.test.ts`:

```ts
import { expect, it } from 'vitest';
import { BLUEPRINT_LABELS, BlueprintNodeSchema, NODE_DEFINITIONS, blueprintPorts, defaultBlueprintSettings, type BlueprintKind, type BlueprintNode, type DefaultRefs } from '../src';

const refs: DefaultRefs = { entityId: 'e', cameraId: 'c', outputId: 'o', keystroke: { code: 'KeyH', control: true, alt: true, shift: false, meta: false }, variables: [{ id: 'n', type: 'number' }, { id: 'b', type: 'boolean' }] };
const nodeOf = (type: string, settings: unknown) => ({ id: 'x', version: 1, type, settings, position: { x: 0, y: 0 } });
const ports = (type: BlueprintKind) => blueprintPorts(nodeOf(type, defaultBlueprintSettings(type, refs)) as BlueprintNode);

it('gives each node type defaults that its own schema accepts', () => {
 for (const definition of NODE_DEFINITIONS)
  expect(BlueprintNodeSchema.safeParse(nodeOf(definition.type, definition.defaults(refs))).success, definition.type).toBe(true);
});

it('has one definition per type, its label, and one field per settings key', () => {
 expect(new Set(NODE_DEFINITIONS.map(d => d.type)).size).toBe(NODE_DEFINITIONS.length);
 for (const definition of NODE_DEFINITIONS) {
  expect(BLUEPRINT_LABELS[definition.type]).toBe(definition.label);
  const keys = Object.keys(definition.defaults(refs) ?? {}).sort();
  const fieldKeys = definition.fields.flatMap(field => field.kind === 'keystroke' ? ['alt', 'code', 'control', 'meta', 'shift'] : [field.key]).sort();
  expect(fieldKeys, definition.type).toEqual(keys);
 }
});

it('keeps the ports of the existing node types', () => {
 const trigger = { inputs: {}, outputs: { flow: 'flow' } };
 const exit = { exit: 'flow' };
 expect(ports('event.manual')).toEqual(trigger);
 expect(ports('event.keystroke')).toEqual(trigger);
 expect(ports('value.number')).toEqual({ inputs: {}, outputs: { value: 'number' } });
 expect(ports('value.boolean')).toEqual({ inputs: {}, outputs: { value: 'boolean' } });
 expect(ports('math.add')).toEqual({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'number' } });
 expect(ports('logic.greater')).toEqual({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'boolean' } });
 expect(ports('logic.not')).toEqual({ inputs: { value: 'boolean' }, outputs: { result: 'boolean' } });
 expect(ports('flow.branch')).toEqual({ inputs: { flow: 'flow', condition: 'boolean' }, outputs: { true: 'flow', false: 'flow' } });
 expect(ports('flow.sequence')).toEqual({ inputs: { flow: 'flow' }, outputs: { then0: 'flow', then1: 'flow' } });
 expect(ports('flow.flipFlop')).toEqual({ inputs: { flow: 'flow' }, outputs: { a: 'flow', b: 'flow', isA: 'boolean' } });
 expect(ports('flow.delay')).toEqual({ inputs: { flow: 'flow' }, outputs: exit });
 expect(ports('scene.setVisibility')).toEqual({ inputs: { flow: 'flow', visible: 'boolean' }, outputs: exit });
 expect(ports('scene.toggleVisibility')).toEqual({ inputs: { flow: 'flow' }, outputs: exit });
 expect(ports('camera.switch')).toEqual({ inputs: { flow: 'flow' }, outputs: exit });
});

it('returns null defaults when the scene lacks the entity, camera, or output', () => {
 const bare: DefaultRefs = { keystroke: refs.keystroke };
 expect(defaultBlueprintSettings('scene.setVisibility', bare)).toBeNull();
 expect(defaultBlueprintSettings('camera.switch', { ...bare, cameraId: 'c' })).toBeNull();
 expect(defaultBlueprintSettings('flow.sequence', bare)).toEqual({ outputs: 2 });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `pnpm exec vitest run --project unit packages/contracts/test/blueprint-definitions.test.ts`
Expected: FAIL (`NODE_DEFINITIONS` is not exported).

- [ ] **Step 3: Write `define.ts`**

```ts
import { z } from 'zod';
import type { KeystrokeSettings } from './events';

export type PortType = 'flow' | 'number' | 'boolean';
export interface PortShape { inputs: Record<string, PortType>; outputs: Record<string, PortType> }
export type NodeCategory = 'Events' | 'Flow' | 'Values' | 'Math' | 'Logic' | 'Variables' | 'Scene';
export const NODE_CATEGORIES: readonly NodeCategory[] = ['Events', 'Flow', 'Values', 'Math', 'Logic', 'Variables', 'Scene'];
export interface DefaultRefs { entityId?: string; cameraId?: string; outputId?: string; keystroke: KeystrokeSettings; variables?: readonly { id: string; type: 'number' | 'boolean' }[] }
export type BlueprintField =
 | { key: string; label: string; kind: 'number'; min?: number; max?: number }
 | { key: string; label: string; kind: 'boolean' }
 | { key: string; label: string; kind: 'count'; min: number; max: number }
 | { key: string; label: string; kind: 'entity' | 'camera' | 'output' }
 | { key: string; label: string; kind: 'variable'; variableType: 'number' | 'boolean' }
 | { key: string; label: string; kind: 'cases' }
 | { key: string; label: string; kind: 'keystroke' };
export interface NodeDefinition<T extends string = string, S extends z.ZodType = z.ZodType> {
 type: T; label: string; category: NodeCategory; keywords: readonly string[];
 settings: S;
 ports(settings: z.output<S>): PortShape;
 // Null when the scene or graph lacks something the node needs.
 defaults(refs: DefaultRefs): z.output<S> | null;
 fields: readonly BlueprintField[];
 dynamicPorts?: boolean;
}
export const defineNode = <const T extends string, S extends z.ZodType>(definition: NodeDefinition<T, S>): NodeDefinition<T, S> => definition;

export const IdSchema = z.string().min(1).max(256);
export const finite = z.number().finite();
export const empty = z.strictObject({});
export const exit = { exit: 'flow' } as const;
export const numbered = (prefix: string, count: number): Record<string, PortType> =>
 Object.fromEntries(Array.from({ length: count }, (_, i) => [`${prefix}${i}`, 'flow' as const]));
```

- [ ] **Step 4: Write the family files**

`events.ts` (moves the keystroke schema out of `blueprint.ts`; note the JSON path is one level deeper):

```ts
import { z } from 'zod';
import codes from '../../../../fixtures/protocol/keystroke-codes.json';
import { defineNode, empty, type PortShape } from './define';

export const KEYSTROKE_CODES: readonly string[] = codes;
export const KeystrokeSettingsSchema = z.strictObject({
 code: z.enum(codes as [string, ...string[]]),
 control: z.boolean(), alt: z.boolean(), shift: z.boolean(), meta: z.boolean(),
});
export type KeystrokeSettings = z.infer<typeof KeystrokeSettingsSchema>;
export const keystrokeAccelerator = (s: KeystrokeSettings): string =>
 [s.control && 'Control', s.alt && 'Alt', s.shift && 'Shift', s.meta && 'Super', s.code].filter(Boolean).join('+');
export const keystrokeHasModifier = (s: KeystrokeSettings): boolean => s.control || s.alt || s.meta;

const trigger = (): PortShape => ({ inputs: {}, outputs: { flow: 'flow' } });
export const EVENT_NODES = [
 defineNode({ type: 'event.manual', label: 'Manual Trigger', category: 'Events', keywords: ['run', 'button', 'start', 'test'], settings: empty, ports: trigger, defaults: () => ({}), fields: [] }),
 defineNode({ type: 'event.keystroke', label: 'On Keystroke Pressed', category: 'Events', keywords: ['hotkey', 'key', 'shortcut', 'keyboard'], settings: KeystrokeSettingsSchema, ports: trigger, defaults: refs => ({ ...refs.keystroke }), fields: [{ key: 'keystroke', label: 'Keystroke', kind: 'keystroke' }] }),
] as const;
```

`values.ts`:

```ts
import { z } from 'zod';
import { defineNode, finite } from './define';

export const VALUE_NODES = [
 defineNode({ type: 'value.number', label: 'Number', category: 'Values', keywords: ['constant', 'float', 'integer'], settings: z.strictObject({ value: finite }), ports: () => ({ inputs: {}, outputs: { value: 'number' } }), defaults: () => ({ value: 0 }), fields: [{ key: 'value', label: 'Value', kind: 'number' }] }),
 defineNode({ type: 'value.boolean', label: 'Boolean', category: 'Values', keywords: ['true', 'false', 'constant'], settings: z.strictObject({ value: z.boolean() }), ports: () => ({ inputs: {}, outputs: { value: 'boolean' } }), defaults: () => ({ value: true }), fields: [{ key: 'value', label: 'Value', kind: 'boolean' }] }),
] as const;
```

`math.ts`:

```ts
import { defineNode, empty, type PortShape } from './define';

const binary = (): PortShape => ({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'number' } });
export const MATH_NODES = [
 defineNode({ type: 'math.add', label: 'Add', category: 'Math', keywords: ['plus', 'sum', '+'], settings: empty, ports: binary, defaults: () => ({}), fields: [] }),
] as const;
```

`logic.ts`:

```ts
import { defineNode, empty } from './define';

export const LOGIC_NODES = [
 defineNode({ type: 'logic.greater', label: 'Greater Than', category: 'Logic', keywords: ['compare', '>', 'more'], settings: empty, ports: () => ({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'boolean' } }), defaults: () => ({}), fields: [] }),
 defineNode({ type: 'logic.not', label: 'Not', category: 'Logic', keywords: ['invert', 'negate', '!'], settings: empty, ports: () => ({ inputs: { value: 'boolean' }, outputs: { result: 'boolean' } }), defaults: () => ({}), fields: [] }),
] as const;
```

`flow.ts`:

```ts
import { z } from 'zod';
import { defineNode, empty, exit, finite, numbered } from './define';

export const FLOW_NODES = [
 defineNode({ type: 'flow.branch', label: 'If Branch', category: 'Flow', keywords: ['if', 'condition', 'else'], settings: empty, ports: () => ({ inputs: { flow: 'flow', condition: 'boolean' }, outputs: { true: 'flow', false: 'flow' } }), defaults: () => ({}), fields: [] }),
 defineNode({ type: 'flow.sequence', label: 'Sequence', category: 'Flow', keywords: ['then', 'order', 'steps'], settings: z.strictObject({ outputs: z.number().int().min(2).max(8) }), ports: s => ({ inputs: { flow: 'flow' }, outputs: numbered('then', s.outputs) }), defaults: () => ({ outputs: 2 }), fields: [{ key: 'outputs', label: 'Outputs', kind: 'count', min: 2, max: 8 }], dynamicPorts: true }),
 defineNode({ type: 'flow.flipFlop', label: 'Flip Flop', category: 'Flow', keywords: ['toggle', 'alternate', 'switch'], settings: empty, ports: () => ({ inputs: { flow: 'flow' }, outputs: { a: 'flow', b: 'flow', isA: 'boolean' } }), defaults: () => ({}), fields: [] }),
 defineNode({ type: 'flow.delay', label: 'Delay', category: 'Flow', keywords: ['wait', 'timer', 'seconds', 'later'], settings: z.strictObject({ seconds: finite.min(0).max(3600) }), ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults: () => ({ seconds: 1 }), fields: [{ key: 'seconds', label: 'Seconds', kind: 'number', min: 0, max: 3600 }] }),
] as const;
```

`scene.ts`:

```ts
import { z } from 'zod';
import { defineNode, exit, IdSchema } from './define';

const entity = z.strictObject({ entityId: IdSchema });
export const SCENE_NODES = [
 defineNode({ type: 'scene.setVisibility', label: 'Set Visibility', category: 'Scene', keywords: ['show', 'hide', 'visible'], settings: entity, ports: () => ({ inputs: { flow: 'flow', visible: 'boolean' }, outputs: { ...exit } }), defaults: refs => refs.entityId ? { entityId: refs.entityId } : null, fields: [{ key: 'entityId', label: 'Entity', kind: 'entity' }] }),
 defineNode({ type: 'scene.toggleVisibility', label: 'Toggle Visibility', category: 'Scene', keywords: ['show', 'hide', 'visible'], settings: entity, ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults: refs => refs.entityId ? { entityId: refs.entityId } : null, fields: [{ key: 'entityId', label: 'Entity', kind: 'entity' }] }),
 defineNode({ type: 'camera.switch', label: 'Switch Camera', category: 'Scene', keywords: ['camera', 'cut', 'view', 'output'], settings: z.strictObject({ outputId: IdSchema, cameraId: IdSchema }), ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults: refs => refs.outputId && refs.cameraId ? { outputId: refs.outputId, cameraId: refs.cameraId } : null, fields: [{ key: 'outputId', label: 'Output', kind: 'output' }, { key: 'cameraId', label: 'Camera', kind: 'camera' }] }),
] as const;
```

- [ ] **Step 5: Write `index.ts` (registry)**

```ts
import { z } from 'zod';
import { finite, IdSchema, type DefaultRefs, type NodeDefinition, type PortShape, type PortType } from './define';
import { EVENT_NODES } from './events';
import { FLOW_NODES } from './flow';
import { LOGIC_NODES } from './logic';
import { MATH_NODES } from './math';
import { SCENE_NODES } from './scene';
import { VALUE_NODES } from './values';

export * from './define';
export { KEYSTROKE_CODES, KeystrokeSettingsSchema, keystrokeAccelerator, keystrokeHasModifier, type KeystrokeSettings } from './events';

// Palette order inside a category follows this list.
export const NODE_DEFINITIONS = [...EVENT_NODES, ...FLOW_NODES, ...VALUE_NODES, ...MATH_NODES, ...LOGIC_NODES, ...SCENE_NODES] as const;
type Definition = (typeof NODE_DEFINITIONS)[number];
export type BlueprintKind = Definition['type'];
export const BlueprintPositionSchema = z.strictObject({ x: finite, y: finite });
type NodeOf<D extends Definition> = { id: string; version: 1; position: { x: number; y: number }; type: D['type']; settings: z.output<D['settings']> };
export type BlueprintNode = { [D in Definition as D['type']]: NodeOf<D> }[BlueprintKind];
export type BlueprintNodeOf<K extends BlueprintKind> = Extract<BlueprintNode, { type: K }>;

const base = { id: IdSchema, version: z.literal(1), position: BlueprintPositionSchema };
const options = NODE_DEFINITIONS.map(d => z.strictObject({ ...base, type: z.literal(d.type), settings: d.settings }));
export const BlueprintNodeSchema = z.discriminatedUnion('type', options as unknown as [(typeof options)[number], ...(typeof options)[number][]]) as unknown as z.ZodType<BlueprintNode>;

const byType = new Map<string, NodeDefinition>(NODE_DEFINITIONS.map(d => [d.type, d as unknown as NodeDefinition]));
export const nodeDefinition = (type: BlueprintKind): NodeDefinition => byType.get(type)!;
export const blueprintPorts = (node: BlueprintNode): PortShape => nodeDefinition(node.type).ports(node.settings);
export const BLUEPRINT_LABELS = Object.fromEntries(NODE_DEFINITIONS.map(d => [d.type, d.label])) as Record<BlueprintKind, string>;
export const defaultBlueprintSettings = (kind: BlueprintKind, refs: DefaultRefs): BlueprintNode['settings'] | null =>
 nodeDefinition(kind).defaults(refs) as BlueprintNode['settings'] | null;

export const ownPort = (ports: PortShape, side: 'inputs' | 'outputs', name: string): PortType | undefined =>
 Object.hasOwn(ports[side], name) ? ports[side][name] : undefined;
// The type shared by an output and an input, or null when either port is missing or their types differ.
export function connectionType(source: BlueprintNode, sourcePort: string, target: BlueprintNode, targetPort: string): PortType | null {
 const output = ownPort(blueprintPorts(source), 'outputs', sourcePort), input = ownPort(blueprintPorts(target), 'inputs', targetPort);
 return output && output === input ? output : null;
}
```

If TypeScript rejects the mapped type `{ [D in Definition as D['type']]: … }`, use the equivalent distributive form `type BlueprintNode = Definition extends infer D ? D extends Definition ? NodeOf<D> : never : never;` and keep the rest.

- [ ] **Step 6: Trim `blueprint.ts` and fix imports**

Remove from `blueprint.ts`: the keystroke import, `KEYSTROKE_CODES`, `KeystrokeSettingsSchema`, `KeystrokeSettings`, `keystrokeAccelerator`, `keystrokeHasModifier`, `BlueprintPositionSchema`, `base`, `empty`, `entity`, `finite`, `BlueprintNodeSchema`, and `export type BlueprintNode`. Add at the top:

```ts
import { BlueprintNodeSchema, keystrokeHasModifier } from './blueprint-nodes';
```

Keep `IdSchema`, `BlueprintConnectionSchema`, `BlueprintGraphSchema` (unchanged), `BlueprintSetSchema`, `BlueprintConnection`, and `BlueprintGraph`.

In `blueprint-ops.ts`, change the imports to:

```ts
import { BlueprintConnectionSchema, BlueprintGraphSchema, BlueprintSetSchema, type BlueprintGraph } from './blueprint';
import { BlueprintNodeSchema, BlueprintPositionSchema, blueprintPorts, connectionType, ownPort } from './blueprint-nodes';
```

Delete `packages/contracts/src/blueprint-nodes.ts`. `src/index.ts` keeps `export * from './blueprint-nodes';` (now the directory).

- [ ] **Step 7: Run the tests and the type check**

Run: `pnpm exec vitest run --project unit packages/contracts packages/session apps/desktop apps/mcp`
Expected: PASS, including the new file.
Run: `pnpm check`
Expected: 0 errors. If an existing file imported a moved name from `'../src/blueprint'`, import it from `'../src'` instead.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts
git commit -m "Define each Blueprint node type in one place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Session evaluator table and run state

**Files:**
- Create: `packages/session/src/blueprint-eval/types.ts`, `events.ts`, `values.ts`, `flow.ts`, `scene.ts`, `index.ts`
- Modify: `packages/session/src/blueprint.ts` (`readInput`, `runFlow`, `FlowResult`), `packages/session/src/blueprint-runtime.ts` (`Active.flip` → `Active.state`)
- Test: `packages/session/test/blueprint.test.ts` (adjust), `packages/session/test/blueprint-eval.test.ts` (new)

**Interfaces:**
- Consumes: `NODE_DEFINITIONS`, `BlueprintKind`, `BlueprintNode`, `BlueprintNodeOf` (Task 1).
- Produces:
  - `type BlueprintValue = number | boolean`
  - `interface RunState { variables: Map<Id, BlueprintValue>; flip: Map<Id, boolean>; gates: Map<Id, boolean>; multi: Map<Id, number>; throttle: Map<Id, number>; loops: Map<Id, number>; random: number }`
  - `emptyState(seed?: number): RunState`, `cloneState(state): RunState`
  - `interface FlowContext { port: string; read(port: string): BlueprintValue; follow(...ports: string[]): void; emit(effect: BlueprintEffect): void; delay(seconds: number): void; state: RunState; nowMs: number }`
  - `interface Evaluator<N> { data?(node: N, output: string, read: (port: string) => BlueprintValue, state: RunState): BlueprintValue; flow?(node: N, context: FlowContext): void }`
  - `type EvaluatorTable = { [K in BlueprintKind]: Evaluator<BlueprintNodeOf<K>> }`; `EVALUATORS: EvaluatorTable`
  - `runFlow(compiled, start, state: RunState, budget, nowMs): Reply<{ effects; delays; state: RunState }>` — `state` is not mutated; the result holds the new state.

- [ ] **Step 1: Write the failing test**

`packages/session/test/blueprint-eval.test.ts`:

```ts
import { expect, it } from 'vitest';
import { NODE_DEFINITIONS } from '@opensekai/contracts';
import { EVALUATORS, emptyState, cloneState } from '../src/blueprint-eval';

it('has an evaluator for every node definition', () => {
 for (const definition of NODE_DEFINITIONS) expect(EVALUATORS[definition.type], definition.type).toBeDefined();
});

it('clones run state without sharing maps', () => {
 const state = emptyState(7);
 const copy = cloneState(state);
 copy.flip.set('ff', true); copy.variables.set('v', 1);
 expect(state.flip.size + state.variables.size).toBe(0);
 expect(copy.random).toBe(7);
});
```

In `packages/session/test/blueprint.test.ts`: add `import { emptyState } from '../src/blueprint-eval';`, replace every fourth `runFlow` argument `new Map()` (or a `Map` state) with `emptyState()` (for the Flip Flop test: `const state = emptyState();` and pass `state`), and replace `.data.flip` with `.data.state.flip`.

- [ ] **Step 2: Run the test and see it fail**

Run: `pnpm exec vitest run --project unit packages/session/test/blueprint-eval.test.ts`
Expected: FAIL (module `../src/blueprint-eval` not found).

- [ ] **Step 3: Write the evaluator modules**

`blueprint-eval/types.ts`:

```ts
import type { BlueprintKind, BlueprintNodeOf, Id } from '@opensekai/contracts';
import type { BlueprintEffect } from '../blueprint';

export type BlueprintValue = number | boolean;
export interface RunState { variables: Map<Id, BlueprintValue>; flip: Map<Id, boolean>; gates: Map<Id, boolean>; multi: Map<Id, number>; throttle: Map<Id, number>; loops: Map<Id, number>; random: number }
export const emptyState = (seed = 0): RunState => ({ variables: new Map(), flip: new Map(), gates: new Map(), multi: new Map(), throttle: new Map(), loops: new Map(), random: seed });
export const cloneState = (s: RunState): RunState => ({ variables: new Map(s.variables), flip: new Map(s.flip), gates: new Map(s.gates), multi: new Map(s.multi), throttle: new Map(s.throttle), loops: new Map(s.loops), random: s.random });

export interface FlowContext {
 // The flow input that this visit entered.
 port: string;
 read(port: string): BlueprintValue;
 follow(...ports: string[]): void;
 // Records the effect and continues at `exit`.
 emit(effect: BlueprintEffect): void;
 delay(seconds: number): void;
 state: RunState;
 nowMs: number;
}
export type Read = (port: string) => BlueprintValue;
export interface Evaluator<N> {
 data?(node: N, output: string, read: Read, state: RunState): BlueprintValue;
 flow?(node: N, context: FlowContext): void;
}
export type EvaluatorTable = { [K in BlueprintKind]: Evaluator<BlueprintNodeOf<K>> };
```

`blueprint-eval/events.ts`:

```ts
import type { EvaluatorTable } from './types';

// Event nodes only start runs; the runner follows their output directly.
export const EVENT_EVALUATORS = {
 'event.manual': {},
 'event.keystroke': {},
} satisfies Partial<EvaluatorTable>;
```

`blueprint-eval/values.ts`:

```ts
import type { EvaluatorTable } from './types';

export const VALUE_EVALUATORS = {
 'value.number': { data: node => node.settings.value },
 'value.boolean': { data: node => node.settings.value },
 'math.add': { data: (_node, _output, read) => Number(read('a')) + Number(read('b')) },
 'logic.greater': { data: (_node, _output, read) => Number(read('a')) > Number(read('b')) },
 'logic.not': { data: (_node, _output, read) => !read('value') },
} satisfies Partial<EvaluatorTable>;
```

`blueprint-eval/flow.ts`:

```ts
import type { EvaluatorTable } from './types';

export const FLOW_EVALUATORS = {
 'flow.branch': { flow: (_node, c) => c.follow(c.read('condition') ? 'true' : 'false') },
 'flow.sequence': { flow: (node, c) => c.follow(...Array.from({ length: node.settings.outputs }, (_, i) => `then${i}`)) },
 'flow.flipFlop': {
  data: (node, _output, _read, state) => state.flip.get(node.id) ?? false,
  flow: (node, c) => { const isA = !(c.state.flip.get(node.id) ?? false); c.state.flip.set(node.id, isA); c.follow(isA ? 'a' : 'b'); },
 },
 'flow.delay': { flow: (node, c) => c.delay(node.settings.seconds) },
} satisfies Partial<EvaluatorTable>;
```

`blueprint-eval/scene.ts`:

```ts
import type { EvaluatorTable } from './types';

export const SCENE_EVALUATORS = {
 'scene.setVisibility': { flow: (node, c) => c.emit({ kind: 'setVisibility', entityId: node.settings.entityId, visible: Boolean(c.read('visible')) }) },
 'scene.toggleVisibility': { flow: (node, c) => c.emit({ kind: 'toggleVisibility', entityId: node.settings.entityId }) },
 'camera.switch': { flow: (node, c) => c.emit({ kind: 'selectCamera', outputId: node.settings.outputId, cameraId: node.settings.cameraId }) },
} satisfies Partial<EvaluatorTable>;
```

`blueprint-eval/index.ts`:

```ts
import { EVENT_EVALUATORS } from './events';
import { FLOW_EVALUATORS } from './flow';
import { SCENE_EVALUATORS } from './scene';
import type { EvaluatorTable } from './types';
import { VALUE_EVALUATORS } from './values';

export * from './types';
// The annotation makes a missing node type a compile error.
export const EVALUATORS: EvaluatorTable = { ...EVENT_EVALUATORS, ...FLOW_EVALUATORS, ...VALUE_EVALUATORS, ...SCENE_EVALUATORS };
```

If `satisfies Partial<EvaluatorTable>` does not give the `node` parameters a contextual type, annotate each family object as `: Pick<EvaluatorTable, 'value.number' | …>` with its own keys.

- [ ] **Step 4: Replace `readInput` and `runFlow` in `blueprint.ts`**

Keep `compileBlueprint`, `BlueprintEffect`, `CompiledBlueprint`, `PendingDelay`, `FlowBudget`, `fail`, `key`, and `cycleIn` as they are. Replace the rest:

```ts
import { cloneState, EVALUATORS, type BlueprintValue, type Evaluator, type RunState } from './blueprint-eval';

export interface FlowResult { effects: BlueprintEffect[]; delays: PendingDelay[]; state: RunState }
const MAX_EVENT_VISITS = 64;
type Frame = { nodeId: Id; port: string };
const evaluator = (node: BlueprintNode) => EVALUATORS[node.type] as Evaluator<BlueprintNode>;

const readInput = (compiled: CompiledBlueprint, state: RunState, nodeId: Id, port: string): BlueprintValue => {
 const cache = new Map<string, BlueprintValue>();
 const evaluate = (id: Id, out: string): BlueprintValue => {
  const cached = cache.get(key(id, out));
  if (cached !== undefined) return cached;
  const node = compiled.nodes.get(id)!;
  const data = evaluator(node).data;
  if (!data) throw new Error('Blueprint has an invalid data source');
  const result = data(node, out, name => { const wire = compiled.dataIn.get(key(id, name))!; return evaluate(wire.sourceNodeId, wire.sourcePort); }, state);
  if (typeof result === 'number' && !Number.isFinite(result)) throw new RangeError('Blueprint number is not finite');
  cache.set(key(id, out), result);
  return result;
 };
 const wire = compiled.dataIn.get(key(nodeId, port))!;
 return evaluate(wire.sourceNodeId, wire.sourcePort);
};

export function runFlow(compiled: CompiledBlueprint, start: { nodeId: Id; port: string }, state: RunState, budget: FlowBudget, nowMs: number): Reply<FlowResult> {
 const next = cloneState(state);
 const effects: BlueprintEffect[] = [], delays: PendingDelay[] = [], stack: Frame[] = [];
 const follow = (nodeId: Id, ports: string[]) => {
  for (const port of [...ports].reverse()) { const wire = compiled.flowNext.get(key(nodeId, port)); if (wire) stack.push({ nodeId: wire.targetNodeId, port: wire.targetPort }); }
 };
 follow(start.nodeId, [start.port]);
 let visits = 0;
 while (stack.length > 0) {
  if (++visits > MAX_EVENT_VISITS || --budget.visits < 0) return fail('Blueprint run exceeded its flow limit', [start.nodeId]);
  const frame = stack.pop()!;
  const node = compiled.nodes.get(frame.nodeId)!;
  const flow = evaluator(node).flow;
  if (!flow) return fail('Blueprint flow reached a data node', [node.id]);
  let failure: Reply<never> | null = null;
  try {
   flow(node, {
    port: frame.port, state: next, nowMs,
    read: port => readInput(compiled, next, node.id, port),
    follow: (...ports) => follow(node.id, ports),
    emit: effect => {
     if (--budget.effects < 0) { failure ??= fail('Blueprint run exceeded its operation limit', [node.id]); return; }
     effects.push(effect); follow(node.id, ['exit']);
    },
    delay: seconds => { delays.push({ nodeId: node.id, dueMs: nowMs + seconds * 1000 }); },
   });
  } catch { return fail('Blueprint data could not be evaluated', [node.id]); }
  if (failure) return failure;
 }
 return { ok: true, data: { effects, delays, state: next } };
}
```

- [ ] **Step 5: Update `blueprint-runtime.ts`**

```ts
import { emptyState, type RunState } from './blueprint-eval';
interface Active { compiled: CompiledBlueprint; logic: string; state: RunState; delays: (PendingDelay & { order: number })[] }
```

In `run`: call `runFlow(entry.compiled, start, entry.state, budget, nowMs)` and replace `entry.flip = result.data.flip;` with `entry.state = result.data.state;`. In `installCompiled`: `return { compiled, logic, state: previous?.state ?? emptyState(), delays: previous?.delays ?? [] };`.

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run --project unit packages/session apps/desktop`
Expected: PASS.
Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/session
git commit -m "Evaluate Blueprint nodes through a table with one run state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Variables in the contract (TypeScript and Rust)

**Files:**
- Create: `fixtures/protocol/blueprint-variables.json`
- Modify: `packages/contracts/src/blueprint.ts`, `packages/contracts/src/blueprint-ops.ts`, `crates/contracts/src/lib.rs`, `apps/desktop/src/components/BlueprintPanel.svelte` (`create()` adds `variables: []`)
- Test: `packages/contracts/test/blueprint-variables.test.ts` (new), `crates/contracts/tests/blueprint.rs` (append)

**Interfaces:**
- Produces: `BlueprintVariableSchema`, `type BlueprintVariable = { id; name; type: 'number'; default: number } | { id; name; type: 'boolean'; default: boolean }`; `BlueprintGraph.variables: BlueprintVariable[]` (input optional, output always an array). New `BlueprintOp` kinds: `addVariable { graphId, variable }`, `updateVariable { graphId, variableId, name?, type?, default? }`, `removeVariable { graphId, variableId }`.
- Error texts: `Duplicate variable ID`, `Duplicate variable name`, `Variable not found`, `Invalid variable`.

- [ ] **Step 1: Write the shared fixture**

`fixtures/protocol/blueprint-variables.json`:

```json
{
 "valid": {
  "schemaVersion": 1, "id": "counter", "name": "Counter",
  "variables": [
   { "id": "count", "name": "Count", "type": "number", "default": 0 },
   { "id": "armed", "name": "Armed", "type": "boolean", "default": false }
  ],
  "nodes": [], "connections": []
 },
 "invalid": [
  { "name": "duplicate-id", "variables": [ { "id": "count", "name": "Count", "type": "number", "default": 0 }, { "id": "count", "name": "Other", "type": "number", "default": 1 } ] },
  { "name": "default-type", "variables": [ { "id": "v", "name": "V", "type": "number", "default": true } ] },
  { "name": "unknown-type", "variables": [ { "id": "v", "name": "V", "type": "string", "default": "x" } ] },
  { "name": "blank-name", "variables": [ { "id": "v", "name": "  ", "type": "boolean", "default": true } ] },
  { "name": "unknown-key", "variables": [ { "id": "v", "name": "V", "type": "boolean", "default": true, "note": "x" } ] },
  { "name": "long-name", "variables": [ { "id": "v", "name": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "type": "boolean", "default": true } ] },
  { "name": "not-array", "variables": {} }
 ]
}
```

The `long-name` value has 65 `x` characters; check with `node -e "console.log(require('./fixtures/protocol/blueprint-variables.json').invalid[5].variables[0].name.length)"` → `65`.

- [ ] **Step 2: Write the failing TypeScript test**

`packages/contracts/test/blueprint-variables.test.ts`:

```ts
import { expect, it } from 'vitest';
import vectors from '../../../fixtures/protocol/blueprint-variables.json';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintGraphSchema, BlueprintSetSchema, type BlueprintGraph } from '../src';

const valid = () => structuredClone(vectors.valid);
const graphs = (): BlueprintGraph[] => [BlueprintGraphSchema.parse(valid())];

it('accepts typed variables and fills a missing key with an empty list', () => {
 expect(BlueprintGraphSchema.parse(valid()).variables).toHaveLength(2);
 expect(BlueprintSetSchema.parse(fixture.blueprints).every(graph => graph.variables.length === 0)).toBe(true);
});

it('rejects each invalid variable vector, duplicate names, and more than 32 variables', () => {
 for (const vector of vectors.invalid) expect(BlueprintGraphSchema.safeParse({ ...valid(), variables: vector.variables }).success, vector.name).toBe(false);
 expect(BlueprintGraphSchema.safeParse({ ...valid(), variables: [{ id: 'a', name: 'Same', type: 'number', default: 0 }, { id: 'b', name: 'Same', type: 'number', default: 0 }] }).success).toBe(false);
 const many = Array.from({ length: 33 }, (_, i) => ({ id: `v${i}`, name: `V${i}`, type: 'number', default: 0 }));
 expect(BlueprintGraphSchema.safeParse({ ...valid(), variables: many }).success).toBe(false);
});

it('adds, renames, retypes, and removes a variable', () => {
 const added = applyBlueprintOps(graphs(), [{ kind: 'addVariable', graphId: 'counter', variable: { id: 'speed', name: 'Speed', type: 'number', default: 2 } }]);
 expect(added.ok && added.data[0]!.variables.map(v => v.id)).toEqual(['count', 'armed', 'speed']);
 const renamed = applyBlueprintOps(graphs(), [{ kind: 'updateVariable', graphId: 'counter', variableId: 'count', name: 'Hits', default: 5 }]);
 expect(renamed.ok && renamed.data[0]!.variables[0]).toEqual({ id: 'count', name: 'Hits', type: 'number', default: 5 });
 const retyped = applyBlueprintOps(graphs(), [{ kind: 'updateVariable', graphId: 'counter', variableId: 'count', type: 'boolean' }]);
 expect(retyped.ok && retyped.data[0]!.variables[0]).toEqual({ id: 'count', name: 'Count', type: 'boolean', default: false });
 const removed = applyBlueprintOps(graphs(), [{ kind: 'removeVariable', graphId: 'counter', variableId: 'armed' }]);
 expect(removed.ok && removed.data[0]!.variables.map(v => v.id)).toEqual(['count']);
});

it('rejects variable operations that do not apply', () => {
 expect(applyBlueprintOps(graphs(), [{ kind: 'addVariable', graphId: 'counter', variable: { id: 'count', name: 'X', type: 'number', default: 0 } }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Duplicate variable ID' } });
 expect(applyBlueprintOps(graphs(), [{ kind: 'updateVariable', graphId: 'counter', variableId: 'gone', name: 'X' }])).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', message: 'Variable not found' } });
 expect(applyBlueprintOps(graphs(), [{ kind: 'removeVariable', graphId: 'counter', variableId: 'gone' }])).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(applyBlueprintOps(graphs(), [{ kind: 'updateVariable', graphId: 'counter', variableId: 'count', default: true }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid variable' } });
 expect(applyBlueprintOps(graphs(), [{ kind: 'updateVariable', graphId: 'counter', variableId: 'count', name: 'Armed' }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('treats a graph object without a variables key as having none', () => {
 const legacy = structuredClone(fixture.blueprints[0]) as unknown as BlueprintGraph;
 expect(applyBlueprintOps([legacy], [{ kind: 'addVariable', graphId: legacy.id, variable: { id: 'n', name: 'N', type: 'number', default: 0 } }]).ok).toBe(true);
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `pnpm exec vitest run --project unit packages/contracts/test/blueprint-variables.test.ts`
Expected: FAIL (unknown op kind `addVariable`, and missing `variables` in output).

- [ ] **Step 4: Implement the TypeScript contract**

In `blueprint.ts`, after `IdSchema`:

```ts
const VariableName = z.string().trim().min(1).max(64);
export const BlueprintVariableSchema = z.discriminatedUnion('type', [
 z.strictObject({ id: IdSchema, name: VariableName, type: z.literal('number'), default: z.number().finite() }),
 z.strictObject({ id: IdSchema, name: VariableName, type: z.literal('boolean'), default: z.boolean() }),
]);
export type BlueprintVariable = z.infer<typeof BlueprintVariableSchema>;
```

In `BlueprintGraphSchema` add `variables: z.array(BlueprintVariableSchema).max(32).default([]),` after `connections`, and in `superRefine`:

```ts
 if (new Set(graph.variables.map(variable => variable.id)).size !== graph.variables.length)
  context.addIssue({ code: 'custom', message: 'Duplicate variable ID', path: ['variables'] });
 if (new Set(graph.variables.map(variable => variable.name)).size !== graph.variables.length)
  context.addIssue({ code: 'custom', message: 'Duplicate variable name', path: ['variables'] });
```

In `blueprint-ops.ts` import `BlueprintVariableSchema` and add to `BlueprintOpSchema`:

```ts
 z.strictObject({ kind: z.literal('addVariable'), graphId: IdSchema, variable: BlueprintVariableSchema }),
 z.strictObject({ kind: z.literal('updateVariable'), graphId: IdSchema, variableId: IdSchema, name: z.string().trim().min(1).max(64).optional(), type: z.enum(['number', 'boolean']).optional(), default: z.union([z.number().finite(), z.boolean()]).optional() }),
 z.strictObject({ kind: z.literal('removeVariable'), graphId: IdSchema, variableId: IdSchema }),
```

In `applyBlueprintOps`, change the first line to `let next = (structuredClone(graphs) as BlueprintGraph[]).map(graph => ({ ...graph, variables: graph.variables ?? [] }));` and add these cases to the switch:

```ts
   case 'addVariable':
    if (graph.variables.some(v => v.id === op.variable.id)) return reject('INVALID_INPUT', 'Duplicate variable ID', [op.variable.id]);
    graph.variables.push(structuredClone(op.variable)); break;
   case 'updateVariable': {
    const i = graph.variables.findIndex(v => v.id === op.variableId);
    if (i < 0) return reject('NOT_FOUND', 'Variable not found', [op.variableId]);
    const old = graph.variables[i]!, type = op.type ?? old.type;
    // A new type without a new default starts from that type's zero value.
    const fallback = type === old.type ? old.default : type === 'number' ? 0 : false;
    const parsed = BlueprintVariableSchema.safeParse({ id: old.id, name: op.name ?? old.name, type, default: op.default ?? fallback });
    if (!parsed.success) return reject('INVALID_INPUT', 'Invalid variable', [op.variableId]);
    graph.variables[i] = parsed.data; break;
   }
   case 'removeVariable':
    if (!graph.variables.some(v => v.id === op.variableId)) return reject('NOT_FOUND', 'Variable not found', [op.variableId]);
    graph.variables = graph.variables.filter(v => v.id !== op.variableId); break;
```

In `BlueprintPanel.svelte` `create()`, add `variables: [],` after `enabled: true,`. Run `pnpm check`; for each other type error "Property 'variables' is missing", add `variables: []` to that graph literal.

- [ ] **Step 5: Run the TypeScript tests**

Run: `pnpm exec vitest run --project unit packages/contracts packages/session apps/desktop`
Expected: PASS.

- [ ] **Step 6: Write the failing Rust test**

Append to `crates/contracts/tests/blueprint.rs`:

```rust
fn variables() -> Value {
    serde_json::from_str(include_str!("../../../fixtures/protocol/blueprint-variables.json")).unwrap()
}

#[test]
fn blueprint_graph_checks_variable_structure() {
    let v = variables();
    assert!(validate_blueprint_graph(&v["valid"]).is_ok());
    let mut legacy = v["valid"].clone();
    legacy.as_object_mut().unwrap().remove("variables");
    assert!(validate_blueprint_graph(&legacy).is_ok());
    for case in v["invalid"].as_array().unwrap() {
        let mut g = v["valid"].clone();
        g["variables"] = case["variables"].clone();
        assert!(validate_blueprint_graph(&g).is_err(), "{}", case["name"]);
    }
    let mut many = v["valid"].clone();
    many["variables"] = json!((0..33).map(|i| json!({"id": format!("v{i}"), "name": format!("V{i}"), "type": "number", "default": 0})).collect::<Vec<_>>());
    assert!(validate_blueprint_graph(&many).is_err());
}

#[test]
fn blueprint_edit_accepts_variable_operations() {
    let ok = |op: Value| validate_call("blueprintEdit", &edit(json!([op]))).is_ok();
    assert!(ok(json!({"kind":"addVariable","graphId":"g","variable":{"id":"v","name":"V","type":"number","default":1.5}})));
    assert!(!ok(json!({"kind":"addVariable","graphId":"g","variable":{"id":"v","name":"V","type":"number","default":false}})));
    assert!(ok(json!({"kind":"updateVariable","graphId":"g","variableId":"v","name":"W","type":"boolean","default":true})));
    assert!(ok(json!({"kind":"updateVariable","graphId":"g","variableId":"v"})));
    assert!(!ok(json!({"kind":"updateVariable","graphId":"g","variableId":"v","type":"string"})));
    assert!(!ok(json!({"kind":"updateVariable","graphId":"g","variableId":"v","name":" "})));
    assert!(ok(json!({"kind":"removeVariable","graphId":"g","variableId":"v"})));
    assert!(!ok(json!({"kind":"removeVariable","graphId":"g"})));
}
```

If `validate_blueprint_graph` is not reachable from the test crate, use `validate_blueprint_set(&[g])` instead.

- [ ] **Step 7: Run it and see it fail**

Run: `cargo test -p opensekai-contracts --test blueprint`
Expected: FAIL (`variables` is an unknown graph key; variable operations are rejected).

- [ ] **Step 8: Implement the Rust checks**

In `crates/contracts/src/lib.rs`, next to `position_ok`:

```rust
fn variable_name_ok(name: &Value) -> bool {
    name.as_str()
        .is_some_and(|n| !n.trim().is_empty() && n.chars().count() <= 64)
}
fn variable_ok(v: &Value) -> bool {
    keys_within(v, &["id", "name", "type", "default"])
        && id_ok(&v["id"])
        && variable_name_ok(&v["name"])
        && match v["type"].as_str() {
            Some("number") => v["default"].as_f64().is_some_and(f64::is_finite),
            Some("boolean") => v["default"].is_boolean(),
            _ => false,
        }
}
```

In `validate_blueprint_graph`, add `"variables"` to the allowed key list, and before `Ok(())`:

```rust
    if let Some(vars) = graph.get("variables") {
        let vars = vars
            .as_array()
            .filter(|v| v.len() <= 32)
            .ok_or_else(|| invalid("invalid Blueprint variables"))?;
        let mut ids = std::collections::HashSet::new();
        for v in vars {
            require(variable_ok(v), "Invalid Blueprint variable")?;
            require(
                ids.insert(v["id"].as_str().unwrap_or_default()),
                "Duplicate variable ID",
            )?;
        }
    }
```

In `validate_blueprint_ops`, add before `_ => false`:

```rust
            Some("addVariable") => {
                keys_within(op, &["kind", "graphId", "variable"])
                    && id_ok(&op["graphId"])
                    && variable_ok(&op["variable"])
            }
            Some("updateVariable") => {
                keys_within(op, &["kind", "graphId", "variableId", "name", "type", "default"])
                    && id_ok(&op["graphId"])
                    && id_ok(&op["variableId"])
                    && op.get("name").is_none_or(variable_name_ok)
                    && op
                        .get("type")
                        .is_none_or(|t| matches!(t.as_str(), Some("number" | "boolean")))
                    && op
                        .get("default")
                        .is_none_or(|d| d.is_boolean() || d.as_f64().is_some_and(f64::is_finite))
            }
            Some("removeVariable") => {
                keys_within(op, &["kind", "graphId", "variableId"])
                    && id_ok(&op["graphId"])
                    && id_ok(&op["variableId"])
            }
```

- [ ] **Step 9: Run the Rust and full checks**

Run: `cargo test -p opensekai-contracts` and `cargo test -p opensekai-desktop`
Expected: PASS.
Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add fixtures/protocol/blueprint-variables.json packages/contracts crates/contracts apps/desktop/src/components/BlueprintPanel.svelte
git commit -m "Add typed per-graph variables to the Blueprint contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Graph state reset, On Enable, and the new limits

**Files:**
- Create: `packages/session/src/blueprint-random.ts`
- Modify: `packages/contracts/src/blueprint-nodes/events.ts` (add `event.enable`), `packages/session/src/blueprint-eval/events.ts`, `packages/session/src/blueprint.ts` (`MAX_EVENT_VISITS = 512`), `packages/session/src/blueprint-runtime.ts`
- Test: `packages/session/test/blueprint-random.test.ts` (new), `packages/session/test/blueprint-session.test.ts` (append), `packages/session/test/blueprint.test.ts` (rewrite the limit test)

**Interfaces:**
- Consumes: `RunState`, `emptyState` (Task 2); `BlueprintGraph.variables` (Task 3).
- Produces: node type `event.enable` (label `On Enable`); `fnv1a(text: string): number`; `nextRandom(state: number): { value: number; state: number }` (value in [0, 1)); `initialState(graph: BlueprintGraph): RunState` exported from `blueprint-runtime.ts`; `logicKey` now includes `variables` without names.

- [ ] **Step 1: Write the failing tests**

`packages/session/test/blueprint-random.test.ts`:

```ts
import { expect, it } from 'vitest';
import { fnv1a, nextRandom } from '../src/blueprint-random';

it('hashes with 32-bit FNV-1a', () => {
 expect(fnv1a('')).toBe(0x811c9dc5);
 expect(fnv1a('a')).toBe(0xe40c292c);
 expect(fnv1a('foobar')).toBe(0xbf9cf968);
});

it('steps mulberry32 deterministically within [0, 1)', () => {
 let state = fnv1a('graph');
 const first: number[] = [];
 for (let i = 0; i < 100; i++) { const step = nextRandom(state); first.push(step.value); state = step.state; }
 let again = fnv1a('graph');
 for (const value of first) { const step = nextRandom(again); expect(step.value).toBe(value); again = step.state; }
 expect(first.every(value => value >= 0 && value < 1)).toBe(true);
 expect(new Set(first).size).toBe(100);
});
```

Append to `packages/session/test/blueprint-session.test.ts`:

```ts
const enableGraph = (enabled = true) => [{ schemaVersion: 1, id: 'setup', name: 'Setup', enabled, variables: [],
 nodes: [
  { id: 'on', version: 1, type: 'event.enable', settings: {}, position: { x: 0, y: 0 } },
  { id: 'flip', version: 1, type: 'scene.toggleVisibility', settings: { entityId: 'marker' }, position: { x: 300, y: 0 } },
 ],
 connections: [{ id: 'w', sourceNodeId: 'on', sourcePort: 'flow', targetNodeId: 'flip', targetPort: 'flow' }] }];

it('fires On Enable once after install, a logic edit, and a re-enable, but not after a move', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, enableGraph());
 session.advance(0);
 expect(visible(session, 'marker')).toBe(false);
 session.advance(16);
 expect(visible(session, 'marker')).toBe(false);
 session.editBlueprints({ clientId: 't', batchId: 'move', ops: [{ kind: 'moveNode', graphId: 'setup', nodeId: 'flip', position: { x: 9, y: 9 } }] });
 session.advance(32);
 expect(visible(session, 'marker')).toBe(false);
 session.editBlueprints({ clientId: 't', batchId: 'logic', ops: [{ kind: 'addVariable', graphId: 'setup', variable: { id: 'n', name: 'N', type: 'number', default: 1 } }] });
 session.advance(48);
 expect(visible(session, 'marker')).toBe(true);
 session.editBlueprints({ clientId: 't', batchId: 'off', ops: [{ kind: 'updateGraph', graphId: 'setup', enabled: false }] });
 session.advance(64);
 expect(visible(session, 'marker')).toBe(true);
 session.editBlueprints({ clientId: 't', batchId: 'on', ops: [{ kind: 'updateGraph', graphId: 'setup', enabled: true }] });
 session.advance(80);
 expect(visible(session, 'marker')).toBe(false);
});

it('does not fire On Enable for a graph that is installed disabled', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, enableGraph(false));
 session.advance(0);
 expect(visible(session, 'marker')).toBe(true);
});
```

In `packages/session/test/blueprint.test.ts`, replace the test `'stops at the per-event visit limit and at the shared tick budget'` with:

```ts
it('stops at the shared tick budget', () => {
 const nodes = [node('start', 'event.manual'), ...Array.from({ length: 70 }, (_, i) => node(`t${i}`, 'scene.toggleVisibility', { entityId: 'm' }))];
 const wires = [wire('w', 'start', 'flow', 't0', 'flow'), ...Array.from({ length: 69 }, (_, i) => wire(`w${i}`, `t${i}`, 'exit', `t${i + 1}`, 'flow'))];
 expect(runFlow(compiled(graph(nodes, wires)), { nodeId: 'start', port: 'flow' }, emptyState(), { visits: 50, effects: 256 }, 0)).toMatchObject({ ok: false, error: { message: 'Blueprint run exceeded its flow limit' } });
 expect(runFlow(compiled(graph(nodes.slice(0, 4), wires.slice(0, 3))), { nodeId: 'start', port: 'flow' }, emptyState(), { visits: 256, effects: 2 }, 0)).toMatchObject({ ok: false, error: { message: 'Blueprint run exceeded its operation limit' } });
 expect(runFlow(compiled(graph(nodes, wires)), { nodeId: 'start', port: 'flow' }, emptyState(), { visits: 1024, effects: 256 }, 0).ok).toBe(true);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit packages/session`
Expected: FAIL (missing `blueprint-random`, unknown node type `event.enable`, and the 70-node chain fails at the old 64-visit event limit).

- [ ] **Step 3: Implement**

`packages/session/src/blueprint-random.ts`:

```ts
export const fnv1a = (text: string): number => {
 let hash = 0x811c9dc5;
 for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
 return hash >>> 0;
};
// mulberry32: one step gives a value in [0, 1) and the next state.
export const nextRandom = (state: number): { value: number; state: number } => {
 const next = (state + 0x6d2b79f5) >>> 0;
 let t = next;
 t = Math.imul(t ^ (t >>> 15), t | 1);
 t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
 return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
};
```

In contracts `events.ts`, add to `EVENT_NODES` after `event.keystroke`:

```ts
 defineNode({ type: 'event.enable', label: 'On Enable', category: 'Events', keywords: ['start', 'setup', 'init', 'load', 'reset'], settings: empty, ports: trigger, defaults: () => ({}), fields: [] }),
```

In session `blueprint-eval/events.ts` add `'event.enable': {},`.

In `blueprint.ts` set `const MAX_EVENT_VISITS = 512;`.

In `blueprint-runtime.ts`:

```ts
import { emptyState, type RunState } from './blueprint-eval';
import { fnv1a } from './blueprint-random';

interface Active { compiled: CompiledBlueprint; logic: string; state: RunState; delays: (PendingDelay & { order: number })[]; enable: boolean }
const MAX_DELAYS = 32, TICK_VISITS = 1024, TICK_EFFECTS = 64;
// Executable content only: positions and names do not reset runtime state.
export const logicKey = (graph: BlueprintGraph) => JSON.stringify([graph.id, graph.enabled, graph.nodes.map(({ id, type, settings }) => [id, type, settings]), graph.connections, (graph.variables ?? []).map(({ id, type, default: value }) => [id, type, value])]);
export const initialState = (graph: BlueprintGraph): RunState =>
 ({ ...emptyState(fnv1a(graph.id)), variables: new Map((graph.variables ?? []).map(variable => [variable.id, variable.default])) });
```

`installCompiled` body:

```ts
  active = graphs.map(compiled => {
   const logic = logicKey(compiled.graph);
   const previous = compiled.graph.enabled && !fresh ? active.find(entry => entry.logic === logic) : undefined;
   // A new state on an enabled graph runs its On Enable nodes on the next step.
   return previous ? { ...previous, compiled } : { compiled, logic, state: initialState(compiled.graph), delays: [], enable: compiled.graph.enabled };
  });
```

At the start of `step`, use `const budget: FlowBudget = { visits: TICK_VISITS, effects: TICK_EFFECTS };`, then before the due-delay loop:

```ts
   for (const entry of active) {
    if (!entry.enable) continue;
    entry.enable = false;
    for (const node of entry.compiled.graph.nodes)
     if (node.type === 'event.enable') runs.push(run(entry, { nodeId: node.id, port: 'flow' }, budget, nowMs, gate));
   }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project unit packages/session packages/contracts apps/desktop`
Expected: PASS.
Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/session
git commit -m "Reset Blueprint graph state with On Enable and raise the flow limits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Flow nodes (Gate, Multi Gate, Throttle, For Loop, Switch On Number)

**Files:**
- Modify: `packages/contracts/src/blueprint-nodes/flow.ts`, `packages/session/src/blueprint-eval/types.ts` (`FlowContext.loop`), `packages/session/src/blueprint-eval/flow.ts`, `packages/session/src/blueprint.ts` (loop frames)
- Test: `packages/session/test/blueprint-flow-nodes.test.ts` (new)

**Interfaces:**
- Consumes: `FlowContext`, `RunState` (Task 2); `numbered` (Task 1).
- Produces: node types `flow.gate` (`{ startOpen: boolean }`), `flow.multiGate` (`{ outputs: 2..8, loop: boolean }`), `flow.throttle` (`{ seconds: 0.01..3600 }`), `flow.forLoop` (`{}`), `flow.switch` (`{ cases: int[1..8], unique, |n| ≤ 1e6 }`). `FlowContext.loop(first: number, last: number): void`. Error text `Blueprint loop exceeded its iteration limit`.

- [ ] **Step 1: Write the failing test**

`packages/session/test/blueprint-flow-nodes.test.ts`:

```ts
import { expect, it } from 'vitest';
import { compileBlueprint, runFlow } from '../src/blueprint';
import { emptyState, type RunState } from '../src/blueprint-eval';

const node = (id: string, type: string, settings: object = {}) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 } });
const wire = (id: string, s: string, sp: string, t: string, tp: string) => ({ id, sourceNodeId: s, sourcePort: sp, targetNodeId: t, targetPort: tp });
const toggle = (id: string) => node(id, 'scene.toggleVisibility', { entityId: id });
const compiled = (nodes: object[], connections: object[]) => { const c = compileBlueprint({ schemaVersion: 1, id: 'g', name: 'G', nodes, connections }); if (!c.ok) throw new Error(c.error.message); return c.data; };
const big = () => ({ visits: 4096, effects: 4096 });
// Runs each start node in order, carrying state, and returns the entity IDs each run toggled.
const play = (g: ReturnType<typeof compiled>, starts: string[], times: number[] = []) => {
 let state: RunState = emptyState();
 return starts.map((start, i) => {
  const run = runFlow(g, { nodeId: start, port: 'flow' }, state, big(), times[i] ?? 0);
  if (!run.ok) throw new Error(run.error.message);
  state = run.data.state;
  return run.data.effects.map(effect => 'entityId' in effect ? effect.entityId : '').join(',');
 });
};

it('passes Gate only while open and changes state from its other inputs', () => {
 const g = compiled(
  [node('enter', 'event.manual'), node('open', 'event.manual'), node('close', 'event.manual'), node('flip', 'event.manual'), node('gate', 'flow.gate', { startOpen: false }), toggle('x')],
  [wire('1', 'enter', 'flow', 'gate', 'enter'), wire('2', 'open', 'flow', 'gate', 'open'), wire('3', 'close', 'flow', 'gate', 'close'), wire('4', 'flip', 'flow', 'gate', 'toggle'), wire('5', 'gate', 'exit', 'x', 'flow')]);
 expect(play(g, ['enter', 'open', 'enter', 'close', 'enter', 'flip', 'enter', 'flip', 'enter'])).toEqual(['', '', 'x', '', '', '', 'x', '', '']);
});

it('steps Multi Gate through its outputs, with and without loop, and resets', () => {
 const nodes = (loop: boolean) => [node('in', 'event.manual'), node('reset', 'event.manual'), node('mg', 'flow.multiGate', { outputs: 2, loop }), toggle('a'), toggle('b')];
 const wires = [wire('1', 'in', 'flow', 'mg', 'enter'), wire('2', 'reset', 'flow', 'mg', 'reset'), wire('3', 'mg', 'out0', 'a', 'flow'), wire('4', 'mg', 'out1', 'b', 'flow')];
 expect(play(compiled(nodes(true), wires), ['in', 'in', 'in'])).toEqual(['a', 'b', 'a']);
 expect(play(compiled(nodes(false), wires), ['in', 'in', 'in', 'reset', 'in'])).toEqual(['a', 'b', '', '', 'a']);
});

it('lets Throttle pass once per interval of session time', () => {
 const g = compiled([node('in', 'event.manual'), node('t', 'flow.throttle', { seconds: 1 }), toggle('x')], [wire('1', 'in', 'flow', 't', 'flow'), wire('2', 't', 'exit', 'x', 'flow')]);
 expect(play(g, ['in', 'in', 'in', 'in'], [0, 500, 1000, 1999])).toEqual(['x', '', 'x', '']);
});

it('runs For Loop body for each index depth first, then completed', () => {
 const g = compiled(
  [node('in', 'event.manual'), node('first', 'value.number', { value: 1 }), node('last', 'value.number', { value: 3 }), node('loop', 'flow.forLoop'),
   node('one', 'value.number', { value: 1 }), node('gt', 'logic.greater'), node('set', 'scene.setVisibility', { entityId: 'v' }), toggle('done')],
  [wire('1', 'in', 'flow', 'loop', 'flow'), wire('2', 'first', 'value', 'loop', 'first'), wire('3', 'last', 'value', 'loop', 'last'),
   wire('4', 'loop', 'body', 'set', 'flow'), wire('5', 'loop', 'index', 'gt', 'a'), wire('6', 'one', 'value', 'gt', 'b'), wire('7', 'gt', 'result', 'set', 'visible'), wire('8', 'loop', 'completed', 'done', 'flow')]);
 const run = runFlow(g, { nodeId: 'in', port: 'flow' }, emptyState(), big(), 0);
 expect(run.ok && run.data.effects).toEqual([
  { kind: 'setVisibility', entityId: 'v', visible: false }, { kind: 'setVisibility', entityId: 'v', visible: true }, { kind: 'setVisibility', entityId: 'v', visible: true }, { kind: 'toggleVisibility', entityId: 'done' }]);
 expect(run.ok && run.data.state.loops.get('loop')).toBe(3);
});

it('runs only completed when last is less than first, and fails above 64 iterations', () => {
 const loop = (first: number, last: number) => compiled(
  [node('in', 'event.manual'), node('first', 'value.number', { value: first }), node('last', 'value.number', { value: last }), node('loop', 'flow.forLoop'), toggle('body'), toggle('done')],
  [wire('1', 'in', 'flow', 'loop', 'flow'), wire('2', 'first', 'value', 'loop', 'first'), wire('3', 'last', 'value', 'loop', 'last'), wire('4', 'loop', 'body', 'body', 'flow'), wire('5', 'loop', 'completed', 'done', 'flow')]);
 expect(play(loop(3, 1), ['in'])).toEqual(['done']);
 expect(play(loop(1, 64), ['in'])[0]!.split(',')).toHaveLength(65);
 expect(runFlow(loop(1, 65), { nodeId: 'in', port: 'flow' }, emptyState(), big(), 0)).toMatchObject({ ok: false, error: { message: 'Blueprint loop exceeded its iteration limit', ids: ['loop'] } });
});

it('stops a run at 512 visits per event', () => {
 const g = compiled(
  [node('in', 'event.manual'), node('first', 'value.number', { value: 1 }), node('last', 'value.number', { value: 64 }), node('loop', 'flow.forLoop'), node('seq', 'flow.sequence', { outputs: 8 }), ...Array.from({ length: 8 }, (_, i) => toggle(`t${i}`))],
  [wire('1', 'in', 'flow', 'loop', 'flow'), wire('2', 'first', 'value', 'loop', 'first'), wire('3', 'last', 'value', 'loop', 'last'), wire('4', 'loop', 'body', 'seq', 'flow'), ...Array.from({ length: 8 }, (_, i) => wire(`s${i}`, 'seq', `then${i}`, `t${i}`, 'flow'))]);
 expect(runFlow(g, { nodeId: 'in', port: 'flow' }, emptyState(), big(), 0)).toMatchObject({ ok: false, error: { message: 'Blueprint run exceeded its flow limit' } });
});

it('routes Switch On Number by the rounded value, else default', () => {
 const g = (value: number) => compiled(
  [node('in', 'event.manual'), node('v', 'value.number', { value }), node('sw', 'flow.switch', { cases: [0, 1] }), toggle('zero'), toggle('one'), toggle('other')],
  [wire('1', 'in', 'flow', 'sw', 'flow'), wire('2', 'v', 'value', 'sw', 'value'), wire('3', 'sw', 'case0', 'zero', 'flow'), wire('4', 'sw', 'case1', 'one', 'flow'), wire('5', 'sw', 'default', 'other', 'flow')]);
 expect([0, 0.6, 1, 7, -0.4].map(v => play(g(v), ['in'])[0])).toEqual(['zero', 'one', 'one', 'other', 'zero']);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run --project unit packages/session/test/blueprint-flow-nodes.test.ts`
Expected: FAIL ("Invalid Blueprint document" for the unknown node types).

- [ ] **Step 3: Add the definitions**

Append to `FLOW_NODES` in `packages/contracts/src/blueprint-nodes/flow.ts`:

```ts
 defineNode({ type: 'flow.gate', label: 'Gate', category: 'Flow', keywords: ['open', 'close', 'block', 'allow'], settings: z.strictObject({ startOpen: z.boolean() }), ports: () => ({ inputs: { enter: 'flow', open: 'flow', close: 'flow', toggle: 'flow' }, outputs: { ...exit } }), defaults: () => ({ startOpen: true }), fields: [{ key: 'startOpen', label: 'Start open', kind: 'boolean' }] }),
 defineNode({ type: 'flow.multiGate', label: 'Multi Gate', category: 'Flow', keywords: ['cycle', 'round robin', 'next', 'rotate'], settings: z.strictObject({ outputs: z.number().int().min(2).max(8), loop: z.boolean() }), ports: s => ({ inputs: { enter: 'flow', reset: 'flow' }, outputs: numbered('out', s.outputs) }), defaults: () => ({ outputs: 2, loop: true }), fields: [{ key: 'outputs', label: 'Outputs', kind: 'count', min: 2, max: 8 }, { key: 'loop', label: 'Loop', kind: 'boolean' }], dynamicPorts: true }),
 defineNode({ type: 'flow.throttle', label: 'Throttle', category: 'Flow', keywords: ['cooldown', 'rate', 'limit', 'debounce'], settings: z.strictObject({ seconds: finite.min(0.01).max(3600) }), ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults: () => ({ seconds: 1 }), fields: [{ key: 'seconds', label: 'Seconds', kind: 'number', min: 0.01, max: 3600 }] }),
 defineNode({ type: 'flow.forLoop', label: 'For Loop', category: 'Flow', keywords: ['repeat', 'iterate', 'loop', 'times'], settings: empty, ports: () => ({ inputs: { flow: 'flow', first: 'number', last: 'number' }, outputs: { body: 'flow', completed: 'flow', index: 'number' } }), defaults: () => ({}), fields: [] }),
 defineNode({ type: 'flow.switch', label: 'Switch On Number', category: 'Flow', keywords: ['case', 'select', 'choose', 'integer'], settings: z.strictObject({ cases: z.array(z.number().int().min(-1e6).max(1e6)).min(1).max(8).refine(cases => new Set(cases).size === cases.length, 'Duplicate case') }), ports: s => ({ inputs: { flow: 'flow', value: 'number' }, outputs: { ...numbered('case', s.cases.length), default: 'flow' } }), defaults: () => ({ cases: [0, 1] }), fields: [{ key: 'cases', label: 'Cases', kind: 'cases' }], dynamicPorts: true }),
```

- [ ] **Step 4: Add `loop` to the runner**

In `blueprint-eval/types.ts`, add to `FlowContext`:

```ts
 // Runs `body` once per index from first to last, then `completed`.
 loop(first: number, last: number): void;
```

In `blueprint.ts`:

```ts
const MAX_LOOP_ITERATIONS = 64;
class LoopLimit extends Error {}
type Frame = { kind: 'enter'; nodeId: Id; port: string } | { kind: 'loop'; nodeId: Id; index: number; last: number };
```

In `runFlow`, `follow` pushes `{ kind: 'enter', nodeId: wire.targetNodeId, port: wire.targetPort }`. After `const frame = stack.pop()!;` add:

```ts
  if (frame.kind === 'loop') {
   if (frame.index > frame.last) { follow(frame.nodeId, ['completed']); continue; }
   next.loops.set(frame.nodeId, frame.index);
   // The next iteration waits under the body, so all flow after `body` runs first.
   stack.push({ ...frame, index: frame.index + 1 });
   follow(frame.nodeId, ['body']);
   continue;
  }
```

Add to the context object:

```ts
    loop: (first, last) => {
     if (last - first + 1 > MAX_LOOP_ITERATIONS) throw new LoopLimit();
     if (last < first) follow(node.id, ['completed']);
     else stack.push({ kind: 'loop', nodeId: node.id, index: first, last });
    },
```

Change the catch to `} catch (error) { return fail(error instanceof LoopLimit ? 'Blueprint loop exceeded its iteration limit' : 'Blueprint data could not be evaluated', [node.id]); }`.

- [ ] **Step 5: Add the evaluators**

Append to `FLOW_EVALUATORS`:

```ts
 'flow.gate': { flow: (node, c) => {
  const open = c.state.gates.get(node.id) ?? node.settings.startOpen;
  if (c.port === 'enter') { if (open) c.follow('exit'); return; }
  c.state.gates.set(node.id, c.port === 'open' ? true : c.port === 'close' ? false : !open);
 } },
 'flow.multiGate': { flow: (node, c) => {
  if (c.port === 'reset') { c.state.multi.delete(node.id); return; }
  const next = c.state.multi.get(node.id) ?? 0;
  if (next < node.settings.outputs) { c.state.multi.set(node.id, next + 1); c.follow(`out${next}`); return; }
  if (!node.settings.loop) return;
  c.state.multi.set(node.id, 1); c.follow('out0');
 } },
 'flow.throttle': { flow: (node, c) => {
  const last = c.state.throttle.get(node.id);
  if (last !== undefined && c.nowMs - last < node.settings.seconds * 1000) return;
  c.state.throttle.set(node.id, c.nowMs); c.follow('exit');
 } },
 'flow.forLoop': {
  data: (node, _output, _read, state) => state.loops.get(node.id) ?? 0,
  flow: (_node, c) => c.loop(Math.round(Number(c.read('first'))), Math.round(Number(c.read('last')))),
 },
 'flow.switch': { flow: (node, c) => {
  const index = node.settings.cases.indexOf(Math.round(Number(c.read('value'))));
  c.follow(index < 0 ? 'default' : `case${index}`);
 } },
```

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run --project unit packages/session packages/contracts`
Expected: PASS (the Task 1 definitions test also covers the new defaults and fields).
Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts packages/session
git commit -m "Add Gate, Multi Gate, Throttle, For Loop, and Switch On Number

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Math, logic, Random Number, and variable nodes

**Files:**
- Create: `packages/contracts/src/blueprint-nodes/variables.ts`, `packages/session/src/blueprint-eval/variables.ts`
- Modify: `packages/contracts/src/blueprint-nodes/math.ts`, `logic.ts`, `index.ts` (add `VARIABLE_NODES` between `LOGIC_NODES` and `SCENE_NODES`), `packages/session/src/blueprint-eval/values.ts`, `index.ts`, `packages/session/src/blueprint.ts` (variable check in `compileBlueprint`)
- Test: `packages/session/test/blueprint-value-nodes.test.ts` (new), `packages/session/test/blueprint-session.test.ts` (append)

**Interfaces:**
- Consumes: `nextRandom` (Task 4), `RunState` (Task 2), `nodeDefinition` (Task 1).
- Produces: types `math.subtract`, `math.multiply`, `math.divide`, `math.min`, `math.max` (ports `a`, `b` → `result`); `math.clamp` (`value`, `min`, `max` → `result`); `math.abs`, `math.round`, `math.floor` (`value` → `result`); `math.random` (`min`, `max` → `result`); `logic.less`, `logic.greaterOrEqual`, `logic.lessOrEqual`, `logic.equal` (number `a`, `b` → boolean `result`); `logic.and`, `logic.or` (boolean `a`, `b` → `result`); `variable.getNumber`, `variable.getBoolean` (→ `value`), `variable.setNumber`, `variable.setBoolean` (`flow`, `value` → `exit`), `variable.addNumber` (`flow`, `amount` → `exit`), `variable.toggleBoolean` (`flow` → `exit`). Variable settings: `{ variableId: Id }`. Compile error text: `Blueprint variable is missing`.

- [ ] **Step 1: Write the failing tests**

`packages/session/test/blueprint-value-nodes.test.ts`:

```ts
import { expect, it } from 'vitest';
import { compileBlueprint, runFlow } from '../src/blueprint';
import { initialState } from '../src/blueprint-runtime';

const node = (id: string, type: string, settings: object = {}) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 } });
const wire = (id: string, s: string, sp: string, t: string, tp: string) => ({ id, sourceNodeId: s, sourcePort: sp, targetNodeId: t, targetPort: tp });
const variables = [{ id: 'n', name: 'N', type: 'number', default: 0 }, { id: 'b', name: 'B', type: 'boolean', default: false }];
const doc = (nodes: object[], connections: object[]) => ({ schemaVersion: 1, id: 'g', name: 'G', variables, nodes, connections });
const budget = () => ({ visits: 1024, effects: 64 });
// Stores the output of one node in a variable and returns the stored value, or the error message.
const evaluate = (type: string, inputs: Record<string, number | boolean>, settings: object = {}) => {
 const output = /^logic\./.test(type) ? 'b' : 'n';
 const nodes = [node('start', 'event.manual'), node('op', type, settings), node('store', output === 'b' ? 'variable.setBoolean' : 'variable.setNumber', { variableId: output }),
  ...Object.entries(inputs).map(([port, value]) => node(`in_${port}`, typeof value === 'number' ? 'value.number' : 'value.boolean', { value }))];
 const wires = [wire('f', 'start', 'flow', 'store', 'flow'), wire('d', 'op', 'result', 'store', 'value'), ...Object.keys(inputs).map(port => wire(`w_${port}`, `in_${port}`, 'value', 'op', port))];
 const compiled = compileBlueprint(doc(nodes, wires));
 if (!compiled.ok) throw new Error(compiled.error.message);
 const run = runFlow(compiled.data, { nodeId: 'start', port: 'flow' }, initialState(compiled.data.graph), budget(), 0);
 return run.ok ? run.data.state.variables.get(output) : run.error.message;
};

it('computes the math nodes', () => {
 expect(evaluate('math.subtract', { a: 5, b: 3 })).toBe(2);
 expect(evaluate('math.multiply', { a: 4, b: 2.5 })).toBe(10);
 expect(evaluate('math.divide', { a: 9, b: 3 })).toBe(3);
 expect(evaluate('math.divide', { a: 1, b: 0 })).toBe('Blueprint data could not be evaluated');
 expect(evaluate('math.min', { a: 2, b: -1 })).toBe(-1);
 expect(evaluate('math.max', { a: 2, b: -1 })).toBe(2);
 expect(evaluate('math.clamp', { value: 12, min: 0, max: 10 })).toBe(10);
 expect(evaluate('math.clamp', { value: 1, min: 5, max: 0 })).toBe('Blueprint data could not be evaluated');
 expect(evaluate('math.abs', { value: -3 })).toBe(3);
 expect(evaluate('math.round', { value: 2.5 })).toBe(3);
 expect(evaluate('math.floor', { value: -1.5 })).toBe(-2);
});

it('compares numbers and combines booleans', () => {
 expect(evaluate('logic.less', { a: 1, b: 2 })).toBe(true);
 expect(evaluate('logic.greaterOrEqual', { a: 2, b: 2 })).toBe(true);
 expect(evaluate('logic.lessOrEqual', { a: 3, b: 2 })).toBe(false);
 expect(evaluate('logic.equal', { a: 0.1 + 0.2, b: 0.3 })).toBe(false);
 expect(evaluate('logic.and', { a: true, b: false })).toBe(false);
 expect(evaluate('logic.or', { a: true, b: false })).toBe(true);
});

it('draws Random Number from the seeded generator within its range', () => {
 const first = evaluate('math.random', { min: 2, max: 4 });
 expect(evaluate('math.random', { min: 2, max: 4 })).toBe(first);
 expect(first).toBeGreaterThanOrEqual(2); expect(first).toBeLessThan(4);
 expect(evaluate('math.random', { min: 3, max: 3 })).toBe(3);
 expect(evaluate('math.random', { min: 4, max: 2 })).toBe('Blueprint data could not be evaluated');
});

it('sets, adds to, toggles, and reads variables within one run', () => {
 const compiled = compileBlueprint(doc(
  [node('start', 'event.manual'), node('add', 'variable.addNumber', { variableId: 'n' }), node('two', 'value.number', { value: 2 }), node('toggle', 'variable.toggleBoolean', { variableId: 'b' }),
   node('get', 'variable.getNumber', { variableId: 'n' }), node('gt', 'logic.greater'), node('one', 'value.number', { value: 1 }), node('set', 'variable.setBoolean', { variableId: 'b' })],
  [wire('1', 'start', 'flow', 'add', 'flow'), wire('2', 'two', 'value', 'add', 'amount'), wire('3', 'add', 'exit', 'toggle', 'flow'), wire('4', 'toggle', 'exit', 'set', 'flow'),
   wire('5', 'get', 'value', 'gt', 'a'), wire('6', 'one', 'value', 'gt', 'b'), wire('7', 'gt', 'result', 'set', 'value')]));
 if (!compiled.ok) throw new Error(compiled.error.message);
 const run = runFlow(compiled.data, { nodeId: 'start', port: 'flow' }, initialState(compiled.data.graph), budget(), 0);
 expect(run.ok && Object.fromEntries(run.data.state.variables)).toEqual({ n: 2, b: true });
});

it('rejects a variable node whose variable is missing or of the other type', () => {
 const one = (settings: object, type = 'variable.getNumber') => compileBlueprint(doc([node('get', type, settings)], []));
 expect(one({ variableId: 'gone' })).toMatchObject({ ok: false, error: { message: 'Blueprint variable is missing', ids: ['get'] } });
 expect(one({ variableId: 'b' })).toMatchObject({ ok: false, error: { message: 'Blueprint variable is missing' } });
 expect(one({ variableId: 'n' }).ok).toBe(true);
});
```

Append to `packages/session/test/blueprint-session.test.ts`:

```ts
it('counts a hotkey in a variable and cuts cameras through Switch On Number, and resets on a logic edit', () => {
 const session = createSession(makeSmokeScene(), 's');
 const camera = () => session.inspect().outputs.find(output => output.id === 'output_main')?.cameraId;
 load(session, [{ schemaVersion: 1, id: 'cuts', name: 'Cuts', variables: [{ id: 'count', name: 'Count', type: 'number', default: 0 }],
  nodes: [
   { id: 'key', version: 1, type: 'event.keystroke', settings: { code: 'KeyC', control: true, alt: true, shift: false, meta: false }, position: { x: 0, y: 0 } },
   { id: 'one', version: 1, type: 'value.number', settings: { value: 1 }, position: { x: 0, y: 0 } },
   { id: 'add', version: 1, type: 'variable.addNumber', settings: { variableId: 'count' }, position: { x: 0, y: 0 } },
   { id: 'get', version: 1, type: 'variable.getNumber', settings: { variableId: 'count' }, position: { x: 0, y: 0 } },
   { id: 'sw', version: 1, type: 'flow.switch', settings: { cases: [1, 2] }, position: { x: 0, y: 0 } },
   { id: 'close', version: 1, type: 'camera.switch', settings: { outputId: 'output_main', cameraId: 'camera_close' }, position: { x: 0, y: 0 } },
   { id: 'wide', version: 1, type: 'camera.switch', settings: { outputId: 'output_main', cameraId: 'camera_wide' }, position: { x: 0, y: 0 } },
  ],
  connections: [
   { id: 'w1', sourceNodeId: 'key', sourcePort: 'flow', targetNodeId: 'add', targetPort: 'flow' },
   { id: 'w2', sourceNodeId: 'one', sourcePort: 'value', targetNodeId: 'add', targetPort: 'amount' },
   { id: 'w3', sourceNodeId: 'add', sourcePort: 'exit', targetNodeId: 'sw', targetPort: 'flow' },
   { id: 'w4', sourceNodeId: 'get', sourcePort: 'value', targetNodeId: 'sw', targetPort: 'value' },
   { id: 'w5', sourceNodeId: 'sw', sourcePort: 'case0', targetNodeId: 'close', targetPort: 'flow' },
   { id: 'w6', sourceNodeId: 'sw', sourcePort: 'case1', targetNodeId: 'wide', targetPort: 'flow' },
  ] }]);
 session.advance(0);
 session.advance(16, 16, press('Control+Alt+KeyC'));
 expect(camera()).toBe('camera_close');
 session.advance(32, 16, press('Control+Alt+KeyC'));
 expect(camera()).toBe('camera_wide');
 session.advance(48, 16, press('Control+Alt+KeyC'));
 expect(camera()).toBe('camera_wide');
 session.editBlueprints({ clientId: 't', batchId: 'edit', ops: [{ kind: 'setNodeSettings', graphId: 'cuts', nodeId: 'sw', settings: { cases: [1, 3] } }] });
 session.advance(64, 16, press('Control+Alt+KeyC'));
 expect(camera()).toBe('camera_close');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit packages/session/test/blueprint-value-nodes.test.ts packages/session/test/blueprint-session.test.ts`
Expected: FAIL (unknown node types).

- [ ] **Step 3: Add the definitions**

`math.ts`: change the header line to `import { defineNode, empty, type PortShape } from './define';` and replace the array with:

```ts
const binary = (): PortShape => ({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'number' } });
const unary = (): PortShape => ({ inputs: { value: 'number' }, outputs: { result: 'number' } });
const math = <const T extends string>(type: T, label: string, keywords: string[], ports: () => PortShape) =>
 defineNode({ type, label, category: 'Math', keywords, settings: empty, ports, defaults: () => ({}), fields: [] });
export const MATH_NODES = [
 math('math.add', 'Add', ['plus', 'sum', '+'], binary),
 math('math.subtract', 'Subtract', ['minus', 'difference', '-'], binary),
 math('math.multiply', 'Multiply', ['times', 'product', '*', 'scale'], binary),
 math('math.divide', 'Divide', ['quotient', '/', 'ratio'], binary),
 math('math.min', 'Min', ['smallest', 'minimum', 'lower'], binary),
 math('math.max', 'Max', ['largest', 'maximum', 'upper'], binary),
 math('math.clamp', 'Clamp', ['limit', 'range', 'bound'], () => ({ inputs: { value: 'number', min: 'number', max: 'number' }, outputs: { result: 'number' } })),
 math('math.abs', 'Abs', ['absolute', 'magnitude'], unary),
 math('math.round', 'Round', ['nearest', 'integer'], unary),
 math('math.floor', 'Floor', ['down', 'integer', 'truncate'], unary),
 math('math.random', 'Random Number', ['random', 'chance', 'dice', 'range'], () => ({ inputs: { min: 'number', max: 'number' }, outputs: { result: 'number' } })),
] as const;
```

`logic.ts`: replace the array with:

```ts
const compare = (): PortShape => ({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'boolean' } });
const both = (): PortShape => ({ inputs: { a: 'boolean', b: 'boolean' }, outputs: { result: 'boolean' } });
const logic = <const T extends string>(type: T, label: string, keywords: string[], ports: () => PortShape) =>
 defineNode({ type, label, category: 'Logic', keywords, settings: empty, ports, defaults: () => ({}), fields: [] });
export const LOGIC_NODES = [
 logic('logic.greater', 'Greater Than', ['compare', '>', 'more'], compare),
 logic('logic.less', 'Less Than', ['compare', '<', 'fewer'], compare),
 logic('logic.greaterOrEqual', 'Greater or Equal', ['compare', '>=', 'at least'], compare),
 logic('logic.lessOrEqual', 'Less or Equal', ['compare', '<=', 'at most'], compare),
 logic('logic.equal', 'Equal', ['compare', '==', 'same'], compare),
 logic('logic.not', 'Not', ['invert', 'negate', '!'], () => ({ inputs: { value: 'boolean' }, outputs: { result: 'boolean' } })),
 logic('logic.and', 'And', ['both', '&&', 'all'], both),
 logic('logic.or', 'Or', ['either', '||', 'any'], both),
] as const;
```

(import `type PortShape` in `logic.ts`.)

`variables.ts`:

```ts
import { z } from 'zod';
import { defineNode, exit, IdSchema, type DefaultRefs, type PortShape } from './define';

const settings = z.strictObject({ variableId: IdSchema });
const first = (type: 'number' | 'boolean') => (refs: DefaultRefs) => { const variable = refs.variables?.find(v => v.type === type); return variable ? { variableId: variable.id } : null; };
const variable = <const T extends string>(type: T, label: string, keywords: string[], valueType: 'number' | 'boolean', ports: () => PortShape) =>
 defineNode({ type, label, category: 'Variables', keywords: ['variable', ...keywords], settings, ports, defaults: first(valueType), fields: [{ key: 'variableId', label: 'Variable', kind: 'variable', variableType: valueType }] });
export const VARIABLE_NODES = [
 variable('variable.getNumber', 'Get Number Variable', ['get', 'read'], 'number', () => ({ inputs: {}, outputs: { value: 'number' } })),
 variable('variable.getBoolean', 'Get Boolean Variable', ['get', 'read'], 'boolean', () => ({ inputs: {}, outputs: { value: 'boolean' } })),
 variable('variable.setNumber', 'Set Number Variable', ['set', 'write', 'store'], 'number', () => ({ inputs: { flow: 'flow', value: 'number' }, outputs: { ...exit } })),
 variable('variable.setBoolean', 'Set Boolean Variable', ['set', 'write', 'store'], 'boolean', () => ({ inputs: { flow: 'flow', value: 'boolean' }, outputs: { ...exit } })),
 variable('variable.addNumber', 'Add To Number Variable', ['add', 'increment', 'count', 'counter'], 'number', () => ({ inputs: { flow: 'flow', amount: 'number' }, outputs: { ...exit } })),
 variable('variable.toggleBoolean', 'Toggle Boolean Variable', ['toggle', 'flip', 'invert'], 'boolean', () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } })),
] as const;
```

In `blueprint-nodes/index.ts`, import `VARIABLE_NODES` and use `[...EVENT_NODES, ...FLOW_NODES, ...VALUE_NODES, ...MATH_NODES, ...LOGIC_NODES, ...VARIABLE_NODES, ...SCENE_NODES]`.

- [ ] **Step 4: Add the evaluators and the compile check**

Append to `VALUE_EVALUATORS` in `blueprint-eval/values.ts` (add `import { nextRandom } from '../blueprint-random';` and `import type { Read } from './types';`):

```ts
const num = (read: Read, port: string) => Number(read(port));
```

```ts
 'math.subtract': { data: (_n, _o, read) => num(read, 'a') - num(read, 'b') },
 'math.multiply': { data: (_n, _o, read) => num(read, 'a') * num(read, 'b') },
 'math.divide': { data: (_n, _o, read) => num(read, 'a') / num(read, 'b') },
 'math.min': { data: (_n, _o, read) => Math.min(num(read, 'a'), num(read, 'b')) },
 'math.max': { data: (_n, _o, read) => Math.max(num(read, 'a'), num(read, 'b')) },
 'math.clamp': { data: (_n, _o, read) => {
  const min = num(read, 'min'), max = num(read, 'max');
  if (min > max) throw new RangeError('Clamp range is empty');
  return Math.min(Math.max(num(read, 'value'), min), max);
 } },
 'math.abs': { data: (_n, _o, read) => Math.abs(num(read, 'value')) },
 'math.round': { data: (_n, _o, read) => Math.round(num(read, 'value')) },
 'math.floor': { data: (_n, _o, read) => Math.floor(num(read, 'value')) },
 'math.random': { data: (_n, _o, read, state) => {
  const min = num(read, 'min'), max = num(read, 'max');
  if (min > max) throw new RangeError('Random range is empty');
  const step = nextRandom(state.random);
  state.random = step.state;
  return min + step.value * (max - min);
 } },
 'logic.less': { data: (_n, _o, read) => num(read, 'a') < num(read, 'b') },
 'logic.greaterOrEqual': { data: (_n, _o, read) => num(read, 'a') >= num(read, 'b') },
 'logic.lessOrEqual': { data: (_n, _o, read) => num(read, 'a') <= num(read, 'b') },
 'logic.equal': { data: (_n, _o, read) => num(read, 'a') === num(read, 'b') },
 'logic.and': { data: (_n, _o, read) => { const a = Boolean(read('a')), b = Boolean(read('b')); return a && b; } },
 'logic.or': { data: (_n, _o, read) => { const a = Boolean(read('a')), b = Boolean(read('b')); return a || b; } },
```

`blueprint-eval/variables.ts`:

```ts
import type { EvaluatorTable } from './types';

export const VARIABLE_EVALUATORS = {
 'variable.getNumber': { data: (node, _o, _r, state) => state.variables.get(node.settings.variableId)! },
 'variable.getBoolean': { data: (node, _o, _r, state) => state.variables.get(node.settings.variableId)! },
 'variable.setNumber': { flow: (node, c) => { c.state.variables.set(node.settings.variableId, Number(c.read('value'))); c.follow('exit'); } },
 'variable.setBoolean': { flow: (node, c) => { c.state.variables.set(node.settings.variableId, Boolean(c.read('value'))); c.follow('exit'); } },
 'variable.addNumber': { flow: (node, c) => {
  const next = Number(c.state.variables.get(node.settings.variableId)) + Number(c.read('amount'));
  if (!Number.isFinite(next)) throw new RangeError('Blueprint number is not finite');
  c.state.variables.set(node.settings.variableId, next); c.follow('exit');
 } },
 'variable.toggleBoolean': { flow: (node, c) => { c.state.variables.set(node.settings.variableId, !c.state.variables.get(node.settings.variableId)); c.follow('exit'); } },
} satisfies Partial<EvaluatorTable>;
```

Add `...VARIABLE_EVALUATORS` to `EVALUATORS` in `blueprint-eval/index.ts`.

In `compileBlueprint` (`blueprint.ts`), after `const graph = parsed.data;` add (import `nodeDefinition` from `@opensekai/contracts`):

```ts
 const variables = new Map(graph.variables.map(variable => [variable.id, variable.type]));
 for (const node of graph.nodes) {
  const field = nodeDefinition(node.type).fields.find(item => item.kind === 'variable');
  if (field?.kind === 'variable' && variables.get((node.settings as { variableId: string }).variableId) !== field.variableType)
   return fail('Blueprint variable is missing', [node.id]);
 }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project unit packages/session packages/contracts apps/desktop`
Expected: PASS.
Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts packages/session
git commit -m "Add math, compare, logic, Random Number, and variable nodes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Settings form from fields, and the Variables section

**Files:**
- Create: `apps/desktop/src/blueprints/fields.ts`, `apps/desktop/src/components/BlueprintVariables.svelte`
- Modify: `apps/desktop/src/components/BlueprintNodeFields.svelte` (rewrite), `apps/desktop/src/components/BlueprintPanel.svelte`, `apps/desktop/src/app.css`
- Test: `apps/desktop/test/blueprint-fields.test.ts` (new)

**Interfaces:**
- Consumes: `nodeDefinition`, `BlueprintField`, `BlueprintVariable`, `DefaultRefs` (Tasks 1, 3).
- Produces: `parseCases(text: string): number[] | null`; `formatCases(cases: readonly number[]): string`; `newVariable(existing: readonly BlueprintVariable[], type: 'number' | 'boolean', id: string): BlueprintVariable`. `BlueprintPanel` gets `const refs: DefaultRefs` derived from the scene and the selected graph, and every node-default call passes it.

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/blueprint-fields.test.ts`:

```ts
import { expect, it } from 'vitest';
import { formatCases, newVariable, parseCases } from '../src/blueprints/fields';

it('parses a list of 1 to 8 unique integers', () => {
 expect(parseCases('0, 1, -2')).toEqual([0, 1, -2]);
 expect(parseCases(' 3 ')).toEqual([3]);
 expect(parseCases('')).toBeNull();
 expect(parseCases('1, 1')).toBeNull();
 expect(parseCases('1.5')).toBeNull();
 expect(parseCases('1, x')).toBeNull();
 expect(parseCases('1,2,3,4,5,6,7,8,9')).toBeNull();
 expect(parseCases('2000000')).toBeNull();
 expect(formatCases([0, 1, -2])).toBe('0, 1, -2');
});

it('names a new variable after its type with the first free number', () => {
 expect(newVariable([], 'number', 'a')).toEqual({ id: 'a', name: 'Number 1', type: 'number', default: 0 });
 expect(newVariable([{ id: 'x', name: 'Boolean 1', type: 'boolean', default: true }], 'boolean', 'b')).toEqual({ id: 'b', name: 'Boolean 2', type: 'boolean', default: false });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run --project unit apps/desktop/test/blueprint-fields.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `fields.ts`**

```ts
import type { BlueprintVariable } from '@opensekai/contracts';

export function parseCases(text: string): number[] | null {
 const parts = text.split(',').map(part => part.trim()).filter(part => part !== '');
 if (parts.length < 1 || parts.length > 8 || !parts.every(part => /^-?\d+$/.test(part))) return null;
 const cases = parts.map(Number);
 return new Set(cases).size === cases.length && cases.every(value => Math.abs(value) <= 1e6) ? cases : null;
}
export const formatCases = (cases: readonly number[]): string => cases.join(', ');
export function newVariable(existing: readonly BlueprintVariable[], type: 'number' | 'boolean', id: string): BlueprintVariable {
 const label = type === 'number' ? 'Number' : 'Boolean', names = new Set(existing.map(variable => variable.name));
 let n = 1;
 while (names.has(`${label} ${n}`)) n++;
 return type === 'number' ? { id, name: `${label} ${n}`, type, default: 0 } : { id, name: `${label} ${n}`, type, default: false };
}
```

- [ ] **Step 4: Rewrite `BlueprintNodeFields.svelte`**

```svelte
<script lang="ts">
 import { Input, Select } from '@oshi-connect/ui';
 import { nodeDefinition, type BlueprintField, type BlueprintNode, type BlueprintVariable, type KeystrokeSettings, type SceneView } from '@opensekai/contracts';
 import KeystrokeField from './KeystrokeField.svelte';
 import { formatCases, parseCases } from '../blueprints/fields';

 let { node, scene, variables, platform, unavailable, onsettings }: {
  node: BlueprintNode; scene: SceneView | null; variables: readonly BlueprintVariable[]; platform: string; unavailable: boolean;
  onsettings: (settings: BlueprintNode['settings']) => void;
 } = $props();
 const settings = $derived(node.settings as Record<string, unknown>);
 const fields = $derived(nodeDefinition(node.type).fields);
 const set = (key: string, value: unknown) => onsettings({ ...settings, [key]: value } as BlueprintNode['settings']);
 const numberInput = (field: Extract<BlueprintField, { kind: 'number' }>, text: string) => {
  const value = Number(text);
  if (text !== '' && Number.isFinite(value) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max)) set(field.key, value);
 };
 const choices = (field: BlueprintField) =>
  field.kind === 'entity' ? (scene?.entities ?? []).filter(entity => entity.kind !== 'tracking').map(entity => ({ value: entity.id, label: entity.name }))
  : field.kind === 'camera' ? (scene?.entities ?? []).filter(entity => entity.kind === 'camera').map(entity => ({ value: entity.id, label: entity.name }))
  : field.kind === 'output' ? (scene?.outputs ?? []).map(output => ({ value: output.id, label: output.id }))
  : field.kind === 'variable' ? variables.filter(variable => variable.type === field.variableType).map(variable => ({ value: variable.id, label: variable.name }))
  : field.kind === 'count' ? Array.from({ length: field.max - field.min + 1 }, (_, i) => ({ value: String(field.min + i), label: String(field.min + i) }))
  : [];
</script>

{#each fields as field (field.key)}
 {#if field.kind === 'number'}
  <Input type="number" label={field.label} min={field.min} max={field.max} step="any" value={String(settings[field.key])} oninput={event => numberInput(field, event.currentTarget.value)} />
 {:else if field.kind === 'boolean'}
  <label class="blueprint-checkbox"><input type="checkbox" checked={Boolean(settings[field.key])} onchange={event => set(field.key, event.currentTarget.checked)} />{field.label}</label>
 {:else if field.kind === 'count'}
  <Select label={field.label} value={String(settings[field.key])} options={choices(field)} onchange={event => set(field.key, Number(event.currentTarget.value))} />
 {:else if field.kind === 'cases'}
  <Input label={field.label} value={formatCases(settings[field.key] as number[])} onchange={event => { const cases = parseCases(event.currentTarget.value); if (cases) set(field.key, cases); else event.currentTarget.value = formatCases(settings[field.key] as number[]); }} />
 {:else if field.kind === 'keystroke'}
  <KeystrokeField value={settings as KeystrokeSettings} {platform} {unavailable} onchange={next => onsettings(next)} />
 {:else}
  <Select label={field.label} value={String(settings[field.key])} options={choices(field)} onchange={event => set(field.key, event.currentTarget.value)} />
 {/if}
{/each}
```

- [ ] **Step 5: Write `BlueprintVariables.svelte`**

```svelte
<script lang="ts">
 import { Dropdown, Input, Select } from '@oshi-connect/ui';
 import { Trash2 } from '@lucide/svelte';
 import type { BlueprintOp, BlueprintVariable } from '@opensekai/contracts';
 import { newVariable } from '../blueprints/fields';

 let { graphId, variables, disabled, onops }: { graphId: string; variables: readonly BlueprintVariable[]; disabled: boolean; onops: (ops: BlueprintOp[]) => void } = $props();
 const types = [{ value: 'number', label: 'Number' }, { value: 'boolean', label: 'Boolean' }];
 const add = (type: string) => onops([{ kind: 'addVariable', graphId, variable: newVariable(variables, type === 'boolean' ? 'boolean' : 'number', crypto.randomUUID()) }]);
 const update = (variableId: string, change: { name?: string; type?: 'number' | 'boolean'; default?: number | boolean }) => onops([{ kind: 'updateVariable', graphId, variableId, ...change }]);
 const rename = (variable: BlueprintVariable, input: HTMLInputElement) => {
  const name = input.value.trim();
  if (name && name.length <= 64 && !variables.some(other => other.id !== variable.id && other.name === name)) update(variable.id, { name });
  else input.value = variable.name;
 };
</script>

<section class="blueprint-variables" aria-label="Variables">
 <h3>Variables</h3>
 {#each variables as variable (variable.id)}
  <div class="blueprint-variable">
   <Input value={variable.name} {disabled} onchange={event => rename(variable, event.currentTarget)} />
   <Select value={variable.type} options={types} {disabled} onchange={event => update(variable.id, { type: event.currentTarget.value === 'boolean' ? 'boolean' : 'number' })} />
   {#if variable.type === 'number'}
    <Input type="number" step="any" value={String(variable.default)} {disabled} oninput={event => { const value = Number(event.currentTarget.value); if (event.currentTarget.value !== '' && Number.isFinite(value)) update(variable.id, { default: value }); }} />
   {:else}
    <label class="blueprint-checkbox"><input type="checkbox" checked={variable.default} {disabled} onchange={event => update(variable.id, { default: event.currentTarget.checked })} />Default</label>
   {/if}
   <button type="button" class="blueprint-icon-button" aria-label={`Remove ${variable.name}`} {disabled} onclick={() => onops([{ kind: 'removeVariable', graphId, variableId: variable.id }])}><Trash2 size={14} /></button>
  </div>
 {/each}
 {#if variables.length < 32}<Dropdown items={types} triggerLabel="Add variable" {disabled} onselect={add} />{/if}
</section>
```

- [ ] **Step 6: Wire the panel**

In `BlueprintPanel.svelte`:
- Import `BlueprintVariables` and `type DefaultRefs`.
- Replace the `defaults` derivation with:

```ts
 const refs = $derived<DefaultRefs>({ entityId: targets[0]?.id, cameraId: cameras[0]?.id, outputId, keystroke: defaultKeystroke(platform), variables: graph?.variables ?? [] });
 const defaults = $derived(defaultBlueprintSettings(addKind as BlueprintKind, refs));
```

- In the inspector, pass `variables={graph?.variables ?? []}` to `BlueprintNodeFields`.
- In the palette `<aside>`, after the Add button: `{#if graph}<BlueprintVariables graphId={graph.id} variables={graph.variables} {disabled} onops={ops => { edit(ops); }} />{/if}`.

In `apps/desktop/src/app.css`, append:

```css
.blueprint-variables{display:flex;flex-direction:column;gap:8px;border-top:1px solid #e3e1e9;padding-top:12px}.blueprint-variables h3{font-size:11px;letter-spacing:.02em;color:#85818f;margin:0}.blueprint-variable{display:grid;grid-template-columns:1fr auto;gap:6px;padding-bottom:8px;border-bottom:1px solid #eeecf2}.blueprint-variable input,.blueprint-variable select{width:100%;padding:6px 8px;border:1px solid #dedbe5;border-radius:4px;background:#fff;color:#35333d;font-size:12px}.blueprint-variable .blueprint-checkbox{display:flex;align-items:center;gap:6px;font-size:12px;color:#78717f}.blueprint-icon-button{display:inline-flex;align-items:center;justify-content:center;padding:4px;border-radius:4px;color:#665581;background:transparent;border:0}.blueprint-icon-button:hover{background:#ece6f4}
```

- [ ] **Step 7: Run tests and the type check**

Run: `pnpm exec vitest run --project unit apps/desktop`
Expected: PASS.
Run: `pnpm check`
Expected: 0 errors (svelte-check included).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop
git commit -m "Build Blueprint node settings from definitions and add variables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Search palette, context menus, and wire release

**Files:**
- Create: `apps/desktop/src/blueprints/node-search.ts`, `apps/desktop/src/blueprints/selection-ops.ts`, `apps/desktop/src/components/NodeSearch.svelte`, `apps/desktop/src/components/CanvasMenu.svelte`
- Modify: `apps/desktop/src/blueprints/rete-editor.ts`, `apps/desktop/src/components/BlueprintPanel.svelte`, `apps/desktop/src/app.css`
- Test: `apps/desktop/test/node-search.test.ts`, `apps/desktop/test/selection-ops.test.ts` (new), `apps/desktop/test/rete-editor.test.ts` (append)

**Interfaces:**
- Consumes: `NODE_DEFINITIONS`, `NODE_CATEGORIES`, `DefaultRefs`, `PortType`, `blueprintPorts` (Task 1).
- Produces:
  - `searchNodes(query: string, refs: DefaultRefs, need?: WireNeed): SearchGroup[]` where `WireNeed = { side: 'inputs' | 'outputs'; type: PortType }`, `SearchGroup = { category: NodeCategory; entries: SearchEntry[] }`, `SearchEntry = { type: BlueprintKind; label: string; port?: string }` (`port` is the first port of the new node on `need.side` with `need.type`).
  - `deleteOps(graph, nodeIds): BlueprintOp[]`, `disconnectOps(graph, nodeIds): BlueprintOp[]`.
  - `ReteBlueprintHandlers` gains `onContextMenu?(target: MenuTarget, client: { x: number; y: number }): void` and `onWireDrop?(from: { nodeId: string; port: string; side: 'input' | 'output' }, client: { x: number; y: number }): void`, with `type MenuTarget = { kind: 'canvas' } | { kind: 'node'; nodeId: string } | { kind: 'wire'; connectionId: string }`.
  - `ReteBlueprintEditor` gains `selected(): string[]`, `selectMany(ids: string[]): void`, `pointer(): { x: number; y: number }` (last pointer position in graph coordinates).

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/node-search.test.ts`:

```ts
import { expect, it } from 'vitest';
import type { DefaultRefs } from '@opensekai/contracts';
import { searchNodes } from '../src/blueprints/node-search';

const refs: DefaultRefs = { entityId: 'e', cameraId: 'c', outputId: 'o', keystroke: { code: 'KeyH', control: true, alt: true, shift: false, meta: false }, variables: [{ id: 'n', type: 'number' }] };
const types = (groups: ReturnType<typeof searchNodes>) => groups.flatMap(group => group.entries.map(entry => entry.type));

it('groups matches by category in palette order and matches keywords', () => {
 const groups = searchNodes('', refs);
 expect(groups[0]!.category).toBe('Events');
 expect(types(searchNodes('hotkey', refs))).toEqual(['event.keystroke']);
 expect(types(searchNodes('cooldown', refs))).toEqual(['flow.throttle']);
 expect(types(searchNodes('cooldown camera', refs))).toEqual([]);
 expect(types(searchNodes('RANDOM', refs))).toEqual(['math.random']);
});

it('hides nodes whose defaults are unavailable', () => {
 const bare: DefaultRefs = { keystroke: refs.keystroke };
 expect(types(searchNodes('visibility', bare))).toEqual([]);
 expect(types(searchNodes('boolean variable', refs))).toEqual([]);
 expect(types(searchNodes('number variable', refs))).toContain('variable.getNumber');
});

it('filters to nodes with a compatible port and names that port', () => {
 const fromBoolean = searchNodes('', refs, { side: 'inputs', type: 'boolean' }).flatMap(group => group.entries);
 expect(fromBoolean.find(entry => entry.type === 'flow.branch')).toEqual({ type: 'flow.branch', label: 'If Branch', port: 'condition' });
 expect(fromBoolean.some(entry => entry.type === 'math.add')).toBe(false);
 const intoNumber = searchNodes('', refs, { side: 'outputs', type: 'number' }).flatMap(group => group.entries);
 expect(intoNumber.find(entry => entry.type === 'flow.forLoop')?.port).toBe('index');
 expect(intoNumber.some(entry => entry.type === 'event.manual')).toBe(false);
});
```

`apps/desktop/test/selection-ops.test.ts`:

```ts
import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { BlueprintSetSchema } from '@opensekai/contracts';
import { deleteOps, disconnectOps } from '../src/blueprints/selection-ops';

const graph = BlueprintSetSchema.parse(fixture.blueprints)[1]!;

it('deletes each selected node once and ignores unknown IDs', () => {
 expect(deleteOps(graph, ['show', 'wait', 'show', 'gone'])).toEqual([
  { kind: 'removeNode', graphId: 'flash-marker', nodeId: 'show' }, { kind: 'removeNode', graphId: 'flash-marker', nodeId: 'wait' }]);
});

it('disconnects every wire that touches the selection', () => {
 expect(disconnectOps(graph, ['show']).map(op => op.kind === 'disconnect' && op.connectionId)).toEqual(['w1', 'w2', 'w3']);
});
```

Append to `apps/desktop/test/rete-editor.test.ts`:

```ts
it('reports one context menu for a node right-click that bubbles to the canvas', async () => {
 const menus: unknown[] = [];
 let area!: { emit(context: unknown): Promise<unknown> };
 await mountReteBlueprint(element() as unknown as HTMLElement, graph!, { onSelect() {}, onOps() {}, onContextMenu: target => { menus.push(target); } }, { render: false, inspect: value => { area = value as never; } });
 const event = { preventDefault() {}, clientX: 5, clientY: 6 };
 await area.emit({ type: 'contextmenu', data: { event, context: { id: 'wait', label: 'Delay' } } });
 await area.emit({ type: 'contextmenu', data: { event, context: 'root' } });
 await area.emit({ type: 'contextmenu', data: { event: { ...event }, context: 'root' } });
 await area.emit({ type: 'contextmenu', data: { event: { ...event }, context: { id: 'w1', source: 'key', target: 'show' } } });
 expect(menus).toEqual([{ kind: 'node', nodeId: 'wait' }, { kind: 'canvas' }, { kind: 'wire', connectionId: 'w1' }]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit apps/desktop/test/node-search.test.ts apps/desktop/test/selection-ops.test.ts apps/desktop/test/rete-editor.test.ts`
Expected: FAIL (modules not found; `onContextMenu` never called).

- [ ] **Step 3: Implement the pure helpers**

`node-search.ts`:

```ts
import { NODE_CATEGORIES, NODE_DEFINITIONS, type BlueprintKind, type DefaultRefs, type NodeCategory, type PortType } from '@opensekai/contracts';

export interface WireNeed { side: 'inputs' | 'outputs'; type: PortType }
export interface SearchEntry { type: BlueprintKind; label: string; port?: string }
export interface SearchGroup { category: NodeCategory; entries: SearchEntry[] }

// Every word must appear in the label, category, or keywords.
export function searchNodes(query: string, refs: DefaultRefs, need?: WireNeed): SearchGroup[] {
 const words = query.toLowerCase().split(/\s+/).filter(Boolean);
 const groups = new Map<NodeCategory, SearchEntry[]>();
 for (const definition of NODE_DEFINITIONS) {
  const settings = definition.defaults(refs);
  if (settings === null) continue;
  const text = [definition.label, definition.category, ...definition.keywords].join(' ').toLowerCase();
  if (!words.every(word => text.includes(word))) continue;
  let port: string | undefined;
  if (need) {
   const ports = definition.ports(settings as never)[need.side];
   port = Object.keys(ports).find(name => ports[name] === need.type);
   if (port === undefined) continue;
  }
  const list = groups.get(definition.category) ?? [];
  list.push({ type: definition.type, label: definition.label, ...(port === undefined ? {} : { port }) });
  groups.set(definition.category, list);
 }
 return NODE_CATEGORIES.flatMap(category => { const entries = groups.get(category); return entries ? [{ category, entries }] : []; });
}
```

`selection-ops.ts`:

```ts
import type { BlueprintGraph, BlueprintOp } from '@opensekai/contracts';

export const deleteOps = (graph: BlueprintGraph, nodeIds: readonly string[]): BlueprintOp[] =>
 graph.nodes.filter(node => nodeIds.includes(node.id)).map(node => ({ kind: 'removeNode', graphId: graph.id, nodeId: node.id }));
export const disconnectOps = (graph: BlueprintGraph, nodeIds: readonly string[]): BlueprintOp[] =>
 graph.connections.filter(wire => nodeIds.includes(wire.sourceNodeId) || nodeIds.includes(wire.targetNodeId)).map(wire => ({ kind: 'disconnect', graphId: graph.id, connectionId: wire.id }));
```

- [ ] **Step 4: Extend the Rete adapter**

In `rete-editor.ts`:

```ts
export type MenuTarget = { kind: 'canvas' } | { kind: 'node'; nodeId: string } | { kind: 'wire'; connectionId: string };
export interface ReteBlueprintHandlers {
 onSelect(id: string | null): void; onOps(ops: BlueprintOp[]): void;
 onContextMenu?(target: MenuTarget, client: { x: number; y: number }): void;
 onWireDrop?(from: { nodeId: string; port: string; side: 'input' | 'output' }, client: { x: number; y: number }): void;
}
```

Keep `const selector = AreaExtensions.selector();` in a variable and pass it to `selectableNodes`. In the existing `area.addPipe`, before `return context;`:

```ts
  if (context.type === 'contextmenu') {
   const { event, context: hit } = context.data;
   event.preventDefault();
   // A right-click on a node or wire bubbles to the canvas with the same event; report only the first.
   if (hit === 'root' && event === targeted) return context;
   if (hit !== 'root') targeted = event;
   const target: MenuTarget = hit === 'root' ? { kind: 'canvas' } : 'source' in hit && 'target' in hit ? { kind: 'wire', connectionId: hit.id } : { kind: 'node', nodeId: hit.id };
   handlers.onContextMenu?.(target, { x: event.clientX, y: event.clientY });
  }
```

with `let targeted: MouseEvent | null = null;` declared next to `shown`. After `connections.addPreset(...)`:

```ts
 connections.addPipe(context => {
  if (context.type === 'connectiondrop' && !context.data.created && context.data.socket === null) {
   const { nodeId, key, side } = context.data.initial;
   const { x, y } = area.area.pointer, { k, x: tx, y: ty } = area.area.transform, box = container.getBoundingClientRect();
   handlers.onWireDrop?.({ nodeId, port: key, side }, { x: box.left + x * k + tx, y: box.top + y * k + ty });
  }
  return context;
 });
```

Add to the returned editor object:

```ts
  selected: () => [...selector.entities.values()].filter(entity => entity.label === 'node').map(entity => entity.id),
  selectMany(ids) { ids.forEach((id, i) => { if (editor.getNode(id)) selectable.select(id, i > 0); }); },
  pointer: () => ({ x: Math.round(area.area.pointer.x), y: Math.round(area.area.pointer.y) }),
```

and to `ReteBlueprintEditor`: `selected(): string[]; selectMany(ids: string[]): void; pointer(): { x: number; y: number };`. If the `contextmenu` context type is not narrowed by TypeScript, cast `context.data` to `{ event: MouseEvent; context: 'root' | { id: string; source?: string; target?: string } }`.

- [ ] **Step 5: Write `NodeSearch.svelte` and `CanvasMenu.svelte`**

`NodeSearch.svelte`:

```svelte
<script lang="ts">
 import { onMount } from 'svelte';
 import { Input, nextDomId } from '@oshi-connect/ui';
 import type { DefaultRefs } from '@opensekai/contracts';
 import { searchNodes, type SearchEntry, type WireNeed } from '../blueprints/node-search';

 let { refs, need, focus = false, disabled = false, onpick }: { refs: DefaultRefs; need?: WireNeed; focus?: boolean; disabled?: boolean; onpick: (entry: SearchEntry) => void } = $props();
 const id = nextDomId();
 let query = $state(''), active = $state(0);
 const groups = $derived(searchNodes(query, refs, need));
 const flat = $derived(groups.flatMap(group => group.entries));
 $effect(() => { void query; active = 0; });
 onMount(() => { if (focus) (document.getElementById(id) as HTMLInputElement | null)?.focus(); });
 function keydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') { active = Math.min(active + 1, flat.length - 1); event.preventDefault(); }
  else if (event.key === 'ArrowUp') { active = Math.max(active - 1, 0); event.preventDefault(); }
  else if (event.key === 'Enter' && flat[active]) { onpick(flat[active]); event.preventDefault(); }
 }
</script>

<div class="node-search">
 <Input {id} placeholder="Search nodes" autocomplete="off" {disabled} bind:value={query} onkeydown={keydown} />
 <ul class="node-search-results" role="listbox" aria-label="Nodes">
  {#each groups as group (group.category)}
   <li class="node-search-category" role="presentation">{group.category}</li>
   {#each group.entries as entry (entry.type)}
    <li role="option" aria-selected={flat[active] === entry} class:active={flat[active] === entry} onpointerdown={event => { event.preventDefault(); if (!disabled) onpick(entry); }}>{entry.label}</li>
   {/each}
  {/each}
 </ul>
</div>
```

If `nextDomId` takes an argument in the kit, call it with `'node-search'`.

`CanvasMenu.svelte`:

```svelte
<script lang="ts">
 import { onMount, type Snippet } from 'svelte';

 let { x, y, items = [], onpick, onclose, children }: { x: number; y: number; items?: { value: string; label: string }[]; onpick?: (value: string) => void; onclose: () => void; children?: Snippet } = $props();
 let root: HTMLDivElement;
 const left = $derived(Math.max(8, Math.min(x, window.innerWidth - 248)));
 const top = $derived(Math.max(8, Math.min(y, window.innerHeight - 320)));
 onMount(() => {
  const away = (event: PointerEvent) => { if (!root.contains(event.target as Node)) onclose(); };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onclose(); } };
  window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key, true);
  return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); };
 });
</script>

<div bind:this={root} class="canvas-menu" role="menu" tabindex="-1" style:left="{left}px" style:top="{top}px">
 {@render children?.()}
 {#each items as item (item.value)}
  <button type="button" role="menuitem" onclick={() => onpick?.(item.value)}>{item.label}</button>
 {/each}
</div>
```

Append to `app.css`:

```css
.canvas-menu{position:fixed;z-index:50;width:240px;max-height:320px;overflow:auto;padding:4px;border:1px solid #d4cae1;border-radius:6px;background:#fff;box-shadow:0 8px 24px #2822312e}.canvas-menu>button{display:flex;width:100%;padding:7px 10px;border:0;border-radius:4px;background:transparent;color:#423c4b;font-size:12px;text-align:left}.canvas-menu>button:hover{background:#f1edf7}.node-search{display:flex;flex-direction:column;gap:6px;min-height:0}.node-search input{width:100%;padding:7px 8px;border:1px solid #dedbe5;border-radius:4px;font-size:12px}.node-search-results{list-style:none;margin:0;padding:0;overflow:auto;max-height:260px}.node-search-results li{padding:5px 8px;border-radius:4px;font-size:12px;color:#423c4b;cursor:pointer}.node-search-results li.active,.node-search-results li:hover{background:#f1edf7}.node-search-results .node-search-category{padding:8px 8px 2px;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:#85818f;cursor:default;background:none!important}.blueprint-palette .node-search-results{max-height:none;flex:1}
```

- [ ] **Step 6: Wire the panel**

In `BlueprintPanel.svelte`:
- Replace the palette `Select` and **Add node** button with `<NodeSearch {refs} disabled={disabled || !graph} onpick={entry => addAt(entry, editor?.center() ?? { x: 0, y: 0 })} />`. Remove `addKind`, `kinds`, `defaults`, and `add()`.
- Add the menu state and actions:

```ts
 type Menu = { x: number; y: number; at: { x: number; y: number } } & ({ kind: 'canvas' } | { kind: 'node'; nodeIds: string[] } | { kind: 'wire'; connectionId: string } | { kind: 'drop'; from: { nodeId: string; port: string; side: 'input' | 'output' }; need: WireNeed });
 let menu = $state.raw<Menu | null>(null);
 function addAt(entry: SearchEntry, at: { x: number; y: number }, from?: { nodeId: string; port: string; side: 'input' | 'output' }) {
  const settings = defaultBlueprintSettings(entry.type, refs);
  if (!graph || !settings) return;
  const id = crypto.randomUUID();
  const ops: BlueprintOp[] = [{ kind: 'addNode', graphId: graph.id, node: { id, version: 1, type: entry.type, settings, position: at } as BlueprintNode }];
  if (from && entry.port) ops.push({ kind: 'connect', graphId: graph.id, connection: from.side === 'output'
   ? { id: crypto.randomUUID(), sourceNodeId: from.nodeId, sourcePort: from.port, targetNodeId: id, targetPort: entry.port }
   : { id: crypto.randomUUID(), sourceNodeId: id, sourcePort: entry.port, targetNodeId: from.nodeId, targetPort: from.port } });
  menu = null;
  if (!act(ops).ok) return;
  nodeId = id;
  const latest = sync.view().find(item => item.id === graph!.id);
  if (latest) void editor?.show(latest).then(() => editor?.select(id));
 }
 function openMenu(target: MenuTarget, client: { x: number; y: number }) {
  if (!editor || !graph || disabled) return;
  const at = editor.pointer(), place = { x: client.x, y: client.y, at };
  if (target.kind === 'canvas') menu = { ...place, kind: 'canvas' };
  else if (target.kind === 'wire') menu = { ...place, kind: 'wire', connectionId: target.connectionId };
  else {
   const selection = editor.selected();
   const nodeIds = selection.length > 1 && selection.includes(target.nodeId) ? selection : [target.nodeId];
   if (nodeIds.length === 1) { editor.select(target.nodeId); nodeId = target.nodeId; }
   menu = { ...place, kind: 'node', nodeIds };
  }
 }
 function openDrop(from: { nodeId: string; port: string; side: 'input' | 'output' }, client: { x: number; y: number }) {
  const source = graph?.nodes.find(item => item.id === from.nodeId);
  if (!editor || !source || disabled) return;
  const type = blueprintPorts(source)[from.side === 'output' ? 'outputs' : 'inputs'][from.port];
  if (!type) return;
  menu = { x: client.x, y: client.y, at: editor.pointer(), kind: 'drop', from, need: { side: from.side === 'output' ? 'inputs' : 'outputs', type } };
 }
 const nodeItems = (ids: string[]) => [
  { value: 'delete', label: 'Delete' },
  { value: 'disconnect', label: 'Disconnect all' },
  ...(ids.length === 1 && graph?.nodes.find(item => item.id === ids[0])?.type === 'event.manual' ? [{ value: 'run', label: 'Run' }] : []),
 ];
 function pick(action: string) {
  const current = menu;
  menu = null;
  if (!graph || !current) return;
  if (current.kind === 'node' && action === 'delete') act(deleteOps(graph, current.nodeIds));
  if (current.kind === 'node' && action === 'disconnect') act(disconnectOps(graph, current.nodeIds));
  if (current.kind === 'node' && action === 'run') void run(current.nodeIds[0]!);
  if (current.kind === 'wire' && action === 'delete') act([{ kind: 'disconnect', graphId: graph.id, connectionId: current.connectionId }]);
  if (current.kind === 'canvas' && action === 'selectAll') editor?.selectMany(graph.nodes.map(item => item.id));
 }
```

- Add `const act = (ops: BlueprintOp[]) => ops.length === 0 ? ({ ok: true, data: sync.view() } as const) : edit(ops);` (Task 9 replaces it with the undo-recording version). Replace `remove()` with `act(deleteOps(graph, [nodeId]))`. Make `settings()` and the Variables `onops` call `act`.
- Change `run()` to `run(triggerId = trigger?.id)` and use `triggerId` in `blueprintRun`; the toolbar button calls `run()`.
- Pass the new handlers in `mount`: `onContextMenu: openMenu, onWireDrop: openDrop`. In `mount`, also pass `onOps: ops => { act(ops); }`.
- After the workspace `</div>`:

```svelte
 {#if menu}
  <CanvasMenu x={menu.x} y={menu.y} onclose={() => { menu = null; }} onpick={pick}
   items={menu.kind === 'node' ? nodeItems(menu.nodeIds) : menu.kind === 'wire' ? [{ value: 'delete', label: 'Delete' }] : menu.kind === 'canvas' ? [{ value: 'selectAll', label: 'Select all' }] : []}>
   {#if menu.kind === 'canvas' || menu.kind === 'drop'}
    {@const at = menu.at}
    {@const from = menu.kind === 'drop' ? menu.from : undefined}
    <NodeSearch {refs} need={menu.kind === 'drop' ? menu.need : undefined} focus onpick={entry => addAt(entry, at, from)} />
   {/if}
  </CanvasMenu>
 {/if}
```

- [ ] **Step 7: Run tests and the type check**

Run: `pnpm exec vitest run --project unit apps/desktop`
Expected: PASS.
Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop
git commit -m "Add Blueprint context menus, node search, and wire release search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Keyboard shortcuts, copy and paste, duplicate, and undo

**Files:**
- Create: `apps/desktop/src/blueprints/keys.ts`, `clipboard.ts`, `undo.ts`
- Modify: `apps/desktop/src/blueprints/blueprint-sync.ts` (split large edits), `apps/desktop/src/components/BlueprintPanel.svelte`
- Test: `apps/desktop/test/keys.test.ts`, `clipboard.test.ts`, `undo.test.ts` (new), `apps/desktop/test/blueprint-sync.test.ts` (append)

**Interfaces:**
- Consumes: `graphPatch` (existing), `deleteOps` (Task 8), editor `selected()`, `selectMany()`, `pointer()` (Task 8).
- Produces:
  - `type ShortcutAction = 'delete' | 'copy' | 'paste' | 'duplicate' | 'selectAll' | 'undo' | 'redo' | 'escape'`; `shortcutFor(event: KeyInput, platform: string): ShortcutAction | null`.
  - `interface BlueprintClipboard { nodes: BlueprintNode[]; connections: BlueprintConnection[] }`; `copyNodes(graph, ids): BlueprintClipboard | null`; `pasteOps(clip, graphId, anchor, newId): { ops: BlueprintOp[]; nodeIds: string[] }`; `duplicateAnchor(clip): { x: number; y: number }`.
  - `diffOps(from: BlueprintGraph, to: BlueprintGraph): BlueprintOp[]`; `createUndoHistory(now?: () => number): UndoHistory` with `record(graphId, before, after, ops)`, `undo(graphId, apply: (ops) => boolean): boolean`, `redo(graphId, apply): boolean`, `clear()`.
  - `BlueprintSync.edit` sends more than 64 operations as ordered batches of at most 64.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/keys.test.ts`:

```ts
import { expect, it } from 'vitest';
import { shortcutFor } from '../src/blueprints/keys';

const mac = 'MacIntel', win = 'Win32';
const press = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, target: unknown = { tagName: 'DIV' }) =>
 ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods, target: target as EventTarget });

it('maps the canvas shortcuts for each platform', () => {
 expect(shortcutFor(press('Backspace'), mac)).toBe('delete');
 expect(shortcutFor(press('Delete'), win)).toBe('delete');
 expect(shortcutFor(press('Escape'), mac)).toBe('escape');
 expect(shortcutFor(press('c', { metaKey: true }), mac)).toBe('copy');
 expect(shortcutFor(press('v', { metaKey: true }), mac)).toBe('paste');
 expect(shortcutFor(press('d', { metaKey: true }), mac)).toBe('duplicate');
 expect(shortcutFor(press('a', { metaKey: true }), mac)).toBe('selectAll');
 expect(shortcutFor(press('z', { metaKey: true }), mac)).toBe('undo');
 expect(shortcutFor(press('Z', { metaKey: true, shiftKey: true }), mac)).toBe('redo');
 expect(shortcutFor(press('c', { ctrlKey: true }), win)).toBe('copy');
 expect(shortcutFor(press('c', { ctrlKey: true }), mac)).toBeNull();
 expect(shortcutFor(press('c', { metaKey: true }), win)).toBeNull();
 expect(shortcutFor(press('c', { metaKey: true, altKey: true }), mac)).toBeNull();
 expect(shortcutFor(press('x'), mac)).toBeNull();
});

it('never fires while a text field, select, or editable element has focus', () => {
 for (const target of [{ tagName: 'INPUT' }, { tagName: 'textarea' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
  expect(shortcutFor(press('Backspace', {}, target), mac)).toBeNull();
  expect(shortcutFor(press('z', { metaKey: true }, target), mac)).toBeNull();
 }
});
```

`apps/desktop/test/clipboard.test.ts`:

```ts
import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintSetSchema } from '@opensekai/contracts';
import { copyNodes, duplicateAnchor, pasteOps } from '../src/blueprints/clipboard';

const graphs = BlueprintSetSchema.parse(fixture.blueprints);
const flash = graphs[1]!;
const ids = () => { let n = 0; return () => `new${n++}`; };

it('copies the selected nodes and only the wires between them', () => {
 const clip = copyNodes(flash, ['show', 'wait', 'on']);
 expect(clip?.nodes.map(node => node.id)).toEqual(['on', 'show', 'wait']);
 expect(clip?.connections.map(wire => wire.id)).toEqual(['w2', 'w3']);
 expect(copyNodes(flash, [])).toBeNull();
});

it('pastes with new IDs and the same layout at the anchor, into another graph', () => {
 const clip = copyNodes(flash, ['show', 'wait'])!;
 const { ops, nodeIds } = pasteOps(clip, 'toggle-performer', { x: 1000, y: 500 }, ids());
 expect(nodeIds).toEqual(['new0', 'new1']);
 const pasted = applyBlueprintOps(graphs, ops);
 if (!pasted.ok) throw new Error(pasted.error.message);
 const target = pasted.data[0]!;
 expect(target.nodes.filter(node => nodeIds.includes(node.id)).map(node => node.position)).toEqual([{ x: 1000, y: 500 }, { x: 1300, y: 500 }]);
 expect(target.connections.at(-1)).toEqual({ id: 'new2', sourceNodeId: 'new0', sourcePort: 'exit', targetNodeId: 'new1', targetPort: 'flow' });
 expect(duplicateAnchor(clip)).toEqual({ x: 324, y: 24 });
});
```

`apps/desktop/test/undo.test.ts`:

```ts
import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintSetSchema, type BlueprintGraph, type BlueprintOp } from '@opensekai/contracts';
import { createUndoHistory, diffOps } from '../src/blueprints/undo';

const graphs = () => BlueprintSetSchema.parse(fixture.blueprints);
const flash = () => graphs()[1]!;
const apply = (graph: BlueprintGraph, ops: BlueprintOp[]) => { const r = applyBlueprintOps([graph], ops); if (!r.ok) throw new Error(r.error.message); return r.data[0]!; };
// Undo restores content; array order may differ, so compare sorted by ID.
const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
const norm = (g: BlueprintGraph) => ({ ...g, nodes: byId(g.nodes), connections: byId(g.connections), variables: byId(g.variables) });

it('restores a deleted node with its wires, settings, and variables', () => {
 const before = { ...flash(), variables: [{ id: 'n', name: 'N', type: 'number' as const, default: 1 }] };
 const after = apply(before, [{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'show' }, { kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'wait', settings: { seconds: 9 } }, { kind: 'removeVariable', graphId: 'flash-marker', variableId: 'n' }, { kind: 'moveNode', graphId: 'flash-marker', nodeId: 'hide', position: { x: 1, y: 2 } }]);
 expect(norm(apply(after, diffOps(after, before)))).toEqual(norm(before));
 expect(norm(apply(before, diffOps(before, after)))).toEqual(norm(after));
});

it('restores a wire that a connect replaced and wires a settings change dropped', () => {
 const g: BlueprintGraph = { ...flash(), nodes: [...flash().nodes, { id: 'seq', version: 1, type: 'flow.sequence', settings: { outputs: 3 }, position: { x: 0, y: 0 } }], connections: [...flash().connections, { id: 's2', sourceNodeId: 'seq', sourcePort: 'then2', targetNodeId: 'hide', targetPort: 'flow' }] };
 const after = apply(g, [{ kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'seq', settings: { outputs: 2 } }, { kind: 'connect', graphId: 'flash-marker', connection: { id: 'x', sourceNodeId: 'key', sourcePort: 'flow', targetNodeId: 'hide', targetPort: 'flow' } }]);
 expect(norm(apply(after, diffOps(after, g)))).toEqual(norm(g));
});

it('merges quick moves and settings edits of the same target into one step', () => {
 let time = 0;
 const history = createUndoHistory(() => time);
 let current = flash();
 const act = (ops: BlueprintOp[]) => { const next = apply(current, ops); history.record('flash-marker', current, next, ops); current = next; };
 for (let x = 0; x < 5; x++) { act([{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x, y: 0 } }]); time += 100; }
 time += 1000;
 act([{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'hide' }]);
 const undone: BlueprintOp[][] = [];
 const take = (ops: BlueprintOp[]) => { undone.push(ops); current = apply(current, ops); return true; };
 expect(history.undo('flash-marker', take)).toBe(true);
 expect(current.nodes.some(node => node.id === 'hide')).toBe(true);
 expect(history.undo('flash-marker', take)).toBe(true);
 expect(norm(current)).toEqual(norm(flash()));
 expect(history.undo('flash-marker', take)).toBe(false);
 expect(history.redo('flash-marker', take)).toBe(true);
 expect(current.nodes.find(node => node.id === 'wait')!.position).toEqual({ x: 4, y: 0 });
});

it('drops a step that no longer applies and clears redo after a new action', () => {
 const history = createUndoHistory(() => 0);
 const before = flash(), after = apply(before, [{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 5, y: 5 } }]);
 history.record('flash-marker', before, after, []);
 expect(history.undo('flash-marker', () => false)).toBe(false);
 expect(history.redo('flash-marker', () => true)).toBe(false);
 expect(history.undo('flash-marker', () => true)).toBe(false);
 history.record('flash-marker', before, after, []);
 history.undo('flash-marker', () => true);
 history.record('flash-marker', before, after, [{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'hide' }]);
 expect(history.redo('flash-marker', () => true)).toBe(false);
});

it('keeps at most 64 steps per graph and ignores no-op actions', () => {
 const history = createUndoHistory(() => 0);
 let current = flash();
 history.record('flash-marker', current, current, []);
 for (let i = 0; i < 70; i++) { const next = apply(current, [{ kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'wait', settings: { seconds: i } }]); history.record('flash-marker', current, next, [{ kind: 'removeNode', graphId: 'flash-marker', nodeId: `distinct${i}` }]); current = next; }
 let count = 0;
 while (history.undo('flash-marker', () => true)) count++;
 expect(count).toBe(64);
});
```

Append to `apps/desktop/test/blueprint-sync.test.ts`:

```ts
it('sends an edit with more than 64 operations as ordered batches', async () => {
 const { session, a } = await setup();
 const before = session.inspectBlueprints().revision;
 const ops = Array.from({ length: 40 }, (_, i) => ({ kind: 'addNode' as const, graphId: 'flash-marker', node: { id: `p${i}`, version: 1 as const, type: 'flow.delay' as const, settings: { seconds: 1 }, position: { x: i, y: 0 } } }));
 const wires = Array.from({ length: 39 }, (_, i) => ({ kind: 'connect' as const, graphId: 'flash-marker', connection: { id: `pw${i}`, sourceNodeId: `p${i}`, sourcePort: 'exit', targetNodeId: `p${i + 1}`, targetPort: 'flow' } }));
 expect(a.edit([...ops, ...wires]).ok).toBe(true);
 await a.idle();
 expect(session.inspectBlueprints().revision - before).toBe(2);
 expect(a.issue()).toBeNull();
 expect(a.view().find(g => g.id === 'flash-marker')!.connections).toHaveLength(5 + 39);
});

it('rejects a paste over the node limit without changing the graph', async () => {
 const { a } = await setup();
 const before = a.view();
 const ops = Array.from({ length: 123 }, (_, i) => ({ kind: 'addNode' as const, graphId: 'flash-marker', node: { id: `q${i}`, version: 1 as const, type: 'flow.delay' as const, settings: { seconds: 1 }, position: { x: i, y: 0 } } }));
 expect(a.edit(ops).ok).toBe(false);
 expect(a.view()).toEqual(before);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit apps/desktop/test/keys.test.ts apps/desktop/test/clipboard.test.ts apps/desktop/test/undo.test.ts apps/desktop/test/blueprint-sync.test.ts`
Expected: FAIL (modules missing; the 79-op edit is rejected by the session as one batch).

- [ ] **Step 3: Implement `keys.ts`**

```ts
import { isMac } from './keystroke-format';

export type ShortcutAction = 'delete' | 'copy' | 'paste' | 'duplicate' | 'selectAll' | 'undo' | 'redo' | 'escape';
export interface KeyInput { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; target: EventTarget | null }
const typing = (target: EventTarget | null) => {
 const element = target as { tagName?: string; isContentEditable?: boolean } | null;
 return !!element && (element.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(element.tagName).toUpperCase()));
};
const COMMANDS: Record<string, ShortcutAction> = { c: 'copy', v: 'paste', d: 'duplicate', a: 'selectAll' };
export function shortcutFor(event: KeyInput, platform: string): ShortcutAction | null {
 if (typing(event.target)) return null;
 const command = isMac(platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
 if (!command && !event.metaKey && !event.ctrlKey && !event.altKey) {
  if (event.key === 'Delete' || event.key === 'Backspace') return 'delete';
  return event.key === 'Escape' ? 'escape' : null;
 }
 if (!command || event.altKey) return null;
 const key = event.key.toLowerCase();
 if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
 return event.shiftKey ? null : COMMANDS[key] ?? null;
}
```

- [ ] **Step 4: Implement `clipboard.ts`**

```ts
import type { BlueprintConnection, BlueprintGraph, BlueprintNode, BlueprintOp } from '@opensekai/contracts';

export interface BlueprintClipboard { nodes: BlueprintNode[]; connections: BlueprintConnection[] }
export function copyNodes(graph: BlueprintGraph, ids: readonly string[]): BlueprintClipboard | null {
 const chosen = new Set(ids);
 const nodes = graph.nodes.filter(node => chosen.has(node.id));
 if (nodes.length === 0) return null;
 return structuredClone({ nodes, connections: graph.connections.filter(wire => chosen.has(wire.sourceNodeId) && chosen.has(wire.targetNodeId)) });
}
const corner = (clip: BlueprintClipboard) => ({ x: Math.min(...clip.nodes.map(node => node.position.x)), y: Math.min(...clip.nodes.map(node => node.position.y)) });
export const duplicateAnchor = (clip: BlueprintClipboard) => { const { x, y } = corner(clip); return { x: x + 24, y: y + 24 }; };
// The top-left corner of the copied nodes lands on the anchor.
export function pasteOps(clip: BlueprintClipboard, graphId: string, anchor: { x: number; y: number }, newId: () => string = () => crypto.randomUUID()): { ops: BlueprintOp[]; nodeIds: string[] } {
 const origin = corner(clip), ids = new Map(clip.nodes.map(node => [node.id, newId()] as const));
 const nodes = clip.nodes.map(node => ({ ...structuredClone(node), id: ids.get(node.id)!, position: { x: anchor.x + node.position.x - origin.x, y: anchor.y + node.position.y - origin.y } }));
 const wires = clip.connections.map(wire => ({ ...wire, id: newId(), sourceNodeId: ids.get(wire.sourceNodeId)!, targetNodeId: ids.get(wire.targetNodeId)! }));
 return { ops: [...nodes.map(node => ({ kind: 'addNode' as const, graphId, node })), ...wires.map(connection => ({ kind: 'connect' as const, graphId, connection }))], nodeIds: nodes.map(node => node.id) };
}
```

- [ ] **Step 5: Implement `undo.ts`**

```ts
import type { BlueprintGraph, BlueprintOp } from '@opensekai/contracts';
import { graphPatch } from './graph-patch';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Operations that turn `from` into `to` for one graph's nodes, wires, and variables.
export function diffOps(from: BlueprintGraph, to: BlueprintGraph): BlueprintOp[] {
 const graphId = to.id, patch = graphPatch(from, to);
 const oldTypes = new Map(from.nodes.map(node => [node.id, node.type] as const));
 const retyped = patch.updateNodes.filter(node => oldTypes.get(node.id) !== node.type);
 const ops: BlueprintOp[] = patch.removeConnections.map(connectionId => ({ kind: 'disconnect', graphId, connectionId }));
 for (const nodeId of [...patch.removeNodes, ...retyped.map(node => node.id)]) ops.push({ kind: 'removeNode', graphId, nodeId });
 const before = new Map(from.variables.map(v => [v.id, v] as const)), after = new Set(to.variables.map(v => v.id));
 for (const id of before.keys()) if (!after.has(id)) ops.push({ kind: 'removeVariable', graphId, variableId: id });
 for (const variable of to.variables) {
  const old = before.get(variable.id);
  if (!old) ops.push({ kind: 'addVariable', graphId, variable });
  else if (!same(old, variable)) ops.push({ kind: 'updateVariable', graphId, variableId: variable.id, name: variable.name, type: variable.type, default: variable.default });
 }
 for (const node of [...patch.addNodes, ...retyped]) ops.push({ kind: 'addNode', graphId, node });
 for (const node of patch.updateNodes) if (oldTypes.get(node.id) === node.type) ops.push({ kind: 'setNodeSettings', graphId, nodeId: node.id, settings: node.settings });
 for (const move of patch.moveNodes) ops.push({ kind: 'moveNode', graphId, nodeId: move.id, position: move.position });
 // Wires go last: a settings change can drop wires, and a retyped node lost all of its wires.
 const added = new Set(patch.addConnections.map(wire => wire.id)), redone = new Set(retyped.map(node => node.id));
 const rewire = to.connections.filter(wire => !added.has(wire.id) && (redone.has(wire.sourceNodeId) || redone.has(wire.targetNodeId)));
 for (const connection of [...patch.addConnections, ...rewire]) ops.push({ kind: 'connect', graphId, connection });
 return ops;
}

interface Step { before: BlueprintGraph; undo: BlueprintOp[]; redo: BlueprintOp[]; shape: string; at: number }
export interface UndoHistory {
 record(graphId: string, before: BlueprintGraph, after: BlueprintGraph, ops: readonly BlueprintOp[]): void;
 // `apply` sends the operations and returns false when they no longer apply; that step is then dropped.
 undo(graphId: string, apply: (ops: BlueprintOp[]) => boolean): boolean;
 redo(graphId: string, apply: (ops: BlueprintOp[]) => boolean): boolean;
 clear(): void;
}
const LIMIT = 64, MERGE_MS = 500;
const shape = (ops: readonly BlueprintOp[]) => ops.length > 0 && ops.every(op => op.kind === 'moveNode') ? 'move'
 : JSON.stringify(ops.map(op => [op.kind, 'nodeId' in op ? op.nodeId : 'variableId' in op ? op.variableId : '']));

export function createUndoHistory(now: () => number = () => performance.now()): UndoHistory {
 const done = new Map<string, Step[]>(), undone = new Map<string, Step[]>();
 const move = (from: Map<string, Step[]>, to: Map<string, Step[]>, graphId: string, pick: (step: Step) => BlueprintOp[], apply: (ops: BlueprintOp[]) => boolean) => {
  const step = from.get(graphId)?.pop();
  if (!step) return false;
  if (!apply(pick(step))) return false;
  to.set(graphId, [...(to.get(graphId) ?? []), step]);
  return true;
 };
 return {
  record(graphId, before, after, ops) {
   const list = done.get(graphId) ?? [], last = list.at(-1), key = shape(ops), time = now();
   const merge = last !== undefined && key !== '[]' && last.shape === key && time - last.at < MERGE_MS;
   const start = merge ? last.before : before;
   const redo = diffOps(start, after);
   const kept = merge ? list.slice(0, -1) : list;
   done.set(graphId, redo.length === 0 ? kept : [...kept, { before: start, undo: diffOps(after, start), redo, shape: key, at: time }].slice(-LIMIT));
   if (redo.length > 0 || merge) undone.set(graphId, []);
  },
  undo: (graphId, apply) => move(done, undone, graphId, step => step.undo, apply),
  redo: (graphId, apply) => move(undone, done, graphId, step => step.redo, apply),
  clear() { done.clear(); undone.clear(); },
 };
}
```

- [ ] **Step 6: Split large edits in `blueprint-sync.ts`**

In `edit`, replace `else pending.push({ batchId: crypto.randomUUID(), ops, sent: false });` with:

```ts
   // One user action can exceed the batch limit; its batches go in order.
   else for (let i = 0; i < ops.length; i += 64) pending.push({ batchId: crypto.randomUUID(), ops: ops.slice(i, i + 64), sent: false });
```

- [ ] **Step 7: Wire the panel**

In `BlueprintPanel.svelte`:
- Import `shortcutFor`, `copyNodes`, `pasteOps`, `duplicateAnchor`, `type BlueprintClipboard`, `createUndoHistory`.
- Add `const history = createUndoHistory(); let clipboard: BlueprintClipboard | null = null; let lastRevision = 0;`.
- Replace `act` with:

```ts
 const act = (ops: BlueprintOp[]) => {
  const before = sync.view().find(item => item.id === selectedId);
  if (ops.length === 0 || !before) return { ok: true, data: sync.view() } as const;
  const result = edit(ops);
  if (result.ok) { const after = result.data.find(item => item.id === before.id); if (after) history.record(before.id, before, after, ops); }
  return result;
 };
 const send = (ops: BlueprintOp[]) => edit(ops).ok;
 function paste(clip: BlueprintClipboard, anchor: { x: number; y: number }) {
  if (!graph) return;
  const { ops, nodeIds } = pasteOps(clip, graph.id, anchor);
  if (!act(ops).ok) return;
  const latest = sync.view().find(item => item.id === graph!.id);
  if (latest) void editor?.show(latest).then(() => editor?.selectMany(nodeIds));
 }
 function shortcut(event: KeyboardEvent) {
  const action = shortcutFor(event, platform);
  if (!action || !graph || !editor) return;
  event.preventDefault();
  const selection = editor.selected();
  if (action === 'delete') act(deleteOps(graph, selection));
  if (action === 'copy') clipboard = copyNodes(graph, selection) ?? clipboard;
  if (action === 'paste' && clipboard) paste(clipboard, editor.pointer());
  if (action === 'duplicate') { const clip = copyNodes(graph, selection); if (clip) paste(clip, duplicateAnchor(clip)); }
  if (action === 'selectAll') editor.selectMany(graph.nodes.map(item => item.id));
  if (action === 'undo') history.undo(graph.id, send);
  if (action === 'redo') history.redo(graph.id, send);
  if (action === 'escape') { if (menu) menu = null; else { editor.select(null); nodeId = null; } }
 }
```

- In `update(next)`, at the start: `if (sync.revision() < lastRevision) history.clear(); lastRevision = sync.revision();`.
- Add to `nodeItems` after Delete: `{ value: 'duplicate', label: 'Duplicate' }, { value: 'copy', label: 'Copy' },`; to the canvas items, before Select all: `...(clipboard ? [{ value: 'paste', label: 'Paste' }] : [])`. In `pick`:

```ts
  if (current.kind === 'node' && action === 'copy') clipboard = copyNodes(graph, current.nodeIds) ?? clipboard;
  if (current.kind === 'node' && action === 'duplicate') { const clip = copyNodes(graph, current.nodeIds); if (clip) paste(clip, duplicateAnchor(clip)); }
  if (current.kind === 'canvas' && action === 'paste' && clipboard) paste(clipboard, current.at);
```

- The canvas element: `<div class="blueprint-canvas" bind:this={canvas} tabindex="0" role="application" aria-label="Blueprint canvas" onkeydown={shortcut} onpointerdown={() => canvas.focus()}></div>`.
- Add `.blueprint-canvas:focus{outline:none}` to `app.css`.

- [ ] **Step 8: Run tests and the type check**

Run: `pnpm exec vitest run --project unit apps/desktop`
Expected: PASS.
Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop
git commit -m "Add Blueprint shortcuts, copy and paste, duplicate, and undo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: MCP node catalog resource

**Files:**
- Modify: `packages/contracts/src/blueprint-nodes/index.ts` (`blueprintNodeCatalog`), `apps/mcp/src/resources.ts`, `apps/mcp/src/server.ts` (description text), `apps/mcp/test/stdio-roundtrip.integration.test.ts`, `docs/mcp-client-setup.md`
- Test: `packages/contracts/test/blueprint-definitions.test.ts` (append), the MCP integration test

**Interfaces:**
- Consumes: `NODE_DEFINITIONS` (Tasks 1, 4–6).
- Produces: `blueprintNodeCatalog(): { type; label; category; keywords: string[]; ports: PortShape; portsDependOnSettings: boolean; settings: unknown }[]` (settings is the JSON Schema from `z.toJSONSchema`). Resource `opensekai://blueprint-nodes` returns `{ "nodes": [...] }`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/test/blueprint-definitions.test.ts`:

```ts
import { blueprintNodeCatalog } from '../src';

it('publishes a catalog of every node with its ports and settings schema', () => {
 const catalog = blueprintNodeCatalog();
 expect(catalog).toHaveLength(NODE_DEFINITIONS.length);
 expect(catalog).toHaveLength(42);
 const sequence = catalog.find(entry => entry.type === 'flow.sequence')!;
 expect(sequence).toMatchObject({ label: 'Sequence', category: 'Flow', portsDependOnSettings: true, settings: { type: 'object', required: ['outputs'] } });
 expect(catalog.find(entry => entry.type === 'variable.setNumber')!.ports).toEqual({ inputs: { flow: 'flow', value: 'number' }, outputs: { exit: 'flow' } });
 expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
});
```

In `apps/mcp/test/stdio-roundtrip.integration.test.ts`, after the `opensekai://blueprints` read:

```ts
  expect((await client.listResources()).resources.map(r=>r.uri)).toContain('opensekai://blueprint-nodes');
  const catalog=JSON.parse(String((await client.readResource({uri:'opensekai://blueprint-nodes'})).contents[0]!.text));
  expect(catalog.nodes.map((n:{type:string})=>n.type)).toContain('variable.addNumber');
  expect((await client.callTool({name:'blueprint_edit',arguments:{clientId:'mcp',batchId:'v1',ops:[{kind:'addVariable',graphId:'g',variable:{id:'n',name:'N',type:'number',default:0}},{kind:'addNode',graphId:'g',node:{id:'add',version:1,type:'variable.addNumber',settings:{variableId:'n'},position:{x:0,y:0}}}]}})).isError).toBe(false);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit packages/contracts/test/blueprint-definitions.test.ts` and `pnpm exec vitest run --project integration apps/mcp`
Expected: FAIL (`blueprintNodeCatalog` missing; resource not listed).

- [ ] **Step 3: Implement**

In `blueprint-nodes/index.ts`:

```ts
const SAMPLE: DefaultRefs = { entityId: 'entity', cameraId: 'camera', outputId: 'output', keystroke: { code: 'KeyH', control: true, alt: true, shift: false, meta: false }, variables: [{ id: 'number', type: 'number' }, { id: 'boolean', type: 'boolean' }] };
// Ports are shown for the default settings; `portsDependOnSettings` marks nodes whose port list changes with them.
export const blueprintNodeCatalog = () => NODE_DEFINITIONS.map(definition => ({
 type: definition.type, label: definition.label, category: definition.category, keywords: [...definition.keywords],
 ports: definition.ports(definition.defaults(SAMPLE) as never),
 portsDependOnSettings: 'dynamicPorts' in definition && definition.dynamicPorts === true,
 settings: z.toJSONSchema(definition.settings),
}));
```

In `apps/mcp/src/resources.ts`, import `blueprintNodeCatalog` from `@opensekai/contracts` and register after the `blueprints` resource:

```ts
 server.registerResource('blueprint-nodes', 'opensekai://blueprint-nodes', {mimeType:'application/json'}, async uri =>
  ({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify({nodes:blueprintNodeCatalog()})}]}));
```

In `apps/mcp/src/server.ts`, change the `blueprint_edit` description to: `'Apply ordered Blueprint operations as one batch. Each batch needs a new batchId. Resending the identical batch is safe. Read opensekai://blueprint-nodes for node types, ports, and settings.'`.

In `docs/mcp-client-setup.md`, where the Blueprint resource is described, add one sentence: "The resource `opensekai://blueprint-nodes` lists each node type with its ports and the JSON Schema of its settings."

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project unit packages/contracts apps/mcp` and `pnpm test:integration`
Expected: PASS.
Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/mcp docs/mcp-client-setup.md
git commit -m "Publish the Blueprint node catalog to MCP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Verify in the running macOS app, and record evidence and parity

**Files:**
- Create: `docs/evaluation/blueprint-catalog.md`
- Modify: `docs/warudo-parity.md` (rows BP-01, BP-02, BP-03 and one evidence table row)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run every suite**

Run: `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo test --workspace`, `pnpm build`
Expected: all pass, `pnpm build` prints no warnings. Record the counts.

- [ ] **Step 2: Start the app**

Run (background): `pnpm --filter @opensekai/desktop tauri dev`
Expected: the Rust build finishes with no `warning:` lines, and the window opens.

- [ ] **Step 3: Run the check list in the app**

Use computer-use if this session has it; otherwise ask the operator to run the list and report each result. Open the Blueprints panel, create a graph, then:

1. Right-click the canvas: one menu with a focused search field, `Select all`, and (after a copy) `Paste`. Type `cool` and press Enter: a Throttle node appears at the pointer.
2. Right-click a node: `Delete`, `Duplicate`, `Copy`, `Disconnect all`; a Manual Trigger also shows `Run`. Right-click a wire: `Delete`. Each action works.
3. Drag from the Keystroke node's flow output to empty canvas and release: the search shows only nodes with a flow input; choose Gate; it is placed and wired.
4. Select two nodes (⌘-click), press ⌘C, move the pointer, press ⌘V: the copy appears at the pointer with its inner wire. Press ⌘D: a copy appears 24 px down and right. Press Backspace: the selection is deleted. Press ⌘Z three times and ⇧⌘Z once: the graph steps back and forward.
5. Type in a node's number field and press Backspace: the text changes; no node is deleted.
6. Add a Number variable, name it `Count`. Build: On Keystroke Pressed → Add To Number Variable (`Count`, amount from a Number node 1) → Switch On Number (cases `1, 2`, value from Get Number Variable `Count`) → case0 Switch Camera close, case1 Switch Camera wide. Press the hotkey in another app three times: the OBS output cuts close, then wide, then stays wide.
7. Copy a node into a second graph with ⌘C, switch graphs, and press ⌘V: it pastes there.
8. Save the show, open it again: the variable and nodes are there and the hotkey works.

- [ ] **Step 4: Write the evidence note**

`docs/evaluation/blueprint-catalog.md` (ASD-STE100): date, commit (`git rev-parse --short HEAD`), platform, build kind, the suite counts from Step 1, each check-list item with result (pass, fail, or not run), and limits: unit-only coverage for the nodes not run live, no Windows run, no live Warudo comparison. A measurement that was not taken is "not measured", never zero.

- [ ] **Step 5: Update parity**

In `docs/warudo-parity.md`, update BP-01, BP-02, and BP-03. Claim only items that Step 3 verified live or that a session integration test covers; mark the rest "unit tests only". Remove from "remain" the items now done (variables, loops, search, undo, copy and paste, duplicate). Keep On Update, grouping, and arrange in "remain". Add one evidence table row that links `evaluation/blueprint-catalog.md`.

- [ ] **Step 6: Commit**

```bash
git add docs/evaluation/blueprint-catalog.md docs/warudo-parity.md
git commit -m "Record the Blueprint catalog check and parity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
