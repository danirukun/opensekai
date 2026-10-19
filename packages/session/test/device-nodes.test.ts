import { expect, it } from 'vitest';
import { makeSmokeScene, type BlueprintGraph, type DeviceEvent } from '@opensekai/contracts';
import { createBlueprintRuntime } from '../src/blueprint-runtime';
import { activeDevices, createDeviceInput } from '../src/devices';
import { createSession } from '../src/session';

const at = { x: 0, y: 0 };
const graph = (nodes: unknown[], connections: unknown[], id = 'g', enabled = true): BlueprintGraph =>
 ({ schemaVersion: 1, id, name: id, enabled, variables: [], nodes, connections } as BlueprintGraph);
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const node = (id: string, type: string, settings: object = {}) => ({ id, version: 1, type, settings, position: at });
const zero = node('zero', 'value.number', { value: 0 });

// Start → Set Asset Property(marker position ← (x, y, 0)), where x and y come from two data outputs.
const writePosition = (start: unknown, x: [string, string], y: [string, string], extra: unknown[] = [], id = 'g') => graph([
 start, zero, ...extra,
 node('make', 'vector3.make'),
 node('set', 'property.set', { entityId: 'marker', property: 'position' }),
], [
 wire('a', (start as { id: string }).id, 'flow', 'set', 'flow'),
 wire('b', x[0], x[1], 'make', 'x'), wire('c', y[0], y[1], 'make', 'y'), wire('d', 'zero', 'value', 'make', 'z'),
 wire('e', 'make', 'value', 'set', 'value'),
], id);
const positions = (runs: ReturnType<ReturnType<typeof createBlueprintRuntime>['step']>) => runs.flatMap(run => run.effects).map(effect => (effect as { value: unknown }).value);

it('starts note runs with the note and velocity of the event and filters by channel and note', () => {
 const noteOn = node('on', 'midi.noteOn', { channel: 2, anyNote: false, note: 60 });
 const runtime = createBlueprintRuntime();
 expect(runtime.install([writePosition(noteOn, ['on', 'note'], ['on', 'velocity'])]).ok).toBe(true);
 const note = (channel: number, value: number, on = true): { kind: 'device'; event: DeviceEvent } => ({ kind: 'device', event: { kind: 'midiNote', channel, note: value, velocity: 100, on } });
 expect(positions(runtime.step([note(2, 60)], 0))).toEqual([[60, 100, 0]]);
 expect(positions(runtime.step([note(3, 60), note(2, 61), note(2, 60, false)], 0))).toEqual([]);
 const anyNote = node('on', 'midi.noteOff', { channel: 0, anyNote: true, note: 0 });
 runtime.install([writePosition(anyNote, ['on', 'note'], ['on', 'velocity'])]);
 expect(positions(runtime.step([note(9, 42, false), note(9, 43)], 0))).toEqual([[42, 100, 0]]);
});

it('starts gamepad and pointer runs on matching button edges only', () => {
 const runtime = createBlueprintRuntime();
 const pressed = graph([node('p', 'gamepad.pressed', { pad: 2, button: 'south' }), node('show', 'scene.setVisibility', { entityId: 'marker' }), node('t', 'value.boolean', { value: true })],
  [wire('a', 'p', 'flow', 'show', 'flow'), wire('b', 't', 'value', 'show', 'visible')], 'pad');
 const released = graph([node('r', 'gamepad.released', { pad: 0, button: 'east' }), node('hide', 'scene.setVisibility', { entityId: 'marker' }), node('f', 'value.boolean', { value: false })],
  [wire('a', 'r', 'flow', 'hide', 'flow'), wire('b', 'f', 'value', 'hide', 'visible')], 'release');
 const click = graph([node('c', 'pointer.pressed', { button: 'right' }), node('toggle', 'scene.toggleVisibility', { entityId: 'reference' })], [wire('a', 'c', 'flow', 'toggle', 'flow')], 'click');
 runtime.install([pressed, released, click]);
 const fired = (events: DeviceEvent[]) => runtime.step(events.map(event => ({ kind: 'device' as const, event })), 0).map(run => run.graphId);
 expect(fired([{ kind: 'gamepadButton', pad: 1, button: 'south', pressed: true }])).toEqual([]);
 expect(fired([{ kind: 'gamepadButton', pad: 2, button: 'south', pressed: true }])).toEqual(['pad']);
 expect(fired([{ kind: 'gamepadButton', pad: 2, button: 'south', pressed: false }])).toEqual([]);
 expect(fired([{ kind: 'gamepadButton', pad: 4, button: 'east', pressed: false }])).toEqual(['release']);
 expect(fired([{ kind: 'pointerButton', button: 'left', pressed: true }, { kind: 'pointerButton', button: 'right', pressed: false }])).toEqual([]);
 expect(fired([{ kind: 'pointerButton', button: 'right', pressed: true }])).toEqual(['click']);
});

