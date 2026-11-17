import { expect, it } from 'vitest';
import { LIGHT_BUDGET_MESSAGES as M, makeSmokeScene, type LightSettings, type SceneEntity, type SceneView } from '@opensekai/contracts';
import { createSession } from '../src/session';

const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const shadow = { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 };
const off = { affectCharacters: false, affectProps: false, affectEnvironment: false };
const settings = (patch: Partial<LightSettings> = {}): LightSettings => ({ type: 'point', color: '#ffffff', intensity: 3, range: 10, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow, ...patch });
const light = (id: string, patch: Partial<LightSettings> = {}): SceneEntity => ({ id, name: 'Light', visible: true, transform: { position: [0, 3, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'light', light: settings(patch) });
const create = (entity: SceneEntity) => ({ kind: 'createEntity', entity });
const lights = (count: number, prefix: string, patch: Partial<LightSettings> = {}) => Array.from({ length: count }, (_, i) => light(`${prefix}_${i}`, patch));
const sceneWith = (entities: SceneEntity[]): SceneView => { const scene = makeSmokeScene(); scene.entities.push(...entities); return scene; };
const refused = (message: string) => ({ ok: false, error: { code: 'INVALID_INPUT', message } });

it('refuses a ninth lit light with the lit light message and keeps the scene', () => {
    const s = createSession(sceneWith(lights(8, 'lit')), 'limits');
    const before = s.inspect();
    expect(s.applyPatch(patch(0, [create(light('ninth'))]))).toMatchObject(refused(M.litLights));
    expect(s.inspect()).toEqual(before);
});
it('commits 24 unlit lights in one patch at 8 lit lights and refuses a 33rd light', () => {
    const s = createSession(sceneWith(lights(8, 'lit')), 'limits');
    expect(s.applyPatch(patch(0, lights(24, 'unlit', off).map(create)))).toMatchObject({ ok: true, data: { revision: 1 } });
    expect(s.inspect().entities.filter(e => e.kind === 'light')).toHaveLength(32);
    const before = s.inspect();
    expect(s.applyPatch(patch(1, [create(light('extra', off))]))).toMatchObject(refused(M.lights));
    expect(s.inspect()).toEqual(before);
});
it('refuses a setLight that makes a ninth lit light and keeps the light unlit', () => {
    const s = createSession(sceneWith([...lights(8, 'lit'), light('beam_only', off)]), 'limits');
    expect(s.applyPatch(patch(0, [{ kind: 'setLight', entityId: 'beam_only', light: settings({ ...off, affectProps: true }) }]))).toMatchObject(refused(M.litLights));
    expect(s.inspect().entities.find(e => e.id === 'beam_only')).toMatchObject({ light: off });
    expect(s.inspect().revision).toBe(0);
});
it('refuses a third shadow light with the shadow light message', () => {
    const s = createSession(sceneWith(lights(2, 'shadow', { shadow: { ...shadow, enabled: true } })), 'limits');
    expect(s.applyPatch(patch(0, [create(light('third', { ...off, shadow: { ...shadow, enabled: true } }))]))).toMatchObject(refused(M.shadowLights));
});
it('refuses a scene replace over a light limit with its message and commits a 32-light scene', () => {
    const s = createSession(makeSmokeScene(), 'limits');
    expect(s.replaceScene(sceneWith(lights(9, 'lit')), 0)).toMatchObject(refused(M.litLights));
    expect(s.replaceScene(sceneWith([...lights(8, 'lit'), ...lights(25, 'unlit', off)]), 0)).toMatchObject(refused(M.lights));
    expect(s.inspect().revision).toBe(0);
    expect(s.replaceScene(sceneWith([...lights(8, 'lit'), ...lights(24, 'unlit', off)]), 0)).toMatchObject({ ok: true });
    expect(s.inspect().entities.filter(e => e.kind === 'light')).toHaveLength(32);
});
