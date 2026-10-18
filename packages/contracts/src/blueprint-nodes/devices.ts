import { z } from 'zod';
import { GAMEPAD_AXES, GAMEPAD_BUTTONS, POINTER_BUTTONS, type GamepadAxis, type GamepadButton, type PointerButton } from '../devices';
import { defineNode, empty, type BlueprintField, type PortShape } from './define';

const BUTTON_LABELS: Record<GamepadButton, string> = {
 south: 'A / Cross', east: 'B / Circle', west: 'X / Square', north: 'Y / Triangle',
 leftBumper: 'LB / L1', rightBumper: 'RB / R1', leftTrigger: 'LT / L2', rightTrigger: 'RT / R2',
 select: 'View / Share', start: 'Menu / Options', mode: 'Home', leftStick: 'Left Stick Press', rightStick: 'Right Stick Press',
 dpadUp: 'D-pad Up', dpadDown: 'D-pad Down', dpadLeft: 'D-pad Left', dpadRight: 'D-pad Right',
};
const AXIS_LABELS: Record<GamepadAxis, string> = { leftX: 'Left Stick X', leftY: 'Left Stick Y', rightX: 'Right Stick X', rightY: 'Right Stick Y', leftTrigger: 'Left Trigger', rightTrigger: 'Right Trigger' };
const POINTER_LABELS: Record<PointerButton, string> = { left: 'Left', right: 'Right', middle: 'Middle' };
const anyOr = (count: number) => [{ value: 0, label: 'Any' }, ...Array.from({ length: count }, (_, i) => ({ value: i + 1, label: String(i + 1) }))];

// Pad 0 and channel 0 mean any pad and any channel.
const Pad = z.number().int().min(0).max(4);
const Channel = z.number().int().min(0).max(16);
const Byte = z.number().int().min(0).max(127);
const GamepadButtonSetting = z.strictObject({ pad: Pad, button: z.enum(GAMEPAD_BUTTONS) });
const NoteSetting = z.strictObject({ channel: Channel, anyNote: z.boolean(), note: Byte });
const PointerButtonSetting = z.strictObject({ button: z.enum(POINTER_BUTTONS) });

const padField: BlueprintField = { key: 'pad', label: 'Pad', kind: 'choice', options: anyOr(4) };
const buttonField: BlueprintField = { key: 'button', label: 'Button', kind: 'choice', options: GAMEPAD_BUTTONS.map(value => ({ value, label: BUTTON_LABELS[value] })) };
const channelField: BlueprintField = { key: 'channel', label: 'Channel', kind: 'choice', options: anyOr(16) };
const noteFields: BlueprintField[] = [channelField, { key: 'anyNote', label: 'Any Note', kind: 'boolean' }, { key: 'note', label: 'Note', kind: 'number', min: 0, max: 127 }];
const pointerField: BlueprintField = { key: 'button', label: 'Button', kind: 'choice', options: POINTER_BUTTONS.map(value => ({ value, label: POINTER_LABELS[value] })) };
const trigger = (): PortShape => ({ inputs: {}, outputs: { flow: 'flow' } });
const note = (): PortShape => ({ inputs: {}, outputs: { flow: 'flow', note: 'number', velocity: 'number' } });

export const DEVICE_NODES = [
 defineNode({ type: 'gamepad.pressed', label: 'On Gamepad Button Pressed', category: 'Input', keywords: ['gamepad', 'controller', 'joystick', 'button', 'down', 'xbox', 'playstation'], settings: GamepadButtonSetting, ports: trigger, defaults: () => ({ pad: 0, button: 'south' as const }), fields: [padField, buttonField] }),
 defineNode({ type: 'gamepad.released', label: 'On Gamepad Button Released', category: 'Input', keywords: ['gamepad', 'controller', 'joystick', 'button', 'up', 'release'], settings: GamepadButtonSetting, ports: trigger, defaults: () => ({ pad: 0, button: 'south' as const }), fields: [padField, buttonField] }),
 defineNode({ type: 'gamepad.held', label: 'Is Gamepad Button Held', category: 'Input', keywords: ['gamepad', 'controller', 'joystick', 'button', 'hold', 'down'], settings: GamepadButtonSetting, ports: () => ({ inputs: {}, outputs: { held: 'boolean' } }), defaults: () => ({ pad: 0, button: 'south' as const }), fields: [padField, buttonField] }),
 defineNode({ type: 'gamepad.axis', label: 'Gamepad Axis', category: 'Input', keywords: ['gamepad', 'controller', 'joystick', 'stick', 'trigger', 'analog'], settings: z.strictObject({ pad: Pad, axis: z.enum(GAMEPAD_AXES) }), ports: () => ({ inputs: {}, outputs: { value: 'number' } }), defaults: () => ({ pad: 0, axis: 'leftX' as const }), fields: [padField, { key: 'axis', label: 'Axis', kind: 'choice', options: GAMEPAD_AXES.map(value => ({ value, label: AXIS_LABELS[value] })) }] }),
 defineNode({ type: 'midi.noteOn', label: 'On MIDI Note On', category: 'Input', keywords: ['midi', 'note', 'key', 'pad', 'press', 'velocity'], settings: NoteSetting, ports: note, defaults: () => ({ channel: 0, anyNote: true, note: 60 }), fields: noteFields }),
 defineNode({ type: 'midi.noteOff', label: 'On MIDI Note Off', category: 'Input', keywords: ['midi', 'note', 'key', 'pad', 'release'], settings: NoteSetting, ports: note, defaults: () => ({ channel: 0, anyNote: true, note: 60 }), fields: noteFields }),
 defineNode({ type: 'midi.control', label: 'MIDI Control Value', category: 'Input', keywords: ['midi', 'cc', 'control', 'change', 'knob', 'fader', 'slider'], settings: z.strictObject({ channel: Channel, controller: Byte }), ports: () => ({ inputs: {}, outputs: { value: 'number', raw: 'number' } }), defaults: () => ({ channel: 0, controller: 1 }), fields: [channelField, { key: 'controller', label: 'Controller', kind: 'number', min: 0, max: 127 }] }),
 defineNode({ type: 'pointer.position', label: 'Pointer Position', category: 'Input', keywords: ['mouse', 'cursor', 'pointer', 'position', 'screen'], settings: empty, ports: () => ({ inputs: {}, outputs: { x: 'number', y: 'number' } }), defaults: () => ({}), fields: [] }),
 defineNode({ type: 'pointer.pressed', label: 'On Pointer Button Pressed', category: 'Input', keywords: ['mouse', 'click', 'pointer', 'button'], settings: PointerButtonSetting, ports: trigger, defaults: () => ({ button: 'left' as const }), fields: [pointerField] }),
 defineNode({ type: 'pointer.held', label: 'Is Pointer Button Held', category: 'Input', keywords: ['mouse', 'click', 'pointer', 'button', 'hold', 'drag'], settings: PointerButtonSetting, ports: () => ({ inputs: {}, outputs: { held: 'boolean' } }), defaults: () => ({ button: 'left' as const }), fields: [pointerField] }),
] as const;
