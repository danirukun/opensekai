import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { makeSmokeScene, type AppApi } from '@opensekai/contracts';
import { createSession } from '@opensekai/session';
import { createBlueprintSync } from '../src/blueprints/blueprint-sync';

const apiFor = (session: ReturnType<typeof createSession>): Pick<AppApi, 'blueprintEdit' | 'blueprintInspect'> => ({
 blueprintEdit: async batch => session.editBlueprints(batch),
 blueprintInspect: async ({ sinceRevision }) => ({ ok: true, data: session.inspectBlueprints(sinceRevision) }),
});
const setup = async () => {
 const session = createSession(makeSmokeScene(), 's');
 session.editBlueprints({ clientId: 'seed', batchId: 'seed', ops: [{ kind: 'replaceAll', graphs: fixture.blueprints as never }] });
 const a = createBlueprintSync(apiFor(session), 'a'), b = createBlueprintSync(apiFor(session), 'b');
 await a.load(); await b.load();
 return { session, a, b };
};
const wait = (g: ReturnType<ReturnType<typeof createBlueprintSync>['view']>, id: string) => g.find(x => x.id === 'flash-marker')!.nodes.find(n => n.id === id);

it('predicts a local edit at once and converges both clients through the journal', async () => {
 const { a, b } = await setup();
 a.edit([{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 5, y: 5 } }]);
 expect(wait(a.view(), 'wait')!.position).toEqual({ x: 5, y: 5 });
 await a.idle(); await b.pull();
 expect(b.view()).toEqual(a.view());
 expect(a.revision()).toBe(b.revision());
});

it('coalesces a drag into few batches', async () => {
 const { session, a } = await setup();
 const before = session.inspectBlueprints().revision;
 for (let i = 0; i < 50; i++) a.edit([{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: i, y: 0 } }]);
 await a.idle();
 expect(session.inspectBlueprints().revision - before).toBeLessThanOrEqual(2);
 expect(wait(a.view(), 'wait')!.position).toEqual({ x: 49, y: 0 });
});

it('rebases pending local edits over a concurrent remote edit', async () => {
 const { a, b } = await setup();
 b.edit([{ kind: 'updateGraph', graphId: 'flash-marker', name: 'Remote' }]);
 a.edit([{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 9, y: 9 } }]);
 await b.idle(); await a.idle(); await b.pull();
 expect(a.view()).toEqual(b.view());
 expect(a.view().find(g => g.id === 'flash-marker')).toMatchObject({ name: 'Remote' });
});

it('reloads after its batch is rejected because a remote client removed the node', async () => {
 const { a, b } = await setup();
 b.edit([{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'wait' }]);
 await b.idle();
 a.edit([{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 1, y: 1 } }]);
 await a.idle();
 expect(a.issue()).toMatchObject({ kind: 'rejected' });
 expect(a.view()).toEqual(b.view());
});

it('reports a compile error from the session without blocking the edit', async () => {
 const { a } = await setup();
 a.edit([{ kind: 'disconnect', graphId: 'flash-marker', connectionId: 'w2' }]);
 await a.idle();
 expect(a.errors()).toEqual([expect.objectContaining({ graphId: 'flash-marker', kind: 'compile' })]);
});

it('recovers from an outage on a later poll without applying the batch twice', async () => {
 const { session, a, b } = await setup();
 const real = apiFor(session);
 let fail = true;
 const flaky = createBlueprintSync({
  blueprintInspect: real.blueprintInspect,
  blueprintEdit: async batch => { const reply = session.editBlueprints(batch); if (fail) { fail = false; throw new Error('down'); } return reply; },
 }, 'f');
 await flaky.load();
 const before = session.inspectBlueprints().revision;
 flaky.edit([{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 7, y: 7 } }]);
 await flaky.idle();
 expect(flaky.issue()).toEqual({ kind: 'unavailable' });
 await flaky.poll(); await flaky.idle();
 expect(flaky.issue()).toBeNull();
 expect(session.inspectBlueprints().revision - before).toBe(1);
 await b.pull(); await a.pull();
 expect(flaky.view()).toEqual(b.view());
 expect(wait(flaky.view(), 'wait')!.position).toEqual({ x: 7, y: 7 });
});

it('reports "rejected" when an unsent batch no longer applies after a remote edit and is dropped', async () => {
 const session = createSession(makeSmokeScene(), 's');
 session.editBlueprints({ clientId: 'seed', batchId: 'seed', ops: [{ kind: 'replaceAll', graphs: fixture.blueprints as never }] });
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 const a = createBlueprintSync({ ...apiFor(session), blueprintEdit: async batch => { await gate; return session.editBlueprints(batch); } }, 'a');
 await a.load();
 a.edit([{ kind: 'updateGraph', graphId: 'flash-marker', name: 'Mine' }]);
 a.edit([{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 1, y: 1 } }]);
 session.editBlueprints({ clientId: 'b', batchId: 'remote', ops: [{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'wait' }] });
 await a.pull();
 expect(wait(a.view(), 'wait')).toBeUndefined();
 expect(a.issue()).toEqual({ kind: 'rejected', message: expect.any(String) });
 release(); await a.idle();
});
