import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: the output format goes through scene_patch, the same validated route as the editor (B22 R14).
it('changes the OBS output format through scene_patch and refuses preview_main and 4K', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const format = (outputId: string, width: number, height: number, fps: number, renderScale: number) => ({ kind: 'setOutputFormat', outputId, width, height, fps, renderScale });
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 try {
  const tools = await client.listTools();
  expect(tools.tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/setOutputFormat.*only output_main changes.*1280 x 720.*30 or 60.*0\.5, 0\.75, or 1/s);
  expect(await patch(0, [format('output_main', 1280, 720, 30, 0.75)])).toMatchObject({ ok: true, data: { revision: 1 } });
  const outputs = (await call('scene_inspect', { sceneId: 'scene_smoke' })).data.outputs;
  expect(outputs.find((o: { id: string }) => o.id === 'output_main')).toMatchObject({ width: 1280, height: 720, fps: 30, renderScale: 0.75 });
  expect(outputs.find((o: { id: string }) => o.id === 'preview_main')).toEqual(expect.objectContaining({ width: 1920, height: 1080, fps: 60 }));
  expect(await patch(1, [format('preview_main', 1280, 720, 30, 0.75)])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['preview_main'] } });
  expect((await client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision: 1, operations: [format('output_main', 3840, 2160, 60, 1)] } })).isError).toBe(true);
  expect((await call('scene_inspect', { sceneId: 'scene_smoke' })).data.revision).toBe(1);
 } finally { await client.close(); }
}, 15000);
