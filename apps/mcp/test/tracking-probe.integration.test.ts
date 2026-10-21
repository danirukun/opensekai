import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: tracking_probe reads the smoothed values that the fixture feeds, on the same route as the editor.
it('tracking_probe returns values for a source that the fixture feeds', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], env: { ...process.env, OPENSEKAI_FIXTURE_TRACKING: '1' } as Record<string, string>, stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 try {
  expect((await client.listTools()).tools.find(tool => tool.name === 'tracking_probe')?.description).toContain('peaks');
  const live = await client.callTool({ name: 'tracking_probe', arguments: { sourceId: 'phone' } });
  expect(live.structuredContent).toMatchObject({ ok: true, data: { sourceId: 'phone', state: 'receiving', eyeBones: false } });
  const data = (live.structuredContent as { data: { values: Record<string, number>; presentChannels: string[] } }).data;
  expect(data.values.jawOpen).toBeCloseTo(.4, 6);
  expect(data.values.eyeBlinkLeft).toBeCloseTo(.2, 6);
  expect(data.presentChannels).toEqual(expect.arrayContaining(['jawOpen', 'eyeBlinkLeft']));
  const reset = await client.callTool({ name: 'tracking_probe', arguments: { sourceId: 'phone', resetPeaks: true } });
  expect(reset.structuredContent).toMatchObject({ ok: true, data: { peaks: { jawOpen: expect.any(Number) } } });
  expect((await client.callTool({ name: 'tracking_probe', arguments: { sourceId: 'phone' } })).structuredContent).toMatchObject({ data: { peaks: {} } });
  const missing = await client.callTool({ name: 'tracking_probe', arguments: { sourceId: 'nope' } });
  expect(missing.isError).toBe(true);
  expect(missing.structuredContent).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 } finally { await client.close(); }
}, 15000);

it('scene_patch fitBlendShapeRanges saves ranges from the run peaks, and fails after the peaks reset', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], env: { ...process.env, OPENSEKAI_FIXTURE_TRACKING: '1' } as Record<string, string>, stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 type Inspect = { data: { sceneId: string; revision: number; entities: { id: string; mapping?: { blendShapes: Record<string, { inputMin: number; inputMax: number }> } }[] } };
 const inspect = async () => (await client.callTool({ name: 'scene_inspect', arguments: { sceneId: 'scene_smoke' } })).structuredContent as Inspect;
 const fit = async (neutral: Record<string, number>) => client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision: (await inspect()).data.revision, operations: [{ kind: 'fitBlendShapeRanges', entityId: 'phone', neutral }] } });
 try {
  expect((await client.listTools()).tools.find(tool => tool.name === 'scene_patch')?.description).toContain('fitBlendShapeRanges');
  const before = (await inspect()).data.revision;
  expect((await fit({ eyeBlinkLeft: .2 })).structuredContent).toMatchObject({ ok: true, data: { revision: before + 1 } });
  const ranges = (await inspect()).data.entities.find(entity => entity.id === 'phone')!.mapping!.blendShapes;
  expect(Object.keys(ranges)).toEqual(['jawOpen']);
  expect(ranges.jawOpen!.inputMin).toBeCloseTo(.02, 6);
  expect(ranges.jawOpen!.inputMax).toBeCloseTo(.36, 6);
  await client.callTool({ name: 'tracking_probe', arguments: { sourceId: 'phone', resetPeaks: true } });
  const none = await fit({});
  expect(none.isError).toBe(true);
  expect(none.structuredContent).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'No blend shape rose above its neutral', ids: ['phone'] } });
 } finally { await client.close(); }
}, 15000);
