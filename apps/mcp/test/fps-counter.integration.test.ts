import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: the FPS counter goes through scene_patch, the same validated route as the editor (B19 R13).
it('creates, changes, limits, and removes an FPS counter through scene_patch', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
 const fpsCounter = { corner: 'topRight', size: 32, color: '#ffffff' };
 const counter = (id: string) => ({ id, name: 'FPS Counter', visible: true, transform, kind: 'fpsCounter', fpsCounter });
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 try {
  const tools = await client.listTools();
  expect(tools.tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/fpsCounter.*at most 1 FPS counter.*setFpsCounter/s);
  expect(await patch(0, [{ kind: 'createEntity', entity: counter('fps') }])).toMatchObject({ ok: true, data: { revision: 1 } });
  const moved = { corner: 'bottomLeft', size: 64, color: '#00ff00' };
  expect(await patch(1, [{ kind: 'setFpsCounter', entityId: 'fps', fpsCounter: moved }])).toMatchObject({ ok: true, data: { revision: 2 } });
  const entities = (await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities;
  expect(entities.find((e: { id: string }) => e.id === 'fps')).toMatchObject({ kind: 'fpsCounter', fpsCounter: moved });
  expect(await patch(2, [{ kind: 'setFpsCounter', entityId: 'performer', fpsCounter }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['performer'] } });
  expect(await patch(2, [{ kind: 'createEntity', entity: counter('fps_2') }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect((await client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision: 2, operations: [{ kind: 'setFpsCounter', entityId: 'fps', fpsCounter: { ...fpsCounter, size: 129 } }] } })).isError).toBe(true);
  expect(await patch(2, [{ kind: 'removeEntity', entityId: 'fps' }])).toMatchObject({ ok: true, data: { revision: 3 } });
  expect((await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities.some((e: { id: string }) => e.id === 'fps')).toBe(false);
 } finally { await client.close(); }
}, 15000);
