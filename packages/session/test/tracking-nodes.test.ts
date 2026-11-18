import { expect, it } from 'vitest';
import { blueprintPorts, defaultBlueprintSettings, makeSmokeScene, NODE_DEFINITIONS, nodeDefinition, type AvatarPose, type BlueprintGraph, type BlueprintNode, type BlueprintNodeOf, type TrackingStatus } from '@opensekai/contracts';
import { boneEuler } from '../src/bone-offsets';
import { EVALUATORS, NO_ENV } from '../src/blueprint-eval';
import { trackedBlendShape, trackingTrigger, type TrackingEdge } from '../src/blueprint-eval/tracking';
import { createBlueprintRuntime } from '../src/blueprint-runtime';

const keystroke = { code: 'KeyH', control: true, alt: true, shift: false, meta: false };
const scene = makeSmokeScene();
const avatar = scene.entities.find(entity => entity.kind === 'avatar')!;
const pose = (expressions: Record<string, number>): AvatarPose => ({ avatarId: avatar.id, bones: {}, expressions });
const node = { id: 'n', version: 1, position: { x: 0, y: 0 }, type: 'tracking.getBlendShape', settings: { entityId: avatar.id, blendShape: 'eyeBlinkLeft' } } as BlueprintNodeOf<'tracking.getBlendShape'>;
const read = (previous: AvatarPose | null) => (EVALUATORS['tracking.getBlendShape'] as unknown as { data: (...args: unknown[]) => unknown }).data(node, {}, {}, {}, { ...NO_ENV, scene: () => scene, previousPose: () => previous });

it('reads a blend shape from the previous pose by its canonical name', () => {
 expect(read(pose({ eyeBlink_L: 0.6 }))).toBe(0.6);
 expect(read(pose({ eyeBlinkLeft: 0.2, eyeBlink_L: 0.6 }))).toBe(0.6);
 expect(read(pose({ jawOpen: 0.9 }))).toBe(0);
});

it('reads 0 without a pose', () => {
 expect(read(null)).toBe(0);
 expect(trackedBlendShape(null, 'jawOpen')).toBe(0);
});

it('parses its defaults and sits in the Tracking category', () => {
 const settings = defaultBlueprintSettings('tracking.getBlendShape', { avatarId: 'a', keystroke });
 expect(nodeDefinition('tracking.getBlendShape').settings.safeParse(settings).success).toBe(true);
 expect(defaultBlueprintSettings('tracking.getBlendShape', { keystroke })).toBeNull();
 expect(NODE_DEFINITIONS.find(d => d.type === 'tracking.getBlendShape')).toMatchObject({ label: 'Get Tracking Blend Shape', category: 'Tracking' });
});

const at = { x: 0, y: 0 };
const trigger = <T extends 'tracking.onBlendShapeThreshold' | 'tracking.onLost' | 'tracking.onFound'>(type: T, settings: BlueprintNodeOf<T>['settings']) => ({ id: 't', version: 1, position: at, type, settings }) as BlueprintNodeOf<T>;
const threshold = trigger('tracking.onBlendShapeThreshold', { entityId: avatar.id, blendShape: 'jawOpen', threshold: 0.5, release: 0.4 });
const status = (state: TrackingStatus['state']): TrackingStatus => ({ sourceId: 'face', generation: 1, state, packets: 1, invalidPackets: 0, lastReceivedAtMs: 0, error: null });
const env = (extra: object) => ({ held: new Set<string>(), scene: () => scene, ...extra });

it('threshold fires rise once when the value crosses up, and fall once below release', () => {
 let edge: TrackingEdge | undefined;
 const ports = [0.3, 0.6, 0.7, 0.45, 0.35, 0.6].map(value => {
  const result = trackingTrigger(threshold, edge, env({ previousPose: () => pose({ jawOpen: value }) }), 0);
  edge = result.edge;
  return result.port;
 });
 expect(ports).toEqual([null, 'rise', null, null, 'fall', 'rise']);
});

it('threshold reads 0 without a pose and does not throw', () => {
 expect(trackingTrigger(threshold, undefined, env({}), 0)).toEqual({ edge: { kind: 'threshold', above: false }, port: null });
});

