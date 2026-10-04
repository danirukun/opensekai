import { expect, it, vi } from 'vitest';
import type { ConnectionDescriptor } from '@opensekai/contracts';

it('calls native browser timers with their global receiver during authentication and cleanup', async () => {
 const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
 const timers = new Set<ReturnType<typeof setTimeout>>();
 const sockets: Socket[] = [];
 class Socket extends EventTarget {
  bufferedAmount = 0;
  constructor() { super(); sockets.push(this); }
  send() {}
  close() {}
 }
 vi.resetModules();
 vi.stubGlobal('setTimeout', function(this: unknown, callback: () => void, ms: number) {
  if (this !== globalThis) throw new TypeError('Invalid Window timer receiver');
  const timer = originalSet(callback, ms); timers.add(timer); return timer;
 });
 vi.stubGlobal('clearTimeout', function(this: unknown, timer: ReturnType<typeof setTimeout>) {
  if (this !== globalThis) throw new TypeError('Invalid Window timer receiver');
  timers.delete(timer); originalClear(timer);
 });
 vi.stubGlobal('WebSocket', Socket);
 try {
  const { connectClient } = await import('../src/client');
  const descriptor: ConnectionDescriptor = { schemaVersion: 1, sessionId: 'test', role: 'operator',
   httpOrigin: 'http://127.0.0.1:1234', wsUrl: 'ws://127.0.0.1:1234/ws', token: 'test', capabilities: ['read'], outputId: null };
  const promise = connectClient(descriptor);
  sockets[0].dispatchEvent(new Event('open'));
  sockets[0].dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ kind: 'authReply', sessionId: 'test', schemaVersion: 1, capabilities: ['read'] }) }));
  const client = await promise;
  client.close();
  expect(timers.size).toBe(0);
 } finally {
  for (const timer of timers) originalClear(timer);
  vi.unstubAllGlobals(); vi.resetModules();
 }
});
