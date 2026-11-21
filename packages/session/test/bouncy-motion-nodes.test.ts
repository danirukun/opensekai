import { describe, expect, it } from 'vitest';
import { makeSmokeScene, type AvatarPose, type AvatarTracking, type BlueprintNodeOf, type SceneView } from '@opensekai/contracts';
import type { BlueprintEffect } from '../src/blueprint';
import { emptyState, EVALUATORS, NO_ENV, type FlowContext } from '../src/blueprint-eval';
import { eulerToQuat } from '../src/bone-offsets';

const scene = makeSmokeScene();
const avatar = scene.entities.find(entity => entity.kind === 'avatar')!;
const pose = (extra: Partial<AvatarPose>): AvatarPose => ({ avatarId: avatar.id, bones: {}, expressions: {}, ...extra });
const pitched = (degrees: number, jawOpen = 0) => pose({ bones: { head: { space: 'normalized', rotation: eulerToQuat([degrees, 0, 0]) } }, expressions: { jawOpen } });

describe('Bouncy Spring', () => {
 const settings = (over: Partial<BlueprintNodeOf<'tracking.bouncySpring'>['settings']> = {}) =>
  ({ entityId: avatar.id, pitchWeight: 1, pitchScale: 1, jawWeight: 0.5, jawScale: 1, spring: 0.5, damping: 0.5, inputSmoothing: 0.05, ...over }) as BlueprintNodeOf<'tracking.bouncySpring'>['settings'];
 const node = (over: Partial<BlueprintNodeOf<'tracking.bouncySpring'>['settings']> = {}) => ({ id: 'bs', version: 1, position: { x: 0, y: 0 }, type: 'tracking.bouncySpring', settings: settings(over) }) as BlueprintNodeOf<'tracking.bouncySpring'>;
 const read = (n: BlueprintNodeOf<'tracking.bouncySpring'>, state: ReturnType<typeof emptyState>, extra: object) =>
  (EVALUATORS['tracking.bouncySpring'] as unknown as { data: (...args: unknown[]) => unknown }).data(n, 'value', () => 0, state, { ...NO_ENV, scene: () => scene, ...extra }) as number;

 it('sinks below zero after many 60 Hz ticks with a fixed chin-down pitch and jaw closed', () => {
  const n = node(), state = emptyState();
  let value = 0;
  for (let tick = 0; tick < 240; tick++) value = read(n, state, { deltaSeconds: 1 / 60, tickMs: tick * 16, previousPose: () => pitched(45) });
  expect(value).toBeLessThan(-0.05);
 });

 it('reads the stored value on a second read in the same tick: one step only', () => {
  const n = node(), state = emptyState();
  read(n, state, { deltaSeconds: 1 / 60, tickMs: 0, previousPose: () => pitched(0) });
  const first = read(n, state, { deltaSeconds: 1 / 60, tickMs: 16, previousPose: () => pitched(45) });
  const stored = state.nodes.get('bs');
  expect(read(n, state, { deltaSeconds: 1 / 60, tickMs: 16, previousPose: () => pitched(45) })).toBe(first);
  expect(state.nodes.get('bs')).toBe(stored);
  const next = read(n, state, { deltaSeconds: 1 / 60, tickMs: 32, previousPose: () => pitched(45) });
  expect(state.nodes.get('bs')).not.toBe(stored);
  expect(next).toBeLessThan(first);
 });

 it('throws when the character is not in the scene', () => {
  expect(() => read(node(), emptyState(), { deltaSeconds: 1 / 60, tickMs: 0, previousPose: () => null, scene: () => ({ ...scene, entities: [] }) })).toThrow('Character is unavailable');
 });
});

const sceneWith = (tracking?: AvatarTracking): SceneView => ({ ...scene, entities: scene.entities.map(entity => entity.kind === 'avatar' && entity.id === avatar.id ? { ...entity, tracking } : entity) });
const run = (type: 'character.offsetBoneTranslation' | 'character.offsetBoneScale', over: object, sceneView: SceneView, inputs: Record<string, number> = { value: -1, weight: 1 }): BlueprintEffect[] => {
 const emitted: BlueprintEffect[] = [];
 const context = { port: 'flow', read: (port: string) => inputs[port] ?? 0, follow: () => {}, emit: (effect: BlueprintEffect) => { emitted.push(effect); }, emitEach: (effects: BlueprintEffect[]) => { emitted.push(...effects); }, env: { ...NO_ENV, scene: () => sceneView } } as unknown as FlowContext;
 const node = { id: 'n', version: 1, position: { x: 0, y: 0 }, type, settings: { entityId: avatar.id, ...over } } as BlueprintNodeOf<typeof type>;
 (EVALUATORS[type] as unknown as { flow: (n: unknown, c: FlowContext) => void }).flow(node, context);
 return emitted;
};

describe('Offset Bone Translation', () => {
 it('emits a translation on the chosen axis for each bone', () => {
  expect(run('character.offsetBoneTranslation', { bones: ['spine'], axis: 'y', intensity: 0.1, offset: 0 }, sceneWith(), { value: -1, weight: 1 })).toEqual([{ kind: 'offsetBoneTranslation', entityId: avatar.id, bone: 'spine', translation: [0, -0.1, 0] }]);
 });

 it('skips a bone a body source tracks', () => {
  const tracked = sceneWith({ bodySourceId: 'body', faceSourceId: null, body: { movementIntensity: 1, trackedParts: ['body'] } });
  expect(run('character.offsetBoneTranslation', { bones: ['spine'], axis: 'y', intensity: 0.1, offset: 0 }, tracked)).toEqual([]);
 });
});

describe('Offset Bone Scale', () => {
 it('emits ~0.95 absolute scale for a negative value', () => {
  const effects = run('character.offsetBoneScale', { bones: ['chest'], intensity: 0.05, offset: 0 }, sceneWith(), { value: -1, weight: 1 });
  expect(effects).toHaveLength(1);
  expect((effects[0] as { scale: number }).scale).toBeCloseTo(0.95);
 });

 it('clamps the scale to [0.5, 1.5]', () => {
  const low = run('character.offsetBoneScale', { bones: ['chest'], intensity: 1, offset: 0 }, sceneWith(), { value: -100, weight: 1 });
  expect((low[0] as { scale: number }).scale).toBe(0.5);
  const high = run('character.offsetBoneScale', { bones: ['chest'], intensity: 1, offset: 0 }, sceneWith(), { value: 100, weight: 1 });
  expect((high[0] as { scale: number }).scale).toBe(1.5);
 });

 it('skips a bone a body source tracks', () => {
  const tracked = sceneWith({ bodySourceId: 'body', faceSourceId: null, body: { movementIntensity: 1, trackedParts: ['body'] } });
  expect(run('character.offsetBoneScale', { bones: ['chest'], intensity: 0.05, offset: 0 }, tracked)).toEqual([]);
 });
});
