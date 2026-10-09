import { expect, it, vi } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { makeSmokeScene, type AppApi } from '@opensekai/contracts';
import { createSession } from '@opensekai/session';
import { createBlueprintSync, issueText } from '../src/blueprints/blueprint-sync';

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
 expect(a.issue()).toEqual({ kind: 'rejected', code: 'CONFLICT', message: expect.any(String) });
 expect(issueText(a.issue())).toBe('Changed elsewhere');
 release(); await a.idle();
 expect(a.issue()).toMatchObject({ kind: 'rejected' });
 a.edit([{ kind: 'updateGraph', graphId: 'flash-marker', name: 'Again' }]);
 expect(a.issue()).toBeNull();
 await a.idle();
});

it('shows the server message for a validation rejection and "Changed elsewhere" for a missing node', async () => {
 const { session } = await setup();
 const invalid = createBlueprintSync({ ...apiFor(session), blueprintEdit: async () => ({ ok: false, error: { code: 'INVALID_INPUT', message: 'Too many active keystrokes', ids: [] } }) }, 'v');
 await invalid.load();
 invalid.edit([{ kind: 'updateGraph', graphId: 'flash-marker', name: 'X' }]);
 await invalid.idle();
 expect(invalid.issue()).toEqual({ kind: 'rejected', code: 'INVALID_INPUT', message: 'Too many active keystrokes' });
 expect(issueText(invalid.issue())).toBe('Too many active keystrokes');
 expect(issueText({ kind: 'rejected', code: 'NOT_FOUND', message: 'Node not found' })).toBe('Changed elsewhere');
 expect(issueText({ kind: 'unavailable' })).toBe('Session unavailable');
 expect(issueText(null)).toBe('');
});

const graphs = () => structuredClone(fixture.blueprints) as never;
const rename = (revision: number, name: string) => ({ clientId: 'x', batchId: `b${revision}`, revision, ops: [{ kind: 'updateGraph' as const, graphId: 'flash-marker', name }] });

it('ignores a late delta that is older than the confirmed revision', async () => {
 const replies = [
  { kind: 'snapshot' as const, revision: 5, blueprints: graphs(), errors: [] },
  { kind: 'snapshot' as const, revision: 7, blueprints: graphs().map((g: { id: string }) => g.id === 'flash-marker' ? { ...g, name: 'Seven' } : g), errors: [] },
  { kind: 'delta' as const, revision: 6, batches: [rename(6, 'Six')], errors: [] },
 ];
 const sync = createBlueprintSync({ blueprintEdit: async () => { throw new Error('unused'); }, blueprintInspect: async () => ({ ok: true, data: replies.shift()! }) }, 'a');
 await sync.load(); await sync.load(); await sync.pull();
 expect(sync.revision()).toBe(7);
 expect(sync.view().find(g => g.id === 'flash-marker')!.name).toBe('Seven');
});

it('asks for a snapshot when a delta does not start at the confirmed revision', async () => {
 const calls: unknown[] = [];
 const replies = [
  { kind: 'snapshot' as const, revision: 5, blueprints: graphs(), errors: [] },
  { kind: 'delta' as const, revision: 7, batches: [rename(7, 'Seven')], errors: [] },
  { kind: 'snapshot' as const, revision: 7, blueprints: graphs().map((g: { id: string }) => g.id === 'flash-marker' ? { ...g, name: 'Snap' } : g), errors: [] },
 ];
 const sync = createBlueprintSync({ blueprintEdit: async () => { throw new Error('unused'); }, blueprintInspect: async params => { calls.push(params); return { ok: true, data: replies.shift()! }; } }, 'a');
 await sync.load(); await sync.pull();
 expect(calls).toEqual([{}, { sinceRevision: 5 }, {}]);
 expect(sync.revision()).toBe(7);
 expect(sync.view().find(g => g.id === 'flash-marker')!.name).toBe('Snap');
});

