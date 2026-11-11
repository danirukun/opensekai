// Headless check of capture screens (B31 R14 to R16; Operation 4.1 and 4.3).
// A Vite server runs headless-page.js, which makes one real renderer instance (packages/renderer) with a capture host.
// Operation 4.1 (spike): the page feeds fixtures/capture/h264-main to the renderer stream and decodes it with the
// browser's own VideoDecoder onto a 2D canvas as the color reference. Operation 4.3: a stub /capture server (the `ws`
// package, the same binary message as the host) sends the fixture to the real browser-client socket.
// The pixel checks read the camera screenshot PNG (the R14 cameraScreenshot path) on both backends.
// Run from the repository root:
//   pnpm exec tsx docs/evaluation/capture-screens/headless-check.mjs [webgl2|webgpu|both]
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
const repo = process.cwd();
const require = createRequire(repo + '/apps/desktop/package.json');
const {chromium} = require('playwright');
const {PNG} = createRequire(repo + '/package.json')('pngjs');
const {WebSocketServer} = createRequire(repo + '/apps/mcp/package.json')('ws');
const {createServer} = await import(pathToFileURL(createRequire(repo + '/package.json').resolve('vite')).href);
const {makeSmokeScene} = await import(pathToFileURL(repo + '/packages/contracts/src/index.ts').href);
const {encodeCaptureChunk} = await import(pathToFileURL(repo + '/packages/browser-client/src/capture.ts').href);
const {chromiumGpuArgs, probeGpu} = await import(pathToFileURL(repo + '/scripts/gpu-probe.ts').href);
const here = dirname(fileURLToPath(import.meta.url));
const backends = process.argv[2] === 'webgl2' || process.argv[2] === 'webgpu' ? [process.argv[2]] : ['webgl2', 'webgpu'];
const log = (...a) => console.log(...a);
const results = [];
const check = (name, pass, detail) => { results.push({name, pass}); log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); return pass; };
const unknown = (name, reason) => { results.push({name, pass: true, unknown: true}); log('UNKNOWN', name, reason); };
const note = (name, detail) => log('NOTE', name, JSON.stringify(detail));
const wait = ms => new Promise(r => setTimeout(r, ms));

const FIXTURES = {
    'h264-main.json': join(repo, 'fixtures/capture/h264-main.json'), 'h264-main.bin': join(repo, 'fixtures/capture/h264-main.bin'),
    'square.json': join(here, 'square.json'), 'square.bin': join(here, 'square.bin'),
};
const load = async name => { const index = JSON.parse(await readFile(FIXTURES[name + '.json'], 'utf8')); const blob = await readFile(FIXTURES[name + '.bin']); return {index, chunks: index.chunks.map(c => ({key: c.key, timestampUs: c.timestampUs, data: blob.subarray(c.offset, c.offset + c.length)}))}; };
const main = await load('h264-main'), square = await load('square');

const PORT = 4181, WS_PORT = 4182, ORIGIN = `http://127.0.0.1:${PORT}`;
const vite = await createServer({
    root: here, configFile: false, logLevel: 'error', clearScreen: false,
    server: {port: PORT, host: '127.0.0.1', strictPort: true, fs: {allow: [repo]}},
    optimizeDeps: {noDiscovery: true, include: []},
    plugins: [{name: 'fixture', configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
            const match = /^\/fixture\/([a-z0-9.-]+)$/.exec(req.url ?? '');
            if (!match || !FIXTURES[match[1]]) return next();
            const body = await readFile(FIXTURES[match[1]]);
            res.writeHead(200, {'content-type': match[1].endsWith('.json') ? 'application/json' : 'application/octet-stream', 'content-length': body.length});
            res.end(body);
        });
    }}],
});
await vite.listen();

