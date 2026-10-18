import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Integration: the stdio MCP protocol boundary, with a real session behind the tools.
it('reads Log lines, debug events, and Debug Value text through blueprint_debug_log with a cursor', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const at = { x: 0, y: 0 };
 const node = (id: string, type: string, settings: object, inputs?: object) => ({ id, version: 1, type, settings, position: at, ...(inputs ? { inputs } : {}) });
 try {
  const graph = { schemaVersion: 1, id: 'g', name: 'G', enabled: true, variables: [], nodes: [
   node('go', 'event.manual', {}),
   node('log', 'debug.log', { level: 'warning' }, { message: 'from <mcp>' }),
   node('event', 'debug.event', { payloadType: 'integer' }, { name: 'score', payload: 7 }),
   node('n', 'value.boolean', { value: true }),
   node('probe', 'debug.value', { valueType: 'boolean' }),
  ], connections: [
   { id: 'a', sourceNodeId: 'go', sourcePort: 'flow', targetNodeId: 'log', targetPort: 'flow' },
   { id: 'b', sourceNodeId: 'log', sourcePort: 'exit', targetNodeId: 'event', targetPort: 'flow' },
   { id: 'c', sourceNodeId: 'n', sourcePort: 'value', targetNodeId: 'probe', targetPort: 'value' },
  ] };
  expect(await call('blueprint_edit', { clientId: 'mcp', batchId: 'b1', ops: [{ kind: 'createGraph', graph }] })).toMatchObject({ ok: true });
  expect(await call('blueprint_debug_log', {})).toEqual({ ok: true, data: { latest: 0, next: 0, dropped: 0, entries: [], values: [] } });
  expect(await call('blueprint_run', { graphId: 'g', triggerNodeId: 'go' })).toMatchObject({ ok: true });
  const first = await call('blueprint_debug_log', {});
  expect(first.data.entries).toEqual([
   { seq: 1, atMs: 0, graphId: 'g', nodeId: 'log', kind: 'log', level: 'warning', message: 'from <mcp>' },
   { seq: 2, atMs: 0, graphId: 'g', nodeId: 'event', kind: 'event', name: 'score', valueType: 'integer', text: '7' },
  ]);
  expect(first.data.values).toEqual([{ graphId: 'g', nodeId: 'probe', valueType: 'boolean', text: 'true', changedMs: 0, seq: 3 }]);
  expect(first.data).toMatchObject({ latest: 3, next: 3 });
  expect(await call('blueprint_run', { graphId: 'g', triggerNodeId: 'go' })).toMatchObject({ ok: true });
  const next = await call('blueprint_debug_log', { since: first.data.next });
  expect(next.data.entries.map((entry: { seq: number; kind: string }) => [entry.seq, entry.kind])).toEqual([[4, 'log'], [5, 'event']]);
  expect(next.data.values).toEqual([]);
  expect((await client.callTool({ name: 'blueprint_debug_log', arguments: { since: -1 } })).isError).toBe(true);
 } finally { await client.close(); }
}, 15000);
