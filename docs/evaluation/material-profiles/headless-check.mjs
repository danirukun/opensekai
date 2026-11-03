// Headless fixture check of the material profiles (MAT-01 slice 1, R7).
// The built OBS page (apps/output/dist) runs the real renderer in Chromium on the software adapter. A stand-in for the
// host serves the page and the fixture bytes, answers the renderer WebSocket, and sends frames of a real
// @opensekai/session at about 60 Hz. Each fixture loads alone, once with WebGPU and once with WebGL 2.
// Run from the repository root after `pnpm --filter @opensekai/output build`:
//   pnpm exec tsx docs/evaluation/material-profiles/headless-check.mjs <output dir>
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {readFile, rm, writeFile} from 'node:fs/promises';
import {existsSync, readFileSync} from 'node:fs';
import {extname, join} from 'node:path';
const require = createRequire(process.cwd() + '/apps/desktop/package.json');
const {chromium} = require('playwright');
const {PNG} = createRequire(process.cwd() + '/package.json')('pngjs');
const root = pathToFileURL(process.cwd() + '/').href;
const {createSession} = await import(root + 'packages/session/src/index.ts');
const {makeSmokeScene, materialReport} = await import(root + 'packages/contracts/src/index.ts');
const {chromiumGpuArgs} = await import(root + 'scripts/gpu-probe.ts');
const out = process.argv[2] ?? '.';
const log = (...a) => console.log(...a);
const results = [];
const check = (name, pass, detail) => { results.push({name, pass}); log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const FIXTURES = [
    {id: 'fixture_vrm_1', kind: 'avatar', expect: {mtoon: 13}},
    {id: 'fixture_vrm0_arkit', kind: 'avatar', expect: {mtoon: 16}},
    {id: 'fixture_glb_stage', kind: 'environment', expect: {pbr: 25}},
    {id: 'fixture_test_stage', kind: 'environment', expect: {pbr: 11, unlit: 1}},
];
const manifestPath = join(process.cwd(), 'fixtures/local/manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {assets: []};
const paths = new Map(manifest.assets.filter(a => existsSync(a.path)).map(a => [a.record.id, a.path]));

const PORT = 4175, ORIGIN = `http://127.0.0.1:${PORT}`, SESSION = 'session_check', W = 960, H = 540;
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
const browser = await chromium.launch({args: chromiumGpuArgs});
const record = [];

const counts = report => report.materials.reduce((acc, entry) => ({...acc, [entry.profile]: (acc[entry.profile] ?? 0) + 1}), {});
async function run(fixture, backend) {
    const label = `${fixture.id} ${backend}`;
    const scene = makeSmokeScene();
    scene.entities = scene.entities.filter(entity => entity.kind === 'camera');
    const transform = {position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1]};
    scene.entities.push(fixture.kind === 'avatar'
        ? {id: 'subject', name: 'subject', visible: true, transform, kind: 'avatar', assetId: fixture.id}
        : {id: 'subject', name: 'subject', visible: true, transform, kind: 'environment', assetId: fixture.id});
    const session = createSession(scene, SESSION);
    let socket = null, sequence = 0, sending = true, last = null, used = null;
    // Headless SwiftShader WebGPU stops drawing after about 390 frames (see the FPS counter check), so WebGPU gets 4 frames a second.
    const timer = setInterval(() => { if (socket && sending) { sequence++; socket.send(JSON.stringify({kind: 'frame', frame: {schemaVersion: 1, sessionId: SESSION, sequence, tick: sequence, elapsedMs: sequence * 16, scene: session.inspect()}})); } }, backend === 'webgl2' ? 16 : 250);
    const context = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 1});
    await context.routeWebSocket(descriptor.wsUrl, ws => {
        ws.onMessage(text => {
            const message = JSON.parse(String(text));
            if (message.kind === 'auth') { ws.send(JSON.stringify({kind: 'authReply', sessionId: SESSION, schemaVersion: 1, capabilities: ['read']})); socket = ws; return; }
            if (message.kind === 'applied') { last = message.frame; used = message.frame.backend; }
        });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    await page.goto(`${ORIGIN}/?quality=production_v1${backend === 'webgl2' ? '&backend=webgl2' : ''}#${encodeURIComponent(JSON.stringify(descriptor))}`);
    // The model is drawn when an applied frame has neither a BUSY nor an UNAVAILABLE warning for it.
    const start = Date.now();
    while (Date.now() - start < 120000) {
        if (last && !last.warnings.some(w => (w.code === 'BUSY' || w.code === 'UNAVAILABLE') && w.ids.includes(fixture.id)) && last.sequence > 2) break;
        await wait(200);
    }
    await wait(500);
    const warnings = last?.warnings ?? [];
    const failedLoad = !last || warnings.some(w => (w.code === 'BUSY' || w.code === 'UNAVAILABLE') && w.ids.includes(fixture.id));
    const material = warnings.filter(w => w.code === 'UNSUPPORTED' && w.message.startsWith('Unsupported material features'));
    const pipeline = warnings.filter(w => w.message === 'Pipeline compile failed');
    // The renderer runs the same report on the same bytes; this reads the counts for the record.
    const bytes = readFileSync(paths.get(fixture.id));
    const size = bytes.readUInt32LE(12);
    const profiles = counts(materialReport(JSON.parse(bytes.subarray(20, 20 + size).toString('utf8'))));
    // captureFrame has a 2 s handler limit that a full fixture on the software adapter misses, so the PNG is a page
    // screenshot without the page background. It is functional evidence only.
    const file = join(out, `${fixture.id}-${backend}.png`);
    // Frames pause so that the software adapter is idle for the screenshot.
    sending = false;
    await wait(1000);
    let png;
    try {
        const image = PNG.sync.read(await page.screenshot({omitBackground: true, path: file, timeout: 20000}));
        let clear = 0, same = true;
        for (let i = 0; i < image.data.length; i += 4) { if (image.data[i + 3] === 0) clear++; if (same && image.data.readUInt32LE(i) !== image.data.readUInt32LE(0)) same = false; }
        // A headless WebGPU canvas can read back as one flat color (see the light entities check): that is unknown, not a render.
        if (same) { await rm(file); png = 'unknown: the page screenshot is one flat color'; }
        else png = {file, transparentFraction: Number((clear / (image.width * image.height)).toFixed(3))};
    } catch (error) { png = 'unknown: ' + String(error.message).split('\n')[0]; }
    const entry = {fixture: fixture.id, backend: used ?? backend, profiles, materialWarnings: material.map(w => w.message), pipelineFailures: pipeline.length, otherWarnings: warnings.filter(w => !material.includes(w) && !pipeline.includes(w)).map(w => `${w.code} ${w.message}`), pageErrors: errors, png};
    record.push(entry);
    log(`# ${label}`, JSON.stringify(entry));
    check(`${label}: loads`, !failedLoad, warnings.filter(w => w.ids.includes(fixture.id)));
    check(`${label}: no pipeline compile failure`, pipeline.length === 0);
    check(`${label}: profile counts ${JSON.stringify(fixture.expect)}`, JSON.stringify(profiles) === JSON.stringify(fixture.expect), profiles);
    check(`${label}: no UNSUPPORTED material warning`, material.length === 0, material);
    clearInterval(timer);
    await context.close();
}
for (const fixture of FIXTURES.filter(f => !process.env.ONLY || f.id === process.env.ONLY)) {
    if (!paths.has(fixture.id)) { log('SKIPPED', fixture.id, 'fixture file is not in fixtures/local'); record.push({fixture: fixture.id, skipped: true}); continue; }
    for (const backend of (process.env.BACKENDS ?? 'auto,webgl2').split(',')) await run(fixture, backend);
}
await browser.close(); server.close();
await writeFile(join(out, 'headless-check.json'), JSON.stringify(record, null, 1) + '\n');
const failed = results.filter(result => !result.pass).length;
const skipped = record.filter(entry => entry.skipped).length;
log(`${results.length - failed} pass, ${failed} fail, ${skipped} fixtures skipped`);
process.exit(failed ? 1 : 0);