// The stub /capture route: captureAuth first, then captureConfig, then one binary message for each chunk. The first hex
// digit of the stream ID picks the case: 1 slow loop (200 ms a frame), 2 loop (33 ms), 3 a size change on the test's command,
// e a chunk that the decoder cannot decode.
const connections = [];
// The test sets this after it measures the first size; the stub then switches at the next loop start.
let resizeNow = false;
const configText = fixture => JSON.stringify({kind: 'captureConfig', codec: fixture.index.codec, description: fixture.index.description, codedWidth: fixture.index.codedWidth, codedHeight: fixture.index.codedHeight});
const wss = new WebSocketServer({port: WS_PORT, host: '127.0.0.1', path: '/capture'});
wss.on('connection', (socket, request) => {
    const record = {url: request.url, auth: null, streamId: null, openedAt: Date.now(), closedAt: null, sent: 0, firstKey: null};
    connections.push(record);
    let timer = null;
    socket.on('close', () => { record.closedAt = Date.now(); clearInterval(timer); });
    socket.once('message', (data, binary) => {
        const auth = binary ? null : JSON.parse(String(data));
        record.auth = auth;
        if (auth?.kind !== 'captureAuth' || auth.token !== 'renderer-token' || auth.outputId !== 'output_main') { socket.close(4401); return; }
        record.streamId = auth.streamId;
        const kind = auth.streamId[0];
        let fixture = main, index = 0, loop = 0, base = 0, switched = false;
        const send = chunk => { if (record.firstKey === null) record.firstKey = chunk.key; record.sent++; socket.send(encodeCaptureChunk(chunk)); };
        socket.send(configText(main));
        timer = setInterval(() => {
            if (socket.readyState !== 1) return;
            if (kind === 'e') { send({key: true, timestampUs: ++index * 33_333, data: new Uint8Array([0, 0, 0, 4, 0x65, 0xff, 0x13, 0x37])}); return; }
            if (kind === '3' && !switched && resizeNow && index === 0) { switched = true; fixture = square; base += 3_000_000; socket.send(configText(square)); }
            const chunk = fixture.chunks[index];
            send({key: chunk.key, timestampUs: base + loop * 2_000_000 + chunk.timestampUs, data: chunk.data});
            index++;
            if (index === fixture.chunks.length) { index = 0; loop++; }
        }, kind === '1' ? 200 : 33);
    });
});

const gpu = await probeGpu();
log('gpu', JSON.stringify(gpu));
const browser = await chromium.launch({args: chromiumGpuArgs});

const W = 1920, H = 1080;
// camera_wide of the smoke scene: position [0, 1.2, 3], 45° vertical field of view, looking along -Z. A point on z = 0 maps to these pixels.
const project = (x, y) => { const half = 3 * Math.tan(22.5 * Math.PI / 180); return [Math.round((x / (half * W / H) + 1) / 2 * W), Math.round((1 - (y - 1.2) / half) / 2 * H)]; };
const capture = (id, x = 0, visible = true) => ({id, name: id, visible, transform: {position: [x, 1.2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1]}, kind: 'screen', content: {kind: 'capture', target: 'display', source: {kind: 'display', name: 'Fixture display', ordinal: 0}, cursor: true}});
function makeScene(entities, revision) {
    const scene = makeSmokeScene();
    scene.entities = scene.entities.filter(entity => entity.kind === 'camera');
    scene.entities.push(...entities);
    scene.revision = revision;
    return scene;
}
const NOMINAL = {red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], white: [255, 255, 255]};
const nearest = rgb => Object.entries(NOMINAL).map(([name, value]) => [name, Math.max(...value.map((v, i) => Math.abs(v - rgb[i])))]).sort((a, b) => a[1] - b[1])[0][0];
const within = (actual, expected, tolerance) => expected.every((value, i) => Math.abs(actual[i] - value) <= tolerance);
const pixel = (image, [x, y]) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
// The opaque run through a point, along the row and the column: the drawn quad size in pixels.
const extent = (image, [x, y]) => {
    const opaque = (px, py) => image.data[(py * image.width + px) * 4 + 3] > 128;
    let l = x, r = x, t = y, b = y;
    while (l > 0 && opaque(l - 1, y)) l--; while (r < image.width - 1 && opaque(r + 1, y)) r++;
    while (t > 0 && opaque(x, t - 1)) t--; while (b < image.height - 1 && opaque(x, b + 1)) b++;
    return {width: r - l + 1, height: b - t + 1};
};
async function keep(image, name, [cx, cy], size = [480, 270]) {
    const crop = new PNG({width: size[0], height: size[1]});
    const x0 = Math.max(0, Math.min(image.width - size[0], cx - size[0] / 2)), y0 = Math.max(0, Math.min(image.height - size[1], cy - size[1] / 2));
    PNG.bitblt(image, crop, x0, y0, size[0], size[1], 0, 0);
    await writeFile(join(here, name + '.png'), PNG.sync.write(crop));
}
async function open(backend, mode) {
    const context = await browser.newContext({viewport: {width: 960, height: 540}, deviceScaleFactor: 1});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    await page.goto(ORIGIN + '/headless-page.html');
    await page.waitForFunction(() => window.harness !== undefined, null, {timeout: 60000});
    await page.evaluate(options => window.harness.create(options), {backend, mode, wsPort: WS_PORT});
    const h = {
        page, errors,
        call: (name, ...args) => page.evaluate(([n, a]) => window.harness[n](...a), [name, args]),
        last: () => page.evaluate(() => window.harness.last()),
        async frames(count, timeoutMs = 30000) {
            const start = (await h.last()).applied?.sequence ?? 0;
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) { if (((await h.last()).applied?.sequence ?? 0) >= start + count) return true; await wait(20); }
            return false;
        },
        async shot() { return PNG.sync.read(Buffer.from(await h.call('screenshot'), 'base64')); },
        close: () => context.close(),
    };
    return h;
}
const streams = {slow: '1'.repeat(32), loop: '2'.repeat(32), resize: '3'.repeat(32), error: 'e'.repeat(32)};
const entry = (entityId, streamId, state = 'live', width = 320, height = 180) => ({entityId, streamId, state, width, height});
const center = project(0, 1.2);
const COLORS = ['red', 'green', 'blue', 'white'];
const FRAMES = [7, 22, 37, 52];

