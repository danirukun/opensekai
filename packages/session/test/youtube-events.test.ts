import { expect, it } from 'vitest';
import { makeSmokeScene, nodeDefinition, YOUTUBE_NODE_OUTPUTS, type BlueprintGraph, type DataType, type YouTubeEvent, type YouTubeNodeType } from '@opensekai/contracts';
import { createBlueprintRuntime } from '../src/blueprint-runtime';
import { createSession } from '../src/session';

const at = { x: 0, y: 0 };
const graph = (nodes: unknown[], connections: unknown[], id = 'g', enabled = true): BlueprintGraph =>
 ({ schemaVersion: 1, id, name: id, enabled, variables: [], nodes, connections } as BlueprintGraph);
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const node = (id: string, type: string, settings: object = {}, inputs?: object) => ({ id, version: 1, type, settings, position: at, ...(inputs ? { inputs } : {}) });

// A start node, then one Emit Debug Event for each listed output of `source`: the event name is the output name and the payload is its value.
const report = (start: { id: string; type: string }, source: string, outputs: [string, DataType][], id = 'g') => graph([
 start, ...(source === start.id ? [] : [node(source, YOUTUBE_TYPE_OF[source]!)]),
 ...outputs.map(([output, type], i) => node(`e${i}`, 'debug.event', { payloadType: type }, { name: output })),
], outputs.flatMap(([output], i) => [
 wire(`f${i}`, i === 0 ? start.id : `e${i - 1}`, i === 0 ? 'flow' : 'exit', `e${i}`, 'flow'),
 wire(`d${i}`, source, output, `e${i}`, 'payload'),
]), id);
const YOUTUBE_TYPE_OF: Record<string, string> = { chat: 'youtube.chat', superChat: 'youtube.superChat' };
type Runs = ReturnType<ReturnType<typeof createBlueprintRuntime>['step']>;
const payloads = (runs: Runs) => Object.fromEntries(runs.flatMap(run => run.effects).map(effect => {
 const e = effect as { name: string; payload: unknown };
 return [e.name, e.payload];
}));

const author = { username: 'Viewer', userChannelId: 'UC1' };
const EVENTS: Record<YouTubeNodeType, YouTubeEvent> = {
 'youtube.chat': { kind: 'chat', id: 'c1', ...author, message: '!dance', avatarUrl: 'https://a/1.png', isMember: true, isModerator: false, isOwner: true, isVerified: false },
 'youtube.superChat': { kind: 'superChat', id: 's1', ...author, message: 'gg', avatarUrl: 'https://a/2.png', amount: '¥500', amountMicros: 500_000_000, currency: 'JPY', tierColor: '#1DE9B6' },
 'youtube.superSticker': { kind: 'superSticker', id: 'k1', ...author, stickerName: 'Wave', stickerImageUrl: 'https://s/1.png', amount: '$2.00', currency: 'USD' },
 'youtube.newMember': { kind: 'newMember', id: 'n1', ...author, avatarUrl: 'https://a/3.png', levelName: 'Fan Club' },
 'youtube.memberMilestone': { kind: 'memberMilestone', id: 'm1', ...author, months: 6, message: 'half a year' },
 'youtube.giftMemberships': { kind: 'giftMemberships', id: 'g1', ...author, count: 5 },
 'youtube.status': { kind: 'status', status: 'live' },
};
const types = Object.keys(EVENTS) as YouTubeNodeType[];

it('starts each node only on its own event kind and gives the event fields as data', () => {
 for (const type of types) {
  const outputs = Object.entries(YOUTUBE_NODE_OUTPUTS[type]) as [string, DataType][];
  const runtime = createBlueprintRuntime();
  expect(runtime.install([report(node('yt', type), 'yt', outputs)]).ok, type).toBe(true);
  for (const other of types.filter(item => item !== type))
   expect(runtime.step([{ kind: 'youtube', event: EVENTS[other] }], 0), `${type} on ${other}`).toEqual([]);
  const runs = runtime.step([{ kind: 'youtube', event: EVENTS[type] }], 0);
  expect(runs.map(run => run.error)).toEqual([null]);
  const event = EVENTS[type] as unknown as Record<string, unknown>;
  expect(payloads(runs)).toEqual(Object.fromEntries(outputs.map(([output]) => [output, event[output]])));
 }
});

