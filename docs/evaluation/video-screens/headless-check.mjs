// Headless check of video screens (B29 R12 to R17; Operation 5 steps 3 to 5).
// A Vite server runs headless-page.js, which makes one real renderer instance (packages/renderer) and applies a
// session-shaped frame stream with `screenPlayback` (the R11 clock, built by the page, not by packages/session). The
// stand-in host serves the Operation 1 test media from fixtures/video. The page capture of a WebGPU canvas is one flat
// color on the software adapter, so the pixel checks read the camera screenshot PNG (the R17 screenshot path) on both
// backends, and the page capture (the direct canvas path) on WebGL 2 only.
// Run from the repository root:
//   pnpm exec tsx docs/evaluation/video-screens/headless-check.mjs docs/evaluation/video-screens
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
const repo = process.cwd();
const require = createRequire(repo + '/apps/desktop/package.json');
const {chromium} = require('playwright');
const {PNG} = createRequire(repo + '/package.json')('pngjs');
const {createServer} = await import(pathToFileURL(createRequire(repo + '/package.json').resolve('vite')).href);
const {makeSmokeScene} = await import(pathToFileURL(repo + '/packages/contracts/src/index.ts').href);
const {chromiumGpuArgs, probeGpu} = await import(pathToFileURL(repo + '/scripts/gpu-probe.ts').href);
const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? here;
const log = (...a) => console.log(...a);
const results = [];
const record = [];
const check = (name, pass, detail) => { results.push({name, pass}); log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); return pass; };
const unknown = (name, reason) => { results.push({name, pass: true, unknown: true}); log('UNKNOWN', name, reason); };
const note = (name, detail) => log('NOTE', name, JSON.stringify(detail));
const wait = ms => new Promise(r => setTimeout(r, ms));

const MEDIA = {video_vp9opus: 'vp9-opus.webm', video_h264aac: 'h264-aac.mp4', video_hevc: 'hevc.mp4', video_alpha: 'vp9-alpha.webm'};
const PORT = 4179, ORIGIN = `http://127.0.0.1:${PORT}`;
const vite = await createServer({
    root: here, configFile: false, logLevel: 'error', clearScreen: false,
    server: {port: PORT, host: '127.0.0.1', strictPort: true, fs: {allow: [repo]}},
    optimizeDeps: {noDiscovery: true, include: []},
    plugins: [{name: 'media', configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
            const match = /^\/media\/([a-z0-9_]+)$/.exec(req.url ?? '');
            if (!match) return next();
            const name = MEDIA[match[1]];
            if (!name) { res.statusCode = 404; res.end(); return; }
            const body = await readFile(join(repo, 'fixtures/video', name));
            res.writeHead(200, {'content-type': name.endsWith('.mp4') ? 'video/mp4' : 'video/webm', 'x-content-type-options': 'nosniff', 'content-length': body.length});
            res.end(body);
        });
    }}],
});
await vite.listen();
const gpu = await probeGpu();
log('gpu', JSON.stringify(gpu));
// The OBS page runs with this flag, as OBS CEF does (Operation 5 step 3).
const obsArgs = [...chromiumGpuArgs, '--autoplay-policy=no-user-gesture-required'];
const browser = await chromium.launch({args: obsArgs});
// Headless Chromium without a flag let an unmuted element play in a first run, so the blocked case sets the policy of a
// desktop browser explicitly.
const plainBrowser = await chromium.launch({args: [...chromiumGpuArgs, '--autoplay-policy=document-user-activation-required']});