it('lost fires once after `after` seconds without receiving, only after the source was receiving', () => {
 const lost = trigger('tracking.onLost', { sourceId: 'face', after: 2 });
 let edge: TrackingEdge | undefined;
 const tick = (state: TrackingStatus['state'] | null, nowMs: number) => {
  const result = trackingTrigger(lost, edge, env({ trackingStatus: () => state ? status(state) : null }), nowMs);
  edge = result.edge;
  return result.port;
 };
 expect([tick('stale', 0), tick(null, 5000)]).toEqual([null, null]);
 expect([tick('receiving', 6000), tick('stale', 6100), tick('stale', 6800), tick('receiving', 6900)]).toEqual([null, null, null, null]);
 expect([tick('stale', 7000), tick('stale', 8999), tick('stale', 9000), tick('stale', 12000), tick('error', 13000)]).toEqual([null, null, 'flow', null, null]);
});

it('found fires once on receiving after a lost, not on the first receiving', () => {
 const found = trigger('tracking.onFound', { sourceId: 'face' });
 let edge: TrackingEdge | undefined;
 const tick = (state: TrackingStatus['state'], nowMs: number) => {
  const result = trackingTrigger(found, edge, env({ trackingStatus: () => status(state) }), nowMs);
  edge = result.edge;
  return result.port;
 };
 expect([tick('receiving', 0), tick('receiving', 100), tick('stale', 200), tick('receiving', 300)]).toEqual([null, null, null, null]);
 expect([tick('stale', 400), tick('stale', 2500), tick('receiving', 2600), tick('receiving', 2700)]).toEqual([null, null, 'flow', null]);
});

const hide = (id: string) => ({ id, version: 1, position: at, type: 'scene.toggleVisibility', settings: { entityId: 'marker' } });
const graph = (): BlueprintGraph => ({ schemaVersion: 1, id: 'g', name: 'G', enabled: true, variables: [],
 nodes: [{ ...threshold, id: 'jaw' }, { id: 'up', version: 1, position: at, type: 'event.update', settings: {} }, hide('on-rise'), hide('on-update')],
 connections: [{ id: 'c1', sourceNodeId: 'jaw', sourcePort: 'rise', targetNodeId: 'on-rise', targetPort: 'flow' }, { id: 'c2', sourceNodeId: 'up', sourcePort: 'flow', targetNodeId: 'on-update', targetPort: 'flow' }] } as BlueprintGraph);

it('runs tracking triggers in event order, before On Update', () => {
 const runtime = createBlueprintRuntime();
 expect(runtime.install([graph()]).ok).toBe(true);
 const step = (value: number, nowMs: number) => runtime.step([{ kind: 'tracking' }, { kind: 'update' }], nowMs, undefined, env({ previousPose: () => pose({ jawOpen: value }) }));
 step(0, 0);
 expect(step(0.6, 16).map(run => run.nodeId)).toEqual(['jaw', 'up']);
 expect(step(0.6, 32).map(run => run.nodeId)).toEqual(['up']);
});

it('a reinstalled graph starts with empty edges', () => {
 const runtime = createBlueprintRuntime();
 runtime.install([graph()]);
 const step = (nowMs: number) => runtime.step([{ kind: 'tracking' }], nowMs, undefined, env({ previousPose: () => pose({ jawOpen: 0.6 }) })).map(run => run.nodeId);
 expect([step(0), step(16)]).toEqual([['jaw'], []]);
 const changed = graph();
 changed.nodes = changed.nodes.map(node => node.id === 'jaw' ? { ...node, settings: { ...node.settings, threshold: 0.55 } } : node) as BlueprintGraph['nodes'];
 runtime.install([changed]);
 expect(step(32)).toEqual(['jaw']);
});

it('parses defaults and rejects a release at or above the threshold', () => {
 const refs = { avatarId: 'a', trackingSourceId: 's', keystroke };
 for (const type of ['tracking.onBlendShapeThreshold', 'tracking.onLost', 'tracking.onFound'] as const)
  expect(nodeDefinition(type).settings.safeParse(defaultBlueprintSettings(type, refs)).success).toBe(true);
 expect(defaultBlueprintSettings('tracking.onBlendShapeThreshold', refs)).toMatchObject({ threshold: 0.5, release: 0.4 });
 expect(defaultBlueprintSettings('tracking.onLost', refs)).toMatchObject({ after: 2 });
 const settings = nodeDefinition('tracking.onBlendShapeThreshold').settings;
 expect(settings.safeParse({ entityId: 'a', blendShape: 'jawOpen', threshold: 0.5, release: 0.5 }).success).toBe(false);
 expect(settings.safeParse({ entityId: 'a', blendShape: 'jawOpen', threshold: 1.1, release: 0.5 }).success).toBe(false);
 const lost = nodeDefinition('tracking.onLost').settings;
 expect([0.05, 0.1, 60, 61].map(after => lost.safeParse({ sourceId: 's', after }).success)).toEqual([false, true, true, false]);
 expect(NODE_DEFINITIONS.find(d => d.type === 'tracking.onLost')).toMatchObject({ label: 'On Tracking Lost', category: 'Tracking' });
});

