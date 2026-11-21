// Headless shots of the editor search fields.
// The Editor window build runs in Chromium. A stand-in host serves the build, routes the WebSocket, and serves fixture_vrm_1.
// Run from the repository root after a desktop build:
//   pnpm exec tsx docs/evaluation/search-inputs/capture.mjs <dist dir> <output dir> <prefix> [check]
// `check` fails unless Escape clears a filled field and then blurs it.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(process.cwd() + '/apps/desktop/package.json');
const { chromium } = require('playwright');
const root = pathToFileURL(process.cwd() + '/').href;
const { chromiumGpuArgs } = await import(root + 'scripts/gpu-probe.ts');
const { meshEntries } = await import(root + 'packages/contracts/src/index.ts');

const dist = process.argv[2];
const out = process.argv[3] ?? '.';
const prefix = process.argv[4] ?? 'shot';
const checkKeys = process.argv[5] === 'check';
if (!dist) throw new Error('dist dir required');
await mkdir(out, { recursive: true });

const manifest = JSON.parse(await readFile('fixtures/local/manifest.json', 'utf8'));
const fixture = manifest.assets.find(asset => asset.record.id === 'fixture_vrm_1');
const bytes = await readFile(fixture.path);
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
const record = { ...fixture.record, expressions: fixture.record.expressions ?? [], meshes: meshEntries(json) };

