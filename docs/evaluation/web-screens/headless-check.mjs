// Headless check of web page screens on the OBS page (B30 Operation 3.1 spike and 3.3).
// The built OBS page (apps/output/dist) runs the real renderer in Chromium on the software adapter. A stand-in for the
// host serves the page, answers the renderer WebSocket, and sends frames of a real @opensekai/session. Each test page
// comes from Playwright `page.route` on https://screen.test.invalid/; no test loads a page from the network.
// "canvas" probes hide the two page layers and read the drawn canvas alone; "page" probes read the composited page.
// Run from the repository root after `pnpm --filter @opensekai/output build`:
//   pnpm exec tsx docs/evaluation/web-screens/headless-check.mjs <output dir>
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {extname, join} from 'node:path';
import {readFile} from 'node:fs/promises';
const require = createRequire(process.cwd() + '/apps/desktop/package.json');
const {chromium} = require('playwright');
const {PNG} = createRequire(process.cwd() + '/package.json')('pngjs');
const root = pathToFileURL(process.cwd() + '/').href;
const {createSession} = await import(root + 'packages/session/src/index.ts');
const {makeSmokeScene} = await import(root + 'packages/contracts/src/index.ts');
const {chromiumGpuArgs} = await import(root + 'scripts/gpu-probe.ts');
const {Matrix4, PerspectiveCamera, Quaternion, Vector3} = await import(pathToFileURL(createRequire(process.cwd() + '/packages/renderer/package.json').resolve('three')).href);
const out = process.argv[2] ?? '.';
const log = (...a) => console.log(...a);
const results = [], record = [];
const check = (name, pass, detail) => { results.push({name, pass}); log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); };
const unknown = (name, reason) => { results.push({name, pass: true, unknown: true}); log('UNKNOWN', name, reason); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const PORT = 4179, ORIGIN = `http://127.0.0.1:${PORT}`, SESSION = 'session_check', TEST = 'https://screen.test.invalid';
const dist = join(process.cwd(), 'apps/output/dist');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css'};
// Each request for the host root or the OBS page that a frame makes is a barrier failure (R12).
const framed = [];
const server = createServer(async (req, res) => {
    try {
        const path = new URL(req.url, ORIGIN).pathname;
        if (req.headers['sec-fetch-dest'] === 'iframe') framed.push(path);
        const body = await readFile(join(dist, path === '/' ? 'index.html' : path));
        res.writeHead(200, {'content-type': types[extname(path)] ?? (path === '/' ? 'text/html' : 'application/octet-stream')}); res.end(body);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({args: [...chromiumGpuArgs, ...(process.env.EXTRA_ARGS ? process.env.EXTRA_ARGS.split(' ') : [])]});

// Test pages. Each fills its viewport unless it says otherwise.
const solid = color => `<!doctype html><html><head><style>html,body{margin:0;height:100%;background:${color}}</style></head><body></body></html>`;
const pages = {
    '/red': solid('#ff0000'),
    '/blue': solid('#0000ff'),
    '/yellow': solid('#ffff00'),
    // A transparent body with one red square in the center, 40 % of each side.
    '/square': `<!doctype html><html><head><style>html,body{margin:0;height:100%;background:transparent}div{position:absolute;left:30%;top:30%;width:40%;height:40%;background:#ff0000}</style></head><body><div></div></body></html>`,
    '/square-dark': `<!doctype html><html><head><meta name="color-scheme" content="dark"><style>:root{color-scheme:dark}html,body{margin:0;height:100%;background:transparent}div{position:absolute;left:30%;top:30%;width:40%;height:40%;background:#ff0000}</style></head><body><div></div></body></html>`,
    // Barrier pages: one navigates itself to the host origin, one reads the storage of the embedder.
    '/navigate': `<!doctype html><html><body style="margin:0;background:#00ff00"><script>setTimeout(()=>{location.href=${JSON.stringify(ORIGIN + '/')};},50)</script></body></html>`,
    '/storage': `<!doctype html><html><body style="margin:0;background:#00ff00"><script>let r='blocked';try{r=String(window.top.localStorage.length)}catch(e){r='blocked'}document.title=r</script></body></html>`,
};
async function routeTestPages(context) {
    await context.route(`${TEST}/**`, route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/redirect') return route.fulfill({status: 302, headers: {location: ORIGIN + '/'}});
        const body = pages[path];
        return body ? route.fulfill({status: 200, contentType: 'text/html', body}) : route.fulfill({status: 404, body: ''});
    });
}

const descriptor = {schemaVersion: 1, sessionId: SESSION, httpOrigin: ORIGIN + '/', wsUrl: `ws://127.0.0.1:${PORT}/ws`, role: 'renderer', token: 'token_renderer', capabilities: ['read'], outputId: 'output_main'};
const pose = (position, yawDeg = 0, pitchDeg = 0) => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawDeg * Math.PI / 180).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitchDeg * Math.PI / 180));
    return {position, rotation: q.toArray(), scale: [1, 1, 1]};
};
const web = (id, path, transform, {width = 1280, height = 720, onTop = false} = {}) => ({id, name: id, visible: true, transform, kind: 'screen', content: {kind: 'web', url: path === null ? null : TEST + path, width, height, onTop}});
const box = (id, position, scale) => ({id, name: id, visible: true, transform: {position, rotation: [0, 0, 0, 1], scale}, kind: 'mesh', source: {kind: 'box'}});
const haze = {id: 'haze', name: 'Haze', visible: true, transform: {position: [8, 0, -4], rotation: [0, 0, 0, 1], scale: [2, 2, 2]}, kind: 'haze', haze: {density: 1, smoke: 0.5, intensity: 1, drift: 0}};

