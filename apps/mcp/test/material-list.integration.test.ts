import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: material_list uses the same validated method as the editor (B38 R18).
it('lists the materials of a character and refuses another kind', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (args: Record<string, unknown>) => (await client.callTool({ name: 'material_list', arguments: args })).structuredContent as { ok: boolean; data?: unknown; error?: unknown };
 try {
  expect(await call({ entityId: 'performer' })).toEqual({ ok: true, data: { materials: [{ name: 'Skin', profile: 'mtoon', parameters: [
   { parameter: 'baseColor', model: '#ffffff' }, { parameter: 'emissionColor', model: '#000000' }, { parameter: 'emissionStrength', model: 1 },
   { parameter: 'shadeColor', model: '#ffcccc' }, { parameter: 'rimColor', model: '#000000' },
  ] }] } });
  expect(await call({ entityId: 'camera_wide' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Entity has no materials' } });
  expect(await call({ entityId: 'nobody' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  // The tool input schema refuses the parameter of mesh_list.
  expect((await client.callTool({ name: 'material_list', arguments: { avatarId: 'performer' } })).isError).toBe(true);
 } finally { await client.close(); }
}, 15000);
