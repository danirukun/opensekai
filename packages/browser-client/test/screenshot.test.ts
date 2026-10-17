import { afterEach, expect, it, vi } from 'vitest';
import { LIMITS, parseWire } from '@opensekai/contracts';
import type { BrowserClient, ConnectionDescriptor, ScreenshotBytes } from '@opensekai/contracts';
import { connectWithPorts } from '../src/client';
class Socket extends EventTarget {
 bufferedAmount = 0; sent: string[] = []; closed = false;
 send(text: string) { this.sent.push(text); }
 close() { this.closed = true; }
 message(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
}
const base: ConnectionDescriptor = { schemaVersion: 1, sessionId: 'session_smoke', httpOrigin: 'http://127.0.0.1:1234', wsUrl: 'ws://127.0.0.1:1234/ws', role: 'renderer', token: 'test', capabilities: ['read'], outputId: 'preview_main' };
async function start(descriptor: ConnectionDescriptor = base) {
 vi.useFakeTimers(); const sockets: Socket[] = [];
 const promise = connectWithPorts(descriptor, { socket() { const socket = new Socket(); sockets.push(socket); return socket; }, setTimeout, clearTimeout, fetch });
 sockets[0].dispatchEvent(new Event('open'));
 sockets[0].message({ kind: 'authReply', sessionId: descriptor.sessionId, schemaVersion: 1, capabilities: descriptor.capabilities });
 return { socket: sockets[0], client: await promise as BrowserClient };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const request = { kind: 'screenshotRequest', requestId: 'shot1', params: { cameraId: 'camera_main', expectedRevision: 3 } };
const shot = (png: Uint8Array, patch: Partial<ScreenshotBytes> = {}): ScreenshotBytes => ({ sessionId: base.sessionId, revision: 3, cameraId: 'camera_main', width: 1920, height: 1080, png, ...patch });
const lastReply = (socket: Socket) => parseWire(socket.sent.at(-1)!) as { kind: string; requestId: string; result: { ok: boolean; data?: { pngBase64: string }; error?: { code: string } } };
afterEach(() => vi.useRealTimers());

it('answers a screenshot request with base64 PNG data up to the 8 MiB limit', async () => {
 const { socket, client } = await start();
 const png = new Uint8Array(LIMITS.screenshotPngBytes).fill(7); png.set([137, 80, 78, 71]);
 const listener = vi.fn(async () => ({ ok: true as const, data: shot(png) }));
 client.onScreenshot(listener);
 socket.message(request); await flush();
 expect(listener).toHaveBeenCalledWith({ cameraId: 'camera_main', expectedRevision: 3 });
 const reply = lastReply(socket);
 expect(reply).toMatchObject({ kind: 'screenshotReply', requestId: 'shot1', result: { ok: true, data: { sessionId: base.sessionId, revision: 3, cameraId: 'camera_main', width: 1920, height: 1080 } } });
 expect(Buffer.from(reply.result.data!.pngBase64, 'base64').equals(png)).toBe(true);
 expect(socket.sent.at(-1)!.length).toBeGreaterThan(LIMITS.captureEnvelopeBytes);
 expect(socket.closed).toBe(false);
 client.close();
});

it.each([
 ['a PNG above 8 MiB', shot(new Uint8Array(LIMITS.screenshotPngBytes + 1))],
 ['another session', shot(new Uint8Array(8), { sessionId: 'other' })],
 ['an empty PNG', shot(new Uint8Array(0))],
])('replies INVALID_INPUT for %s and keeps the connection', async (_, data) => {
 const { socket, client } = await start();
 client.onScreenshot(async () => ({ ok: true, data }));
 socket.message(request); await flush();
 expect(lastReply(socket).result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(socket.closed).toBe(false);
 client.close();
});

it('passes a listener failure through, reports a missing listener, and bounds the listener by the screenshot timeout', async () => {
 const { socket, client } = await start();
 socket.message(request); await flush();
 expect(lastReply(socket).result).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
 const off = client.onScreenshot(async () => ({ ok: false, error: { code: 'CONFLICT', message: 'Revision changed', ids: [] } }));
 socket.message({ ...request, requestId: 'shot2' }); await flush();
 expect(lastReply(socket)).toMatchObject({ requestId: 'shot2', result: { ok: false, error: { code: 'CONFLICT' } } });
 off();
 client.onScreenshot(() => new Promise(() => {}));
 socket.message({ ...request, requestId: 'shot3' }); await flush();
 vi.advanceTimersByTime(LIMITS.rpcTimeoutMs); await flush();
 expect(socket.sent.some(text => text.includes('"shot3"'))).toBe(false);
 vi.advanceTimersByTime(LIMITS.screenshotTimeoutMs - LIMITS.rpcTimeoutMs); await flush();
 expect(lastReply(socket)).toMatchObject({ requestId: 'shot3', result: { ok: false, error: { code: 'TIMEOUT' } } });
 client.close();
});

it('disconnects an operator that receives a screenshot request', async () => {
 const { socket, client } = await start({ ...base, role: 'operator', outputId: null, capabilities: ['read', 'edit'] });
 socket.message(request); await flush();
 expect(socket.closed).toBe(true);
 client.close();
});

it('waits longer than the host screenshot timeout for a cameraScreenshot reply', async () => {
 const { socket, client } = await start({ ...base, role: 'operator', outputId: null, capabilities: ['read', 'edit'] });
 const reply = client.api.cameraScreenshot({ cameraId: 'camera_main', expectedRevision: 3 });
 const call = JSON.parse(socket.sent.at(-1)!);
 expect(call).toMatchObject({ kind: 'call', method: 'cameraScreenshot', params: { cameraId: 'camera_main', expectedRevision: 3 } });
 vi.advanceTimersByTime(LIMITS.screenshotTimeoutMs); await flush();
 const data = { fileName: '20261017-090507-042-camera_main.png', width: 1920, height: 1080, bytes: 10, sha256: 'a'.repeat(64), cameraId: 'camera_main', revision: 3 };
 socket.message({ kind: 'reply', requestId: call.requestId, result: { ok: true, data } });
 expect(await reply).toEqual({ ok: true, data });
 const late = client.api.cameraScreenshot({ cameraId: 'camera_main', expectedRevision: 3 });
 vi.advanceTimersByTime(LIMITS.screenshotTimeoutMs + LIMITS.rpcTimeoutMs);
 expect(await late).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
 client.close();
});