const W = 1920, H = 1080;
// camera_wide (the output camera) of the smoke scene: position [0, 1.2, 3], 45° vertical field of view, looking along -Z.
// A point on z = 0 maps to these pixels.
const project = (x, y, width = W, height = H) => {
    const half = 3 * Math.tan(22.5 * Math.PI / 180);
    return [Math.round((x / (half * width / height) + 1) / 2 * width), Math.round((1 - (y - 1.2) / half) / 2 * height)];
};
const ASPECT = 64 / 36;
const screen = (id, assetId, x, content = {}) => ({id, name: id, visible: true, transform: {position: [x, 1.2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1]}, kind: 'screen', content: {kind: 'video', assetId, autoPlay: false, loop: true, volume: 1, ...content}});
function makeScene(entities, {revision = 1, antiAliasing} = {}) {
    const scene = makeSmokeScene();
    scene.entities = scene.entities.filter(entity => entity.kind === 'camera').map(entity => entity.id === 'camera_wide' && antiAliasing ? {...entity, antiAliasing} : entity);
    scene.entities.push(...entities);
    scene.revision = revision;
    return scene;
}
const NOMINAL = {red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], white: [255, 255, 255]};
const nominalAt = (ms, loop = true, durationMs = 2000) => ['red', 'green', 'blue', 'white'][Math.min(3, Math.floor((loop ? ms % durationMs : Math.min(ms, durationMs - 17)) / 500))];
const nearest = rgb => Object.entries(NOMINAL).map(([name, value]) => [name, Math.max(...value.map((v, i) => Math.abs(v - rgb[i])))]).sort((a, b) => a[1] - b[1])[0][0];
const within = (actual, expected, tolerance) => expected.every((value, i) => Math.abs(actual[i] - value) <= tolerance);
const pixel = (image, [x, y]) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
// A small crop of a capture for the record.
async function keep(image, name, [cx, cy], size = [480, 270]) {
    const crop = new PNG({width: size[0], height: size[1]});
    const x0 = Math.max(0, Math.min(image.width - size[0], cx - size[0] / 2)), y0 = Math.max(0, Math.min(image.height - size[1], cy - size[1] / 2));
    PNG.bitblt(image, crop, x0, y0, size[0], size[1], 0, 0);
    const file = join(out, name + '.png');
    await writeFile(file, PNG.sync.write(crop));
    return name + '.png';
}

async function open(target, backend, audio) {
    const context = await target.newContext({viewport: {width: 960, height: 540}, deviceScaleFactor: 1});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    await page.goto(ORIGIN + '/headless-page.html');
    await page.waitForFunction(() => window.harness !== undefined, null, {timeout: 60000});
    await page.evaluate(options => window.harness.create(options), {backend, audio});
    const h = {
        page, errors,
        call: (name, ...args) => page.evaluate(([n, a]) => window.harness[n](...a), [name, args]),
        last: () => page.evaluate(() => window.harness.last()),
        async frames(count, timeoutMs = 30000) {
            const start = (await h.last()).applied?.sequence ?? 0;
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) { const now = (await h.last()).applied?.sequence ?? 0; if (now >= start + count) return true; await wait(20); }
            return false;
        },
        async loaded(ids, until = warnings => !warnings.some(w => (w.code === 'BUSY' || w.code === 'UNAVAILABLE') && ids.some(id => w.ids.includes(id))), timeoutMs = 60000) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const {applied} = await h.last();
                if (applied && applied.sequence >= 3 && until(applied.warnings)) return applied;
                await wait(100);
            }
            return (await h.last()).applied;
        },
        async shot() { return PNG.sync.read(Buffer.from(await h.call('screenshot'), 'base64')); },
        // The page capture can wait longer than 20 s while frames arrive, so the stream stops for it (the B28 harness does
        // the same). The entries are paused when this runs, so the drawn frame does not change.
        async capture() {
            await h.call('stop');
            await wait(300);
            try { return PNG.sync.read(await page.screenshot({omitBackground: true, timeout: 20000})); }
            finally { await h.call('start'); }
        },
        close: () => context.close(),
    };
    return h;
}
// Sets the session entry, lets the renderer apply it, and waits for the element (R14 videoSettled).
async function settle(h, entityId, playback) {
    await h.call('setPlayback', entityId, playback);
    await h.frames(3);
    const settled = await h.call('settled', entityId);
    await h.frames(2);
    return settled;
}

