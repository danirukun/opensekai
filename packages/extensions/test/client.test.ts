import { describe, expect, it } from 'vitest';
import { createExtensionClient, type WorkerMessage, type WorkerPort, type WorkerRequest } from '../src';
import { createExtensionWorker } from '../src/worker';

const manifest = (id: string) => ({ manifestVersion: 1, id, name: 'Test', version: '1.0.0', apiVersion: 1, capabilities: ['nodes'] });
const ADD = `opensekai.registerNode({ type: 'add', label: 'Add', inputs: { a: 'number' }, outputs: { sum: 'number' }, evaluate: ({ a }) => ({ sum: a + 1 }) });`;

// The fake is the thread boundary only: requests reach a real in-process extension worker unless `hold` keeps them.
const harness = () => {
 const timers: { run: () => void; ms: number; live: boolean }[] = [];
 const ports: { held: WorkerRequest[]; terminated: boolean }[] = [];
 let hold = (_request: WorkerRequest) => false;
 const spawn = (): WorkerPort => {
  const state = { held: [] as WorkerRequest[], terminated: false };
  ports.push(state);
  let deliver: (message: WorkerMessage) => void = () => undefined;
  const worker = createExtensionWorker(message => { if (!state.terminated) deliver(message); });
  return {
   post: request => { if (hold(request)) state.held.push(request); else void worker.then(w => w.receive(request)); },
   listen: handler => { deliver = handler; },
   terminate: () => { state.terminated = true; },
  };
 };
 const client = createExtensionClient({
  spawn, watchdogMs: 1000, startupMs: 0,
  setTimer: (run, ms) => { const timer = { run, ms, live: true }; timers.push(timer); return timer; },
  clearTimer: timer => { (timer as { live: boolean }).live = false; },
 });
 const fire = () => timers.filter(timer => timer.live).forEach(timer => { timer.live = false; timer.run(); });
 return { client, timers, ports, fire, setHold: (fn: (request: WorkerRequest) => boolean) => { hold = fn; } };
};

describe('extension client watchdog', () => {
 it('arms only while a request waits and disarms after each reply', async () => {
  const { client, timers } = harness();
  expect(timers).toEqual([]);
  const loading = client.load(manifest('dev.test.a'), ADD);
  expect(timers.filter(timer => timer.live)).toHaveLength(1);
  await loading;
  expect(await client.evaluate('dev.test.a/add', { a: 1 })).toEqual({ ok: true, outputs: { sum: 2 } });
  expect(timers.length).toBeGreaterThan(0);
  expect(timers.every(timer => timer.ms === 1000 && !timer.live)).toBe(true);
  client.close();
 });

 it('replaces a silent worker, answers the stalled request, and runs queued requests after the reloads', async () => {
  const { client, ports, fire, setHold } = harness();
  await client.load(manifest('dev.test.a'), ADD);
  await client.load(manifest('dev.test.b'), ADD.replace("type: 'add'", "type: 'inc'"));
  // A real worker runs requests in order, so the request after a stalled one also gets no reply.
  setHold(() => true);
  const stalled = client.evaluate('dev.test.b/inc', { a: 1 });
  const queued = client.evaluate('dev.test.a/add', { a: 5 });
  expect(ports[0]!.held).toHaveLength(2);
  setHold(() => false);
  fire();
  expect(await stalled).toMatchObject({ ok: false, failure: { code: 'unresponsive' } });
  expect(ports.map(port => port.terminated)).toEqual([true, false]);
  expect(await queued).toEqual({ ok: true, outputs: { sum: 6 } });
  expect(client.statuses()).toEqual([{ id: 'dev.test.a', state: 'ready' }, { id: 'dev.test.b', state: 'failed', cause: expect.objectContaining({ code: 'unresponsive' }) }]);
  expect(await client.load(manifest('dev.test.b'), ADD)).toMatchObject({ ok: true, status: { state: 'ready' } });
  client.close();
  expect(await client.evaluate('dev.test.a/add', { a: 1 })).toMatchObject({ ok: false, reject: { code: 'closed' } });
 });

 it('does not report a stalled unload as a failure and answers waiting requests as closed on close', async () => {
  const { client, ports, fire, setHold } = harness();
  await client.load(manifest('dev.test.a'), ADD);
  setHold(() => true);
  const unloading = client.unload('dev.test.a');
  setHold(() => false);
  fire();
  expect(await unloading).toBe(true);
  expect(client.statuses()).toEqual([]);
  expect(ports).toHaveLength(2);
  setHold(() => true);
  const waiting = client.evaluate('dev.test.a/add', { a: 1 });
  client.close();
  expect(await waiting).toMatchObject({ ok: false, reject: { code: 'closed' } });
  expect(ports[1]!.terminated).toBe(true);
 });

 it('gives a new worker the startup time before the watchdog applies', async () => {
  const timers: number[] = [];
  const client = createExtensionClient({ spawn: () => ({ post: () => undefined, listen: () => undefined, terminate: () => undefined }), watchdogMs: 1000, setTimer: (_run, ms) => { timers.push(ms); return ms; }, clearTimer: () => undefined });
  void client.load(manifest('dev.test.a'), ADD);
  expect(timers).toEqual([6000]);
  client.close();
 });
});
