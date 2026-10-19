import { expect, it } from 'vitest';
import { makeSmokeScene, replySchema, ResultSchemas, type AppApi, type BlueprintGraph, type DebugEntry } from '@opensekai/contracts';
import { createSession, sessionApi } from '@opensekai/session';
import { createDebugFeed } from '../src/blueprints/debug-feed';

// Boundary: the session command API (`blueprintDebug`) as the editor reads it, with each reply checked by the shared result schema.
it('feeds new log and toast entries and Debug Value text from a running session to the editor', async () => {
 const session = createSession(makeSmokeScene(), 'debug');
 const calls = sessionApi(session);
 const api: Pick<AppApi, 'blueprintDebug'> = { blueprintDebug: async params => replySchema(ResultSchemas.blueprintDebug).parse(await calls.blueprintDebug(params)) };
 const at = { x: 0, y: 0 };
 const graph = { schemaVersion: 1, id: 'g', name: 'G', enabled: true, variables: [], nodes: [
  { id: 'tick', version: 1, type: 'event.update', settings: {}, position: at },
  { id: 'toast', version: 1, type: 'debug.toast', settings: { variant: 'warning', durationSeconds: 3 }, position: at, inputs: { header: 'Chat', caption: 'hello' } },
  { id: 'n', version: 1, type: 'value.number', settings: { value: 4 }, position: at },
  { id: 'probe', version: 1, type: 'debug.value', settings: { valueType: 'number' }, position: at },
 ], connections: [
  { id: 'a', sourceNodeId: 'tick', sourcePort: 'flow', targetNodeId: 'toast', targetPort: 'flow' },
  { id: 'b', sourceNodeId: 'n', sourcePort: 'value', targetNodeId: 'probe', targetPort: 'value' },
 ] } as BlueprintGraph;
 expect(session.editBlueprints({ clientId: 't', batchId: 'b1', ops: [{ kind: 'createGraph', graph }] }).ok).toBe(true);
 session.advance(0);
 const added: DebugEntry[][] = [];
 const feed = createDebugFeed(api, entries => added.push(entries));
 await feed.poll();
 expect(feed.state().entries).toMatchObject([{ kind: 'toast', header: 'Chat', caption: 'hello' }]);
 expect(feed.state().values.get('g\0probe')).toMatchObject({ text: '4' });
 expect(added).toEqual([]);
 // 60 ticks in one second: the toast window keeps 5, and the read pages through all of them.
 for (let t = 1; t <= 60; t++) session.advance(t * 16);
 await feed.poll();
 expect(added.flat().map(entry => entry.kind)).toEqual(['toast', 'toast', 'toast', 'toast']);
 session.advance(1100);
 await feed.poll();
 expect(added.at(-1)).toMatchObject([{ kind: 'toast', atMs: 1100, dropped: 56 }]);
});