const POSITIONS = [250, 750, 1250, 1750];
async function playbackCase(backend, id) {
    const label = `${id} ${backend}`;
    const h = await open(browser, backend, true);
    const entry = {label, backend, asset: MEDIA[id], checks: []};
    try {
        const reference = await h.call('reference', id, [...POSITIONS, 1983]);
        entry.reference = reference;
        await h.call('setScene', makeScene([screen('tv', id, 0)]));
        await h.call('setPlayback', 'tv', {playing: false, offsetMs: 250});
        await h.call('start', backend === 'webgl2' ? 16 : 16);
        const applied = await h.loaded([id]);
        check(`${label}: loads without a warning`, applied?.warnings.length === 0, applied?.warnings);
        check(`${label}: backend ${backend}`, applied?.backend === backend, applied?.backend);
        entry.appliedBackend = applied?.backend;
        const center = project(0, 1.2);
        const colorCheck = (name, image, at, refRgb, expectedName) => {
            const actual = pixel(image, at);
            const pass = within(actual, refRgb, 24) && nearest(actual) === expectedName && actual[3] >= 253;
            entry.checks.push({name, actual, reference: refRgb, expected: expectedName, nominalDistance: Math.max(...NOMINAL[expectedName].map((v, i) => Math.abs(v - actual[i])))});
            return check(`${label}: ${name}`, pass, {at, actual, reference: refRgb, nominal: expectedName});
        };
        // Step 3: paused entries at 250, 750, 1250, and 1750 ms (the 1-frame seek limit applies).
        for (const [i, position] of POSITIONS.entries()) {
            const settled = await settle(h, 'tv', {playing: false, offsetMs: position});
            const image = await h.shot();
            colorCheck(`paused at ${position} ms is ${nominalAt(position)} (videoSettled: ${settled})`, image, center, reference[i].right.slice(0, 3), nominalAt(position));
            if (position === 1250) entry.screenshot = await keep(image, `${MEDIA[id].replace('.', '-')}-1250ms-${backend}`, center);
            if (backend === 'webgl2' && position === 1250) {
                const page = await h.capture();
                colorCheck('direct path (page capture) at 1250 ms is blue', page, project(0, 1.2, 960, 540), reference[i].right.slice(0, 3), 'blue');
            }
        }
        // Loop: 2250 ms wraps to 250 ms (red). Without loop it is the last frame (white).
        await settle(h, 'tv', {playing: false, offsetMs: 2250});
        colorCheck('loop true, 2250 ms is red', await h.shot(), center, reference[0].right.slice(0, 3), 'red');
        await h.call('setScene', makeScene([screen('tv', id, 0, {loop: false})], {revision: 2}));
        await settle(h, 'tv', {playing: false, offsetMs: 2250});
        colorCheck('loop false, 2250 ms is white', await h.shot(), center, reference[4].right.slice(0, 3), 'white');
        await settle(h, 'tv', {playing: true, offsetMs: 2250});
        colorCheck('loop false, a playing entry at 2250 ms stays white (the end)', await h.shot(), center, reference[4].right.slice(0, 3), 'white');
        await h.call('setScene', makeScene([screen('tv', id, 0)], {revision: 3}));
        // A paused entry keeps its color for 1 s of frames.
        await settle(h, 'tv', {playing: false, offsetMs: 1250});
        // The samples read the camera screenshot: a page capture while frames arrive can wait longer than 20 s here.
        const sample = async () => pixel(await h.shot(), center);
        // Samples at the start, then after at least 1 s and 60 applied frames, then once more.
        const held = [nearest(await sample())];
        for (let k = 0; k < 2; k++) { const start = Date.now(); await h.frames(60, 60000); await wait(Math.max(0, 1000 - (Date.now() - start))); held.push(nearest(await sample())); }
        check(`${label}: a paused entry keeps blue for 1 s of frames`, held.every(name => name === 'blue'), held);
        // A playing entry: each sample matches the session position at the sample time. The allowed lag is the 250 ms drift
        // limit plus one seek on the software decoder (350 ms); the paused checks above are the exact position checks.
        const LAG_MS = 600;
        // The element wraps at its own end; on the software decoder that restart can fall behind by more than 250 ms, and
        // then the renderer seeks and shows the last frame until the seek ends (analysis: slow seeks). A sample in the
        // first 600 ms after a loop point is recorded but not judged.
        const playingSamples = async (name) => {
            await settle(h, 'tv', {playing: true, offsetMs: 0});
            const seen = [];
            let ok = true;
            for (let k = 0; k < 6; k++) {
                const before = await h.call('position', 'tv');
                const actual = await sample();
                const after = await h.call('position', 'tv');
                const allowed = new Set();
                for (let ms = Math.max(0, before - LAG_MS); ms <= after + 50; ms += 10) allowed.add(nominalAt(ms));
                const got = nearest(actual);
                const transient = before >= 2000 && (before % 2000) < 600;
                seen.push({before, after, got, ...(transient ? {judged: false} : {})});
                if (!transient && !allowed.has(got)) ok = false;
                await wait(250);
            }
            const warnings = (await h.last()).applied?.warnings ?? [];
            check(`${label}: ${name}`, ok && new Set(seen.map(s => s.got)).size >= 2 && !warnings.some(w => w.message === 'Video playback blocked'), {seen, warnings});
        };
        await playingSamples('a playing entry follows the session position and moves');
        // R14: the preview pump stop pauses each element; the next frames seek and play them again.
        await h.call('pauseVideos');
        await h.frames(3);
        await playingSamples('after pauseVideos, the next frames play the video again');
        if (h.errors.length) note(`${label} page errors`, h.errors);
        entry.pageErrors = h.errors;
    } catch (error) {
        check(`${label}: runs`, false, String(error.message).split('\n')[0]);
    } finally {
        await h.call('stop').catch(() => {});
        await h.close();
        record.push(entry);
    }
}

