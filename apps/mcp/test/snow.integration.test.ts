import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { DEFAULT_SNOW } from '@opensekai/contracts';

// Real MCP stdio process and real session: the snow goes through scene_patch, the only control of this slice.
it('creates a snow and changes its rate through scene_patch', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'apps/mcp/test/session-fixture.ts'], stderr: 'pipe' });
    const client = new Client({ name: 'opensekai-test', version: '0.1.0' });
    await client.connect(transport);
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as { ok: boolean; data?: any; error?: any };
    const patch = (expectedRevision: number, operations: unknown[]) => call('scene_patch', { sceneId: 'scene_smoke', expectedRevision, operations });
    const snow = { id: 'snow_1', name: 'Snow', visible: true, transform: { position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [6, 4, 6] }, kind: 'snow', snow: { ...DEFAULT_SNOW } };
    try {
        expect(await patch(0, [{ kind: 'createEntity', entity: snow }])).toMatchObject({ ok: true, data: { revision: 1 } });
        expect(await patch(1, [{ kind: 'setSnow', entityId: 'snow_1', snow: { ...DEFAULT_SNOW, rate: 1 } }])).toMatchObject({ ok: true, data: { revision: 2 } });
        const entities = (await call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities;
        expect(entities.find((e: { id: string }) => e.id === 'snow_1')).toMatchObject({ kind: 'snow', snow: { rate: 1 } });
    } finally { await client.close(); }
}, 15000);
