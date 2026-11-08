import { it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Texture, type Group, type Mesh, type MeshBasicNodeMaterial } from 'three/webgpu';
import { QUALITY_PROFILES, makeSmokeFrame, type RuntimeFrame, type SceneEntity, type ScreenPlayback } from '@opensekai/contracts';
import { audioCodecMessage, audioState, decidePlayback, decodeFailure, FRAME_MS, readVideoHeader, readVideoInfo, VIDEO_LOAD_FAILED, VIDEO_PLAYBACK_BLOCKED, videoCodecMessage, type MediaSupport, type VideoSource } from '../src/video-screen';
import { createLoadJobs, VIDEO_RETRY_LIMIT, type LoadRequest } from '../src/load-jobs';
const ports = vi.hoisted(() => ({ render: vi.fn(), compile: vi.fn(), source: vi.fn(), open: vi.fn() }));
vi.mock('../src/backend', () => ({ initializeBackend: async () => ({ backend: 'webgl2', renderer: { shadowMap: { enabled: false }, info: { memory: { geometries: 0, textures: 0 } }, setSize: vi.fn(), renderAsync: ports.render, compileAsync: ports.compile, dispose: vi.fn() } }) }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({ texture: new Texture(), dispose() {} }) }));
vi.mock('../src/video-screen', async original => ({ ...await original<typeof import('../src/video-screen')>(), loadVideoSource: (read: () => Promise<ArrayBuffer>) => ports.source(read), openScreenVideo: (source: unknown, options: unknown) => ports.open(source, options) }));
import { createRenderer } from '../src/renderer';
// The direct tests use the real load and player; the renderer tests use the stand-ins.
const { loadVideoSource, openScreenVideo } = await vi.importActual<typeof import('../src/video-screen')>('../src/video-screen');

// The Operation 1 test media and the values that the host parser must give too.
const root = new URL('../../../fixtures/video/', import.meta.url);
const expected = JSON.parse(readFileSync(new URL('expected.json', root), 'utf8')) as Record<string, { format: string; videoCodec: string; codecString: string; audioCodec: string | null; alpha: boolean; width: number; height: number }>;
const file = (name: string) => new Uint8Array(readFileSync(new URL(name, root)));

