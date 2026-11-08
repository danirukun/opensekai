import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: each thin tool compiles one intent and applies it with proposalApply (R17).
// The repeat light_setup and blueprint_build replace what they made, so their expectations must match the session fingerprints.
it('builds a concert scene with thin tools', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const sceneId = 'scene_smoke';
 const refOf = (text: string, pattern: RegExp) => text.split('\n').find(line => pattern.test(line))?.split(' ')[0];
 try {
  const summary = await call('scene_summary', { sceneId, prompt: 'a concert stage' });
  expect(summary.ok).toBe(true);
  expect(summary.data.text).toMatch(/^@e\d+ /m);
  const avatar = refOf(summary.data.text, /· avatar$/)!;
  expect(avatar).toMatch(/^@e\d+$/);

  const lights = [];
  let revision = 0;
  for (const role of ['key', 'fill', 'rim']) {
   const reply = await call('light_setup', { sceneId, role, target: avatar });
   expect(reply).toMatchObject({ ok: true });
   expect(reply.data.revision).toBeGreaterThan(revision);
   expect(reply.data.created).toHaveLength(1);
   revision = reply.data.revision;
   lights.push(reply.data.created[0]);
  }
  expect(new Set(lights).size).toBe(3);
  // A touched entity: the session fingerprint of the existing light equals the one the tool read.
  const rekey = await call('light_setup', { sceneId, role: 'key', target: avatar, color: 'purple', replace: lights[0] });
  expect(rekey).toMatchObject({ ok: true, data: { created: [], notes: [{ code: 'replacedExisting', ref: lights[0] }] } });
  expect(rekey.data.revision).toBeGreaterThan(revision);

  expect(await call('haze_set', { sceneId, density: 'medium' })).toMatchObject({ ok: true });
  const camera = await call('camera_add', { sceneId, framing: 'closeUp', target: avatar });
  expect(camera).toMatchObject({ ok: true, data: { created: [expect.stringMatching(/^@e\d+$/)] } });
  const cameraRef = camera.data.created[0];
  const move = await call('camera_move', { sceneId, camera: cameraRef, target: avatar, kind: 'orbit', angleDegrees: 90, duration: 'slow', endFraming: 'closeUp' });
  // Play ran after the apply (no playFailed), and the target is explicit (no targetDefaulted).
  expect(move).toMatchObject({ ok: true, data: { created: [expect.stringMatching(/^@b\d+$/)], notes: [] } });
  const graphs = await call('blueprint_inspect', {});
  expect(graphs.data.blueprints.some((g: { nodes: { type: string }[] }) => g.nodes.some(n => n.type === 'event.manual'))).toBe(true);

  expect(await call('output_camera', { sceneId, camera: cameraRef })).toMatchObject({ ok: true });
  const scene = await call('scene_inspect', { sceneId });
  const added = scene.data.entities.filter((e: { kind: string; id: string }) => e.kind === 'camera' && !['camera_wide', 'camera_close'].includes(e.id));
  expect(added).toHaveLength(1);
  expect(scene.data.outputs[0].cameraId).toBe(added[0].id);

  expect(await call('look_up', { sceneId, ref: lights[0] })).toMatchObject({ ok: true, data: { text: expect.stringContaining('spot') } });
  expect(await call('ask', { question: 'Which color for the rim light?', choices: ['Purple', 'Blue'] })).toMatchObject({ ok: true, data: { question: 'Which color for the rim light?', choices: ['Purple', 'Blue'] } });
  expect(await call('camera_add', { sceneId, framing: 'wide', target: '@e999' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['@e999'] } });

  // A touched Blueprint: the graph that this process made is replaced through its @b reference.
  const build = await call('blueprint_build', { sceneId, name: 'Wide shot', trigger: { kind: 'hotkey', key: 'Control+Shift+W' }, actions: [{ kind: 'switchCamera', camera: cameraRef }] });
  expect(build).toMatchObject({ ok: true, data: { created: [expect.stringMatching(/^@b\d+$/)] } });
  const rebuild = await call('blueprint_build', { sceneId, name: 'Wide shot', trigger: { kind: 'manual' }, actions: [{ kind: 'switchCamera', camera: cameraRef }, { kind: 'wait', length: 'short' }], replace: build.data.created[0] });
  expect(rebuild).toMatchObject({ ok: true, data: { created: [], notes: [{ code: 'replacedExisting', ref: build.data.created[0] }] } });
  const rebuilt = (await call('blueprint_inspect', {})).data.blueprints.filter((g: { name: string }) => g.name === 'Wide shot');
  expect(rebuilt).toHaveLength(1);
  expect(rebuilt[0].nodes.map((n: { type: string }) => n.type)).toEqual(['event.manual', 'camera.switch', 'flow.delay']);
  // A hotkey without Control, Alt, or Meta is not an accelerator.
  expect(await call('blueprint_build', { sceneId, name: 'Bad key', trigger: { kind: 'hotkey', key: 'Shift+W' }, actions: [{ kind: 'wait', length: 'short' }] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

  const tools = (await client.listTools()).tools;
  expect(tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/^Apply ordered scene operations at an expected revision\..*setHiddenMeshes/s);
  expect(tools.find(tool => tool.name === 'blueprint_build')?.description).toMatch(/Control, Alt, or Meta/);
 } finally { await client.close(); }
}, 20000);
