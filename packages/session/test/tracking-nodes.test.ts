import { expect, it } from 'vitest';
import { blueprintPorts, defaultBlueprintSettings, PENDULUM_DEFAULT_INPUT, makeSmokeScene, NODE_DEFINITIONS, nodeDefinition, type AvatarPose, type BlueprintGraph, type BlueprintNode, type BlueprintNodeOf, type TrackingStatus } from '@opensekai/contracts';
import { boneEuler } from '../src/bone-offsets';
import { emptyState, EVALUATORS, NO_ENV, type RunEnv, type RunState } from '../src/blueprint-eval';
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

const pendulumSettings = (extra: Partial<BlueprintNodeOf<'tracking.pendulum'>['settings']> = {}) =>
 ({ ...defaultBlueprintSettings('tracking.pendulum', { avatarId: avatar.id, keystroke })!, ...extra }) as BlueprintNodeOf<'tracking.pendulum'>['settings'];
const pendulumNode = (settings = pendulumSettings()) => ({ id: 'p', version: 1, position: at, type: 'tracking.pendulum', settings }) as BlueprintNodeOf<'tracking.pendulum'>;
const yawed = (degrees: number) => headPose({ bones: { head: { space: 'normalized', rotation: [0, Math.sin(degrees * Math.PI / 360), 0, Math.cos(degrees * Math.PI / 360)] } } });
const arm = { length: 10, mass: 0.25, drag: 0.25, spring: 0.5, damping: 0.5, gravity: 1 };
const pendulumValue = (node: BlueprintNodeOf<'tracking.pendulum'>, state: RunState, extra: Partial<RunEnv>, entities = scene) =>
 (EVALUATORS['tracking.pendulum'] as unknown as { data: (...args: unknown[]) => unknown }).data(node, 'value', () => 0, state, { ...NO_ENV, scene: () => entities, ...extra }) as number;

it('Pendulum defaults to one head yaw input and no arms, and limits inputs and arms', () => {
 const settings = pendulumSettings();
 expect(settings).toEqual({ entityId: avatar.id, inputs: [{ kind: 'headYaw', blendShape: null, weight: 1, scale: 5, absolute: false, clamp: [-100, 100] }], inputSmoothing: 0.1, arms: [] });
 const schema = nodeDefinition('tracking.pendulum').settings;
 expect(schema.safeParse(settings).success).toBe(true);
 expect(defaultBlueprintSettings('tracking.pendulum', { keystroke })).toBeNull();
 expect(schema.safeParse({ ...settings, inputs: Array.from({ length: 8 }, () => settings.inputs[0]), arms: Array.from({ length: 4 }, () => arm) }).success).toBe(true);
 expect(schema.safeParse({ ...settings, inputs: Array.from({ length: 9 }, () => settings.inputs[0]) }).success).toBe(false);
 expect(schema.safeParse({ ...settings, inputs: [] }).success).toBe(false);
 expect(schema.safeParse({ ...settings, arms: Array.from({ length: 5 }, () => arm) }).success).toBe(false);
 expect(schema.safeParse({ ...settings, arms: [{ ...arm, mass: -1 }] }).success).toBe(false);
 expect(schema.safeParse({ ...settings, inputSmoothing: 6 }).success).toBe(false);
 expect(schema.safeParse({ ...settings, inputs: [{ ...settings.inputs[0], clamp: [1, -1] }] }).success).toBe(false);
 expect(schema.safeParse({ ...settings, inputs: [{ ...settings.inputs[0], kind: 'blendShape' }] }).success).toBe(false);
 expect(schema.safeParse({ ...settings, inputs: [{ ...settings.inputs[0], kind: 'blendShape', blendShape: 'jawOpen' }] }).success).toBe(true);
 expect(schema.safeParse({ ...settings, inputs: [{ ...settings.inputs[0], kind: 'blendShape', blendShape: 'notAShape' }] }).success).toBe(false);
 expect(NODE_DEFINITIONS.find(d => d.type === 'tracking.pendulum')).toMatchObject({ label: 'Pendulum', category: 'Tracking' });
 expect(blueprintPorts({ ...pendulumNode(settings) } as BlueprintNode).outputs).toEqual({ value: 'number' });
});

