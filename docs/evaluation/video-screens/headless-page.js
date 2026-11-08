// The page of headless-check.mjs: one real renderer instance and a session-shaped frame stream (B29 R11 frame field).
// The clock follows R11: the position is offsetMs + (elapsedMs - anchorMs) while playing and offsetMs while paused.
import { createRenderer } from '../../../packages/renderer/src/index.ts';
import { QUALITY_PROFILES } from '../../../packages/contracts/src/index.ts';

const canvas = document.getElementById('output');
const t0 = performance.now();
const now = () => performance.now() - t0;
let renderer = null, scene = null, sequence = 0, timer = null, busy = false, last = null, lastError = null;
const entries = new Map();
const position = entry => Math.max(0, Math.round(entry.playing ? entry.offsetMs + (now() - entry.anchorMs) : entry.offsetMs));
const frame = () => ({
    schemaVersion: 1, sessionId: 'session_check', sequence: ++sequence, tick: sequence, elapsedMs: Math.round(now()), scene,
    ...(entries.size ? { screenPlayback: [...entries].map(([entityId, entry]) => ({ entityId, playing: entry.playing, positionMs: position(entry) })) } : {}),
});
const toBase64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };
const timeout = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timeout')), ms))]);

window.harness = {
    async create({ backend, audio }) {
        renderer = await createRenderer({
            canvas, outputId: 'output_main', mode: backend === 'webgl2' ? 'force-webgl2' : 'auto', diagnostics: false, quality: QUALITY_PROFILES.production_v1, audio,
            resources: { readAsset: id => fetch('/media/' + id).then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error('Asset not found'))) },
        });
    },
    setScene(next) { scene = next; },
    // Sets one entry as the session does after play, pause, or restart.
    setPlayback(entityId, { playing, offsetMs }) { entries.set(entityId, { playing, offsetMs, anchorMs: now() }); },
    clearPlayback(entityId) { entries.delete(entityId); },
    position(entityId) { const entry = entries.get(entityId); return entry ? position(entry) : null; },
    start(intervalMs = 16) {
        clearInterval(timer);
        timer = setInterval(() => {
            if (busy || !scene) return;
            busy = true;
            renderer.applyFrame(frame()).then(applied => { last = applied; lastError = null; }, error => { lastError = error.message; }).finally(() => { busy = false; });
        }, intervalMs);
    },
    stop() { clearInterval(timer); timer = null; },
    last() { return { applied: last, error: lastError, sequence }; },
    settled(entityId) { return timeout(renderer.videoSettled(entityId), 5000, 'videoSettled').then(() => 'settled', error => error.message); },
    pauseVideos() { renderer.pauseVideos(); },
    async screenshot() {
        const shot = await renderer.screenshot('camera_wide', scene.revision);
        return toBase64(shot.png);
    },
    // The browser's own decode of the file (a 2D canvas draw of a fresh element) at each time, as the color reference.
    async reference(id, times) {
        const blob = await (await fetch('/media/' + id)).blob();
        const video = document.createElement('video');
        video.muted = true;
        video.src = URL.createObjectURL(blob);
        await timeout(new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('element error ' + video.error?.code)); }), 10000, 'reference load');
        const out = [];
        const draw = document.createElement('canvas'); draw.width = video.videoWidth; draw.height = video.videoHeight;
        const context = draw.getContext('2d', { willReadFrequently: true });
        for (const time of times) {
            video.currentTime = time / 1000;
            await timeout(new Promise(resolve => { video.onseeked = resolve; }), 5000, 'reference seek');
            const at = (x, y) => Array.from(context.getImageData(Math.floor(x * draw.width), Math.floor(y * draw.height), 1, 1).data);
            // A draw right after `seeked` can be empty; the right half of each test file is opaque, so draw again until it is.
            for (let attempt = 0; attempt < 20; attempt++) {
                context.clearRect(0, 0, draw.width, draw.height);
                context.drawImage(video, 0, 0);
                if (at(0.75, 0.5)[3] > 0) break;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            out.push({ time, right: at(0.75, 0.5), left: at(0.25, 0.5) });
        }
        URL.revokeObjectURL(video.src);
        return out;
    },
    dispose() { clearInterval(timer); renderer?.dispose(); },
};
window.harnessReady = true;
