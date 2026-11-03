import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: mesh_list, scene_patch, and a Blueprint use the same validated methods as the editor.
it('lists, hides, and toggles character meshes', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const meshes = async () => (await call('mesh_list', { avatarId: 'performer' })).data;
 const patch = (revision: number, entityId: string, hiddenMeshes: string[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision: revision, operations: [{ kind: 'setHiddenMeshes', entityId, hiddenMeshes }] });
 try {
  expect(await meshes()).toEqual({ meshes: [{ name: 'Body', hidden: false }, { name: 'Face', hidden: false }, { name: 'Hair', hidden: false }], unknown: [] });
  expect(await patch(0, 'performer', ['Hair', 'Tail'])).toMatchObject({ ok: true, data: { revision: 1 } });
  expect(await meshes()).toEqual({ meshes: [{ name: 'Body', hidden: false }, { name: 'Face', hidden: false }, { name: 'Hair', hidden: true }], unknown: ['Tail'] });
  expect(await patch(1, 'camera_wide', ['Hair'])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Entity is not an avatar' } });
  expect(await call('mesh_list', { avatarId: 'marker' })).toMatchObject({ ok: false, error: { message: 'Entity is not an avatar' } });
  const at = { x: 0, y: 0 };
  const graph = { schemaVersion: 1, id: 'outfit', name: 'Outfit', enabled: true, variables: [], connections: [{ id: 'w', sourceNodeId: 'run', sourcePort: 'flow', targetNodeId: 'toggle', targetPort: 'flow' }], nodes: [
   { id: 'run', version: 1, type: 'event.manual', settings: {}, position: at },
   { id: 'toggle', version: 1, type: 'character.toggleMeshes', settings: { entityId: 'performer', meshes: ['Hair', 'Face'] }, position: at },
  ] };
  expect(await call('blueprint_edit', { clientId: 'mcp-test', batchId: 'outfit-1', ops: [{ kind: 'replaceAll', graphs: [graph] }] })).toMatchObject({ ok: true });
  expect(await call('blueprint_run', { graphId: 'outfit', triggerNodeId: 'run' })).toMatchObject({ ok: true, data: { revision: 2 } });
  expect((await meshes()).meshes).toEqual([{ name: 'Body', hidden: false }, { name: 'Face', hidden: true }, { name: 'Hair', hidden: false }]);
  expect((await meshes()).unknown).toEqual(['Tail']);
  const catalog = await client.readResource({ uri: 'opensekai://blueprint-nodes' });
  const text = (catalog.contents[0] as { text: string }).text;
  expect(text).toContain('character.toggleMeshes');
  expect(text).toContain('character.setMeshesVisible');
 } finally { await client.close(); }
}, 15000);
