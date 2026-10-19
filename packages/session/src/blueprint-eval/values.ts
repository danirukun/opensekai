import { nextRandom } from '../blueprint-random';
import { num } from './math';
import type { EvaluatorTable } from './types';

export const VALUE_EVALUATORS = {
 'value.number': { data: node => node.settings.value },
 'value.boolean': { data: node => node.settings.value },
 'math.add': { data: (_node, _output, read) => Number(read('a')) + Number(read('b')) },
 'math.subtract': { data: (_n, _o, read) => num(read, 'a') - num(read, 'b') },
 'math.multiply': { data: (_n, _o, read) => num(read, 'a') * num(read, 'b') },
 'math.divide': { data: (_n, _o, read) => num(read, 'a') / num(read, 'b') },
 'math.min': { data: (_n, _o, read) => Math.min(num(read, 'a'), num(read, 'b')) },
 'math.max': { data: (_n, _o, read) => Math.max(num(read, 'a'), num(read, 'b')) },
 'math.clamp': { data: (_n, _o, read) => {
  const min = num(read, 'min'), max = num(read, 'max');
  if (min > max) throw new RangeError('Clamp range is empty');
  return Math.min(Math.max(num(read, 'value'), min), max);
 } },
 'math.abs': { data: (_n, _o, read) => Math.abs(num(read, 'value')) },
 'math.round': { data: (_n, _o, read) => Math.round(num(read, 'value')) },
 'math.floor': { data: (_n, _o, read) => Math.floor(num(read, 'value')) },
 'math.random': { data: (_n, _o, read, state) => {
  const min = num(read, 'min'), max = num(read, 'max');
  if (min > max) throw new RangeError('Random range is empty');
  const step = nextRandom(state.random);
  state.random = step.state;
  return min + step.value * (max - min);
 } },
 'logic.greater': { data: (_node, _output, read) => Number(read('a')) > Number(read('b')) },
 'logic.less': { data: (_n, _o, read) => num(read, 'a') < num(read, 'b') },
 'logic.greaterOrEqual': { data: (_n, _o, read) => num(read, 'a') >= num(read, 'b') },
 'logic.lessOrEqual': { data: (_n, _o, read) => num(read, 'a') <= num(read, 'b') },
 'logic.equal': { data: (_n, _o, read) => num(read, 'a') === num(read, 'b') },
 'logic.not': { data: (_node, _output, read) => !read('value') },
 'logic.and': { data: (_n, _o, read) => { const a = Boolean(read('a')), b = Boolean(read('b')); return a && b; } },
 'logic.or': { data: (_n, _o, read) => { const a = Boolean(read('a')), b = Boolean(read('b')); return a || b; } },
} satisfies Partial<EvaluatorTable>;
