import { expect, it } from 'vitest';
import { makeSmokeScene } from '@opensekai/contracts';
import { createSession } from '../src/session';

it('replaces a show scene atomically while keeping the session clock and missing asset references', () => {
 const session = createSession(makeSmokeScene(), 'live-session');
 const first = session.advance(100);
 const next = makeSmokeScene();
 next.sceneId = 'imported-scene';
 next.entities.find(entity => entity.kind === 'avatar')!.assetId = 'missing-avatar-id';
 next.entities.find(entity => entity.id === 'marker')!.visible = false;
 expect(session.replaceScene(next, 0)).toMatchObject({ ok: true, data: { sceneId: 'imported-scene', revision: 1 } });
 const frame = session.advance(200);
 expect(frame.sessionId).toBe(first.sessionId);
 expect(frame.sequence).toBe(first.sequence + 1);
 expect(frame.scene.entities.find(entity => entity.id === 'marker')?.visible).toBe(false);
 expect((frame.scene.entities.find(entity => entity.kind === 'avatar') as { assetId: string }).assetId).toBe('missing-avatar-id');
});

it('rejects stale or invalid replacement without changing the live scene', () => {
 const session = createSession(makeSmokeScene(), 'live-session');
 const initial = session.inspect();
 const bad = makeSmokeScene();
 bad.outputs = bad.outputs.filter(output => output.id !== 'preview_main');
 expect(session.replaceScene(bad, 0)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(session.replaceScene(initial, 1)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
 expect(session.inspect()).toEqual(initial);
});
