import { describe, expect, it } from 'vitest';
import { BlueprintGraphSchema, quaternionFromEuler, rotateByQuaternion, type BlueprintGraph, type BlueprintNode, type Reply, type Vec3 } from '@opensekai/contracts';
import { compileIntents, orbitSteps, targetPoint, WORDS, type Intent, type Proposal } from '../src';
import { ctx, graphs, scene } from './context';

const data = <T>(r: Reply<T>): T => { if (!r.ok) throw new Error(r.error.message); return r.data; };
const graphOf = (p: Proposal, i = 0): BlueprintGraph => {
 const op = p.blueprintOps[i];
 if (op?.kind !== 'createGraph') throw new Error('not a createGraph');
 return op.graph;
};
const performer = scene.entities.find(e => e.id === 'performer')!;
const cameraWide = scene.entities.find(e => e.id === 'camera_wide')!;
type SetNode = Extract<BlueprintNode, { type: 'property.set' }>;
const node = (g: BlueprintGraph, id: string) => g.nodes.find(n => n.id === id)!;
const wire = (g: BlueprintGraph, from: string, port: string) => g.connections.find(c => c.sourceNodeId === from && c.sourcePort === port)?.targetNodeId;
// The steps in play order: each position node and the rotation node after its `exit`.
const steps = (g: BlueprintGraph): { position: SetNode; rotation: SetNode }[] => {
 const out: { position: SetNode; rotation: SetNode }[] = [];
 for (let id = wire(g, 'play', 'flow'); id && !out.some(s => s.position.id === id); id = wire(g, id, 'transitionEnd'))
  out.push({ position: node(g, id) as SetNode, rotation: node(g, wire(g, id, 'exit')!) as SetNode });
 return out;
};
const vec = (n: SetNode) => n.inputs!.value as Vec3;
const angle = (a: Vec3, b: Vec3) =>
 Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)))) * 180 / Math.PI;
const aimError = (position: Vec3, euler: Vec3, aim: Vec3) =>
 angle(rotateByQuaternion([0, 0, -1], quaternionFromEuler(euler)), [aim[0] - position[0], aim[1] - position[1], aim[2] - position[2]]);
const flat = (p: Vec3, c: Vec3) => Math.hypot(p[0] - c[0], p[2] - c[2]);
const move = (over: Partial<Extract<Intent, { tool: 'camera_move' }>>): Intent => ({ tool: 'camera_move', camera: '@e2', target: '@e1', kind: 'orbit', ...over });

describe('orbitSteps', () => {
 it('orbit steps', () => {
  expect(orbitSteps(90)).toEqual([15, 30, 45, 60, 75, 90]);
  expect(orbitSteps(100)).toHaveLength(7);
  expect(orbitSteps(100).at(-1)).toBeCloseTo(100);
  expect(orbitSteps(100).every((a, i, all) => Math.abs(a - (i === 0 ? 0 : all[i - 1]!) - 100 / 7) < 1e-9)).toBe(true);
  expect(orbitSteps(360)).toHaveLength(24);
  expect(orbitSteps(15)).toEqual([15]);
 });
});

