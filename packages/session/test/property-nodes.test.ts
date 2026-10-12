import { expect, it } from 'vitest';
import { makeSmokeScene, type BlueprintGraph } from '@opensekai/contracts';
import { createSession } from '../src/session';

const at = { x: 0, y: 0 };
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const num = (id: string, value: number) => ({ id, version: 1, type: 'value.number', settings: { value }, position: at });
// On Update → Move Entity(reference, world, delta = Make Vector3(0, 0, Key Axis(S, W))).
const wasd = { schemaVersion: 1, id: 'wasd', name: 'WASD', enabled: true, variables: [], nodes: [
 { id: 'tick', version: 1, type: 'event.update', settings: {}, position: at },
 { id: 'axis', version: 1, type: 'input.keyAxis', settings: { negative: 'KeyS', positive: 'KeyW' }, position: at },
 num('zero', 0),
 { id: 'make', version: 1, type: 'vector3.make', settings: {}, position: at },
 { id: 'move', version: 1, type: 'entity.move', settings: { entityId: 'reference', space: 'world' }, position: at },
], connections: [
 wire('a', 'tick', 'flow', 'move', 'flow'), wire('b', 'zero', 'value', 'make', 'x'), wire('c', 'zero', 'value', 'make', 'y'),
 wire('d', 'axis', 'value', 'make', 'z'), wire('e', 'make', 'value', 'move', 'delta'),
] } as BlueprintGraph;
const W = { held: ['KeyW'] };
const start = () => {
 const session = createSession(makeSmokeScene(), 's');
 session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [wasd] }] });
 return session;
};
const z = (scene: { entities: { id: string; transform: { position: number[] } }[] }) => scene.entities.find(e => e.id === 'reference')!.transform.position[2];

it('moves an entity while a key is held without changing the scene revision, then commits once', () => {
 const session = start();
 const before = session.inspect().revision;
 let frame = session.advance(0, 0, W);
 for (let t = 16; t <= 160; t += 16) frame = session.advance(t, t, W);
 expect(z(frame.scene)).toBe(11);
 expect(session.inspect().revision).toBe(before);
 expect(z(session.inspect())).toBe(0);
 session.advance(176);
 session.advance(409);
 expect(session.inspect().revision).toBe(before);
 session.advance(410);
 expect(z(session.inspect())).toBe(11);
 expect(session.inspect().revision).toBe(before + 1);
 session.advance(800);
 expect(session.inspect().revision).toBe(before + 1);
});

it('an editor transform patch drops the override and nothing commits over it', () => {
 const session = start();
 session.advance(0, 0, W); session.advance(16, 16, W);
 const scene = session.inspect();
 const transform = { position: [5, 0, 5] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] };
 expect(session.applyPatch({ sceneId: scene.sceneId, expectedRevision: scene.revision, operations: [{ kind: 'setTransform', entityId: 'reference', transform }] }).ok).toBe(true);
 const frame = session.advance(32);
 expect(frame.scene.entities.find(e => e.id === 'reference')!.transform.position).toEqual([5, 0, 5]);
 session.advance(600);
 expect(session.inspect().entities.find(e => e.id === 'reference')!.transform.position).toEqual([5, 0, 5]);
});

it('sets and gets asset properties and reports invalid writes as runtime errors', () => {
 const g = { schemaVersion: 1, id: 'fov', name: 'FOV', enabled: true, variables: [], nodes: [
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: at },
  { id: 'get', version: 1, type: 'property.get', settings: { entityId: 'camera_wide', property: 'fovDegrees' }, position: at },
  num('half', 0.5), { id: 'mul', version: 1, type: 'math.multiply', settings: {}, position: at },
  { id: 'set', version: 1, type: 'property.set', settings: { entityId: 'camera_wide', property: 'fovDegrees' }, position: at },
  { id: 'big', version: 1, type: 'event.manual', settings: {}, position: at }, num('huge', 500),
  { id: 'bad', version: 1, type: 'property.set', settings: { entityId: 'camera_wide', property: 'fovDegrees' }, position: at },
 ], connections: [
  wire('a', 'go', 'flow', 'set', 'flow'), wire('b', 'get', 'value', 'mul', 'a'), wire('c', 'half', 'value', 'mul', 'b'), wire('d', 'mul', 'result', 'set', 'value'),
  wire('e', 'big', 'flow', 'bad', 'flow'), wire('f', 'huge', 'value', 'bad', 'value'),
 ] } as BlueprintGraph;
 const session = createSession(makeSmokeScene(), 's');
 session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [g] }] });
 session.advance(0);
 expect(session.runBlueprint('fov', 'go').ok).toBe(true);
 const lens = (frame: ReturnType<typeof session.advance>) => (frame.scene.entities.find(e => e.id === 'camera_wide') as { lens: { fovDegrees: number } }).lens.fovDegrees;
 expect(lens(session.advance(16))).toBe(22.5);
 expect(session.runBlueprint('fov', 'big')).toMatchObject({ ok: false, error: { message: 'Invalid property value' } });
 expect(lens(session.advance(32))).toBe(22.5);
});

it('clears overrides when a show opens', () => {
 const session = start();
 session.advance(0, 0, W); session.advance(16, 16, W);
 const scene = session.inspect();
 expect(session.replaceScene(makeSmokeScene(), scene.revision).ok).toBe(true);
 expect(z(session.advance(32).scene)).toBe(0);
});
