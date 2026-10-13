import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const load = (name: string) => JSON.parse(readFileSync(`fixtures/blueprints/${name}.json`, 'utf8'));
async function connect(scene?: 'twin') {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], env: { ...process.env, ...(scene ? { OPENSEKAI_FIXTURE_SCENE: scene } : {}) } as Record<string, string>, stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 return { client, call };
}

it('imports and exports Blueprint files through MCP', async () => {
 const { client, call } = await connect();
 try {
  const nudge = load('nudge');
  const imported = await call('blueprint_import', { sceneId: 'scene_smoke', file: nudge });
  expect(imported).toMatchObject({ ok: true, data: { revision: 1, report: { enabled: true, remapped: [], missing: [] } } });
  const graphId = imported.data.report.graphId;
  const exported = await call('blueprint_export', { sceneId: 'scene_smoke', graphId });
  expect(exported).toEqual({ ok: true, data: { file: { ...nudge, graph: { ...nudge.graph, id: graphId } } } });
  expect(await call('blueprint_export', { sceneId: 'scene_smoke', graphId: 'nope' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  expect(await call('blueprint_import', { sceneId: 'scene_smoke', file: load('missing-ref') })).toMatchObject({ ok: true, data: { report: { enabled: false, missing: [{ name: 'Ghost' }] } } });
  expect(await call('blueprint_import', { sceneId: 'scene_smoke', file: load('future-version') })).toMatchObject({ ok: false, error: { code: 'VERSION_MISMATCH' } });
  expect(await call('blueprint_import', { sceneId: 'scene_smoke', file: load('unknown-node') })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED', message: 'Unknown node types: character.wave' } });
  expect(await call('blueprint_import', { sceneId: 'scene_smoke', file: load('warudo-shaped') })).toMatchObject({ ok: false, error: { message: 'Not an OpenSekai Blueprint file' } });
  expect(await call('blueprint_import', { sceneId: 'other', file: nudge })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  for (let i = 0; i < 6; i++) expect((await call('blueprint_import', { sceneId: 'scene_smoke', file: nudge })).ok).toBe(true);
  expect((await call('blueprint_import', { sceneId: 'scene_smoke', file: nudge })).ok).toBe(false);
 } finally { await client.close(); }
}, 15000);

it('reports an ambiguous name as missing', async () => {
 const { client, call } = await connect('twin');
 try {
  expect(await call('blueprint_import', { sceneId: 'scene_smoke', file: load('ambiguous-ref') })).toMatchObject({ ok: true, data: { report: { enabled: false, missing: [{ name: 'camera_wide', kind: 'camera', id: 'old-camera' }] } } });
 } finally { await client.close(); }
}, 15000);
