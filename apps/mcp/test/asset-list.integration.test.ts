import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session (#155). The fixture answers assetList as the host does; the Rust
// asset service test covers the host answer.
it('lists asset records and sets an environment model with a listed ID', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 try {
  const listed = await call('asset_list', {});
  expect(listed).toMatchObject({ ok: true, data: { next: null } });
  const scene = listed.data.assets.find((a: { kind: string }) => a.kind === 'scene');
  expect(scene).toMatchObject({ id: 'scene_room', name: 'Room', credits: { author: 'Ada' } });
  expect((await client.callTool({ name: 'asset_list', arguments: { after: '' } })).isError).toBe(true);
  const environment = { kind: 'environment', id: 'environment', name: 'Environment', visible: true, assetId: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } };
  expect(await call('scene_patch', { sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'createEntity', entity: environment }, { kind: 'setEnvironmentModel', entityId: 'environment', assetId: scene.id }] })).toMatchObject({ ok: true, data: { revision: 1 } });
  const inspected = await call('scene_inspect', { sceneId: 'scene_smoke' });
  expect(inspected.data.entities.find((e: { id: string }) => e.id === 'environment')).toMatchObject({ kind: 'environment', assetId: 'scene_room' });
 } finally { await client.close(); }
}, 15000);
