// Headless check of the camera effects on the OBS page (B37 operation 7, HC0 to HC7).
// The built OBS page (apps/output/dist) runs the real renderer in Chromium with `?backend=webgl2` at 1920 x 1080, because
// the headless WebGPU canvas gives an empty image. A stand-in for the host serves the page and the generated test images,
// answers the renderer WebSocket, and sends the frames of a real @opensekai/session. Each step is a setCameraEffects patch,
// as scene_patch sends it. The script makes each test image; no test image file is committed.
// Run from the repository root after `pnpm --filter @opensekai/output build`:
//   pnpm exec tsx docs/evaluation/camera-effects/headless-check.mjs <output dir>
// BACKEND=webgpu runs the same steps on WebGPU and checks only the chain build (the frame warnings), because the headless
// WebGPU canvas gives an empty image. It writes headless-check-webgpu.json and .txt.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {extname, join} from 'node:path';
const require = createRequire(process.cwd() + '/apps/desktop/package.json');
const {chromium} = require('playwright');
const {PNG} = createRequire(process.cwd() + '/package.json')('pngjs');
const root = pathToFileURL(process.cwd() + '/').href;
const {createSession} = await import(root + 'packages/session/src/index.ts');
const {makeSmokeScene, DEFAULT_CAMERA_EFFECTS: D} = await import(root + 'packages/contracts/src/index.ts');
const {chromiumGpuArgs} = await import(root + 'scripts/gpu-probe.ts');
const px = await import(root + 'docs/evaluation/camera-effects/pixels.mjs');
const out = process.argv[2] ?? '.';
const BACKEND = process.env.BACKEND ?? 'webgl2', SUFFIX = BACKEND === 'webgl2' ? '' : '-' + BACKEND;
const lines = [];
const log = (...a) => { const line = a.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' '); lines.push(line); console.log(line); };
const results = [];
const report = list => { for (const [name, pass, detail] of list) { results.push({name, pass, detail}); log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

const PORT = 4179, ORIGIN = `http://127.0.0.1:${PORT}`, SESSION = 'session_check', CAMERA = 'camera_wide';
const dist = join(process.cwd(), 'apps/output/dist');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css'};
const images = new Map([['image_gray', px.grayPng(PNG)], ['image_dirt', px.dirtPng(PNG)]]);
const server = createServer(async (req, res) => {
    try {
        const path = new URL(req.url, ORIGIN).pathname;
        const asset = /^\/assets\/([A-Za-z0-9_]+)$/.exec(path);
        if (asset && images.has(asset[1])) { const body = images.get(asset[1]); res.writeHead(200, {'content-type': 'image/png', 'x-content-type-options': 'nosniff', 'content-length': body.length}); res.end(body); return; }
        const body = await readFile(join(dist, path === '/' ? 'index.html' : path));
        res.writeHead(200, {'content-type': types[extname(path)] ?? (path === '/' ? 'text/html' : 'application/octet-stream')}); res.end(body);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({args: chromiumGpuArgs});

// Operation 7: no environment, the cameras of the smoke scene, and one image screen in the middle of the frame.
const scene = makeSmokeScene();
scene.entities = scene.entities.filter(entity => entity.kind === 'camera');
const s = px.SCREEN_SCALE;
scene.entities.push({id: 'screen_gray', name: 'Screen', visible: true, transform: {position: [0, 1.2, 0], rotation: [0, 0, 0, 1], scale: [s, s, s]}, kind: 'screen', content: {kind: 'image', assetId: 'image_gray'}});
const session = createSession(scene, SESSION);
const descriptor = {schemaVersion: 1, sessionId: SESSION, httpOrigin: ORIGIN + '/', wsUrl: `ws://127.0.0.1:${PORT}/ws`, role: 'renderer', token: 'token_renderer', capabilities: ['read'], outputId: 'output_main'};
let socket = null, sequence = 0, last = null, sending = true;
// Frames pause during a capture so that the software adapter finishes the readback inside the handler timeout (as in output-format).
const captures = new Map();
const timer = setInterval(() => { if (socket && sending) { sequence++; socket.send(JSON.stringify({kind: 'frame', frame: {schemaVersion: 1, sessionId: SESSION, sequence, tick: sequence, elapsedMs: sequence * 16, scene: session.inspect()}})); } }, 16);
const context = await browser.newContext({viewport: {width: px.W, height: px.H}, deviceScaleFactor: 1});
await context.routeWebSocket(descriptor.wsUrl, ws => {
    ws.onMessage(text => {
        const message = JSON.parse(String(text));
        if (message.kind === 'auth') { ws.send(JSON.stringify({kind: 'authReply', sessionId: SESSION, schemaVersion: 1, capabilities: ['read']})); socket = ws; return; }
        if (message.kind === 'applied') last = message.frame;
        if (message.kind === 'captureReply') captures.get(message.requestId)?.(message.result);
    });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await page.goto(`${ORIGIN}/?quality=production_v1${BACKEND === 'webgl2' ? '&backend=webgl2' : ''}#${encodeURIComponent(JSON.stringify(descriptor))}`);

const record = {date: new Date().toISOString(), backend: BACKEND, viewport: [px.W, px.H], steps: []};
// The capture of output-format: the renderer draws the displayed frame again and reads the canvas as a PNG with straight
// alpha. A page screenshot times out on this software adapter at 1920 x 1080. The renderer allows one capture each second.
async function captureOnce() {
    const id = 'cap_' + Math.random().toString(36).slice(2);
    const reply = new Promise(resolve => captures.set(id, resolve));
    socket.send(JSON.stringify({kind: 'captureRequest', requestId: id, params: {outputId: 'output_main', expectedRevision: session.inspect().revision, preset: 'diagnostic_v1', maxAgeMs: 500}}));
    const result = await Promise.race([reply, wait(60000).then(() => ({ok: false, error: {message: 'no capture reply'}}))]);
    captures.delete(id);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return {buffer: Buffer.from(result.data.pngBase64, 'base64'), metadata: result.data.metadata};
}
const capture = async (tries = 3) => { try { return await captureOnce(); } catch (error) { if (tries <= 1) throw error; await wait(1200); return capture(tries - 1); } };
// One setCameraEffects patch, as scene_patch sends it, then a stable image (two equal captures in a row).
async function step(label, effects, file) {
    const revision = session.inspect().revision;
    const reply = session.applyPatch({sceneId: scene.sceneId, expectedRevision: revision, operations: [{kind: 'setCameraEffects', entityId: CAMERA, effects}]});
    if (!reply.ok) throw new Error(`${label}: ${JSON.stringify(reply.error)}`);
    const after = sequence + 5, start = Date.now();
    while (Date.now() - start < 60000 && (!last || last.sequence < after || last.warnings.some(w => w.code === 'BUSY'))) await wait(100);
    await wait(1500);
    sending = false;
    await wait(1000);
    let previous = null, image = null, metadata = null;
    for (let i = 0; i < 6; i++) {
        const shot = await capture();
        metadata = shot.metadata;
        if (previous && shot.buffer.equals(previous)) { image = PNG.sync.read(shot.buffer); break; }
        previous = shot.buffer; await wait(1100);
    }
    sending = true;
    if (image && (image.width !== px.W || image.height !== px.H)) throw new Error(`${label}: the capture is ${image.width} x ${image.height}`);
    const entry = {label, effects, backend: last?.backend, capture: metadata && {width: metadata.width, height: metadata.height, revision: metadata.frame.revision}, sequence: last?.sequence, warnings: last?.warnings ?? [], stable: image !== null};
    record.steps.push(entry);
    log('STEP', label, {backend: entry.backend, warnings: entry.warnings, stable: entry.stable});
    if (!image) throw new Error(`${label}: the page image did not settle`);
    if (file) { await writeFile(join(out, file), px.half(PNG, image)); entry.image = file; }
    return {image, entry};
}

const black = {...D.vignetting, enabled: true, color: '#000000', alpha: 1, fadeOut: 0, blink: 0};
const all = {lensDirt: {assetId: 'image_dirt', intensity: 1, threshold: 0}, vignetting: {...D.vignetting, enabled: true, alpha: 0.6}, nightVision: {...D.nightVision, enabled: true}, blur: {enabled: true, intensity: 2}, pixelate: {enabled: true, intensity: 16}};
const off = {lensDirt: {...all.lensDirt, assetId: null}, vignetting: {...all.vignetting, enabled: false}, nightVision: {...all.nightVision, enabled: false}, blur: {...all.blur, enabled: false}, pixelate: {...all.pixelate, enabled: false}};
let failure = null;
// WebGPU: the chain of each effect and of all five builds without a Pipeline compile failed warning or a page error.
async function compileOnly(label, effects) {
    const revision = session.inspect().revision;
    const reply = session.applyPatch({sceneId: scene.sceneId, expectedRevision: revision, operations: [{kind: 'setCameraEffects', entityId: CAMERA, effects}]});
    if (!reply.ok) throw new Error(`${label}: ${JSON.stringify(reply.error)}`);
    const after = sequence + 30, start = Date.now();
    while (Date.now() - start < 60000 && (!last || last.sequence < after || last.warnings.some(w => w.code === 'BUSY'))) await wait(100);
    await wait(2000);
    const entry = {label, effects, backend: last?.backend, sequence: last?.sequence, warnings: last?.warnings ?? []};
    record.steps.push(entry);
    log('STEP', label, {backend: entry.backend, sequence: entry.sequence, warnings: entry.warnings});
    report([[`${label}: the backend is ${BACKEND} and the frame has no warning`, entry.backend === BACKEND && entry.warnings.length === 0 && last.sequence >= after, entry.warnings]]);
}
if (BACKEND !== 'webgl2') try {
    await compileOnly('HC0 baseline', null);
    await compileOnly('HC1 vignetting', {vignetting: black});
    await compileOnly('HC2 night vision', {nightVision: {...D.nightVision, enabled: true}});
    await compileOnly('HC3 blur 4', {blur: {enabled: true, intensity: 4}});
    await compileOnly('HC4 pixelate 64', {pixelate: {enabled: true, intensity: 64}});
    await compileOnly('HC5 lens dirt', {lensDirt: {assetId: 'image_dirt', intensity: 1, threshold: 0}});
    await compileOnly('HC6 all five effects', all);
    await compileOnly('HC7 all effects off', off);
    log('NOT RUN', 'the pixel tests of HC0 to HC7 (the headless WebGPU canvas gives an empty image)');
} catch (error) { failure = String(error.stack ?? error); log('ERROR', failure); }
else try {
    const {image: base, entry: first} = await step('HC0 baseline', null, 'baseline-webgl2.png');
    report([['HC0: the backend is webgl2', first.backend === 'webgl2', first.backend], ['HC0: the frame has no warning', first.warnings.length === 0, first.warnings]]);
    report(px.hc0(base));
    report(px.hc1(base, (await step('HC1 vignetting alpha 1', {vignetting: black}, 'vignetting-webgl2.png')).image));
    report(px.hc1Blink(base, (await step('HC1 vignetting blink 1', {vignetting: {...D.vignetting, enabled: true, blink: 1}}, 'vignetting-blink-webgl2.png')).image));
    report(px.hc2(base, (await step('HC2 night vision', {nightVision: {...D.nightVision, enabled: true}}, 'night-vision-webgl2.png')).image));
    report(px.hc3(base, (await step('HC3 blur 4', {blur: {enabled: true, intensity: 4}}, 'blur-webgl2.png')).image));
    report(px.hc4(base, (await step('HC4 pixelate 64', {pixelate: {enabled: true, intensity: 64}}, 'pixelate-webgl2.png')).image));
    const dirt = await step('HC5 lens dirt', {lensDirt: {assetId: 'image_dirt', intensity: 1, threshold: 0}}, 'lens-dirt-webgl2.png');
    report([['HC5: the dirt image loads without a warning', dirt.entry.warnings.length === 0, dirt.entry.warnings]]);
    report(px.hc5(base, dirt.image));
    const every = await step('HC6 all five effects', all, 'all-effects-webgl2.png');
    report([
        ['HC6: the chain builds with all five effects (no Pipeline compile failed warning)', !every.entry.warnings.some(w => /Pipeline compile failed/.test(w.message)), every.entry.warnings],
        ['HC6: the frame changes', px.same(base, every.image, '')[0][1] === false, null],
    ]);
    report(px.same(base, (await step('HC7 all effects off', off)).image, 'HC7: all effects off again equals the baseline (±1)'));
    report(px.same(base, (await step('HC7 effects removed', null)).image, 'HC7: the effects removed (null) equal the baseline (±1)'));
} catch (error) { failure = String(error.stack ?? error); log('ERROR', failure); }
report([['no page errors', errors.length === 0, errors]]);
clearInterval(timer);
await browser.close(); server.close();
record.errors = errors; record.failure = failure;
record.results = results.map(({name, pass}) => ({name, pass}));
await writeFile(join(out, `headless-check${SUFFIX}.json`), JSON.stringify(record, null, 1) + '\n');
const failed = results.filter(result => !result.pass).length + (failure ? 1 : 0);
log(`${results.length - failed + (failure ? 1 : 0)} pass, ${failed} fail`);
await writeFile(join(out, `headless-check${SUFFIX}.txt`), lines.join('\n') + '\n');
process.exit(failed ? 1 : 0);
