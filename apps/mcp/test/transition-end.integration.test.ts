import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Integration: the stdio MCP protocol boundary, with a real session on a wall clock behind the tools.
// MCP reads the committed scene, which does not move during the loop, so the test reads the ends through Log lines.
it('loops two camera moves through On Transition End, and a scene patch on the camera stops the loop', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], env: { ...process.env, OPENSEKAI_FIXTURE_CLOCK: '1' } as Record<string, string>, stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const node = (id: string, type: string, settings: object, inputs?: object) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 }, ...(inputs ? { inputs } : {}) });
 const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
 const move = (id: string, value: number[]) => node(id, 'property.set', { entityId: 'camera_wide', property: 'position', transitionSeconds: 0.5, easing: 'InOutSine' }, { value });
 const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
 type Entry = { atMs: number; message: string; seq: number };
 const log = async (since?: number) => (await call('blueprint_debug_log', since === undefined ? {} : { since })).data as { entries: Entry[]; next: number };
 try {
  const graph = { schemaVersion: 1, id: 'sway', name: 'Sway', enabled: true, variables: [], nodes: [
   node('enable', 'event.enable', {}), move('a', [1, 1.5, 3]), move('b', [-1, 1.5, 3]),
   node('at-a', 'debug.log', { level: 'info' }, { message: 'a' }), node('at-b', 'debug.log', { level: 'info' }, { message: 'b' }),
  ], connections: [
   wire('1', 'enable', 'flow', 'a', 'flow'), wire('2', 'a', 'transitionEnd', 'at-a', 'flow'), wire('3', 'at-a', 'exit', 'b', 'flow'),
   wire('4', 'b', 'transitionEnd', 'at-b', 'flow'), wire('5', 'at-b', 'exit', 'a', 'flow'),
  ] };
  expect(await call('blueprint_edit', { clientId: 'mcp', batchId: 'b1', ops: [{ kind: 'createGraph', graph }] })).toMatchObject({ ok: true });
  await wait(1800);
  const first = await log();
  expect(first.entries.length).toBeGreaterThanOrEqual(3);
  first.entries.forEach((entry, i) => {
   expect(entry.message).toBe(i % 2 === 0 ? 'a' : 'b');
   if (i > 0) expect(entry.atMs - first.entries[i - 1]!.atMs).toBeGreaterThanOrEqual(480);
   if (i > 0) expect(entry.atMs - first.entries[i - 1]!.atMs).toBeLessThanOrEqual(600);
  });
  const inspected = await call('blueprint_inspect', {});
  expect(inspected.data.errors ?? []).toEqual([]);
  // The loop keeps the camera under a tween, so the scene revision stays.
  const scene = (await call('scene_inspect', { sceneId: 'scene_smoke' })).data;
  expect(scene.revision).toBe(0);
  // Patch just after an end ran, so the camera is in the middle of a move.
  let latest = first.next;
  for (let tries = 0; tries < 50; tries++) { const read = await log(latest); if (read.entries.length > 0) { latest = read.next; break; } await wait(10); }
  const camera = scene.entities.find((entity: { id: string }) => entity.id === 'camera_wide');
  expect(await call('scene_patch', { sceneId: scene.sceneId, expectedRevision: 0, operations: [{ kind: 'setTransform', entityId: 'camera_wide', transform: { ...camera.transform, position: [0, 2, 4] } }] })).toMatchObject({ ok: true });
  await wait(1200);
  expect((await log(latest)).entries).toEqual([]);
 } finally { await client.close(); }
}, 20000);
