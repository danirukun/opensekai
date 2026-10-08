import { expect, it } from 'vitest';
import { BlueprintGraphSchema } from '../src/blueprint';
import { requiredCapability, validateCall, parseWire } from '../src/schema';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { BlueprintSetSchema, KEYSTROKE_CODES, keystrokeAccelerator, blueprintPorts, ParamSchemas, ResultSchemas, ClockEnvelopeSchema, RuntimeFrameSchema } from '../src';

const graph = () => ({ schemaVersion: 1, id: 'graph', name: 'Show', nodes: [
 { id: 'start', version: 1, type: 'event.manual', settings: {}, position: { x: 0, y: 0 } },
], connections: [] });

it('accepts a versioned graph document', () => {
 expect(BlueprintGraphSchema.safeParse(graph()).success).toBe(true);
});

it('rejects duplicate IDs and invalid node settings', () => {
 const duplicate = graph();
 duplicate.nodes.push({ ...duplicate.nodes[0]! });
 expect(BlueprintGraphSchema.safeParse(duplicate).success).toBe(false);
 expect(BlueprintGraphSchema.safeParse({ ...graph(), nodes: [{ ...graph().nodes[0], settings: { arbitrary: true } }] }).success).toBe(false);
});

it('rejects unknown versions and graphs beyond size limits', () => {
 expect(BlueprintGraphSchema.safeParse({ ...graph(), schemaVersion: 2 }).success).toBe(false);
 expect(BlueprintGraphSchema.safeParse({ ...graph(), nodes: Array.from({ length: 129 }, (_, index) => ({ ...graph().nodes[0], id: String(index) })) }).success).toBe(false);
});

it('requires edit capability for a validated Blueprint run', () => {
 expect(requiredCapability('blueprintRun')).toBe('edit');
 expect(validateCall('blueprintRun', { graphId: 'graph', triggerNodeId: 'start' }).ok).toBe(true);
 expect(validateCall('blueprintRun', { graphId: 'graph', triggerNodeId: 'start', extra: true }).ok).toBe(false);
});

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
 const full = Array.from({ length: 16 }, () => ({ kind: 'keystroke', accelerator: 'x'.repeat(64) }));
 expect(() => parseWire(JSON.stringify({ kind: 'clock', sessionId: 'test', elapsedMs: 1, input: { events: full } }))).not.toThrow();
});

it('forbids replaceAll and createGraph in a delta but not a snapshot', () => {
 const delta = (op: object) => ({ kind: 'delta', revision: 2, batches: [{ revision: 2, clientId: 'c', batchId: 'b', ops: [op] }], errors: [] });
 expect(ResultSchemas.blueprintInspect.safeParse(delta({ kind: 'replaceAll', graphs: [] })).success).toBe(false);
 expect(ResultSchemas.blueprintInspect.safeParse(delta({ kind: 'createGraph', graph: graphWith([]) })).success).toBe(false);
 expect(ResultSchemas.blueprintInspect.safeParse({ kind: 'snapshot', revision: 2, blueprints: fixture.blueprints, errors: [] }).success).toBe(true);
});

it('gives no default settings for a node that needs an entity, camera, or output the scene lacks', async () => {
 const { defaultBlueprintSettings } = await import('../src/blueprint-nodes');
 const keystroke = { code: 'KeyH', control: true, alt: false, shift: false, meta: false };
 expect(defaultBlueprintSettings('scene.toggleVisibility', { keystroke })).toBeNull();
 expect(defaultBlueprintSettings('scene.setVisibility', { keystroke })).toBeNull();
 expect(defaultBlueprintSettings('camera.switch', { cameraId: 'cam', keystroke })).toBeNull();
 expect(defaultBlueprintSettings('camera.switch', { outputId: 'out', keystroke })).toBeNull();
 expect(defaultBlueprintSettings('scene.toggleVisibility', { entityId: 'e', keystroke })).toEqual({ entityId: 'e' });
 expect(defaultBlueprintSettings('camera.switch', { outputId: 'out', cameraId: 'cam', keystroke })).toEqual({ outputId: 'out', cameraId: 'cam' });
 expect(defaultBlueprintSettings('flow.branch', { keystroke })).toEqual({});
});
