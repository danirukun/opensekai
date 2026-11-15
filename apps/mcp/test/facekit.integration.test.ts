import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// B33: the MCP to app protocol boundary. scene_patch takes a FaceKit source through the shared contract schema, as a face source only.
it('adds a FaceKit source, refuses it as a body source, and names it in scene_patch', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
 const patch = (expectedRevision: number, operations: unknown[]) => client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision, operations } });
 try {
  expect((await client.listTools()).tools.find(tool => tool.name === 'scene_patch')?.description).toContain('FaceKit');
  expect((await patch(0, [{ kind: 'createEntity', entity: { id: 'facekit', name: 'FaceKit Tracker', visible: true, transform, kind: 'tracking', generation: 0, config: { kind: 'facekit', enabled: false, deviceId: '' } } }])).structuredContent).toMatchObject({ ok: true, data: { revision: 1 } });
  const body = await patch(1, [{ kind: 'setAvatarTracking', entityId: 'performer', tracking: { bodySourceId: 'facekit', faceSourceId: null } }]);
  expect(body.structuredContent).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 } finally { await client.close(); }
}, 15000);
