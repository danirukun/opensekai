import { expect, it } from 'vitest';
import { DEFAULT_SNOW, makeSmokeScene, type SceneEntity, type SceneView, type SnowSettings } from '@opensekai/contracts';
import { advanceSnowCover, coverStep } from '../src/snow-cover';
import { createSession } from '../src/session';

const snow = (id = 'snow_1', patch: Partial<SnowSettings> = {}, visible = true): SceneEntity => ({ id, name: 'Snow', visible, transform: { position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [6, 4, 6] }, kind: 'snow', snow: { ...DEFAULT_SNOW, ...patch } });
const scene = (...entities: SceneEntity[]): SceneView => ({ ...makeSmokeScene(), entities });
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);

// Snow cover R2.
it('rises with rate over buildUpSeconds, melts over meltSeconds at rate 0, and clamps', () => {
    expect(coverStep(0, { rate: 0.5, buildUpSeconds: 10, meltSeconds: 20 }, 4)).toBeCloseTo(0.2);
    expect(coverStep(0.9, { rate: 1, buildUpSeconds: 10, meltSeconds: 20 }, 4)).toBe(1);
    expect(coverStep(0.5, { rate: 0, buildUpSeconds: 10, meltSeconds: 20 }, 4)).toBeCloseTo(0.3);
    expect(coverStep(0.1, { rate: 0, buildUpSeconds: 10, meltSeconds: 20 }, 4)).toBe(0);
    expect(coverStep(0.4, { rate: 0.5, buildUpSeconds: 10, meltSeconds: 20 }, 0)).toBe(0.4);
});
// Snow cover R1, R3, R4.
it('steps the snow entity of the scene and has no state without one', () => {
    expect(advanceSnowCover(null, scene(), 1)).toBeNull();
    const first = advanceSnowCover(null, scene(snow('snow_1', { rate: 1, buildUpSeconds: 10 })), 1);
    expect(first).toEqual({ entityId: 'snow_1', cover: 0 });
    expect(advanceSnowCover(first, scene(snow('snow_1', { rate: 1, buildUpSeconds: 10 })), 2)).toEqual({ entityId: 'snow_1', cover: 0.2 });
    expect(advanceSnowCover({ entityId: 'snow_1', cover: 0.5 }, scene(), 1)).toBeNull();
});
it('is 0 while the snow is hidden and starts at 0 for a new id', () => {
    expect(advanceSnowCover({ entityId: 'snow_1', cover: 0.5 }, scene(snow('snow_1', { rate: 1 }, false)), 1)).toEqual({ entityId: 'snow_1', cover: 0 });
    expect(advanceSnowCover({ entityId: 'snow_1', cover: 0.5 }, scene(snow('snow_2', { rate: 1 })), 1)).toEqual({ entityId: 'snow_2', cover: 0 });
});
// Snow cover R3, R4 in the session.
it('puts the cover on each frame while a snow exists, also when hidden, and never in the scene', () => {
    const s = createSession(makeSmokeScene(), 'snow-cover');
    expect('snow' in s.advance(0)).toBe(false);
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: snow('snow_1', { rate: 1, buildUpSeconds: 10 }) }])).ok).toBe(true);
    expect(s.advance(1000).snow).toEqual({ entityId: 'snow_1', cover: 0 });
    expect(s.advance(3000).snow?.cover).toBeCloseTo(0.2);
    expect(s.inspect().revision).toBe(1);
    expect(JSON.stringify(s.inspect())).not.toContain('cover');
    expect(s.applyPatch(patch(1, [{ kind: 'setVisibility', entityId: 'snow_1', visible: false }])).ok).toBe(true);
    expect(s.advance(3016).snow).toEqual({ entityId: 'snow_1', cover: 0 });
    expect(s.applyPatch(patch(2, [{ kind: 'removeEntity', entityId: 'snow_1' }])).ok).toBe(true);
    expect('snow' in s.advance(3032)).toBe(false);
});
it('starts at 0 after a show open', () => {
    const s = createSession(makeSmokeScene(), 'snow-cover');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: snow('snow_1', { rate: 1, buildUpSeconds: 10 }) }])).ok).toBe(true);
    s.advance(0);
    expect(s.advance(5000).snow?.cover).toBeCloseTo(0.5);
    const opened = s.inspect();
    expect(s.replaceScene(opened, opened.revision).ok).toBe(true);
    expect(s.advance(5016).snow).toEqual({ entityId: 'snow_1', cover: 0 });
});
