// Boundary: a real Node worker thread runs the extension worker; messages cross postMessage by structured clone.
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensionClient, type ExtensionClient, type FailureCause, type WorkerMessage, type WorkerPort } from '../src';

const manifest = (id: string) => ({ manifestVersion: 1, id, name: 'Test', version: '1.0.0', apiVersion: 1, capabilities: ['nodes', 'log'] });
const ADD = `opensekai.registerNode({ type: 'add', label: 'Add', inputs: { a: 'number', b: 'number' }, outputs: { sum: 'number' }, evaluate: ({ a, b }) => ({ sum: a + b }) });`;
// Each iteration is one native call, so QuickJS checks the deadline only after many seconds.
const NATIVE_SPIN = `opensekai.registerNode({ type: 'spin', label: 'Spin', inputs: {}, outputs: { v: 'number' }, evaluate: () => { for (;;) new Array(1 << 20).fill(0); } });`;

const threads: Worker[] = [];
const spawn = (): WorkerPort => {
 const thread = new Worker(new URL('./fixtures/worker-boot.mjs', import.meta.url));
 threads.push(thread);
 return { post: request => thread.postMessage(request), listen: handler => thread.on('message', (message: WorkerMessage) => handler(message)), terminate: () => void thread.terminate() };
};
let client: ExtensionClient | undefined;
afterEach(async () => { client?.close(); await Promise.all(threads.splice(0).map(thread => thread.terminate())); });

describe('extension worker thread', () => {
 it('loads and evaluates a guest node through the worker protocol', async () => {
  client = createExtensionClient({ spawn });
  expect(await client.load(manifest('dev.test.math'), ADD)).toEqual({ ok: true, status: { id: 'dev.test.math', state: 'ready' } });
  expect(await client.evaluate('dev.test.math/add', { a: 20, b: 22 })).toEqual({ ok: true, outputs: { sum: 42 } });
  expect(client.catalog().nodes.map(node => node.type)).toEqual(['dev.test.math/add']);
 }, 20000);

 it('terminates a worker that stops answering, disables the extension that ran, and reloads the others', async () => {
  const failures: [string, FailureCause][] = [];
  client = createExtensionClient({ spawn, watchdogMs: 1000, onFailure: (id, cause) => failures.push([id, cause]) });
  await client.load(manifest('dev.test.math'), ADD);
  await client.load(manifest('dev.test.spin'), NATIVE_SPIN);
  const first = threads[0]!;
  const exited = new Promise(resolve => first.once('exit', resolve));
  const start = performance.now();
  const queued = client.evaluate('dev.test.math/add', { a: 1, b: 2 });
  const [spin] = await Promise.all([client.evaluate('dev.test.spin/spin', {}), Promise.resolve()]);
  const elapsed = performance.now() - start;
  expect(spin).toEqual({ ok: false, failure: { code: 'unresponsive', message: 'The extension worker stopped answering and was replaced' } });
  expect(elapsed).toBeGreaterThanOrEqual(1000);
  expect(elapsed).toBeLessThan(5000);
  await exited;
  expect(threads).toHaveLength(2);
  expect(await queued).toEqual({ ok: true, outputs: { sum: 3 } });
  expect(await client.evaluate('dev.test.math/add', { a: 2, b: 2 })).toEqual({ ok: true, outputs: { sum: 4 } });
  expect(await client.evaluate('dev.test.spin/spin', {})).toMatchObject({ ok: false, reject: { code: 'unknown-node' } });
  expect(failures).toEqual([['dev.test.spin', { code: 'unresponsive', message: 'The extension worker stopped answering and was replaced' }]]);
  expect(client.statuses()).toEqual([{ id: 'dev.test.math', state: 'ready' }, { id: 'dev.test.spin', state: 'failed', cause: failures[0]![1] }]);
  expect(client.catalog().nodes.map(node => node.type)).toEqual(['dev.test.math/add']);
 }, 20000);
});
