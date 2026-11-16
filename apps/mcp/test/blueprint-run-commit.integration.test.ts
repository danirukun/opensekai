import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Integration: the MCP stdio protocol boundary, with a real session behind the tools.
// The fixture runs without OPENSEKAI_FIXTURE_CLOCK, so the session never advances: only the call itself can commit the write.
it('shows the write of blueprint_run in its reply revision and in the next scene_inspect, with no clock step', async () => {
 const { OPENSEKAI_FIXTURE_CLOCK: _clock, ...env } = process.env;
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], env: env as Record<string, string>, stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const node = (id: string, type: string, settings: object, inputs?: object) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 }, ...(inputs ? { inputs } : {}) });
 try {
  const graph = { schemaVersion: 1, id: 'g', name: 'G', enabled: true, variables: [], nodes: [
   node('go', 'event.manual', {}), node('set', 'property.set', { entityId: 'reference', property: 'position' }, { value: [1, 2, 3] }),
  ], connections: [{ id: 'flow', sourceNodeId: 'go', sourcePort: 'flow', targetNodeId: 'set', targetPort: 'flow' }] };
  expect(await call('blueprint_edit', { clientId: 'mcp', batchId: 'b1', ops: [{ kind: 'createGraph', graph }] })).toMatchObject({ ok: true });
  expect(await call('blueprint_run', { graphId: 'g', triggerNodeId: 'go' })).toEqual({ ok: true, data: { revision: 1 } });
  const scene = (await call('scene_inspect', { sceneId: 'scene_smoke' })).data;
  expect(scene.revision).toBe(1);
  expect(scene.entities.find((entity: { id: string }) => entity.id === 'reference').transform.position).toEqual([1, 2, 3]);
 } finally { await client.close(); }
}, 20000);
