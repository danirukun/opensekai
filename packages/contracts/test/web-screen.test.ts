import { expect, it } from 'vitest';
import vectors from '../../../fixtures/protocol/web-urls.json';
import { LIMITS, PatchOpSchema, SceneViewSchema, ShowDocumentSchema, isWebScreenUrl, makeSmokeScene, type SceneEntity, type WebScreen } from '../src/index';
const web = (url: string | null = 'https://example.com/', width = 1280, height = 720, onTop = false): WebScreen => ({ url, width, height, onTop });
const screen = (id: string, content: SceneEntity extends infer E ? E extends { kind: 'screen'; content: infer C } ? C : never : never): SceneEntity => ({ id, name: 'Screen', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'screen', content });
const webScreen = (id: string, value = web()) => screen(id, { kind: 'web', ...value });
// B30 R2: the same vectors as crates/contracts/tests/web_screen.rs.
it.each(vectors.valid)('accepts the web URL vector $name', ({ url }) => expect(isWebScreenUrl(url)).toBe(true));
it.each(vectors.invalid)('rejects the web URL vector $name', ({ url }) => expect(isWebScreenUrl(url)).toBe(false));
it('accepts web screens up to the web limit, with a null URL, inside the screen limit', () => {
    const scene = makeSmokeScene();
    scene.entities.push(...Array.from({ length: LIMITS.webScreens }, (_, i) => webScreen(`w${i}`, web(i ? 'https://example.com/' : null))), screen('logo', { kind: 'image', assetId: null }));
    expect(SceneViewSchema.safeParse(scene).success).toBe(true);
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, webScreen('over')] }).success).toBe(false);
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, screen('more', { kind: 'image', assetId: null })] }).success).toBe(true);
});
it('rejects a web screen with a size or URL outside the rule', () => {
    const scene = makeSmokeScene();
    for (const bad of [web('http://example.com/'), web(undefined, 63), web(undefined, 3841), web(undefined, 1280, 63), web(undefined, 1280, 2161), web(undefined, 1280.5)]) expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, webScreen('w', bad)] }).success).toBe(false);
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, webScreen('w', web(undefined, 64, 64))] }).success).toBe(true);
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, webScreen('w', web(undefined, 3840, 2160, true))] }).success).toBe(true);
});
it('parses setScreenWeb and rejects a bad or extra field', () => {
    expect(PatchOpSchema.safeParse({ kind: 'setScreenWeb', entityId: 'w', web: web() }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenWeb', entityId: 'w', web: web(null) }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenWeb', entityId: 'w', web: web('https://localhost/') }).success).toBe(false);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenWeb', entityId: 'w', web: { ...web(), css: 'body{}' } }).success).toBe(false);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenWeb', entityId: 'w' }).success).toBe(false);
});
it('round-trips a show with a web screen', () => {
    const scene = makeSmokeScene();
    scene.entities.push(webScreen('w', web('https://example.com/chat?x=1#y', 400, 900, true)));
    const show = { schemaVersion: 1, name: 'Web', scene: { ...scene, outputs: [...scene.outputs, { ...scene.outputs[0]!, id: 'preview_main' }].filter((o, i, all) => all.findIndex(x => x.id === o.id) === i) }, blueprints: [] };
    const parsed = ShowDocumentSchema.safeParse(JSON.parse(JSON.stringify(show)));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.scene.entities.at(-1)).toEqual(scene.entities.at(-1));
});
