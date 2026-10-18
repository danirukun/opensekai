import { z } from 'zod';
import codes from '../../../../fixtures/protocol/keystroke-codes.json';
import { defineNode, empty, type PortShape, type PortType } from './define';
import { NameSetting, nameField, payloadField, PayloadSetting, type Payload } from './typed';

export const KEYSTROKE_CODES: readonly string[] = codes;
export const KeystrokeSettingsSchema = z.strictObject({
 code: z.enum(codes as [string, ...string[]]),
 control: z.boolean(), alt: z.boolean(), shift: z.boolean(), meta: z.boolean(),
});
export type KeystrokeSettings = z.infer<typeof KeystrokeSettingsSchema>;
export const keystrokeAccelerator = (s: KeystrokeSettings): string =>
 [s.control && 'Control', s.alt && 'Alt', s.shift && 'Shift', s.meta && 'Super', s.code].filter(Boolean).join('+');
export const keystrokeHasModifier = (s: KeystrokeSettings): boolean => s.control || s.alt || s.meta;

const EventSettings = z.strictObject({ name: NameSetting, payload: PayloadSetting });
const eventFields = [nameField, payloadField];
const payloadPort = (payload: Payload): Record<string, PortType> => (payload === 'none' ? {} : { payload });
const trigger = (): PortShape => ({ inputs: {}, outputs: { flow: 'flow' } });
export const EVENT_NODES = [
 defineNode({ type: 'event.manual', label: 'Manual Trigger', category: 'Events', keywords: ['run', 'button', 'start', 'test'], settings: empty, ports: trigger, defaults: () => ({}), fields: [] }),
 defineNode({ type: 'event.keystroke', label: 'On Keystroke Pressed', category: 'Events', keywords: ['hotkey', 'key', 'shortcut', 'keyboard'], settings: KeystrokeSettingsSchema, ports: trigger, defaults: refs => ({ ...refs.keystroke }), fields: [{ key: 'keystroke', label: 'Keystroke', kind: 'keystroke' }] }),
 defineNode({ type: 'event.update', label: 'On Update', category: 'Events', keywords: ['tick', 'frame', 'every', 'continuous', 'loop'], settings: empty, ports: () => ({ inputs: {}, outputs: { flow: 'flow', deltaSeconds: 'number' } }), defaults: () => ({}), fields: [] }),
 defineNode({ type: 'event.enable', label: 'On Enable', category: 'Events', keywords: ['start', 'setup', 'init', 'load', 'reset'], settings: empty, ports: trigger, defaults: () => ({}), fields: [] }),
 defineNode({ type: 'event.disable', label: 'On Disable', category: 'Events', keywords: ['stop', 'teardown', 'cleanup', 'exit', 'end'], settings: empty, ports: trigger, defaults: () => ({}), fields: [] }),
 defineNode({ type: 'event.emit', label: 'Emit Event', category: 'Events', keywords: ['send', 'broadcast', 'trigger', 'custom', 'message', 'signal'], settings: EventSettings, ports: s => ({ inputs: { flow: 'flow', ...payloadPort(s.payload) }, outputs: { exit: 'flow' } }), defaults: () => ({ name: 'Event', payload: 'none' as const }), fields: eventFields, dynamicPorts: true }),
 defineNode({ type: 'event.custom', label: 'On Event', category: 'Events', keywords: ['receive', 'listen', 'custom', 'message', 'signal'], settings: EventSettings, ports: s => ({ inputs: {}, outputs: { flow: 'flow', ...payloadPort(s.payload) } }), defaults: () => ({ name: 'Event', payload: 'none' as const }), fields: eventFields, dynamicPorts: true }),
] as const;
