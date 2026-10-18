import { expect, it } from 'vitest';
import { makeSmokeScene, type HazeSettings, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '../src/session';
import { COMMIT_IDLE_MS, EMPTY_OVERRIDES, dropOverrides, takeIdle, writeOverride } from '../src/overrides';

const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const settings = (patch: Partial<HazeSettings> = {}): HazeSettings => ({ density: 1, smoke: 1, intensity: 1, drift: 0.2, ...patch });
const haze = (id: string, patch: Partial<HazeSettings> = {}): SceneEntity => ({ id, name: 'Haze', visible: true, transform: { position: [0, 4, 0], rotation: [0, 0, 0, 1], scale: [20, 8, 20] }, kind: 'haze', haze: settings(patch) });

it('creates a haze and replaces its group with setHaze (R6)', () => {
    const s = createSession(makeSmokeScene(), 'haze-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: haze('fog') }])).ok).toBe(true);
    const next = settings({ density: 0.5, smoke: 2, intensity: 3, drift: 1 });
    expect(s.applyPatch(patch(1, [{ kind: 'setHaze', entityId: 'fog', haze: next }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === 'fog')).toMatchObject({ kind: 'haze', haze: next });
});
it('rejects setHaze on another kind or an unknown entity without a change (R6)', () => {
    const s = createSession(makeSmokeScene(), 'haze-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setHaze', entityId: 'performer', haze: settings() }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setHaze', entityId: 'nobody', haze: settings() }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setHaze', entityId: 'performer', haze: settings({ intensity: 5 }) }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
});
it('rejects a second haze through createEntity (R6)', () => {
    const s = createSession(makeSmokeScene(), 'haze-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: haze('fog') }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'createEntity', entity: haze('fog_2') }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(1, [{ kind: 'removeEntity', entityId: 'fog' }, { kind: 'createEntity', entity: haze('fog_2') }])).ok).toBe(true);
});
it('commits an idle Blueprint haze density override with one setHaze that keeps the other values (R14)', () => {
    const scene = makeSmokeScene(); scene.entities.push(haze('fog', { smoke: 2 }));
    const written = writeOverride(EMPTY_OVERRIDES, scene, { kind: 'setProperty', entityId: 'fog', property: 'hazeDensity', value: 1.5 }, 'graph', 0);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(takeIdle(scene, written.data, COMMIT_IDLE_MS - 1).operations).toEqual([]);
    const idle = takeIdle(scene, written.data, COMMIT_IDLE_MS);
    expect(idle.operations).toEqual([{ kind: 'setHaze', entityId: 'fog', haze: settings({ smoke: 2, density: 1.5 }) }]);
    expect(dropOverrides(written.data, [{ kind: 'setHaze', entityId: 'fog', haze: settings() }]).size).toBe(0);
    expect(writeOverride(EMPTY_OVERRIDES, scene, { kind: 'setProperty', entityId: 'fog', property: 'hazeDensity', value: 2.1 }, 'graph', 0).ok).toBe(false);
});
