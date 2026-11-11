// Headless render check of Camera Orbit Character (B32 R2, contract operation 6).
// The built OBS page (apps/output/dist) runs the real renderer in Chromium on the software adapter (WebGL 2). A stand-in for
// the host serves the page and the fixture VRM, answers the renderer WebSocket, and sends the evaluated frames of a real
// @opensekai/session. A Blueprint runs Camera Orbit Character with Yaw 0, 90, 180, and 270; the check saves one frame for each.
// Run from the repository root after `pnpm build`:
//   pnpm exec tsx docs/evaluation/camera-orbit-selection/headless-check.mjs <output dir>
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {existsSync, readFileSync} from 'node:fs';
import {extname, join} from 'node:path';
const require = createRequire(process.cwd() + '/apps/desktop/package.json');
const {chromium} = require('playwright');
const {PNG} = createRequire(process.cwd() + '/package.json')('pngjs');
const root = pathToFileURL(process.cwd() + '/').href;
const {createSession} = await import(root + 'packages/session/src/index.ts');
const {makeSmokeScene} = await import(root + 'packages/contracts/src/index.ts');
const {chromiumGpuArgs} = await import(root + 'scripts/gpu-probe.ts');
const out = process.argv[2] ?? '.';
const log = (...a) => console.log(...a);
const results = [];
const check = (name, pass, detail) => { results.push({name, pass}); log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const FIXTURE = 'fixture_vrm0_arkit';
const manifestPath = join(process.cwd(), 'fixtures/local/manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {assets: []};
const paths = new Map(manifest.assets.filter(a => existsSync(a.path)).map(a => [a.record.id, a.path]));
if (!paths.has(FIXTURE)) { log('SKIPPED', FIXTURE, 'fixture file is not in fixtures/local'); process.exit(2); }

const PORT = 4176, ORIGIN = `http://127.0.0.1:${PORT}`, SESSION = 'session_check', W = 640, H = 360;
const dist = join(process.cwd(), 'apps/output/dist');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css'};
const server = createServer(async (req, res) => {
    try {
        const path = new URL(req.url, ORIGIN).pathname;
        const asset = /^\/assets\/([A-Za-z0-9_]+)$/.exec(path);
        if (asset && paths.has(asset[1])) { const body = await readFile(paths.get(asset[1])); res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': body.length}); res.end(body); return; }
        const body = await readFile(join(dist, path === '/' ? 'index.html' : path));
        res.writeHead(200, {'content-type': types[extname(path)] ?? (path === '/' ? 'text/html' : 'application/octet-stream')}); res.end(body);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const descriptor = {schemaVersion: 1, sessionId: SESSION, httpOrigin: ORIGIN + '/', wsUrl: `ws://127.0.0.1:${PORT}/ws`, role: 'renderer', token: 'token_renderer', capabilities: ['read'], outputId: 'output_main'};

// The smoke cameras and the fixture VRM at the origin. camera_wide orbits the character with the default pivot offset.
const scene = makeSmokeScene();
scene.entities = scene.entities.filter(entity => entity.kind === 'camera');
scene.entities.push({id: 'performer', name: 'performer', visible: true, transform: {position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1]}, kind: 'avatar', assetId: FIXTURE});
const session = createSession(scene, SESSION);
const placed = session.applyPatch({sceneId: scene.sceneId, expectedRevision: 0, operations: [{kind: 'setCameraNavigation', entityId: 'camera_wide', navigation: {mode: 'orbitCharacter', sensitivity: 1, targetId: 'performer', pivotOffset: [0, 1.3, 0]}}]});
check('camera_wide is in Orbit Character mode', placed.ok, placed);
const YAWS = [0, 90, 180, 270];
const at = {x: 0, y: 0};
const graphs = YAWS.map(yaw => ({schemaVersion: 1, id: `yaw_${yaw}`, name: `Yaw ${yaw}`, enabled: true, variables: [], nodes: [
    {id: 'go', version: 1, type: 'event.manual', settings: {}, position: at},
    {id: 'orbit', version: 1, type: 'camera.orbitCharacter', settings: {cameraId: 'camera_wide'}, position: at, inputs: {yaw, pitch: 10, distance: 2.2}},
], connections: [{id: 'a', sourceNodeId: 'go', sourcePort: 'flow', targetNodeId: 'orbit', targetPort: 'flow'}]}));
const loaded = session.editBlueprints({clientId: 'check', batchId: 'b', ops: [{kind: 'replaceAll', graphs}]});
check('the four orbit graphs load', loaded.ok, loaded.ok ? undefined : loaded.error);

let clock = 0, frame = session.advance(0), socket = null, sequence = 0, last = null, sending = true;
const timer = setInterval(() => {
    clock += 50; frame = session.advance(clock);
    if (socket && sending) { sequence++; socket.send(JSON.stringify({kind: 'frame', frame: {...frame, sequence}})); }
}, 50);
const browser = await chromium.launch({args: chromiumGpuArgs});
const context = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 1});
await context.routeWebSocket(descriptor.wsUrl, ws => {
    ws.onMessage(text => {
        const message = JSON.parse(String(text));
        if (message.kind === 'auth') { ws.send(JSON.stringify({kind: 'authReply', sessionId: SESSION, schemaVersion: 1, capabilities: ['read']})); socket = ws; return; }
        if (message.kind === 'applied') last = message.frame;
    });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(`${ORIGIN}/?quality=production_v1&backend=webgl2#${encodeURIComponent(JSON.stringify(descriptor))}`);
const begun = Date.now();
while (Date.now() - begun < 300000) {
    if (last && last.sequence > 2 && !last.warnings.some(w => (w.code === 'BUSY' || w.code === 'UNAVAILABLE') && w.ids.includes(FIXTURE))) break;
    await wait(200);
}
check(`${FIXTURE} loads on the OBS page`, !!last && !last.warnings.some(w => w.ids.includes(FIXTURE) && (w.code === 'BUSY' || w.code === 'UNAVAILABLE')), last?.warnings);
check('backend is webgl2', last?.backend === 'webgl2', last?.backend);

const images = [];
const record = [];
for (const yaw of YAWS) {
    const reply = session.runBlueprint(`yaw_${yaw}`, 'go');
    sending = true;
    const target = sequence + 5;
    while (!last || last.sequence < target) await wait(100);
    // Frames pause so that the software adapter is idle for the screenshot.
    sending = false;
    await wait(1000);
    const camera = frame.scene.entities.find(item => item.id === 'camera_wide').transform;
    const file = join(out, `orbit-yaw-${yaw}.png`);
    const image = PNG.sync.read(await page.screenshot({omitBackground: true, path: file, timeout: 20000}));
    // The output is transparent where nothing is drawn; the opaque pixels are the character.
    let opaque = 0, minX = W, maxX = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (image.data[(y * image.width + x) * 4 + 3] > 0) { opaque++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    const fraction = opaque / (image.width * image.height);
    images.push(image);
    record.push({yaw, run: reply.ok, cameraPosition: camera.position.map(v => Number(v.toFixed(3))), opaqueFraction: Number(fraction.toFixed(4)), opaqueColumns: [minX, maxX], file});
    check(`Yaw ${yaw}: the run succeeds and the camera is on the expected side`, reply.ok && (yaw === 0 ? camera.position[2] > 1.5 : yaw === 90 ? camera.position[0] > 1.5 : yaw === 180 ? camera.position[2] < -1.5 : camera.position[0] < -1.5), {reply, position: camera.position});
    check(`Yaw ${yaw}: the character shows in the frame`, fraction > 0.01 && minX > 0 && maxX < W - 1, {fraction, minX, maxX});
}
const differs = (a, b) => { let n = 0; for (let i = 3; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i - 3] !== b.data[i - 3]) n++; return n / (a.width * a.height); };
for (let i = 0; i < images.length; i++) for (let j = i + 1; j < images.length; j++) {
    const fraction = differs(images[i], images[j]);
    check(`frames at Yaw ${YAWS[i]} and Yaw ${YAWS[j]} differ`, fraction > 0.005, Number(fraction.toFixed(4)));
}
check('no page error', errors.length === 0, errors);
clearInterval(timer);
await browser.close(); server.close();
await writeFile(join(out, 'headless-check.json'), JSON.stringify({backend: last?.backend, fixture: FIXTURE, frames: record}, null, 1) + '\n');
const failed = results.filter(result => !result.pass).length;
log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
