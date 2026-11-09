// Operation 5 step 1 (spike): does a three.js VideoTexture draw upright, with the right colors and alpha, on WebGL 2 and
// WebGPU in headless Chromium on the software adapter? `bitmap` is the fallback upload (one ImageBitmap of the element
// for each new frame). Run from the repository root:
//   pnpm exec tsx docs/evaluation/video-screens/spike-check.mjs > docs/evaluation/video-screens/spike-check.txt
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, extname, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const repo = process.cwd();
const {chromium} = createRequire(repo + '/apps/desktop/package.json')('playwright');
const {chromiumGpuArgs} = await import(pathToFileURL(repo + '/scripts/gpu-probe.ts').href);
const here = dirname(fileURLToPath(import.meta.url));
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = path.startsWith('/three/') ? join(repo, 'packages/renderer/node_modules/three/build', path.slice(7)) : path.startsWith('/video/') ? join(repo, 'fixtures/video', path.slice(7)) : join(here, 'spike.html');
  try { const body = await readFile(file); res.writeHead(200, {'content-type': {'.js': 'text/javascript', '.mp4': 'video/mp4', '.webm': 'video/webm'}[extname(file)] ?? 'text/html'}); res.end(body); } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(4188, '127.0.0.1', r));
const browser = await chromium.launch({args: [...chromiumGpuArgs, '--autoplay-policy=no-user-gesture-required']});
const srgb = c => Math.round(255 * (c / 255 <= 0.0031308 ? 12.92 * c / 255 : 1.055 * Math.pow(c / 255, 1 / 2.4) - 0.055));
const toSrgb = p => [...p.slice(0, 3).map(srgb), p[3]];
const near = (a, b, t) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);
const NOMINAL = {250: [255, 0, 0], 750: [0, 255, 0], 1250: [0, 0, 255], 1750: [255, 255, 255]};
const cases = [...[250, 750, 1250, 1750].map(t => ['/video/vp9-opus.webm', t]), ['/video/h264-aac.mp4', 1250], ['/video/vp9-alpha.webm', 250], ['upright', null]];
let failed = 0;
const verdict = (name, pass, detail) => { if (!pass) failed++; console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail)); };
for (const mode of ['video', 'bitmap']) for (const backend of ['webgl2', 'webgpu']) {
  const go = [];
  for (const [src, time] of cases) {
    const page = await browser.newPage();
    const console_ = []; page.on('console', m => { if (m.type() === 'error') console_.push(m.text().split('\n')[0].slice(0, 160)); });
    await page.goto('http://127.0.0.1:4188/');
    await page.waitForFunction(() => window.ready);
    const label = `${mode} ${backend} ${src.split('/').pop()}${time === null ? '' : ' ' + time + ' ms'}`;
    try {
      const r = await page.evaluate(([s, b, t, m]) => window.spike(s, b, t, m), [src, backend, time, mode]);
      const s = Object.fromEntries(Object.entries(r.linear).map(([k, v]) => [k, toSrgb(v)]));
      const detail = {backend: r.backend, drawn: s, reference: r.reference, pausedCallback: r.pausedCallback, errors: [...r.errors, ...console_].slice(0, 2)};
      let pass;
      if (src === 'upright') pass = near(s.topLeft, [0, 255, 0], 24) && near(s.topRight, [0, 0, 255], 24) && near(s.right, [255, 0, 0], 24);
      else if (src.includes('alpha')) pass = s.left[3] <= 2 && s.right[3] >= 253 && near(s.right, r.reference.right, 24);
      else pass = near(s.right, r.reference.right, 24) && s.right[3] >= 253;
      if (NOMINAL[time] && !src.includes('alpha')) detail.nominalDistance = Math.max(...NOMINAL[time].map((v, i) => Math.abs(v - s.right[i])));
      verdict(label, pass, detail);
      go.push(pass);
    } catch (error) { verdict(label, false, String(error.message).split('\n')[0]); go.push(false); }
    await page.close();
  }
  console.log('RESULT', mode, backend, go.every(Boolean) ? 'go' : 'no-go');
}
await browser.close(); server.close();
process.exit(0);
