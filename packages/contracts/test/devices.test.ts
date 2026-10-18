import { expect, it } from 'vitest';
import { BlueprintInspectSchema, DeviceUpdateSchema, InputUpdateSchema, parseWire, ResultSchemas } from '../src';

it('accepts device events and state and rejects values out of range', () => {
 const ok = (devices: unknown) => DeviceUpdateSchema.safeParse(devices).success;
 expect(ok({ events: [{ kind: 'midiNote', channel: 1, note: 60, velocity: 0, on: false }, { kind: 'midiControl', channel: 16, controller: 127, value: 127 }, { kind: 'gamepadButton', pad: 4, button: 'dpadUp', pressed: true }, { kind: 'pointerButton', button: 'middle', pressed: false }] })).toBe(true);
 expect(ok({ gamepads: [{ pad: 1, buttons: ['south'], axes: { leftX: -1, rightTrigger: 1 } }], pointer: { x: -0.5, y: 1.5, buttons: ['left'] } })).toBe(true);
 expect(ok({})).toBe(false);
 expect(ok({ events: [{ kind: 'midiNote', channel: 0, note: 60, velocity: 1, on: true }] })).toBe(false);
 expect(ok({ events: [{ kind: 'midiControl', channel: 1, controller: 128, value: 0 }] })).toBe(false);
 expect(ok({ events: [{ kind: 'gamepadButton', pad: 5, button: 'south', pressed: true }] })).toBe(false);
 expect(ok({ events: Array(33).fill({ kind: 'pointerButton', button: 'left', pressed: true }) })).toBe(false);
 expect(ok({ gamepads: [{ pad: 1 }, { pad: 1 }] })).toBe(false);
 expect(ok({ gamepads: [{ pad: 1, buttons: ['south', 'south'] }] })).toBe(false);
 expect(ok({ gamepads: [{ pad: 1, axes: { leftTrigger: -0.5 } }] })).toBe(false);
 expect(ok({ gamepads: [{ pad: 1, axes: { leftZ: 0.5 } }] })).toBe(false);
 expect(ok({ pointer: { x: 17, y: 0 } })).toBe(false);
 expect(InputUpdateSchema.safeParse({ devices: { pointer: { x: 0, y: 0 } } }).success).toBe(true);
});

it('carries the used device kinds in Blueprint results only when the list is not empty', () => {
 expect(ResultSchemas.blueprintEdit.safeParse({ revision: 1, keystrokes: [], devices: ['gamepad', 'midi'] }).success).toBe(true);
 expect(ResultSchemas.blueprintEdit.safeParse({ revision: 1, keystrokes: [], devices: [] }).success).toBe(false);
 expect(ResultSchemas.blueprintEdit.safeParse({ revision: 1, keystrokes: [], devices: ['keyboard'] }).success).toBe(false);
 expect(BlueprintInspectSchema.safeParse({ kind: 'snapshot', revision: 1, blueprints: [], errors: [], keystrokes: [], devices: ['pointer'] }).success).toBe(true);
});

it('lets a clock with device input use the tracking clock size limit', () => {
 const events = Array.from({ length: 32 }, (_, note) => ({ kind: 'midiNote', channel: 16, note, velocity: 127, on: false }));
 const clock = { kind: 'clock', sessionId: 's', elapsedMs: 1, input: { devices: { events, pointer: { x: 0.125, y: 0.5 } } } };
 const text = JSON.stringify(clock);
 expect(text.length).toBeGreaterThan(2048);
 expect(() => parseWire(text)).not.toThrow();
});
