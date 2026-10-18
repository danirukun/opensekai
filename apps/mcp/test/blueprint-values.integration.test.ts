import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Integration: the stdio MCP protocol boundary, with a real session behind the tools.
it('creates typed variables and inline values through blueprint_edit and reads them back', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const at = { x: 0, y: 0 };
 try {
  const catalog = JSON.parse(((await client.readResource({ uri: 'opensekai://blueprint-nodes' })).contents[0] as { text: string }).text);
  expect(catalog.dataTypes).toContain('string[]');
  const graph = { schemaVersion: 1, id: 'g', name: 'G', enabled: true, nodes: [
   { id: 'go', version: 1, type: 'event.manual', settings: {}, position: at },
   { id: 'set', version: 1, type: 'property.set', settings: { entityId: 'reference', property: 'position' }, position: at },
  ], connections: [{ id: 'w', sourceNodeId: 'go', sourcePort: 'flow', targetNodeId: 'set', targetPort: 'flow' }], variables: [] };
  expect(await call('blueprint_edit', { clientId: 'mcp', batchId: 'b1', ops: [
   { kind: 'createGraph', graph },
   { kind: 'addVariable', graphId: 'g', variable: { id: 's', name: 'Greeting', type: 'string', default: 'hi' } },
   { kind: 'addVariable', graphId: 'g', variable: { id: 'l', name: 'Steps', type: 'integer[]', default: [1, 2] } },
   { kind: 'setNodeInput', graphId: 'g', nodeId: 'set', port: 'value', value: [0, 1, 0] },
  ] })).toMatchObject({ ok: true });
  expect(await call('blueprint_edit', { clientId: 'mcp', batchId: 'b2', ops: [{ kind: 'setNodeInput', graphId: 'g', nodeId: 'set', port: 'value', value: true }] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid inline input' } });
  const view = await call('blueprint_inspect', {});
  expect(view.data.blueprints[0].variables).toEqual([{ id: 's', name: 'Greeting', type: 'string', default: 'hi' }, { id: 'l', name: 'Steps', type: 'integer[]', default: [1, 2] }]);
  expect(view.data.blueprints[0].nodes[1].inputs).toEqual({ value: [0, 1, 0] });
  expect(view.data.errors).toEqual([]);
  expect(await call('blueprint_run', { graphId: 'g', triggerNodeId: 'go' })).toMatchObject({ ok: true });
 } finally { await client.close(); }
}, 15000);
