import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process against the TypeScript fixture host (B25 R17). It checks only the tool mapping and the validation;
// the host behavior (link parsing, the client, the settings file) is in the Rust integration test, youtube_integration.rs.
it('maps youtube_link_set to integrationsSet, validates the link shape, and app_status returns youtube', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 try {
  const tool = (await client.listTools()).tools.find(item => item.name === 'youtube_link_set');
  expect(tool?.description).toMatch(/@handle.*null or an empty link disconnects/s);
  expect(tool?.inputSchema).toMatchObject({ type: 'object', properties: { link: {} }, required: ['link'] });
  const link = 'https://www.youtube.com/@fixture';
  expect(await call('youtube_link_set', { link })).toEqual({ ok: true, data: { link, state: 'waiting', error: null, videoId: null, items: 0, skipped: 0, redemptions: 0, dropped: 0 } });
  expect((await call('app_status', {})).data.youtube).toMatchObject({ link, state: 'waiting' });
  for (const args of [{ link: 'x'.repeat(2049) }, { link: 42 }, { link, extra: true }, {}])
   expect((await client.callTool({ name: 'youtube_link_set', arguments: args })).isError, JSON.stringify(args).slice(0, 40)).toBe(true);
  expect((await call('app_status', {})).data.youtube.link).toBe(link);
  expect(await call('youtube_link_set', { link: null })).toMatchObject({ ok: true, data: { link: null, state: 'notConnected' } });
  // The Blueprint tools list the new node types through the catalog.
  const catalog = await client.readResource({ uri: 'opensekai://blueprint-nodes' });
  const text = (catalog.contents[0] as { text: string }).text;
  expect(JSON.parse(text).categories).toContain('YouTube');
  expect(text).toContain('youtube.superChat');
 } finally {
  await client.close();
 }
});
