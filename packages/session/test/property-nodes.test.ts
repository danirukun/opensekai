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

it('reads the property values that earlier runs of the same tick wrote', () => {
 // Graph A sets Position to (5, 0, 0); graph B then sets Position = Get Position + (0, 0, 1).
 const reset = { schemaVersion: 1, id: 'a', name: 'A', enabled: true, variables: [], nodes: [
  { id: 'tick', version: 1, type: 'event.update', settings: {}, position: at }, num('five', 5), num('zero', 0),
  { id: 'make', version: 1, type: 'vector3.make', settings: {}, position: at },
  { id: 'set', version: 1, type: 'property.set', settings: { entityId: 'reference', property: 'position' }, position: at },
 ], connections: [wire('a', 'tick', 'flow', 'set', 'flow'), wire('b', 'five', 'value', 'make', 'x'), wire('c', 'zero', 'value', 'make', 'y'), wire('d', 'zero', 'value', 'make', 'z'), wire('e', 'make', 'value', 'set', 'value')] } as BlueprintGraph;
 const step = { schemaVersion: 1, id: 'b', name: 'B', enabled: true, variables: [], nodes: [
  { id: 'tick', version: 1, type: 'event.update', settings: {}, position: at }, num('zero', 0), num('one', 1),
  { id: 'get', version: 1, type: 'property.get', settings: { entityId: 'reference', property: 'position' }, position: at },
  { id: 'make', version: 1, type: 'vector3.make', settings: {}, position: at },
  { id: 'add', version: 1, type: 'vector3.add', settings: {}, position: at },
  { id: 'set', version: 1, type: 'property.set', settings: { entityId: 'reference', property: 'position' }, position: at },
 ], connections: [wire('a', 'tick', 'flow', 'set', 'flow'), wire('b', 'zero', 'value', 'make', 'x'), wire('c', 'zero', 'value', 'make', 'y'), wire('d', 'one', 'value', 'make', 'z'),
  wire('e', 'get', 'value', 'add', 'a'), wire('f', 'make', 'value', 'add', 'b'), wire('g', 'add', 'result', 'set', 'value')] } as BlueprintGraph;
 const session = createSession(makeSmokeScene(), 's');
 session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [reset, step] }] });
 const frame = session.advance(0);
 expect(frame.scene.entities.find(e => e.id === 'reference')!.transform.position).toEqual([5, 0, 1]);
});

const bool = (id: string, value: boolean) => ({ id, version: 1, type: 'value.boolean', settings: { value }, position: at });
const stage = { id: 'stage', name: 'Environment', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'environment', assetId: null };
const withStage = (graph: BlueprintGraph) => {
 const session = createSession(makeSmokeScene(), 's');
 expect(session.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'createEntity', entity: stage as never }] }).ok).toBe(true);
 session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [graph] }] });
 return session;
};
const find = (scene: { entities: { id: string }[] }, id: string) => scene.entities.find(e => e.id === id) as unknown as Record<string, unknown> & { visible: boolean; transform: { position: number[] } };

it('hides and shows the environment with Set Asset Property and commits each change', () => {
 // Manual Trigger hide → Set Asset Property(stage, Visible, false); show → the same with true; Get Asset Property reads it back.
 const g = { schemaVersion: 1, id: 'stage-toggle', name: 'Stage', enabled: true, variables: [], nodes: [
  { id: 'hide', version: 1, type: 'event.manual', settings: {}, position: at }, bool('off', false),
  { id: 'setOff', version: 1, type: 'property.set', settings: { entityId: 'stage', property: 'visible' }, position: at },
  { id: 'show', version: 1, type: 'event.manual', settings: {}, position: at }, bool('on', true),
  { id: 'setOn', version: 1, type: 'property.set', settings: { entityId: 'stage', property: 'visible' }, position: at },
 ], connections: [wire('a', 'hide', 'flow', 'setOff', 'flow'), wire('b', 'off', 'value', 'setOff', 'value'), wire('c', 'show', 'flow', 'setOn', 'flow'), wire('d', 'on', 'value', 'setOn', 'value')] } as BlueprintGraph;
 const session = withStage(g);
 const revision = session.inspect().revision;
 session.advance(0);
 expect(session.runBlueprint('stage-toggle', 'hide').ok).toBe(true);
 expect(find(session.advance(16).scene, 'stage').visible).toBe(false);
 expect(find(session.inspect(), 'stage').visible).toBe(true);
 session.advance(300);
 expect(find(session.inspect(), 'stage')).toMatchObject({ kind: 'environment', visible: false, assetId: null });
 expect(session.inspect().revision).toBe(revision + 1);
 expect(session.runBlueprint('stage-toggle', 'show').ok).toBe(true);
 expect(find(session.advance(316).scene, 'stage').visible).toBe(true);
 session.advance(600);
 expect(find(session.inspect(), 'stage').visible).toBe(true);
 expect(session.inspect().revision).toBe(revision + 2);
});

