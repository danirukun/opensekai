import { expect, it } from 'vitest';
import { eulerFromQuaternion, makeSmokeScene, quaternionFromEuler, type AssetRecord, type Quat, type SceneView } from '@opensekai/contracts';
import { EMPTY_OVERRIDES, applyOverrides, takeIdle } from '../src/overrides';
import { advanceTweens, dropTweens, EMPTY_TWEENS, MAX_TWEENS, sampleTween, startTween, tweening, writeTransitioned, type PropertyLayers, type Transition } from '../src/tweens';
import { advanceBlendShapes, composeBlendShapes, EMPTY_BLEND_SHAPES, setBlendShape } from '../src/blend-shapes';
import { EMPTY_LOOK_AT, lookRotation, MAX_PITCH, MAX_YAW, sceneLookup, setLookAt, stepLookAt, type LookAtStates } from '../src/look-at';
import { quatToEuler } from '../src/bone-offsets';

const scene = makeSmokeScene();
const ok = <T>(reply: { ok: true; data: T } | { ok: false; error?: unknown }): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.data; };
const linear = (seconds: number): Transition => ({ seconds, easing: 'Linear' });
const EMPTY: PropertyLayers = { overrides: EMPTY_OVERRIDES, tweens: EMPTY_TWEENS };
const setFov = (layers: PropertyLayers, value: number, transition?: Transition, at = 0, s: SceneView = scene) =>
 ok(writeTransitioned(layers, s, { kind: 'setProperty', entityId: 'camera_wide', property: 'fovDegrees', value, ...(transition ? { transition } : {}) }, 'g', at));
const fovAt = (layers: PropertyLayers, at: number) => {
 const stepped = advanceTweens(layers, scene, at);
 const camera = applyOverrides(scene, stepped.layers.overrides).entities.find(e => e.id === 'camera_wide');
 return { layers: stepped.layers, fov: camera?.kind === 'camera' ? camera.lens.fovDegrees : NaN };
};

it('eases a number from the current value and writes the exact target at the end', () => {
 let layers = setFov(EMPTY, 85, { seconds: 1, easing: 'InQuad' }, 1000);
 expect(layers.overrides.size).toBe(0);
 let step = fovAt(layers, 1500);
 expect(step.fov).toBeCloseTo(45 + 40 * 0.25);
 expect(tweening(step.layers.tweens, 'camera_wide', 'fovDegrees')).toBe(true);
 step = fovAt(step.layers, 2000);
 expect(step.fov).toBe(85);
 expect(step.layers.tweens.size).toBe(0);
 layers = step.layers;
 expect(layers.overrides.get('camera_wide')?.get('fovDegrees')?.lastWriteMs).toBe(2000);
});

it('clamps an overshoot ease to the property range and keeps scale positive', () => {
 const back = ok(writeTransitioned(EMPTY, scene, { kind: 'setProperty', entityId: 'camera_wide', property: 'fovDegrees', value: 178, transition: { seconds: 1, easing: 'OutBack' } }, 'g', 0));
 expect(sampleTween([...back.tweens.values()][0]!, 800).value).toBe(179);
 const shrink = ok(writeTransitioned(EMPTY, scene, { kind: 'setProperty', entityId: 'reference', property: 'scale', value: [0.01, 0.01, 0.01], transition: { seconds: 1, easing: 'InBack' } }, 'g', 0));
 const sample = sampleTween([...shrink.tweens.values()][0]!, 990).value as number[];
 expect(Math.min(...sample)).toBeGreaterThan(0);
});

it('lerps Vector3 values and slerps rotation on the shortest path, not by Euler angles', () => {
 const position = ok(writeTransitioned(EMPTY, scene, { kind: 'setProperty', entityId: 'reference', property: 'position', value: [2.9, 0.7, -4], transition: linear(2) }, 'g', 0));
 const [x, , z] = sampleTween([...position.tweens.values()][0]!, 500).value as number[];
 expect(x).toBeCloseTo(1.4); expect(z).toBeCloseTo(-1);
 const turned: SceneView = { ...scene, entities: scene.entities.map(e => e.id === 'reference' ? { ...e, transform: { ...e.transform, rotation: quaternionFromEuler([0, 170, 0]) } } : e) };
 const rotation = ok(writeTransitioned(EMPTY, turned, { kind: 'setProperty', entityId: 'reference', property: 'rotation', value: [0, -170, 0], transition: linear(1) }, 'g', 0));
 const tween = [...rotation.tweens.values()][0]!;
 // The short way passes through 180 degrees; an Euler lerp would pass through 0.
 const [, yaw] = sampleTween(tween, 500).value as number[];
 expect(Math.abs(Math.abs(yaw!) - 180)).toBeLessThan(1e-6);
 const quarter = eulerFromQuaternion(quaternionFromEuler(sampleTween(tween, 250).value as [number, number, number]))[1];
 expect(quarter).toBeCloseTo(175);
 expect(sampleTween(tween, 1000)).toEqual({ value: [0, -170, 0], done: true });
});

