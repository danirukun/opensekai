import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: calibrateTracking reaches the session through scene_patch, the same route as the editor (B6 R16).
it('names the B6 operations and returns the capture error for a source with no sample', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
 const patch = (expectedRevision: number, operations: unknown[]) => client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision, operations } });
 try {
  const description = (await client.listTools()).tools.find(tool => tool.name === 'scene_patch')?.description;
  for (const name of ['calibrateTracking', 'setTrackingCalibration', 'setTrackingMapping', 'fingersSourceId']) expect(description).toContain(name);
  expect((await patch(0, [{ kind: 'createEntity', entity: { id: 'phone', name: 'Phone', visible: true, transform, kind: 'tracking', generation: 0, config: { kind: 'ifacialmocap', enabled: true, bindAddress: '127.0.0.1', port: 49983, phoneAddress: null } } }])).structuredContent).toMatchObject({ ok: true, data: { revision: 1 } });
  const capture = await patch(1, [{ kind: 'calibrateTracking', entityId: 'phone' }]);
  expect(capture.isError).toBe(true);
  expect(capture.structuredContent).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['phone'] } });
  const mapping = { headIntensity: 1.5, headOffset: [0, 10, 0], eyeIntensity: 1, blendShapeSensitivity: 1, linkedBlink: true, blendShapes: { jawOpen: { inputMin: 0, inputMax: .8, outputMin: 0, outputMax: 1 } } };
  expect((await patch(1, [{ kind: 'setTrackingMapping', entityId: 'phone', mapping }, { kind: 'setTrackingCalibration', entityId: 'phone', calibration: { bones: { head: { rotation: [0, 0, 0, 1], space: 'raw' } } } }])).structuredContent).toMatchObject({ ok: true, data: { revision: 2 } });
  const scene = (await client.callTool({ name: 'scene_inspect', arguments: { sceneId: 'scene_smoke' } })).structuredContent as { data: { entities: { id: string; mapping?: unknown; calibration?: unknown }[] } };
  expect(scene.data.entities.find(entity => entity.id === 'phone')).toMatchObject({ mapping, calibration: { bones: { head: { space: 'raw' } } } });
 } finally { await client.close(); }
}, 15000);

// B20 R9: scene_patch takes an OpenSeeFace source through the shared contract schema, as a face source only.
it('adds an OpenSeeFace source and assigns it only to the face slot', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
 const patch = (expectedRevision: number, operations: unknown[]) => client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision, operations } });
 try {
  expect((await patch(0, [{ kind: 'createEntity', entity: { id: 'osf', name: 'OpenSeeFace Receiver', visible: true, transform, kind: 'tracking', generation: 0, config: { kind: 'openseeface', enabled: false, bindAddress: '127.0.0.1', port: 11573, senderAddress: null } } }])).structuredContent).toMatchObject({ ok: true, data: { revision: 1 } });
  const body = await patch(1, [{ kind: 'setAvatarTracking', entityId: 'performer', tracking: { bodySourceId: 'osf', faceSourceId: null } }]);
  expect(body.structuredContent).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect((await patch(1, [{ kind: 'setAvatarTracking', entityId: 'performer', tracking: { bodySourceId: null, faceSourceId: 'osf' } }])).structuredContent).toMatchObject({ ok: true, data: { revision: 2 } });
 } finally { await client.close(); }
}, 15000);
