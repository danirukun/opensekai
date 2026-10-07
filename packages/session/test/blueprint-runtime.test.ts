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
