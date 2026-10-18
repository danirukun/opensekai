import { z } from 'zod';

export const DEVICE_KINDS = ['gamepad', 'midi', 'pointer'] as const;
export const GAMEPAD_BUTTONS = ['south', 'east', 'west', 'north', 'leftBumper', 'rightBumper', 'leftTrigger', 'rightTrigger', 'select', 'start', 'mode', 'leftStick', 'rightStick', 'dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight'] as const;
export const GAMEPAD_AXES = ['leftX', 'leftY', 'rightX', 'rightY', 'leftTrigger', 'rightTrigger'] as const;
export const POINTER_BUTTONS = ['left', 'right', 'middle'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export type GamepadButton = (typeof GAMEPAD_BUTTONS)[number];
export type GamepadAxis = (typeof GAMEPAD_AXES)[number];
export type PointerButton = (typeof POINTER_BUTTONS)[number];

const unique = <T>(list: readonly T[]) => new Set(list).size === list.length;
const byte = z.number().int().min(0).max(127);
const pad = z.number().int().min(1).max(4);
const channel = z.number().int().min(1).max(16);
const GamepadButtonSchema = z.enum(GAMEPAD_BUTTONS);
const PointerButtonSchema = z.enum(POINTER_BUTTONS);
const stick = z.number().finite().min(-1).max(1), trigger = z.number().finite().min(0).max(1);

export const DeviceEventSchema = z.discriminatedUnion('kind', [
 z.strictObject({ kind: z.literal('gamepadButton'), pad, button: GamepadButtonSchema, pressed: z.boolean() }),
 z.strictObject({ kind: z.literal('midiNote'), channel, note: byte, velocity: byte, on: z.boolean() }),
 z.strictObject({ kind: z.literal('midiControl'), channel, controller: byte, value: byte }),
 z.strictObject({ kind: z.literal('pointerButton'), button: PointerButtonSchema, pressed: z.boolean() }),
]);
export const GamepadSnapshotSchema = z.strictObject({
 pad,
 buttons: z.array(GamepadButtonSchema).min(1).max(GAMEPAD_BUTTONS.length).refine(unique, 'Duplicate button').optional(),
 axes: z.strictObject({ leftX: stick.optional(), leftY: stick.optional(), rightX: stick.optional(), rightY: stick.optional(), leftTrigger: trigger.optional(), rightTrigger: trigger.optional() }).optional(),
});
export const PointerSnapshotSchema = z.strictObject({
 x: z.number().finite().min(-16).max(16), y: z.number().finite().min(-16).max(16),
 buttons: z.array(PointerButtonSchema).min(1).max(POINTER_BUTTONS.length).refine(unique, 'Duplicate button').optional(),
});
export const DeviceUpdateSchema = z.strictObject({
 events: z.array(DeviceEventSchema).min(1).max(32).optional(),
 gamepads: z.array(GamepadSnapshotSchema).min(1).max(4).refine(list => unique(list.map(item => item.pad)), 'Duplicate pad').optional(),
 pointer: PointerSnapshotSchema.optional(),
}).refine(update => update.events !== undefined || update.gamepads !== undefined || update.pointer !== undefined, 'Device update is empty');
// The device kinds that enabled graphs read, sorted.
export const DeviceKindListSchema = z.array(z.enum(DEVICE_KINDS)).min(1).max(DEVICE_KINDS.length).refine(unique, 'Duplicate device kind');

export type DeviceEvent = z.infer<typeof DeviceEventSchema>;
export type GamepadSnapshot = z.infer<typeof GamepadSnapshotSchema>;
export type PointerSnapshot = z.infer<typeof PointerSnapshotSchema>;
export type DeviceUpdate = z.infer<typeof DeviceUpdateSchema>;
