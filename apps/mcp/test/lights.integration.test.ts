import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: lights go through scene_patch, the same validated route as the editor (R3).
it('creates, changes, inspects, and limits lights through scene_patch', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const light = { type: 'point', color: '#ffffff', intensity: 20, range: 10, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 } };
 const entity = (id: string) => ({ id, name: id, visible: true, transform: { position: [0, 2, 1], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'light', light });
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 try {
  const tools = await client.listTools();
  expect(tools.tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/setLight.*setEnvironmentReflections/s);
  expect(await patch(0, [{ kind: 'createEntity', entity: entity('lamp') }])).toMatchObject({ ok: true, data: { revision: 1 } });
  const warm = { ...light, color: '#ffaa55', intensity: 12, affectEnvironment: false };
  expect(await patch(1, [{ kind: 'setLight', entityId: 'lamp', light: warm }])).toMatchObject({ ok: true, data: { revision: 2 } });
  const inspected = await call('scene_inspect', { sceneId: 'scene_smoke' });
  expect(inspected.data.entities.find((e: { id: string }) => e.id === 'lamp')).toMatchObject({ kind: 'light', light: warm });
  expect(await patch(2, [{ kind: 'setLight', entityId: 'performer', light }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(await patch(2, Array.from({ length: 8 }, (_, i) => ({ kind: 'createEntity', entity: entity(`extra_${i}`) })))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect((await client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision: 2, operations: [{ kind: 'setLight', entityId: 'lamp', light: { ...light, color: 'orange' } }] } })).isError).toBe(true);
 } finally { await client.close(); }
}, 15000);
