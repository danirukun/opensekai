import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: video content and playback control go through scene_patch, the same validated route as the editor (B29 R21).
it('lists a video, creates and plays a video screen in one patch, and pauses it without a revision change', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 const control = (action: string) => ({ kind: 'controlScreenVideo', entityId: 'tv', action });
 try {
  const tools = (await client.listTools()).tools;
  expect(tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/kind screen and content {kind: video.*at most 4 video screens.*setScreenVideo.*controlScreenVideo.*with only controlScreenVideo does not change the revision/s);
  expect(tools.find(tool => tool.name === 'asset_list')?.description).toContain('setScreenVideo');
  const video = (await call('asset_list', {})).data.assets.find((a: { kind: string }) => a.kind === 'video');
  expect(video).toEqual({ id: 'video_loop', kind: 'video', name: 'Loop' });
  const screen = { id: 'tv', name: 'Screen', visible: true, transform: { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'screen', content: { kind: 'video', assetId: video.id, autoPlay: false, loop: true, volume: 0.5 } };
  expect(await patch(0, [{ kind: 'createEntity', entity: screen }, control('play')])).toMatchObject({ ok: true, data: { revision: 1 } });
  expect((await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities.find((e: { id: string }) => e.id === 'tv')).toMatchObject({ content: { kind: 'video', assetId: 'video_loop', autoPlay: false, loop: true, volume: 0.5 } });
  // A control-only patch with an old expected revision: no commit, the current revision in the reply.
  expect(await patch(0, [control('pause')])).toMatchObject({ ok: true, data: { revision: 1 } });
  expect((await call('scene_inspect', { sceneId: 'scene_smoke' })).data.revision).toBe(1);
  expect(await patch(1, [{ kind: 'controlScreenVideo', entityId: 'performer', action: 'play' }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['performer'] } });
  expect(await patch(1, [{ kind: 'setScreenVideo', entityId: 'tv', video: { assetId: null, autoPlay: true, loop: false, volume: 1 } }])).toMatchObject({ ok: true, data: { revision: 2 } });
 } finally { await client.close(); }
}, 15000);