it('runs a load and a pull one after the other', async () => {
 let open = 0, peak = 0;
 const sync = createBlueprintSync({
  blueprintEdit: async () => { throw new Error('unused'); },
  blueprintInspect: async ({ sinceRevision }) => {
   open++; peak = Math.max(peak, open);
   await new Promise(resolve => setTimeout(resolve, sinceRevision === undefined ? 1 : 10));
   open--;
   return { ok: true, data: { kind: 'snapshot' as const, revision: 3, blueprints: graphs(), errors: [] } };
  },
 }, 'a');
 await Promise.all([sync.pull(), sync.load(), sync.pull()]);
 expect(peak).toBe(1);
 expect(sync.revision()).toBe(3);
});

it('follows a new session whose revision restarts at 0, and confirms later edits', async () => {
 let current = createSession(makeSmokeScene(), 'a');
 current.editBlueprints({ clientId: 'seed', batchId: 'seed', ops: [{ kind: 'replaceAll', graphs: fixture.blueprints as never }] });
 for (let i = 0; i < 6; i++) current.editBlueprints({ clientId: 'seed', batchId: `n${i}`, ops: [{ kind: 'updateGraph', graphId: 'flash-marker', name: `N${i}` }] });
 const sync = createBlueprintSync({
  blueprintEdit: async batch => current.editBlueprints(batch),
  blueprintInspect: async ({ sinceRevision }) => ({ ok: true, data: current.inspectBlueprints(sinceRevision) }),
 }, 'a');
 await sync.load();
 expect(sync.revision()).toBe(7);
 current = createSession(makeSmokeScene(), 'b');
 current.editBlueprints({ clientId: 'seed', batchId: 'seed', ops: [{ kind: 'replaceAll', graphs: [fixture.blueprints[0]] as never }] });
 await sync.pull();
 expect(sync.revision()).toBe(7);
 await sync.reset();
 expect(sync.revision()).toBe(1);
 expect(sync.view().map(g => g.id)).toEqual([fixture.blueprints[0]!.id]);
 sync.edit([{ kind: 'updateGraph', graphId: fixture.blueprints[0]!.id, name: 'After' }]);
 await sync.idle();
 expect(sync.revision()).toBe(2);
 expect(current.inspectBlueprints().blueprints[0]!.name).toBe('After');
});

it('sends an edit with more than 64 operations as ordered batches', async () => {
 const { session, a } = await setup();
 const before = session.inspectBlueprints().revision;
 const ops = Array.from({ length: 40 }, (_, i) => ({ kind: 'addNode' as const, graphId: 'flash-marker', node: { id: `p${i}`, version: 1 as const, type: 'flow.delay' as const, settings: { seconds: 1 }, position: { x: i, y: 0 } } }));
 const wires = Array.from({ length: 39 }, (_, i) => ({ kind: 'connect' as const, graphId: 'flash-marker', connection: { id: `pw${i}`, sourceNodeId: `p${i}`, sourcePort: 'exit', targetNodeId: `p${i + 1}`, targetPort: 'flow' } }));
 expect(a.edit([...ops, ...wires]).ok).toBe(true);
 await a.idle();
 expect(session.inspectBlueprints().revision - before).toBe(2);
 expect(a.issue()).toBeNull();
 expect(a.view().find(g => g.id === 'flash-marker')!.connections).toHaveLength(5 + 39);
});

it('rejects a paste over the node limit without changing the graph', async () => {
 const { a } = await setup();
 const before = a.view();
 const ops = Array.from({ length: 123 }, (_, i) => ({ kind: 'addNode' as const, graphId: 'flash-marker', node: { id: `q${i}`, version: 1 as const, type: 'flow.delay' as const, settings: { seconds: 1 }, position: { x: i, y: 0 } } }));
 expect(a.edit(ops).ok).toBe(false);
 expect(a.view()).toEqual(before);
});
