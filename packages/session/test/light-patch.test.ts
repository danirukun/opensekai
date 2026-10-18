import { expect, it } from 'vitest';
import { makeSmokeScene, type LightSettings, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '../src/session';
import { COMMIT_IDLE_MS, EMPTY_OVERRIDES, dropOverrides, takeIdle, writeOverride } from '../src/overrides';

const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const settings = (patch: Partial<LightSettings> = {}): LightSettings => ({ type: 'point', color: '#ffffff', intensity: 20, range: 10, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 }, ...patch });
const light = (id: string, patch: Partial<LightSettings> = {}): SceneEntity => ({ id, name: 'Point Light', visible: true, transform: { position: [0, 2, 1], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'light', light: settings(patch) });
const shadowOn = { shadow: { ...settings().shadow, enabled: true } };

it('creates a light and replaces its settings with setLight (R3)', () => {
    const s = createSession(makeSmokeScene(), 'light-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: light('lamp') }])).ok).toBe(true);
    const next = settings({ color: '#ff8800', intensity: 5, affectProps: false });
    expect(s.applyPatch(patch(1, [{ kind: 'setLight', entityId: 'lamp', light: next }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === 'lamp')).toMatchObject({ kind: 'light', light: next });
});
it('rejects setLight on another kind or an unknown entity without a change (R3)', () => {
    const s = createSession(makeSmokeScene(), 'light-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setLight', entityId: 'performer', light: settings() }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setLight', entityId: 'nobody', light: settings() }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.inspect()).toEqual(before);
});
it('rejects a ninth light and a third shadow through createEntity and setLight (R2)', () => {
    const s = createSession(makeSmokeScene(), 'light-test');
    expect(s.applyPatch(patch(0, Array.from({ length: 8 }, (_, i) => ({ kind: 'createEntity', entity: light(`l${i}`, i < 2 ? shadowOn : {}) })))).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'createEntity', entity: light('l8') }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(1, [{ kind: 'setLight', entityId: 'l5', light: settings(shadowOn) }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(1, [{ kind: 'setVisibility', entityId: 'l0', visible: false }, { kind: 'setLight', entityId: 'l5', light: settings(shadowOn) }]))).toMatchObject({ ok: false });
    expect(s.applyPatch(patch(1, [{ kind: 'removeEntity', entityId: 'l0' }, { kind: 'setLight', entityId: 'l5', light: settings(shadowOn) }])).ok).toBe(true);
});
it('moves, hides, renames, and removes a light like other entities (R3)', () => {
    const s = createSession(makeSmokeScene(), 'light-test');
    s.applyPatch(patch(0, [{ kind: 'createEntity', entity: light('lamp') }]));
    const transform = { position: [1, 3, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
    expect(s.applyPatch(patch(1, [{ kind: 'setTransform', entityId: 'lamp', transform }, { kind: 'setVisibility', entityId: 'lamp', visible: false }, { kind: 'renameEntity', entityId: 'lamp', name: 'Key' }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === 'lamp')).toMatchObject({ name: 'Key', visible: false, transform });
    expect(s.applyPatch(patch(2, [{ kind: 'removeEntity', entityId: 'lamp' }])).ok).toBe(true);
    expect(s.inspect().entities.some(e => e.id === 'lamp')).toBe(false);
});
it('sets the environment reflections intensity on an environment only (R15)', () => {
    const s = createSession(makeSmokeScene(), 'light-test');
    const stage: SceneEntity = { id: 'stage', name: 'Environment', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'environment', assetId: null };
    s.applyPatch(patch(0, [{ kind: 'createEntity', entity: stage }]));
    expect(s.applyPatch(patch(1, [{ kind: 'setEnvironmentReflections', entityId: 'stage', reflectionsIntensity: 1.5 }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === 'stage')).toMatchObject({ reflectionsIntensity: 1.5 });
    expect(s.applyPatch(patch(2, [{ kind: 'setEnvironmentReflections', entityId: 'performer', reflectionsIntensity: 1 }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(2, [{ kind: 'setEnvironmentReflections', entityId: 'nobody', reflectionsIntensity: 1 }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});
it('commits an idle Blueprint intensity override with one setLight that keeps the other settings (R17)', () => {
    const scene = makeSmokeScene(); scene.entities.push(light('lamp', { color: '#00ff00' }));
    const written = writeOverride(EMPTY_OVERRIDES, scene, { kind: 'setProperty', entityId: 'lamp', property: 'intensity', value: 7 }, 'graph', 0);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(takeIdle(scene, written.data, COMMIT_IDLE_MS - 1).operations).toEqual([]);
    const idle = takeIdle(scene, written.data, COMMIT_IDLE_MS);
    expect(idle.operations).toEqual([{ kind: 'setLight', entityId: 'lamp', light: settings({ color: '#00ff00', intensity: 7 }) }]);
    expect(dropOverrides(written.data, [{ kind: 'setLight', entityId: 'lamp', light: settings() }]).size).toBe(0);
    expect(writeOverride(EMPTY_OVERRIDES, scene, { kind: 'setProperty', entityId: 'lamp', property: 'intensity', value: 1001 }, 'graph', 0).ok).toBe(false);
});