it('moves the environment and reads its position', () => {
 const g = { schemaVersion: 1, id: 'stage-move', name: 'Stage', enabled: true, variables: [], nodes: [
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: at }, num('one', 1), num('zero', 0),
  { id: 'make', version: 1, type: 'vector3.make', settings: {}, position: at },
  { id: 'move', version: 1, type: 'entity.move', settings: { entityId: 'stage', space: 'world' }, position: at },
  { id: 'copy', version: 1, type: 'event.manual', settings: {}, position: at },
  { id: 'get', version: 1, type: 'property.get', settings: { entityId: 'stage', property: 'position' }, position: at },
  { id: 'set', version: 1, type: 'property.set', settings: { entityId: 'reference', property: 'position' }, position: at },
 ], connections: [wire('a', 'go', 'flow', 'move', 'flow'), wire('b', 'one', 'value', 'make', 'x'), wire('c', 'zero', 'value', 'make', 'y'), wire('d', 'zero', 'value', 'make', 'z'), wire('e', 'make', 'value', 'move', 'delta'),
  wire('f', 'copy', 'flow', 'set', 'flow'), wire('g', 'get', 'value', 'set', 'value')] } as BlueprintGraph;
 const session = withStage(g);
 session.advance(0);
 expect(session.runBlueprint('stage-move', 'go').ok).toBe(true);
 expect(find(session.advance(16).scene, 'stage').transform.position).toEqual([1, 0, 0]);
 expect(session.runBlueprint('stage-move', 'copy').ok).toBe(true);
 expect(find(session.advance(32).scene, 'reference').transform.position).toEqual([1, 0, 0]);
 session.advance(300);
 expect(find(session.inspect(), 'stage').transform.position).toEqual([1, 0, 0]);
});

it('sets the camera Render Environment, commits it, and a patch drops the override', () => {
 const g = { schemaVersion: 1, id: 'render', name: 'Render', enabled: true, variables: [], nodes: [
  { id: 'off', version: 1, type: 'event.manual', settings: {}, position: at }, bool('no', false),
  { id: 'setOff', version: 1, type: 'property.set', settings: { entityId: 'camera_wide', property: 'renderEnvironment' }, position: at },
  { id: 'on', version: 1, type: 'event.manual', settings: {}, position: at }, bool('yes', true),
  { id: 'setOn', version: 1, type: 'property.set', settings: { entityId: 'camera_wide', property: 'renderEnvironment' }, position: at },
 ], connections: [wire('a', 'off', 'flow', 'setOff', 'flow'), wire('b', 'no', 'value', 'setOff', 'value'), wire('c', 'on', 'flow', 'setOn', 'flow'), wire('d', 'yes', 'value', 'setOn', 'value')] } as BlueprintGraph;
 const session = createSession(makeSmokeScene(), 's');
 session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [g] }] });
 const revision = session.inspect().revision;
 session.advance(0);
 // Writing the default true to a camera without the field changes nothing and commits nothing.
 expect(session.runBlueprint('render', 'on').ok).toBe(true);
 session.advance(300);
 expect(session.inspect().revision).toBe(revision);
 expect(find(session.inspect(), 'camera_wide')).not.toHaveProperty('renderEnvironment');
 expect(session.runBlueprint('render', 'off').ok).toBe(true);
 expect(find(session.advance(316).scene, 'camera_wide').renderEnvironment).toBe(false);
 session.advance(600);
 expect(find(session.inspect(), 'camera_wide').renderEnvironment).toBe(false);
 expect(session.inspect().revision).toBe(revision + 1);

 // A pending true override is dropped by an editor patch, so the frame follows the patch.
 expect(session.runBlueprint('render', 'on').ok).toBe(true);
 expect(find(session.advance(616).scene, 'camera_wide').renderEnvironment).toBe(true);
 const scene = session.inspect();
 expect(session.applyPatch({ sceneId: scene.sceneId, expectedRevision: scene.revision, operations: [{ kind: 'setCameraRenderEnvironment', entityId: 'camera_wide', renderEnvironment: false }] }).ok).toBe(true);
 expect(find(session.advance(632).scene, 'camera_wide').renderEnvironment).toBe(false);
 session.advance(1000);
 expect(find(session.inspect(), 'camera_wide').renderEnvironment).toBe(false);
});