it('replaces a tween from the current value, and an immediate write or a patch stops it', () => {
 let layers = setFov(EMPTY, 85, linear(1), 0);
 layers = fovAt(layers, 500).layers;
 layers = setFov(layers, 25, linear(1), 500);
 expect(layers.tweens.size).toBe(1);
 expect(fovAt(layers, 500).fov).toBeCloseTo(65);
 expect(fovAt(layers, 1000).fov).toBeCloseTo(45);
 const immediate = setFov(layers, 30, undefined, 600);
 expect(immediate.tweens.size).toBe(0);
 expect(immediate.overrides.get('camera_wide')?.get('fovDegrees')?.value).toBe(30);
 const moved = ok(writeTransitioned({ overrides: EMPTY_OVERRIDES, tweens: ok(startTween(EMPTY_TWEENS, scene, EMPTY_OVERRIDES, { kind: 'setProperty', entityId: 'reference', property: 'position', value: [0, 0, 0] }, linear(1), 'g', 0)) }, scene, { kind: 'moveEntity', entityId: 'reference', space: 'world', delta: [0, 1, 0] }, 'g', 10));
 expect(moved.tweens.size).toBe(0);
 expect(dropTweens(layers.tweens, [{ kind: 'setCameraLens', entityId: 'camera_wide', lens: { fovDegrees: 50, near: 0.01, far: 100 } }]).size).toBe(0);
 expect(dropTweens(layers.tweens, [{ kind: 'setVisibility', entityId: 'camera_wide', visible: false }])).toBe(layers.tweens);
 expect(dropTweens(layers.tweens, [{ kind: 'removeEntity', entityId: 'camera_wide' }]).size).toBe(0);
});

