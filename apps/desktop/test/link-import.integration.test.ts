// Boundary: the real session store and runtime, reached through the session API and the Editor Blueprint sync,
// as the Import button of the link dialog reaches them (B39 R12, R13, R15, R16).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { importBlueprint, makeSmokeScene, type AppApi } from '@opensekai/contracts';
import { createSession, sessionApi } from '@opensekai/session';
import { createBlueprintSync } from '../src/blueprints/blueprint-sync';
import { linkSummary } from '../src/blueprints/link-import';

const load = (name: string) => readFileSync(new URL(`../../../fixtures/blueprints/${name}.json`, import.meta.url), 'utf8');

async function start() {
 const session = createSession(makeSmokeScene(), 'link');
 const api = sessionApi(session);
 const replies: Awaited<ReturnType<AppApi['blueprintEdit']>>[] = [];
 const sync = createBlueprintSync({ blueprintInspect: api.blueprintInspect, blueprintEdit: async batch => { const reply = await api.blueprintEdit(batch); replies.push(reply); return reply; } }, 'editor');
 await sync.load();
 const snapshot = () => { const view = session.inspectBlueprints(); if (view.kind !== 'snapshot') throw new Error('Expected a snapshot'); return view; };
 let now = 0;
 const ticks = (count: number, held: string[] = []) => { for (let i = 0; i < count; i++) { now += 16; session.advance(now, now, { held }); } };
 return { session, sync, replies, snapshot, ticks };
}

it('adds a linked graph with keystroke and held key nodes disabled, so it registers no key and runs no node', async () => {
 const { session, sync, replies, snapshot, ticks } = await start();
 const before = snapshot();
 const position = () => session.inspect().entities.find(item => item.id === 'performer')!.transform.position;
 const camera = () => session.inspect().outputs.find(item => item.id === 'preview_main')!.cameraId;
 const start0 = { position: position(), camera: camera() };
 for (const name of ['counter', 'wasd']) {
  const summary = linkSummary(load(name), 'blueprints.example', session.inspect(), sync.view().length, () => `linked-${name}`);
  if (!summary.ok) throw new Error(summary.error.message);
  expect(sync.edit([{ kind: 'createGraph', graph: summary.data.graph }]).ok).toBe(true);
  await sync.idle();
  expect(sync.issue()).toBeNull();
  const listed = snapshot().blueprints.find(graph => graph.id === `linked-${name}`);
  expect(listed).toMatchObject({ name: summary.data.name, enabled: false });
  expect(listed?.nodes).toHaveLength(summary.data.nodeCount);
 }
 expect(replies.length).toBeGreaterThan(0);
 for (const reply of replies) {
  if (!reply.ok) throw new Error(reply.error.message);
  expect(reply.data.keystrokes).toEqual(before.keystrokes ?? []);
  expect(reply.data.heldKeys ?? []).toEqual(before.heldKeys ?? []);
 }
 const after = snapshot();
 expect(after.keystrokes ?? []).toEqual(before.keystrokes ?? []);
 expect(after.heldKeys ?? []).toEqual(before.heldKeys ?? []);
 const revision = session.inspect().revision;
 ticks(60, ['KeyW']);
 ticks(20);
 expect(session.inspect().revision).toBe(revision);
 expect(position()).toEqual(start0.position);
 expect(camera()).toBe(start0.camera);
});

it('fails a link at 8 graphs and leaves the Blueprint revision and the graph list unchanged', async () => {
 const { session, sync, snapshot } = await start();
 const text = load('counter');
 for (let i = 0; i < 8; i++) {
  const file = importBlueprint(text, session.inspect(), () => `seed-${i}`);
  if (!file.ok) throw new Error(file.error.message);
  expect(sync.edit([{ kind: 'createGraph', graph: file.data.graph }]).ok).toBe(true);
 }
 await sync.idle();
 const before = snapshot();
 expect(before.blueprints).toHaveLength(8);
 const summary = linkSummary(text, 'blueprints.example', session.inspect(), sync.view().length, () => 'linked');
 expect(summary).toMatchObject({ ok: false, error: { message: 'Show already has 8 blueprints' } });
 const after = snapshot();
 expect(after.revision).toBe(before.revision);
 expect(after.blueprints.map(graph => graph.id)).toEqual(before.blueprints.map(graph => graph.id));
});
