import type { ScalarValue } from '@opensekai/contracts';

// The string form of a scalar value, shared by To String and Format String.
export function stringForm(value: ScalarValue): string {
 if (typeof value === 'string') return value;
 if (typeof value === 'boolean') return value ? 'true' : 'false';
 if (typeof value === 'number') return String(value === 0 ? 0 : value);
 return `(${value.map(part => stringForm(part)).join(', ')})`;
}
// `{n}` takes argument n; `{{` and `}}` give one brace; a placeholder without an argument stays as text.
export const formatTemplate = (template: string, args: readonly ScalarValue[]): string =>
 template.replace(/\{\{|\}\}|\{(\d+)\}/g, (match, index: string | undefined) =>
  match === '{{' ? '{' : match === '}}' ? '}' : Number(index) < args.length ? stringForm(args[Number(index)]!) : match);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
export function substring(text: string, start: number, length: number): string {
 const from = clamp(start, 0, text.length);
 return text.slice(from, from + clamp(length, 0, text.length - from));
}
// An empty separator splits into code points, so a surrogate pair stays whole.
export const splitText = (text: string, separator: string): string[] => separator === '' ? Array.from(text) : text.split(separator);
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const INTEGER = /^[+-]?\d+$/;
export function parseNumber(text: string): { value: number; ok: boolean } {
 const trimmed = text.trim(), value = Number(trimmed);
 return NUMBER.test(trimmed) && Number.isFinite(value) ? { value: value + 0, ok: true } : { value: 0, ok: false };
}
export function parseInteger(text: string): { value: number; ok: boolean } {
 const trimmed = text.trim(), value = Number(trimmed);
 return INTEGER.test(trimmed) && Number.isSafeInteger(value) ? { value: value + 0, ok: true } : { value: 0, ok: false };
}
export const sameValue = (a: ScalarValue, b: ScalarValue): boolean =>
 Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] && a[2] === b[2] : a === b;
export const indexOfValue = (list: readonly ScalarValue[], item: ScalarValue): number => list.findIndex(entry => sameValue(entry, item));
// `inclusiveEnd` allows the index equal to the length (Insert).
export const inRange = (list: readonly unknown[], index: number, inclusiveEnd = false): boolean =>
 Number.isInteger(index) && index >= 0 && (inclusiveEnd ? index <= list.length : index < list.length);
export const insertAt = <T>(list: readonly T[], index: number, item: T): T[] => [...list.slice(0, index), item, ...list.slice(index)];
export const removeAt = <T>(list: readonly T[], index: number): T[] => list.filter((_, i) => i !== index);
export const setAt = <T>(list: readonly T[], index: number, item: T): T[] => list.map((entry, i) => i === index ? item : entry);
