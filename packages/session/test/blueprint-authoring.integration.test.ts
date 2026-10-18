import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { derivedId, importBlueprint, keystrokeAccelerator, makeSmokeScene, type BlueprintOp, type InputUpdate } from '@opensekai/contracts';
import { createSession } from '../src';

// Boundary: the session command API (`editBlueprints`, `inspectBlueprints`, `advance`) with the real store and runtime.
const load = (name: string) => readFileSync(new URL(`../../../fixtures/blueprints/${name}.json`, import.meta.url), 'utf8');
const keyJ: InputUpdate = { events: [{ kind: 'keystroke', accelerator: keystrokeAccelerator({ code: 'KeyJ', control: true, alt: true, shift: false, meta: false }) }] };
const comment = { id: 'c1', text: 'Counter', position: { x: -40, y: -60 }, size: { width: 600, height: 300 } };

function start() {
 const session = createSession(makeSmokeScene(), 'authoring');
 const imported = importBlueprint(load('counter'), session.inspect(), () => 'counter');
 if (!imported.ok) throw new Error(imported.error.message);
 let batch = 0, now = 0;
 const edit = (ops: BlueprintOp[]) => session.editBlueprints({ clientId: 'test', batchId: `b${++batch}`, ops });
 expect(edit([{ kind: 'createGraph', graph: imported.data.graph }]).ok).toBe(true);
 const tick = (input?: InputUpdate) => { now += 16; return session.advance(now, now, input); };
 const camera = () => session.inspect().outputs.find(item => item.id === 'preview_main')!.cameraId;
 const stored = () => { const reply = session.inspectBlueprints(); if (reply.kind !== 'snapshot') throw new Error('no snapshot'); return reply; };
 return { session, edit, tick, camera, stored };
}

it('stores comments and keeps the graph state through comment edits', () => {
 const { edit, tick, camera, stored } = start();
 tick(keyJ);
 expect(camera()).toBe('camera_close');
 expect(edit([{ kind: 'addComment', graphId: 'counter', comment }]).ok).toBe(true);
 expect(edit([{ kind: 'updateComment', graphId: 'counter', commentId: 'c1', text: 'Cut', position: { x: 0, y: 0 } }]).ok).toBe(true);
 // A reset would set the counter back to 0, and the next key would cut to camera_close again.
 tick(keyJ);
 expect(camera()).toBe('camera_wide');
 expect(stored().blueprints[0]!.comments).toEqual([{ ...comment, text: 'Cut', position: { x: 0, y: 0 } }]);
 expect(edit([{ kind: 'removeComment', graphId: 'counter', commentId: 'missing' }])).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});

it('duplicates a graph as a disabled copy with new IDs that compiles and runs once enabled', () => {
 const { edit, tick, camera, stored } = start();
 expect(edit([{ kind: 'addComment', graphId: 'counter', comment }, { kind: 'duplicateGraph', graphId: 'counter', newGraphId: 'copy' }]).ok).toBe(true);
 const [source, copy] = stored().blueprints;
 expect(copy).toMatchObject({ id: 'copy', name: 'Counter copy', enabled: false });
 expect(copy!.nodes.map(node => node.id)).toEqual(source!.nodes.map(node => derivedId('copy', node.id)));
 expect(copy!.comments!.map(item => item.id)).toEqual([derivedId('copy', 'c1')]);
 expect(edit([{ kind: 'updateGraph', graphId: 'copy', enabled: true }, { kind: 'updateGraph', graphId: 'counter', enabled: false }]).ok).toBe(true);
 tick(keyJ);
 expect(camera()).toBe('camera_close');
 expect(stored().errors).toEqual([]);
 for (let i = 0; i < 6; i++) expect(edit([{ kind: 'duplicateGraph', graphId: 'counter', newGraphId: `more-${i}` }]).ok).toBe(true);
 expect(edit([{ kind: 'duplicateGraph', graphId: 'counter', newGraphId: 'ninth' }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});
