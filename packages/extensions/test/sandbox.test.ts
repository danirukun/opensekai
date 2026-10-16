import { afterEach, describe, expect, it } from 'vitest';
import { createSandbox, type FailureCause, type LogEntry, type Sandbox } from '../src';

const manifest = (id: string, capabilities: string[] = ['nodes', 'log', 'assetTypes']) =>
 ({ manifestVersion: 1, id, name: 'Test', version: '1.0.0', apiVersion: 1, capabilities });

const ADD = `opensekai.registerNode({ type: 'add', label: 'Add', inputs: { a: 'number', b: 'number' }, outputs: { sum: 'number' },
 evaluate: ({ a, b }) => ({ sum: a + b }) });`;
const node = (body: string, outputs = `{ value: 'number' }`) =>
 `opensekai.registerNode({ type: 'n', label: 'N', inputs: {}, outputs: ${outputs}, evaluate: () => { ${body} } });`;

const HOG = `const keep = []; for (;;) keep.push({ n: keep.length });`;
let sandbox: Sandbox;
const failures: [string, FailureCause][] = [];
const logs: LogEntry[] = [];
const open = async (limits = {}) => {
 failures.length = 0; logs.length = 0;
 sandbox = await createSandbox({ limits, onFailure: (id, cause) => failures.push([id, cause]), onLog: entry => logs.push(entry) });
 return sandbox;
};
afterEach(() => sandbox?.dispose());

