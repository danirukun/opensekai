import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: the character lighting goes through scene_patch, the same validated route as the editor.
it('sets, validates, and restores the lighting of a character through scene_patch', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 const lighting = { rimStrength: 1.5, rimWidth: 0.4, rimTint: '#ffeedd', shadowStrength: 0.8, environmentFill: 0.5 };
 const performer = async () => (await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities.find((e: { id: string }) => e.id === 'performer');
 try {
  const tools = await client.listTools();
  expect(tools.tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/setAvatarLighting.*rimStrength 0 to 2.*null restores the defaults/s);
  expect(await patch(0, [{ kind: 'setAvatarLighting', entityId: 'performer', lighting }])).toMatchObject({ ok: true, data: { revision: 1 } });
  expect(await performer()).toMatchObject({ lighting });
  expect((await client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision: 1, operations: [{ kind: 'setAvatarLighting', entityId: 'performer', lighting: { ...lighting, rimStrength: 2.5 } }] } })).isError).toBe(true);
  expect(await patch(1, [{ kind: 'setAvatarLighting', entityId: 'camera_wide', lighting }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(await patch(1, [{ kind: 'setAvatarLighting', entityId: 'performer', lighting: null }])).toMatchObject({ ok: true, data: { revision: 2 } });
  expect(await performer()).not.toHaveProperty('lighting');
 } finally { await client.close(); }
}, 15000);