// The output camera of the smoke scene is camera_wide (position [0, 1.2, 3], 45 degrees, looking along -Z).
const CAMERA = 'camera_wide';
// The projection of that camera for an output
// aspect, mapped to a CSS box of cssW x cssH (the canvas fills the page; R7 size match).
function projector(outW, outH, cssW, cssH, cameraTransform = {position: [0, 1.2, 3], rotation: [0, 0, 0, 1]}) {
    const camera = new PerspectiveCamera(45, outW / outH, 0.01, 100);
    camera.position.fromArray(cameraTransform.position); camera.quaternion.fromArray(cameraTransform.rotation); camera.updateMatrixWorld(true);
    return point => { const v = point.clone().project(camera); return [(v.x + 1) / 2 * cssW, (1 - v.y) / 2 * cssH]; };
}
// The 4 corners of a 1 m high quad of a given aspect, in page px, in the order top-left, top-right, bottom-right, bottom-left.
function quadCorners(transform, aspect, project) {
    const m = new Matrix4().compose(new Vector3().fromArray(transform.position), new Quaternion().fromArray(transform.rotation), new Vector3(1, 1, 1));
    return [[-0.5, 0.5], [0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]].map(([x, y]) => project(new Vector3(x * aspect, y, 0).applyMatrix4(m)));
}
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const centroid = corners => corners.reduce((s, c) => [s[0] + c[0] / 4, s[1] + c[1] / 4], [0, 0]);
// A point at least `px` inside (negative: outside) the quad edge, along the line from the centroid through `p`.
const inset = (corners, p, px) => { const c = centroid(corners), d = Math.hypot(p[0] - c[0], p[1] - c[1]); return lerp(p, c, px / d); };

