import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: the R12 source rule reaches MCP through scene_patch, the same route as the editor.
it('rejects a tracking source that two characters would use through scene_patch', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
 try {
  const tools = (await client.listTools()).tools;
  expect(tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/createEntity.*tracking.*setTrackingConfig.*setAvatarTracking.*setTrackingSmoothing/s);
  expect(tools.find(tool => tool.name === 'app_status')?.description).toMatch(/localAddresses/);
  const scene = (await call('scene_inspect', { sceneId: 'scene_smoke' })).data;
  const performer = scene.entities.find((e: { id: string }) => e.id === 'performer');
  expect(await patch(0, [
   { kind: 'createEntity', entity: { id: 'vmc', name: 'VMC', visible: true, transform, kind: 'tracking', generation: 0, config: { kind: 'vmc', enabled: false, bindAddress: '127.0.0.1', port: 39539, senderAddress: null } } },
   { kind: 'createEntity', entity: { ...performer, id: 'second', name: 'Second', tracking: { bodySourceId: null, faceSourceId: null } } },
   { kind: 'setAvatarTracking', entityId: 'performer', tracking: { bodySourceId: 'vmc', faceSourceId: 'vmc' } },
  ])).toMatchObject({ ok: true, data: { revision: 1 } });
  const shared = await client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision: 1, operations: [{ kind: 'setAvatarTracking', entityId: 'second', tracking: { bodySourceId: 'vmc', faceSourceId: null } }] } });
  expect(shared.isError).toBe(true);
  expect(shared.structuredContent).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: expect.arrayContaining(['performer', 'second']) } });
  expect((await call('scene_inspect', { sceneId: 'scene_smoke' })).data.revision).toBe(1);
 } finally { await client.close(); }
}, 15000);