async function spike(backend) {
    const label = `spike ${backend}`;
    const h = await open(backend, 'spike');
    try {
        const decoder = await h.call('decoder');
        note(`${label}: VideoDecoder probe (avc1.4d0029 1920 x 1080)`, decoder);
        const reference = await h.call('reference', FRAMES);
        note(`${label}: 2D canvas reference (decoded frames, center pixels)`, reference);
        if (reference.error) { unknown(`${label}: decode and draw the fixture`, reference.error); return; }
        await h.call('setScene', makeScene([capture('desk')], 1));
        await h.call('setStatus', [entry('desk', streams.slow)]);
        await h.call('start');
        await h.frames(3);
        await h.call('spikeConfig');
        await wait(200);
        for (const [i, frame] of FRAMES.entries()) {
            await h.call('spikeShow', frame, i);
            await h.frames(4);
            await wait(150);
            const image = await h.shot();
            const actual = pixel(image, center);
            const ref = reference.pixels[i].slice(0, 3);
            check(`${label}: frame ${frame} is ${COLORS[i]} (screenshot center within 24 of the 2D canvas draw)`, within(actual, ref, 24) && nearest(actual) === COLORS[i] && actual[3] >= 253, {actual, reference: ref, applied: (await h.last()).applied?.backend});
            if (i === 2) await keep(image, `spike-blue-${backend}`, center);
        }
        check(`${label}: no page error`, h.errors.length === 0, h.errors);
    } finally { await h.call('dispose'); await h.close(); }
}

