import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Integration: the stdio MCP protocol boundary, with a real session behind the tools.
it('sends a custom event with a payload through blueprint_run and rejects a mixed form', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const at = { x: 0, y: 0 };
 try {
  const graph = { schemaVersion: 1, id: 'g', name: 'G', enabled: true, nodes: [
   { id: 'on', version: 1, type: 'event.custom', settings: { name: 'show', payload: 'boolean' }, position: at },
   { id: 'set', version: 1, type: 'scene.setVisibility', settings: { entityId: 'performer' }, position: at },
  ], connections: [
   { id: 'w1', sourceNodeId: 'on', sourcePort: 'flow', targetNodeId: 'set', targetPort: 'flow' },
   { id: 'w2', sourceNodeId: 'on', sourcePort: 'payload', targetNodeId: 'set', targetPort: 'visible' },
  ], variables: [] };
  expect(await call('blueprint_edit', { clientId: 'mcp', batchId: 'b1', ops: [{ kind: 'createGraph', graph }] })).toMatchObject({ ok: true });
  expect(await call('blueprint_run', { event: 'show', payload: false })).toMatchObject({ ok: true, data: { revision: 1 } });
  const scene = await call('scene_inspect', { sceneId: 'scene_smoke' });
  expect(scene.data.entities.find((entity: { id: string }) => entity.id === 'performer').visible).toBe(false);
  // The SDK checks the input schema first and answers with an error result.
  const rejected = async (args: Record<string, unknown>) => { const result = await client.callTool({ name: 'blueprint_run', arguments: args }); return result.isError === true || (result.structuredContent as { ok?: boolean } | undefined)?.ok === false; };
  expect(await rejected({ event: 'show', graphId: 'g', triggerNodeId: 'on' })).toBe(true);
  expect(await rejected({ event: 'show', payload: { x: 1 } })).toBe(true);
  expect(await rejected({ graphId: 'g' })).toBe(true);
 } finally { await client.close(); }
}, 15000);