async function open({label, entities, backend = 'webgl2', output = [1920, 1080], viewport = [960, 540], antiAliasing, cameraTransform}) {
    const scene = makeSmokeScene();
    scene.entities = scene.entities.filter(entity => entity.kind === 'camera').map(entity => entity.id === CAMERA ? {...entity, ...(antiAliasing ? {antiAliasing} : {}), ...(cameraTransform ? {transform: {...entity.transform, ...cameraTransform}} : {})} : entity);
    scene.outputs = scene.outputs.map(o => o.id === 'output_main' ? {...o, width: output[0], height: output[1]} : o);
    scene.entities.push(...entities);
    const session = createSession(scene, SESSION);
    let socket = null, sequence = 0, last = null, sending = true, captureId = 0;
    const captures = new Map();
    const send = () => { if (socket && sending) { sequence++; socket.send(JSON.stringify({kind: 'frame', frame: {schemaVersion: 1, sessionId: SESSION, sequence, tick: sequence, elapsedMs: sequence * 16, scene: session.inspect()}})); } };
    const timer = setInterval(send, backend === 'webgl2' ? 33 : 250);
    const context = await browser.newContext({viewport: {width: viewport[0], height: viewport[1]}, deviceScaleFactor: 1});
    await routeTestPages(context);
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
    await page.goto(`${ORIGIN}/?quality=production_v1${backend === 'webgl2' ? '&backend=webgl2' : ''}#${encodeURIComponent(JSON.stringify(descriptor))}`);
    const settle = async revision => {
        const start = Date.now();
        while (Date.now() - start < 30000 && !(last && last.sequence >= 3 && last.revision >= revision)) await wait(100);
        // The frames load; give them time to paint.
        await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(f => f.contentDocument === null || f.contentDocument.readyState === 'complete'), null, {timeout: 5000}).catch(() => {});
        await wait(800);
    };
    await settle(0);
    return {
        page, session, errors, get last() { return last; },
        async patch(operations) { const reply = session.applyPatch({sceneId: 'scene_smoke', expectedRevision: session.inspect().revision, operations}); if (!reply.ok) throw new Error(JSON.stringify(reply.error)); await settle(reply.data.revision); },
        // The canvas pixels that the renderer drew, through its own capture path (`captureRequest`); this works on both backends.
        async capture(name) {
            // No new frame arrives during the capture, so the capture is not queued behind frames.
            sending = false; await wait(1100);
            const requestId = `capture_${++captureId}`;
            const result = await new Promise(resolve => { captures.set(requestId, resolve); socket.send(JSON.stringify({kind: 'captureRequest', requestId, params: {outputId: 'output_main', expectedRevision: session.inspect().revision, preset: 'diagnostic_v1', maxAgeMs: 500}})); setTimeout(() => resolve({ok: false, error: {message: 'no reply'}}), 10000); });
            sending = true;
            // A capture that fails (for example over the 2 s handler limit on the software adapter) is not evidence.
            if (!result.ok) { log('NOTE', `${label}: capture failed`, JSON.stringify(result.error)); return {flat: true, reason: `capture failed: ${result.error?.message}`}; }
            const buffer = Buffer.from(result.data.pngBase64, 'base64');
            await writeFile(join(out, `${name.replace(/[^a-z0-9]+/gi, '-')}.png`), buffer);
            const image = PNG.sync.read(buffer);
            // A flat capture is not evidence: each probe on it is unknown.
            let flat = true;
            for (let i = 4; i < image.data.length && flat; i += 4) if (image.data.readUInt32LE(i) !== image.data.readUInt32LE(0)) flat = false;
            return {image, flat, sx: image.width / viewport[0], sy: image.height / viewport[1]};
        },
        async shot(kind, name) {
            // No new frame arrives while the page is captured.
            sending = false; await wait(300);
            if (kind === 'canvas') await page.evaluate(() => { for (const id of ['web-back', 'web-front']) document.getElementById(id).style.opacity = '0'; });
            const file = join(out, `${name.replace(/[^a-z0-9]+/gi, '-')}.png`);
            const buffer = await page.screenshot({omitBackground: true, path: file, timeout: 20000});
            if (kind === 'canvas') await page.evaluate(() => { for (const id of ['web-back', 'web-front']) document.getElementById(id).style.opacity = ''; });
            sending = true;
            const image = PNG.sync.read(buffer);
            // Headless Chromium does not put a WebGPU canvas in a page capture (B28 evidence), so those page pixels are unknown.
            if (backend === 'webgpu') return {image, flat: true, file};
            let flat = true;
            for (let i = 4; i < image.data.length && flat; i += 4) if (image.data.readUInt32LE(i) !== image.data.readUInt32LE(0)) flat = false;
            return {image, flat, file};
        },
        async close() { clearInterval(timer); record.push({label, backend: last?.backend, warnings: last?.warnings ?? [], pageErrors: errors}); await context.close(); },
        label, backend
    };
}
const pixel = (image, [x, y]) => { const xi = Math.floor(x), yi = Math.floor(y), i = (yi * image.width + xi) * 4; return Array.from(image.data.subarray(i, i + 4)); };
const near = (actual, expected, tolerance) => expected.every((value, i) => value === null || Math.abs(actual[i] - value) <= tolerance[i]);
function probe(run, shot, where, name, at, rgba, tolerance = [40, 40, 40, 2]) {
    if (shot.flat) { unknown(`${run.label} ${where}: ${name}`, shot.reason ?? (where === 'page' && run.backend === 'webgpu' ? 'headless WebGPU page capture' : 'the capture is one flat color')); return; }
    if (shot.sx) at = [at[0] * shot.sx, at[1] * shot.sy];
    const actual = pixel(shot.image, at);
    check(`${run.label} ${where}: ${name}`, near(actual, rgba, tolerance), {at: at.map(Math.round), actual, expected: rgba});
}
const RED = [255, 0, 0, 255], CLEAR = [0, 0, 0, 0], ANY_OPAQUE = [null, null, null, 255];
const backends = (process.env.BACKENDS ?? 'webgl2,webgpu').split(',');

