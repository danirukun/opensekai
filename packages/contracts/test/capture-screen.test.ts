import { expect, it } from 'vitest';
import vectors from '../../../fixtures/protocol/capture-sources.json';
import { CaptureSourceSchema, LIMITS, PatchOpSchema, SceneViewSchema, WireMessageSchema, AppStatusSchema, RendererDiagnosticsSchema, makeSmokeScene, normalizeCaptureText, parseWire, type SceneEntity, type ScreenCapture } from '../src/index';
const screen = (id: string, content: Extract<SceneEntity, { kind: 'screen' }>['content']): SceneEntity => ({ id, name: 'Screen', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'screen', content });
const display = { kind: 'display', name: 'Built-in Retina Display', ordinal: 0 } as const;
const capture = (value: Partial<ScreenCapture> = {}): ScreenCapture => ({ target: 'display', source: display, cursor: true, ...value });
const captureScreen = (id: string, value = capture()) => screen(id, { kind: 'capture', ...value });
// B31 R2: the same vectors as crates/contracts/tests/capture_screen.rs.
it.each(vectors.normalize)('normalizes capture text: $name', ({ input, max, output }) => expect(normalizeCaptureText(input, max)).toBe(output));
it.each(vectors.valid)('accepts the capture source $name', ({ source }) => expect(CaptureSourceSchema.safeParse(source).success).toBe(true));
it.each(vectors.invalid)('rejects the capture source $name', ({ source }) => expect(CaptureSourceSchema.safeParse(source).success).toBe(false));
it('accepts two capture screens, a null source, and both targets; rejects a third', () => {
    const scene = makeSmokeScene();
    scene.entities.push(captureScreen('c0'), captureScreen('c1', capture({ target: 'window', source: null })), screen('logo', { kind: 'image', assetId: null }));
    expect(LIMITS.captureScreens).toBe(2);
    expect(SceneViewSchema.safeParse(scene).success).toBe(true);
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, captureScreen('c2', capture({ source: null }))] }).success).toBe(false);
});
it('rejects a source whose kind is not the target', () => {
    const scene = makeSmokeScene();
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, captureScreen('c', capture({ target: 'window' }))] }).success).toBe(false);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenCapture', entityId: 'c', capture: capture({ target: 'window' }) }).success).toBe(false);
});
it('parses setScreenCapture and rejects a bad or extra field', () => {
    expect(PatchOpSchema.safeParse({ kind: 'setScreenCapture', entityId: 'c', capture: capture() }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenCapture', entityId: 'c', capture: capture({ target: 'window', source: { kind: 'window', app: 'com.example.chat', title: 'Chat' }, cursor: false }) }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenCapture', entityId: 'c', capture: { ...capture(), audio: true } }).success).toBe(false);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenCapture', entityId: 'c', capture: { target: 'display', source: null } }).success).toBe(false);
});
const status = (screens: unknown[]) => ({ kind: 'captureStatus', revision: 3, screens });
const entry = (entityId: string, streamId: string | null = 'a'.repeat(32), state = 'live') => ({ entityId, streamId, state, width: 1920, height: 1080 });
it('parses the captureStatus wire message within its limits', () => {
    expect(parseWire(JSON.stringify(status([])))).toEqual(status([]));
    expect(WireMessageSchema.safeParse(status([entry('a'), entry('b')])).success).toBe(true);
    expect(WireMessageSchema.safeParse(status([entry('a'), entry('b'), entry('c')])).success).toBe(false);
    expect(WireMessageSchema.safeParse(status([entry('a', null, 'notAllowed'), entry('a', null, 'notAllowed')])).success).toBe(false);
    expect(WireMessageSchema.safeParse(status([entry('a', 'A'.repeat(32))])).success).toBe(false);
    expect(WireMessageSchema.safeParse(status([entry('a', null, 'stopped')])).success).toBe(false);
    expect(WireMessageSchema.safeParse(status([{ ...entry('a'), title: 'Chat' }])).success).toBe(false);
});
it('parses app_status captures without names and the renderer decoder report', () => {
    const base = { schemaVersion: 1, sessionId: 's', ready: true, revision: 1, capabilities: [], warnings: [], outputs: [{ outputId: 'output_main', connected: true, lastFrame: null, videoDecoder: 'supported' }] };
    expect(AppStatusSchema.safeParse({ ...base, captures: [{ entityId: 'c', state: 'notAllowed' }] }).success).toBe(true);
    expect(AppStatusSchema.safeParse({ ...base, captures: [{ entityId: 'c', state: 'live', title: 'Chat' }] }).success).toBe(false);
    const diagnostics = { sessionId: 's', outputId: 'o', rendererEpoch: 'e', sequence: 1, revision: 1, backend: 'webgl2', geometries: 0, textures: 0, liveMaterials: 0, assetCacheEntries: 0, activeRenderJob: false, queuedFrames: 0, queuedCaptures: 0 };
    for (const videoDecoder of ['supported', 'unsupported', 'missing', undefined]) expect(RendererDiagnosticsSchema.safeParse({ ...diagnostics, videoDecoder }).success).toBe(true);
    expect(RendererDiagnosticsSchema.safeParse({ ...diagnostics, videoDecoder: 'maybe' }).success).toBe(false);
});
