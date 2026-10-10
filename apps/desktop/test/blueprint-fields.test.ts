import { expect, it } from 'vitest';
import { formatCases, newVariable, parseCases } from '../src/blueprints/fields';

it('parses a list of 1 to 8 unique integers', () => {
 expect(parseCases('0, 1, -2')).toEqual([0, 1, -2]);
 expect(parseCases(' 3 ')).toEqual([3]);
 expect(parseCases('')).toBeNull();
 expect(parseCases('1, 1')).toBeNull();
 expect(parseCases('1.5')).toBeNull();
 expect(parseCases('1, x')).toBeNull();
 expect(parseCases('1,2,3,4,5,6,7,8,9')).toBeNull();
 expect(parseCases('2000000')).toBeNull();
 expect(formatCases([0, 1, -2])).toBe('0, 1, -2');
});

it('names a new variable after its type with the first free number', () => {
 expect(newVariable([], 'number', 'a')).toEqual({ id: 'a', name: 'Number 1', type: 'number', default: 0 });
 expect(newVariable([{ id: 'x', name: 'Boolean 1', type: 'boolean', default: true }], 'boolean', 'b')).toEqual({ id: 'b', name: 'Boolean 2', type: 'boolean', default: false });
});
