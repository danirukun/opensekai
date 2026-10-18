import { nextRandom } from '../blueprint-random';
import { num } from './math';
import type { EvaluatorTable, Read } from './types';

// Adding 0 turns -0 into 0.
export const safeInteger = (value: number): number => {
 if (!Number.isSafeInteger(value)) throw new RangeError('Blueprint integer is out of range');
 return value + 0;
};
const divisor = (read: Read) => {
 const b = num(read, 'b');
 if (b === 0) throw new RangeError('Blueprint integer division by zero');
 return b;
};
const unary = (f: (value: number) => number) => ({ data: (_n: unknown, _o: string, read: Read) => safeInteger(f(num(read, 'value'))) });
const binary = (f: (a: number, b: number) => number) => ({ data: (_n: unknown, _o: string, read: Read) => safeInteger(f(num(read, 'a'), num(read, 'b'))) });

export const INTEGER_EVALUATORS = {
 'integer.round': unary(Math.round),
 'integer.floor': unary(Math.floor),
 'integer.ceil': unary(Math.ceil),
 'integer.truncate': unary(Math.trunc),
 'integer.add': binary((a, b) => a + b),
 'integer.subtract': binary((a, b) => a - b),
 'integer.multiply': binary((a, b) => a * b),
 // Truncates toward zero; a - a % b is an exact multiple of b, so the division is exact.
 'integer.divide': { data: (_n, _o, read) => { const a = num(read, 'a'), b = divisor(read); return safeInteger((a - a % b) / b); } },
 // The remainder has the sign of the dividend, as in C# and JavaScript.
 'integer.modulo': { data: (_n, _o, read) => { const a = num(read, 'a'), b = divisor(read); return safeInteger(a % b); } },
 'integer.negate': unary(value => 0 - value),
 'integer.abs': unary(Math.abs),
 'integer.min': binary(Math.min),
 'integer.max': binary(Math.max),
 'integer.clamp': { data: (_n, _o, read) => {
  const min = num(read, 'min'), max = num(read, 'max');
  if (min > max) throw new RangeError('Clamp range is empty');
  return safeInteger(Math.min(Math.max(num(read, 'value'), min), max));
 } },
 // Inclusive range; the min keeps the result in range when the span is above 2^53.
 'integer.random': { data: (_n, _o, read, state) => {
  const min = num(read, 'min'), max = num(read, 'max');
  if (min > max) throw new RangeError('Random range is empty');
  const step = nextRandom(state.random);
  state.random = step.state;
  return safeInteger(Math.min(max, min + Math.floor(step.value * (max - min + 1))));
 } },
 'integer.isEven': { data: (_n, _o, read) => num(read, 'value') % 2 === 0 },
} satisfies Partial<EvaluatorTable>;
