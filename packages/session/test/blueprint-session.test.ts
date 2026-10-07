import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { makeSmokeScene } from '@opensekai/contracts';
import { createSession } from '../src/session';

type S = ReturnType<typeof createSession>;
const visible = (s: S, id: string) => s.inspect().entities.find(e => e.id === id)?.visible;
const press = (accelerator: string) => ({ events: [{ kind: 'keystroke' as const, accelerator }] });
const load = (s: S, graphs: unknown) => s.editBlueprints({ clientId: 't', batchId: crypto.randomUUID(), ops: [{ kind: 'replaceAll', graphs }] });

it('applies a hotkey on the next tick and reports the Blueprint revision on frames', () => {
 const session = createSession(makeSmokeScene(), 's');
 expect(load(session, fixture.blueprints)).toEqual({ ok: true, data: { revision: 1, keystrokes: fixture.expectedAccelerators } });
 session.advance(0);
 const frame = session.advance(16, 16, press('Control+Alt+KeyH'));
 expect(visible(session, 'performer')).toBe(false);
 expect(frame.scene.entities.find(e => e.id === 'performer')?.visible).toBe(false);
 expect(frame.blueprintRevision).toBe(1);
 expect(session.inspect().revision).toBe(1);
});

it('applies a delayed effect from session time', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, fixture.blueprints);
 session.advance(0);
 session.advance(100, 100, press('Control+Alt+KeyJ'));
 session.advance(2099);
 expect(visible(session, 'marker')).toBe(true);
 session.advance(2100);
 expect(visible(session, 'marker')).toBe(false);
});

it('keeps the last valid version firing while the document does not compile', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, fixture.blueprints);
 session.editBlueprints({ clientId: 't', batchId: 'cut', ops: [{ kind: 'removeNode', graphId: 'toggle-performer', nodeId: 'toggle' }, { kind: 'addNode', graphId: 'toggle-performer', node: { id: 'set', version: 1, type: 'scene.setVisibility', settings: { entityId: 'performer' }, position: { x: 0, y: 0 } } }] });
 session.advance(0);
 session.advance(16, 16, press('Control+Alt+KeyH'));
 expect(visible(session, 'performer')).toBe(false);
 expect(session.inspectBlueprints().errors).toEqual([expect.objectContaining({ graphId: 'toggle-performer', kind: 'compile' })]);
});

it('isolates a graph whose target entity was removed and records a runtime error', () => {
 const session = createSession(makeSmokeScene(), 's');
 const graphs = structuredClone(fixture.blueprints);
 graphs[1]!.nodes[0]!.settings = { code: 'KeyH', control: true, alt: true, shift: false, meta: false };
 graphs[1]!.nodes[3]!.settings = { entityId: 'gone' };
 load(session, graphs);
 session.advance(0);
 session.advance(16, 16, press('Control+Alt+KeyH'));
 expect(visible(session, 'performer')).toBe(false);
 expect(session.inspectBlueprints().errors).toEqual([{ graphId: 'flash-marker', kind: 'runtime', error: expect.objectContaining({ code: 'NOT_FOUND', ids: ['gone'] }) }]);
});

it('does not advance the scene revision when effects change nothing', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, [{ schemaVersion: 1, id: 'm', name: 'M', nodes: [
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: { x: 0, y: 0 } },
  { id: 'on', version: 1, type: 'value.boolean', settings: { value: true }, position: { x: 0, y: 0 } },
  { id: 'set', version: 1, type: 'scene.setVisibility', settings: { entityId: 'marker' }, position: { x: 0, y: 0 } },
 ], connections: [
  { id: 'a', sourceNodeId: 'go', sourcePort: 'flow', targetNodeId: 'set', targetPort: 'flow' },
  { id: 'b', sourceNodeId: 'on', sourcePort: 'value', targetNodeId: 'set', targetPort: 'visible' },
 ] }]);
 expect(session.runBlueprint('m', 'go')).toEqual({ ok: true, data: { revision: 0 } });
 expect(session.inspect().revision).toBe(0);
});

it('switches an output camera and rejects a run on a missing graph', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, [{ schemaVersion: 1, id: 'cam', name: 'Cam', nodes: [
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: { x: 0, y: 0 } },
  { id: 'cut', version: 1, type: 'camera.switch', settings: { outputId: 'output_main', cameraId: 'camera_close' }, position: { x: 0, y: 0 } },
 ], connections: [{ id: 'a', sourceNodeId: 'go', sourcePort: 'flow', targetNodeId: 'cut', targetPort: 'flow' }] }]);
 expect(session.runBlueprint('cam', 'go')).toEqual({ ok: true, data: { revision: 1 } });
 expect(session.inspect().outputs.find(o => o.id === 'output_main')?.cameraId).toBe('camera_close');
 expect(session.runBlueprint('nope', 'go')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});
