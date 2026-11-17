// Headless check of the camera effects in the Editor window (B37 operation 7, HC8).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands and routes the
// operator WebSocket to the session of the Editor window (the method of image-screens/editor-check.mjs). The preview
// renderer answers each camera screenshot request; the pixel tests are the HC1 and HC4 tests of headless-check.mjs.
// `import_image` returns a record for the dirt image that this script makes; the stand-in serves its bytes.
// Run from the repository root after `pnpm --filter @opensekai/desktop build`:
//   pnpm exec tsx docs/evaluation/camera-effects/editor-check.mjs <output dir>
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const require = createRequire(process.cwd() + '/apps/desktop/package.json');
const {chromium} = require('playwright');
const {PNG} = createRequire(process.cwd() + '/package.json')('pngjs');
const root = pathToFileURL(process.cwd() + '/').href;
const {chromiumGpuArgs} = await import(root + 'scripts/gpu-probe.ts');
const px = await import(root + 'docs/evaluation/camera-effects/pixels.mjs');
const out = process.argv[2] ?? '.';
const results = [], lines = [];
const log = (...a) => { const line = a.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' '); lines.push(line); console.log(line); };
const check = (name, pass, detail) => { results.push({name, pass}); log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); };
const report = list => { for (const [name, pass, detail] of list) check(name, pass, detail); };

const imageRecord = (bytes, name, width, height) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return {id: `image_${sha256}`, format: 'png', sha256, bytes: bytes.length, sourceUrl: null, licenseLabel: 'User supplied', importerVersion: 1, name, expressions: [], image: {width, height, frames: 1}};
};
const grayBytes = px.grayPng(PNG), dirtBytes = px.dirtPng(PNG);
const gray = imageRecord(grayBytes, 'Gray', 64, 32), dirt = imageRecord(dirtBytes, 'Dirt', 64, 64);
const bodies = new Map([[gray.id, grayBytes], [dirt.id, dirtBytes]]);