it('lost fires again after a found and a second loss of 2 s or more', () => {
 const lost = trigger('tracking.onLost', { sourceId: 'face', after: 2 });
 let edge: TrackingEdge | undefined;
 const tick = (state: TrackingStatus['state'], nowMs: number) => {
  const result = trackingTrigger(lost, edge, env({ trackingStatus: () => status(state) }), nowMs);
  edge = result.edge;
  return result.port;
 };
 expect([tick('receiving', 0), tick('stale', 100), tick('stale', 2100), tick('receiving', 2200)]).toEqual([null, null, 'flow', null]);
 expect([tick('stale', 3000), tick('stale', 4999), tick('stale', 5000), tick('stale', 9000)]).toEqual([null, null, 'flow', null]);
});

it('a reinstall with unchanged logic keeps its edges', () => {
 const runtime = createBlueprintRuntime();
 runtime.install([graph()]);
 const step = (nowMs: number) => runtime.step([{ kind: 'tracking' }], nowMs, undefined, env({ previousPose: () => pose({ jawOpen: 0.6 }) })).map(run => run.nodeId);
 expect(step(0)).toEqual(['jaw']);
 runtime.install([graph()]);
 expect(step(16)).toEqual([]);
});

const headNode = { id: 'h', version: 1, position: { x: 0, y: 0 }, type: 'tracking.getHeadPose', settings: { entityId: avatar.id } } as BlueprintNodeOf<'tracking.getHeadPose'>;
const headOutput = (output: 'rotation' | 'position' | 'tracked', previous: AvatarPose | null, entities = scene) =>
 (EVALUATORS['tracking.getHeadPose'] as unknown as { data: (...args: unknown[]) => unknown }).data(headNode, output, {}, {}, { ...NO_ENV, scene: () => entities, previousPose: () => previous });
const headPose = (extra: Partial<AvatarPose>): AvatarPose => ({ avatarId: avatar.id, bones: {}, expressions: {}, ...extra });
const turned: AvatarPose['bones'] = { head: { space: 'normalized', rotation: [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)] } };

it('reads the head rotation as Get Bone Rotation does for the head', () => {
 const previous = headPose({ bones: turned });
 expect(headOutput('rotation', previous)).toEqual(boneEuler(previous, 'head'));
 expect((headOutput('rotation', previous) as number[])[1]).toBeCloseTo(45);
 expect(headOutput('rotation', null)).toEqual(boneEuler(null, 'head'));
});

it('reads the head position from the previous pose, and zero without one', () => {
 expect(headOutput('position', headPose({ headPosition: [0.01, -0.02, 0.03] }))).toEqual([0.01, -0.02, 0.03]);
 expect(headOutput('position', headPose({}))).toEqual([0, 0, 0]);
 expect(headOutput('position', null)).toEqual([0, 0, 0]);
});

it('reads tracked as the weight of the head bone, 1 without a weight, 0 without a head bone or a pose', () => {
 expect(headOutput('tracked', headPose({ bones: { head: { ...turned.head!, weight: 0.4 } } }))).toBe(0.4);
 expect(headOutput('tracked', headPose({ bones: { head: { ...turned.head!, weight: 0 } } }))).toBe(0);
 expect(headOutput('tracked', headPose({ bones: turned }))).toBe(1);
 expect(headOutput('tracked', headPose({ bones: { chest: turned.head! } }))).toBe(0);
 expect(headOutput('tracked', null)).toBe(0);
});

it('throws when the character is not in the scene', () => {
 expect(() => headOutput('tracked', null, { ...scene, entities: [] })).toThrow('Character is unavailable');
});

it('Get Head Pose parses its defaults and sits in the Tracking category with three outputs', () => {
 const settings = defaultBlueprintSettings('tracking.getHeadPose', { avatarId: 'a', keystroke });
 expect(nodeDefinition('tracking.getHeadPose').settings.safeParse(settings).success).toBe(true);
 expect(defaultBlueprintSettings('tracking.getHeadPose', { keystroke })).toBeNull();
 expect(NODE_DEFINITIONS.find(d => d.type === 'tracking.getHeadPose')).toMatchObject({ label: 'Get Head Pose', category: 'Tracking' });
 expect(blueprintPorts({ ...headNode, settings } as BlueprintNode).outputs).toEqual({ rotation: 'vector3', position: 'vector3', tracked: 'number' });
});