describe('extension sandbox', () => {
 it('loads a guest node, namespaces it, and evaluates it with copied data', async () => {
  await open();
  expect(await sandbox.load(manifest('dev.test.math'), ADD)).toEqual({ ok: true, status: { id: 'dev.test.math', state: 'ready' } });
  expect(sandbox.catalog().nodes).toEqual([{ extensionId: 'dev.test.math', type: 'dev.test.math/add', label: 'Add', inputs: { a: 'number', b: 'number' }, outputs: { sum: 'number' } }]);
  const inputs = { a: 2, b: 3 };
  expect(sandbox.evaluate('dev.test.math/add', inputs)).toEqual({ ok: true, outputs: { sum: 5 } });
  expect(inputs).toEqual({ a: 2, b: 3 });
 });

 it('copies vector3 values both ways and rejects bad host inputs without disabling the extension', async () => {
  await open();
  await sandbox.load(manifest('dev.test.vec'), `opensekai.registerNode({ type: 'scale', label: 'Scale', inputs: { v: 'vector3', on: 'boolean' }, outputs: { v: 'vector3' },
   evaluate: ({ v, on }) => { v[0] = 99; return { v: on ? [v[0], v[1] * 2, v[2] * 2] : v }; } });`);
  const v: [number, number, number] = [1, 2, 3];
  expect(sandbox.evaluate('dev.test.vec/scale', { v, on: true })).toEqual({ ok: true, outputs: { v: [99, 4, 6] } });
  expect(v).toEqual([1, 2, 3]);
  expect(sandbox.evaluate('dev.test.vec/scale', { v, on: 1 })).toMatchObject({ ok: false, reject: { code: 'input' } });
  expect(sandbox.evaluate('dev.test.vec/missing', {})).toMatchObject({ ok: false, reject: { code: 'unknown-node' } });
  expect(sandbox.statuses()).toEqual([{ id: 'dev.test.vec', state: 'ready' }]);
 });

 it('rejects an invalid manifest, a duplicate ID, and a source above the size limit before it runs code', async () => {
  await open({ sourceBytes: 64 });
  expect(await sandbox.load({ ...manifest('dev.test.a'), capabilities: ['network'] }, '')).toMatchObject({ ok: false, reject: { code: 'manifest' } });
  expect(await sandbox.load({ ...manifest('dev.test.a'), capabilities: ['log', 'log'] }, '')).toMatchObject({ ok: false, reject: { code: 'manifest' } });
  expect(await sandbox.load(manifest('NoDots'), '')).toMatchObject({ ok: false, reject: { code: 'manifest' } });
  expect(await sandbox.load({ ...manifest('dev.test.a'), apiVersion: 2 }, '')).toMatchObject({ ok: false, reject: { code: 'manifest' } });
  expect(await sandbox.load(manifest('dev.test.a'), 'x'.repeat(65))).toMatchObject({ ok: false, reject: { code: 'manifest' } });
  expect(await sandbox.load(manifest('dev.test.a'), '')).toMatchObject({ ok: true, status: { state: 'ready' } });
  expect(await sandbox.load(manifest('dev.test.a'), '')).toMatchObject({ ok: false, reject: { code: 'duplicate' } });
 });

 it('gives the guest no host globals and a frozen API', async () => {
  await open();
  const probe = `const found = ['ArrayBuffer', 'Uint8Array', 'DataView', 'SharedArrayBuffer', 'fetch', 'require', 'process', 'setTimeout', 'WebSocket', 'XMLHttpRequest', 'window', 'document', 'std', 'os', '__host', '__TAURI__', '__TAURI_INTERNALS__']
   .filter(name => typeof globalThis[name] !== 'undefined');
   opensekai.log(JSON.stringify(found) + ' ' + Object.isFrozen(opensekai));
   try { opensekai.registerNode = null; } catch {}
   opensekai.log(typeof opensekai.registerNode);`;
  expect(await sandbox.load(manifest('dev.test.probe'), probe)).toMatchObject({ ok: true, status: { state: 'ready' } });
  expect(logs.map(entry => entry.message)).toEqual(['[] true', 'function']);
 });

 it('disables an extension that calls an API without its capability, even when the guest catches the error', async () => {
  await open();
  const result = await sandbox.load(manifest('dev.test.denied', ['log']), `try { ${ADD} } catch {}`);
  expect(result).toEqual({ ok: true, status: { id: 'dev.test.denied', state: 'failed', cause: { code: 'denied', message: 'Capability not granted: nodes' } } });
  expect(sandbox.catalog().nodes).toEqual([]);
  expect(failures).toEqual([['dev.test.denied', { code: 'denied', message: 'Capability not granted: nodes' }]]);
 });

 it('allows registration only while the extension loads', async () => {
  await open();
  await sandbox.load(manifest('dev.test.late'), node(`opensekai.registerAssetType({ kind: 'k', label: 'K', fileExtensions: ['.k'] }); return { value: 1 };`));
  expect(sandbox.evaluate('dev.test.late/n', {})).toMatchObject({ ok: false, failure: { code: 'denied' } });
  expect(sandbox.catalog()).toEqual({ nodes: [], assetTypes: [] });
 });

 it('stops a hostile loop at load and at evaluation, releases its registrations, and keeps other extensions running', async () => {
  await open({ loadMs: 50, callMs: 20 });
  await sandbox.load(manifest('dev.test.math'), ADD);
  const start = performance.now();
  expect(await sandbox.load(manifest('dev.test.spin'), 'for (;;) {}')).toMatchObject({ ok: true, status: { state: 'failed', cause: { code: 'timeout' } } });
  expect(performance.now() - start).toBeLessThan(1000);
  await sandbox.load(manifest('dev.test.later'), `${node('try { for (;;) {} } catch { for (;;) {} }')} opensekai.registerAssetType({ kind: 'later', label: 'Later', fileExtensions: ['.later'] });`);
  expect(sandbox.catalog().nodes.map(n => n.type)).toEqual(['dev.test.math/add', 'dev.test.later/n']);
  const call = performance.now();
  expect(sandbox.evaluate('dev.test.later/n', {})).toMatchObject({ ok: false, failure: { code: 'timeout' } });
  expect(performance.now() - call).toBeLessThan(1000);
  expect(sandbox.catalog()).toEqual({ nodes: [expect.objectContaining({ type: 'dev.test.math/add' })], assetTypes: [] });
  expect(sandbox.evaluate('dev.test.later/n', {})).toMatchObject({ ok: false, reject: { code: 'unknown-node' } });
  expect(sandbox.evaluate('dev.test.math/add', { a: 1, b: 1 })).toEqual({ ok: true, outputs: { sum: 2 } });
  expect(sandbox.statuses()).toEqual([
   { id: 'dev.test.math', state: 'ready' },
   { id: 'dev.test.spin', state: 'failed', cause: { code: 'timeout', message: 'Time limit exceeded' } },
   { id: 'dev.test.later', state: 'failed', cause: { code: 'timeout', message: 'Time limit exceeded' } },
  ]);
 });

 it('stops memory and stack exhaustion', async () => {
  await open({ memoryBytes: 4 * 1024 * 1024, loadMs: 2000 });
  expect(await sandbox.load(manifest('dev.test.memory'), HOG)).toMatchObject({ ok: true, status: { state: 'failed', cause: { code: 'memory' } } });
  expect(await sandbox.load(manifest('dev.test.stack'), 'const f = () => f() + 1; f();')).toMatchObject({ ok: true, status: { state: 'failed', cause: { code: 'stack' } } });
  expect(await sandbox.load(manifest('dev.test.after'), ADD)).toMatchObject({ ok: true, status: { state: 'ready' } });
 });

 // QuickJS 0.32.0 throws null when a guest catches out-of-memory errors until it cannot build a new one.
 it('disables a guest that ends close to the memory limit and releases its handles', async () => {
  await open({ memoryBytes: 2 * 1024 * 1024, loadMs: 20000 });
  const squeeze = `const keep = []; let size = 1 << 16;
   while (size > 0) { try { keep.push(new Array(size).fill(1)); } catch { size >>= 1; } }
   ${ADD}`;
  await sandbox.load(manifest('dev.test.math'), ADD);
  const result = await sandbox.load(manifest('dev.test.squeeze'), squeeze);
  expect(result).toMatchObject({ ok: true, status: { state: 'failed', cause: { code: 'memory' } } });
  expect(sandbox.discardedRuntimes()).toBe(0);
  expect(sandbox.catalog().nodes.map(n => n.type)).toEqual(['dev.test.math/add']);
  expect(sandbox.evaluate('dev.test.math/add', { a: 1, b: 2 })).toEqual({ ok: true, outputs: { sum: 3 } });
  expect(await sandbox.load(manifest('dev.test.after'), ADD)).toMatchObject({ ok: true, status: { state: 'ready' } });
 }, 30000);

 it('reserves an ID while it loads, so two loads of one ID cannot both succeed', async () => {
  await open();
  const results = await Promise.all([sandbox.load(manifest('dev.test.twin'), ADD), sandbox.load(manifest('dev.test.twin'), ADD)]);
  expect(results.map(r => (r.ok ? r.status.state : r.reject.code)).sort()).toEqual(['duplicate', 'ready']);
  sandbox.dispose();
  expect(sandbox.discardedRuntimes()).toBe(0);
 });

 it('keeps an extension running when a host callback throws', async () => {
  sandbox = await createSandbox({ onLog: () => { throw new Error('host log'); }, onFailure: () => { throw new Error('host failure'); } });
  await sandbox.load(manifest('dev.test.log'), node(`opensekai.log('a'); return { value: 1 };`));
  expect(sandbox.evaluate('dev.test.log/n', {})).toEqual({ ok: true, outputs: { value: 1 } });
  await sandbox.load(manifest('dev.test.bad'), node('return {};'));
  expect(sandbox.evaluate('dev.test.bad/n', {})).toMatchObject({ ok: false, failure: { code: 'invalid' } });
 });

 // Without the WASM maximum, these guests reach about 1.8 GiB (arrays) and 10 s (strings) before QuickJS stops them.
 it('stops object, array, and string allocation with a memory fault under the WASM memory maximum', async () => {
  await open({ heapBytes: 64 * 1024 * 1024, loadMs: 60000 });
  await sandbox.load(manifest('dev.test.math'), ADD);
  const guests: [string, string][] = [
   ['objects', 'const k = []; for (;;) k.push({ n: k.length });'],
   ['arrays', 'const k = []; for (;;) k.push(new Array(1 << 14).fill(k.length));'],
   ['strings', `const k = []; for (;;) k.push('x'.repeat(1 << 16) + k.length);`],
  ];
  for (const [id, source] of guests) {
   const start = performance.now();
   expect(await sandbox.load(manifest(`dev.test.${id}`), source), id).toMatchObject({ ok: true, status: { state: 'failed', cause: { code: 'memory' } } });
   expect(performance.now() - start, id).toBeLessThan(5000);
  }
  expect(sandbox.evaluate('dev.test.math/add', { a: 1, b: 2 })).toEqual({ ok: true, outputs: { sum: 3 } });
  sandbox.dispose();
  expect(sandbox.discardedRuntimes()).toBe(0);
 }, 30000);

 it('rejects a WASM memory maximum below the initial heap', async () => {
  await expect(createSandbox({ limits: { heapBytes: 8 * 1024 * 1024 } })).rejects.toThrow(RangeError);
 });

 it('enforces the log quota per call and truncates long messages', async () => {
  await open({ logsPerCall: 2, logBytes: 8 });
  await sandbox.load(manifest('dev.test.log'), `opensekai.log('0123456789'); ${node(`opensekai.log('a'); opensekai.log('b'); opensekai.log('c'); return { value: 1 };`)}`);
  expect(logs).toEqual([{ extensionId: 'dev.test.log', message: '01234567…' }]);
  expect(sandbox.evaluate('dev.test.log/n', {})).toMatchObject({ ok: false, failure: { code: 'quota' } });
  expect(logs.map(entry => entry.message)).toEqual(['01234567…', 'a', 'b']);
 });

 it('disables an extension that returns outputs outside its declared ports', async () => {
  await open({ resultBytes: 64 });
  const cases: [string, string, string][] = [
   ['nan', 'return { value: NaN };', 'invalid'],
   ['missing', 'return {};', 'invalid'],
   ['extra', 'return { value: 1, other: 2 };', 'invalid'],
   ['type', `return { value: '1' };`, 'invalid'],
   ['none', 'return undefined;', 'invalid'],
   ['big', `return { value: 1, pad: 'x'.repeat(100) };`, 'quota'],
   ['throws', `throw new Error('boom');`, 'error'],
  ];
  for (const [id, body, code] of cases) {
   await sandbox.load(manifest(`dev.test.${id}`), node(body));
   expect(sandbox.evaluate(`dev.test.${id}/n`, {}), id).toMatchObject({ ok: false, failure: { code } });
  }
  expect(failures.find(([id]) => id === 'dev.test.throws')?.[1]).toEqual({ code: 'error', message: 'Error: boom' });
 });

 it('rejects invalid registrations, reserved file extensions, conflicts, and registration quotas', async () => {
  await open({ nodes: 1 });
  await sandbox.load(manifest('dev.test.assets'), `opensekai.registerAssetType({ kind: 'cube', label: 'Cube', fileExtensions: ['.cube', '.cube'] });`);
  expect(sandbox.catalog().assetTypes).toEqual([{ extensionId: 'dev.test.assets', kind: 'dev.test.assets/cube', label: 'Cube', fileExtensions: ['.cube'] }]);
  const bad: [string, string][] = [
   ['reserved', `opensekai.registerAssetType({ kind: 'v', label: 'V', fileExtensions: ['.vrm'] });`],
   ['conflict', `opensekai.registerAssetType({ kind: 'c', label: 'C', fileExtensions: ['.cube'] });`],
   ['flow', `opensekai.registerNode({ type: 'f', label: 'F', inputs: {}, outputs: { go: 'flow' }, evaluate: () => ({}) });`],
   ['nofn', `opensekai.registerNode({ type: 'f', label: 'F', inputs: {}, outputs: { v: 'number' } });`],
   ['twice', `${node('return { value: 1 };')} ${node('return { value: 1 };').replace("type: 'n'", "type: 'm'")}`],
  ];
  for (const [id, source] of bad)
   expect(await sandbox.load(manifest(`dev.test.${id}`), source), id).toMatchObject({ ok: true, status: { state: 'failed' } });
  expect(failures.map(([id, cause]) => [id, cause.code])).toEqual([
   ['dev.test.reserved', 'invalid'], ['dev.test.conflict', 'invalid'], ['dev.test.flow', 'invalid'], ['dev.test.nofn', 'error'], ['dev.test.twice', 'quota'],
  ]);
  expect(sandbox.catalog().assetTypes.map(a => a.kind)).toEqual(['dev.test.assets/cube']);
 });

 it('reloads a failed extension and releases every QuickJS handle on unload and dispose', async () => {
  await open({ loadMs: 50, callMs: 20, memoryBytes: 4 * 1024 * 1024 });
  for (let round = 0; round < 3; round += 1) {
   await sandbox.load(manifest('dev.test.math'), ADD);
   for (let i = 0; i < 50; i += 1) expect(sandbox.evaluate('dev.test.math/add', { a: i, b: 1 })).toEqual({ ok: true, outputs: { sum: i + 1 } });
   await sandbox.load(manifest('dev.test.spin'), node('for (;;) {}'));
   sandbox.evaluate('dev.test.spin/n', {});
   await sandbox.load(manifest('dev.test.memory'), `${HOG}`);
   await sandbox.load(manifest('dev.test.denied', []), ADD);
   expect(sandbox.unload('dev.test.math')).toBe(true);
  }
  await sandbox.load(manifest('dev.test.math'), ADD);
  sandbox.dispose();
  expect(sandbox.statuses()).toEqual([]);
  expect(sandbox.catalog()).toEqual({ nodes: [], assetTypes: [] });
  expect(sandbox.discardedRuntimes()).toBe(0);
 });
});