async function hevcCase(backend) {
    const label = `hevc and vp9 ${backend}`;
    const h = await open(browser, backend, true);
    const entry = {label, backend};
    try {
        await h.call('setScene', makeScene([screen('bad', 'video_hevc', -1), screen('good', 'video_vp9opus', 1)]));
        await h.call('setPlayback', 'bad', {playing: false, offsetMs: 250});
        await h.call('setPlayback', 'good', {playing: false, offsetMs: 250});
        await h.call('start');
        const applied = await h.loaded(['video_hevc', 'video_vp9opus'], warnings => !warnings.some(w => w.code === 'BUSY') && warnings.some(w => w.ids.includes('video_hevc')));
        const warnings = applied?.warnings ?? [];
        entry.warnings = warnings; entry.appliedBackend = applied?.backend;
        check(`${label}: backend ${backend}`, applied?.backend === backend, applied?.backend);
        check(`${label}: HEVC gives the codec warning (R15)`, warnings.some(w => w.code === 'UNAVAILABLE' && w.message === 'Asset load failed: Video codec not supported: HEVC' && w.ids[0] === 'video_hevc'), warnings);
        check(`${label}: no other warning`, warnings.length === 1, warnings);
        await settle(h, 'good', {playing: false, offsetMs: 250});
        const image = await h.shot();
        const good = pixel(image, project(1, 1.2)), bad = pixel(image, project(-1, 1.2));
        check(`${label}: the VP9 screen draws red`, nearest(good) === 'red' && good[3] >= 253, {at: project(1, 1.2), actual: good});
        check(`${label}: the HEVC screen draws nothing (alpha 0)`, bad[3] <= 2, {at: project(-1, 1.2), actual: bad});
        entry.screenshot = await keep(image, `hevc-failure-${backend}`, project(0, 1.2), [960, 270]);
    } catch (error) {
        check(`${label}: runs`, false, String(error.message).split('\n')[0]);
    } finally {
        await h.call('stop').catch(() => {});
        await h.close();
        record.push(entry);
    }
}