it('Pendulum steps once for each tick: a second read in the same tick gives the stored value', () => {
 const node = pendulumNode(), state = emptyState();
 let previous = yawed(0);
 const read = (tickMs: number) => pendulumValue(node, state, { deltaSeconds: 1 / 60, tickMs, previousPose: () => previous });
 expect(read(0)).toBe(0);
 previous = yawed(90);
 const first = read(16), stored = state.nodes.get('p');
 expect(first).toBeGreaterThan(0);
 expect(first).toBeLessThan(0.5);
 expect(read(16)).toBe(first);
 expect(state.nodes.get('p')).toBe(stored);
 const next = read(32);
 expect(next).toBeGreaterThan(first);
 expect(state.nodes.get('p')).not.toBe(stored);
});

it('Pendulum keeps its state with a time delta of 0, and limits a long delta to 1 s', () => {
 const node = pendulumNode(pendulumSettings({ inputSmoothing: 0 })), state = emptyState();
 const read = (deltaSeconds: number, tickMs: number, degrees: number) => pendulumValue(node, state, { deltaSeconds, tickMs, previousPose: () => yawed(degrees) });
 expect(read(0, 0, 0)).toBe(0);
 const stored = state.nodes.get('p');
 expect(read(0, 16, 90)).toBe(0);
 expect(state.nodes.get('p')).toBe(stored);
 expect(read(1 / 60, 32, 90)).toBeCloseTo(2.5);
 const armed = pendulumNode(pendulumSettings({ arms: [arm] }));
 const stepped = (deltaSeconds: number) => {
  const other = emptyState();
  pendulumValue(armed, other, { deltaSeconds: 1 / 60, tickMs: 0, previousPose: () => yawed(0) });
  return { value: pendulumValue(armed, other, { deltaSeconds, tickMs: 16, previousPose: () => yawed(90) }), state: other.nodes.get('p') };
 };
 const long = stepped(3600), second = stepped(1);
 expect(long.value).toBe(second.value);
 expect(long.state).toEqual(second.state);
 expect(Number.isFinite(long.value)).toBe(true);
 expect(Math.abs(long.value)).toBeLessThanOrEqual(2 * PENDULUM_DEFAULT_INPUT.scale);
});

it('Pendulum starts again when the arm count changes', () => {
 const state = emptyState(), env = (tickMs: number) => ({ deltaSeconds: 1 / 60, tickMs, previousPose: () => yawed(90) });
 const two = pendulumNode(pendulumSettings({ arms: [arm, arm] }));
 pendulumValue(two, state, env(0));
 pendulumValue(two, state, env(16));
 expect((state.nodes.get('p') as { angles: number[] }).angles).toHaveLength(2);
 const value = pendulumValue(pendulumNode(pendulumSettings({ arms: [arm, arm, arm] })), state, env(32));
 expect(Number.isFinite(value)).toBe(true);
 expect(state.nodes.get('p')).toMatchObject({ angles: [0, 0, 0], velocities: [0, 0, 0], mixVelocity: 0 });
 // With fewer arms, the stale angle of a removed arm would otherwise stay the output.
 pendulumValue(pendulumNode(pendulumSettings({ arms: [arm, arm, arm] })), state, env(48));
 const one = pendulumValue(pendulumNode(pendulumSettings({ arms: [arm] })), state, env(64));
 expect(one).toBe(0);
 expect(state.nodes.get('p')).toMatchObject({ angles: [0], velocities: [0], mixVelocity: 0 });
});

it('Pendulum reads blend shapes and head position from the previous pose', () => {
 const blend = pendulumNode(pendulumSettings({ inputSmoothing: 0, inputs: [{ kind: 'blendShape', blendShape: 'jawOpen', weight: 1, scale: 1, absolute: false, clamp: [-1, 1] }] }));
 expect(pendulumValue(blend, emptyState(), { previousPose: () => pose({ jawOpen: 0.4 }) })).toBeCloseTo(0.4);
 const position = pendulumNode(pendulumSettings({ inputSmoothing: 0, inputs: [{ kind: 'headPositionZ', blendShape: null, weight: 0.5, scale: 20, absolute: false, clamp: [-1, 1] }] }));
 expect(pendulumValue(position, emptyState(), { previousPose: () => headPose({ headPosition: [0, 0, 0.01] }) })).toBeCloseTo(0.1);
 expect(pendulumValue(position, emptyState(), { previousPose: () => null })).toBe(0);
});

it('Pendulum throws when the character is not in the scene', () => {
 expect(() => pendulumValue(pendulumNode(), emptyState(), {}, { ...scene, entities: [] })).toThrow('Character is unavailable');
});
