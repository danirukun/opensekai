import type { BlueprintNode, DeviceEvent, GamepadSnapshot, PointerSnapshot } from '@opensekai/contracts';
import type { EvaluatorTable } from './types';

// Device state for one tick. `midi` maps `${channel}:${controller}` to the last value (0–127); channel 0 holds the last value on any channel.
export interface DeviceEnv { gamepads: readonly GamepadSnapshot[]; pointer: PointerSnapshot | null; midi: ReadonlyMap<string, number> }
export const NO_DEVICES: DeviceEnv = { gamepads: [], pointer: null, midi: new Map() };

// RunEnv lives in types.ts (owned by the value model slice); the device fields are added here by declaration merging.
declare module './types' {
 interface RunEnv {
  devices?: DeviceEnv;
  // The device event that started this run.
  trigger?: DeviceEvent;
 }
}

const padMatches = (pad: number, actual: number) => pad === 0 || pad === actual;
const channelMatches = (channel: number, actual: number) => channel === 0 || channel === actual;

// Whether a device event starts a run at this node.
export function deviceTrigger(node: BlueprintNode, event: DeviceEvent): boolean {
 switch (node.type) {
  case 'gamepad.pressed':
  case 'gamepad.released':
   return event.kind === 'gamepadButton' && event.pressed === (node.type === 'gamepad.pressed') && event.button === node.settings.button && padMatches(node.settings.pad, event.pad);
  case 'midi.noteOn':
  case 'midi.noteOff':
   return event.kind === 'midiNote' && event.on === (node.type === 'midi.noteOn') && channelMatches(node.settings.channel, event.channel) && (node.settings.anyNote || node.settings.note === event.note);
  case 'pointer.pressed':
   return event.kind === 'pointerButton' && event.pressed && event.button === node.settings.button;
  default:
   return false;
 }
}

const axisValue = (gamepads: readonly GamepadSnapshot[], pad: number, axis: keyof NonNullable<GamepadSnapshot['axes']>) =>
 gamepads.filter(state => padMatches(pad, state.pad)).map(state => state.axes?.[axis] ?? 0).reduce((best, value) => Math.abs(value) > Math.abs(best) ? value : best, 0);
const noteData = (output: string, trigger: DeviceEvent | undefined) => trigger?.kind === 'midiNote' ? (output === 'note' ? trigger.note : trigger.velocity) : 0;

export const DEVICE_EVALUATORS = {
 'gamepad.pressed': {},
 'gamepad.released': {},
 'gamepad.held': { data: (node, _o, _r, _s, env) => (env.devices?.gamepads ?? []).some(state => padMatches(node.settings.pad, state.pad) && (state.buttons ?? []).includes(node.settings.button)) },
 'gamepad.axis': { data: (node, _o, _r, _s, env) => axisValue(env.devices?.gamepads ?? [], node.settings.pad, node.settings.axis) },
 'midi.noteOn': { data: (_n, output, _r, _s, env) => noteData(output, env.trigger) },
 'midi.noteOff': { data: (_n, output, _r, _s, env) => noteData(output, env.trigger) },
 'midi.control': {
  data: (node, output, _r, _s, env) => {
   const raw = env.devices?.midi.get(`${node.settings.channel}:${node.settings.controller}`) ?? 0;
   return output === 'raw' ? raw : raw / 127;
  },
 },
 'pointer.position': { data: (_n, output, _r, _s, env) => (output === 'x' ? env.devices?.pointer?.x : env.devices?.pointer?.y) ?? 0 },
 'pointer.pressed': {},
 'pointer.held': { data: (node, _o, _r, _s, env) => (env.devices?.pointer?.buttons ?? []).includes(node.settings.button) },
} satisfies Partial<EvaluatorTable>;
