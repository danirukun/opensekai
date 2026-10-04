import { afterEach, expect, it, vi } from 'vitest';
import { LIMITS, makeSmokeFrame } from '@opensekai/contracts';
import type { BrowserClient, ConnectionDescriptor, PublisherClient } from '@opensekai/contracts';
import { connectWithPorts } from '../src/client';
class Socket extends EventTarget {
 bufferedAmount = 0; sent: string[] = []; closed = false; throws = false;
 send(text: string) { if (this.throws) throw new Error('send failed'); this.sent.push(text); }
 close() { this.closed = true; }
 message(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
}
const descriptor: ConnectionDescriptor = { schemaVersion: 1, sessionId: 'session_smoke', httpOrigin: 'http://127.0.0.1:1234', wsUrl: 'ws://127.0.0.1:1234/ws', role: 'publisher', token: 'test', capabilities: ['read'], outputId: null };
const authenticate = (socket: Socket) => { socket.dispatchEvent(new Event('open')); socket.message({ kind: 'authReply', sessionId: descriptor.sessionId, schemaVersion: 1, capabilities: ['read'] }); };
async function start(role: ConnectionDescriptor['role'] = 'publisher') {
 vi.useFakeTimers(); const sockets: Socket[] = [];
 const promise = connectWithPorts({ ...descriptor, role }, { socket() { const socket = new Socket(); sockets.push(socket); return socket; }, setTimeout, clearTimeout, fetch });
 authenticate(sockets[0]); return { sockets, client: await promise };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
it('bounds state by encoded frame bytes and resumes with the next full frame', async () => {
 const { sockets, client } = await start(); const publisher = client as PublisherClient; const socket = sockets[0];
 const frame = makeSmokeFrame({ sequence: 1 }); const bytes = new TextEncoder().encode(JSON.stringify({ kind: 'frame', frame })).length;
 socket.bufferedAmount = bytes; publisher.publishFrame(frame); expect(socket.sent).toHaveLength(2);
 socket.bufferedAmount = bytes + 1; publisher.publishFrame(makeSmokeFrame({ sequence: 2 })); expect(socket.sent).toHaveLength(2); expect(socket.closed).toBe(false);
 socket.bufferedAmount = 0; publisher.publishFrame(makeSmokeFrame({ sequence: 3 })); expect(JSON.parse(socket.sent[2]).frame.sequence).toBe(3);
 publisher.close();
});
it.each(['backpressure', 'throw', 'size'] as const)('disconnects a failed publisher reply (%s), retains listener and does not replay', async failure => {
 const { sockets, client } = await start(); const publisher = client as PublisherClient;
 let oversized = failure === 'size';
 const listener = vi.fn(async () => ({ ok: false as const, error: { code: 'UNAVAILABLE' as const, message: oversized ? 'x'.repeat(LIMITS.jsonBytes) : 'unavailable', ids: [] } }));
 publisher.onCall(listener);
 const call = { kind: 'call', requestId: 'one', method: 'sceneInspect', params: { sceneId: 'scene_smoke' } };
 sockets[0].bufferedAmount = failure === 'backpressure' ? LIMITS.jsonBytes * LIMITS.queuedFrames + 1 : 0; sockets[0].throws = failure === 'throw';
 sockets[0].message(call); await flush(); expect(sockets[0].closed).toBe(true); expect(vi.getTimerCount()).toBe(1);
 vi.advanceTimersByTime(100); authenticate(sockets[1]); await flush(); expect(listener).toHaveBeenCalledTimes(1); expect(sockets[1].sent).toHaveLength(1);
 oversized = false; sockets[1].message({ ...call, requestId: 'two' }); await flush(); expect(listener).toHaveBeenCalledTimes(2); expect(JSON.parse(sockets[1].sent[1]).requestId).toBe('two');
 publisher.close(); expect(vi.getTimerCount()).toBe(0);
});
it.each(['backpressure', 'throw'] as const)('settles all pending control calls as UNAVAILABLE on a send failure (%s) and recovers without replay', async failure => {
 const { sockets, client } = await start('operator'); const browser = client as BrowserClient;
 const pending = browser.api.appStatus({}); sockets[0].bufferedAmount = failure === 'backpressure' ? LIMITS.jsonBytes * LIMITS.queuedFrames + 1 : 0; sockets[0].throws = failure === 'throw';
 const failed = browser.api.appStatus({});
 expect(await failed).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } }); expect(await pending).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } }); expect(sockets[0].closed).toBe(true);
 vi.advanceTimersByTime(100); authenticate(sockets[1]); expect(sockets[1].sent).toHaveLength(1); browser.close();
});

it('disconnects failed capture replies and retains the capture callback after reconnect', async () => {
 vi.useFakeTimers(); const sockets: Socket[] = [];
 const promise = connectWithPorts({ ...descriptor, role: 'renderer', outputId: 'output_main' }, { socket() { const socket = new Socket(); sockets.push(socket); return socket; }, setTimeout, clearTimeout, fetch });
 authenticate(sockets[0]); const client = await promise as BrowserClient;
 const capture = vi.fn(async () => ({ ok: false as const, error: { code: 'UNAVAILABLE' as const, message: 'unavailable', ids: [] } })); client.onCapture(capture);
 const request = { kind: 'captureRequest', requestId: 'capture1', params: { outputId: 'output_main', expectedRevision: 0, preset: 'diagnostic_v1', maxAgeMs: 500 } };
 sockets[0].bufferedAmount = LIMITS.jsonBytes * LIMITS.queuedFrames + 1; sockets[0].message(request); await flush(); expect(sockets[0].closed).toBe(true);
 vi.advanceTimersByTime(100); authenticate(sockets[1]); sockets[1].message({ ...request, requestId: 'capture2' }); await flush();
 expect(capture).toHaveBeenCalledTimes(2); expect(JSON.parse(sockets[1].sent[1]).kind).toBe('captureReply');
 client.onCapture(async () => ({ ok: true, data: { png: new Uint8Array(600_000), width: 1920, height: 1080,
  frame: { sessionId: descriptor.sessionId, outputId: 'output_main', sequence: 1, tick: 1, revision: 0, cameraId: 'camera_wide', backend: 'webgl2', cpuMs: 1, gpuMs: null, warnings: [] } } }));
 sockets[1].message({ ...request, requestId: 'large' }); await flush();
 const reply = JSON.parse(sockets[1].sent[2]); expect(reply.result.ok).toBe(true); expect(reply.result.data.pngBase64.length).toBe(800_000); expect(sockets[1].closed).toBe(false); client.close();
});
