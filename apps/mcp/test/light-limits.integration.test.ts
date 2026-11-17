import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { LIGHT_BUDGET_MESSAGES as M, makeSmokeScene } from '@opensekai/contracts';

// Real MCP stdio process and real session: the light limits and their messages go through the same validated route as the editor (light limits R5, R16).
const connect = async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 return { client, call };
};
const shadow = { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 };
const off = { affectCharacters: false, affectProps: false, affectEnvironment: false };
const settings = (patch: Record<string, unknown> = {}) => ({ type: 'point', color: '#ffffff', intensity: 3, range: 10, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow, ...patch });
const light = (id: string, patch: Record<string, unknown> = {}) => ({ id, name: 'Light', visible: true, transform: { position: [0, 3, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'light', light: settings(patch) });
const create = (entity: unknown) => ({ kind: 'createEntity', entity });
const refused = (message: string) => ({ ok: false, error: { code: 'INVALID_INPUT', message } });

it('refuses a ninth lit light, a 33rd light, and an affect flag on at 8 lit lights with their messages', async () => {
 const { client, call } = await connect();
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 const inspect = async () => (await call('scene_inspect', { sceneId: 'scene_smoke' })).data;
 try {
  const tools = await client.listTools();
  expect(tools.tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/at most 32 lights; at most 8 can have an affect flag on/);
  expect(await patch(0, Array.from({ length: 8 }, (_, i) => create(light(`lit_${i}`))))).toMatchObject({ ok: true, data: { revision: 1 } });
  expect(await patch(1, Array.from({ length: 24 }, (_, i) => create(light(`unlit_${i}`, off))))).toMatchObject({ ok: true, data: { revision: 2 } });
  const before = await inspect();
  expect(before.entities.filter((e: { kind: string }) => e.kind === 'light')).toHaveLength(32);
  for (const [operations, message] of [
   [[{ kind: 'removeEntity', entityId: 'unlit_0' }, create(light('ninth'))], M.litLights],
   [[create(light('extra', off))], M.lights],
   [[{ kind: 'setLight', entityId: 'unlit_1', light: settings({ ...off, affectEnvironment: true }) }], M.litLights],
  ] as const) {
   expect(await patch(2, [...operations])).toMatchObject(refused(message));
   expect(await inspect()).toEqual(before);
  }
 } finally { await client.close(); }
}, 15000);

it('refuses a scene replace with 9 lit lights and replaces the scene with the Stage Rig scene', async () => {
 const { client, call } = await connect();
 try {
  const nine = makeSmokeScene();
  nine.entities.push(...Array.from({ length: 9 }, (_, i) => light(`lit_${i}`)) as never[]);
  // The MCP SDK checks the tool input schema before the handler, so the refusal is a tool error whose text has the message.
  expect(await client.callTool({ name: 'scene_replace', arguments: { scene: nine, expectedRevision: 0 } })).toMatchObject({ isError: true, content: [{ text: expect.stringContaining(M.litLights) }] });
  expect((await call('scene_inspect', { sceneId: 'scene_smoke' })).data.revision).toBe(0);
  const rig = JSON.parse(readFileSync(new URL('../../../fixtures/shows/stage-rig.osekai', import.meta.url), 'utf8'));
  expect(await call('scene_replace', { scene: rig.scene, expectedRevision: 0 })).toMatchObject({ ok: true });
  const lights = (await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities.filter((e: { kind: string }) => e.kind === 'light');
  expect(lights).toHaveLength(32);
 } finally { await client.close(); }
}, 15000);
