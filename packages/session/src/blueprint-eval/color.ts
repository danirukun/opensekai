import { num } from './math';
import type { EvaluatorTable } from './types';

// A channel in 0–1 to the nearest of 255 steps; a non-finite channel reads 0.
const hexByte = (value: number) =>
 (Number.isFinite(value) ? Math.round(Math.min(Math.max(value, 0), 1) * 255) : 0).toString(16).padStart(2, '0');
const OFFSET: Record<string, number> = { r: 1, g: 3, b: 5 };

export const COLOR_EVALUATORS = {
 'color.make': { data: (_n, _o, read) => `#${hexByte(num(read, 'r'))}${hexByte(num(read, 'g'))}${hexByte(num(read, 'b'))}` },
 'color.break': { data: (_n, output, read) => { const at = OFFSET[output]!; return Number.parseInt(String(read('value')).slice(at, at + 2), 16) / 255; } },
} satisfies Partial<EvaluatorTable>;