async function alphaCase(backend, antiAliasing) {
    const label = `vp9 alpha ${antiAliasing ?? 'direct'} ${backend}`;
    const h = await open(browser, backend, true);
    const entry = {label, backend, checks: []};
    try {
        const reference = await h.call('reference', 'video_alpha', [250]);
        entry.reference = reference;
        await h.call('setScene', makeScene([screen('alpha', 'video_alpha', 0)], {antiAliasing}));
        await h.call('setPlayback', 'alpha', {playing: false, offsetMs: 250});
        await h.call('start');
        const applied = await h.loaded(['video_alpha']);
        check(`${label}: loads without a warning`, applied?.warnings.length === 0, applied?.warnings);
        check(`${label}: backend ${backend}`, applied?.backend === backend, applied?.backend);
        entry.appliedBackend = applied?.backend;
        await settle(h, 'alpha', {playing: false, offsetMs: 250});
        const probe = (where, image, width, height) => {
            const left = pixel(image, project(-ASPECT / 4, 1.2, width, height)), right = pixel(image, project(ASPECT / 4, 1.2, width, height)), outside = pixel(image, project(0, 2.0, width, height));
            entry.checks.push({where, left, right, outside});
            check(`${label} ${where}: left half has alpha 0 (within 2/255)`, left[3] <= 2, left);
            check(`${label} ${where}: right half has alpha 255 (within 2/255) and is red`, right[3] >= 253 && within(right.slice(0, 3), reference[0].right.slice(0, 3), 24), {right, reference: reference[0].right});
            check(`${label} ${where}: outside the quad has alpha 0`, outside[3] <= 2, outside);
        };
        const shot = await h.shot();
        probe('screenshot PNG', shot, W, H);
        entry.screenshot = await keep(shot, `vp9-alpha-${antiAliasing ?? 'direct'}-screenshot-${backend}`, project(0, 1.2));
        if (backend === 'webgl2') {
            const page = await h.capture();
            probe('page capture', page, 960, 540);
            entry.page = await keep(page, `vp9-alpha-${antiAliasing ?? 'direct'}-page-${backend}`, project(0, 1.2, 960, 540));
        } else unknown(`${label} page capture`, 'the WebGPU page capture on the software adapter is one flat color');
    } catch (error) {
        check(`${label}: runs`, false, String(error.message).split('\n')[0]);
    } finally {
        await h.call('stop').catch(() => {});
        await h.close();
        record.push(entry);
    }
}

// R14 and R16: a rejected play() gives `Video playback blocked`. Only the OBS-page instance (audio) plays sound, so only
// it needs the autoplay flag; a muted preview instance plays without it.
async function autoplayCase(target, flag, audio) {
    const label = `autoplay ${flag ? 'no-user-gesture-required' : 'document-user-activation-required'}, audio ${audio ? 'on (OBS page)' : 'off (preview)'} webgl2`;
    const h = await open(target, 'webgl2', audio);
    const entry = {label, backend: 'webgl2'};
    try {
        await h.call('setScene', makeScene([screen('tv', 'video_vp9opus', 0)]));
        await h.call('setPlayback', 'tv', {playing: true, offsetMs: 0});
        await h.call('start');
        await h.loaded(['video_vp9opus']);
        await h.frames(30);
        const warnings = (await h.last()).applied?.warnings ?? [];
        const blocked = warnings.some(w => w.message === 'Video playback blocked' && w.ids[0] === 'video_vp9opus');
        entry.warnings = warnings;
        if (!flag && audio) {
            // Playwright runs page.evaluate with a user gesture, so the page has user activation and play() is not blocked
            // here. The blocked path has a unit test.
            if (blocked) check(`${label}: play() is blocked and the frame has the warning`, blocked, warnings);
            else unknown(`${label}: play() blocked`, 'the harness gives the page user activation (page.evaluate), so the policy does not block; warnings ' + JSON.stringify(warnings));
        } else check(`${label}: plays without a warning`, warnings.length === 0, warnings);
    } catch (error) {
        check(`${label}: runs`, false, String(error.message).split('\n')[0]);
    } finally {
        await h.call('stop').catch(() => {});
        await h.close();
        record.push(entry);
    }
}

const backends = (process.env.BACKENDS ?? 'webgl2,webgpu').split(',');
for (const backend of backends) {
    await playbackCase(backend, 'video_vp9opus');
    await playbackCase(backend, 'video_h264aac');
    await hevcCase(backend);
    await alphaCase(backend);
    await alphaCase(backend, 'fxaa');
}
await autoplayCase(browser, true, true);
await autoplayCase(plainBrowser, false, true);
await autoplayCase(plainBrowser, false, false);
await browser.close(); await plainBrowser.close(); await vite.close();
await writeFile(join(out, 'headless-check.json'), JSON.stringify({browser: chromium.name(), gpu, cases: record}, null, 1) + '\n');
const failed = results.filter(result => !result.pass).length;
const unknowns = results.filter(result => result.unknown).length;
log(`${results.length - failed - unknowns} pass, ${failed} fail, ${unknowns} unknown`);
process.exit(failed ? 1 : 0);
