import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { importBlueprint, keystrokeAccelerator, makeSmokeScene, type InputUpdate } from '@opensekai/contracts';
import { createSession, sessionApi } from '../src';

const load = (name: string) => readFileSync(new URL(`../../../fixtures/blueprints/${name}.json`, import.meta.url), 'utf8');
const key = (code: string): InputUpdate => ({ events: [{ kind: 'keystroke', accelerator: keystrokeAccelerator({ code: code as 'KeyH', control: true, alt: true, shift: false, meta: false }) }] });

function start(...files: string[]) {
 const session = createSession(makeSmokeScene(), 'files');
 let n = 0;
 const imported = files.map(file => {
  const result = importBlueprint(load(file), session.inspect(), () => `${file}-${++n}`);
  if (!result.ok) throw new Error(result.error.message);
  const edit = session.editBlueprints({ clientId: 'test', batchId: `batch-${n}`, ops: [{ kind: 'createGraph', graph: result.data.graph }] });
  if (!edit.ok) throw new Error(edit.error.message);
  return { ...result.data, edit: edit.data };
 });
 let now = 0;
 const tick = (ms = 16, input?: InputUpdate) => { now += ms; return session.advance(now, now, input); };
 const ticks = (count: number, input?: InputUpdate) => { let frame = tick(16, input); for (let i = 1; i < count; i++) frame = tick(16, input); return frame; };
 const entity = (id: string) => session.inspect().entities.find(item => item.id === id)!;
 const camera = () => session.inspect().outputs.find(item => item.id === 'preview_main')!.cameraId;
 return { session, imported, tick, ticks, entity, camera };
}

it('nudge sets the position after a run and commits it 250 ms later', () => {
 const { session, imported, ticks, entity } = start('nudge');
 ticks(1);
 expect(session.runBlueprint(imported[0]!.graph.id, 'run').ok).toBe(true);
 expect(entity('reference').transform.position).toEqual([0.9, 0.7, 0]);
 ticks(20);
 expect(entity('reference').transform.position).toEqual([0.2, 1.1, -0.5]);
});

it('drift moves while enabled without a commit, and commits after it is disabled', () => {
 const { session, imported, ticks, entity } = start('drift');
 const revision = session.inspect().revision;
 const frame = ticks(60);
 expect(session.inspect().revision).toBe(revision);
 expect(entity('reference').transform.position).toEqual([0.9, 0.7, 0]);
 const shown = frame.scene.entities.find(item => item.id === 'reference')!.transform.position[0];
 expect(shown - 0.9).toBeGreaterThan(0.5 * 0.016 * 58);
 expect(shown - 0.9).toBeLessThan(0.5 * 0.016 * 60);
 expect(session.editBlueprints({ clientId: 'test', batchId: 'off', ops: [{ kind: 'updateGraph', graphId: imported[0]!.graph.id, enabled: false }] }).ok).toBe(true);
 ticks(20);
 expect(session.inspect().revision).toBe(revision + 1);
 expect(entity('reference').transform.position[0]).toBeCloseTo(shown, 6);
});

it('wasd moves the character forward while W is held and reports its held keys', () => {
 const { imported, ticks, entity } = start('wasd');
 expect([...(imported[0]!.edit.heldKeys ?? [])].sort()).toEqual(['KeyA', 'KeyD', 'KeyS', 'KeyW']);
 ticks(1);
 ticks(30, { held: ['KeyW'] });
 ticks(20);
 const [x, , z] = entity('performer').transform.position;
 expect(x).toBeCloseTo(0, 6);
 expect(z).toBeGreaterThan(1.5 * 0.016 * 28);
});

it('camera-flip and counter switch the preview camera on each keystroke', () => {
 const flip = start('camera-flip');
 expect(flip.imported[0]!.edit.keystrokes).toContain('Control+Alt+KeyH');
 flip.tick(16, key('KeyH'));
 expect(flip.camera()).toBe('camera_close');
 flip.tick(16, key('KeyH'));
 expect(flip.camera()).toBe('camera_wide');
 const counter = start('counter');
 counter.tick(16, key('KeyJ'));
 expect(counter.camera()).toBe('camera_close');
 counter.tick(16, key('KeyJ'));
 expect(counter.camera()).toBe('camera_wide');
});

it('renamed-ids runs against the entity found by name', () => {
 const { session, imported, ticks, entity } = start('renamed-ids');
 expect(imported[0]!.report.remapped).toEqual([{ name: 'reference', kind: 'mesh', from: 'old-reference', to: 'reference' }]);
 ticks(1);
 expect(session.runBlueprint(imported[0]!.graph.id, 'run').ok).toBe(true);
 ticks(20);
 expect(entity('reference').transform.position).toEqual([0.2, 1.1, -0.5]);
});

it('missing-ref is stored disabled and cannot run', () => {
 const { session, imported } = start('missing-ref');
 const stored = session.inspectBlueprints();
 expect(stored.kind === 'snapshot' && stored.blueprints[0]!.enabled).toBe(false);
 expect(session.runBlueprint(imported[0]!.graph.id, 'run').ok).toBe(false);
});

it('the same file imported two times gives two graphs that both run', () => {
 const { session, imported, ticks } = start('nudge', 'nudge');
 expect(new Set(imported.map(item => item.graph.id)).size).toBe(2);
 ticks(1);
 for (const item of imported) expect(session.runBlueprint(item.graph.id, 'run').ok).toBe(true);
});

it('sessionApi answers the session commands', async () => {
 const { session } = start();
 const api = sessionApi(session);
 expect(await api.sceneInspect({ sceneId: 'scene_smoke' })).toMatchObject({ ok: true, data: { sceneId: 'scene_smoke' } });
 expect(await api.sceneInspect({ sceneId: 'other' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(await api.blueprintInspect({})).toMatchObject({ ok: true, data: { kind: 'snapshot', blueprints: [] } });
});