it('reads gamepad, pointer, and MIDI state from the clock in On Update', () => {
 const session = createSession(makeSmokeScene(), 's');
 const tick = node('tick', 'event.update');
 const axisAndCc = writePosition(tick, ['axis', 'value'], ['cc', 'value'], [node('axis', 'gamepad.axis', { pad: 0, axis: 'leftY' }), node('cc', 'midi.control', { channel: 0, controller: 7 })]);
 const pointer = graph([tick, node('pos', 'pointer.position'), zero, node('make', 'vector3.make'), node('set', 'property.set', { entityId: 'reference', property: 'position' })],
  [wire('a', 'tick', 'flow', 'set', 'flow'), wire('b', 'pos', 'x', 'make', 'x'), wire('c', 'pos', 'y', 'make', 'y'), wire('d', 'zero', 'value', 'make', 'z'), wire('e', 'make', 'value', 'set', 'value')], 'pointer');
 const held = graph([tick, node('held', 'gamepad.held', { pad: 1, button: 'north' }), node('click', 'pointer.held', { button: 'left' }), node('and', 'logic.and'), node('show', 'scene.setVisibility', { entityId: 'performer' })],
  [wire('a', 'tick', 'flow', 'show', 'flow'), wire('b', 'held', 'held', 'and', 'a'), wire('c', 'click', 'held', 'and', 'b'), wire('d', 'and', 'result', 'show', 'visible')], 'held');
 expect(session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [axisAndCc, pointer, held] }] })).toMatchObject({ ok: true, data: { devices: ['gamepad', 'midi', 'pointer'] } });
 const first = session.advance(16, 16, { devices: {
  events: [{ kind: 'midiControl', channel: 5, controller: 7, value: 127 }],
  gamepads: [{ pad: 1, buttons: ['north'], axes: { leftY: 0.25 } }, { pad: 2, axes: { leftY: -0.75 } }],
  pointer: { x: 0.5, y: 0.25, buttons: ['left'] },
 } }).scene.entities;
 // Any pad gives the axis value with the largest magnitude.
 expect(first.find(item => item.id === 'marker')!.transform.position).toEqual([-0.75, 1, 0]);
 expect(first.find(item => item.id === 'reference')!.transform.position).toEqual([0.5, 0.25, 0]);
 expect(first.find(item => item.id === 'performer')!.visible).toBe(true);
 // Control values last after the clock that carried them; pad and pointer state do not.
 const next = session.advance(32, 32).scene.entities;
 expect(next.find(item => item.id === 'marker')!.transform.position).toEqual([0, 1, 0]);
 expect(next.find(item => item.id === 'reference')!.transform.position).toEqual([0, 0, 0]);
 expect(next.find(item => item.id === 'performer')!.visible).toBe(false);
});

it('keeps the last Control Change value per channel and for any channel', () => {
 const input = createDeviceInput();
 const first = input.ingest({ events: [{ kind: 'midiControl', channel: 1, controller: 7, value: 10 }, { kind: 'midiNote', channel: 1, note: 60, velocity: 1, on: true }, { kind: 'midiControl', channel: 2, controller: 7, value: 20 }] });
 expect(first.events).toEqual([{ kind: 'midiNote', channel: 1, note: 60, velocity: 1, on: true }]);
 const later = input.ingest(undefined);
 expect([later.env.midi.get('1:7'), later.env.midi.get('2:7'), later.env.midi.get('0:7'), later.env.midi.get('1:8')]).toEqual([10, 20, 20, undefined]);
 expect(later.env.pointer).toBeNull();
 expect(later.env.gamepads).toEqual([]);
});

it('reports the device kinds of enabled graphs only', () => {
 const pad = graph([node('p', 'gamepad.axis', { pad: 0, axis: 'leftX' })], [], 'pad');
 const midi = graph([node('m', 'midi.control', { channel: 0, controller: 1 })], [], 'midi', false);
 expect(activeDevices([pad, midi])).toEqual(['gamepad']);
 expect(activeDevices([])).toEqual([]);
 const session = createSession(makeSmokeScene(), 's');
 expect(session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [pad, midi] }] })).toEqual({ ok: true, data: { revision: 1, keystrokes: [], devices: ['gamepad'] } });
 expect(session.inspectBlueprints().devices).toEqual(['gamepad']);
 expect(session.editBlueprints({ clientId: 't', batchId: 'c', ops: [{ kind: 'removeGraph', graphId: 'pad' }] })).toEqual({ ok: true, data: { revision: 2, keystrokes: [] } });
 expect(session.inspectBlueprints().devices).toBeUndefined();
});

it('widens the integer note and velocity outputs into number inputs', () => {
 const session = createSession(makeSmokeScene(), 's');
 const noteOn = node('on', 'midi.noteOn', { channel: 0, anyNote: true, note: 60 });
 expect(session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [writePosition(noteOn, ['on', 'note'], ['on', 'velocity'])] }] })).toMatchObject({ ok: true, data: { devices: ['midi'] } });
 expect(session.inspectBlueprints().errors).toEqual([]);
 const scene = session.advance(16, 16, { devices: { events: [{ kind: 'midiNote', channel: 3, note: 64, velocity: 101, on: true }] } }).scene;
 expect(scene.entities.find(item => item.id === 'marker')!.transform.position).toEqual([64, 101, 0]);
});