it('treats zero seconds and Boolean properties as an immediate write, and rejects an invalid target', () => {
 expect(setFov(EMPTY, 60, linear(0)).tweens.size).toBe(0);
 const hide = ok(writeTransitioned(EMPTY, scene, { kind: 'setProperty', entityId: 'reference', property: 'visible', value: false, transition: linear(2) }, 'g', 0));
 expect(hide.tweens.size).toBe(0);
 expect(hide.overrides.get('reference')?.get('visible')?.value).toBe(false);
 expect(writeTransitioned(EMPTY, scene, { kind: 'setProperty', entityId: 'camera_wide', property: 'fovDegrees', value: 400, transition: linear(1) }, 'g', 0)).toMatchObject({ ok: false });
 expect(writeTransitioned(EMPTY, scene, { kind: 'setProperty', entityId: 'nobody', property: 'fovDegrees', value: 40, transition: linear(1) }, 'g', 0)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});

it('limits the active tweens, and a replacement does not count', () => {
 const many: SceneView = { ...scene, entities: [...scene.entities, ...Array.from({ length: MAX_TWEENS }, (_, i) => ({ ...scene.entities[0]!, id: `m${i}` }))] };
 let tweens = EMPTY_TWEENS;
 for (let i = 0; i < MAX_TWEENS; i++) tweens = ok(startTween(tweens, many, EMPTY_OVERRIDES, { kind: 'setProperty', entityId: `m${i}`, property: 'position', value: [i, 0, 0] }, linear(1), 'g', 0));
 expect(startTween(tweens, many, EMPTY_OVERRIDES, { kind: 'setProperty', entityId: 'reference', property: 'position', value: [0, 0, 0] }, linear(1), 'g', 0)).toMatchObject({ ok: false, error: { message: 'Transition limit reached' } });
 expect(startTween(tweens, many, EMPTY_OVERRIDES, { kind: 'setProperty', entityId: 'm0', property: 'position', value: [5, 0, 0] }, linear(1), 'g', 0).ok).toBe(true);
});

it('keeps a tweened override from committing until the tween ends', () => {
 let layers = setFov(EMPTY, 85, linear(1), 0);
 for (const at of [16, 400, 800]) layers = fovAt(layers, at).layers;
 const busy = (id: string, key: string) => tweening(layers.tweens, id, key as never);
 expect(takeIdle(scene, layers.overrides, 5000, busy).operations).toEqual([]);
 layers = fovAt(layers, 1000).layers;
 expect(takeIdle(scene, layers.overrides, 1249, (id, key) => tweening(layers.tweens, id, key)).operations).toEqual([]);
 expect(takeIdle(scene, layers.overrides, 1250, (id, key) => tweening(layers.tweens, id, key)).operations).toHaveLength(1);
});

it('stops a tween whose write fails and reports its graph', () => {
 const layers = setFov(EMPTY, 85, linear(1), 0);
 const gone: SceneView = { ...scene, entities: scene.entities.filter(e => e.id !== 'camera_wide') };
 const stepped = advanceTweens(layers, gone, 500);
 expect(stepped.layers.tweens.size).toBe(0);
 expect(stepped.failures).toMatchObject([{ graphId: 'g', error: { code: 'NOT_FOUND' } }]);
});

const record: AssetRecord = { id: 'fixture_vrm_1', format: 'vrm', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: 'test', importerVersion: 1, name: 'Rem', expressions: [{ name: 'Wink', preset: false }] };
const records = (id: string) => (id === record.id ? record : undefined);

it('sets, fades, clamps, and releases blend shape weights', () => {
 let shapes = ok(setBlendShape(EMPTY_BLEND_SHAPES, scene, records, { kind: 'setBlendShape', entityId: 'performer', blendShape: 'mouthSmileLeft', weight: 1.5 }, 0, 'g'));
 expect(shapes.get('performer')?.entries.get('mouthSmileLeft')?.weight).toBe(1);
 shapes = ok(setBlendShape(shapes, scene, records, { kind: 'setBlendShape', entityId: 'performer', blendShape: 'Wink', weight: 0.8, transition: { seconds: 1, easing: 'Linear' } }, 1000, 'g'));
 shapes = advanceBlendShapes(shapes, scene, 1250);
 expect(composeBlendShapes([], shapes)).toEqual([{ avatarId: 'performer', bones: {}, expressions: { mouthSmileLeft: 1, Wink: expect.closeTo(0.2) } }]);
 expect(composeBlendShapes([{ avatarId: 'performer', bones: {}, expressions: { mouthSmileLeft: 0.4, blink: 0.3 } }], shapes)[0]!.expressions).toMatchObject({ mouthSmileLeft: 1, blink: 0.3 });
 shapes = ok(setBlendShape(shapes, scene, records, { kind: 'setBlendShape', entityId: 'performer', blendShape: 'mouthSmileLeft', weight: 0 }, 1250, 'g'));
 shapes = ok(setBlendShape(shapes, scene, records, { kind: 'setBlendShape', entityId: 'performer', blendShape: 'Wink', weight: 0, transition: { seconds: 0.5, easing: 'Linear' } }, 1250, 'g'));
 expect(advanceBlendShapes(shapes, scene, 1500).get('performer')?.entries.get('Wink')?.weight).toBeCloseTo(0.1);
 expect(advanceBlendShapes(shapes, scene, 1750).size).toBe(0);
 expect(setBlendShape(EMPTY_BLEND_SHAPES, scene, records, { kind: 'setBlendShape', entityId: 'performer', blendShape: 'NotAName', weight: 1 }, 0, 'g')).toMatchObject({ ok: false, error: { message: 'BlendShape not found' } });
 expect(setBlendShape(EMPTY_BLEND_SHAPES, scene, records, { kind: 'setBlendShape', entityId: 'marker', blendShape: 'blink', weight: 1 }, 0, 'g')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 const swapped: SceneView = { ...scene, entities: scene.entities.map(e => e.id === 'performer' && e.kind === 'avatar' ? { ...e, assetId: 'avatar_other' } : e) };
 expect(advanceBlendShapes(ok(setBlendShape(EMPTY_BLEND_SHAPES, scene, records, { kind: 'setBlendShape', entityId: 'performer', blendShape: 'blink', weight: 1 }, 0, 'g')), swapped, 16).size).toBe(0);
});

const at = (position: [number, number, number]): SceneView => ({ ...scene, entities: scene.entities.map(e => e.id === 'reference' ? { ...e, transform: { ...e.transform, position } } : e) });
const euler = (q: Quat | null) => quatToEuler(q!);

it('aims the head at the target in the character frame and clamps yaw and pitch', () => {
 expect(euler(lookRotation(sceneLookup(at([0, 1.4, 5])), 'performer', 'reference'))).toEqual([0, 0, 0]);
 const [, yaw] = euler(lookRotation(sceneLookup(at([5, 1.4, 5])), 'performer', 'reference'));
 expect(yaw).toBeCloseTo(45);
 const [pitch] = euler(lookRotation(sceneLookup(at([0, 1.4 + 5, 5])), 'performer', 'reference'));
 expect(pitch).toBeCloseTo(-45);
 expect(euler(lookRotation(sceneLookup(at([5, 1.4, 0])), 'performer', 'reference'))[1]).toBeCloseTo(MAX_YAW);
 expect(euler(lookRotation(sceneLookup(at([0, -10, 0.1])), 'performer', 'reference'))[0]).toBeCloseTo(MAX_PITCH);
 const turned: SceneView = { ...at([5, 1.4, 0]), entities: at([5, 1.4, 0]).entities.map(e => e.id === 'performer' ? { ...e, transform: { ...e.transform, rotation: quaternionFromEuler([0, 90, 0]) } } : e) };
 expect(euler(lookRotation(sceneLookup(turned), 'performer', 'reference'))[1]).toBeCloseTo(0);
});

it('fades the look-at weight and adds it to the head offset, then releases at weight 0', () => {
 const target = at([5, 1.4, 5]);
 let looks = ok(setLookAt(EMPTY_LOOK_AT, sceneLookup(target), { kind: 'lookAt', entityId: 'performer', targetId: 'reference', weight: 1, transition: { seconds: 1, easing: 'Linear' } }, 0, 'g'));
 const step = (states: LookAtStates, now: number) => stepLookAt(states, sceneLookup(target), now, new Map());
 const headYaw = (now: number) => euler(step(looks, now).offsets.get('performer')!.get('head')!)[1];
 expect(headYaw(0)).toBeCloseTo(0);
 expect(headYaw(500)).toBeCloseTo(22.5);
 looks = step(looks, 1000).states;
 expect(headYaw(1000)).toBeCloseTo(45);
 looks = ok(setLookAt(looks, sceneLookup(target), { kind: 'lookAt', entityId: 'performer', targetId: 'reference', weight: 0.5 }, 1000, 'g'));
 expect(headYaw(1000)).toBeCloseTo(22.5);
 looks = ok(setLookAt(looks, sceneLookup(target), { kind: 'lookAt', entityId: 'performer', targetId: 'reference', weight: 0 }, 1000, 'g'));
 expect(looks.size).toBe(0);
 expect(setLookAt(EMPTY_LOOK_AT, sceneLookup(target), { kind: 'lookAt', entityId: 'performer', targetId: 'performer', weight: 1 }, 0, 'g')).toMatchObject({ ok: false, error: { message: 'Look At target is the character' } });
 expect(setLookAt(EMPTY_LOOK_AT, sceneLookup(target), { kind: 'lookAt', entityId: 'performer', targetId: 'nobody', weight: 1 }, 0, 'g')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(setLookAt(EMPTY_LOOK_AT, sceneLookup(target), { kind: 'lookAt', entityId: 'marker', targetId: 'reference', weight: 1 }, 0, 'g')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 const gone: SceneView = { ...target, entities: target.entities.filter(e => e.id !== 'reference') };
 expect(stepLookAt(ok(setLookAt(EMPTY_LOOK_AT, sceneLookup(target), { kind: 'lookAt', entityId: 'performer', targetId: 'reference', weight: 1 }, 0, 'g')), sceneLookup(gone), 16, new Map()).states.size).toBe(0);
});

it('moves on each tick when a graph retargets the tween on every tick', () => {
 // As in the session: the effect starts the tween at the previous tick, then the tick samples it.
 let layers = EMPTY;
 const values: number[] = [];
 for (let t = 20; t <= 1000; t += 20) {
  layers = ok(writeTransitioned(layers, scene, { kind: 'setProperty', entityId: 'camera_wide', property: 'fovDegrees', value: t % 40 ? 80 : 81, transition: linear(1) }, 'g', t, t - 20));
  const step = fovAt(layers, t);
  layers = step.layers;
  values.push(step.fov);
 }
 expect(values.every((value, i) => i === 0 || value > values[i - 1]!)).toBe(true);
 expect(values.at(-1)).toBeGreaterThan(60);
});

it('keeps a running tween when the same target comes again', () => {
 const first = setFov(EMPTY, 85, linear(1), 0);
 const again = setFov(fovAt(first, 300).layers, 85, linear(1), 300);
 expect([...again.tweens.values()][0]!.startMs).toBe(0);
 expect(fovAt(again, 1000).fov).toBe(85);
});
