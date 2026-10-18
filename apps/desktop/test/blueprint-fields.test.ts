import { expect, it } from 'vitest';
import { makeSmokeScene } from '@opensekai/contracts';
import { fitPropertySettings, formatCases, formatList, keyLabel, keyOptions, newVariable, parseCases, parseList, parseScalar, propertyOptions, vectorParts } from '../src/blueprints/fields';

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

it('labels key codes for the key picker', () => {
 expect(keyLabel('KeyW')).toBe('W');
 expect(keyLabel('Digit1')).toBe('1');
 expect(keyLabel('Numpad5')).toBe('Numpad 5');
 expect(keyLabel('ArrowUp')).toBe('Up Arrow');
 expect(keyLabel('Space')).toBe('Space');
 expect(keyOptions()).toContainEqual({ value: 'KeyW', label: 'W' });
});

it('lists the properties of the chosen entity and fixes a property that does not apply', () => {
 const scene = makeSmokeScene();
 expect(propertyOptions(scene, 'camera_wide').map(o => o.value)).toContain('fovDegrees');
 expect(propertyOptions(scene, 'performer').map(o => o.value)).not.toContain('fovDegrees');
 expect(fitPropertySettings({ entityId: 'performer', property: 'fovDegrees' }, scene)).toEqual({ entityId: 'performer', property: 'position' });
 expect(fitPropertySettings({ entityId: 'camera_wide', property: 'fovDegrees' }, scene)).toEqual({ entityId: 'camera_wide', property: 'fovDegrees' });
});

it('names and defaults a new variable of each data type', () => {
 expect(newVariable([], 'string[]', 'l')).toEqual({ id: 'l', name: 'String List 1', type: 'string[]', default: [] });
 expect(newVariable([], 'vector3', 'v')).toEqual({ id: 'v', name: 'Vector3 1', type: 'vector3', default: [0, 0, 0] });
});

it('parses inline and default text for each scalar type', () => {
 expect(parseScalar('number', '1.5')).toBe(1.5);
 expect(parseScalar('number', '')).toBeNull();
 expect(parseScalar('integer', '-4')).toBe(-4);
 expect(parseScalar('integer', '2.5')).toBeNull();
 expect(parseScalar('integer', '9007199254740992')).toBeNull();
 expect(parseScalar('string', ' a b ')).toBe(' a b ');
 expect(parseScalar('string', 'x'.repeat(1025))).toBeNull();
 expect(parseScalar('vector3', '1, -2, 0.5')).toEqual([1, -2, 0.5]);
 expect(parseScalar('vector3', '1, 2')).toBeNull();
 expect(parseScalar('vector3', '1, , 2')).toBeNull();
 expect(vectorParts([1, 2, 3], 1, '9')).toEqual([1, 9, 3]);
 expect(vectorParts([1, 2, 3], 1, 'x')).toBeNull();
});

it('reads a list default with one item on each line', () => {
 expect(parseList('integer[]', '1\n\n 2 \n3')).toEqual([1, 2, 3]);
 expect(parseList('integer[]', '1\n2.5')).toBeNull();
 expect(parseList('boolean[]', 'true\nFalse')).toEqual([true, false]);
 expect(parseList('boolean[]', 'yes')).toBeNull();
 expect(parseList('string[]', 'a b\n c')).toEqual(['a b', ' c']);
 expect(parseList('vector3[]', '0, 1, 0\n1,1,1')).toEqual([[0, 1, 0], [1, 1, 1]]);
 expect(parseList('number[]', '')).toEqual([]);
 expect(parseList('number[]', Array.from({ length: 257 }, () => '1').join('\n'))).toBeNull();
 expect(formatList([[0, 1, 0], [1, 1, 1]])).toBe('0, 1, 0\n1, 1, 1');
 expect(parseList('vector3[]', formatList([[0, 1.5, -2]]))).toEqual([[0, 1.5, -2]]);
});
