# Blueprint Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A streamer presses a global hotkey while another app is focused. An enabled Blueprint then shows, hides, toggles, or switches a camera, and can undo the change after a delay. The result is visible in the OBS output. Several clients (the editor and MCP) edit the same graphs, and their edits stay in sync. The graphs save and load with the show.

**Architecture:**
- The session worker owns the graph documents. A client sends small operation batches (`blueprintEdit`). The session applies them in order with one pure function from `@opensekai/contracts`, and writes each accepted batch to a 64-entry journal.
- The editor applies its own operations at once with the same function (prediction). It reconciles against `blueprintInspect({ sinceRevision })`, which returns a delta or a snapshot, when the `blueprintRevision` in `appStatus` changes.
- The session compiles each document. Documents that do not compile are kept, and the last valid version of each graph keeps running.
- The Rust host registers the accelerators that the session reports, through `tauri-plugin-global-shortcut`. It queues each press and sends it to the session on the existing 60 Hz clock message.
- On each tick the session runs due delays first, then input events. It applies the effects of each graph separately, then commits at most one scene revision.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 5, Svelte 5, Rete 2, `@oshi-connect/ui`, Rust (Tauri 2, axum, tokio), `tauri-plugin-global-shortcut` 2.x, pnpm 12.

**Spec:** [Blueprint interactions design](../specs/2026-10-07-blueprint-interactions-design.md). Background: [Blueprint foundation design](../specs/2026-10-04-blueprint-foundation-design.md), [Rete Blueprint editor design](../specs/2026-10-04-rete-blueprint-editor-design.md), [Blueprint persistence analysis](../../../spdd/analysis/2026-10-07-blueprint-persistence.md), [scene show management contract](../../../spdd/prompt/2026-10-07-scene-show-management.md).

**Working directory:** the OpenSekai worktree for branch `feat/blueprint-interactions`. Verify `pwd` before Git. Do not use `git -C` or compound `cd … &&`.

## Global Constraints

- At most 8 graphs. Each graph has at most 128 nodes and 256 connections.
- A batch has 1–64 operations. The journal keeps the last 64 batches.
- A delta reply never holds more than 32 batches, and never holds a batch with `replaceAll` or `createGraph`. Otherwise the reply is a snapshot.
- At most 16 input events per clock message. At most 64 events in the native queue; when it is full, drop the oldest.
- At most 64 flow visits per event. At most 256 flow visits and 64 effects per tick in total.
- At most 32 pending delays per graph. Delay seconds are 0–3600.
- A Sequence has 2–8 outputs.
- Every accelerator contains Control, Alt, or Meta. Shift alone does not count. There is no exception for function keys.
- The canonical accelerator order is `Control+Alt+Shift+Super+<Code>`. At most 64 active accelerators.
- New keystroke nodes default to Control+Alt+KeyH on macOS (shown as ⌃⌥H) and to Control+Shift+KeyH on other platforms.
- A flow output has at most one wire. A flow input accepts many. A data input has exactly one wire, and the wire is required to compile. A new wire on a single-wire port replaces the old wire.
- A flow cycle is allowed only when it passes through `flow.delay`. Every data cycle is rejected.
- `blueprintEdit` and `blueprintRun` need the `edit` capability. `blueprintInspect` needs `read`.
- Blueprint effects commit at most one scene revision per tick, and only when the scene changed.
- Do not add On Update. Graphs run only on the session clock and through `blueprintRun`.
- Show files stay at version 1. `blueprints` has at most 8 entries. `enabled` defaults to `true`, so existing files still open.
- Constitution: pnpm only; functional TypeScript; `@oshi-connect/ui` controls; no UI copy that repeats the control; verify UI in the running app; ASD-STE100 for docs.
- Do not push, publish, or start a stream. Local OBS WebSocket control (`ws://127.0.0.1:4455`) and test recordings are allowed.

## Review Focus

1. **Two clients edit the same graph at the same time.** Example: the editor drags a node while MCP removes it. Expected: both clients converge to the session's order. The editor's rejected batch causes a reload, not a stuck canvas. Test: the two-client convergence test in Task 8, which runs against a real session.
2. **A held hotkey fires once.** The OS can repeat Pressed events while a key is down. Expected: one effect for each physical press. Test: `KeyLatch` in Task 6.
3. **An accelerator that another app owns.** Expected: the other accelerators still register, and `appStatus.warnings` names the failed one. Test: the fake registrar in Task 6.
4. **A graph made invalid mid-edit while its hotkey is live.** Expected: the last valid version still fires. Expected: `blueprintInspect` reports the compile error. Test: Task 4.
5. **A target entity removed after a graph is installed.** Expected: only that graph's effects drop, and the graph records a runtime error. Other graphs on the same tick still commit. A toggle that changes nothing does not advance the scene revision. Test: Task 4.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `fixtures/protocol/keystroke-codes.json` (create) | The single list of allowed key codes (TypeScript and Rust) |
| `fixtures/protocol/blueprint-set.json` (create) | A shared valid graph set with its expected active accelerators |
| `packages/contracts/src/blueprint.ts` (modify) | Graph and node schemas, keystroke settings, accelerator, graph set |
| `packages/contracts/src/blueprint-nodes.ts` (create) | Node catalog: ports, labels, default settings |
| `packages/contracts/src/blueprint-ops.ts` (create) | Operation schemas, batch schema, the pure `applyBlueprintOps` |
| `packages/contracts/src/schema.ts`, `types.ts`, `index.ts` (modify) | Commands, inspect reply, clock `input`, `blueprintRevision` on frames and status, show limit |
| `packages/session/src/blueprint.ts` (rewrite) | Compiler and the flow executor for one event |
| `packages/session/src/blueprint-runtime.ts` (create) | Active graphs, Flip Flop state, delays, event dispatch per tick |
| `packages/session/src/blueprint-store.ts` (create) | Documents, journal, compile status, inspect replies |
| `packages/session/src/scene-ops.ts` (create) | Pure scene operations and Blueprint effects (moved out of `session.ts`) |
| `packages/session/src/session.ts`, `worker.ts` (modify) | Session API and command routes |
| `packages/browser-client/src/client.ts` (modify) | Clock `input` to listeners |
| `crates/contracts/src/lib.rs` (modify) | Structural graph and operation validation, new methods, clock input, frame and status fields |
| `apps/desktop/src-tauri/src/show.rs` (modify) | Shared structural validator; up to 8 graphs |
| `apps/desktop/src-tauri/src/input.rs` (create) | Registrar trait, key latch, input queue, Tauri global-shortcut adapter |
| `apps/desktop/src-tauri/src/service/{mod,router}.rs` (modify) | Queue drain into the clock; reconcile after `blueprintEdit`; warnings; publisher loss |
| `apps/desktop/src-tauri/src/lib.rs`, `Cargo.toml`, `Cargo.lock` (modify) | Plugin setup |
| `apps/mcp/src/tools.ts`, `apps/mcp/src/resources.ts` (modify) | `blueprint_edit`, `blueprint_inspect`, `blueprint_run`, and a `opensekai://blueprints` resource |
| `apps/desktop/src/blueprints/blueprint-sync.ts` (create) | Prediction, ordered send, journal reconciliation |
| `apps/desktop/src/blueprints/rete-editor.ts` (modify) | Catalog sockets, port multiplicity, incremental patching, canvas events to operations |
| `apps/desktop/src/blueprints/keystroke-format.ts` (create) | Platform default and platform labels for accelerators |
| `apps/desktop/src/components/BlueprintPanel.svelte`, `BlueprintList.svelte` (new), `BlueprintNodeFields.svelte` (new), `KeystrokeField.svelte` (new) | Editor UI |
| `apps/desktop/src/EditorApp.svelte`, `apps/desktop/src/editor-poll.ts` (modify) | Revision-driven pull; show save and open through the session |
| `docs/evaluation/blueprint-interactions.md` (create), `docs/warudo-parity.md` (modify) | Evidence and parity |

---

### Task 1: SPDD contract for the slice

**Files:**
- Create: `spdd/analysis/2026-10-07-blueprint-interactions.md`, `spdd/prompt/2026-10-07-blueprint-interactions.md`

**Interfaces:**
- Consumes: the design spec.
- Produces: the REASONS contract that Tasks 2–9 implement.

- [ ] **Step 1: Write the analysis.** Use the open-spdd analysis format, as in `spdd/analysis/2026-10-07-blueprint-persistence.md`, in ASD-STE100. Include these points:
  - On Update is deferred because of scene revision churn.
  - The edit model is prediction with reconciliation against an authoritative operation journal. Give the reason: the editor and MCP edit the same graphs, and the only transport is request and reply with a 500 ms status poll.
  - The risk that a global hotkey holds keys in other apps. Mark it Different.
  - The Warudo VM check failed (VirtIO GPU, D3D11 device removed).
  - The critical path: hotkey in another app → effect in OBS → show save → reopen → the hotkey works again.
- [ ] **Step 2: Write the REASONS contract.** Write all seven sections, in the format of `spdd/prompt/2026-10-07-scene-show-management.md`.
  - Copy every Global Constraint above into Safeguards, with the exact values.
  - Operations list Tasks 2–9 in order.
- [ ] **Step 3: Commit**

```bash
git add spdd/analysis/2026-10-07-blueprint-interactions.md spdd/prompt/2026-10-07-blueprint-interactions.md docs/superpowers/specs/2026-10-07-blueprint-interactions-design.md docs/superpowers/plans/2026-10-07-blueprint-interactions.md
git commit -m "docs: specify Blueprint hotkey interactions slice"
```

---

### Task 2: Contracts — node catalog, operations, commands, clock input

**Files:**
- Create: `fixtures/protocol/keystroke-codes.json`, `fixtures/protocol/blueprint-set.json`, `packages/contracts/src/blueprint-nodes.ts`, `packages/contracts/src/blueprint-ops.ts`
- Modify: `packages/contracts/src/blueprint.ts`, `packages/contracts/src/schema.ts`, `packages/contracts/src/types.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/blueprint.test.ts`, `packages/contracts/test/blueprint-ops.test.ts` (create), `packages/contracts/test/show.test.ts`

**Interfaces:**
- Produces:
  - Node types: `'event.manual' | 'event.keystroke' | 'value.number' | 'value.boolean' | 'math.add' | 'logic.greater' | 'logic.not' | 'flow.branch' | 'flow.sequence' | 'flow.flipFlop' | 'flow.delay' | 'scene.setVisibility' | 'scene.toggleVisibility' | 'camera.switch'`.
  - `BlueprintGraph.enabled: boolean` (the input may omit it; the default is `true`).
  - `KEYSTROKE_CODES`, `KeystrokeSettings = { code; control; alt; shift; meta }`, `keystrokeAccelerator(s): string`.
  - `BlueprintSetSchema` (at most 8 graphs, unique IDs).
  - `blueprintPorts(node): PortShape`, `BLUEPRINT_LABELS`, `defaultBlueprintSettings(kind, refs: { entityId; cameraId; keystroke: KeystrokeSettings })`, `PortType`, `BlueprintKind`.
  - `BlueprintOp`, `BlueprintOpSchema`, `BlueprintBatch = { clientId: Id; batchId: Id; ops: BlueprintOp[] }`, `BlueprintBatchSchema`.
  - `applyBlueprintOps(graphs: readonly BlueprintGraph[], ops: readonly BlueprintOp[]): Reply<BlueprintGraph[]>`. It is pure: it never mutates its input.
  - `InputUpdate = { events: { kind: 'keystroke'; accelerator: string }[] }` (1–16 events).
  - `BlueprintInspect = { kind: 'snapshot'; revision; blueprints: BlueprintGraph[]; errors: BlueprintStatus[] } | { kind: 'delta'; revision; batches: (BlueprintBatch & { revision: number })[]; errors: BlueprintStatus[] }`.
  - `BlueprintStatus = { graphId: Id; kind: 'compile' | 'runtime'; error: AppError }` (at most 16).
  - `AppApi`:
    - `blueprintEdit(BlueprintBatch) → Reply<{ revision: number; keystrokes: string[] }>` (`keystrokes` has at most 64 entries)
    - `blueprintInspect({ sinceRevision?: number }) → Reply<BlueprintInspect>`
    - `blueprintRun({ graphId, triggerNodeId }) → Reply<{ revision }>`. This is a breaking change: the `graph` field is removed.
  - `RuntimeFrame.blueprintRevision?: number` and `AppStatus.blueprintRevision?: number`.
  - `onClock(listener: (elapsedMs, tracking?, input?) => void)`.

- [ ] **Step 1: Create the shared fixtures**

Generate `fixtures/protocol/keystroke-codes.json` with this script. Do not write it by hand:

```bash
node -e 'const c=[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(x=>"Key"+x).concat([...Array(10)].map((_,i)=>"Digit"+i),[...Array(10)].map((_,i)=>"Numpad"+i),[...Array(24)].map((_,i)=>"F"+(i+1)),["Space","Enter","Backspace","Tab","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"]);require("fs").writeFileSync("fixtures/protocol/keystroke-codes.json",JSON.stringify(c,null,1)+"\n")'
```

`fixtures/protocol/blueprint-set.json`:

```json
{
 "blueprints": [
  {
   "schemaVersion": 1, "id": "toggle-performer", "name": "Toggle performer",
   "nodes": [
    { "id": "key", "version": 1, "type": "event.keystroke", "settings": { "code": "KeyH", "control": true, "alt": true, "shift": false, "meta": false }, "position": { "x": 0, "y": 0 } },
    { "id": "toggle", "version": 1, "type": "scene.toggleVisibility", "settings": { "entityId": "performer" }, "position": { "x": 300, "y": 0 } }
   ],
   "connections": [ { "id": "w1", "sourceNodeId": "key", "sourcePort": "flow", "targetNodeId": "toggle", "targetPort": "flow" } ]
  },
  {
   "schemaVersion": 1, "id": "flash-marker", "name": "Flash marker", "enabled": true,
   "nodes": [
    { "id": "key", "version": 1, "type": "event.keystroke", "settings": { "code": "KeyJ", "control": true, "alt": true, "shift": false, "meta": false }, "position": { "x": 0, "y": 0 } },
    { "id": "on", "version": 1, "type": "value.boolean", "settings": { "value": true }, "position": { "x": 0, "y": 200 } },
    { "id": "off", "version": 1, "type": "value.boolean", "settings": { "value": false }, "position": { "x": 300, "y": 200 } },
    { "id": "show", "version": 1, "type": "scene.setVisibility", "settings": { "entityId": "marker" }, "position": { "x": 300, "y": 0 } },
    { "id": "wait", "version": 1, "type": "flow.delay", "settings": { "seconds": 2 }, "position": { "x": 600, "y": 0 } },
    { "id": "hide", "version": 1, "type": "scene.setVisibility", "settings": { "entityId": "marker" }, "position": { "x": 900, "y": 0 } }
   ],
   "connections": [
    { "id": "w1", "sourceNodeId": "key", "sourcePort": "flow", "targetNodeId": "show", "targetPort": "flow" },
    { "id": "w2", "sourceNodeId": "on", "sourcePort": "value", "targetNodeId": "show", "targetPort": "visible" },
    { "id": "w3", "sourceNodeId": "show", "sourcePort": "exit", "targetNodeId": "wait", "targetPort": "flow" },
    { "id": "w4", "sourceNodeId": "wait", "sourcePort": "exit", "targetNodeId": "hide", "targetPort": "flow" },
    { "id": "w5", "sourceNodeId": "off", "sourcePort": "value", "targetNodeId": "hide", "targetPort": "visible" }
   ]
  },
  {
   "schemaVersion": 1, "id": "disabled", "name": "Disabled", "enabled": false,
   "nodes": [ { "id": "key", "version": 1, "type": "event.keystroke", "settings": { "code": "KeyK", "control": false, "alt": false, "shift": true, "meta": true }, "position": { "x": 0, "y": 0 } } ],
   "connections": []
  }
 ],
 "expectedAccelerators": ["Control+Alt+KeyH", "Control+Alt+KeyJ"]
}
```

- [ ] **Step 2: Write the failing contract tests.** Add these to `packages/contracts/test/blueprint.test.ts`. Keep the existing tests that still apply:

