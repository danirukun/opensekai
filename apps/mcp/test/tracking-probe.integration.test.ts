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