it('reads the format, the codec, the codec string, the audio codec, and alpha of each test file (R13)', () => {
    for (const [name, value] of Object.entries(expected)) {
        expect(readVideoInfo(file(name)), name).toEqual({ format: value.format, codec: value.videoCodec, codecString: value.codecString, audioCodec: value.audioCodec, alpha: value.alpha });
    }
    // The coded size for the decode check: the turned file has a 64 x 36 coded size and a 36 x 64 display size.
    expect(readVideoHeader(file('h264-turned.mp4'))).toMatchObject({ width: 64, height: 36 });
});
it('gives null for a model, an image, another file, and each cut file', () => {
    const text = (s: string) => [...s].map(c => c.charCodeAt(0));
    expect(readVideoInfo(new Uint8Array([...text('glTF'), 2, 0, 0, 0, 20, 0, 0, 0]))).toBeNull();
    expect(readVideoInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBeNull();
    expect(readVideoInfo(new Uint8Array())).toBeNull();
    for (const name of ['h264-aac.mp4', 'vp9-opus.webm']) {
        const bytes = file(name);
        // A file cut inside the header (moov at the start of a faststart MP4; Tracks in a WebM) gives null and never throws.
        for (let end = 0; end < 400; end += 7) expect(readVideoInfo(bytes.subarray(0, end))).toBeNull();
    }
    // A QuickTime brand and a Matroska DocType are not accepted.
    const qt = file('h264-aac.mp4').slice(); qt.set(text('qt  '), 8);
    expect(readVideoInfo(qt)).toBeNull();
    const mkv = file('vp8.webm'); const at = Buffer.from(mkv).indexOf('webm');
    const matroska = new Uint8Array([...mkv.subarray(0, at), ...text('matroska'), ...mkv.subarray(at + 4)]);
    expect(readVideoInfo(matroska)).toBeNull();
});

const media = (supported: (type: string) => boolean, canPlay = (_: string) => 'probably'): MediaSupport & { calls: MediaDecodingConfiguration[] } => {
    const calls: MediaDecodingConfiguration[] = [];
    return { calls, decodingInfo: async c => { calls.push(c); return { supported: supported(c.video?.contentType ?? c.audio!.contentType) }; }, canPlayType: canPlay };
};
it('checks the full codec string before the element loads and names the codec that fails (R15)', async () => {
    const hevc = readVideoHeader(file('hevc.mp4'))!;
    const check = media(type => !type.includes('hvc1'));
    expect(await decodeFailure(hevc, check)).toBe('Video codec not supported: HEVC');
    expect(check.calls[0]).toEqual({ type: 'file', video: { contentType: 'video/mp4; codecs="hvc1.1.6.L30.90"', width: 64, height: 36, bitrate: 1, framerate: 30 } });
    const aac = readVideoHeader(file('h264-aac.mp4'))!;
    const noAac = media(type => !type.includes('mp4a'));
    expect(await decodeFailure(aac, noAac)).toBe('Audio codec not supported: AAC');
    expect(noAac.calls[1]).toEqual({ type: 'file', audio: { contentType: 'audio/mp4; codecs="mp4a.40.2"' } });
    expect(await decodeFailure(readVideoHeader(file('vp9-opus.webm'))!, media(type => !type.includes('opus')))).toBe('Audio codec not supported: Opus');
    expect(await decodeFailure(aac, media(() => true))).toBeNull();
    // The short VP9 form goes to canPlayType, because decodingInfo rejects a codec string without a profile.
    const vp9 = media(() => false, type => type === 'video/webm; codecs="vp9"' ? 'probably' : '');
    expect(await decodeFailure(readVideoHeader(file('vp9-alpha.webm'))!, vp9)).toBeNull();
    expect(vp9.calls).toEqual([]);
    // Without mediaCapabilities, an empty canPlayType answer gives the message.
    expect(await decodeFailure(readVideoHeader(file('av1.mp4'))!, { canPlayType: () => '' })).toBe('Video codec not supported: AV1');
    expect(['h264', 'hevc', 'vp8', 'vp9', 'av1'].map(c => videoCodecMessage(c as never))).toEqual(['Video codec not supported: H.264', 'Video codec not supported: HEVC', 'Video codec not supported: VP8', 'Video codec not supported: VP9', 'Video codec not supported: AV1']);
    expect(['aac', 'mp3', 'opus', 'vorbis'].map(c => audioCodecMessage(c as never))).toEqual(['Audio codec not supported: AAC', 'Audio codec not supported: MP3', 'Audio codec not supported: Opus', 'Audio codec not supported: Vorbis']);
});
it('makes one object URL from the bytes and gives one message for each other failure (R13, R15)', async () => {
    const urls = { createObjectURL: vi.fn((_: Blob) => 'blob:one'), revokeObjectURL: vi.fn() };
    const bytes = file('vp8.webm');
    const ok = () => media(() => true);
    for (const read of [() => Promise.reject(new Error('404')), async () => new Uint8Array([1, 2, 3]).buffer, async () => readFileSync(new URL('expected.json', root)).buffer as ArrayBuffer])
        await expect(loadVideoSource(read, ok, urls)).rejects.toMatchObject({ message: VIDEO_LOAD_FAILED });
    await expect(loadVideoSource(async () => bytes.slice().buffer, () => media(() => false), urls)).rejects.toMatchObject({ message: 'Video codec not supported: VP8' });
    expect(urls.createObjectURL).not.toHaveBeenCalled();
    const source = await loadVideoSource(async () => bytes.slice().buffer, ok, urls);
    expect(source.url).toBe('blob:one');
    expect(urls.createObjectURL.mock.lastCall![0].type).toBe('video/webm');
    source.dispose(); source.dispose();
    expect(urls.revokeObjectURL).toHaveBeenCalledTimes(1);
});

it('finds the R14 target: modulo the duration with loop, the last frame without loop', () => {
    const at = (positionMs: number, loop: boolean, currentMs = 0, playing = true) => decidePlayback({ playing, positionMs }, loop, 2000, currentMs);
    expect(at(2250, true).targetMs).toBe(250);
    expect(at(2250, false).targetMs).toBeCloseTo(2000 - FRAME_MS);
    expect(at(2250, false).run).toBe(false);
    expect(at(1000, false).run).toBe(true);
    expect(at(1000, true, 0, false).run).toBe(false);
    // Unknown duration: no wrap and no clamp.
    expect(decidePlayback({ playing: true, positionMs: 5000 }, true, NaN, 0).targetMs).toBe(5000);
});
it('seeks only above 250 ms while playing, above 1 frame while paused, and the shorter way around the end with loop', () => {
    expect(decidePlayback({ playing: true, positionMs: 1000 }, true, 2000, 1250).seek).toBe(false);
    expect(decidePlayback({ playing: true, positionMs: 1000 }, true, 2000, 1251).seek).toBe(true);
    expect(decidePlayback({ playing: false, positionMs: 1000 }, true, 2000, 1000 + FRAME_MS).seek).toBe(false);
    expect(decidePlayback({ playing: false, positionMs: 1000 }, true, 2000, 1020).seek).toBe(true);
    // Target 50 ms (2050 wrapped) and current 1950 ms are 100 ms apart around the end.
    expect(decidePlayback({ playing: true, positionMs: 2050 }, true, 2000, 1950).seek).toBe(false);
    // Without loop the entry is past the end: the target is the last frame, the element pauses, and 1500 ms is too far.
    expect(decidePlayback({ playing: true, positionMs: 4100 }, false, 2000, 1500)).toMatchObject({ run: false, seek: true });
});
it('mutes each element except in the OBS page (R16)', () => {
    expect(audioState(true, 0.5)).toEqual({ muted: false, volume: 0.5 });
    expect(audioState(false, 0.5)).toEqual({ muted: true, volume: 0.5 });
});

// A stand-in element: loadeddata or an error after `src` is set, and a play() that the test can reject.
function fakeElement({ fail, code, playRejects = false }: { fail?: boolean; code?: number; playRejects?: boolean } = {}) {
    const listeners = new Map<string, Set<() => void>>();
    const el = {
        playsInline: false, preload: '', loop: false, muted: false, volume: 1, currentTime: 0, duration: 2, paused: true, seeking: false, error: null as { code: number } | null, videoWidth: 64, videoHeight: 36,
        play: vi.fn(() => { el.paused = false; return playRejects ? (el.paused = true, Promise.reject(new Error('NotAllowedError'))) : Promise.resolve(); }),
        pause: vi.fn(() => { el.paused = true; }),
        addEventListener: (type: string, f: () => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(f); },
        removeEventListener: (type: string, f: () => void) => { listeners.get(type)?.delete(f); },
        removeAttribute: vi.fn(), load: vi.fn(),
        emit: (type: string) => { for (const f of [...listeners.get(type) ?? []]) f(); },
        _src: '',
        get src() { return el._src; },
        set src(value: string) { el._src = value; queueMicrotask(() => { if (fail) { el.error = { code: code ?? 2 }; el.emit('error'); } else el.emit('loadeddata'); }); },
    };
    return el;
}
const source = (codec = 'h264' as const, alpha = false): VideoSource => ({ url: 'blob:x', header: { format: 'mp4', codec, codecString: 'avc1.42C00A', audioCodec: null, alpha, width: 64, height: 36 }, dispose: vi.fn() });
const element = (el: ReturnType<typeof fakeElement>) => () => el as never;
it('sets up one element for each screen with the R13 attributes and the R16 audio flag for each instance', async () => {
    for (const audio of [true, false]) {
        const el = fakeElement();
        const player = await openScreenVideo(source(), { audio, loop: false, volume: 0.4, upload: 'element', element: element(el) });
        expect({ playsInline: el.playsInline, preload: el.preload, loop: el.loop, muted: el.muted, volume: el.volume, src: el.src }).toEqual({ playsInline: true, preload: 'auto', loop: false, muted: !audio, volume: 0.4, src: 'blob:x' });
        expect([player.width, player.height, player.texture.flipY, player.texture.colorSpace]).toEqual([64, 36, false, 'srgb']);
        player.sync({ playing: false, positionMs: 0 }, { loop: true, volume: 0.7 }, true);
        expect([el.loop, el.muted, el.volume]).toEqual([true, !audio, 0.7]);
        player.dispose();
        expect(el.removeAttribute).toHaveBeenCalledWith('src');
    }
});
it('names the codec for a decode or source error and gives the other message for another error or the 10 s limit (R15)', async () => {
    for (const code of [3, 4]) await expect(openScreenVideo(source('h264'), { audio: false, loop: true, volume: 1, upload: 'element', element: element(fakeElement({ fail: true, code })) })).rejects.toMatchObject({ message: 'Video codec not supported: H.264' });
    await expect(openScreenVideo(source(), { audio: false, loop: true, volume: 1, upload: 'element', element: element(fakeElement({ fail: true, code: 2 })) })).rejects.toMatchObject({ message: VIDEO_LOAD_FAILED });
    const silent = fakeElement(); Object.defineProperty(silent, 'src', { set() {}, get: () => '' });
    await expect(openScreenVideo(source(), { audio: false, loop: true, volume: 1, upload: 'element', timeoutMs: 5, element: element(silent) })).rejects.toMatchObject({ message: VIDEO_LOAD_FAILED });
    // An error after loadeddata is reported to the renderer.
    const late = fakeElement();
    const player = await openScreenVideo(source('h264'), { audio: false, loop: true, volume: 1, upload: 'element', element: element(late) });
    expect(player.failure()).toBeUndefined();
    late.error = { code: 3 }; late.emit('error');
    expect(player.failure()).toBe('Video codec not supported: H.264');
});
it('plays, pauses, and seeks the element from the session position, and warns while play() is blocked (R14)', async () => {
    const el = fakeElement({ playRejects: true });
    const player = await openScreenVideo(source(), { audio: true, loop: true, volume: 1, upload: 'element', element: element(el) });
    const content = { loop: true, volume: 1 };
    expect(player.sync({ playing: true, positionMs: 1000 }, content, true)).toBeNull();
    expect(el.currentTime).toBe(1);
    await Promise.resolve(); await Promise.resolve();
    expect(player.sync({ playing: true, positionMs: 1016 }, content, true)).toEqual({ code: 'UNSUPPORTED', message: VIDEO_PLAYBACK_BLOCKED, ids: [] });
    expect(el.play).toHaveBeenCalledTimes(2);
    el.play.mockImplementation(() => { el.paused = false; return Promise.resolve(); });
    player.sync({ playing: true, positionMs: 1033 }, content, true);
    await Promise.resolve(); await Promise.resolve();
    expect(player.sync({ playing: true, positionMs: 1050 }, content, true)).toBeNull();
    // A seek runs: no second seek.
    el.seeking = true; el.currentTime = 0;
    player.sync({ playing: true, positionMs: 1500 }, content, true);
    expect(el.currentTime).toBe(0);
    el.seeking = false;
    // A paused entry pauses; a hidden screen pauses; the pump stop pauses.
    player.sync({ playing: false, positionMs: 1500 }, content, true);
    expect(el.paused).toBe(true);
    expect(el.currentTime).toBe(1.5);
    player.sync({ playing: true, positionMs: 1500 }, content, true);
    expect(el.paused).toBe(false);
    player.sync({ playing: true, positionMs: 1500 }, content, false);
    expect(el.paused).toBe(true);
    player.sync({ playing: true, positionMs: 1500 }, content, true);
    player.pause();
    expect(el.paused).toBe(true);
    player.sync({ playing: true, positionMs: 1516 }, content, true);
    expect(el.paused).toBe(false);
    // settled() waits for the frame after a play or a seek.
    let done = false;
    el.currentTime = 0;
    player.sync({ playing: false, positionMs: 1000 }, content, true);
    void player.settled().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    el.emit('seeked');
    // A read right at `seeked` can give the old frame, so the texture is read again on the next 6 frames first.
    for (let i = 0; i < 5; i++) player.sync({ playing: false, positionMs: 1000 }, content, true);
    await Promise.resolve();
    expect(done).toBe(false);
    player.sync({ playing: false, positionMs: 1000 }, content, true);
    await Promise.resolve();
    expect(done).toBe(true);
});
it('copies one ImageBitmap for each new frame on the bitmap upload and closes the old one', async () => {
    const el = fakeElement();
    const bitmaps: { close: ReturnType<typeof vi.fn>; width: number; height: number }[] = [];
    const bitmap = async () => { const b = { close: vi.fn(), width: 64, height: 36 }; bitmaps.push(b); return b as unknown as ImageBitmap; };
    const player = await openScreenVideo(source(), { audio: false, loop: true, volume: 1, upload: 'bitmap', element: element(el), bitmap });
    expect(player.texture.image).toBe(bitmaps[0]);
    el.emit('seeked');
    await new Promise(r => setTimeout(r, 0));
    expect(player.texture.image).toBe(bitmaps[1]);
    expect(bitmaps[0]!.close).toHaveBeenCalledTimes(1);
    player.dispose();
    expect(bitmaps[1]!.close).toHaveBeenCalledTimes(1);
});

it('retries a failed video at most 3 times for one asset ID until the asset ID or the screen content changes (R15)', async () => {
    const start = vi.fn((_: LoadRequest) => Promise.reject(new Error('Video failed to load')));
    const clock = { time: 0 };
    const jobs = createLoadJobs<{ dispose(): void }>(start, vi.fn(), { now: () => clock.time });
    const need = (assetId: string, retryKey = 'a') => new Map([['screen', { kind: 'video' as const, assetId, retryKey }]]);
    const settle = () => new Promise(r => setTimeout(r, 0));
    let revision = 1;
    jobs.reconcile(need('video_a'), revision); await settle();
    for (let i = 0; i < 6; i++) { clock.time += 3000; jobs.reconcile(need('video_a'), ++revision); await settle(); }
    expect(start).toHaveBeenCalledTimes(1 + VIDEO_RETRY_LIMIT);
    expect(jobs.failure('screen')).toBe('Video failed to load');
    // A new screen content (the same asset) starts a new count.
    clock.time += 3000; jobs.reconcile(need('video_a', 'b'), ++revision); await settle();
    expect(start).toHaveBeenCalledTimes(2 + VIDEO_RETRY_LIMIT);
    // Another asset ID starts a new job and a new count.
    jobs.reconcile(need('video_b', 'b'), ++revision); await settle();
    expect(start).toHaveBeenCalledTimes(3 + VIDEO_RETRY_LIMIT);
    // Other kinds keep the old rule without a cap.
    const other = vi.fn((_: LoadRequest) => Promise.reject(new Error('x')));
    const meshJobs = createLoadJobs<{ dispose(): void }>(other, vi.fn(), { now: () => clock.time });
    const mesh = new Map([['prop', { kind: 'mesh' as const, assetId: 'scene_a' }]]);
    meshJobs.reconcile(mesh, 1); await settle();
    for (let i = 0; i < 6; i++) { clock.time += 3000; meshJobs.reconcile(mesh, 2 + i); await settle(); }
    expect(other).toHaveBeenCalledTimes(7);
});
it('turns an error after the load into a failed job (R15)', () => {
    const jobs = createLoadJobs<{ dispose(): void }>(vi.fn(() => new Promise<never>(() => {})), vi.fn());
    jobs.fail('screen', { kind: 'video', assetId: 'video_a' }, 'Video codec not supported: VP9');
    expect(jobs.status()).toEqual([{ entityId: 'screen', assetId: 'video_a', stage: 'failed', progress: null, message: 'Video codec not supported: VP9' }]);
});

// The renderer paths of R12, R14, R15, and R16, with a stand-in source and player.
const settle = () => new Promise(r => setTimeout(r, 0));
let sequence = 0;
const placed = { visible: true, transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] } };
const videoScreen = (id: string, assetId: string | null, visible = true): SceneEntity => ({ id, name: id, ...placed, visible, kind: 'screen', content: { kind: 'video', assetId, autoPlay: true, loop: true, volume: 0.5 } });
function frame(entities: SceneEntity[], playback?: ScreenPlayback[]): RuntimeFrame {
    const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
    f.scene.entities = [...f.scene.entities.filter(e => e.kind === 'camera'), ...entities];
    f.scene.revision = sequence;
    if (playback) f.screenPlayback = playback;
    return f;
}
const quads = () => { const found: Mesh[] = []; (ports.render.mock.lastCall![0] as Group).traverse(o => { if ((o as Mesh).isMesh) found.push(o as Mesh); }); return found; };
const player = (alpha = false) => ({ texture: new Texture(), width: 64, height: 36, alpha, sync: vi.fn(() => null), pause: vi.fn(), failure: vi.fn((): string | undefined => undefined), settled: vi.fn(async () => {}), dispose: vi.fn() });
beforeEach(() => { ports.source.mockReset().mockImplementation(async () => source()); ports.open.mockReset(); ports.render.mockReset().mockResolvedValue(undefined); ports.compile.mockReset().mockResolvedValue(undefined); });
const make = (audio?: boolean) => createRenderer({ canvas: { width: 1920, height: 1080 } as HTMLCanvasElement, outputId: 'output_main', mode: 'force-webgl2', resources: { readAsset: vi.fn() }, diagnostics: false, quality: QUALITY_PROFILES.production_v1, ...(audio === undefined ? {} : { audio }) });
it('gives each video screen its own element, one object URL for each asset, and a quad with the video aspect', async () => {
    const players = [player(), player(true)];
    ports.open.mockImplementationOnce(async () => players[0]).mockImplementationOnce(async () => players[1]);
    const r = await make();
    const entities = [videoScreen('a', 'video_x'), videoScreen('b', 'video_x'), videoScreen('empty', null)];
    const playback = [{ entityId: 'a', playing: true, positionMs: 100 }, { entityId: 'b', playing: false, positionMs: 0 }];
    await r.applyFrame(frame(entities, playback));
    await settle();
    const applied = await r.applyFrame(frame(entities, playback));
    expect(ports.source).toHaveBeenCalledTimes(1);
    expect(ports.open).toHaveBeenCalledTimes(2);
    expect(ports.open.mock.calls.map(c => (c[1] as { audio: boolean; upload: string }))).toMatchObject([{ audio: false, upload: 'element' }, { audio: false, upload: 'element' }]);
    expect(applied.warnings).toEqual([]);
    const drawn = quads();
    expect(drawn).toHaveLength(2);
    drawn[0]!.geometry.computeBoundingBox();
    expect(drawn[0]!.geometry.boundingBox!.max.x).toBeCloseTo(32 / 36);
    expect((drawn[1]!.material as MeshBasicNodeMaterial).transparent).toBe(true);
    expect(players[0]!.sync).toHaveBeenLastCalledWith({ entityId: 'a', playing: true, positionMs: 100 }, expect.objectContaining({ loop: true, volume: 0.5 }), true);
    expect(players[1]!.sync).toHaveBeenLastCalledWith({ entityId: 'b', playing: false, positionMs: 0 }, expect.anything(), true);
    r.pauseVideos();
    expect(players[0]!.pause).toHaveBeenCalled();
    await expect(r.videoSettled('a')).resolves.toBeUndefined();
    await expect(r.videoSettled('empty')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // The source URL goes when no screen uses the asset.
    const sourceValue = await ports.source.mock.results[0]!.value as VideoSource;
    await r.applyFrame(frame([videoScreen('a', null)]));
    expect(players[0]!.dispose).toHaveBeenCalled();
    expect(players[1]!.dispose).toHaveBeenCalled();
    expect(sourceValue.dispose).toHaveBeenCalledTimes(1);
    r.dispose();
});
it('passes the audio flag of the OBS page to each player (R16)', async () => {
    ports.open.mockImplementation(async () => player());
    const r = await make(true);
    await r.applyFrame(frame([videoScreen('a', 'video_x')]));
    await settle();
    expect(ports.open.mock.lastCall![1]).toMatchObject({ audio: true });
    r.dispose();
});
it('names a failed video, draws nothing for it, and still draws the other screens (R15)', async () => {
    ports.source.mockImplementation(async (read: unknown) => { void read; throw Object.assign(new Error('Video codec not supported: HEVC'), { code: 'UNSUPPORTED', ids: [] }); });
    const r = await make();
    await r.applyFrame(frame([videoScreen('bad', 'video_hevc')]));
    await settle();
    ports.source.mockReset().mockImplementation(async () => source());
    ports.open.mockImplementation(async () => player());
    const both = [videoScreen('bad', 'video_hevc'), videoScreen('good', 'video_h264')];
    const applied = await r.applyFrame(frame(both));
    expect(applied.warnings).toContainEqual({ code: 'UNAVAILABLE', message: 'Asset load failed: Video codec not supported: HEVC', ids: ['video_hevc'] });
    await settle();
    await r.applyFrame(frame(both));
    expect(quads()).toHaveLength(1);
    r.dispose();
});
it('removes a video whose element fails after the load and reports it with the frame warning (R15)', async () => {
    const p = player();
    ports.open.mockImplementation(async () => p);
    const r = await make();
    await r.applyFrame(frame([videoScreen('a', 'video_x')]));
    await settle();
    await r.applyFrame(frame([videoScreen('a', 'video_x')]));
    expect(quads()).toHaveLength(1);
    p.failure.mockReturnValue('Video codec not supported: H.264');
    const applied = await r.applyFrame(frame([videoScreen('a', 'video_x')]));
    expect(applied.warnings).toContainEqual({ code: 'UNAVAILABLE', message: 'Asset load failed: Video codec not supported: H.264', ids: ['video_x'] });
    expect(p.dispose).toHaveBeenCalled();
    expect(quads()).toEqual([]);
    r.dispose();
});
it('puts the playback warning on the frame with the asset ID', async () => {
    const p = player();
    p.sync.mockReturnValue({ code: 'UNSUPPORTED', message: VIDEO_PLAYBACK_BLOCKED, ids: [] } as never);
    ports.open.mockImplementation(async () => p);
    const r = await make();
    await r.applyFrame(frame([videoScreen('a', 'video_x')], [{ entityId: 'a', playing: true, positionMs: 0 }]));
    await settle();
    const applied = await r.applyFrame(frame([videoScreen('a', 'video_x')], [{ entityId: 'a', playing: true, positionMs: 16 }]));
    expect(applied.warnings).toContainEqual({ code: 'UNSUPPORTED', message: VIDEO_PLAYBACK_BLOCKED, ids: ['video_x'] });
    r.dispose();
});
