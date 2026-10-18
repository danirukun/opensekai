import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: spot lights and the haze go through scene_patch, the same validated route as the editor (B13 R6).
it('creates a spot light and a haze, changes the haze, and limits it to one through scene_patch', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const transform = { position: [0, 4, 0], rotation: [0, 0, 0, 1], scale: [20, 8, 20] };
 const spot = { type: 'spot', color: '#ffffff', intensity: 60, range: 15, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 }, cone: { angleDegrees: 40, penumbra: 0.3 }, volumetric: true };
 const haze = { density: 1, smoke: 1, intensity: 1, drift: 0.2 };
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 try {
  const tools = await client.listTools();
  expect(tools.tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/spot.*ambient.*setHaze/s);
  expect(await patch(0, [{ kind: 'createEntity', entity: { id: 'spot', name: 'Spot Light', visible: true, transform, kind: 'light', light: spot } }, { kind: 'createEntity', entity: { id: 'fog', name: 'Haze', visible: true, transform, kind: 'haze', haze } }])).toMatchObject({ ok: true, data: { revision: 1 } });
  const thick = { ...haze, density: 1.8, drift: 0.5 };
  expect(await patch(1, [{ kind: 'setHaze', entityId: 'fog', haze: thick }])).toMatchObject({ ok: true, data: { revision: 2 } });
  const entities = (await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities;
  expect(entities.find((e: { id: string }) => e.id === 'fog')).toMatchObject({ kind: 'haze', haze: thick });
  expect(entities.find((e: { id: string }) => e.id === 'spot')).toMatchObject({ kind: 'light', light: spot });
  expect(await patch(2, [{ kind: 'setHaze', entityId: 'spot', haze }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(await patch(2, [{ kind: 'createEntity', entity: { id: 'fog_2', name: 'Haze', visible: true, transform, kind: 'haze', haze } }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  const { cone: _, ...coneless } = spot;
  expect((await client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision: 2, operations: [{ kind: 'setLight', entityId: 'spot', light: coneless }] } })).isError).toBe(true);
 } finally { await client.close(); }
}, 15000);
