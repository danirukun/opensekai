import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Boundary: the MCP stdio protocol against a real session, as an agent uses it.
const nudge = JSON.parse(readFileSync('fixtures/blueprints/nudge.json', 'utf8'));
const comment = { id: 'c1', text: 'Nudge', position: { x: 0, y: -40 }, size: { width: 400, height: 200 } };

it('adds a comment and duplicates a graph through blueprint_edit, and exports the comment', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], env: process.env as Record<string, string>, stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 try {
  const imported = await call('blueprint_import', { sceneId: 'scene_smoke', file: nudge });
  const graphId = imported.data.report.graphId;
  const edit = (batchId: string, ops: unknown[]) => call('blueprint_edit', { clientId: 'agent', batchId, ops });
  expect(await edit('b1', [{ kind: 'addComment', graphId, comment }, { kind: 'duplicateGraph', graphId, newGraphId: 'copy' }])).toMatchObject({ ok: true });
  expect((await client.callTool({ name: 'blueprint_edit', arguments: { clientId: 'agent', batchId: 'b2', ops: [{ kind: 'updateComment', graphId, commentId: 'c1', text: 'x'.repeat(513) }] } })).isError).toBe(true);
  expect(await edit('b3', [{ kind: 'removeComment', graphId, commentId: 'gone' }])).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  const inspect = await call('blueprint_inspect', {});
  expect(inspect.data.blueprints.map((graph: { id: string; name: string; enabled: boolean }) => [graph.id, graph.name, graph.enabled])).toEqual([[graphId, nudge.graph.name, true], ['copy', `${nudge.graph.name} copy`, false]]);
  const exported = await call('blueprint_export', { sceneId: 'scene_smoke', graphId: 'copy' });
  expect(exported.data.file.graph.comments).toHaveLength(1);
  expect(exported.data.file.graph.comments[0]).toMatchObject({ text: 'Nudge', size: comment.size });
 } finally { await client.close(); }
}, 15000);