it('gives type defaults when a run did not start from a matching YouTube event', () => {
 const outputs: [string, DataType][] = [['message', 'string'], ['isMember', 'boolean'], ['amountMicros', 'number']];
 const runtime = createBlueprintRuntime();
 // A Manual Trigger run reads a chat node; a Super Chat run reads a chat node of another kind.
 const manual = graph([node('m', 'event.manual'), node('chat', 'youtube.chat'), node('super', 'youtube.superChat'),
  node('e0', 'debug.event', { payloadType: 'string' }, { name: 'message' }), node('e1', 'debug.event', { payloadType: 'boolean' }, { name: 'isMember' }), node('e2', 'debug.event', { payloadType: 'number' }, { name: 'amountMicros' })],
 [wire('a', 'm', 'flow', 'e0', 'flow'), wire('b', 'e0', 'exit', 'e1', 'flow'), wire('c', 'e1', 'exit', 'e2', 'flow'),
  wire('d', 'chat', 'message', 'e0', 'payload'), wire('e', 'chat', 'isMember', 'e1', 'payload'), wire('f', 'super', 'amountMicros', 'e2', 'payload')], 'manual');
 const cross = report(node('super', 'youtube.superChat'), 'chat', outputs.slice(0, 2), 'cross');
 expect(runtime.install([manual, cross]).ok).toBe(true);
 expect(payloads(runtime.step([{ kind: 'manual', graphId: 'manual', nodeId: 'm' }], 0))).toEqual({ message: '', isMember: false, amountMicros: 0 });
 expect(payloads(runtime.step([{ kind: 'youtube', event: EVENTS['youtube.superChat'] }], 0))).toEqual({ message: '', isMember: false });
 expect(outputs.every(([output, type]) => YOUTUBE_NODE_OUTPUTS[output === 'amountMicros' ? 'youtube.superChat' : 'youtube.chat'][output] === type)).toBe(true);
});

it('runs eight events of one clock in queue order, after the device events', () => {
 const session = createSession(makeSmokeScene(), 's');
 const chat = report(node('yt', 'youtube.chat'), 'yt', [['message', 'string']], 'chat');
 const press = graph([node('p', 'pointer.pressed', { button: 'left' }), node('e', 'debug.event', { payloadType: 'none' }, { name: 'pointer' })], [wire('a', 'p', 'flow', 'e', 'flow')], 'press');
 const status = report(node('st', 'youtube.status'), 'st', [['status', 'string']], 'status');
 expect(session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [chat, press, status] }] })).toMatchObject({ ok: true, data: { youtube: true } });
 const events: YouTubeEvent[] = [
  { kind: 'status', status: 'live' },
  ...Array.from({ length: 7 }, (_, i) => ({ ...EVENTS['youtube.chat'], id: `c${i}`, message: `m${i}` }) as YouTubeEvent),
 ];
 session.advance(16, 16, { devices: { events: [{ kind: 'pointerButton', button: 'left', pressed: true }] }, youtube: { events } });
 const log = session.debugBlueprints().entries.map(entry => (entry as { name: string; text?: string }).text ?? (entry as { name: string }).name);
 // The debug log formats a string payload with quotes.
 expect(log).toEqual(['pointer', '"live"', ...Array.from({ length: 7 }, (_, i) => `"m${i}"`)]);
});

it('reports the YouTube listen flag only while a listened graph has a YouTube node', () => {
 const session = createSession(makeSmokeScene(), 's');
 const chat = (enabled: boolean) => graph([node('yt', 'youtube.chat')], [], 'chat', enabled);
 const edit = (batchId: string, graphs: BlueprintGraph[]) => session.editBlueprints({ clientId: 't', batchId, ops: [{ kind: 'replaceAll', graphs }] });
 expect(edit('a', [chat(true)])).toMatchObject({ ok: true, data: { youtube: true } });
 expect(session.inspectBlueprints()).toMatchObject({ kind: 'snapshot', youtube: true });
 const off = edit('b', [chat(false)]);
 expect(off.ok && 'youtube' in off.data).toBe(false);
 expect('youtube' in session.inspectBlueprints()).toBe(false);
 // A disabled graph that an enabled graph can enable is listened.
 const enabler = graph([node('m', 'event.manual'), node('on', 'blueprint.enable', { graphId: 'chat' })], [wire('a', 'm', 'flow', 'on', 'flow')], 'enabler');
 expect(edit('c', [chat(false), enabler])).toMatchObject({ ok: true, data: { youtube: true } });
 expect(nodeDefinition('youtube.chat').category).toBe('YouTube');
});