const SESSION = 'session_check', PORT = 4180, ORIGIN = `http://127.0.0.1:${PORT}`, OTHER = 'camera_other';
// The new show of the Editor window has one camera, camera_main at [0, 1.2, 3]; the script adds a second camera.
let CAMERA = 'camera_main';
const {WebSocketServer} = createRequire(process.cwd() + '/apps/mcp/package.json')('ws');
const dist = join(process.cwd(), 'apps/desktop/dist');
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2'};
const http = createServer(async (req, res) => {
    const path = new URL(req.url, ORIGIN).pathname;
    const asset = /^\/assets\/(image_[0-9a-f]{64})$/.exec(path);
    if (asset) {
        const body = bodies.get(asset[1]);
        if (body) { res.writeHead(200, {'content-type': 'image/png', 'x-content-type-options': 'nosniff', 'content-length': body.length}); res.end(body); }
        else { res.writeHead(404); res.end(); }
        return;
    }
    try { const body = await readFile(join(dist, path === '/' ? 'index.html' : path)); res.writeHead(200, {'content-type': mime[extname(path)] ?? (path === '/' ? 'text/html' : 'application/octet-stream')}); res.end(body); }
    catch { res.writeHead(404); res.end(); }
});
const wss = new WebSocketServer({server: http, path: '/ws'});
await new Promise(resolve => http.listen(PORT, '127.0.0.1', resolve));
const descriptor = (role, capabilities, outputId) => ({schemaVersion: 1, sessionId: SESSION, httpOrigin: ORIGIN + '/', wsUrl: `ws://127.0.0.1:${PORT}/ws`, role, token: `token_${role}_${outputId ?? 'none'}`, capabilities, outputId});
// The library has the gray image; Import file… adds the dirt image. RENDERER_MODE=force-webgl2 runs the preview on WebGL 2.
const MODE = process.env.RENDERER_MODE ?? 'auto', SUFFIX = MODE === 'auto' ? '' : '-webgl2';
log('renderer mode', MODE);
const info = {publisher: descriptor('publisher', ['read', 'edit'], null), operator: descriptor('operator', ['read', 'edit'], null), preview: descriptor('renderer', ['read'], 'preview_main'), output: descriptor('renderer', ['read'], 'output_main'), operatorDescriptorFile: 'operator.json', rendererDescriptorFile: 'renderer.json', assets: [gray], fixtureMode: false, rendererMode: MODE};
const browser = await chromium.launch({args: chromiumGpuArgs});
const context = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
await context.exposeBinding('__importImage', () => ({record: dirt, name: dirt.name}));
await context.addInitScript(info => {
    let next = 1; const callbacks = new Map();
    window.__imports = [];
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener() {}};
    window.__TAURI_INTERNALS__ = {
        metadata: {currentWindow: {label: 'main'}, currentWebview: {windowLabel: 'main', label: 'main'}},
        transformCallback(callback) { const id = next++; callbacks.set(id, callback); return id; },
        unregisterCallback(id) { callbacks.delete(id); },
        convertFileSrc: path => path,
        async invoke(command) {
            if (command === 'bootstrap_session') return info;
            if (command === 'import_image') { window.__imports.push(command); return window.__importImage(); }
            if (command.startsWith('plugin:event|')) return next++;
            return null;
        },
    };
}, info);
let publisher = null, preview = null, shot = null, previewBackend = null, nextCall = 1;
const pending = new Map(), calls = [];
// appStatus gives the current revision, as the host does, so the Editor window reloads after a patch of this script.
const status = async () => { const scene = await hostCall('sceneInspect', {sceneId: 'scene_smoke'}); return {ok: true, data: {schemaVersion: 1, sessionId: SESSION, ready: true, revision: scene.ok ? scene.data.revision : 0, capabilities: ['read', 'edit'], warnings: [], outputs: []}}; };
const hostCall = async (method, params) => {
    for (let i = 0; !publisher && i < 200; i++) await new Promise(r => setTimeout(r, 50));
    if (!publisher) return {ok: false, error: {code: 'UNAVAILABLE', message: 'No publisher', ids: []}};
    return new Promise(resolve => { const requestId = `host_${nextCall++}`; pending.set(requestId, resolve); publisher.send(JSON.stringify({kind: 'call', requestId, method, params})); });
};
const begun = Date.now();
const clock = setInterval(() => publisher?.send(JSON.stringify({kind: 'clock', sessionId: SESSION, elapsedMs: Date.now() - begun})), 16);
wss.on('connection', ws => {
    let role = null, renderer = null;
    ws.on('message', async data => {
        const text = String(data), message = JSON.parse(text);
        if (message.kind === 'auth') {
            role = message.role; renderer = message.outputId ?? null;
            if (role === 'publisher') publisher = ws;
            if (role === 'renderer' && renderer === 'preview_main') preview = ws;
            ws.send(JSON.stringify({kind: 'authReply', sessionId: SESSION, schemaVersion: 1, capabilities: role === 'renderer' ? ['read'] : ['read', 'edit']}));
            return;
        }
        if (message.kind === 'ping') { ws.send(JSON.stringify({kind: 'pong', nonce: message.nonce})); return; }
        if (role === 'publisher' && message.kind === 'reply') { const resolve = pending.get(message.requestId); pending.delete(message.requestId); resolve?.(message.result); return; }
        if (role === 'publisher' && message.kind === 'frame') { preview?.send(text); return; }
        if (role === 'renderer' && renderer === 'preview_main' && message.kind === 'applied') { previewBackend = message.frame?.backend ?? previewBackend; return; }
        if (role === 'renderer' && message.kind === 'screenshotReply') { shot = message.result; return; }
        if (role === 'operator' && message.kind === 'call') {
            calls.push({method: message.method, params: message.params});
            const result = message.method === 'appStatus' ? await status() : await hostCall(message.method, message.params);
            if (message.method === 'scenePatch' && !result.ok) log('scenePatch refused', message.params.operations.map(op => op.kind), message.params.expectedRevision, result.error, calls.slice(-6).map(c => c.method));
            ws.send(JSON.stringify({kind: 'reply', requestId: message.requestId, result}));
        }
    });
});
const refresh = async () => { const reply = await hostCall('sceneInspect', {sceneId: 'scene_smoke'}); if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.data; };
const patch = async operations => { const current = await refresh(); return hostCall('scenePatch', {sceneId: current.sceneId, expectedRevision: current.revision, operations}); };
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => { errors.push(error.message); log('pageerror', error.message); });
page.on('console', m => { if (m.type() === 'error') log('console', m.text().slice(0, 400)); });
const settle = (ms = 600) => page.waitForTimeout(ms);
const patches = () => calls.filter(call => call.method === 'scenePatch').flatMap(call => call.params.operations);
const cameraOf = (scene, id) => scene.entities.find(entity => entity.id === id);
const pageShot = async name => { try { await page.screenshot({path: join(out, name), timeout: 20000}); return name; } catch (error) { log('UNKNOWN page screenshot', name, String(error.message).split('\n')[0]); return null; } };

