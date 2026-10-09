import { z } from 'zod';
import codes from '../../../../fixtures/protocol/keystroke-codes.json';
import { defineNode, empty, type PortShape } from './define';

export const KEYSTROKE_CODES: readonly string[] = codes;
export const KeystrokeSettingsSchema = z.strictObject({
 code: z.enum(codes as [string, ...string[]]),
 control: z.boolean(), alt: z.boolean(), shift: z.boolean(), meta: z.boolean(),
});
export type KeystrokeSettings = z.infer<typeof KeystrokeSettingsSchema>;
export const keystrokeAccelerator = (s: KeystrokeSettings): string =>
 [s.control && 'Control', s.alt && 'Alt', s.shift && 'Shift', s.meta && 'Super', s.code].filter(Boolean).join('+');
export const keystrokeHasModifier = (s: KeystrokeSettings): boolean => s.control || s.alt || s.meta;

const trigger = (): PortShape => ({ inputs: {}, outputs: { flow: 'flow' } });
export const EVENT_NODES = [
 defineNode({ type: 'event.manual', label: 'Manual Trigger', category: 'Events', keywords: ['run', 'button', 'start', 'test'], settings: empty, ports: trigger, defaults: () => ({}), fields: [] }),
 defineNode({ type: 'event.keystroke', label: 'On Keystroke Pressed', category: 'Events', keywords: ['hotkey', 'key', 'shortcut', 'keyboard'], settings: KeystrokeSettingsSchema, ports: trigger, defaults: refs => ({ ...refs.keystroke }), fields: [{ key: 'keystroke', label: 'Keystroke', kind: 'keystroke' }] }),
] as const;