describe('compileIntents: camera_move', () => {
 it('compiles an orbit with push-in to a Play chain', () => {
  const r = compileIntents([move({ angleDegrees: 90, duration: 'slow', endFraming: 'closeUp' })], ctx());
  const p = data(r);
  const graph = graphOf(p);
  expect(BlueprintGraphSchema.safeParse(graph).success).toBe(true);
  expect(graph.nodes.filter(n => n.type === 'event.manual')).toHaveLength(1);
  expect(graph.nodes.some(n => n.type === 'event.enable')).toBe(false);
  expect(graph.nodes.filter(n => n.type === 'property.set')).toHaveLength(13);
  const chain = steps(graph);
  expect(chain).toHaveLength(6);
  for (const { position, rotation } of chain) {
   expect(position.settings).toMatchObject({ entityId: 'camera_wide', property: 'position' });
   expect(rotation.settings).toMatchObject({ entityId: 'camera_wide', property: 'rotation' });
   expect(rotation.settings.transitionSeconds).toBe(position.settings.transitionSeconds);
   expect(rotation.settings.easing).toBe(position.settings.easing);
  }
  expect(chain.reduce((t, s) => t + s.position.settings.transitionSeconds!, 0)).toBeCloseTo(WORDS.duration.slow);
  const aim = targetPoint(performer, 'closeUp');
  for (const { position, rotation } of chain) expect(aimError(vec(position), vec(rotation), aim)).toBeLessThan(1);
  // The radius narrows to the close-up distance; turn `right` (the default) moves the camera to its right (+X from the front).
  const end = vec(chain.at(-1)!.position);
  expect(flat(end, performer.transform.position)).toBeCloseTo(WORDS.framing.closeUp.distance);
  expect(end[0]).toBeGreaterThan(1);
  expect(Math.abs(end[2])).toBeLessThan(1e-6);
  const fov = node(graph, wire(graph, chain.at(-1)!.rotation.id, 'exit')!) as SetNode;
  expect(fov.settings).toMatchObject({ entityId: 'camera_wide', property: 'fovDegrees' });
  expect(fov.inputs!.value).toBe(WORDS.framing.closeUp.fovDegrees);
  expect(wire(graph, chain.at(-1)!.position.id, 'transitionEnd')).toBeUndefined();
  expect(r.ok && r.data.play).toEqual([{ graphId: graph.id, nodeId: expect.any(String) }]);
  expect(node(graph, p.play[0]!.nodeId).type).toBe('event.manual');
  expect(p.sceneOps).toEqual([]);
  expect(p.created.blueprints).toEqual([graph.id]);
  expect(p.refs.blueprints[graph.id]).toBe('@b1');
  expect(p.refs.owned).toEqual([graph.id]);
  expect(p.touched.blueprints).toEqual([]);
 });

 it('a full loop has no duplicate end point and wires back to the start', () => {
  const graph = graphOf(data(compileIntents([move({ angleDegrees: 360, loop: true, turn: 'left' })], ctx())));
  const chain = steps(graph);
  expect(chain).toHaveLength(24);
  const points = chain.map(s => vec(s.position).map(v => v.toFixed(3)).join());
  expect(new Set(points).size).toBe(24);
  expect(wire(graph, chain.at(-1)!.position.id, 'transitionEnd')).toBe(chain[0]!.position.id);
  // The last step lands on the start point, so the loop has no seam; with no end framing the radius and height stay.
  vec(chain.at(-1)!.position).forEach((v, i) => expect(v).toBeCloseTo(cameraWide.transform.position[i]!));
  for (const s of chain) expect(flat(vec(s.position), performer.transform.position)).toBeCloseTo(3);
  // Turn left: the first step moves the camera to its left (−X from the front).
  expect(vec(chain[0]!.position)[0]).toBeLessThan(0);
  // A loop keeps one speed, so every step is linear.
  expect(chain.every(s => s.position.settings.easing === 'Linear')).toBe(true);
  expect(graph.nodes.some(n => n.settings && 'property' in n.settings && n.settings.property === 'fovDegrees')).toBe(false);
 });

 it('eases in on the first step and out on the last', () => {
  const chain = steps(graphOf(data(compileIntents([move({ angleDegrees: 45, easing: 'smooth' })], ctx()))));
  expect(chain.map(s => s.position.settings.easing)).toEqual(['InSine', 'Linear', 'OutSine']);
  const one = steps(graphOf(data(compileIntents([move({ kind: 'pushIn', easing: 'smooth' })], ctx()))));
  expect(one.map(s => s.position.settings.easing)).toEqual(['InOutSine']);
 });

 it('dolly and push-in are one straight step', () => {
  const p = data(compileIntents([move({ kind: 'dolly' }), move({ kind: 'pushIn', duration: 'quick' }), move({ kind: 'pullOut', endFraming: 'wide' }), move({ kind: 'crane', rise: 'up' })], ctx()));
  expect(p.blueprintOps).toHaveLength(4);
  const [dolly, push, pull, crane] = [0, 1, 2, 3].map(i => graphOf(p, i));
  const start = cameraWide.transform.position;
  const last = (g: BlueprintGraph) => steps(g)[0]!;
  for (const g of [dolly!, push!, pull!, crane!]) {
   expect(BlueprintGraphSchema.safeParse(g).success).toBe(true);
   expect(steps(g)).toHaveLength(1);
   expect(g.nodes.filter(n => n.type === 'property.set')).toHaveLength(g === pull ? 3 : 2);
  }
  const dist = (g: BlueprintGraph, framing: 'medium' | 'closeUp' | 'wide') => { const v = vec(last(g).position), a = targetPoint(performer, framing); return Math.hypot(v[0] - a[0], v[1] - a[1], v[2] - a[2]); };
  expect(dist(dolly!, 'medium')).toBeCloseTo(WORDS.framing.medium.distance);
  expect(dist(push!, 'closeUp')).toBeCloseTo(WORDS.framing.closeUp.distance);
  expect(last(push!).position.settings.transitionSeconds).toBe(WORDS.duration.quick);
  expect(dist(pull!, 'wide')).toBeCloseTo(WORDS.framing.wide.distance);
  expect(last(dolly!).position.settings.transitionSeconds).toBe(WORDS.duration.normal);
  // Push-in stays on the line from the camera to the aim point.
  const a = targetPoint(performer, 'closeUp'), v = vec(last(push!).position);
  expect(angle([start[0] - a[0], start[1] - a[1], start[2] - a[2]], [v[0] - a[0], v[1] - a[1], v[2] - a[2]])).toBeLessThan(1e-6);
  const c = vec(last(crane!).position);
  expect([c[0], c[2]]).toEqual([start[0], start[2]]);
  expect(c[1]).toBeGreaterThan(start[1] + 1);
  for (const [g, f] of [[dolly!, 'medium'], [push!, 'closeUp'], [pull!, 'wide'], [crane!, 'medium']] as const)
   expect(aimError(vec(last(g).position), vec(last(g).rotation), targetPoint(performer, f))).toBeLessThan(1);
  expect(p.play.map(x => x.graphId)).toEqual([dolly!.id, push!.id, pull!.id, crane!.id]);
  expect(new Set(p.blueprintOps.map((_, i) => graphOf(p, i).id)).size).toBe(4);
 });

 it('keeps a crane down above the floor', () => {
  const s = steps(graphOf(data(compileIntents([move({ kind: 'crane', rise: 'down' })], ctx()))))[0]!;
  expect(vec(s.position)[1]).toBeGreaterThan(0);
  expect(vec(s.position)[1]).toBeLessThan(cameraWide.transform.position[1]);
 });

 it('moves a camera that an earlier intent created', () => {
  const p = data(compileIntents([{ tool: 'camera_add', framing: 'medium' }, move({ camera: '@e7', kind: 'pushIn' })], ctx()));
  expect(steps(graphOf(p))[0]!.position.settings.entityId).toBe('chat_camera_1');
 });

 it('falls back to the first avatar and rejects a reference that is not a camera', () => {
  const p = data(compileIntents([{ tool: 'camera_move', camera: '@e2', kind: 'orbit' }], ctx()));
  expect(p.notes).toEqual([{ code: 'targetDefaulted', ref: '@e1' }]);
  expect(compileIntents([move({ camera: '@e1' })], ctx())).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: expect.any(String), ids: ['@e1'] } });
  expect(compileIntents([move({ camera: '@e99' })], ctx())).toMatchObject({ ok: false, error: { ids: ['@e99'] } });
  expect(compileIntents([move({ target: '@e2' })], ctx())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['@e2'] } });
 });

 it('fails at the Blueprint limit with a message that names it', () => {
  const r = compileIntents([move({})], ctx({ blueprints: graphs(8) }));
  expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringMatching(/8 Blueprints/) } });
  const across = compileIntents([move({}), move({ kind: 'pushIn' })], ctx({ blueprints: graphs(7) }));
  expect(across).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringMatching(/8 Blueprints/) } });
 });
});