```ts
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { BlueprintSetSchema, BlueprintGraphSchema, KEYSTROKE_CODES, keystrokeAccelerator, blueprintPorts, ParamSchemas, ResultSchemas, ClockEnvelopeSchema, RuntimeFrameSchema, requiredCapability } from '../src';

const keyNode = (settings: object) => ({ id: 'k', version: 1, type: 'event.keystroke', settings, position: { x: 0, y: 0 } });
const graphWith = (nodes: object[]) => ({ schemaVersion: 1, id: 'g', name: 'G', nodes, connections: [] });
const keys = (code: string, mods: Partial<Record<'control' | 'alt' | 'shift' | 'meta', boolean>>) => ({ code, control: false, alt: false, shift: false, meta: false, ...mods });

it('derives the shared accelerators of enabled keystroke nodes', () => {
 const set = BlueprintSetSchema.parse(fixture.blueprints);
 const accelerators = set.filter(g => g.enabled).flatMap(g => g.nodes.flatMap(n => n.type === 'event.keystroke' ? [keystrokeAccelerator(n.settings)] : []));
 expect(accelerators).toEqual(fixture.expectedAccelerators);
 expect(set[0]!.enabled).toBe(true);
});

it('formats every allowed code in canonical modifier order', () => {
 for (const code of KEYSTROKE_CODES) expect(keystrokeAccelerator(keys(code, { control: true, alt: true, shift: true, meta: true }))).toBe(`Control+Alt+Shift+Super+${code}`);
});

it('requires Control, Alt, or Meta on every keystroke', () => {
 const ok = (settings: object) => BlueprintGraphSchema.safeParse(graphWith([keyNode(settings)])).success;
 expect(ok(keys('KeyA', {}))).toBe(false);
 expect(ok(keys('F5', {}))).toBe(false);
 expect(ok(keys('KeyA', { shift: true }))).toBe(false);
 expect(ok(keys('KeyA', { meta: true }))).toBe(true);
 expect(ok(keys('F5', { control: true, shift: true }))).toBe(true);
 expect(ok(keys('Escape', { control: true }))).toBe(false);
});

it('bounds a graph set to eight unique graphs', () => {
 const g = (id: string) => ({ ...graphWith([]), id });
 expect(BlueprintSetSchema.safeParse(Array.from({ length: 8 }, (_, i) => g(`g${i}`))).success).toBe(true);
 expect(BlueprintSetSchema.safeParse(Array.from({ length: 9 }, (_, i) => g(`g${i}`))).success).toBe(false);
 expect(BlueprintSetSchema.safeParse([g('same'), g('same')]).success).toBe(false);
});

it('gives Sequence one flow output per configured step', () => {
 const node = { id: 's', version: 1, type: 'flow.sequence', settings: { outputs: 3 }, position: { x: 0, y: 0 } } as const;
 expect(Object.keys(blueprintPorts(node).outputs)).toEqual(['then0', 'then1', 'then2']);
});

it('defines journal-based Blueprint commands and their capabilities', () => {
 expect(ParamSchemas.blueprintRun.safeParse({ graphId: 'g', triggerNodeId: 'n' }).success).toBe(true);
 expect(ParamSchemas.blueprintRun.safeParse({ graph: graphWith([]), triggerNodeId: 'n' }).success).toBe(false);
 expect(ParamSchemas.blueprintEdit.safeParse({ clientId: 'c', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: fixture.blueprints }] }).success).toBe(true);
 expect(ParamSchemas.blueprintEdit.safeParse({ clientId: 'c', batchId: 'b', ops: [] }).success).toBe(false);
 expect(ParamSchemas.blueprintInspect.safeParse({}).success).toBe(true);
 expect(ParamSchemas.blueprintInspect.safeParse({ sinceRevision: 3 }).success).toBe(true);
 expect(ResultSchemas.blueprintEdit.safeParse({ revision: 1, keystrokes: Array(65).fill('Control+KeyA') }).success).toBe(false);
 expect(ResultSchemas.blueprintInspect.safeParse({ kind: 'delta', revision: 2, batches: [{ revision: 2, clientId: 'c', batchId: 'b', ops: [{ kind: 'removeGraph', graphId: 'g' }] }], errors: [] }).success).toBe(true);
 expect(requiredCapability('blueprintEdit')).toBe('edit');
 expect(requiredCapability('blueprintInspect')).toBe('read');
});

it('carries bounded keystroke input on the clock and the Blueprint revision on frames', () => {
 const events = Array.from({ length: 16 }, () => ({ kind: 'keystroke', accelerator: 'Control+Alt+KeyH' }));
 expect(ClockEnvelopeSchema.safeParse({ kind: 'clock', sessionId: 's', elapsedMs: 1, input: { events } }).success).toBe(true);
 expect(ClockEnvelopeSchema.safeParse({ kind: 'clock', sessionId: 's', elapsedMs: 1, input: { events: [...events, events[0]] } }).success).toBe(false);
 expect(RuntimeFrameSchema.shape.blueprintRevision).toBeDefined();
});
```

Add this case to `packages/contracts/test/show.test.ts`, using the file's existing valid-show builder:

```ts
it('opens a version-1 show whose graphs omit enabled and holds up to eight graphs', () => {
 const document = /* existing valid show builder */;
 document.blueprints = fixture.blueprints;
 expect(ShowDocumentSchema.parse(document).blueprints.map(g => g.enabled)).toEqual([true, true, false]);
});
```

- [ ] **Step 3: Write the failing operation tests** in `packages/contracts/test/blueprint-ops.test.ts`:

```ts
import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintSetSchema, type BlueprintGraph } from '../src';

const base = () => BlueprintSetSchema.parse(structuredClone(fixture.blueprints));
const node = (id: string, type: string, settings: object = {}) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 } }) as BlueprintGraph['nodes'][number];
const ok = (r: ReturnType<typeof applyBlueprintOps>) => { if (!r.ok) throw new Error(r.error.message); return r.data; };
const graph = (gs: BlueprintGraph[], id: string) => gs.find(g => g.id === id)!;

it('is pure and atomic: a failing op rejects the whole batch and leaves the input untouched', () => {
 const input = base(); const before = structuredClone(input);
 const r = applyBlueprintOps(input, [{ kind: 'updateGraph', graphId: 'flash-marker', name: 'Renamed' }, { kind: 'removeNode', graphId: 'flash-marker', nodeId: 'missing' }]);
 expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', ids: ['missing'] } });
 expect(input).toEqual(before);
});

it('cascades a node removal to its wires', () => {
 const g = graph(ok(applyBlueprintOps(base(), [{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'show' }])), 'flash-marker');
 expect(g.connections.map(c => c.id)).toEqual(['w4', 'w5']);
});

it('replaces the existing wire on a data input and on a flow output', () => {
 let gs = ok(applyBlueprintOps(base(), [{ kind: 'connect', graphId: 'flash-marker', connection: { id: 'w6', sourceNodeId: 'off', sourcePort: 'value', targetNodeId: 'show', targetPort: 'visible' } }]));
 expect(graph(gs, 'flash-marker').connections.filter(c => c.targetNodeId === 'show' && c.targetPort === 'visible').map(c => c.id)).toEqual(['w6']);
 gs = ok(applyBlueprintOps(gs, [{ kind: 'connect', graphId: 'flash-marker', connection: { id: 'w7', sourceNodeId: 'key', sourcePort: 'flow', targetNodeId: 'hide', targetPort: 'flow' } }]));
 expect(graph(gs, 'flash-marker').connections.filter(c => c.sourceNodeId === 'key').map(c => c.id)).toEqual(['w7']);
});

it('rejects a wire between ports of different types or to a missing port', () => {
 expect(applyBlueprintOps(base(), [{ kind: 'connect', graphId: 'flash-marker', connection: { id: 'x', sourceNodeId: 'on', sourcePort: 'value', targetNodeId: 'wait', targetPort: 'flow' } }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(applyBlueprintOps(base(), [{ kind: 'connect', graphId: 'flash-marker', connection: { id: 'x', sourceNodeId: 'key', sourcePort: 'nope', targetNodeId: 'wait', targetPort: 'flow' } }])).toMatchObject({ ok: false });
});

it('prunes wires on Sequence outputs that a settings change removes, and validates settings', () => {
 const gs = ok(applyBlueprintOps(base(), [
  { kind: 'addNode', graphId: 'toggle-performer', node: node('seq', 'flow.sequence', { outputs: 3 }) },
  { kind: 'connect', graphId: 'toggle-performer', connection: { id: 's2', sourceNodeId: 'seq', sourcePort: 'then2', targetNodeId: 'toggle', targetPort: 'flow' } },
  { kind: 'setNodeSettings', graphId: 'toggle-performer', nodeId: 'seq', settings: { outputs: 2 } },
 ]));
 expect(graph(gs, 'toggle-performer').connections.map(c => c.id)).toEqual(['w1']);
 expect(applyBlueprintOps(base(), [{ kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'wait', settings: { seconds: -1 } }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['wait'] } });
});

it('moves, renames, enables, creates, removes, and replaces graphs', () => {
 let gs = ok(applyBlueprintOps(base(), [
  { kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 10, y: 20 } },
  { kind: 'updateGraph', graphId: 'disabled', enabled: true, name: 'On' },
  { kind: 'createGraph', graph: { schemaVersion: 1, id: 'new', name: 'New', enabled: true, nodes: [], connections: [] } },
  { kind: 'removeGraph', graphId: 'toggle-performer' },
 ]));
 expect(graph(gs, 'flash-marker').nodes.find(n => n.id === 'wait')!.position).toEqual({ x: 10, y: 20 });
 expect(graph(gs, 'disabled')).toMatchObject({ enabled: true, name: 'On' });
 expect(gs.map(g => g.id)).toEqual(['flash-marker', 'disabled', 'new']);
 gs = ok(applyBlueprintOps(gs, [{ kind: 'replaceAll', graphs: [] }]));
 expect(gs).toEqual([]);
});

it('enforces graph and set limits after the batch', () => {
 const create = (i: number) => ({ kind: 'createGraph' as const, graph: { schemaVersion: 1 as const, id: `g${i}`, name: 'G', enabled: true, nodes: [], connections: [] } });
 expect(applyBlueprintOps([], Array.from({ length: 8 }, (_, i) => create(i))).ok).toBe(true);
 expect(applyBlueprintOps([], Array.from({ length: 9 }, (_, i) => create(i)))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(applyBlueprintOps(base(), [{ kind: 'createGraph', graph: { schemaVersion: 1, id: 'flash-marker', name: 'Dup', enabled: true, nodes: [], connections: [] } }])).toMatchObject({ ok: false });
});
```

- [ ] **Step 4: Run the tests and confirm they fail.** Run: `pnpm vitest run --project unit packages/contracts`. Expected: FAIL, because the exports are missing.

- [ ] **Step 5: Implement `packages/contracts/src/blueprint.ts`**

```ts
import { z } from 'zod';
import codes from '../../../fixtures/protocol/keystroke-codes.json';
const IdSchema = z.string().min(1).max(256);

const finite = z.number().finite();
export const BlueprintPositionSchema = z.strictObject({ x: finite, y: finite });
const base = { id: IdSchema, version: z.literal(1), position: BlueprintPositionSchema };
const empty = z.strictObject({});
const entity = z.strictObject({ entityId: IdSchema });

export const KEYSTROKE_CODES: readonly string[] = codes;
export const KeystrokeSettingsSchema = z.strictObject({
 code: z.enum(codes as [string, ...string[]]),
 control: z.boolean(), alt: z.boolean(), shift: z.boolean(), meta: z.boolean(),
});
export type KeystrokeSettings = z.infer<typeof KeystrokeSettingsSchema>;
export const keystrokeAccelerator = (s: KeystrokeSettings): string =>
 [s.control && 'Control', s.alt && 'Alt', s.shift && 'Shift', s.meta && 'Super', s.code].filter(Boolean).join('+');
export const keystrokeHasModifier = (s: KeystrokeSettings): boolean => s.control || s.alt || s.meta;

export const BlueprintNodeSchema = z.discriminatedUnion('type', [
 z.strictObject({ ...base, type: z.literal('event.manual'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('event.keystroke'), settings: KeystrokeSettingsSchema }),
 z.strictObject({ ...base, type: z.literal('value.number'), settings: z.strictObject({ value: finite }) }),
 z.strictObject({ ...base, type: z.literal('value.boolean'), settings: z.strictObject({ value: z.boolean() }) }),
 z.strictObject({ ...base, type: z.literal('math.add'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('logic.greater'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('logic.not'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('flow.branch'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('flow.sequence'), settings: z.strictObject({ outputs: z.number().int().min(2).max(8) }) }),
 z.strictObject({ ...base, type: z.literal('flow.flipFlop'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('flow.delay'), settings: z.strictObject({ seconds: finite.min(0).max(3600) }) }),
 z.strictObject({ ...base, type: z.literal('scene.setVisibility'), settings: entity }),
 z.strictObject({ ...base, type: z.literal('scene.toggleVisibility'), settings: entity }),
 z.strictObject({ ...base, type: z.literal('camera.switch'), settings: z.strictObject({ outputId: IdSchema, cameraId: IdSchema }) }),
]);

export const BlueprintConnectionSchema = z.strictObject({
 id: IdSchema,
 sourceNodeId: IdSchema,
 sourcePort: z.string().min(1).max(64),
 targetNodeId: IdSchema,
 targetPort: z.string().min(1).max(64),
});

export const BlueprintGraphSchema = z.strictObject({
 schemaVersion: z.literal(1),
 id: IdSchema,
 name: z.string().trim().min(1).max(128),
 enabled: z.boolean().default(true),
 nodes: z.array(BlueprintNodeSchema).max(128),
 connections: z.array(BlueprintConnectionSchema).max(256),
}).superRefine((graph, context) => {
 if (new Set(graph.nodes.map(node => node.id)).size !== graph.nodes.length)
  context.addIssue({ code: 'custom', message: 'Duplicate node ID', path: ['nodes'] });
 if (new Set(graph.connections.map(connection => connection.id)).size !== graph.connections.length)
  context.addIssue({ code: 'custom', message: 'Duplicate connection ID', path: ['connections'] });
 for (const node of graph.nodes)
  if (node.type === 'event.keystroke' && !keystrokeHasModifier(node.settings))
   context.addIssue({ code: 'custom', message: 'Keystroke needs Control, Alt, or Meta', path: ['nodes'] });
});

export const BlueprintSetSchema = z.array(BlueprintGraphSchema).max(8)
 .refine(graphs => new Set(graphs.map(graph => graph.id)).size === graphs.length, 'Duplicate graph ID');

export type BlueprintNode = z.infer<typeof BlueprintNodeSchema>;
export type BlueprintConnection = z.infer<typeof BlueprintConnectionSchema>;
export type BlueprintGraph = z.infer<typeof BlueprintGraphSchema>;
```

`fixtures.ts` already imports JSON, so `resolveJsonModule` is on.

- [ ] **Step 6: Implement `packages/contracts/src/blueprint-nodes.ts`**

```ts
import type { BlueprintNode, KeystrokeSettings } from './blueprint';

export type PortType = 'flow' | 'number' | 'boolean';
export interface PortShape { inputs: Record<string, PortType>; outputs: Record<string, PortType> }
export type BlueprintKind = BlueprintNode['type'];

const exit = { exit: 'flow' } as const;
export function blueprintPorts(node: BlueprintNode): PortShape {
 switch (node.type) {
  case 'event.manual': case 'event.keystroke': return { inputs: {}, outputs: { flow: 'flow' } };
  case 'value.number': return { inputs: {}, outputs: { value: 'number' } };
  case 'value.boolean': return { inputs: {}, outputs: { value: 'boolean' } };
  case 'math.add': return { inputs: { a: 'number', b: 'number' }, outputs: { result: 'number' } };
  case 'logic.greater': return { inputs: { a: 'number', b: 'number' }, outputs: { result: 'boolean' } };
  case 'logic.not': return { inputs: { value: 'boolean' }, outputs: { result: 'boolean' } };
  case 'flow.branch': return { inputs: { flow: 'flow', condition: 'boolean' }, outputs: { true: 'flow', false: 'flow' } };
  case 'flow.sequence': return { inputs: { flow: 'flow' }, outputs: Object.fromEntries(Array.from({ length: node.settings.outputs }, (_, i) => [`then${i}`, 'flow' as const])) };
  case 'flow.flipFlop': return { inputs: { flow: 'flow' }, outputs: { a: 'flow', b: 'flow', isA: 'boolean' } };
  case 'flow.delay': return { inputs: { flow: 'flow' }, outputs: exit };
  case 'scene.setVisibility': return { inputs: { flow: 'flow', visible: 'boolean' }, outputs: exit };
  case 'scene.toggleVisibility': case 'camera.switch': return { inputs: { flow: 'flow' }, outputs: exit };
 }
}

export const BLUEPRINT_LABELS: Record<BlueprintKind, string> = {
 'event.manual': 'Manual Trigger', 'event.keystroke': 'On Keystroke Pressed',
 'value.number': 'Number', 'value.boolean': 'Boolean', 'math.add': 'Add', 'logic.greater': 'Greater Than', 'logic.not': 'Not',
 'flow.branch': 'If Branch', 'flow.sequence': 'Sequence', 'flow.flipFlop': 'Flip Flop', 'flow.delay': 'Delay',
 'scene.setVisibility': 'Set Visibility', 'scene.toggleVisibility': 'Toggle Visibility', 'camera.switch': 'Switch Camera',
};

export function defaultBlueprintSettings(kind: BlueprintKind, refs: { entityId: string; cameraId: string; keystroke: KeystrokeSettings }): BlueprintNode['settings'] {
 switch (kind) {
  case 'event.keystroke': return { ...refs.keystroke };
  case 'value.number': return { value: 0 };
  case 'value.boolean': return { value: true };
  case 'flow.sequence': return { outputs: 2 };
  case 'flow.delay': return { seconds: 1 };
  case 'scene.setVisibility': case 'scene.toggleVisibility': return { entityId: refs.entityId };
  case 'camera.switch': return { outputId: 'output_main', cameraId: refs.cameraId };
  default: return {};
 }
}
```

The platform default keystroke is editor policy. It is defined in Task 8 and passed in as `refs.keystroke`, so contracts stay platform-free.

- [ ] **Step 7: Implement `packages/contracts/src/blueprint-ops.ts`**

