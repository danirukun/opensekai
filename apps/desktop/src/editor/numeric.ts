import type { Reply } from '@opensekai/contracts';
export function parseFiniteNumber(text: string): Reply<number> {
 const value = Number(text);
 return text.trim() === '' || !Number.isFinite(value)
  ? { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid number', ids: [] } }
  : { ok: true, data: value };
}