await page.goto(ORIGIN + '/?view=editor');
// The session mark has the text only in an error; a connected session shows its state in the class and the title.
await page.locator('.session-mark.connected').waitFor({timeout: 30000});
// The start screen shows on a normal launch; close it first.
await settle(500);
const startScreen = page.locator('section.start-screen');
if (await startScreen.count()) { await startScreen.getByRole('button', {name: 'Close'}).click(); await settle(500); log('closed the start screen'); }
// Operation 7: the cameras and one gray image screen in the middle of the frame, nothing else.
{
    const scene = await refresh(), s = px.SCREEN_SCALE;
    const main = scene.entities.find(entity => entity.kind === 'camera');
    CAMERA = main.id;
    const reply = await patch([
        ...scene.entities.filter(entity => entity.kind !== 'camera').map(entity => ({kind: 'removeEntity', entityId: entity.id})),
        {kind: 'createEntity', entity: {...structuredClone(main), id: OTHER, name: 'Camera 2', transform: {...main.transform, position: [2, 1.2, 3]}}},
        {kind: 'createEntity', entity: {id: 'screen_gray', name: 'Screen', visible: true, transform: {position: [0, 1.2, 0], rotation: [0, 0, 0, 1], scale: [s, s, s]}, kind: 'screen', content: {kind: 'image', assetId: gray.id}}},
    ]);
    check('the scene of operation 7 is set', reply.ok, reply.ok ? null : reply.error);
}
await settle(1500);
await page.locator(`button[data-asset-id="${CAMERA}"]`).click();
await settle();
const sections = await page.evaluate(() => [...document.querySelectorAll('.inspector .section-heading')].map(node => node.textContent.trim()));
check('HC8: the Effects section comes directly after Grading (R25)', sections.indexOf('Effects') === sections.indexOf('Grading') + 1 && sections.includes('Effects'), sections);
const body = page.locator('#inspector-section-body-effects');
check('HC8: the Effects section is open (not inert)', await body.count() === 1 && await body.getAttribute('inert') === null, await body.getAttribute('inert'));
const groups = await body.locator('[role=group]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
check('HC8: each effect is a group with the effect name (R26)', JSON.stringify(groups) === JSON.stringify(['Lens Dirt', 'Vignetting', 'Night Vision', 'Blur', 'Pixelate']), groups);
const dirtSelect = body.getByRole('group', {name: 'Lens Dirt'}).locator('select');
const options = (await dirtSelect.locator('option').allTextContents()).map(text => text.trim());
check('HC8: Lens Dirt lists None first, then the images and Import file… (R27)', JSON.stringify(options) === JSON.stringify(['None', 'Gray', 'Import file…']), options);
// A checkbox shows the settings of its effect and writes the defaults with enabled: true (R26, R28).
const blur = body.getByRole('group', {name: 'Blur'});
const sliders = async group => (await group.locator('label').allTextContents()).map(text => text.trim()).filter(Boolean);
const before = await sliders(blur);
let mark = patches().length;
await blur.getByRole('checkbox', {name: 'Blur'}).check();
await settle(1000);
const afterOn = await sliders(blur);
check('HC8: the Blur checkbox shows Intensity and writes the defaults (R26, R28)', !before.some(t => t.startsWith('Intensity')) && afterOn.some(t => t.startsWith('Intensity')) && isDeepStrictEqual(patches().slice(mark), [{kind: 'setCameraEffects', entityId: CAMERA, effects: {blur: {enabled: true, intensity: 1}}}]), {before, afterOn, patches: patches().slice(mark)});
const resets = await blur.locator('.reset-mark').evaluateAll(nodes => nodes.map(node => node.getAttribute('title')));
check('HC8: the Blur reset mark has the effect name', JSON.stringify(resets) === JSON.stringify(['Reset Blur']), resets);
await pageShot(`inspector-effects${SUFFIX}.png`);
await blur.getByRole('checkbox', {name: 'Blur'}).uncheck();
await settle(1000);
// Import file… imports one image and sets it on this camera only (R27).
mark = patches().length;
await dirtSelect.selectOption({label: 'Import file…'});
await settle(2000);
const imported = await refresh();
check('HC8: Import file… sets the dirt image on this camera only (R27)', (await page.evaluate(() => window.__imports.length)) === 1 && isDeepStrictEqual(patches().slice(mark), [{kind: 'setCameraEffects', entityId: CAMERA, effects: {blur: {enabled: false, intensity: 1}, lensDirt: {assetId: dirt.id, intensity: 0.9, threshold: 0.5}}}]) && !('effects' in cameraOf(imported, OTHER)), {patches: patches().slice(mark), other: cameraOf(imported, OTHER).effects});
const shown = await sliders(body.getByRole('group', {name: 'Lens Dirt'}));
check('HC8: a dirt image shows Intensity and Threshold (R26)', shown.some(t => t.startsWith('Intensity')) && shown.some(t => t.startsWith('Threshold')), shown);

// The camera screenshot path: the preview renderer answers with straight alpha at 1920 x 1080.
async function screenshot(label, effects, file) {
    const reply = await patch([{kind: 'setCameraEffects', entityId: CAMERA, effects}]);
    if (!reply.ok) throw new Error(`${label}: ${JSON.stringify(reply.error)}`);
    await settle(2500);
    shot = null;
    preview?.send(JSON.stringify({kind: 'screenshotRequest', requestId: `shot_${label.replace(/\W+/g, '_')}`, params: {cameraId: CAMERA, expectedRevision: (await refresh()).revision}}));
    const asked = Date.now();
    while (!shot && Date.now() - asked < 30000) await settle(200);
    if (!shot?.ok) throw new Error(`${label}: ${JSON.stringify(shot?.error ?? 'no reply')}`);
    const image = PNG.sync.read(Buffer.from(shot.data.pngBase64, 'base64'));
    if (file) writeFileSync(join(out, file), px.half(PNG, image));
    log('SCREENSHOT', label, {width: image.width, height: image.height, previewBackend});
    return image;
}
try {
    const base = await screenshot('baseline', null, null);
    report(px.hc0(base).map(([name, pass, detail]) => [`HC8 screenshot: ${name}`, pass, detail]));
    report(px.hc1(base, await screenshot('vignetting alpha 1', {vignetting: {enabled: true, color: '#000000', alpha: 1, fadeOut: 0, blink: 0}}, `vignetting-screenshot${SUFFIX}.png`)).map(([name, pass, detail]) => [`HC8 screenshot: ${name}`, pass, detail]));
    report(px.hc1Blink(base, await screenshot('vignetting blink 1', {vignetting: {enabled: true, color: '#4c4c4c', alpha: 0.051, fadeOut: 0, blink: 1}}, `vignetting-blink-screenshot${SUFFIX}.png`)).map(([name, pass, detail]) => [`HC8 screenshot: ${name}`, pass, detail]));
    report(px.hc4(base, await screenshot('pixelate 64', {pixelate: {enabled: true, intensity: 64}}, `pixelate-screenshot${SUFFIX}.png`)).map(([name, pass, detail]) => [`HC8 screenshot: ${name}`, pass, detail]));
} catch (error) { check('HC8: the camera screenshots', false, String(error.message ?? error)); }
log('preview backend', previewBackend);
check('no page errors', errors.length === 0, errors);
clearInterval(clock);
await browser.close();
wss.close(); http.close();
const failed = results.filter(item => !item.pass);
log(`${results.length - failed.length}/${results.length} passed`);
writeFileSync(join(out, `editor-check${SUFFIX}.txt`), lines.join('\n') + '\n');
process.exit(failed.length ? 1 : 0);