```ts
import { z } from 'zod';
import { BlueprintConnectionSchema, BlueprintGraphSchema, BlueprintNodeSchema, BlueprintPositionSchema, BlueprintSetSchema, type BlueprintGraph } from './blueprint';
import { blueprintPorts } from './blueprint-nodes';
import type { Reply } from './types';

const IdSchema = z.string().min(1).max(256);
export const BlueprintOpSchema = z.discriminatedUnion('kind', [
 z.strictObject({ kind: z.literal('replaceAll'), graphs: BlueprintSetSchema }),
 z.strictObject({ kind: z.literal('createGraph'), graph: BlueprintGraphSchema }),
 z.strictObject({ kind: z.literal('removeGraph'), graphId: IdSchema }),
 z.strictObject({ kind: z.literal('updateGraph'), graphId: IdSchema, name: z.string().trim().min(1).max(128).optional(), enabled: z.boolean().optional() }),
 z.strictObject({ kind: z.literal('addNode'), graphId: IdSchema, node: BlueprintNodeSchema }),
 z.strictObject({ kind: z.literal('removeNode'), graphId: IdSchema, nodeId: IdSchema }),
 z.strictObject({ kind: z.literal('moveNode'), graphId: IdSchema, nodeId: IdSchema, position: BlueprintPositionSchema }),
 z.strictObject({ kind: z.literal('setNodeSettings'), graphId: IdSchema, nodeId: IdSchema, settings: z.record(z.string(), z.unknown()) }),
 z.strictObject({ kind: z.literal('connect'), graphId: IdSchema, connection: BlueprintConnectionSchema }),
 z.strictObject({ kind: z.literal('disconnect'), graphId: IdSchema, connectionId: IdSchema }),
]);
export const BlueprintBatchSchema = z.strictObject({ clientId: IdSchema, batchId: IdSchema, ops: z.array(BlueprintOpSchema).min(1).max(64) });
export type BlueprintOp = z.infer<typeof BlueprintOpSchema>;
export type BlueprintBatch = z.infer<typeof BlueprintBatchSchema>;

const reject = (code: 'NOT_FOUND' | 'INVALID_INPUT', message: string, ids: string[]): Reply<never> => ({ ok: false, error: { code, message, ids } });

export function applyBlueprintOps(graphs: readonly BlueprintGraph[], ops: readonly BlueprintOp[]): Reply<BlueprintGraph[]> {
 let next = structuredClone(graphs) as BlueprintGraph[];
 for (const op of ops) {
  if (op.kind === 'replaceAll') { next = structuredClone(op.graphs); continue; }
  if (op.kind === 'createGraph') {
   if (next.some(g => g.id === op.graph.id)) return reject('INVALID_INPUT', 'Duplicate graph ID', [op.graph.id]);
   next.push(structuredClone(op.graph)); continue;
  }
  const graph = next.find(g => g.id === op.graphId);
  if (!graph) return reject('NOT_FOUND', 'Blueprint not found', [op.graphId]);
  const nodeAt = (id: string) => graph.nodes.findIndex(n => n.id === id);
  switch (op.kind) {
   case 'removeGraph': next = next.filter(g => g !== graph); break;
   case 'updateGraph':
    if (op.name !== undefined) graph.name = op.name;
    if (op.enabled !== undefined) graph.enabled = op.enabled;
    break;
   case 'addNode':
    if (nodeAt(op.node.id) >= 0) return reject('INVALID_INPUT', 'Duplicate node ID', [op.node.id]);
    graph.nodes.push(structuredClone(op.node)); break;
   case 'removeNode':
    if (nodeAt(op.nodeId) < 0) return reject('NOT_FOUND', 'Node not found', [op.nodeId]);
    graph.nodes = graph.nodes.filter(n => n.id !== op.nodeId);
    graph.connections = graph.connections.filter(c => c.sourceNodeId !== op.nodeId && c.targetNodeId !== op.nodeId);
    break;
   case 'moveNode': {
    const i = nodeAt(op.nodeId);
    if (i < 0) return reject('NOT_FOUND', 'Node not found', [op.nodeId]);
    graph.nodes[i]!.position = { ...op.position }; break;
   }
   case 'setNodeSettings': {
    const i = nodeAt(op.nodeId);
    if (i < 0) return reject('NOT_FOUND', 'Node not found', [op.nodeId]);
    const parsed = BlueprintNodeSchema.safeParse({ ...graph.nodes[i], settings: op.settings });
    if (!parsed.success) return reject('INVALID_INPUT', 'Invalid node settings', [op.nodeId]);
    graph.nodes[i] = parsed.data;
    const ports = blueprintPorts(parsed.data);
    graph.connections = graph.connections.filter(c =>
     (c.sourceNodeId !== op.nodeId || c.sourcePort in ports.outputs) && (c.targetNodeId !== op.nodeId || c.targetPort in ports.inputs));
    break;
   }
   case 'connect': {
    const wire = op.connection;
    const source = graph.nodes[nodeAt(wire.sourceNodeId)], target = graph.nodes[nodeAt(wire.targetNodeId)];
    if (!source || !target) return reject('NOT_FOUND', 'Node not found', [wire.sourceNodeId, wire.targetNodeId]);
    const out = blueprintPorts(source).outputs[wire.sourcePort], input = blueprintPorts(target).inputs[wire.targetPort];
    if (!out || !input || out !== input) return reject('INVALID_INPUT', 'Blueprint ports do not match', [source.id, target.id]);
    if (graph.connections.some(c => c.id === wire.id)) return reject('INVALID_INPUT', 'Duplicate connection ID', [wire.id]);
    graph.connections = graph.connections.filter(c => out === 'flow'
     ? !(c.sourceNodeId === wire.sourceNodeId && c.sourcePort === wire.sourcePort)
     : !(c.targetNodeId === wire.targetNodeId && c.targetPort === wire.targetPort));
    graph.connections.push({ ...wire }); break;
   }
   case 'disconnect':
    if (!graph.connections.some(c => c.id === op.connectionId)) return reject('NOT_FOUND', 'Connection not found', [op.connectionId]);
    graph.connections = graph.connections.filter(c => c.id !== op.connectionId); break;
  }
 }
 const valid = BlueprintSetSchema.safeParse(next);
 return valid.success ? { ok: true, data: valid.data } : reject('INVALID_INPUT', 'Blueprint set exceeds its limits', []);
}
```

`blueprintPorts(...)` can return `undefined` for a port name; the `in` checks and the `!out` checks handle this. If `Reply` creates an import cycle through `types.ts`, import it as `import type` only.

- [ ] **Step 8: Update `schema.ts`, `types.ts`, and `index.ts`**

In `schema.ts`:

```ts
import { BlueprintSetSchema } from './blueprint';
import { BlueprintBatchSchema } from './blueprint-ops';
// ShowDocumentSchema
    blueprints: BlueprintSetSchema
// RuntimeFrameSchema: add
    blueprintRevision: u.optional(),
// AppStatusSchema: add
    blueprintRevision: u.optional(),
// clock
export const InputUpdateSchema = z.strictObject({
    events: z.array(z.strictObject({ kind: z.literal('keystroke'), accelerator: z.string().min(1).max(64) })).min(1).max(16)
});
// ClockEnvelopeSchema: add  input: InputUpdateSchema.optional()
export const BlueprintStatusSchema = z.strictObject({ graphId: IdSchema, kind: z.enum(['compile', 'runtime']), error: AppErrorSchema });
export const BlueprintInspectSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('snapshot'), revision: u, blueprints: BlueprintSetSchema, errors: z.array(BlueprintStatusSchema).max(16) }),
    z.strictObject({ kind: z.literal('delta'), revision: u, batches: z.array(BlueprintBatchSchema.extend({ revision: u })).max(32), errors: z.array(BlueprintStatusSchema).max(16) }),
]);
// ParamSchemas
    blueprintRun: z.strictObject({ graphId: IdSchema, triggerNodeId: IdSchema }),
    blueprintEdit: BlueprintBatchSchema,
    blueprintInspect: z.strictObject({ sinceRevision: u.optional() }),
// ResultSchemas
    blueprintEdit: z.strictObject({ revision: u, keystrokes: z.array(z.string().min(1).max(64)).max(64) }),
    blueprintInspect: BlueprintInspectSchema,
// MethodSchema: add "blueprintEdit", "blueprintInspect"
// requiredCapability: add method === "blueprintEdit" to the edit branch
```

The clock size rule in `parseEnvelope` (line 484) stays as it is. An input-only clock uses `LIMITS.clockBytes` (2048). 16 events of 64 characters fit inside that limit. Add an assertion for this case to the clock test.

In `types.ts`, update `AppApi` and `PublisherClient.onClock` to match the Interfaces block. Use the inferred schema types.

In `index.ts`, add `export * from './blueprint-nodes'; export * from './blueprint-ops';`. Also export the new names from `blueprint.ts` and `schema.ts`.

- [ ] **Step 9: Run the tests and confirm they pass.** Run: `pnpm vitest run --project unit packages/contracts`. Expected: PASS. Then run `pnpm check`. Expected: errors only in `packages/session`, `apps/desktop`, and `apps/mcp`, which use the removed `blueprintRun` shape and `executeBlueprint`. Later tasks fix those errors. List them in the report.

- [ ] **Step 10: Commit**

```bash
git add fixtures/protocol packages/contracts
git commit -m "feat(contracts): define interaction nodes, Blueprint operations, and clock input"
```

---

### Task 3: Compiler, flow executor, and runtime

**Files:**
- Rewrite: `packages/session/src/blueprint.ts`
- Create: `packages/session/src/blueprint-runtime.ts`
- Test: `packages/session/test/blueprint.test.ts` (rewrite), `packages/session/test/blueprint-runtime.test.ts` (create)

**Interfaces:**
- Consumes: `blueprintPorts`, `BlueprintSetSchema`, `keystrokeAccelerator` (Task 2).
- Produces:
  - `compileBlueprint(input: unknown): Reply<CompiledBlueprint>`
  - `BlueprintEffect = { kind: 'setVisibility'; entityId; visible } | { kind: 'toggleVisibility'; entityId } | { kind: 'selectCamera'; outputId; cameraId }`
  - `runFlow(compiled, start: { nodeId; port }, flip: ReadonlyMap<Id, boolean>, budget: FlowBudget, nowMs): Reply<FlowResult>`, with `FlowResult = { effects; delays: PendingDelay[]; flip: Map<Id, boolean> }`
  - `createBlueprintRuntime(): BlueprintRuntime` with:
    - `install(graphs: unknown): Reply<BlueprintGraph[]>`
    - `keystrokes(): string[]` (sorted and unique, from enabled graphs)
    - `step(events: BlueprintEvent[], nowMs): GraphRun[]`
  - `BlueprintEvent = { kind: 'manual'; graphId; nodeId } | { kind: 'keystroke'; accelerator }`
  - `GraphRun = { graphId; effects; error: AppError | null }`

- [ ] **Step 1: Write the failing compiler and executor tests.** Replace `packages/session/test/blueprint.test.ts` with:

```ts
import { expect, it } from 'vitest';
import { compileBlueprint, runFlow } from '../src/blueprint';

const node = (id: string, type: string, settings: object = {}) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 } });
const wire = (id: string, s: string, sp: string, t: string, tp: string) => ({ id, sourceNodeId: s, sourcePort: sp, targetNodeId: t, targetPort: tp });
const graph = (nodes: object[], connections: object[]) => ({ schemaVersion: 1, id: 'g', name: 'G', nodes, connections });
const budget = () => ({ visits: 256, effects: 64 });
const compiled = (g: unknown) => { const c = compileBlueprint(g); if (!c.ok) throw new Error(c.error.message); return c.data; };

it('routes If Branch by a lazily read condition', () => {
 const g = compiled(graph(
  [node('start', 'event.manual'), node('cond', 'value.boolean', { value: false }), node('if', 'flow.branch'),
   node('yes', 'scene.toggleVisibility', { entityId: 'marker' }), node('no', 'camera.switch', { outputId: 'output_main', cameraId: 'camera_close' })],
  [wire('1', 'start', 'flow', 'if', 'flow'), wire('2', 'cond', 'value', 'if', 'condition'), wire('3', 'if', 'true', 'yes', 'flow'), wire('4', 'if', 'false', 'no', 'flow')]));
 expect(runFlow(g, { nodeId: 'start', port: 'flow' }, new Map(), budget(), 0)).toMatchObject({ ok: true, data: { effects: [{ kind: 'selectCamera', outputId: 'output_main', cameraId: 'camera_close' }] } });
});

it('runs Sequence outputs depth-first in order', () => {
 const g = compiled(graph(
  [node('start', 'event.manual'), node('seq', 'flow.sequence', { outputs: 2 }), node('a', 'scene.toggleVisibility', { entityId: 'a' }), node('a2', 'scene.toggleVisibility', { entityId: 'a2' }), node('b', 'scene.toggleVisibility', { entityId: 'b' })],
  [wire('1', 'start', 'flow', 'seq', 'flow'), wire('2', 'seq', 'then0', 'a', 'flow'), wire('3', 'a', 'exit', 'a2', 'flow'), wire('4', 'seq', 'then1', 'b', 'flow')]));
 const run = runFlow(g, { nodeId: 'start', port: 'flow' }, new Map(), budget(), 0);
 expect(run.ok && run.data.effects.map(e => 'entityId' in e && e.entityId)).toEqual(['a', 'a2', 'b']);
});

it('alternates Flip Flop and exposes Is A, without mutating the input state', () => {
 const g = compiled(graph(
  [node('start', 'event.manual'), node('ff', 'flow.flipFlop'), node('set', 'scene.setVisibility', { entityId: 'marker' }), node('set2', 'scene.setVisibility', { entityId: 'marker' })],
  [wire('1', 'start', 'flow', 'ff', 'flow'), wire('2', 'ff', 'a', 'set', 'flow'), wire('3', 'ff', 'b', 'set2', 'flow'), wire('4', 'ff', 'isA', 'set', 'visible'), wire('5', 'ff', 'isA', 'set2', 'visible')]));
 const state = new Map<string, boolean>();
 const first = runFlow(g, { nodeId: 'start', port: 'flow' }, state, budget(), 0);
 expect(first).toMatchObject({ ok: true, data: { effects: [{ kind: 'setVisibility', visible: true }] } });
 expect(state.size).toBe(0);
 const second = runFlow(g, { nodeId: 'start', port: 'flow' }, first.ok ? first.data.flip : state, budget(), 0);
 expect(second).toMatchObject({ ok: true, data: { effects: [{ kind: 'setVisibility', visible: false }] } });
});

it('schedules Delay and stops the current flow there', () => {
 const g = compiled(graph(
  [node('start', 'event.manual'), node('wait', 'flow.delay', { seconds: 2 }), node('t', 'scene.toggleVisibility', { entityId: 'marker' })],
  [wire('1', 'start', 'flow', 'wait', 'flow'), wire('2', 'wait', 'exit', 't', 'flow')]));
 expect(runFlow(g, { nodeId: 'start', port: 'flow' }, new Map(), budget(), 500)).toMatchObject({ ok: true, data: { effects: [], delays: [{ nodeId: 'wait', dueMs: 2500 }] } });
 expect(runFlow(g, { nodeId: 'wait', port: 'exit' }, new Map(), budget(), 2500)).toMatchObject({ ok: true, data: { effects: [{ kind: 'toggleVisibility' }] } });
});

it('allows a flow cycle only through Delay and rejects data cycles', () => {
 const loop = [node('start', 'event.manual'), node('t', 'scene.toggleVisibility', { entityId: 'm' }), node('wait', 'flow.delay', { seconds: 1 })];
 expect(compileBlueprint(graph(loop, [wire('1', 'start', 'flow', 't', 'flow'), wire('2', 't', 'exit', 'wait', 'flow'), wire('3', 'wait', 'exit', 't', 'flow')])).ok).toBe(true);
 const immediate = [node('a', 'scene.toggleVisibility', { entityId: 'm' }), node('b', 'scene.toggleVisibility', { entityId: 'm' })];
 expect(compileBlueprint(graph(immediate, [wire('1', 'a', 'exit', 'b', 'flow'), wire('2', 'b', 'exit', 'a', 'flow')]))).toMatchObject({ ok: false, error: { message: 'Blueprint has an immediate cycle' } });
 const data = [node('n1', 'logic.not'), node('n2', 'logic.not')];
 expect(compileBlueprint(graph(data, [wire('1', 'n1', 'result', 'n2', 'value'), wire('2', 'n2', 'result', 'n1', 'value')])).ok).toBe(false);
});

it('accepts a Flip Flop Is A read inside its own flow chain', () => {
 const g = graph(
  [node('start', 'event.manual'), node('ff', 'flow.flipFlop'), node('if', 'flow.branch'), node('t', 'scene.toggleVisibility', { entityId: 'm' })],
  [wire('1', 'start', 'flow', 'ff', 'flow'), wire('2', 'ff', 'a', 'if', 'flow'), wire('3', 'ff', 'isA', 'if', 'condition'), wire('4', 'if', 'true', 't', 'flow')]);
 expect(compileBlueprint(g).ok).toBe(true);
});

it('enforces Warudo port multiplicity', () => {
 const nodes = [node('start', 'event.manual'), node('x', 'scene.toggleVisibility', { entityId: 'm' }), node('y', 'scene.toggleVisibility', { entityId: 'm' }), node('k', 'event.manual')];
 expect(compileBlueprint(graph(nodes, [wire('1', 'start', 'flow', 'x', 'flow'), wire('2', 'start', 'flow', 'y', 'flow')]))).toMatchObject({ ok: false, error: { ids: ['start'] } });
 expect(compileBlueprint(graph(nodes, [wire('1', 'start', 'flow', 'x', 'flow'), wire('2', 'k', 'flow', 'x', 'flow')])).ok).toBe(true);
});

it('rejects a missing data input but allows an unwired flow input', () => {
 expect(compileBlueprint(graph([node('set', 'scene.setVisibility', { entityId: 'm' })], []))).toMatchObject({ ok: false, error: { message: 'Blueprint input is not connected' } });
 expect(compileBlueprint(graph([node('t', 'scene.toggleVisibility', { entityId: 'm' })], [])).ok).toBe(true);
});

it('stops at the per-event visit limit and at the shared tick budget', () => {
 const nodes = [node('start', 'event.manual'), ...Array.from({ length: 70 }, (_, i) => node(`t${i}`, 'scene.toggleVisibility', { entityId: 'm' }))];
 const wires = [wire('w', 'start', 'flow', 't0', 'flow'), ...Array.from({ length: 69 }, (_, i) => wire(`w${i}`, `t${i}`, 'exit', `t${i + 1}`, 'flow'))];
 expect(runFlow(compiled(graph(nodes, wires)), { nodeId: 'start', port: 'flow' }, new Map(), { visits: 256, effects: 256 }, 0)).toMatchObject({ ok: false, error: { message: 'Blueprint run exceeded its flow limit' } });
 expect(runFlow(compiled(graph(nodes.slice(0, 4), wires.slice(0, 3))), { nodeId: 'start', port: 'flow' }, new Map(), { visits: 256, effects: 2 }, 0)).toMatchObject({ ok: false, error: { message: 'Blueprint run exceeded its operation limit' } });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `pnpm vitest run --project unit packages/session/test/blueprint.test.ts`. Expected: FAIL, because `runFlow` is not exported.

- [ ] **Step 3: Implement `packages/session/src/blueprint.ts`**

```ts
import { BlueprintGraphSchema, blueprintPorts, type BlueprintConnection, type BlueprintGraph, type BlueprintNode, type Id, type Reply } from '@opensekai/contracts';

