import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: the expression tools call the same validated methods as the editor.
it('lists, activates, and configures character expressions', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 try {
  const listed = await call('expression_get', { avatarId: 'performer' });
  expect(listed).toMatchObject({ ok: true, data: { avatarId: 'performer' } });
  expect(listed.data.expressions.map((e: { name: string; layer: number }) => [e.name, e.layer])).toEqual([['happy', 0], ['Wink', 1]]);
  const set = await call('expression_set', { avatarId: 'performer', name: 'Wink', active: true });
  expect(set.data.expressions[1]).toMatchObject({ name: 'Wink', active: true });
  expect(await call('expression_set', { avatarId: 'performer', name: 'aa', active: true })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect((await client.callTool({ name: 'expression_set', arguments: { avatarId: 'performer', name: '', active: true } })).isError).toBe(true);
  const settings = { layer: 4, fadeSeconds: 1.5, suppress: { blink: true, mouth: false, brow: false } };
  expect(await call('scene_patch', { sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'setAvatarExpression', entityId: 'performer', name: 'happy', settings }] })).toMatchObject({ ok: true, data: { revision: 1 } });
  expect((await call('expression_get', { avatarId: 'performer' })).data.expressions[0]).toMatchObject({ name: 'happy', ...settings, active: false });
  expect((await call('scene_inspect', { sceneId: 'scene_smoke' })).data.revision).toBe(1);
 } finally { await client.close(); }
}, 15000);
