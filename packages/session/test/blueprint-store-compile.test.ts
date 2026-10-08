import { expect, it, vi } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { createBlueprintRuntime } from '../src/blueprint-runtime';
import { createBlueprintStore } from '../src/blueprint-store';
import { compileBlueprint } from '../src/blueprint';

// vi.mock replaces the module export that the store and the runtime import, so every compile is counted.
vi.mock('../src/blueprint', async importOriginal => {
 const original = await importOriginal<typeof import('../src/blueprint')>();
 return { ...original, compileBlueprint: vi.fn(original.compileBlueprint) };
});
const compiled = () => vi.mocked(compileBlueprint).mock.calls.map(([graph]) => (graph as { id: string }).id);

it('compiles only the graphs that an edit changed', () => {
 const store = createBlueprintStore(createBlueprintRuntime());
 const [first, second] = fixture.blueprints as { id: string; nodes: { id: string }[] }[];
 expect(store.edit({ clientId: 't', batchId: 'open', ops: [{ kind: 'replaceAll', graphs: fixture.blueprints }] }).ok).toBe(true);
 expect(compiled().sort()).toEqual(fixture.blueprints.map(graph => graph.id).sort());
 vi.mocked(compileBlueprint).mockClear();
 expect(store.edit({ clientId: 't', batchId: 'move', ops: [{ kind: 'moveNode', graphId: first!.id, nodeId: first!.nodes[0]!.id, position: { x: 3, y: 3 } }] }).ok).toBe(true);
 expect(compiled()).toEqual([first!.id]);
 vi.mocked(compileBlueprint).mockClear();
 expect(store.edit({ clientId: 't', batchId: 'name', ops: [{ kind: 'updateGraph', graphId: second!.id, name: 'Other' }] }).ok).toBe(true);
 expect(compiled()).toEqual([second!.id]);
 expect(store.active(first!.id)!.nodes[0]!.position).toEqual({ x: 3, y: 3 });
});
