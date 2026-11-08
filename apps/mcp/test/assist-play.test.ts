import { expect, it } from 'vitest';
import { makeSmokeScene } from '@opensekai/contracts';
import { emptyRefs } from '@opensekai/assist';
import { runIntent } from '../src/assist-tools';
import { sessionFixtureApi } from './session-fixture';

it('keeps an applied camera move and notes a failed Play run', async () => {
 const api = { ...sessionFixtureApi(makeSmokeScene()), blueprintRun: async () => ({ ok: false as const, error: { code: 'FORBIDDEN' as const, message: 'Capability denied', ids: [] } }) };
 const state = { refs: emptyRefs() };
 const camera = await runIntent(api, state, 'scene_smoke', { tool: 'camera_add', framing: 'closeUp' });
 if (!camera.ok) throw new Error(camera.error.message);
 const move = await runIntent(api, state, 'scene_smoke', { tool: 'camera_move', camera: camera.data.created[0]!, kind: 'pushIn' });
 expect(move).toMatchObject({ ok: true, data: { created: [expect.stringMatching(/^@b\d+$/)] } });
 expect(move.ok && move.data.notes).toContainEqual({ code: 'playFailed', ref: move.ok && move.data.created[0] });
});
