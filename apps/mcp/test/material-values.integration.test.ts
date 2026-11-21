import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: scene_patch, material_list, and a Blueprint run use the same validated methods
// as the editor (B38 R30).
it('saves material values with scene_patch and a Set node, and reports them in material_list', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const list = async () => (await call('material_list', { entityId: 'performer' })).data;
 const patch = (revision: number, entityId: string, materials: unknown) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision: revision, operations: [{ kind: 'setMaterialValues', entityId, materials }] });
 try {
  const tools = (await client.listTools()).tools;
  expect(tools.find(tool => tool.name === 'scene_patch')?.description).toContain('setMaterialValues {entityId, materials}');
  expect(await patch(0, 'performer', { Skin: { baseColor: '#ff0000' }, Cape: { baseColor: '#00ff00' } })).toMatchObject({ ok: true, data: { revision: 1 } });
  const saved = await list();
  expect(saved.materials[0].parameters[0]).toEqual({ parameter: 'baseColor', model: '#ffffff', value: '#ff0000' });
  expect(saved.materials[0].parameters[1]).toEqual({ parameter: 'emissionColor', model: '#000000' });
  expect(saved.unknown).toEqual(['Cape']);
  // The tool input schema refuses an upper-case color; the session refuses a camera.
  expect((await client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision: 1, operations: [{ kind: 'setMaterialValues', entityId: 'performer', materials: { Skin: { baseColor: '#FF0000' } } }] } })).isError).toBe(true);
  expect(await patch(1, 'camera_wide', { Skin: { baseColor: '#ff0000' } })).toMatchObject({ ok: false });
  // A Set node without a transition commits before the run reply (B33 R4).
  const at = { x: 0, y: 0 };
  const graph = { schemaVersion: 1, id: 'looks', name: 'Looks', enabled: true, variables: [], connections: [{ id: 'w', sourceNodeId: 'run', sourcePort: 'flow', targetNodeId: 'set', targetPort: 'flow' }], nodes: [
   { id: 'run', version: 1, type: 'event.manual', settings: {}, position: at },
   { id: 'set', version: 1, type: 'character.setMaterialProperty', settings: { entityId: 'performer', material: 'Skin', parameter: 'shadeColor', transitionSeconds: 0 }, position: at, inputs: { value: '#0000ff' } },
  ] };
  expect(await call('blueprint_edit', { clientId: 'mcp-test', batchId: 'looks-1', ops: [{ kind: 'replaceAll', graphs: [graph] }] })).toMatchObject({ ok: true });
  expect(await call('blueprint_run', { graphId: 'looks', triggerNodeId: 'run' })).toMatchObject({ ok: true, data: { revision: 2 } });
  expect((await list()).materials[0].parameters.find((view: { parameter: string }) => view.parameter === 'shadeColor')).toEqual({ parameter: 'shadeColor', model: '#ffcccc', value: '#0000ff' });
  const sceneNow = (await call('scene_inspect', { sceneId: 'scene_smoke' })).data;
  expect(await patch(sceneNow.revision, 'performer', {})).toMatchObject({ ok: true });
  expect(await list()).toMatchObject({ unknown: [] });
  expect((await list()).materials[0].parameters.some((view: object) => 'value' in view)).toBe(false);
  const catalog = JSON.parse(((await client.readResource({ uri: 'opensekai://blueprint-nodes' })).contents[0] as { text: string }).text);
  expect(catalog.nodes.map((node: { type: string }) => node.type)).toEqual(expect.arrayContaining(['character.setMaterialProperty', 'character.resetMaterialProperty', 'prop.setMaterialProperty', 'prop.resetMaterialProperty']));
  expect(catalog.materialParameters.find((spec: { key: string }) => spec.key === 'opacity')).toEqual({ key: 'opacity', label: 'Opacity', type: 'number', range: [0, 1], default: 1, profiles: ['mtoon', 'pbr', 'unlit'], requires: 'blend' });
  expect(catalog.materialParameters.find((spec: { key: string }) => spec.key === 'outlineColor')).toMatchObject({ profiles: ['mtoon'], requires: 'outline' });
 } finally { await client.close(); }
}, 20000);
