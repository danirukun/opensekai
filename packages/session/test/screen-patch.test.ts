import { it, expect } from 'vitest';
import { LIMITS, makeSmokeScene, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '../src/session';
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const screen = (id: string): SceneEntity => ({ id, name: 'Screen', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'screen', content: { kind: 'image', assetId: null } });
const content = (s: ReturnType<typeof createSession>, id: string) => (s.inspect().entities.find(e => e.id === id) as Extract<SceneEntity, { kind: 'screen' }>).content;
it('creates screens, gives two of them one image, and clears one', () => {
    const s = createSession(makeSmokeScene(), 'screen-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: screen('logo') }, { kind: 'createEntity', entity: screen('logo_2') }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenImage', entityId: 'logo', assetId: 'image_a' }, { kind: 'setScreenImage', entityId: 'logo_2', assetId: 'image_a' }])).ok).toBe(true);
    expect([content(s, 'logo'), content(s, 'logo_2')]).toEqual([{ kind: 'image', assetId: 'image_a' }, { kind: 'image', assetId: 'image_a' }]);
    expect(s.applyPatch(patch(2, [{ kind: 'setScreenImage', entityId: 'logo', assetId: null }])).ok).toBe(true);
    expect([content(s, 'logo'), content(s, 'logo_2')]).toEqual([{ kind: 'image', assetId: null }, { kind: 'image', assetId: 'image_a' }]);
});
it('rejects setScreenImage on another kind or an unknown entity', () => {
    const s = createSession(makeSmokeScene(), 'screen-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setScreenImage', entityId: 'performer', assetId: 'image_a' }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setScreenImage', entityId: 'nobody', assetId: null }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.inspect()).toEqual(before);
});
it('rejects a screen over the limit', () => {
    const s = createSession(makeSmokeScene(), 'screen-test');
    const many = Array.from({ length: LIMITS.screens }, (_, i) => ({ kind: 'createEntity', entity: screen(`s${i}`) }));
    expect(s.applyPatch(patch(0, many)).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'createEntity', entity: screen('over') }])).ok).toBe(false);
});
