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
// Real MCP stdio process and real session: a spot light beam goes through setLight, and a point light beam is rejected (stage beams R4, R27).
it('sets a spot light beam through scene_patch and rejects a point light beam', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const transform = { position: [0, 3, 2], rotation: [-0.382683, 0, 0, 0.92388], scale: [1, 1, 1] };
 const spot = { type: 'spot', color: '#ffffff', intensity: 60, range: 15, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 }, cone: { angleDegrees: 40, penumbra: 0.3 }, volumetric: true };
 const beam = { enabled: true, intensity: 2, softness: 0.25 };
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 try {
  const tools = await client.listTools();
  expect(tools.tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/beam \{enabled; intensity 0 to 4; softness 0 to 1\}/);
  expect(await patch(0, [{ kind: 'createEntity', entity: { id: 'spot', name: 'Spot Light', visible: true, transform, kind: 'light', light: spot } }])).toMatchObject({ ok: true, data: { revision: 1 } });
  expect(await patch(1, [{ kind: 'setLight', entityId: 'spot', light: { ...spot, beam } }])).toMatchObject({ ok: true, data: { revision: 2 } });
  const entities = (await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities;
  expect(entities.find((e: { id: string }) => e.id === 'spot')).toMatchObject({ kind: 'light', light: { beam } });
  const { cone: _, ...point } = { ...spot, type: 'point', beam };
  // The tool input schema rejects the light before the session, as it rejects a spot light without a cone.
  expect(await client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision: 2, operations: [{ kind: 'setLight', entityId: 'spot', light: point }] } })).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('Only a spot light has a beam') }] });
  expect((await call('scene_inspect', { sceneId: 'scene_smoke' })).data.revision).toBe(2);
 } finally { await client.close(); }
}, 15000);
// Real MCP stdio process and real session: the camera effects go through scene_patch, and a light refuses them (camera effects R33).
it('sets and removes the camera effects through scene_patch and rejects them on a light', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const transform = { position: [0, 3, 2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
 const point = { type: 'point', color: '#ffffff', intensity: 60, range: 15, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 }, volumetric: false };
 const effects = { lensDirt: { assetId: null, intensity: 0.9, threshold: 0.5 }, vignetting: { enabled: true, color: '#4c4c4c', alpha: 0.4, fadeOut: 0.2, blink: 0 }, blur: { enabled: true, intensity: 2 }, pixelate: { enabled: false, intensity: 16 } };
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 const camera = async () => (await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities.find((e: { id: string }) => e.id === 'camera_wide');
 try {
  const tools = await client.listTools();
  expect(tools.tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/setCameraEffects \{entityId, effects\}/);
  expect(await patch(0, [{ kind: 'setCameraEffects', entityId: 'camera_wide', effects }])).toMatchObject({ ok: true, data: { revision: 1 } });
  expect(await camera()).toMatchObject({ kind: 'camera', effects });
  expect(await patch(1, [{ kind: 'createEntity', entity: { id: 'lamp', name: 'Point Light', visible: true, transform, kind: 'light', light: point } }])).toMatchObject({ ok: true, data: { revision: 2 } });
  expect(await patch(2, [{ kind: 'setCameraEffects', entityId: 'lamp', effects }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['lamp'] } });
  expect(await patch(2, [{ kind: 'setCameraEffects', entityId: 'camera_wide', effects: null }])).toMatchObject({ ok: true, data: { revision: 3 } });
  expect(await camera()).not.toHaveProperty('effects');
 } finally { await client.close(); }
}, 15000);
