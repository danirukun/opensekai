import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Real MCP stdio process and real session: a VMC sender goes through scene_patch, the same validated route as the editor (B21 R16).
it('creates, starts, limits, and unlinks a VMC sender through scene_patch, and app_status lists it', async () => {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
 const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
 await client.connect(transport);
 const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
 const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
 const vmcSender = { enabled: false, address: '127.0.0.1', port: 39539, avatarId: 'performer' };
 const sender = (id: string) => ({ id, name: 'VMC Sender', visible: true, transform, kind: 'vmcSender', vmcSender });
 const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
 const senderOf = async (id: string) => (await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities.find((e: { id: string }) => e.id === id);
 try {
  const tools = await client.listTools();
  expect(tools.tools.find(tool => tool.name === 'scene_patch')?.description).toMatch(/vmcSender.*at most 4 VMC senders.*enabled false.*setVmcSender/s);
  expect(tools.tools.find(tool => tool.name === 'app_status')?.description).toMatch(/vmcSenders/);
  expect(await patch(0, [1, 2, 3, 4].map(i => ({ kind: 'createEntity', entity: sender(`vmc_${i}`) })))).toMatchObject({ ok: true, data: { revision: 1 } });
  expect(await patch(1, [{ kind: 'createEntity', entity: sender('vmc_5') }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  const started = { ...vmcSender, enabled: true, address: '192.168.1.40', port: 40000 };
  expect(await patch(1, [{ kind: 'setVmcSender', entityId: 'vmc_1', vmcSender: started }])).toMatchObject({ ok: true, data: { revision: 2 } });
  expect(await senderOf('vmc_1')).toMatchObject({ kind: 'vmcSender', vmcSender: started });
  expect(await patch(2, [{ kind: 'setVmcSender', entityId: 'performer', vmcSender }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['performer'] } });
  expect((await client.callTool({ name: 'scene_patch', arguments: { sceneId: 'scene_smoke', expectedRevision: 2, operations: [{ kind: 'setVmcSender', entityId: 'vmc_1', vmcSender: { ...vmcSender, address: '239.0.0.1' } }] } })).isError).toBe(true);
  const status = await call('app_status', {});
  expect(status.data.vmcSenders).toEqual([
   { entityId: 'vmc_1', state: 'waiting', datagrams: 0, errors: 0, error: null },
   ...[2, 3, 4].map(i => ({ entityId: `vmc_${i}`, state: 'stopped', datagrams: 0, errors: 0, error: null })),
  ]);
  expect(await patch(2, [{ kind: 'removeEntity', entityId: 'performer' }])).toMatchObject({ ok: true, data: { revision: 3 } });
  expect(await senderOf('vmc_1')).toMatchObject({ vmcSender: { ...started, avatarId: null } });
 } finally { await client.close(); }
}, 15000);