// The premultiplied red value along a line, for the edge test.
const redAt = (image, p) => { const [r, , , a] = pixel(image, p); return r * a / 255; };
// Along each edge, at 5 points, the distance from the projected edge to the 50 % red crossing (Operation 3.1 alignment).
function edgeGaps(image, corners) {
    const gaps = [];
    for (let e = 0; e < 4; e++) {
        const a = corners[e], b = corners[(e + 1) % 4];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        const c = centroid(corners);
        let n = [-t[1], t[0]];
        if ((a[0] - c[0]) * n[0] + (a[1] - c[1]) * n[1] < 0) n = [-n[0], -n[1]];
        for (const s of [0.15, 0.3, 0.5, 0.7, 0.85]) {
            const p = lerp(a, b, s);
            const at = d => [p[0] + n[0] * d, p[1] + n[1] * d];
            const inside = redAt(image, at(-4)), outside = redAt(image, at(4)), mid = (inside + outside) / 2;
            let crossing = null;
            for (let d = -4; d < 4; d += 0.25) { const v0 = redAt(image, at(d)), v1 = redAt(image, at(d + 0.25)); if ((v0 - mid) * (v1 - mid) <= 0 && v0 !== v1) { crossing = d + 0.25 * (v0 - mid) / (v0 - v1); break; } }
            gaps.push(crossing === null ? null : Math.round(crossing * 100) / 100);
        }
    }
    return gaps;
}

