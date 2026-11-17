import { expect, it } from 'vitest';
import { makeSmokeScene, type LightSettings, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '../src/session';

const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const shadow = { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 };
const spot = (patch: Partial<LightSettings> = {}): LightSettings => ({ type: 'spot', color: '#ffffff', intensity: 60, range: 15, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow, cone: { angleDegrees: 40, penumbra: 0.3 }, volumetric: true, ...patch });
const light = (id: string, settings: LightSettings): SceneEntity => ({ id, name: 'Light', visible: true, transform: { position: [0, 3, 2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'light', light: settings });
const beam = { enabled: true, intensity: 2, softness: 0.1 };

it('sets a beam on a spot light with setLight (R4)', () => {
    const s = createSession(makeSmokeScene(), 'beam-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: light('key', spot()) }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'setLight', entityId: 'key', light: spot({ beam }) }]))).toMatchObject({ ok: true, data: { revision: 2 } });
    expect(s.inspect()).toMatchObject({ revision: 2 });
    expect(s.inspect().entities.find(e => e.id === 'key')).toMatchObject({ kind: 'light', light: { beam } });
});
it('rejects a point light with the beam on without a change (R4)', () => {
    const s = createSession(makeSmokeScene(), 'beam-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: light('key', spot()) }])).ok).toBe(true);
    const before = s.inspect();
    const { cone: _, ...rest } = spot();
    expect(s.applyPatch(patch(1, [{ kind: 'setLight', entityId: 'key', light: { ...rest, type: 'point', beam } }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
});