const SESSION = 'session_search';
const PORT = 4191;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const { WebSocketServer } = createRequire(process.cwd() + '/apps/mcp/package.json')('ws');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const http = createServer(async (req, res) => {
  const path = new URL(req.url, ORIGIN).pathname;
  try {
    if (path === '/assets/fixture_vrm_1') {
      res.writeHead(200, { 'content-type': 'model/gltf-binary', 'content-length': bytes.length });
      res.end(bytes);
      return;
    }
    const body = await readFile(join(dist, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': mime[extname(path)] ?? (path === '/' ? 'text/html' : 'application/octet-stream') });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
const wss = new WebSocketServer({ server: http, path: '/ws' });
await new Promise(resolve => http.listen(PORT, '127.0.0.1', resolve));

const descriptor = (role, capabilities, outputId) => ({ schemaVersion: 1, sessionId: SESSION, httpOrigin: ORIGIN + '/', wsUrl: `ws://127.0.0.1:${PORT}/ws`, role, token: `token_${role}_${outputId ?? 'none'}`, capabilities, outputId });
const info = {
  publisher: descriptor('publisher', ['read', 'edit'], null),
  operator: descriptor('operator', ['read', 'edit'], null),
  preview: descriptor('renderer', ['read'], 'preview_main'),
  output: descriptor('renderer', ['read'], 'output_main'),
  operatorDescriptorFile: 'operator.json',
  rendererDescriptorFile: 'renderer.json',
  assets: [record],
  fixtureMode: true,
  rendererMode: 'auto',
};

const browser = await chromium.launch({ args: chromiumGpuArgs });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(info => {
  let next = 1;
  const callbacks = new Map();
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback(callback) { const id = next++; callbacks.set(id, callback); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
    convertFileSrc: path => path,
    async invoke(command) {
      if (command === 'bootstrap_session') return info;
      if (command === 'recent_show_list') return [];
      if (command === 'show_template_list') return [];
      if (command.startsWith('plugin:event|')) return next++;
      return null;
    },
  };
}, info);

let publisher = null;
let preview = null;
let nextCall = 1;
const pending = new Map();
const hostCall = async (method, params) => {
  for (let i = 0; !publisher && i < 200; i++) await new Promise(r => setTimeout(r, 50));
  if (!publisher) return { ok: false, error: { code: 'UNAVAILABLE', message: 'No publisher', ids: [] } };
  return new Promise(resolve => {
    const requestId = `host_${nextCall++}`;
    pending.set(requestId, resolve);
    publisher.send(JSON.stringify({ kind: 'call', requestId, method, params }));
  });
};
const begun = Date.now();
const clock = setInterval(() => publisher?.send(JSON.stringify({ kind: 'clock', sessionId: SESSION, elapsedMs: Date.now() - begun })), 16);
wss.on('connection', ws => {
  let role = null;
  ws.on('message', async data => {
    const message = JSON.parse(String(data));
    if (message.kind === 'auth') {
      role = message.role;
      if (role === 'publisher') publisher = ws;
      if (role === 'renderer' && message.outputId === 'preview_main') preview = ws;
      ws.send(JSON.stringify({ kind: 'authReply', sessionId: SESSION, schemaVersion: 1, capabilities: role === 'renderer' ? ['read'] : ['read', 'edit'] }));
      return;
    }
    if (message.kind === 'ping') { ws.send(JSON.stringify({ kind: 'pong', nonce: message.nonce })); return; }
    if (role === 'publisher' && message.kind === 'reply') { pending.get(message.requestId)?.(message.result); pending.delete(message.requestId); return; }
    if (role === 'publisher' && message.kind === 'frame') { preview?.send(String(data)); return; }
    if (role === 'operator' && message.kind === 'call') {
      const result = message.method === 'appStatus'
        ? { ok: true, data: { schemaVersion: 1, sessionId: SESSION, ready: true, revision: 0, capabilities: ['read', 'edit'], warnings: [], outputs: [] } }
        : await hostCall(message.method, message.params);
      ws.send(JSON.stringify({ kind: 'reply', requestId: message.requestId, result }));
    }
  });
});

const page = await context.newPage();
page.on('pageerror', error => console.log('pageerror', error.message));
page.on('console', message => { if (message.type() === 'error') console.log('console', message.text().slice(0, 400)); });
page.on('response', response => { if (response.status() >= 400) console.log('http', response.status(), response.url()); });

const shot = async (locator, name) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.evaluate(element => {
    const field = element.closest('.search-field, .asset-search') ?? element;
    const rect = field.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const pad = 16;
  await page.screenshot({
    path: join(out, `${prefix}-${name}.png`),
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: Math.min(1400, box.width + pad * 2),
      height: Math.max(56, box.height + pad * 2),
    },
  });
};

const metrics = locator => locator.evaluate(element => {
  const field = element.closest('.search-field, .asset-search') ?? element;
  const fieldStyle = getComputedStyle(field);
  const inputStyle = getComputedStyle(element);
  const rect = field.getBoundingClientRect();
  return {
    height: Math.round(rect.height * 10) / 10,
    radius: fieldStyle.borderRadius,
    border: fieldStyle.border,
    padding: fieldStyle.padding,
    background: fieldStyle.backgroundColor,
    fontSize: inputStyle.fontSize,
    color: inputStyle.color,
    placeholder: element.getAttribute('placeholder'),
    label: element.getAttribute('aria-label') ?? element.labels?.[0]?.textContent?.trim() ?? '',
    icon: !!(field.querySelector('svg')),
  };
});

await page.goto(ORIGIN + '/');
await page.locator('.session-mark[title="Session connected"]').waitFor({ timeout: 20000 });
const assets = page.getByRole('textbox', { name: 'Search assets' });
await assets.waitFor({ timeout: 10000 });
const report = {};
await shot(assets, 'assets');
await assets.focus();
await shot(assets, 'assets-focus');
report.assets = await metrics(assets);
if (checkKeys) {
  await assets.fill('camera');
  await assets.press('Escape');
  const cleared = await assets.inputValue();
  await assets.press('Escape');
  const blurred = await assets.evaluate(element => document.activeElement !== element);
  report.escape = { cleared, blurred };
  if (cleared !== '' || !blurred) throw new Error(`Escape did not clear then blur: ${JSON.stringify(report.escape)}`);
}

await page.getByTitle('Blueprints').click();
await page.locator('.blueprint-panel').waitFor({ timeout: 10000 });
const graph = { schemaVersion: 1, id: 'search', name: 'Search', enabled: true, variables: [], nodes: [], connections: [] };
const loaded = await hostCall('blueprintEdit', { clientId: 'check', batchId: 'search', ops: [{ kind: 'replaceAll', graphs: [graph] }] });
if (!loaded.ok) throw new Error(`graph: ${JSON.stringify(loaded.error)}`);
const nodes = page.locator('.blueprint-drawer').getByPlaceholder('Search nodes');
if (!(await nodes.isVisible())) await page.getByRole('button', { name: 'Nodes', exact: true }).click();
await nodes.waitFor({ timeout: 10000 });
await shot(nodes, 'nodes');
await nodes.focus();
await shot(nodes, 'nodes-focus');
report.nodes = await metrics(nodes);

await page.locator('.blueprint-canvas').click({ button: 'right', position: { x: 80, y: 80 } });
const menu = page.locator('.canvas-menu').getByPlaceholder('Search nodes');
await menu.waitFor({ timeout: 5000 });
await shot(menu, 'menu');
await menu.focus();
await shot(menu, 'menu-focus');
report.menu = await metrics(menu);
await page.keyboard.press('Escape');

await page.getByTitle('Assets').click();
await page.locator('button[data-asset-id="performer"]').click();
await page.locator('.section-heading', { hasText: 'Debug' }).click();
const properties = page.getByRole('textbox', { name: 'Search properties' });
try {
  await properties.waitFor({ timeout: 45000 });
  await shot(properties, 'properties');
  await properties.focus();
  await shot(properties, 'properties-focus');
  report.properties = await metrics(properties);
} catch (error) {
  report.properties = { error: String(error).slice(0, 300) };
  await page.screenshot({ path: join(out, `${prefix}-properties-missing.png`) });
  if (checkKeys) throw error;
}

await writeFile(join(out, `${prefix}-metrics.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
clearInterval(clock);
await browser.close();
wss.close();
http.close();