async function socketCase(backend) {
    const label = `socket ${backend}`;
    const h = await open(backend, 'socket');
    const count = id => connections.filter(c => c.streamId === id).length;
    const openCount = id => connections.filter(c => c.streamId === id && c.closedAt === null).length;
    try {
        connections.length = 0;
        const decoderSupport = await h.call('decoder');
        if (decoderSupport !== 'supported') { unknown(`${label}: socket checks`, `VideoDecoder ${decoderSupport}`); return; }
        // No capture screen: no socket, no status use.
        await h.call('setScene', makeScene([], 1));
        await h.call('start');
        await h.frames(30);
        check(`${label}: a scene without a capture screen opens no socket`, connections.length === 0 && (await h.call('sockets')).length === 0 && (await h.last()).applied?.warnings.length === 0, {connections: connections.length});
        const diagnostics = await h.call('diagnostics');
        check(`${label}: renderer diagnostics report videoDecoder`, diagnostics?.videoDecoder === 'supported', diagnostics?.videoDecoder);

        // Four colors in order (200 ms a frame, so 3 s for each color). A software 1080p screenshot takes up to about 1 s of
        // the page main thread, so the samples are 1.2 s apart: back-to-back screenshots starve the decoder output.
        // The frame pump runs each 100 ms here: a software 1080p WebGPU draw each 16 ms leaves the main thread no time for
        // the decoder output callbacks.
        await h.call('start', 100);
        await h.call('setScene', makeScene([capture('desk')], 2));
        await h.call('setStatus', [entry('desk', streams.slow)]);
        await h.frames(5);
        const seen = [], samples = [], started = Date.now();
        const until = Date.now() + 26000;
        while (Date.now() < until) {
            const rgb = pixel(await h.shot(), center);
            samples.push(Date.now() - started);
            if (rgb[3] > 250) { const name = nearest(rgb); if (seen[seen.length - 1] !== name) seen.push(name); }
            await wait(300);
        }
        // Four changes in a row are the four colors, each one after the one before it. The first draw of the screen compiles
        // its shader, which on llvmpipe can block the page for about 2 s; the R14 gate then drops to the next key frame, so
        // the first loop can skip a color. A slow screenshot can also skip one. So the check needs one forward run of four.
        const step = (a, b) => COLORS.indexOf(b) === (COLORS.indexOf(a) + 1) % 4;
        const forward = seen.some((_, i) => i + 3 < seen.length && step(seen[i], seen[i + 1]) && step(seen[i + 1], seen[i + 2]) && step(seen[i + 2], seen[i + 3]));
        check(`${label}: the screen shows the four colors in order`, forward, {seen, sampleMs: samples});
        await h.call('start');
        const slow = connections.find(c => c.streamId === streams.slow);
        check(`${label}: captureAuth is the first message and the URL has no token`, slow?.auth?.kind === 'captureAuth' && slow.url === '/capture', {url: slow?.url, auth: slow?.auth && {...slow.auth, token: '(redacted)'}});

        // Two screens on one stream share one socket.
        await h.call('setScene', makeScene([capture('left', -0.95), capture('right', 0.95)], 3));
        await h.call('setStatus', [entry('left', streams.loop), entry('right', streams.loop)]);
        await h.frames(30); await wait(500);
        let image = await h.shot();
        const [l, r] = [pixel(image, project(-0.95, 1.2)), pixel(image, project(0.95, 1.2))];
        check(`${label}: two screens on one stream use one socket and both draw`, count(streams.loop) === 1 && (await h.call('sockets')).length === 1 && l[3] > 250 && r[3] > 250, {connections: count(streams.loop), sockets: await h.call('sockets'), left: l, right: r});
        check(`${label}: the slow stream socket closed when no screen uses it`, openCount(streams.slow) === 0, {open: openCount(streams.slow)});
        await keep(image, `two-screens-${backend}`, center, [960, 270]);

        // Paused draws nothing and keeps the socket; hidden closes the socket.
        await h.call('setStatus', [entry('left', streams.loop, 'paused'), entry('right', streams.loop)]);
        await h.frames(5); await wait(100);
        image = await h.shot();
        const warnings = (await h.last()).applied?.warnings ?? [];
        check(`${label}: a paused screen draws nothing and warns Source hidden`, pixel(image, project(-0.95, 1.2))[3] === 0 && pixel(image, project(0.95, 1.2))[3] > 250 && warnings.some(w => w.message === 'Capture: Source hidden' && w.ids[0] === 'left'), {left: pixel(image, project(-0.95, 1.2)), warnings});
        check(`${label}: the paused screen keeps the socket`, openCount(streams.loop) === 1, {open: openCount(streams.loop)});
        await h.call('setScene', makeScene([capture('left', -0.95, false), capture('right', 0.95, false)], 4));
        await h.frames(5); await wait(300);
        check(`${label}: hidden screens close the socket`, openCount(streams.loop) === 0 && (await h.call('sockets')).length === 0, {open: openCount(streams.loop)});

        // A second captureConfig with a new size changes the quad aspect.
        await h.call('setScene', makeScene([capture('desk')], 5));
        await h.call('setStatus', [entry('desk', streams.resize)]);
        await h.frames(10); await wait(500);
        const before = extent(await h.shot(), center);
        resizeNow = true;
        await wait(3500);
        await h.frames(5);
        const after = extent(await h.shot(), center);
        const ratio = size => size.width / size.height;
        check(`${label}: a second captureConfig with a new size changes the quad aspect (16:9 to 1:1)`, Math.abs(ratio(before) - 16 / 9) < 0.03 && Math.abs(ratio(after) - 1) < 0.03, {before, after});
        const resize = connections.find(c => c.streamId === streams.resize);
        check(`${label}: the stream starts with a key frame`, resize?.firstKey === true, resize?.firstKey);

        // A decoder error: a retry after 1 s, 3 times, then Capture failed.
        await h.call('setScene', makeScene([capture('desk')], 6));
        await h.call('setStatus', [entry('desk', streams.error)]);
        const errorUntil = Date.now() + 9000;
        let failed = null;
        while (Date.now() < errorUntil && !failed) {
            const w = (await h.last()).applied?.warnings ?? [];
            failed = w.find(item => item.message === 'Capture: Capture failed') ?? null;
            await wait(100);
        }
        await wait(1500);
        const errors = connections.filter(c => c.streamId === streams.error);
        const gaps = errors.slice(1).map((c, i) => c.openedAt - errors[i].closedAt);
        check(`${label}: a decoder error retries 3 times after 1 s, then Capture failed`, failed !== null && errors.length === 4 && gaps.every(gap => gap >= 950), {connections: errors.length, gaps, warning: failed});
        check(`${label}: no page error`, h.errors.length === 0, h.errors);
    } finally { await h.call('dispose'); await h.close(); }
}

try {
    for (const backend of backends) { await spike(backend); await socketCase(backend); }
} finally {
    await browser.close(); wss.close(); await vite.close();
}
const failed = results.filter(r => !r.pass);
log(`SUMMARY ${results.length - failed.length}/${results.length} pass, ${results.filter(r => r.unknown).length} unknown`);
process.exit(failed.length ? 1 : 0);
