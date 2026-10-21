import { expect, it } from 'vitest';
import { makeSmokeScene, type FpsCounterSettings, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '../src/session';
import { EMPTY_OVERRIDES, takeIdle, writeOverride, COMMIT_IDLE_MS } from '../src/overrides';

const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const settings = (patch: Partial<FpsCounterSettings> = {}): FpsCounterSettings => ({ corner: 'topRight', size: 32, color: '#ffffff', ...patch });
const counter = (id: string): SceneEntity => ({ id, name: 'FPS Counter', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'fpsCounter', fpsCounter: settings() });

it('creates an FPS counter and replaces its settings with setFpsCounter (R2)', () => {
    const s = createSession(makeSmokeScene(), 'fps-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: counter('fps') }])).ok).toBe(true);
    const next = settings({ corner: 'bottomLeft', size: 64, color: '#ff8800' });
    expect(s.applyPatch(patch(1, [{ kind: 'setFpsCounter', entityId: 'fps', fpsCounter: next }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === 'fps')).toMatchObject({ kind: 'fpsCounter', fpsCounter: next });
    expect(s.applyPatch(patch(2, [{ kind: 'setVisibility', entityId: 'fps', visible: false }, { kind: 'renameEntity', entityId: 'fps', name: 'Rate' }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === 'fps')).toMatchObject({ visible: false, name: 'Rate' });
    expect(s.applyPatch(patch(3, [{ kind: 'removeEntity', entityId: 'fps' }])).ok).toBe(true);
    expect(s.inspect().entities.some(e => e.id === 'fps')).toBe(false);
});
it('rejects setFpsCounter on another kind, an unknown entity, or a bad size without a change (R2)', () => {
    const s = createSession(makeSmokeScene(), 'fps-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setFpsCounter', entityId: 'performer', fpsCounter: settings() }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['performer'] } });
    expect(s.applyPatch(patch(0, [{ kind: 'setFpsCounter', entityId: 'nobody', fpsCounter: settings() }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setFpsCounter', entityId: 'performer', fpsCounter: settings({ size: 7 }) }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
});
it('rejects a second FPS counter through createEntity (R2)', () => {
    const s = createSession(makeSmokeScene(), 'fps-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: counter('fps') }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'createEntity', entity: counter('fps_2') }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});
it('commits an idle Blueprint visible override of a counter with setVisibility (R12)', () => {
    const scene = makeSmokeScene(); scene.entities.push(counter('fps'));
    const written = writeOverride(EMPTY_OVERRIDES, scene, { kind: 'setProperty', entityId: 'fps', property: 'visible', value: false }, 'graph', 0);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(takeIdle(scene, written.data, COMMIT_IDLE_MS).operations).toEqual([{ kind: 'setVisibility', entityId: 'fps', visible: false }]);
    expect(writeOverride(EMPTY_OVERRIDES, scene, { kind: 'setProperty', entityId: 'fps', property: 'position', value: [1, 0, 0] }, 'graph', 0).ok).toBe(false);
});