export type BlueprintEffect =
 | { kind: 'setVisibility'; entityId: Id; visible: boolean }
 | { kind: 'toggleVisibility'; entityId: Id }
 | { kind: 'selectCamera'; outputId: Id; cameraId: Id };
export interface CompiledBlueprint { graph: BlueprintGraph; nodes: Map<Id, BlueprintNode>; dataIn: Map<string, BlueprintConnection>; flowNext: Map<string, BlueprintConnection> }
export interface PendingDelay { nodeId: Id; dueMs: number }
export interface FlowBudget { visits: number; effects: number }
export interface FlowResult { effects: BlueprintEffect[]; delays: PendingDelay[]; flip: Map<Id, boolean> }

const MAX_EVENT_VISITS = 64;
export const fail = (message: string, ids: string[] = []): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
const key = (nodeId: string, port: string) => `${nodeId}\0${port}`;

const cycleIn = (ids: Id[], edges: Map<Id, Id[]>): Id | null => {
 const visiting = new Set<Id>(), done = new Set<Id>();
 const visit = (id: Id): boolean => {
  if (visiting.has(id)) return false;
  if (done.has(id)) return true;
  visiting.add(id);
  for (const next of edges.get(id) ?? []) if (!visit(next)) return false;
  visiting.delete(id); done.add(id);
  return true;
 };
 return ids.find(id => !visit(id)) ?? null;
};

export function compileBlueprint(input: unknown): Reply<CompiledBlueprint> {
 const parsed = BlueprintGraphSchema.safeParse(input);
 if (!parsed.success) return fail('Invalid Blueprint document');
 const graph = parsed.data;
 const nodes = new Map(graph.nodes.map(node => [node.id, node]));
 const dataIn = new Map<string, BlueprintConnection>();
 const flowNext = new Map<string, BlueprintConnection>();
 const dataEdges = new Map<Id, Id[]>(), flowEdges = new Map<Id, Id[]>();
 const push = (edges: Map<Id, Id[]>, from: Id, to: Id) => edges.set(from, [...(edges.get(from) ?? []), to]);
 for (const connection of graph.connections) {
  const source = nodes.get(connection.sourceNodeId), target = nodes.get(connection.targetNodeId);
  if (!source || !target) return fail('Blueprint connection references a missing node', [connection.sourceNodeId, connection.targetNodeId]);
  const output = blueprintPorts(source).outputs[connection.sourcePort];
  const input = blueprintPorts(target).inputs[connection.targetPort];
  if (!output || !input || output !== input) return fail('Blueprint ports do not match', [source.id, target.id]);
  if (output === 'flow') {
   if (flowNext.has(key(source.id, connection.sourcePort))) return fail('Blueprint flow output has multiple connections', [source.id]);
   flowNext.set(key(source.id, connection.sourcePort), connection);
   if (source.type !== 'flow.delay') push(flowEdges, source.id, target.id);
  } else {
   if (dataIn.has(key(target.id, connection.targetPort))) return fail('Blueprint input has multiple connections', [target.id]);
   dataIn.set(key(target.id, connection.targetPort), connection);
   push(dataEdges, source.id, target.id);
  }
 }
 for (const node of graph.nodes)
  for (const [port, type] of Object.entries(blueprintPorts(node).inputs))
   if (type !== 'flow' && !dataIn.has(key(node.id, port))) return fail('Blueprint input is not connected', [node.id]);
 const ids = graph.nodes.map(node => node.id);
 const cycle = cycleIn(ids, dataEdges) ?? cycleIn(ids, flowEdges);
 if (cycle) return fail('Blueprint has an immediate cycle', [cycle]);
 return { ok: true, data: { graph, nodes, dataIn, flowNext } };
}

const readInput = (compiled: CompiledBlueprint, flip: ReadonlyMap<Id, boolean>, nodeId: Id, port: string): number | boolean => {
 const cache = new Map<string, number | boolean>();
 const evaluate = (id: Id, out: string): number | boolean => {
  const cached = cache.get(key(id, out));
  if (cached !== undefined) return cached;
  const node = compiled.nodes.get(id)!;
  const input = (name: string) => { const wire = compiled.dataIn.get(key(id, name))!; return evaluate(wire.sourceNodeId, wire.sourcePort); };
  let result: number | boolean;
  switch (node.type) {
   case 'value.number': case 'value.boolean': result = node.settings.value; break;
   case 'math.add': result = Number(input('a')) + Number(input('b')); break;
   case 'logic.greater': result = Number(input('a')) > Number(input('b')); break;
   case 'logic.not': result = !input('value'); break;
   case 'flow.flipFlop': result = flip.get(id) ?? false; break;
   default: throw new Error('Blueprint has an invalid data source');
  }
  if (typeof result === 'number' && !Number.isFinite(result)) throw new RangeError('Blueprint number is not finite');
  cache.set(key(id, out), result);
  return result;
 };
 const wire = compiled.dataIn.get(key(nodeId, port))!;
 return evaluate(wire.sourceNodeId, wire.sourcePort);
};