for (const backend of backends) {
    // Operation 3.1 hole and alignment, for each case. The screen is 1280 x 720 (16:9), 1 m high, at [0, 1.2, 0].
    const cases = [
        {name: 'straight', transform: pose([0, 1.2, 0])},
        {name: 'yaw 30', transform: pose([0, 1.2, 0], 30)},
        {name: 'pitch 20', transform: pose([0, 1.2, 0], 0, 20)},
        {name: '16:9 output in a 4:3 box', transform: pose([0, 1.2, 0]), viewport: [800, 600]},
        {name: '960 x 540 output', transform: pose([0, 1.2, 0]), output: [960, 540]},
    ];
    for (const c of cases) {
        const output = c.output ?? [1920, 1080], viewport = c.viewport ?? [960, 540];
        const run = await open({label: `${c.name} ${backend}`, backend, output, viewport, entities: [box('wall', [0, 1.2, -1], [4, 3, 0.1]), web('page', '/red', c.transform)]});
        check(`${run.label}: backend ${backend}`, run.last?.backend === backend, run.last?.backend);
        check(`${run.label}: no frame warning`, (run.last?.warnings ?? []).length === 0, run.last?.warnings);
        const project = projector(output[0], output[1], viewport[0], viewport[1]);
        const corners = quadCorners(c.transform, 16 / 9, project);
        const canvas = await run.capture(`${c.name} canvas ${backend}`);
        for (const [i, corner] of corners.entries()) probe(run, canvas, 'canvas', `hole RGBA 0 inside corner ${i}`, inset(corners, corner, 3), CLEAR, [0, 0, 0, 0]);
        probe(run, canvas, 'canvas', 'hole RGBA 0 at the center', centroid(corners), CLEAR, [0, 0, 0, 0]);
        probe(run, canvas, 'canvas', 'wall outside the hole is opaque', inset(corners, corners[0], -12), ANY_OPAQUE);
        const composed = await run.shot('page', `${c.name} page ${backend}`);
        for (const [i, corner] of corners.entries()) probe(run, composed, 'page', `red inside corner ${i}`, inset(corners, corner, 3), RED);
        probe(run, composed, 'page', 'wall outside the page is not red', inset(corners, corners[0], -12), ANY_OPAQUE);
        if (!composed.flat) {
            const gaps = edgeGaps(composed.image, corners);
            const worst = gaps.reduce((m, g) => g === null ? Infinity : Math.max(m, Math.abs(g)), 0);
            check(`${run.label} page: each 50 % red crossing within 1 px of the projected edge (20 points)`, worst <= 1, {gaps, worst});
        } else unknown(`${run.label} page: edge alignment`, backend === 'webgpu' ? 'headless WebGPU page capture' : 'the capture is one flat color');
        check(`${run.label}: no page error`, run.errors.length === 0, run.errors);
        await run.close();
    }

    const center = pose([0, 1.2, 0]), proj = projector(1920, 1080, 960, 540), mid = proj(new Vector3(0, 1.2, 0));
    // 3.3: a box in front of an onTop false screen covers the page; a box behind does not show.
    {
        const run = await open({label: `occlusion ${backend}`, backend, entities: [box('front', [0, 1.2, 0.5], [0.3, 0.3, 0.3]), box('behind', [0.6, 1.2, -0.5], [0.3, 2, 0.3]), web('page', '/red', center)]});
        const composed = await run.shot('page', `occlusion page ${backend}`);
        probe(run, composed, 'page', 'the box in front covers the page (not red)', mid, [null, null, null, 255]);
        if (!composed.flat) { const [r, g, b] = pixel(composed.image, mid); check(`${run.label} page: the front box pixel is not page red`, !(r > 200 && g < 60 && b < 60), [r, g, b]); }
        probe(run, composed, 'page', 'the box behind does not show (red)', proj(new Vector3(0.6, 1.2, 0)), RED);
        await run.close();
    }
    // 3.3: onTop true draws the page over the box in front.
    {
        const run = await open({label: `on top ${backend}`, backend, entities: [box('front', [0, 1.2, 0.5], [0.3, 0.3, 0.3]), web('page', '/red', center, {onTop: true})]});
        const composed = await run.shot('page', `on top page ${backend}`);
        probe(run, composed, 'page', 'the page covers the box in front (red)', mid, RED);
        const canvas = await run.capture(`on top canvas ${backend}`);
        probe(run, canvas, 'canvas', 'the canvas still draws the box (no hole)', mid, ANY_OPAQUE);
        await run.close();
    }
    // 3.3: a transparent page body. Outside the red square, the page adds nothing.
    for (const path of ['/square', '/square-dark']) {
        const scheme = path === '/square' ? 'light' : 'dark';
        for (const onTop of [false, true]) {
            const run = await open({label: `transparent ${scheme} onTop ${onTop} ${backend}`, backend, entities: [web('page', path, center, {onTop})]});
            const composed = await run.shot('page', `transparent ${scheme} ${onTop} page ${backend}`);
            probe(run, composed, 'page', 'the square is red', mid, RED);
            const corners = quadCorners(center, 16 / 9, proj);
            const outsideSquare = lerp(corners[0], mid, 0.3);
            const actual = composed.flat ? null : pixel(composed.image, outsideSquare);
            if (scheme === 'light') probe(run, composed, 'page', 'outside the square has alpha 0', outsideSquare, [null, null, null, 0], [0, 0, 0, 2]);
            else log('RECORD', `${run.label} page: outside the square with color-scheme dark`, JSON.stringify(actual));
            record.push({label: `${run.label} outside square`, rgba: actual});
            await run.close();
        }
        // onTop true over a box behind: the box shows through outside the square.
        const run = await open({label: `transparent ${scheme} over a box ${backend}`, backend, entities: [box('wall', [0, 1.2, -1], [4, 3, 0.1]), web('page', path, center, {onTop: true})]});
        const composed = await run.shot('page', `transparent ${scheme} over a box page ${backend}`);
        const corners = quadCorners(center, 16 / 9, proj);
        const outsideSquare = lerp(corners[0], mid, 0.3);
        if (scheme === 'light') { probe(run, composed, 'page', 'the box shows outside the square', outsideSquare, ANY_OPAQUE); if (!composed.flat) { const [r, g, b] = pixel(composed.image, outsideSquare); check(`${run.label} page: the pixel outside the square is the box, not page red or white`, !(r > 200 && g < 60) && !(r > 240 && g > 240 && b > 240), [r, g, b]); } }
        else log('RECORD', `${run.label} page: outside the square with color-scheme dark`, JSON.stringify(composed.flat ? null : pixel(composed.image, outsideSquare)));
        probe(run, composed, 'page', 'the square is red', mid, RED);
        await run.close();
    }
    // 3.3: two overlapping onTop false screens; the nearer page shows in the overlap.
    {
        const run = await open({label: `two screens ${backend}`, backend, entities: [web('far', '/blue', pose([-0.3, 1.2, -0.5])), web('near', '/yellow', pose([0.3, 1.2, 0.2]))]});
        const composed = await run.shot('page', `two screens page ${backend}`);
        probe(run, composed, 'page', 'the overlap shows the nearer (yellow) page', proj(new Vector3(0.05, 1.2, 0.2)), [255, 255, 0, 255]);
        probe(run, composed, 'page', 'the far page shows outside the overlap (blue)', proj(new Vector3(-0.9, 1.2, -0.5)), [0, 0, 255, 255]);
        await run.close();
    }
    // 3.3: FXAA and a visible haze keep the hole at alpha 0.
    for (const [name, options, extra] of [['fxaa', {antiAliasing: 'fxaa'}, []], ['haze', {}, [haze]]]) {
        const run = await open({label: `${name} ${backend}`, backend, ...options, entities: [box('wall', [0, 1.2, -1], [4, 3, 0.1]), web('page', '/red', center), ...extra]});
        const corners = quadCorners(center, 16 / 9, proj);
        const canvas = await run.capture(`${name} canvas ${backend}`);
        for (const [i, corner] of corners.entries()) probe(run, canvas, 'canvas', `hole RGBA 0 inside corner ${i}`, inset(corners, corner, 3), CLEAR, [0, 0, 0, 0]);
        probe(run, canvas, 'canvas', 'wall outside is opaque', inset(corners, corners[0], -12), ANY_OPAQUE);
        check(`${run.label}: no frame warning`, (run.last?.warnings ?? []).length === 0, run.last?.warnings);
        await run.close();
    }
}

