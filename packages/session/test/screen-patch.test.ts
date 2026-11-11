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
// B30 R3: web content on a screen.
const web = (url: string | null = 'https://example.com/') => ({ url, width: 1280, height: 720, onTop: false });
const webScreen = (id: string): SceneEntity => ({ ...screen(id), content: { kind: 'web', ...web() } } as SceneEntity);
it('changes a screen from image to web content and back', () => {
    const s = createSession(makeSmokeScene(), 'screen-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: screen('chat') }, { kind: 'setScreenImage', entityId: 'chat', assetId: 'image_a' }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenWeb', entityId: 'chat', web: { ...web('https://example.com/chat'), onTop: true } }])).ok).toBe(true);
    expect(content(s, 'chat')).toEqual({ kind: 'web', url: 'https://example.com/chat', width: 1280, height: 720, onTop: true });
    expect(s.applyPatch(patch(2, [{ kind: 'setScreenWeb', entityId: 'chat', web: web(null) }])).ok).toBe(true);
    expect(content(s, 'chat')).toEqual({ kind: 'web', url: null, width: 1280, height: 720, onTop: false });
    expect(s.applyPatch(patch(3, [{ kind: 'setScreenImage', entityId: 'chat', assetId: null }])).ok).toBe(true);
    expect(content(s, 'chat')).toEqual({ kind: 'image', assetId: null });
});
it('rejects setScreenWeb on another kind, an unknown entity, or an invalid URL', () => {
    const s = createSession(makeSmokeScene(), 'screen-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: screen('chat') }])).ok).toBe(true);
    const before = s.inspect();
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenWeb', entityId: 'performer', web: web() }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenWeb', entityId: 'nobody', web: web() }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    for (const url of ['http://example.com/', 'https://192.168.0.10/', 'https://localhost/']) expect(s.applyPatch(patch(1, [{ kind: 'setScreenWeb', entityId: 'chat', web: web(url) }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
});
it('rejects a fifth web screen by setScreenWeb and by createEntity', () => {
    const s = createSession(makeSmokeScene(), 'screen-test');
    expect(s.applyPatch(patch(0, [...Array.from({ length: LIMITS.webScreens }, (_, i) => ({ kind: 'createEntity', entity: webScreen(`w${i}`) })), { kind: 'createEntity', entity: screen('logo') }])).ok).toBe(true);
    const before = s.inspect();
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenWeb', entityId: 'logo', web: web() }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(1, [{ kind: 'createEntity', entity: webScreen('w_dup') }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenWeb', entityId: 'w0', web: web('https://example.com/other') }])).ok).toBe(true);
});
// B31 R2, R3: capture content on a screen and the capture screen limit by each path.
const captureValue = { target: 'display', source: { kind: 'display', name: 'Built-in Retina Display', ordinal: 0 }, cursor: true } as const;
const captureScreen = (id: string): SceneEntity => ({ ...screen(id), content: { kind: 'capture', ...captureValue } } as SceneEntity);
it('sets capture content, replaces it with image, video, and web content, and rejects another kind', () => {
    const s = createSession(makeSmokeScene(), 'screen-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: screen('desk') }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenCapture', entityId: 'desk', capture: captureValue }])).ok).toBe(true);
    expect(content(s, 'desk')).toEqual({ kind: 'capture', ...captureValue });
    expect(s.applyPatch(patch(2, [{ kind: 'setScreenWeb', entityId: 'desk', web: web() }])).ok).toBe(true);
    expect(content(s, 'desk').kind).toBe('web');
    expect(s.applyPatch(patch(3, [{ kind: 'setScreenCapture', entityId: 'desk', capture: { ...captureValue, target: 'window', source: null } }])).ok).toBe(true);
    expect(s.applyPatch(patch(4, [{ kind: 'setScreenImage', entityId: 'desk', assetId: null }])).ok).toBe(true);
    expect(content(s, 'desk')).toEqual({ kind: 'image', assetId: null });
    expect(s.applyPatch(patch(5, [{ kind: 'setScreenCapture', entityId: 'performer', capture: captureValue }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(5, [{ kind: 'setScreenCapture', entityId: 'nobody', capture: captureValue }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.applyPatch(patch(5, [{ kind: 'setScreenCapture', entityId: 'desk', capture: { ...captureValue, target: 'window' } }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});
it('rejects a third capture screen by setScreenCapture and by createEntity', () => {
    const s = createSession(makeSmokeScene(), 'screen-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: captureScreen('c0') }, { kind: 'createEntity', entity: captureScreen('c1') }, { kind: 'createEntity', entity: screen('logo') }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenCapture', entityId: 'logo', capture: captureValue }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(1, [{ kind: 'createEntity', entity: captureScreen('c2') }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenCapture', entityId: 'c0', capture: { ...captureValue, cursor: false } }])).ok).toBe(true);
});
