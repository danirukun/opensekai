import { expect, it } from 'vitest';
import { formatTemplate, indexOfValue, inRange, insertAt, parseInteger, parseNumber, removeAt, setAt, splitText, stringForm, substring } from '../src/blueprint-eval/data-helpers';

it('gives one string form for each scalar type', () => {
 expect([1.5, 0.1 + 0.2, -0, 42, true, false, 'a b', [1, -2.5, 0] as [number, number, number]].map(stringForm))
  .toEqual(['1.5', '0.30000000000000004', '0', '42', 'true', 'false', 'a b', '(1, -2.5, 0)']);
});

it('formats a template with arguments and escaped braces', () => {
 const cases: [string, unknown[], string][] = [
  ['{0} has {1} points', ['Ann', 3], 'Ann has 3 points'],
  ['{1}{0}{1}', ['a', 'b'], 'bab'],
  ['{{0}} {0}', [true], '{0} true'],
  ['{2} {x} {', ['a'], '{2} {x} {'],
  ['at {0}', [[1, 2, 3]], 'at (1, 2, 3)'],
 ];
 for (const [template, args, result] of cases) expect(formatTemplate(template, args.length, i => args[i] as never)).toBe(result);
});

it('reads only the arguments that the template uses, once each', () => {
 const reads: number[] = [];
 expect(formatTemplate('{2}-{0}-{2}', 4, i => { reads.push(i); return `a${i}`; })).toBe('a2-a0-a2');
 expect(reads).toEqual([2, 0]);
});

it('clamps Substring to the text', () => {
 expect([[1, 3], [-2, 2], [3, 99], [9, 1], [1, -1]].map(([start, length]) => substring('hello', start!, length!))).toEqual(['ell', 'he', 'lo', '', '']);
});

it('splits by a separator, or by code point when the separator is empty', () => {
 expect(splitText('a,b,,c', ',')).toEqual(['a', 'b', '', 'c']);
 expect(splitText('', ',')).toEqual(['']);
 expect(splitText('a😀b', '')).toEqual(['a', '😀', 'b']);
 expect(splitText('', '')).toEqual([]);
});

it('parses numbers and integers with an ok flag', () => {
 const numbers = [' 1.5 ', '-2', '+.5', '1e3', '3.', 'abc', '', '0x10', 'Infinity', '1e400', '1,5', '-0'].map(parseNumber);
 expect(numbers).toEqual([
  { value: 1.5, ok: true }, { value: -2, ok: true }, { value: 0.5, ok: true }, { value: 1000, ok: true }, { value: 3, ok: true },
  { value: 0, ok: false }, { value: 0, ok: false }, { value: 0, ok: false }, { value: 0, ok: false }, { value: 0, ok: false }, { value: 0, ok: false }, { value: 0, ok: true }]);
 expect(Object.is(parseNumber('-0').value, 0)).toBe(true);
 const integers = ['42', ' -7 ', '1.0', '1e3', '9007199254740992', '', '+3'].map(parseInteger);
 expect(integers).toEqual([{ value: 42, ok: true }, { value: -7, ok: true }, { value: 0, ok: false }, { value: 0, ok: false }, { value: 0, ok: false }, { value: 0, ok: false }, { value: 3, ok: true }]);
});

it('checks index ranges and changes lists without changing the input', () => {
 const list = Object.freeze(['a', 'b', 'c']);
 expect([-1, 0, 2, 3, 1.5].map(index => inRange(list, index))).toEqual([false, true, true, false, false]);
 expect(inRange(list, 3, true)).toBe(true);
 expect(insertAt(list, 3, 'd')).toEqual(['a', 'b', 'c', 'd']);
 expect(insertAt(list, 0, 'z')).toEqual(['z', 'a', 'b', 'c']);
 expect(removeAt(list, 1)).toEqual(['a', 'c']);
 expect(setAt(list, 2, 'x')).toEqual(['a', 'b', 'x']);
 expect(list).toEqual(['a', 'b', 'c']);
});

it('finds equal items, with Vector3 compared by parts', () => {
 expect(indexOfValue([[0, 0, 0], [1, 2, 3]], [1, 2, 3])).toBe(1);
 expect(indexOfValue([1, 2, 2], 2)).toBe(1);
 expect(indexOfValue(['a'], 'b')).toBe(-1);
});
