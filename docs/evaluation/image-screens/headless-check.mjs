// Headless check of image screens (B28 R11, R12, R15; Operation 4).
// The built OBS page (apps/output/dist) runs the real renderer in Chromium on the software adapter. A stand-in for the
// host serves the page and generated test images, answers the renderer WebSocket, and sends frames of a real
// @opensekai/session. The OBS page has no screenshot listener; editor-check.mjs checks the camera screenshot path. The script makes each test image; no test image file is committed.
// Run from the repository root after `pnpm --filter @opensekai/output build`:
//   pnpm exec tsx docs/evaluation/image-screens/headless-check.mjs <output dir>
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {rm, writeFile} from 'node:fs/promises';
import {extname, join} from 'node:path';
import {readFile} from 'node:fs/promises';
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
const unknown = (name, reason) => { results.push({name, pass: true, unknown: true}); log('UNKNOWN', name, reason); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// The test image, 64 x 32: x < 32 opaque (rows y < 8 blue, the others red); 44 <= x < 56 green with alpha 128;
// the other columns are fully transparent.
const HALF = 128;
function testPng() {
    const png = new PNG({width: 64, height: 32});
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        const pixel = x < 32 ? (y < 8 ? [0, 0, 255, 255] : [255, 0, 0, 255]) : x >= 44 && x < 56 ? [0, 255, 0, HALF] : [0, 0, 0, 0];
        png.data.set(pixel, i);
    }
    return PNG.sync.write(png);
}
// A JPEG with EXIF orientation 6: the stored image is 64 x 32 with blue columns x < 16. Displayed, it is 32 x 64 with
// a blue top quarter. Chromium encodes the JPEG; the script inserts the APP1 segment after SOI.
function withOrientation(jpeg, orientation) {
    const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
    return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

const PORT = 4177, ORIGIN = `http://127.0.0.1:${PORT}`, SESSION = 'session_check', W = 960, H = 540;
const dist = join(process.cwd(), 'apps/output/dist');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css'};
const images = new Map();
const server = createServer(async (req, res) => {
    try {
        const path = new URL(req.url, ORIGIN).pathname;
        const asset = /^\/assets\/([A-Za-z0-9_]+)$/.exec(path);
        if (asset && images.has(asset[1])) { const {body, type} = images.get(asset[1]); res.writeHead(200, {'content-type': type, 'x-content-type-options': 'nosniff', 'content-length': body.length}); res.end(body); return; }
        const body = await readFile(join(dist, path === '/' ? 'index.html' : path));
        res.writeHead(200, {'content-type': types[extname(path)] ?? (path === '/' ? 'text/html' : 'application/octet-stream')}); res.end(body);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({args: chromiumGpuArgs});

// Chromium encodes the JPEG and the WebP from a canvas.
{
    const page = await browser.newPage();
    const encoded = await page.evaluate(async () => {
        const canvas = new OffscreenCanvas(64, 32), c = canvas.getContext('2d');
        c.fillStyle = '#ff0000'; c.fillRect(0, 0, 64, 32); c.fillStyle = '#0000ff'; c.fillRect(0, 0, 16, 32);
        const jpeg = new Uint8Array(await (await canvas.convertToBlob({type: 'image/jpeg', quality: 1})).arrayBuffer());
        const alpha = new OffscreenCanvas(64, 32), a = alpha.getContext('2d');
        a.fillStyle = '#ff0000'; a.fillRect(0, 0, 32, 32); a.fillStyle = '#0000ff'; a.fillRect(0, 0, 32, 8);
        const webp = new Uint8Array(await (await alpha.convertToBlob({type: 'image/webp', quality: 1})).arrayBuffer());
        return {jpeg: [...jpeg], webp: [...webp]};
    });
    await page.close();
    images.set('image_png', {body: testPng(), type: 'image/png'});
    images.set('image_jpeg6', {body: withOrientation(Buffer.from(encoded.jpeg), 6), type: 'image/jpeg'});
    images.set('image_webp', {body: Buffer.from(encoded.webp), type: 'image/webp'});
}

const descriptor = {schemaVersion: 1, sessionId: SESSION, httpOrigin: ORIGIN + '/', wsUrl: `ws://127.0.0.1:${PORT}/ws`, role: 'renderer', token: 'token_renderer', capabilities: ['read'], outputId: 'output_main'};
const transform = (position, rotation = [0, 0, 0, 1]) => ({position, rotation, scale: [1, 1, 1]});
const screen = (id, assetId, position, rotation) => ({id, name: id, visible: true, transform: transform(position, rotation), kind: 'screen', content: {kind: 'image', assetId}});
const haze = {id: 'haze', name: 'Haze', visible: true, transform: {position: [8, 0, -4], rotation: [0, 0, 0, 1], scale: [2, 2, 2]}, kind: 'haze', haze: {density: 1, smoke: 0.5, intensity: 1, drift: 0}};
const record = [];

// The camera is camera_main of the smoke scene: position [0, 1.2, 3], 40° vertical field of view, looking along -Z.
// A point at depth 3 on the plane z = 0 maps to these page pixels.
const project = (x, y) => {
    const half = 3 * Math.tan(20 * Math.PI / 180);
    return [Math.round((x / (half * W / H) + 1) / 2 * W), Math.round((1 - (y - 1.2) / half) / 2 * H)];
};
// A point of a 2 m by 1 m quad at [0, 1.2, 0], from image coordinates u (left to right) and v (top to bottom).
const onQuad = (u, v, width = 2) => project(-width / 2 + width * u, 1.7 - v);

async function run(label, entities, {backend, antiAliasing}, probes) {
    const scene = makeSmokeScene();
    scene.entities = scene.entities.filter(entity => entity.kind === 'camera').map(entity => entity.id === 'camera_main' && antiAliasing ? {...entity, antiAliasing} : entity);
    scene.entities.push(...entities);
    const session = createSession(scene, SESSION);
    let socket = null, sequence = 0, sending = true, last = null;
    const timer = setInterval(() => { if (socket && sending) { sequence++; socket.send(JSON.stringify({kind: 'frame', frame: {schemaVersion: 1, sessionId: SESSION, sequence, tick: sequence, elapsedMs: sequence * 16, scene: session.inspect()}})); } }, backend === 'webgl2' ? 16 : 250);
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
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    await page.goto(`${ORIGIN}/?quality=production_v1${backend === 'webgl2' ? '&backend=webgl2' : ''}#${encodeURIComponent(JSON.stringify(descriptor))}`);
    const start = Date.now();
    const ids = entities.filter(e => e.kind === 'screen').map(e => e.content.assetId);
    const pending = () => !last || last.sequence < 3 || last.warnings.some(w => (w.code === 'BUSY' || w.code === 'UNAVAILABLE') && ids.some(id => w.ids.includes(id)));
    while (Date.now() - start < 60000 && pending()) await wait(200);
    await wait(500);
    const warnings = last?.warnings ?? [];
    check(`${label}: loads without a warning`, !pending() && warnings.length === 0, warnings);
    check(`${label}: backend ${backend}`, last?.backend === backend, last?.backend);
    sending = false;
    await wait(1000);
    const entry = {label, backend: last?.backend, warnings, pageErrors: errors};
    const file = join(out, `${label.replace(/[^a-z0-9]+/gi, '-')}.png`);
    let page_ = null;
    try {
        const image = PNG.sync.read(await page.screenshot({omitBackground: true, path: file, timeout: 20000}));
        let same = true;
        for (let i = 4; i < image.data.length && same; i += 4) if (image.data.readUInt32LE(i) !== image.data.readUInt32LE(0)) same = false;
        page_ = same ? null : image;
        entry.page = same ? 'unknown: one flat color' : file;
        // A flat capture is not evidence, so the file is not kept.
        if (same) await rm(file);
    } catch (error) { entry.page = 'unknown: ' + String(error.message).split('\n')[0]; }
    const pixel = (image, [x, y]) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
    const near = (actual, expected, tolerance) => expected.every((value, i) => value === null || Math.abs(actual[i] - value) <= tolerance[i]);
    const verify = (where, image, scale) => {
        for (const probe of probes) {
            const at = probe.at.map(v => Math.round(v * scale));
            const actual = pixel(image, at);
            check(`${label} ${where}: ${probe.name}`, near(actual, probe.rgba, probe.tolerance ?? [40, 40, 40, 2]), {at, actual, expected: probe.rgba});
        }
    };
    if (page_) verify('page', page_, 1); else unknown(`${label} page pixels`, entry.page);
    record.push(entry);
    clearInterval(timer);
    await context.close();
}

const flat = [255, 0, 0, 255], tol = [40, 40, 40, 2];
const pngProbes = [
    {name: 'opaque part is opaque red', at: onQuad(0.25, 0.6), rgba: flat},
    {name: 'top rows are blue (upright)', at: onQuad(0.25, 0.1), rgba: [0, 0, 255, 255]},
    {name: 'transparent part has alpha 0', at: onQuad(0.59, 0.5), rgba: [null, null, null, 0], tolerance: tol},
    {name: 'half-alpha strip keeps alpha 128', at: onQuad(0.78, 0.5), rgba: [0, 255, 0, HALF], tolerance: tol},
    {name: 'transparent edge column has alpha 0', at: onQuad(0.94, 0.5), rgba: [null, null, null, 0], tolerance: tol},
    {name: 'outside the quad has alpha 0', at: project(0, 2.0), rgba: [null, null, null, 0], tolerance: tol},
];
// Seen from the front camera, the back face shows the image mirrored: the opaque half is on the right.
const backProbes = [
    {name: 'back: opaque half is on the right', at: onQuad(0.75, 0.6), rgba: flat},
    {name: 'back: left half is transparent', at: onQuad(0.41, 0.5), rgba: [null, null, null, 0], tolerance: tol},
];
// The orientation-6 JPEG: the quad is 0.5 m wide and 1 m high, blue at the top.
const jpegProbes = [
    {name: 'orientation 6: top is blue', at: project(0, 1.62), rgba: [0, 0, 255, 255], tolerance: [60, 60, 60, 2]},
    {name: 'orientation 6: bottom is red', at: project(0, 0.8), rgba: [255, 0, 0, 255], tolerance: [60, 60, 60, 2]},
    {name: 'orientation 6: 0.5 m wide (alpha 0 at x = 0.4 m)', at: project(0.4, 1.2), rgba: [null, null, null, 0], tolerance: tol},
    {name: 'orientation 6: 0.5 m wide (opaque at x = 0.2 m)', at: project(0.2, 1.2), rgba: [null, null, null, 255], tolerance: tol},
];
const webpProbes = [
    {name: 'WebP opaque part is red', at: onQuad(0.25, 0.6), rgba: flat, tolerance: [60, 60, 60, 2]},
    {name: 'WebP top rows are blue', at: onQuad(0.25, 0.1), rgba: [0, 0, 255, 255], tolerance: [60, 60, 60, 2]},
    {name: 'WebP transparent half has alpha 0', at: onQuad(0.75, 0.5), rgba: [null, null, null, 0], tolerance: tol},
];
const backends = (process.env.BACKENDS ?? 'webgl2,webgpu').split(',');
for (const backend of backends) {
    await run(`png direct ${backend}`, [screen('logo', 'image_png', [0, 1.2, 0])], {backend}, pngProbes);
    await run(`png fxaa ${backend}`, [screen('logo', 'image_png', [0, 1.2, 0])], {backend, antiAliasing: 'fxaa'}, pngProbes);
    await run(`png haze ${backend}`, [screen('logo', 'image_png', [0, 1.2, 0]), haze], {backend}, pngProbes);
    await run(`png back ${backend}`, [screen('logo', 'image_png', [0, 1.2, 0], [0, 1, 0, 0])], {backend}, backProbes);
    await run(`jpeg orientation 6 ${backend}`, [screen('photo', 'image_jpeg6', [0, 1.2, 0])], {backend}, jpegProbes);
    await run(`webp ${backend}`, [screen('web', 'image_webp', [0, 1.2, 0])], {backend}, webpProbes);
}
await browser.close(); server.close();
await writeFile(join(out, 'headless-check.json'), JSON.stringify(record, null, 1) + '\n');
const failed = results.filter(result => !result.pass).length;
const unknowns = results.filter(result => result.unknown).length;
log(`${results.length - failed - unknowns} pass, ${failed} fail, ${unknowns} unknown`);
process.exit(failed ? 1 : 0);
