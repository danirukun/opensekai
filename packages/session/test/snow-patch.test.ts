import { expect, it } from 'vitest';
import { DEFAULT_SNOW, makeSmokeScene, type SceneEntity, type SnowSettings } from '@opensekai/contracts';
import { createSession } from '../src/session';

const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const settings = (patch: Partial<SnowSettings> = {}): SnowSettings => ({ ...DEFAULT_SNOW, ...patch });
const snow = (id: string, patch: Partial<SnowSettings> = {}): SceneEntity => ({ id, name: 'Snow', visible: true, transform: { position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [6, 4, 6] }, kind: 'snow', snow: settings(patch) });

it('creates a snow and replaces its group with setSnow', () => {
    const s = createSession(makeSmokeScene(), 'snow-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: snow('snow_1') }])).ok).toBe(true);
    const next = settings({ rate: 1, fallSpeed: 2, windDirection: 90, windSpeed: 3, settleOnProps: false });
    expect(s.applyPatch(patch(1, [{ kind: 'setSnow', entityId: 'snow_1', snow: next }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === 'snow_1')).toMatchObject({ kind: 'snow', snow: next });
});
it('rejects setSnow on another kind or an unknown entity without a change', () => {
    const s = createSession(makeSmokeScene(), 'snow-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setSnow', entityId: 'performer', snow: settings() }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Entity is not a snow' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setSnow', entityId: 'nobody', snow: settings() }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setSnow', entityId: 'performer', snow: settings({ thickness: 1 }) }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
});
it('rejects a second snow through createEntity', () => {
    const s = createSession(makeSmokeScene(), 'snow-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: snow('snow_1') }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'createEntity', entity: snow('snow_2') }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(1, [{ kind: 'removeEntity', entityId: 'snow_1' }, { kind: 'createEntity', entity: snow('snow_2') }])).ok).toBe(true);
});
