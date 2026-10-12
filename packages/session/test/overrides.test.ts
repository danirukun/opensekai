import { expect, it } from 'vitest';
import { makeSmokeScene, quaternionFromEuler } from '@opensekai/contracts';
import { applyOverrides, dropOverrides, EMPTY_OVERRIDES, MAX_OVERRIDES, takeIdle, writeOverride, type OverrideLayer } from '../src/overrides';

const scene = makeSmokeScene();
const ok = <T>(reply: { ok: true; data: T } | { ok: false }): T => { if (!reply.ok) throw new Error('expected ok'); return reply.data; };
const set = (layer: OverrideLayer, entityId: string, property: 'position' | 'visible' | 'fovDegrees' | 'scale', value: never, at = 0, graph = 'g') =>
 writeOverride(layer, scene, { kind: 'setProperty', entityId, property, value }, graph, at);

it('applies overrides to the evaluated scene without changing the persistent one', () => {
 const layer = ok(set(EMPTY_OVERRIDES, 'reference', 'position', [1, 2, 3] as never));
 const evaluated = applyOverrides(scene, layer);
 expect(evaluated.entities.find(e => e.id === 'reference')?.transform.position).toEqual([1, 2, 3]);
 expect(scene.entities.find(e => e.id === 'reference')?.transform.position).toEqual([0.9, 0.7, 0]);
 expect(applyOverrides(scene, EMPTY_OVERRIDES)).toBe(scene);
});

it('moves from the current override, in world or local space', () => {
 let layer = ok(writeOverride(EMPTY_OVERRIDES, scene, { kind: 'moveEntity', entityId: 'reference', space: 'world', delta: [0, 0, 1] }, 'g', 0));
 layer = ok(writeOverride(layer, scene, { kind: 'moveEntity', entityId: 'reference', space: 'world', delta: [0, 0, 1] }, 'g', 16));
 expect(layer.get('reference')?.get('position')?.value).toEqual([0.9, 0.7, 2]);
 const turned = { ...scene, entities: scene.entities.map(e => e.id === 'reference' ? { ...e, transform: { ...e.transform, rotation: quaternionFromEuler([0, 90, 0]) } } : e) };
 const local = ok(writeOverride(EMPTY_OVERRIDES, turned, { kind: 'moveEntity', entityId: 'reference', space: 'local', delta: [0, 0, 1] }, 'g', 0));
 const [x, y, z] = local.get('reference')!.get('position')!.value as number[];
 expect(x).toBeCloseTo(1.9); expect(y).toBeCloseTo(0.7); expect(z).toBeCloseTo(0);
});

it('rejects invalid values and missing entities', () => {
 expect(set(EMPTY_OVERRIDES, 'reference', 'scale', [0, 1, 1] as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(set(EMPTY_OVERRIDES, 'camera_wide', 'fovDegrees', 200 as never).ok).toBe(false);
 expect(set(EMPTY_OVERRIDES, 'missing', 'visible', true as never)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});

it('limits the layer to 256 overrides', () => {
 const many = new Map(Array.from({ length: MAX_OVERRIDES }, (_, i) => [`e${i}`, new Map([['visible' as const, { value: true, lastWriteMs: 0, graphIds: ['g'] }]])]));
 expect(set(many, 'reference', 'visible', false as never)).toMatchObject({ ok: false, error: { message: 'Override limit reached' } });
});

it('commits only overrides idle for 250 ms, in one batch of operations, and keeps the busy ones', () => {
 let layer = ok(set(EMPTY_OVERRIDES, 'reference', 'position', [1, 2, 3] as never, 0, 'a'));
 layer = ok(set(layer, 'camera_wide', 'fovDegrees', 30 as never, 0, 'b'));
 layer = ok(set(layer, 'marker', 'visible', false as never, 100, 'a'));
 expect(takeIdle(scene, layer, 249).operations).toEqual([]);
 const idle = takeIdle(scene, layer, 250);
 expect(idle.operations).toEqual([
  { kind: 'setTransform', entityId: 'reference', transform: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
  { kind: 'setCameraLens', entityId: 'camera_wide', lens: { fovDegrees: 30, near: 0.01, far: 100 } },
 ]);
 expect(idle.graphIds.sort()).toEqual(['a', 'b']);
 expect([...idle.remaining.keys()]).toEqual(['marker']);
});

it('drops overrides that an explicit edit changes', () => {
 let layer = ok(set(EMPTY_OVERRIDES, 'reference', 'position', [1, 2, 3] as never));
 layer = ok(set(layer, 'reference', 'visible', false as never));
 layer = ok(set(layer, 'marker', 'visible', false as never));
 const after = dropOverrides(layer, [{ kind: 'setTransform', entityId: 'reference', transform: scene.entities[2]!.transform }, { kind: 'removeEntity', entityId: 'marker' }]);
 expect([...after.get('reference')!.keys()]).toEqual(['visible']);
 expect(after.has('marker')).toBe(false);
 expect(dropOverrides(layer, [{ kind: 'renameEntity', entityId: 'reference', name: 'R' }])).toBe(layer);
});