// Behavior checks that do not depend on the backend: WebGL 2 only.
{
    const center = pose([0, 1.2, 0]);
    // 3.3 frame barrier: a page that navigates to the host origin, a 302 to it, and a read of the embedder storage.
    const before = framed.length;
    const run = await open({label: 'frame barrier', entities: [web('nav', '/navigate', pose([-1, 1.2, 0])), web('redirect', '/redirect', pose([1, 1.2, 0])), web('storage', '/storage', pose([0, 2.4, 0]))]});
    await wait(1500);
    check('frame barrier: no frame request reached the host origin', framed.length === before, framed.slice(before));
    const frames = run.page.frames().filter(f => f !== run.page.mainFrame()).map(f => f.url());
    check('frame barrier: no frame is on the host origin', !frames.some(url => url.startsWith(ORIGIN)), frames);
    const storage = run.page.frames().find(f => f.url() === TEST + '/storage');
    check('frame barrier: the storage page cannot read the OBS page storage', (await storage?.title()) === 'blocked', await storage?.title());
    const attrs = await run.page.$$eval('iframe', list => list.map(f => ({sandbox: f.getAttribute('sandbox'), referrerpolicy: f.getAttribute('referrerpolicy'), allow: f.getAttribute('allow'), pointer: f.style.pointerEvents})));
    check('frame barrier: each iframe has the sandbox, the referrer policy, autoplay, and pointer events', attrs.length === 3 && attrs.every(a => a.sandbox === 'allow-scripts allow-same-origin allow-forms' && a.referrerpolicy === 'no-referrer' && a.allow === 'autoplay' && a.pointer === 'auto'), attrs);
    const canvasPointer = await run.page.$eval('#output', c => getComputedStyle(c).pointerEvents);
    check('OBS page: the canvas takes no pointer events', canvasPointer === 'none', canvasPointer);
    const csp = await run.page.$eval('meta[http-equiv="Content-Security-Policy"]', m => m.content);
    check('OBS page: the meta CSP is frame-src https: only', csp === 'frame-src https:', csp);
    await run.close();

    // R6: a URL change replaces the iframe; a size change keeps it; onTop moves it to the front layer; null removes it.
    const edit = await open({label: 'frame lifecycle', entities: [web('page', '/red', center)]});
    await edit.page.evaluate(() => { window.__first = document.querySelector('iframe'); });
    await edit.patch([{kind: 'setScreenWeb', entityId: 'page', web: {url: TEST + '/red', width: 640, height: 720, onTop: false}}]);
    const sized = await edit.page.evaluate(() => ({same: document.querySelector('iframe') === window.__first, width: document.querySelector('iframe').style.width}));
    check('frame lifecycle: a width change keeps the same iframe and sets its CSS width', sized.same && sized.width === '640px', sized);
    await edit.patch([{kind: 'setScreenWeb', entityId: 'page', web: {url: TEST + '/blue', width: 640, height: 720, onTop: false}}]);
    const replaced = await edit.page.evaluate(() => ({same: document.querySelector('iframe') === window.__first, src: document.querySelector('iframe').src, count: document.querySelectorAll('iframe').length}));
    check('frame lifecycle: a URL change replaces the iframe', !replaced.same && replaced.src === TEST + '/blue' && replaced.count === 1, replaced);
    await edit.patch([{kind: 'setScreenWeb', entityId: 'page', web: {url: TEST + '/blue', width: 640, height: 720, onTop: true}}]);
    const layer = await edit.page.evaluate(() => ({front: !!document.querySelector('#web-front iframe'), back: !!document.querySelector('#web-back iframe')}));
    check('frame lifecycle: onTop true moves the iframe to the front layer', layer.front && !layer.back, layer);
    await edit.patch([{kind: 'setVisibility', entityId: 'page', visible: false}]);
    const hidden = await edit.page.evaluate(() => ({visibility: document.querySelector('iframe')?.style.visibility, count: document.querySelectorAll('iframe').length}));
    check('frame lifecycle: a hidden screen keeps its iframe with visibility hidden', hidden.visibility === 'hidden' && hidden.count === 1, hidden);
    await edit.patch([{kind: 'setScreenWeb', entityId: 'page', web: {url: null, width: 640, height: 720, onTop: true}}]);
    const removed = await edit.page.evaluate(() => document.querySelectorAll('iframe').length);
    check('frame lifecycle: a null URL removes the iframe', removed === 0, removed);
    check('frame lifecycle: no page error', edit.errors.length === 0, edit.errors);
    await edit.close();

    // R7: a camera that moves through the screen plane hides the iframe and does not throw.
    const move = await open({label: 'camera through the screen', entities: [web('page', '/red', center)]});
    const states = [];
    for (const z of [3, 1, 0.3, 0.05, 0.005, -0.5, -2]) {
        await move.patch([{kind: 'setTransform', entityId: CAMERA, transform: {position: [0, 1.2, z], rotation: [0, 0, 0, 1], scale: [1, 1, 1]}}]);
        states.push([z, await move.page.evaluate(() => document.querySelector('iframe')?.style.visibility)]);
    }
    check('camera through the screen: the iframe shows in front, hides at the plane and behind the camera', JSON.stringify(states.map(s => s[1])) === JSON.stringify(['visible', 'visible', 'visible', 'visible', 'hidden', 'hidden', 'hidden']), states);
    check('camera through the screen: no page error and frames continue', move.errors.length === 0 && (move.last?.revision ?? 0) >= 7, {errors: move.errors, revision: move.last?.revision});
    await move.close();
}

await browser.close(); server.close();
await writeFile(join(out, 'headless-check.json'), JSON.stringify(record, null, 1) + '\n');
const failed = results.filter(result => !result.pass).length;
const unknowns = results.filter(result => result.unknown).length;
log(`${results.length - failed - unknowns} pass, ${failed} fail, ${unknowns} unknown`);
process.exit(failed ? 1 : 0);
