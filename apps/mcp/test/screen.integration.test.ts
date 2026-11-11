import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: a screen goes through scene_patch, the same validated route as the editor (B28 R21).
it('lists an image, adds a screen with it, and clears it through scene_patch', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 const screen = { id: 'logo', name: 'Screen', visible: true, transform: { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'screen', content: { kind: 'image', assetId: null } };
 try {
  const tools = (await client.listTools()).tools;
  expect(tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/kind screen.*at most 16 screens.*setScreenImage/s);
  expect(tools.find(tool => tool.name === 'asset_list')?.description).toContain('setScreenImage');
  const image = (await call('asset_list', {})).data.assets.find((a: { kind: string }) => a.kind === 'image');
  expect(image).toEqual({ id: 'image_logo', kind: 'image', name: 'Logo' });
  expect(await patch(0, [{ kind: 'createEntity', entity: screen }, { kind: 'setScreenImage', entityId: 'logo', assetId: image.id }])).toMatchObject({ ok: true, data: { revision: 1 } });
  const find = async () => (await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities.find((e: { id: string }) => e.id === 'logo');
  expect(await find()).toMatchObject({ kind: 'screen', content: { kind: 'image', assetId: 'image_logo' } });
  expect(await patch(1, [{ kind: 'setScreenImage', entityId: 'performer', assetId: image.id }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['performer'] } });
  expect(await patch(1, [{ kind: 'setScreenImage', entityId: 'logo', assetId: null }])).toMatchObject({ ok: true, data: { revision: 2 } });
  expect(await find()).toMatchObject({ content: { kind: 'image', assetId: null } });
 } finally { await client.close(); }
}, 15000);

// B30 R15: a web screen goes through the same scene_patch route.
it('creates a web screen, sets its URL, and refuses a local URL through scene_patch', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 const web = { url: null, width: 1280, height: 720, onTop: false };
 const screen = { id: 'chat', name: 'Screen', visible: true, transform: { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'screen', content: { kind: 'web', ...web } };
 try {
  expect((await client.listTools()).tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/setScreenWeb.*https URL.*onTop true draws the page over the scene.*at most 4 web screens/s);
  expect(await patch(0, [{ kind: 'createEntity', entity: screen }])).toMatchObject({ ok: true, data: { revision: 1 } });
  expect(await patch(1, [{ kind: 'setScreenWeb', entityId: 'chat', web: { ...web, url: 'https://example.com/chat', onTop: true } }])).toMatchObject({ ok: true, data: { revision: 2 } });
  const find = async () => (await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities.find((e: { id: string }) => e.id === 'chat');
  expect(await find()).toMatchObject({ content: { kind: 'web', url: 'https://example.com/chat', width: 1280, height: 720, onTop: true } });
  // The input schema refuses the URL before the call reaches the session.
  expect((await client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision: 2, operations: [{ kind: 'setScreenWeb', entityId: 'chat', web: { ...web, url: 'https://127.0.0.1:4455/' } }] } })).isError).toBe(true);
  expect(await find()).toMatchObject({ content: { url: 'https://example.com/chat' } });
 } finally { await client.close(); }
}, 15000);

// B31 R19: a capture screen goes through the same scene_patch route. The host state notAllowed of a source
// that the operator did not allow is proved at the host boundary (apps/desktop/src-tauri/tests/capture_integration.rs),
// because this fixture has no Rust host.
it('creates a capture screen, sets its source, and refuses a third through scene_patch', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 const screen = (id: string) => ({ id, name: 'Screen', visible: true, transform: { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'screen', content: { kind: 'capture', target: 'display', source: null, cursor: true } });
 const source = { kind: 'window', app: 'com.example.chat', title: 'Chat' };
 try {
  const tools = (await client.listTools()).tools;
  expect(tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/setScreenCapture.*at most 2 capture screens.*Choose the source again/s);
  expect(tools.find(tool => tool.name === 'app_status')?.description).toMatch(/captures.*notAllowed/s);
  expect(await patch(0, [{ kind: 'createEntity', entity: screen('desk') }, { kind: 'setScreenCapture', entityId: 'desk', capture: { target: 'window', source, cursor: false } }])).toMatchObject({ ok: true, data: { revision: 1 } });
  const found = (await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities.find((e: { id: string }) => e.id === 'desk');
  expect(found).toMatchObject({ kind: 'screen', content: { kind: 'capture', target: 'window', source, cursor: false } });
  expect((await client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision: 1, operations: [{ kind: 'setScreenCapture', entityId: 'desk', capture: { target: 'display', source, cursor: true } }] } })).isError).toBe(true);
  expect(await patch(1, [{ kind: 'createEntity', entity: screen('c1') }, { kind: 'createEntity', entity: screen('c2') }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 } finally { await client.close(); }
}, 15000);