export function runFlow(compiled: CompiledBlueprint, start: { nodeId: Id; port: string }, state: ReadonlyMap<Id, boolean>, budget: FlowBudget, nowMs: number): Reply<FlowResult> {
 const flip = new Map(state);
 const effects: BlueprintEffect[] = [], delays: PendingDelay[] = [], stack: Id[] = [];
 const follow = (nodeId: Id, ports: string[]) => {
  for (const port of [...ports].reverse()) { const wire = compiled.flowNext.get(key(nodeId, port)); if (wire) stack.push(wire.targetNodeId); }
 };
 const emit = (node: BlueprintNode, effect: BlueprintEffect): Reply<never> | null => {
  if (--budget.effects < 0) return fail('Blueprint run exceeded its operation limit', [node.id]);
  effects.push(effect); follow(node.id, ['exit']); return null;
 };
 follow(start.nodeId, [start.port]);
 let visits = 0;
 while (stack.length > 0) {
  if (++visits > MAX_EVENT_VISITS || --budget.visits < 0) return fail('Blueprint run exceeded its flow limit', [start.nodeId]);
  const node = compiled.nodes.get(stack.pop()!)!;
  let failure: Reply<never> | null = null;
  try {
   switch (node.type) {
    case 'flow.branch': follow(node.id, [readInput(compiled, flip, node.id, 'condition') ? 'true' : 'false']); break;
    case 'flow.sequence': follow(node.id, Array.from({ length: node.settings.outputs }, (_, i) => `then${i}`)); break;
    case 'flow.flipFlop': { const isA = !(flip.get(node.id) ?? false); flip.set(node.id, isA); follow(node.id, [isA ? 'a' : 'b']); break; }
    case 'flow.delay': delays.push({ nodeId: node.id, dueMs: nowMs + node.settings.seconds * 1000 }); break;
    case 'scene.setVisibility': failure = emit(node, { kind: 'setVisibility', entityId: node.settings.entityId, visible: Boolean(readInput(compiled, flip, node.id, 'visible')) }); break;
    case 'scene.toggleVisibility': failure = emit(node, { kind: 'toggleVisibility', entityId: node.settings.entityId }); break;
    case 'camera.switch': failure = emit(node, { kind: 'selectCamera', outputId: node.settings.outputId, cameraId: node.settings.cameraId }); break;
    default: return fail('Blueprint flow reached a data node', [node.id]);
   }
  } catch { return fail('Blueprint data could not be evaluated', [node.id]); }
  if (failure) return failure;
 }
 return { ok: true, data: { effects, delays, flip } };
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.

- [ ] **Step 5: Write the failing runtime tests** in `packages/session/test/blueprint-runtime.test.ts`:

```ts
import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { createBlueprintRuntime } from '../src/blueprint-runtime';

const set = () => structuredClone(fixture.blueprints);
const J = { kind: 'keystroke' as const, accelerator: 'Control+Alt+KeyJ' };

it('fires matching keystroke nodes of enabled graphs and reports active accelerators', () => {
 const runtime = createBlueprintRuntime();
 expect(runtime.install(set()).ok).toBe(true);
 expect(runtime.keystrokes()).toEqual(fixture.expectedAccelerators);
 expect(runtime.step([{ kind: 'keystroke', accelerator: 'Control+Alt+KeyH' }], 0)).toEqual([{ graphId: 'toggle-performer', effects: [{ kind: 'toggleVisibility', entityId: 'performer' }], error: null }]);
 expect(runtime.step([{ kind: 'keystroke', accelerator: 'Shift+Super+KeyK' }], 0)).toEqual([]);
});

it('runs due delays before new events and only once', () => {
 const runtime = createBlueprintRuntime();
 runtime.install(set());
 expect(runtime.step([J], 1000)[0]!.effects).toEqual([{ kind: 'setVisibility', entityId: 'marker', visible: true }]);
 expect(runtime.step([], 2999)).toEqual([]);
 expect(runtime.step([], 3000)).toEqual([{ graphId: 'flash-marker', effects: [{ kind: 'setVisibility', entityId: 'marker', visible: false }], error: null }]);
 expect(runtime.step([], 9000)).toEqual([]);
});

it('keeps delays across a node move or rename but clears them on disable or a logic change', () => {
 const runtime = createBlueprintRuntime();
 runtime.install(set());
 runtime.step([J], 0);
 const moved = set(); moved[1]!.nodes[4]!.position = { x: 1, y: 1 }; moved[1]!.name = 'Renamed';
 runtime.install(moved);
 expect(runtime.step([], 2000)).toHaveLength(1);
 runtime.step([J], 3000);
 const disabled = set(); disabled[1]!.enabled = false;
 runtime.install(disabled);
 expect(runtime.step([], 9000)).toEqual([]);
 runtime.install(set());
 runtime.step([J], 10000);
 const changed = set(); changed[1]!.nodes[4]!.settings = { seconds: 5 };
 runtime.install(changed);
 expect(runtime.step([], 20000)).toEqual([]);
});

it('caps pending delays at 32 per graph and reports the overflow', () => {
 const runtime = createBlueprintRuntime();
 runtime.install(set());
 for (let i = 0; i < 32; i++) expect(runtime.step([J], i)[0]!.error).toBeNull();
 expect(runtime.step([J], 40)[0]!.error).toMatchObject({ message: 'Blueprint delay limit reached' });
});

it('rejects an invalid set atomically', () => {
 const runtime = createBlueprintRuntime();
 runtime.install(set());
 const bad = set(); bad[0]!.connections.push({ id: 'x', sourceNodeId: 'key', sourcePort: 'flow', targetNodeId: 'missing', targetPort: 'flow' });
 expect(runtime.install(bad).ok).toBe(false);
 expect(runtime.keystrokes()).toEqual(fixture.expectedAccelerators);
});

it('fires a manual trigger only on its enabled graph', () => {
 const runtime = createBlueprintRuntime();
 runtime.install([{ schemaVersion: 1, id: 'm', name: 'M', nodes: [{ id: 'go', version: 1, type: 'event.manual', settings: {}, position: { x: 0, y: 0 } }, { id: 't', version: 1, type: 'scene.toggleVisibility', settings: { entityId: 'marker' }, position: { x: 0, y: 0 } }], connections: [{ id: 'w', sourceNodeId: 'go', sourcePort: 'flow', targetNodeId: 't', targetPort: 'flow' }] }]);
 expect(runtime.step([{ kind: 'manual', graphId: 'm', nodeId: 'go' }], 0)[0]!.effects).toHaveLength(1);
 expect(runtime.step([{ kind: 'manual', graphId: 'other', nodeId: 'go' }], 0)).toEqual([]);
});
```

- [ ] **Step 6: Run the tests and confirm they fail.** Run: `pnpm vitest run --project unit packages/session/test/blueprint-runtime.test.ts`. Expected: FAIL.

- [ ] **Step 7: Implement `packages/session/src/blueprint-runtime.ts`**

```ts
import { BlueprintSetSchema, keystrokeAccelerator, type AppError, type BlueprintGraph, type Id, type Reply } from '@opensekai/contracts';
import { compileBlueprint, fail, runFlow, type BlueprintEffect, type CompiledBlueprint, type FlowBudget, type PendingDelay } from './blueprint';

export type BlueprintEvent = { kind: 'manual'; graphId: Id; nodeId: Id } | { kind: 'keystroke'; accelerator: string };
export interface GraphRun { graphId: Id; effects: BlueprintEffect[]; error: AppError | null }
export interface BlueprintRuntime { install(graphs: unknown): Reply<BlueprintGraph[]>; keystrokes(): string[]; step(events: BlueprintEvent[], nowMs: number): GraphRun[] }

interface Active { compiled: CompiledBlueprint; logic: string; flip: Map<Id, boolean>; delays: (PendingDelay & { order: number })[] }
const MAX_DELAYS = 32;
// Executable content only: positions and names do not reset runtime state.
const logicKey = (graph: BlueprintGraph) => JSON.stringify([graph.id, graph.enabled, graph.nodes.map(({ id, type, settings }) => [id, type, settings]), graph.connections]);

export function createBlueprintRuntime(): BlueprintRuntime {
 let active: Active[] = [];
 let order = 0;
 const run = (entry: Active, start: { nodeId: Id; port: string }, budget: FlowBudget, nowMs: number): GraphRun => {
  const graphId = entry.compiled.graph.id;
  const result = runFlow(entry.compiled, start, entry.flip, budget, nowMs);
  if (!result.ok) return { graphId, effects: [], error: result.error };
  if (entry.delays.length + result.data.delays.length > MAX_DELAYS) {
   const limit = fail('Blueprint delay limit reached', [graphId]);
   return { graphId, effects: [], error: limit.ok ? null : limit.error };
  }
  entry.flip = result.data.flip;
  entry.delays.push(...result.data.delays.map(delay => ({ ...delay, order: order++ })));
  return { graphId, effects: result.data.effects, error: null };
 };
 return {
  install(graphs) {
   const parsed = BlueprintSetSchema.safeParse(graphs);
   if (!parsed.success) return fail('Invalid Blueprint set');
   const next: Active[] = [];
   for (const graph of parsed.data) {
    const compiled = compileBlueprint(graph);
    if (!compiled.ok) return { ok: false, error: { ...compiled.error, ids: [graph.id, ...compiled.error.ids] } };
    const logic = logicKey(graph);
    const previous = graph.enabled ? active.find(entry => entry.logic === logic) : undefined;
    next.push({ compiled: compiled.data, logic, flip: previous?.flip ?? new Map(), delays: previous?.delays ?? [] });
   }
   active = next;
   return { ok: true, data: parsed.data };
  },
  keystrokes: () => [...new Set(active.filter(entry => entry.compiled.graph.enabled)
   .flatMap(entry => entry.compiled.graph.nodes.flatMap(node => node.type === 'event.keystroke' ? [keystrokeAccelerator(node.settings)] : [])))].sort(),
  step(events, nowMs) {
   const budget: FlowBudget = { visits: 256, effects: 64 };
   const runs: GraphRun[] = [];
   const due = active.flatMap(entry => entry.delays.filter(delay => delay.dueMs <= nowMs).map(delay => ({ entry, delay })))
    .sort((a, b) => a.delay.dueMs - b.delay.dueMs || a.delay.order - b.delay.order);
   for (const { entry, delay } of due) {
    entry.delays = entry.delays.filter(item => item !== delay);
    runs.push(run(entry, { nodeId: delay.nodeId, port: 'exit' }, budget, nowMs));
   }
   for (const event of events)
    for (const entry of active) {
     const graph = entry.compiled.graph;
     if (!graph.enabled) continue;
     for (const node of graph.nodes) {
      const matches = event.kind === 'manual'
       ? node.type === 'event.manual' && graph.id === event.graphId && node.id === event.nodeId
       : node.type === 'event.keystroke' && keystrokeAccelerator(node.settings) === event.accelerator;
      if (matches) runs.push(run(entry, { nodeId: node.id, port: 'flow' }, budget, nowMs));
     }
    }
   return runs;
  },
 };
}
```

- [ ] **Step 8: Run the session unit tests.** Run: `pnpm vitest run --project unit packages/session`. Expected: the new tests PASS. Tests that use the old `runBlueprint(graph, …)` FAIL until Task 4. List them in the report.

- [ ] **Step 9: Commit**

```bash
git add packages/session/src/blueprint.ts packages/session/src/blueprint-runtime.ts packages/session/test/blueprint.test.ts packages/session/test/blueprint-runtime.test.ts
git commit -m "feat(session): run event Blueprints with branch, sequence, flip flop, and delay"
```

---

### Task 4: Session store, journal, tick dispatch, and worker routes

**Files:**
- Create: `packages/session/src/blueprint-store.ts`, `packages/session/src/scene-ops.ts`
- Modify: `packages/session/src/session.ts`, `packages/session/src/worker.ts`, `packages/session/src/index.ts`, `packages/browser-client/src/client.ts`
- Test: `packages/session/test/blueprint-store.test.ts` (create), `packages/session/test/blueprint-session.test.ts` (create); update the existing tests that call the old `blueprintRun`; add a clock-input case to the browser-client tests

**Interfaces:**
- Consumes: `applyBlueprintOps`, `BlueprintBatchSchema`, `BlueprintInspect` (Task 2); `createBlueprintRuntime`, `compileBlueprint`, `BlueprintEffect` (Task 3).
- Produces:
  - `createBlueprintStore(runtime: BlueprintRuntime): BlueprintStore` with:
    - `edit(batch: unknown): Reply<{ revision; keystrokes }>`
    - `inspect(sinceRevision?: number, runtimeErrors?: ReadonlyMap<Id, AppError>): BlueprintInspect`
    - `revision(): number`
    - `active(graphId): BlueprintGraph | undefined`
  - `Session`:
    - `editBlueprints(batch: unknown): Reply<{ revision; keystrokes }>`
    - `inspectBlueprints(sinceRevision?: number): BlueprintInspect`
    - `runBlueprint(graphId, triggerNodeId): Reply<{ revision }>`
    - `advance(elapsedMs, trackingNowMs?, input?: InputUpdate): RuntimeFrame`. The frame carries `blueprintRevision`.
  - `applyOperations(scene, operations, generation): Reply<SceneView>`, `applyEffects(scene, effects): Reply<SceneView>`

- [ ] **Step 1: Write the failing store tests** in `packages/session/test/blueprint-store.test.ts`:

```ts
import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { createBlueprintRuntime } from '../src/blueprint-runtime';
import { createBlueprintStore } from '../src/blueprint-store';

const batch = (batchId: string, ops: object[]) => ({ clientId: 'c', batchId, ops });
const loaded = () => { const store = createBlueprintStore(createBlueprintRuntime()); store.edit(batch('load', [{ kind: 'replaceAll', graphs: fixture.blueprints }])); return store; };

it('applies batches in order, journals them, and returns active accelerators', () => {
 const store = loaded();
 expect(store.edit(batch('b2', [{ kind: 'updateGraph', graphId: 'toggle-performer', enabled: false }]))).toEqual({ ok: true, data: { revision: 2, keystrokes: ['Control+Alt+KeyJ'] } });
 expect(store.inspect(1)).toMatchObject({ kind: 'delta', revision: 2, batches: [{ revision: 2, batchId: 'b2' }], errors: [] });
 expect(store.inspect(2)).toMatchObject({ kind: 'delta', batches: [] });
});

it('answers with a snapshot outside the journal or across a whole-graph batch', () => {
 const store = loaded();
 expect(store.inspect(0)).toMatchObject({ kind: 'snapshot', revision: 1 });
 expect(store.inspect()).toMatchObject({ kind: 'snapshot' });
 // After load (revision 1) and 70 moves, revision is 71 and the journal holds revisions 8–71.
 for (let i = 0; i < 70; i++) store.edit(batch(`m${i}`, [{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: i, y: 0 } }]));
 expect(store.inspect(2)).toMatchObject({ kind: 'snapshot' });
 expect(store.inspect(30)).toMatchObject({ kind: 'snapshot' });
 expect(store.inspect(39)).toMatchObject({ kind: 'delta', revision: 71 });
});

it('keeps a document that does not compile, reports it, and keeps the last valid version active', () => {
 const store = loaded();
 const reply = store.edit(batch('cut', [{ kind: 'disconnect', graphId: 'flash-marker', connectionId: 'w2' }]));
 expect(reply).toMatchObject({ ok: true, data: { keystrokes: ['Control+Alt+KeyH', 'Control+Alt+KeyJ'] } });
 const view = store.inspect();
 expect(view.kind === 'snapshot' && view.blueprints[1]!.connections.map(c => c.id)).not.toContain('w2');
 expect(view.errors).toEqual([{ graphId: 'flash-marker', kind: 'compile', error: expect.objectContaining({ message: 'Blueprint input is not connected', ids: ['show'] }) }]);
 expect(store.active('flash-marker')!.connections.map(c => c.id)).toContain('w2');
 store.edit(batch('off', [{ kind: 'updateGraph', graphId: 'flash-marker', enabled: false }]));
 expect(store.active('flash-marker')!.enabled).toBe(false);
});

it('rejects a batch that names a missing node and does not advance the revision', () => {
 const store = loaded();
 expect(store.edit(batch('x', [{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'nope' }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(store.revision()).toBe(1);
});
```

The snapshot test expects three results:
- `inspect(2)` gives a snapshot, because revision 3 is no longer in the journal.
- `inspect(30)` gives a snapshot, because 41 batches is more than 32.
- `inspect(39)` gives a delta of exactly 32 batches.

- [ ] **Step 2: Write the failing session tests** in `packages/session/test/blueprint-session.test.ts`:

```ts
import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { makeSmokeScene } from '@opensekai/contracts';
import { createSession } from '../src/session';

type S = ReturnType<typeof createSession>;
const visible = (s: S, id: string) => s.inspect().entities.find(e => e.id === id)?.visible;
const press = (accelerator: string) => ({ events: [{ kind: 'keystroke' as const, accelerator }] });
const load = (s: S, graphs: unknown) => s.editBlueprints({ clientId: 't', batchId: crypto.randomUUID(), ops: [{ kind: 'replaceAll', graphs }] });

it('applies a hotkey on the next tick and reports the Blueprint revision on frames', () => {
 const session = createSession(makeSmokeScene(), 's');
 expect(load(session, fixture.blueprints)).toEqual({ ok: true, data: { revision: 1, keystrokes: fixture.expectedAccelerators } });
 session.advance(0);
 const frame = session.advance(16, 16, press('Control+Alt+KeyH'));
 expect(visible(session, 'performer')).toBe(false);
 expect(frame.scene.entities.find(e => e.id === 'performer')?.visible).toBe(false);
 expect(frame.blueprintRevision).toBe(1);
 expect(session.inspect().revision).toBe(1);
});

it('applies a delayed effect from session time', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, fixture.blueprints);
 session.advance(0);
 session.advance(100, 100, press('Control+Alt+KeyJ'));
 session.advance(2099);
 expect(visible(session, 'marker')).toBe(true);
 session.advance(2100);
 expect(visible(session, 'marker')).toBe(false);
});

it('keeps the last valid version firing while the document does not compile', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, fixture.blueprints);
 session.editBlueprints({ clientId: 't', batchId: 'cut', ops: [{ kind: 'removeNode', graphId: 'toggle-performer', nodeId: 'toggle' }, { kind: 'addNode', graphId: 'toggle-performer', node: { id: 'set', version: 1, type: 'scene.setVisibility', settings: { entityId: 'performer' }, position: { x: 0, y: 0 } } }] });
 session.advance(0);
 session.advance(16, 16, press('Control+Alt+KeyH'));
 expect(visible(session, 'performer')).toBe(false);
 expect(session.inspectBlueprints().errors).toEqual([expect.objectContaining({ graphId: 'toggle-performer', kind: 'compile' })]);
});

it('isolates a graph whose target entity was removed and records a runtime error', () => {
 const session = createSession(makeSmokeScene(), 's');
 const graphs = structuredClone(fixture.blueprints);
 graphs[1]!.nodes[0]!.settings = { code: 'KeyH', control: true, alt: true, shift: false, meta: false };
 graphs[1]!.nodes[3]!.settings = { entityId: 'gone' };
 load(session, graphs);
 session.advance(0);
 session.advance(16, 16, press('Control+Alt+KeyH'));
 expect(visible(session, 'performer')).toBe(false);
 expect(session.inspectBlueprints().errors).toEqual([{ graphId: 'flash-marker', kind: 'runtime', error: expect.objectContaining({ code: 'NOT_FOUND', ids: ['gone'] }) }]);
});

it('does not advance the scene revision when effects change nothing', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, [{ schemaVersion: 1, id: 'm', name: 'M', nodes: [
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: { x: 0, y: 0 } },
  { id: 'on', version: 1, type: 'value.boolean', settings: { value: true }, position: { x: 0, y: 0 } },
  { id: 'set', version: 1, type: 'scene.setVisibility', settings: { entityId: 'marker' }, position: { x: 0, y: 0 } },
 ], connections: [
  { id: 'a', sourceNodeId: 'go', sourcePort: 'flow', targetNodeId: 'set', targetPort: 'flow' },
  { id: 'b', sourceNodeId: 'on', sourcePort: 'value', targetNodeId: 'set', targetPort: 'visible' },
 ] }]);
 expect(session.runBlueprint('m', 'go')).toEqual({ ok: true, data: { revision: 0 } });
 expect(session.inspect().revision).toBe(0);
});

it('switches an output camera and rejects a run on a missing graph', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, [{ schemaVersion: 1, id: 'cam', name: 'Cam', nodes: [
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: { x: 0, y: 0 } },
  { id: 'cut', version: 1, type: 'camera.switch', settings: { outputId: 'output_main', cameraId: 'camera_close' }, position: { x: 0, y: 0 } },
 ], connections: [{ id: 'a', sourceNodeId: 'go', sourcePort: 'flow', targetNodeId: 'cut', targetPort: 'flow' }] }]);
 expect(session.runBlueprint('cam', 'go')).toEqual({ ok: true, data: { revision: 1 } });
 expect(session.inspect().outputs.find(o => o.id === 'output_main')?.cameraId).toBe('camera_close');
 expect(session.runBlueprint('nope', 'go')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});
```

- [ ] **Step 3: Run the tests and confirm they fail.** Run: `pnpm vitest run --project unit packages/session/test/blueprint-store.test.ts packages/session/test/blueprint-session.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement `blueprint-store.ts`**

```ts
import { applyBlueprintOps, BlueprintBatchSchema, type AppError, type BlueprintBatch, type BlueprintGraph, type BlueprintInspect, type Id, type Reply } from '@opensekai/contracts';
import { compileBlueprint, fail } from './blueprint';
import type { BlueprintRuntime } from './blueprint-runtime';

const JOURNAL = 64, DELTA = 32;
export interface BlueprintStore {
 edit(batch: unknown): Reply<{ revision: number; keystrokes: string[] }>;
 inspect(sinceRevision?: number, runtimeErrors?: ReadonlyMap<Id, AppError>): BlueprintInspect;
 revision(): number;
 active(graphId: Id): BlueprintGraph | undefined;
}

export function createBlueprintStore(runtime: BlueprintRuntime): BlueprintStore {
 let documents: BlueprintGraph[] = [], revision = 0;
 let journal: (BlueprintBatch & { revision: number })[] = [];
 const valid = new Map<Id, BlueprintGraph>();
 const compileErrors = new Map<Id, AppError>();
 const activeSet = () => documents.flatMap(doc => { const last = valid.get(doc.id); return last ? [{ ...last, enabled: doc.enabled }] : []; });
 return {
  edit(input) {
   const batch = BlueprintBatchSchema.safeParse(input);
   if (!batch.success) return fail('Invalid Blueprint batch');
   if (!Number.isSafeInteger(revision + 1)) return fail('Revision limit reached');
   const next = applyBlueprintOps(documents, batch.data.ops);
   if (!next.ok) return next;
   documents = next.data;
   for (const id of [...valid.keys()]) if (!documents.some(doc => doc.id === id)) { valid.delete(id); compileErrors.delete(id); }
   for (const doc of documents) {
    const compiled = compileBlueprint(doc);
    if (compiled.ok) { valid.set(doc.id, compiled.data.graph); compileErrors.delete(doc.id); }
    else compileErrors.set(doc.id, compiled.error);
   }
   const installed = runtime.install(activeSet());
   if (!installed.ok) return installed;
   revision += 1;
   journal = [...journal, { ...batch.data, revision }].slice(-JOURNAL);
   return { ok: true, data: { revision, keystrokes: runtime.keystrokes() } };
  },
  inspect(since, runtimeErrors = new Map()) {
   const errors = [
    ...[...compileErrors].map(([graphId, error]) => ({ graphId, kind: 'compile' as const, error })),
    ...[...runtimeErrors].filter(([graphId]) => documents.some(doc => doc.id === graphId)).map(([graphId, error]) => ({ graphId, kind: 'runtime' as const, error })),
   ].slice(0, 16);
   const oldest = journal[0]?.revision ?? revision + 1;
   const range = since === undefined ? [] : journal.filter(entry => entry.revision > since);
   const delta = since !== undefined && since <= revision && since >= oldest - 1 && range.length <= DELTA
    && !range.some(entry => entry.ops.some(op => op.kind === 'replaceAll' || op.kind === 'createGraph'));
   return delta
    ? { kind: 'delta', revision, batches: structuredClone(range), errors }
    : { kind: 'snapshot', revision, blueprints: structuredClone(documents), errors };
  },
  revision: () => revision,
  active: graphId => { const doc = documents.find(item => item.id === graphId); const last = valid.get(graphId); return doc && last ? { ...last, enabled: doc.enabled } : undefined; },
 };
}
```

- [ ] **Step 5: Create `scene-ops.ts` and update `session.ts`.**

`scene-ops.ts`:
- Move the operation loop of `applyPatch` (`session.ts` lines 69–88 at commit `c59b7de`) into `applyOperations(scene, operations, generation)` without behavior changes. Replace `persistent.revision + 1` with `generation`.
- Add `applyEffects`:

```ts
export function applyEffects(scene: SceneView, effects: BlueprintEffect[]): Reply<SceneView> {
 let next = structuredClone(scene);
 for (const effect of effects) {
  if (effect.kind === 'selectCamera') {
   const output = next.outputs.find(item => item.id === effect.outputId);
   if (!output) return failure('NOT_FOUND', 'Output not found', [effect.outputId]);
   if (!next.entities.some(entity => entity.id === effect.cameraId && entity.kind === 'camera')) return failure('NOT_FOUND', 'Camera not found', [effect.cameraId]);
   output.cameraId = effect.cameraId;
   continue;
  }
  const entity = next.entities.find(item => item.id === effect.entityId);
  if (!entity) return failure('NOT_FOUND', 'Entity not found', [effect.entityId]);
  const applied = applyOperations(next, [{ kind: 'setVisibility', entityId: effect.entityId, visible: effect.kind === 'toggleVisibility' ? !entity.visible : effect.visible }], next.revision);
  if (!applied.ok) return applied;
  next = applied.data;
 }
 return { ok: true, data: next };
}
```

In `session.ts`:

```ts
    const runtime = createBlueprintRuntime();
    const store = createBlueprintStore(runtime);
    const runtimeErrors = new Map<Id, AppError>();
    const applyRuns = (runs: GraphRun[]): Reply<{ revision: number }> => {
        let working = structuredClone(persistent);
        let firstError: AppError | null = null;
        for (const run of runs) {
            const next = run.error ? null : applyEffects(working, run.effects);
            const error = run.error ?? (next && !next.ok ? next.error : null);
            if (error) { runtimeErrors.set(run.graphId, error); firstError ??= error; continue; }
            runtimeErrors.delete(run.graphId);
            if (next?.ok) working = next.data;
        }
        const changed = JSON.stringify(working) !== JSON.stringify(persistent);
        const committed = changed ? commit(working) : { ok: true as const, data: { revision: persistent.revision } };
        return firstError ? { ok: false, error: firstError } : committed;
    };
// api:
        editBlueprints: batch => store.edit(batch),
        inspectBlueprints: since => store.inspect(since, runtimeErrors),
        runBlueprint(graphId, triggerNodeId) {
            const graph = store.active(graphId);
            if (!graph) return failure('NOT_FOUND', 'Blueprint not found', [graphId]);
            if (!graph.enabled) return failure('INVALID_INPUT', 'Blueprint is disabled', [graphId]);
            if (!graph.nodes.some(node => node.id === triggerNodeId && node.type === 'event.manual')) return failure('INVALID_INPUT', 'Manual trigger not found', [triggerNodeId]);
            return applyRuns(runtime.step([{ kind: 'manual', graphId, nodeId: triggerNodeId }], elapsed));
        },
```

`applyPatch` becomes `applyOperations(persistent, value.operations, persistent.revision + 1)` followed by `commit`. In `advance`, after the monotonic guard and before `adapter.evaluate`:

```ts
            applyRuns(runtime.step(input?.events.map(event => ({ kind: 'keystroke' as const, accelerator: event.accelerator })) ?? [], elapsedMs));
```

Add `blueprintRevision: store.revision()` to the returned frame. Update the `Session` interface. A failed `commit` because of the revision limit is not a hidden success: `applyRuns` returns `commit`'s failure.

- [ ] **Step 6: Update the worker and the browser client**

`worker.ts`:

```ts
                        case "blueprintRun": return session.runBlueprint(call.params.graphId, call.params.triggerNodeId);
                        case "blueprintEdit": return session.editBlueprints(call.params);
                        case "blueprintInspect": return { ok: true, data: session.inspectBlueprints(call.params.sinceRevision) };
// onClock gets a third parameter and passes it on:
                removeClock = client.onClock((elapsedMs, tracking, input) => { /* guards unchanged */ client.publishFrame(session.advance(elapsedMs - origin, elapsedMs, input)); });
```

`packages/browser-client/src/client.ts`: `pendingClock` and the listener type carry `input?: InputUpdate`. `deliverClock` keeps the current argument count when the input is absent:

```ts
const deliverClock = (listener: ClockListener, clock: PendingClock) =>
  clock.input !== undefined ? listener(clock.elapsedMs, clock.tracking, clock.input)
  : clock.tracking !== undefined ? listener(clock.elapsedMs, clock.tracking)
  : listener(clock.elapsedMs);
```

Add a browser-client test: a clock message with `input` reaches the listener as its third argument.

- [ ] **Step 7: Fix the old call sites.** In each test that used `runBlueprint(graph, id)` or the `blueprintRun` `graph` parameter, load the graph with `editBlueprints({ …, ops: [{ kind: 'replaceAll', graphs: [graph] }] })`. Then call `runBlueprint(graph.id, id)`. Delete the assertions that a draft runs.

- [ ] **Step 8: Run the tests.** Run: `pnpm vitest run --project unit packages/session packages/browser-client`. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/session packages/browser-client
git commit -m "feat(session): own Blueprint documents with an operation journal and dispatch hotkeys"
```

---

### Task 5: Rust contracts and show validation

**Files:**
- Modify: `crates/contracts/src/lib.rs`, `apps/desktop/src-tauri/src/show.rs`
- Test: `crates/contracts/tests/blueprint.rs`, the unit tests in `show.rs`, and `apps/desktop/src-tauri/tests/service_integration.rs` (the existing `blueprint_run_…` test changes to the new params)

**Interfaces:**
- Produces:
  - `pub fn validate_blueprint_graph(&Value) -> Result<(), AppError>`
  - `pub fn validate_blueprint_set(&[Value]) -> Result<(), AppError>`
  - `pub fn validate_blueprint_ops(&[Value]) -> Result<(), AppError>`
  - `pub struct InputUpdate { pub events: Vec<InputEvent> }` and `pub enum InputEvent { Keystroke { accelerator: String } }`, with serde tag `kind`
  - `WireMessage::Clock.input: Option<InputUpdate>`
  - `RuntimeFrame.blueprint_revision: Option<u64>` and `AppStatus.blueprint_revision: Option<u64>`, both serialized as `blueprintRevision` and skipped when `None`
  - `pub struct BlueprintEditResult { pub revision: u64, pub keystrokes: Vec<String> }`, public so the router can read it

- [ ] **Step 1: Write the failing tests** in `crates/contracts/tests/blueprint.rs`. Replace the old `blueprint_run…` test:

```rust
use opensekai_contracts::*;
use serde_json::{json, Value};

fn set() -> Value {
    let f: Value = serde_json::from_str(include_str!("../../../fixtures/protocol/blueprint-set.json")).unwrap();
    f["blueprints"].clone()
}
fn edit(ops: Value) -> Value { json!({"clientId":"c","batchId":"b","ops":ops}) }

#[test]
fn blueprint_edit_validates_operation_structure_only() {
    assert!(validate_call("blueprintEdit", &edit(json!([{"kind":"replaceAll","graphs":set()}]))).is_ok());
    assert!(validate_call("blueprintEdit", &edit(json!([]))).is_err());
    assert!(validate_call("blueprintEdit", &edit(json!(vec![json!({"kind":"removeGraph","graphId":"g"}); 65]))).is_err());
    assert!(validate_call("blueprintEdit", &edit(json!([{"kind":"teleport","graphId":"g"}]))).is_err());
    assert!(validate_call("blueprintEdit", &edit(json!([{"kind":"addNode","graphId":"g","node":{"id":"n","version":1,"type":"prop.throw","settings":{},"position":{"x":0,"y":0}}}]))).is_ok());
    assert!(validate_call("blueprintEdit", &edit(json!([{"kind":"addNode","graphId":"g","node":{"id":"n","version":1,"type":"Bad Type!","settings":{},"position":{"x":0,"y":0}}}]))).is_err());
    assert!(validate_call("blueprintEdit", &edit(json!([{"kind":"moveNode","graphId":"g","nodeId":"n","position":{"x":0,"y":0}}]))).is_ok());
    let mut nine = vec![];
    for i in 0..9 { let mut g = set()[0].clone(); g["id"] = json!(format!("g{i}")); nine.push(g); }
    assert!(validate_call("blueprintEdit", &edit(json!([{"kind":"replaceAll","graphs":nine}]))).is_err());
}

#[test]
fn blueprint_inspect_run_and_results_validate() {
    assert!(validate_call("blueprintInspect", &json!({})).is_ok());
    assert!(validate_call("blueprintInspect", &json!({"sinceRevision":3})).is_ok());
    assert!(validate_call("blueprintRun", &json!({"graphId":"g","triggerNodeId":"n"})).is_ok());
    assert!(validate_call("blueprintRun", &json!({"graph":{},"triggerNodeId":"n"})).is_err());
    assert!(validate_result("blueprintEdit", &json!({"ok":true,"data":{"revision":1,"keystrokes":["Control+Alt+KeyH"]}})).is_ok());
    assert!(validate_result("blueprintEdit", &json!({"ok":true,"data":{"revision":1,"keystrokes":vec!["Control+KeyA"; 65]}})).is_err());
    assert!(validate_result("blueprintInspect", &json!({"ok":true,"data":{"kind":"snapshot","revision":1,"blueprints":set(),"errors":[]}})).is_ok());
    assert!(validate_result("blueprintInspect", &json!({"ok":true,"data":{"kind":"delta","revision":2,"batches":[{"revision":2,"clientId":"c","batchId":"b","ops":[{"kind":"removeGraph","graphId":"g"}]}],"errors":[]}})).is_ok());
}

#[test]
fn clock_carries_at_most_sixteen_keystrokes_within_the_plain_clock_limit() {
    let long = format!("Control+Alt+Shift+Super+{}", "K".repeat(40));
    let event = json!({"kind":"keystroke","accelerator":long});
    let ok = json!({"kind":"clock","sessionId":"s","elapsedMs":1,"input":{"events": vec![event.clone(); 16]}});
    assert!(parse_wire(ok.to_string().as_bytes()).is_ok());
    let over = json!({"kind":"clock","sessionId":"s","elapsedMs":1,"input":{"events": vec![event; 17]}});
    assert!(parse_wire(over.to_string().as_bytes()).is_err());
}
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `cargo test -p opensekai-contracts --test blueprint`. Expected: FAIL.

- [ ] **Step 3: Implement the changes in `lib.rs`**

```rust
object!(BlueprintRunParams { graph_id: Id, trigger_node_id: Id });
object!(BlueprintEditParams { client_id: Id, batch_id: Id, ops: Vec<Value> });
object!(BlueprintEditResult { revision: u64, keystrokes: Vec<String> });

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum InputEvent { Keystroke { accelerator: String } }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputUpdate { pub events: Vec<InputEvent> }
impl InputUpdate {
    pub fn validate(&self) -> Result<(), AppError> {
        require((1..=16).contains(&self.events.len()), "invalid input event count")?;
        for InputEvent::Keystroke { accelerator } in &self.events {
            require(!accelerator.is_empty() && accelerator.chars().count() <= 64, "invalid accelerator")?;
        }
        Ok(())
    }
}

fn id_ok(value: &Value) -> bool { value.as_str().is_some_and(|s| !s.is_empty() && s.chars().count() <= 256) }
fn port_ok(value: &Value) -> bool { value.as_str().is_some_and(|s| !s.is_empty() && s.chars().count() <= 64) }
fn node_type_ok(value: &str) -> bool {
    let part = |p: Option<&str>| p.is_some_and(|p| p.starts_with(|c: char| c.is_ascii_lowercase()) && p.chars().all(|c| c.is_ascii_alphanumeric()));
    let mut parts = value.split('.');
    value.len() <= 64 && part(parts.next()) && part(parts.next()) && parts.next().is_none()
}
fn keys_within(value: &Value, allowed: &[&str]) -> bool { value.as_object().is_some_and(|o| o.keys().all(|k| allowed.contains(&k.as_str()))) }
fn position_ok(value: &Value) -> bool { keys_within(value, &["x", "y"]) && ["x", "y"].iter().all(|a| value[*a].as_f64().is_some_and(f64::is_finite)) }

pub fn validate_blueprint_node(node: &Value) -> Result<(), AppError> {
    require(keys_within(node, &["id", "version", "type", "settings", "position"]) && id_ok(&node["id"]) && node["version"].as_u64() == Some(1)
        && position_ok(&node["position"]) && node["type"].as_str().is_some_and(node_type_ok)
        && node["settings"].as_object().is_some_and(|s| s.len() <= 16), "Invalid Blueprint node")
}
pub fn validate_blueprint_connection(c: &Value) -> Result<(), AppError> {
    require(keys_within(c, &["id", "sourceNodeId", "sourcePort", "targetNodeId", "targetPort"]) && id_ok(&c["id"])
        && id_ok(&c["sourceNodeId"]) && id_ok(&c["targetNodeId"]) && port_ok(&c["sourcePort"]) && port_ok(&c["targetPort"]), "Invalid Blueprint connection")
}
pub fn validate_blueprint_graph(graph: &Value) -> Result<(), AppError> {
    require(keys_within(graph, &["schemaVersion", "id", "name", "enabled", "nodes", "connections"]), "Invalid Blueprint graph")?;
    require(graph["schemaVersion"].as_u64() == Some(1), "unsupported Blueprint version")?;
    require(id_ok(&graph["id"]) && graph["name"].as_str().is_some_and(|n| !n.trim().is_empty() && n.chars().count() <= 128)
        && (graph.get("enabled").is_none() || graph["enabled"].is_boolean()), "Invalid Blueprint graph")?;
    let nodes = graph["nodes"].as_array().filter(|n| n.len() <= 128).ok_or_else(|| invalid("invalid Blueprint nodes"))?;
    let connections = graph["connections"].as_array().filter(|c| c.len() <= 256).ok_or_else(|| invalid("invalid Blueprint connections"))?;
    let mut ids = std::collections::HashSet::new();
    for node in nodes { validate_blueprint_node(node)?; require(ids.insert(node["id"].as_str().unwrap_or_default()), "Duplicate node ID")?; }
    let mut wires = std::collections::HashSet::new();
    for c in connections { validate_blueprint_connection(c)?; require(wires.insert(c["id"].as_str().unwrap_or_default()), "Duplicate connection ID")?; }
    Ok(())
}
pub fn validate_blueprint_set(values: &[Value]) -> Result<(), AppError> {
    require(values.len() <= 8, "too many Blueprints")?;
    let mut ids = std::collections::HashSet::new();
    for graph in values { validate_blueprint_graph(graph)?; require(ids.insert(graph["id"].as_str().unwrap_or_default()), "duplicate Blueprint ID")?; }
    Ok(())
}
pub fn validate_blueprint_ops(ops: &[Value]) -> Result<(), AppError> {
    require((1..=64).contains(&ops.len()), "invalid Blueprint batch size")?;
    for op in ops {
        let ok = match op["kind"].as_str() {
            Some("replaceAll") => keys_within(op, &["kind", "graphs"]) && op["graphs"].as_array().is_some_and(|g| validate_blueprint_set(g).is_ok()),
            Some("createGraph") => keys_within(op, &["kind", "graph"]) && validate_blueprint_graph(&op["graph"]).is_ok(),
            Some("removeGraph") => keys_within(op, &["kind", "graphId"]) && id_ok(&op["graphId"]),
            Some("updateGraph") => keys_within(op, &["kind", "graphId", "name", "enabled"]) && id_ok(&op["graphId"]),
            Some("addNode") => keys_within(op, &["kind", "graphId", "node"]) && id_ok(&op["graphId"]) && validate_blueprint_node(&op["node"]).is_ok(),
            Some("removeNode") => keys_within(op, &["kind", "graphId", "nodeId"]) && id_ok(&op["graphId"]) && id_ok(&op["nodeId"]),
            Some("moveNode") => keys_within(op, &["kind", "graphId", "nodeId", "position"]) && id_ok(&op["graphId"]) && id_ok(&op["nodeId"]) && position_ok(&op["position"]),
            Some("setNodeSettings") => keys_within(op, &["kind", "graphId", "nodeId", "settings"]) && id_ok(&op["graphId"]) && id_ok(&op["nodeId"]) && op["settings"].as_object().is_some_and(|s| s.len() <= 16),
            Some("connect") => keys_within(op, &["kind", "graphId", "connection"]) && id_ok(&op["graphId"]) && validate_blueprint_connection(&op["connection"]).is_ok(),
            Some("disconnect") => keys_within(op, &["kind", "graphId", "connectionId"]) && id_ok(&op["graphId"]) && id_ok(&op["connectionId"]),
            _ => false,
        };
        require(ok, "Invalid Blueprint operation")?;
    }
    Ok(())
}
```

`validate_call`:
- `"blueprintRun"` → `decode::<BlueprintRunParams>`
- `"blueprintEdit"` → `validate_blueprint_ops(&decode::<BlueprintEditParams>(params)?.ops)`
- `"blueprintInspect"` → the params are an object with only an optional `sinceRevision`, a `u64`

`validate_result`:
- `"blueprintEdit"` → decode `BlueprintEditResult`; at most 64 keystrokes, each 1–64 characters
- `"blueprintInspect"`: for `kind: "snapshot"`, call `validate_blueprint_set`; for `kind: "delta"`, allow at most 32 batches, each with `revision`, `clientId`, `batchId`, and ops checked by `validate_blueprint_ops`. In both cases, allow at most 16 `errors`, each `{graphId, kind: "compile"|"runtime", error: AppError}`.

Add both methods to the `known` list. Add `input` to `WireMessage::Clock` with `#[serde(default, skip_serializing_if = "Option::is_none")]`, and validate it in `parse_wire`. The size rule stays as it is. The test proves that 16 long events fit under `MAX_CLOCK_BYTES`. If it fails, raise `MAX_CLOCK_BYTES` and the TypeScript `LIMITS.clockBytes` together to 4096. Add `blueprint_revision` to the Rust `RuntimeFrame` and `AppStatus`. Update every `WireMessage::Clock { … }` site; the compiler lists them.

- [ ] **Step 4: Change `show.rs` to the shared validator.** Replace the typed graph structs and `validate_graph` with `blueprints: Vec<Value>` and `opensekai_contracts::validate_blueprint_set(&show.blueprints)?`. Update the show tests:
  - The test that rejected `"extra": true` in node settings must now expect acceptance. TypeScript `ShowDocumentSchema` rejects that node after Open. Rename the test to `show_accepts_unknown_settings_and_leaves_semantics_to_typescript`.
  - Add a case: 9 graphs are rejected.
  - Add a case: a graph that omits `enabled` is accepted.
- [ ] **Step 5: Update `service_integration.rs`'s `blueprint_run_reaches_the_session_publisher_and_returns_revision`** to send `{"graphId":"draft","triggerNodeId":"start"}`.
- [ ] **Step 6: Run the Rust tests.** Run: `cargo test -p opensekai-contracts` and `cargo test -p opensekai-desktop`. Expected: PASS.
- [ ] **Step 7: Commit** with `git commit -m "feat(contracts): validate Blueprint operations structurally and carry clock input"`.

---

### Task 6: Native global keystrokes

**Files:**
- Create: `apps/desktop/src-tauri/src/input.rs`, `apps/desktop/src-tauri/tests/keystroke_integration.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/src/service/mod.rs`, `apps/desktop/src-tauri/src/service/router.rs`, `apps/desktop/src-tauri/Cargo.toml`, `Cargo.lock`, `docs/dependencies.md`

**Interfaces:**
- Consumes: `InputUpdate`, `InputEvent`, `BlueprintEditResult` (Task 5).
- Produces:
  - `pub trait KeystrokeRegistrar: Send + Sync { fn reconcile(&self, wanted: &BTreeSet<String>) -> Vec<String>; }`. The return value lists the accelerators that failed.
  - `ServicePorts::set_keystroke_registrar(&self, Arc<dyn KeystrokeRegistrar>)` and `ServicePorts::push_keystroke(&self, String)`
  - `pub mod input` exported from the desktop lib

- [ ] **Step 1: Write the failing unit tests** in `input.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn latch_fires_once_per_physical_press() {
        let mut latch = KeyLatch::default();
        assert!(latch.press(7));
        assert!(!latch.press(7));
        latch.release(7);
        assert!(latch.press(7));
    }
    #[test]
    fn queue_drops_oldest_and_drains_sixteen_per_clock() {
        let mut q = InputQueue::default();
        for i in 0..70 { q.push(format!("Control+F{}", i % 24 + 1)); }
        let first = q.drain().unwrap();
        assert_eq!(first.events.len(), 16);
        assert_eq!(first.events[0], InputEvent::Keystroke { accelerator: "Control+F7".into() });
        let mut total = 16;
        while let Some(u) = q.drain() { total += u.events.len(); }
        assert_eq!(total, 64);
    }
    #[test]
    fn every_allowed_code_parses_as_a_global_shortcut() {
        let codes: Vec<String> = serde_json::from_str(include_str!("../../../../fixtures/protocol/keystroke-codes.json")).unwrap();
        for code in codes {
            let accelerator = format!("Control+Alt+Shift+Super+{code}");
            assert!(accelerator.parse::<tauri_plugin_global_shortcut::Shortcut>().is_ok(), "{accelerator}");
        }
    }
}
```

- [ ] **Step 2: Add the plugin dependency.** Run `cargo search tauri-plugin-global-shortcut --limit 1`. Pin the latest 2.x version exactly in `apps/desktop/src-tauri/Cargo.toml`, next to `tauri-plugin-dialog`, for example `tauri-plugin-global-shortcut = "=<printed version>"`. Run `cargo build -p opensekai-desktop`. Record the version in `docs/dependencies.md`.
- [ ] **Step 3: Run the tests and confirm they fail.** Run: `cargo test -p opensekai-desktop --lib input`. Expected: FAIL.
- [ ] **Step 4: Implement `input.rs`**

```rust
use opensekai_contracts::{InputEvent, InputUpdate};
use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::Mutex;

pub const QUEUE_CAPACITY: usize = 64;
pub const EVENTS_PER_CLOCK: usize = 16;

pub trait KeystrokeRegistrar: Send + Sync {
    fn reconcile(&self, wanted: &BTreeSet<String>) -> Vec<String>;
}
pub struct NoKeystrokes;
impl KeystrokeRegistrar for NoKeystrokes {
    fn reconcile(&self, _: &BTreeSet<String>) -> Vec<String> { vec![] }
}

#[derive(Default)]
pub struct KeyLatch(HashSet<u32>);
impl KeyLatch {
    pub fn press(&mut self, id: u32) -> bool { self.0.insert(id) }
    pub fn release(&mut self, id: u32) { self.0.remove(&id); }
}

#[derive(Default)]
pub struct InputQueue(VecDeque<String>);
impl InputQueue {
    pub fn push(&mut self, accelerator: String) {
        if self.0.len() == QUEUE_CAPACITY { self.0.pop_front(); }
        self.0.push_back(accelerator);
    }
    pub fn drain(&mut self) -> Option<InputUpdate> {
        let n = self.0.len().min(EVENTS_PER_CLOCK);
        (n > 0).then(|| InputUpdate { events: self.0.drain(..n).map(|accelerator| InputEvent::Keystroke { accelerator }).collect() })
    }
}

fn locked<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> { m.lock().unwrap_or_else(std::sync::PoisonError::into_inner) }

pub struct GlobalKeystrokes<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
    registered: Mutex<HashMap<u32, String>>,
    latch: Mutex<KeyLatch>,
}
impl<R: tauri::Runtime> GlobalKeystrokes<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self { Self { app, registered: Mutex::default(), latch: Mutex::default() } }
    /// The accelerator for a new physical press; None for a repeat or a release.
    pub fn event(&self, id: u32, pressed: bool) -> Option<String> {
        let mut latch = locked(&self.latch);
        if !pressed { latch.release(id); return None; }
        if !latch.press(id) { return None; }
        locked(&self.registered).get(&id).cloned()
    }
}
impl<R: tauri::Runtime> KeystrokeRegistrar for GlobalKeystrokes<R> {
    fn reconcile(&self, wanted: &BTreeSet<String>) -> Vec<String> {
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
        let shortcuts = self.app.global_shortcut();
        let mut registered = locked(&self.registered);
        registered.retain(|_, accelerator| {
            let keep = wanted.contains(accelerator);
            if !keep { if let Ok(s) = accelerator.parse::<Shortcut>() { let _ = shortcuts.unregister(s); } }
            keep
        });
        let mut failed = vec![];
        for accelerator in wanted {
            if registered.values().any(|a| a == accelerator) { continue; }
            match accelerator.parse::<Shortcut>() {
                Ok(s) if shortcuts.register(s).is_ok() => { registered.insert(s.id(), accelerator.clone()); }
                _ => failed.push(accelerator.clone()),
            }
        }
        failed
    }
}
```

- [ ] **Step 5: Connect the input queue and the registrar to the service.**

`service/mod.rs`:
- `Shared` gets these fields:
  - `input: Mutex<crate::input::InputQueue>`
  - `keystrokes: Mutex<Arc<dyn crate::input::KeystrokeRegistrar>>`, initialized with `NoKeystrokes`
  - `keystroke_warnings: Mutex<Vec<String>>`
- Add to `ServicePorts`:

```rust
    pub fn set_keystroke_registrar(&self, registrar: Arc<dyn crate::input::KeystrokeRegistrar>) { *lock(&self.shared.keystrokes) = registrar; }
    pub fn push_keystroke(&self, accelerator: String) { lock(&self.shared.input).push(accelerator); }
```

- Add `fn reconcile_keystrokes(&self, wanted: &BTreeSet<String>)` on `Shared`. It calls the registrar and stores the failures in `keystroke_warnings`.
- Rename `tracking_clock` to `clock_message(session_id, elapsed_ms, tracking, input: Option<InputUpdate>)`. Both `WireMessage::Clock` constructions carry `input`; the tracking trim loop never drops the input. At the clock site, pass `lock(&shared.input).drain()`.
- Where `inner.publisher = None` is set (line 199), also call `reconcile_keystrokes(&BTreeSet::new())`. A new publisher session starts with no Blueprints.
- `ServiceHandle::shutdown` calls `reconcile_keystrokes(&BTreeSet::new())` before the server stops.

`service/router.rs`:
- Add `"blueprintEdit" | "blueprintInspect"` to the scene-command matches (lines 95 and 183).
- `route_call`: `"blueprintEdit"` needs `Capability::Edit`. `"blueprintInspect"` falls to the default, `Read`.
- In `route_scene_call`, after a successful relay of `blueprintEdit` whose reply is `ok`:

```rust
if method == "blueprintEdit" {
    if let Some(data) = result.get("data").and_then(|d| serde_json::from_value::<opensekai_contracts::BlueprintEditResult>(d.clone()).ok()) {
        self.reconcile_keystrokes(&data.keystrokes.into_iter().collect());
    }
}
```

- In the `appStatus` builder (line 173):
  - Set `blueprint_revision` from the last publisher frame, the same way `revision` is set.
  - Append one warning per failed accelerator: `AppError { code: ErrorCode::Unavailable, message: "Keystroke unavailable".into(), ids: vec![accelerator] }`.

- [ ] **Step 6: Register the plugin** in `lib.rs`:

```rust
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    app.state::<DesktopState>().keystroke(shortcut.id(), event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed);
                })
                .build(),
        )
```

`DesktopState` gets a `keystrokes: OnceLock<Arc<GlobalKeystrokes<tauri::Wry>>>` field. Its method `fn keystroke(&self, id: u32, pressed: bool)` calls `event(id, pressed)`, and on `Some(accelerator)` calls `push_keystroke` on the running service ports. In `setup`, after the service initializes:
1. create `GlobalKeystrokes::new(app.handle().clone())`;
2. store it;
3. call `ports.set_keystroke_registrar(it.clone())`.

The JavaScript side does not use the plugin, so add no capability JSON.

- [ ] **Step 7: Write the integration test** in `apps/desktop/src-tauri/tests/keystroke_integration.rs`. It uses a real loopback service and real WebSockets, because the behavior is at a process network boundary. Copy the `service`, `send`, `recv`, `auth`, and `frame` helpers from `clock_integration.rs`:

```rust
struct Fake(std::sync::Mutex<Vec<std::collections::BTreeSet<String>>>);
impl opensekai_desktop_lib::input::KeystrokeRegistrar for Fake {
    fn reconcile(&self, wanted: &std::collections::BTreeSet<String>) -> Vec<String> {
        self.0.lock().unwrap().push(wanted.clone());
        wanted.iter().filter(|a| a.as_str() == "Control+Alt+KeyJ").cloned().collect()
    }
}

#[tokio::test]
async fn queued_keystrokes_ride_the_next_clock_in_order() {
    let (_d, s) = service().await;
    let pd = s.publisher_descriptor();
    let mut p = auth(&pd).await;
    assert_eq!(recv(&mut p).await["kind"], "clock");
    s.ports().push_keystroke("Control+Alt+KeyH".into());
    s.ports().push_keystroke("Control+Alt+KeyJ".into());
    send(&mut p, frame(&pd.session_id, 1)).await;
    let clock = recv(&mut p).await;
    assert_eq!(clock["input"]["events"], json!([{"kind":"keystroke","accelerator":"Control+Alt+KeyH"},{"kind":"keystroke","accelerator":"Control+Alt+KeyJ"}]));
    send(&mut p, frame(&pd.session_id, 2)).await;
    assert!(recv(&mut p).await.get("input").is_none());
    s.shutdown().await.unwrap();
}

#[tokio::test]
async fn blueprint_edit_reply_drives_registration_warnings_and_publisher_loss_clears_it() {
    let (_d, s) = service().await;
    let fake = std::sync::Arc::new(Fake(Default::default()));
    s.ports().set_keystroke_registrar(fake.clone());
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    send(&mut o, json!({"kind":"call","requestId":"edit","method":"blueprintEdit","params":{"clientId":"c","batchId":"b","ops":[{"kind":"removeGraph","graphId":"g"}]}})).await;
    let relayed = loop { let m = recv(&mut p).await; if m["kind"] == "call" { break m; } };
    send(&mut p, json!({"kind":"reply","requestId":relayed["requestId"],"result":{"ok":true,"data":{"revision":1,"keystrokes":["Control+Alt+KeyH","Control+Alt+KeyJ"]}}})).await;
    loop { let m = recv(&mut o).await; if m["requestId"] == "edit" { break; } }
    assert_eq!(fake.0.lock().unwrap().last().unwrap().iter().cloned().collect::<Vec<_>>(), vec!["Control+Alt+KeyH".to_string(), "Control+Alt+KeyJ".to_string()]);
    send(&mut o, json!({"kind":"call","requestId":"status","method":"appStatus","params":{}})).await;
    let status = loop { let m = recv(&mut o).await; if m["requestId"] == "status" { break m; } };
    assert_eq!(status["result"]["data"]["warnings"][0]["ids"], json!(["Control+Alt+KeyJ"]));
    drop(p);
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert!(fake.0.lock().unwrap().last().unwrap().is_empty());
    s.shutdown().await.unwrap();
}
```

Match the call envelope that `service_integration.rs`'s `call()` helper uses. If `appStatus` is relayed to the publisher in this code base, answer it from `p` in the test as well. If dropping the socket does not clear the publisher within 200 ms, use the `closed()` helper pattern from `clock_integration.rs`, then assert.

- [ ] **Step 8: Run the Rust tests.** Run: `cargo test -p opensekai-desktop`. Expected: PASS, including the existing `clock_integration` tests.
- [ ] **Step 9: Commit** with `git commit -m "feat(desktop): register session-reported keystrokes globally and send presses on the clock"`.

---

### Task 7: MCP server

**Files:**
- Modify: `apps/mcp/src/tools.ts`, `apps/mcp/src/resources.ts`, and `apps/mcp/src/server.ts` if tool descriptions live there
- Test: `apps/mcp/test/tool-validation.test.ts`, `apps/mcp/test/stdio-roundtrip.integration.test.ts`

**Interfaces:**
- Consumes: `AppApi.blueprintEdit`, `AppApi.blueprintInspect`, `AppApi.blueprintRun` (Task 2).
- Produces:
  - Tools `blueprint_edit`, `blueprint_inspect`, `blueprint_run`.
  - The resource `opensekai://blueprints`, a snapshot read through `blueprintInspect({})`.

- [ ] **Step 1: Write the failing tests.**
  - `tool-validation.test.ts`: `blueprint_edit` maps to `blueprintEdit` and accepts a `replaceAll` batch. `blueprint_inspect` accepts `{}` and `{ sinceRevision: 0 }`. `blueprint_run` rejects a `graph` argument.
  - The stdio roundtrip: list the resources and confirm that `opensekai://blueprints` is present. Follow the existing fixture pattern for the fake app.
- [ ] **Step 2: Run the tests and confirm they fail.** Run: `pnpm vitest run --project unit apps/mcp` and `pnpm vitest run --project integration apps/mcp`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `blueprint_edit: 'blueprintEdit', blueprint_inspect: 'blueprintInspect'` to `toolMethods`.
  - If tools get descriptions or JSON schemas from `ParamSchemas`, check that the new schemas convert. In particular, check that `z.record` in `setNodeSettings` converts.
  - In `resources.ts`, register `opensekai://blueprints` the same way as `status`, using `api.blueprintInspect({})`.
  - Write a one-line STE description for each new tool, if the server has a description field: "Apply ordered Blueprint operations as one batch." / "Read Blueprint documents, or the batches after a revision." / "Fire a Manual Trigger in an enabled Blueprint."
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(mcp): expose Blueprint edit, inspect, run, and a Blueprint resource"`.

---

### Task 8: Editor — prediction and reconciliation, canvas patching, graph list, keystroke field

**Files:**
- Create: `apps/desktop/src/blueprints/blueprint-sync.ts`, `apps/desktop/src/blueprints/keystroke-format.ts`, `apps/desktop/src/components/BlueprintList.svelte`, `apps/desktop/src/components/BlueprintNodeFields.svelte`, `apps/desktop/src/components/KeystrokeField.svelte`
- Modify: `apps/desktop/src/blueprints/rete-editor.ts`, `apps/desktop/src/components/BlueprintPanel.svelte`, `apps/desktop/src/EditorApp.svelte`, `apps/desktop/src/editor-poll.ts`, `apps/desktop/src/app.css`
- Test: `apps/desktop/test/blueprint-sync.test.ts`, `apps/desktop/test/rete-patch.test.ts`, `apps/desktop/test/keystroke-format.test.ts`. Create the directory if it does not exist. The vitest unit project already includes `apps/*/test/**/*.test.ts`.

**Interfaces:**
- Consumes: `applyBlueprintOps`, `BlueprintOp`, `BLUEPRINT_LABELS`, `blueprintPorts`, `defaultBlueprintSettings`, `keystrokeAccelerator`, `AppApi.blueprintEdit`, `AppApi.blueprintInspect`, `AppApi.blueprintRun`.
- Produces:
  - `createBlueprintSync(api: Pick<AppApi, 'blueprintEdit' | 'blueprintInspect'>, clientId?: Id): BlueprintSync`, with:
    - `view(): BlueprintGraph[]`
    - `revision(): number`
    - `errors(): BlueprintStatus[]`
    - `issue(): SyncIssue`
    - `load(): Promise<void>`
    - `pull(): Promise<void>`
    - `edit(ops: BlueprintOp[]): Reply<BlueprintGraph[]>`
    - `idle(): Promise<void>`
    - `subscribe(fn: (next, previous) => void): () => void`
  - `SyncIssue = { kind: 'rejected'; message: string } | { kind: 'unavailable' } | null`
  - `graphPatch(previous: BlueprintGraph | undefined, next: BlueprintGraph | undefined): GraphPatch`, where `GraphPatch = { removeConnections: Id[]; removeNodes: Id[]; addNodes: BlueprintNode[]; updateNodes: BlueprintNode[]; moveNodes: { id: Id; position }[]; addConnections: BlueprintConnection[] }`
  - `defaultKeystroke(platform: string): KeystrokeSettings` and `formatKeystroke(s: KeystrokeSettings, platform: string): string`

- [ ] **Step 1: Write the failing tests.**

`apps/desktop/test/keystroke-format.test.ts`:

```ts
import { expect, it } from 'vitest';
import { defaultKeystroke, formatKeystroke } from '../src/blueprints/keystroke-format';

it('uses idiomatic platform defaults and labels', () => {
 expect(defaultKeystroke('MacIntel')).toEqual({ code: 'KeyH', control: true, alt: true, shift: false, meta: false });
 expect(defaultKeystroke('Win32')).toEqual({ code: 'KeyH', control: true, alt: false, shift: true, meta: false });
 expect(formatKeystroke({ code: 'KeyH', control: true, alt: true, shift: true, meta: true }, 'MacIntel')).toBe('⌃⌥⇧⌘H');
 expect(formatKeystroke({ code: 'Digit1', control: true, alt: false, shift: true, meta: false }, 'Win32')).toBe('Ctrl+Shift+1');
 expect(formatKeystroke({ code: 'F5', control: false, alt: true, shift: false, meta: true }, 'Win32')).toBe('Alt+Win+F5');
});
```

`apps/desktop/test/blueprint-sync.test.ts` runs two editor clients against one real session. A test against the real session is the useful level here: it proves convergence through the real reducer, journal, and snapshot rules:

```ts
import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { makeSmokeScene, type AppApi } from '@opensekai/contracts';
import { createSession } from '@opensekai/session';
import { createBlueprintSync } from '../src/blueprints/blueprint-sync';

const apiFor = (session: ReturnType<typeof createSession>): Pick<AppApi, 'blueprintEdit' | 'blueprintInspect'> => ({
 blueprintEdit: async batch => session.editBlueprints(batch),
 blueprintInspect: async ({ sinceRevision }) => ({ ok: true, data: session.inspectBlueprints(sinceRevision) }),
});
const setup = async () => {
 const session = createSession(makeSmokeScene(), 's');
 session.editBlueprints({ clientId: 'seed', batchId: 'seed', ops: [{ kind: 'replaceAll', graphs: fixture.blueprints }] });
 const a = createBlueprintSync(apiFor(session), 'a'), b = createBlueprintSync(apiFor(session), 'b');
 await a.load(); await b.load();
 return { session, a, b };
};
const wait = (g: ReturnType<typeof createBlueprintSync>['view'] extends () => infer R ? R : never, id: string) => g.find(x => x.id === 'flash-marker')!.nodes.find(n => n.id === id);

it('predicts a local edit at once and converges both clients through the journal', async () => {
 const { a, b } = await setup();
 a.edit([{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 5, y: 5 } }]);
 expect(wait(a.view(), 'wait')!.position).toEqual({ x: 5, y: 5 });
 await a.idle(); await b.pull();
 expect(b.view()).toEqual(a.view());
 expect(a.revision()).toBe(b.revision());
});

it('coalesces a drag into few batches', async () => {
 const { session, a } = await setup();
 const before = session.inspectBlueprints().revision;
 for (let i = 0; i < 50; i++) a.edit([{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: i, y: 0 } }]);
 await a.idle();
 expect(session.inspectBlueprints().revision - before).toBeLessThanOrEqual(2);
 expect(wait(a.view(), 'wait')!.position).toEqual({ x: 49, y: 0 });
});

it('rebases pending local edits over a concurrent remote edit', async () => {
 const { a, b } = await setup();
 b.edit([{ kind: 'updateGraph', graphId: 'flash-marker', name: 'Remote' }]);
 a.edit([{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 9, y: 9 } }]);
 await b.idle(); await a.idle(); await b.pull();
 expect(a.view()).toEqual(b.view());
 expect(a.view().find(g => g.id === 'flash-marker')).toMatchObject({ name: 'Remote' });
});

it('reloads after its batch is rejected because a remote client removed the node', async () => {
 const { a, b } = await setup();
 b.edit([{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'wait' }]);
 await b.idle();
 a.edit([{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 1, y: 1 } }]);
 await a.idle();
 expect(a.issue()).toMatchObject({ kind: 'rejected' });
 expect(a.view()).toEqual(b.view());
});

it('reports a compile error from the session without blocking the edit', async () => {
 const { a } = await setup();
 a.edit([{ kind: 'disconnect', graphId: 'flash-marker', connectionId: 'w2' }]);
 await a.idle();
 expect(a.errors()).toEqual([expect.objectContaining({ graphId: 'flash-marker', kind: 'compile' })]);
});
```

`apps/desktop/test/rete-patch.test.ts`:

```ts
import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintSetSchema } from '@opensekai/contracts';
import { graphPatch } from '../src/blueprints/rete-editor';

it('computes the minimal canvas patch between two graph versions', () => {
 const [before] = BlueprintSetSchema.parse(fixture.blueprints).slice(1);
 const after = applyBlueprintOps([before!], [
  { kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 1, y: 2 } },
  { kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'wait', settings: { seconds: 3 } },
  { kind: 'removeNode', graphId: 'flash-marker', nodeId: 'off' },
 ]);
 if (!after.ok) throw new Error();
 expect(graphPatch(before, after.data[0])).toEqual({
  removeConnections: ['w5'], removeNodes: ['off'], addNodes: [],
  updateNodes: [expect.objectContaining({ id: 'wait', settings: { seconds: 3 } })],
  moveNodes: [{ id: 'wait', position: { x: 1, y: 2 } }], addConnections: [],
 });
});
```

`rete-editor.ts` imports Rete at module scope. If importing it in Node fails, move `graphPatch` into `apps/desktop/src/blueprints/graph-patch.ts` and import it from there in the test and in the adapter.

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `pnpm vitest run --project unit apps/desktop/test`. Expected: FAIL.

- [ ] **Step 3: Implement `keystroke-format.ts`**

```ts
import type { KeystrokeSettings } from '@opensekai/contracts';

export const isMac = (platform: string) => /Mac|iPhone|iPad/.test(platform);
export const defaultKeystroke = (platform: string): KeystrokeSettings =>
 isMac(platform) ? { code: 'KeyH', control: true, alt: true, shift: false, meta: false } : { code: 'KeyH', control: true, alt: false, shift: true, meta: false };
const key = (code: string) => code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ').replace(/^Arrow/, '');
export function formatKeystroke(s: KeystrokeSettings, platform: string): string {
 if (isMac(platform)) return `${s.control ? '⌃' : ''}${s.alt ? '⌥' : ''}${s.shift ? '⇧' : ''}${s.meta ? '⌘' : ''}${key(s.code)}`;
 return [s.control && 'Ctrl', s.alt && 'Alt', s.shift && 'Shift', s.meta && 'Win', key(s.code)].filter(Boolean).join('+');
}
```

The caller passes `navigator.platform ?? navigator.userAgent` as `platform`.

- [ ] **Step 4: Implement `blueprint-sync.ts`**

```ts
import { applyBlueprintOps, type AppApi, type BlueprintGraph, type BlueprintInspect, type BlueprintOp, type BlueprintStatus, type Id, type Reply } from '@opensekai/contracts';

export type SyncIssue = { kind: 'rejected'; message: string } | { kind: 'unavailable' } | null;
export interface BlueprintSync {
 view(): BlueprintGraph[]; revision(): number; errors(): BlueprintStatus[]; issue(): SyncIssue;
 load(): Promise<void>; pull(): Promise<void>; edit(ops: BlueprintOp[]): Reply<BlueprintGraph[]>; idle(): Promise<void>;
 subscribe(fn: (next: BlueprintGraph[], previous: BlueprintGraph[]) => void): () => void;
}
interface Pending { batchId: Id; ops: BlueprintOp[]; sent: boolean; revision?: number }
const isMove = (ops: BlueprintOp[]) => ops.length === 1 && ops[0]!.kind === 'moveNode';
const sameMove = (a: BlueprintOp[], b: BlueprintOp[]) => isMove(a) && isMove(b) && a[0]!.kind === 'moveNode' && b[0]!.kind === 'moveNode' && a[0].graphId === b[0].graphId && a[0].nodeId === b[0].nodeId;

export function createBlueprintSync(api: Pick<AppApi, 'blueprintEdit' | 'blueprintInspect'>, clientId: Id = crypto.randomUUID()): BlueprintSync {
 let confirmed: BlueprintGraph[] = [], view: BlueprintGraph[] = [], revision = 0, pending: Pending[] = [];
 let errors: BlueprintStatus[] = [], issue: SyncIssue = null;
 let sending: Promise<void> | null = null, pulling: Promise<void> | null = null;
 const listeners = new Set<(next: BlueprintGraph[], previous: BlueprintGraph[]) => void>();
 const show = (next: BlueprintGraph[]) => { const previous = view; view = next; for (const fn of listeners) fn(next, previous); };
 // Server reconciliation: confirmed server state, then this client's unconfirmed batches applied again on top.
 const rebuild = () => {
  let next = confirmed;
  pending = pending.filter(batch => { const r = applyBlueprintOps(next, batch.ops); if (r.ok) next = r.data; return r.ok || batch.sent; });
  show(next);
 };
 const adopt = async (reply: BlueprintInspect): Promise<void> => {
  if (reply.kind === 'snapshot') confirmed = reply.blueprints;
  else for (const batch of reply.batches) {
   const r = applyBlueprintOps(confirmed, batch.ops);
   if (!r.ok) return load();
   confirmed = r.data;
   if (batch.clientId === clientId) pending = pending.filter(p => p.batchId !== batch.batchId);
  }
  revision = reply.revision; errors = reply.errors;
  pending = pending.filter(p => p.revision === undefined || p.revision > revision);
  rebuild();
 };
 const fetch = async (sinceRevision?: number) => {
  try {
   const reply = await api.blueprintInspect(sinceRevision === undefined ? {} : { sinceRevision });
   if (!reply.ok) { issue = { kind: 'unavailable' }; return; }
   await adopt(reply.data);
  } catch { issue = { kind: 'unavailable' }; }
 };
 const load = () => fetch();
 const pull = () => pulling ??= fetch(revision).finally(() => { pulling = null; });
 const flush = (): Promise<void> => sending ??= (async () => {
  try {
   for (let batch = pending.find(p => !p.sent); batch; batch = pending.find(p => !p.sent)) {
    batch.sent = true;
    const reply = await api.blueprintEdit({ clientId, batchId: batch.batchId, ops: batch.ops });
    if (reply.ok) { batch.revision = reply.data.revision; issue = null; continue; }
    pending = pending.filter(p => p !== batch);
    issue = { kind: 'rejected', message: reply.error.message };
    await load();
   }
  } catch { issue = { kind: 'unavailable' }; for (const p of pending) if (p.revision === undefined) p.sent = false; }
  finally { sending = null; }
  await pull();
 })();
 return {
  view: () => view, revision: () => revision, errors: () => errors, issue: () => issue,
  load, pull,
  edit(ops) {
   const result = applyBlueprintOps(view, ops);
   if (!result.ok) return result;
   const last = pending.at(-1);
   if (last && !last.sent && sameMove(last.ops, ops)) last.ops = ops;
   else pending.push({ batchId: crypto.randomUUID(), ops, sent: false });
   show(result.data);
   void flush();
   return result;
  },
  async idle() { while (sending || pulling) await (sending ?? pulling); },
  subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
 };
}
```

Moves: while one batch is in flight, each later `moveNode` for the same node replaces the queued, unsent move. A drag therefore sends at most one batch per round trip. This satisfies the coalescing test.

- [ ] **Step 5: Run the sync and format tests and confirm they pass.** Run: `pnpm vitest run --project unit apps/desktop/test/blueprint-sync.test.ts apps/desktop/test/keystroke-format.test.ts`. Expected: PASS.

- [ ] **Step 6: Make the Rete adapter patch the canvas** (`rete-editor.ts`, or `graph-patch.ts` plus the adapter):
  - Delete the local `labels`, `portTypes`, and `settingsFor`. Sockets come from `blueprintPorts`, and titles from `BLUEPRINT_LABELS`.
  - Port multiplicity, as in Warudo:
    - flow input: `new ClassicPreset.Input(socket, name, true)`
    - flow output: `new ClassicPreset.Output(socket, name, false)`
    - data input: `false`
    - data output: `true`
  - `graphPatch(previous, next)`: compare by ID. A node with a different `type` or `settings` goes to `updateNodes`; for Sequence, the adapter rebuilds its outputs. A node with a different `position` goes to `moveNodes`. Connections are compared by ID. The ordering of the output arrays follows the order of `next`.
  - New signature: `mountReteBlueprint(container, graph, { onSelect, onOps })`. The adapter exposes `show(graph)`, which applies `graphPatch(shown, graph)` with a `suppress` flag set, so its own events do not echo as operations. It also exposes `select(nodeId)`, `zoomToFit()`, and `destroy()`.
  - Canvas-originated events produce operations only while `suppress` is false:
    - `nodetranslated` → `moveNode`
    - `connectioncreated` → `connect` with the Rete connection ID
    - `connectionremoved` → `disconnect`

    Keep `shown` updated from these events, so the next `show()` diff is a no-op for the client's own predicted state.
  - If `sync.edit` rejects canvas operations, the panel calls `adapter.show(sync.view() graph)`. The canvas then returns to the valid state.

- [ ] **Step 7: Build the UI**
  - `BlueprintList.svelte` takes `{ graphs, selectedId, disabled, onselect, onops }`. It is a plain list with no cards. Each row has:
    - the name as a select button; a double-click starts an inline rename `<input>`, Enter commits with `updateGraph`, and Escape cancels;
    - an eye icon button that sends `updateGraph { enabled }` (`Eye` / `EyeOff` from `@lucide/svelte`, with `aria-pressed`);
    - a `Trash2` ghost button that sends `removeGraph`.

    The header has a `Plus` button that sends `createGraph` with On Keystroke Pressed (`defaultKeystroke(platform)`) wired to Toggle Visibility on the first scene entity. The button is disabled when there are 8 graphs.
  - `KeystrokeField.svelte` takes `{ value, platform, unavailable, onchange }`. A button shows `formatKeystroke(value, platform)`. A click arms capture; the next `keydown` whose `event.code` is in `KEYSTROKE_CODES` and that holds Control, Alt, or Meta sets the value. Call `preventDefault` during capture. Escape or blur cancels. A combination without a modifier sets `aria-invalid` for 1 s and keeps the value. `unavailable` sets `aria-invalid` permanently. It is true when an `appStatus` warning names this accelerator.
  - `BlueprintNodeFields.svelte` holds the per-type fields. Each change sends `setNodeSettings`:
    - Number: a number input.
    - Boolean: a checkbox.
    - Set Visibility and Toggle Visibility: an entity select.
    - Switch Camera: an output select and a camera select.
    - Delay: seconds, 0–3600.
    - Sequence: a select of 2–8.
    - On Keystroke Pressed: `KeystrokeField`.
  - `BlueprintPanel.svelte`:
    - It creates or receives one `BlueprintSync`, calls `load()` on mount, and subscribes.
    - Changing the selected graph remounts the canvas. Other changes call `adapter.show()`.
    - The palette comes from `BLUEPRINT_LABELS`. Adding a node sends `addNode` with `defaultBlueprintSettings(kind, { entityId, cameraId, keystroke: defaultKeystroke(platform) })`, at a position near the viewport center. Delete sends `removeNode`.
    - Status text in the toolbar shows only problems: the compile or runtime error message for the selected graph from `sync.errors()`, which also selects the first ID; `issue.kind === 'rejected'` → `Changed elsewhere`; `unavailable` → `Session unavailable`.
    - **Run** is shown only when the selected graph has a Manual Trigger. It calls `api.blueprintRun({ graphId, triggerNodeId })`.
  - `editor-poll.ts`: after `publish(reply.data)`, if `reply.data.blueprintRevision !== undefined && reply.data.blueprintRevision !== blueprintSync.revision()`, call `blueprintSync.pull()`. Pass the sync object in through a new optional parameter, so the existing scene behavior does not change.
  - `EditorApp.svelte`:
    - Own the `BlueprintSync` and pass it to the poll and the panel.
    - Remove `blueprintDraft` and `readDraft`.
    - `saveShow`: `await sync.idle()`, then `api.blueprintInspect({})`. When the reply is a snapshot, write its `blueprints`.
    - `openShow`: validate the document. Compile each graph with `compileBlueprint` and report the first failure, but do not block the open, because documents that do not compile are allowed. Then call `sceneReplace`, then `sync.edit([{ kind: 'replaceAll', graphs: document.blueprints }])` and `await sync.idle()`. If `sync.issue()` is not null after that, set `showError`.

- [ ] **Step 8: Check types and run the tests.** Run: `pnpm check` and `pnpm test:unit`. Expected: PASS.

- [ ] **Step 9: Check the editor in a browser.** Run `pnpm --filter @opensekai/desktop dev`. Use the harness from `docs/evaluation/rete-blueprint-editor.md` and check these behaviors:
  - add two graphs, rename one, and toggle enabled;
  - drag a node: the canvas does not jump back;
  - set a Sequence to 3 outputs, wire `then2`, set it to 2: the wire disappears;
  - record ⌃⌥J;
  - disconnect a data wire: the compile error shows and the node is selected;
  - reconnect the wire: the error clears;
  - with MCP or a second editor window, rename the graph: the first editor shows the new name within one poll, and the canvas does not remount.

  Save `docs/evaluation/blueprint-interactions-browser.png`.

- [ ] **Step 10: Commit** with `git commit -m "feat(editor): sync Blueprint edits with prediction and journal reconciliation"`.

---

### Task 9: macOS acceptance, evidence, and parity

**Files:**
- Create: `docs/evaluation/blueprint-interactions.md`, `docs/evaluation/blueprint-interactions-evidence.json`, screenshots
- Modify: `docs/warudo-parity.md`, this plan (check off the steps), `spdd/prompt/2026-10-07-blueprint-interactions.md` (sync it if the code moved from the contract)

- [x] **Step 1: Run the full checks.** Run: `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo test --workspace`. Expected: all PASS. Record the counts.
- [x] **Step 2: Build and run the release app.** Run `pnpm build:mac`, then launch the `.app`. Connect OBS (`ws://127.0.0.1:4455`) to the transparent output with an isolated OpenSekai test source. Keep the existing OBS scenes.
- [ ] **Step 3: Run the critical path with computer use and OBS screenshots.**
  1. Use the default avatar and add a marker.
  2. Graph A: On Keystroke Pressed ⌃⌥H → Toggle Visibility(avatar).
  3. Graph B: ⌃⌥J → Set Visibility(marker, true) → Delay 2 s → Set Visibility(marker, false).
  4. Graph C: ⌃⌥K → Flip Flop: A → Switch Camera(output_main, close); B → Switch Camera(output_main, wide).
  5. Focus Finder or OBS, and minimize the editor.
  6. Press ⌃⌥H: the avatar is hidden in OBS. Press it again: the avatar shows.
  7. Hold ⌃⌥H for 2 s: the avatar toggles one time.
  8. Press ⌃⌥J: the marker shows, then hides. Record the measured interval from the OBS recording.
  9. Press ⌃⌥K two times: the camera cuts close, then wide.
  10. Disconnect the data wire of graph A's target while ⌃⌥H stays bound. Press ⌃⌥H: the last valid version still toggles. Reconnect the wire.
  11. Disable graph B, then press ⌃⌥J: nothing happens, and the key reaches the focused app.
  12. With MCP (`pnpm mcp`), call `blueprint_edit` to rename graph C. The open editor shows the new name without a remount.
  13. Save the show, quit, relaunch, and open the show. Press ⌃⌥H: it works without opening the Blueprint panel.
  14. Bind a combination that macOS holds, for example ⌘Space with Spotlight. The field shows the warning, and the other keys still work.
- [x] **Step 4: Write the evidence.** Record:
  - the commit, the backend, the quality profile, and the fixture revision;
  - the result of each step, with screenshot references;
  - the app timing and the OBS timing separately; every value that was not measured is unknown.

  State the Different behavior: a registered combination is held, and other apps do not receive it. State that the live Warudo comparison was not possible on the VMPal guest.
- [x] **Step 5: Update parity** in `docs/warudo-parity.md`. Claim only verified behavior:
  - **BP-01** partial: add the event scheduler on the session clock, If Branch, Sequence, Flip Flop, Delay, Not, Toggle Visibility, Switch Camera, and the last valid version running while an edit does not compile.
  - **BP-02** partial: add catalog-driven sockets, Warudo port multiplicity, keystroke capture, live sync between clients, and error location.
  - **BP-03** partial: add create, rename, remove, and enable for up to 8 graphs.
  - **BP-06** partial: add global keyboard hotkeys on macOS. Mark them Different, because the combination is held.
  - Add an evidence row.
- [x] **Step 6: Sync the contract and commit.** If the implementation moved from the contract, run `/spdd-sync`. Then commit with `git commit -m "docs: record Blueprint hotkey interaction evidence and parity"`. Do not push, and do not change GitHub issue labels.

---

## Self-review notes

- Spec coverage. Each design decision maps to tasks:

  | Decision | Tasks |
  | --- | --- |
  | 1 (operations and journal) | 2, 4, 8 |
  | 2 (revision sync) | 2, 4, 6, 8 |
  | 3 (last valid version runs) | 4 |
  | 4 (8 graphs and enabled) | 2, 3, 5 |
  | 5 (no On Update) | Global Constraints |
  | 6 (global keystrokes with a modifier) | 2, 3, 5, 6, 8 |
  | 7 (port rules) | 2, 3, 8 |
  | 8 (node set) | 2, 3 |
  | 9 (run and MCP) | 4, 7 |
  | 10 (one commit per tick) | 4 |
  | 11 (validation authority) | 5 |

- Review Focus mapping:

  | Review Focus | Test |
  | --- | --- |
  | 1 | Task 8 two-client tests |
  | 2 | `latch_fires_once_per_physical_press` |
  | 3 | `blueprint_edit_reply_drives_registration_warnings…` |
  | 4 | `keeps the last valid version firing` |
  | 5 | `isolates a graph…` and `does not advance the scene revision…` |

- Names used in more than one task: `applyBlueprintOps`, `BlueprintBatch`, `blueprintPorts`, `runFlow`, `createBlueprintRuntime`, `createBlueprintStore`, `editBlueprints`, `inspectBlueprints`, `BlueprintEditResult`, `KeystrokeRegistrar`, `push_keystroke`, `set_keystroke_registrar`, `createBlueprintSync`, `graphPatch`, `defaultKeystroke`.
