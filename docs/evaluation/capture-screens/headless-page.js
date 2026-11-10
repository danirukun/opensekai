// The page of headless-check.mjs (B31 Operation 4.1 and 4.3): one real renderer instance with a capture host. The status
// stream comes from the harness (the host part of R9). `open` is either the real browser-client socket to the stub
// /capture server (socket mode) or an in-page feeder of the fixture chunks (spike mode).
import { createRenderer } from '../../../packages/renderer/src/index.ts';
import { openCaptureSocket } from '../../../packages/browser-client/src/index.ts';
import { QUALITY_PROFILES } from '../../../packages/contracts/src/index.ts';

const canvas = document.getElementById('output');
let renderer = null, scene = null, sequence = 0, timer = null, busy = false, last = null, lastError = null;
let status = { kind: 'captureStatus', revision: 1, screens: [] };
const listeners = new Set();
const opened = [];
let feeder = null;
const toBase64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
async function fixture(name) {
    const index = await (await fetch(`/fixture/${name}.json`)).json();
    const blob = new Uint8Array(await (await fetch(`/fixture/${name}.bin`)).arrayBuffer());
    return { index, chunks: index.chunks.map(c => ({ key: c.key, timestampUs: c.timestampUs, data: blob.slice(c.offset, c.offset + c.length) })) };
}

window.harness = {
    async create({ backend, mode, wsPort }) {
        const descriptor = { schemaVersion: 1, sessionId: 'session_check', httpOrigin: `http://127.0.0.1:${wsPort}/`, wsUrl: `ws://127.0.0.1:${wsPort}/ws`, role: 'renderer', token: 'renderer-token', capabilities: ['read'], outputId: 'output_main' };
        const main = mode === 'spike' ? await fixture('h264-main') : null;
        const capture = {
            onStatus(listener) { listeners.add(listener); listener(status); return () => listeners.delete(listener); },
            open(streamId, handlers) {
                opened.push(streamId);
                if (mode !== 'spike') return openCaptureSocket(descriptor, streamId, handlers);
                // Spike mode: config, then the chunks from the last key frame up to one frame index.
                let closed = false;
                feeder = {
                    config() { if (!closed) handlers.config({ codec: main.index.codec, description: fromBase64(main.index.description), codedWidth: main.index.codedWidth, codedHeight: main.index.codedHeight }); },
                    // Spaced by 20 ms, as a live stream is, so the decode queue stays under the R14 drop limit.
                    async show(frame, loop) { for (let i = Math.floor(frame / 30) * 30; i <= frame && !closed; i++) { handlers.chunk({ ...main.chunks[i], timestampUs: main.chunks[i].timestampUs + loop * 2_000_000 }); await new Promise(r => setTimeout(r, 20)); } },
                };
                return { close() { closed = true; handlers.closed(1000); } };
            },
        };
        renderer = await createRenderer({ canvas, outputId: 'output_main', mode: backend === 'webgl2' ? 'force-webgl2' : 'auto', diagnostics: true, quality: QUALITY_PROFILES.production_v1, capture,
            resources: { readAsset: () => Promise.reject(new Error('No assets')) } });
    },
    setScene(next) { scene = next; },
    setStatus(screens) { status = { kind: 'captureStatus', revision: (scene?.revision ?? 0), screens }; for (const listener of listeners) listener(status); },
    spikeConfig() { feeder.config(); },
    spikeShow(frame, loop) { return feeder.show(frame, loop); },
    start(intervalMs = 16) {
        clearInterval(timer);
        timer = setInterval(() => {
            if (busy || !scene) return;
            busy = true;
            renderer.applyFrame({ schemaVersion: 1, sessionId: 'session_check', sequence: ++sequence, tick: sequence, elapsedMs: sequence * 16, scene })
                .then(applied => { last = applied; lastError = null; }, error => { lastError = error.message; }).finally(() => { busy = false; });
        }, intervalMs);
    },
    stop() { clearInterval(timer); timer = null; },
    last() { return { applied: last, error: lastError, sequence }; },
    sockets() { return renderer.captureSockets(); },
    opened() { return [...opened]; },
    pause() { renderer.pauseVideos(); },
    decoder() { return renderer.videoDecoder(); },
    diagnostics() { return renderer.diagnostics('epoch'); },
    async screenshot() { const shot = await renderer.screenshot('camera_wide', scene.revision); return toBase64(shot.png); },
    // The browser's own decode of the fixture, drawn on a 2D canvas, at each frame index: the color reference.
    async reference(indices) {
        if (typeof VideoDecoder === 'undefined') return { error: 'VideoDecoder missing' };
        const main = await fixture('h264-main');
        const config = { codec: main.index.codec, description: fromBase64(main.index.description), codedWidth: 320, codedHeight: 180, optimizeForLatency: true };
        const support = await VideoDecoder.isConfigSupported(config);
        if (!support.supported) return { error: 'H.264 not supported', support: support.supported };
        const draw = new OffscreenCanvas(320, 180), context = draw.getContext('2d', { willReadFrequently: true });
        const out = new Map(), wanted = new Set(indices);
        let n = 0, failure = null;
        const decoder = new VideoDecoder({ output: frame => { const i = n++; if (wanted.has(i)) { context.drawImage(frame, 0, 0); out.set(i, Array.from(context.getImageData(160, 90, 1, 1).data)); } frame.close(); }, error: e => { failure = String(e); } });
        decoder.configure(config);
        for (const chunk of main.chunks) decoder.decode(new EncodedVideoChunk({ type: chunk.key ? 'key' : 'delta', timestamp: chunk.timestampUs, data: chunk.data }));
        await decoder.flush().catch(e => { failure = String(e); });
        decoder.close();
        return { decoded: n, failure, pixels: indices.map(i => out.get(i) ?? null) };
    },
    dispose() { clearInterval(timer); renderer?.dispose(); },
};
