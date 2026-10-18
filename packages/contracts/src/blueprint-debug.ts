import { z } from 'zod';
import { DATA_TYPES, isListType, itemType, MAX_BLUEPRINT_STRING_LENGTH, type BlueprintValue, type DataType, type ScalarType } from './blueprint-values';
import type { Vec3 } from './types';

export const DEBUG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;
export type DebugLevel = (typeof DEBUG_LEVELS)[number];
export const DEBUG_VARIANTS = ['success', 'info', 'warning', 'error'] as const;
export type DebugVariant = (typeof DEBUG_VARIANTS)[number];
export const MAX_DEBUG_ENTRIES = 1000;
export const MAX_DEBUG_VALUES = 64;
export const MAX_DEBUG_PAGE = 50;
export const MAX_DEBUG_TEXT = 256;
export const DEBUG_NODE_RATE = 10;
export const DEBUG_TOAST_RATE = 5;
export const DEBUG_WINDOW_MS = 1000;
export const MIN_TOAST_SECONDS = 1;
export const MAX_TOAST_SECONDS = 30;

// Debug text is shown as text only; control characters would break a one-line log row.
export const plainDebugText = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');

// Cuts at a code point boundary, so the text stays valid UTF-16 for the host.
const cut = (text: string): string => {
 if (text.length <= MAX_DEBUG_TEXT) return text;
 let end = MAX_DEBUG_TEXT - 1;
 const code = text.charCodeAt(end - 1);
 if (code >= 0xd800 && code <= 0xdbff) end -= 1;
 return `${text.slice(0, end)}…`;
};
const scalarText = (type: ScalarType, value: unknown): string =>
 type === 'string' ? JSON.stringify(value) : type === 'vector3' ? `(${(value as Vec3).map(String).join(', ')})` : String(value);
export function formatDebugValue(type: DataType, value: BlueprintValue): string {
 if (!isListType(type)) return cut(scalarText(type as ScalarType, value));
 const item = itemType(type);
 return cut(`[${(value as readonly unknown[]).map(entry => scalarText(item, entry)).join(', ')}]`);
}

const u = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Id = z.string().min(1).max(256);
const Text = z.string().max(MAX_BLUEPRINT_STRING_LENGTH);
const ValueText = z.string().max(MAX_DEBUG_TEXT);
export const DebugDataTypeSchema = z.enum(DATA_TYPES as [DataType, ...DataType[]]);
const base = { seq: u.min(1), atMs: z.number().finite().nonnegative(), graphId: Id, nodeId: Id, dropped: u.min(1).optional() };
export const DebugEntrySchema = z.discriminatedUnion('kind', [
 z.strictObject({ ...base, kind: z.literal('log'), level: z.enum(DEBUG_LEVELS), message: Text }),
 z.strictObject({ ...base, kind: z.literal('toast'), variant: z.enum(DEBUG_VARIANTS), header: Text, caption: Text, durationSeconds: z.number().finite().min(MIN_TOAST_SECONDS).max(MAX_TOAST_SECONDS) }),
 z.strictObject({ ...base, kind: z.literal('event'), name: Text, valueType: DebugDataTypeSchema.optional(), text: ValueText.optional() }),
]);
export const DebugValueSchema = z.strictObject({ graphId: Id, nodeId: Id, valueType: DebugDataTypeSchema, text: ValueText, changedMs: z.number().finite().nonnegative(), seq: u.min(1) });
export const BlueprintDebugSchema = z.strictObject({
 latest: u, next: u, dropped: u,
 entries: z.array(DebugEntrySchema).max(MAX_DEBUG_PAGE),
 values: z.array(DebugValueSchema).max(MAX_DEBUG_VALUES),
});
export const BlueprintDebugParamsSchema = z.strictObject({ since: u.optional() });
export type DebugEntry = z.infer<typeof DebugEntrySchema>;
export type DebugValue = z.infer<typeof DebugValueSchema>;
export type BlueprintDebug = z.infer<typeof BlueprintDebugSchema>;
