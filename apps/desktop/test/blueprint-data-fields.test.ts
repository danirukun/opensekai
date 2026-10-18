import { expect, it } from 'vitest';
import type { BlueprintVariable } from '@opensekai/contracts';
import { chooseTypedVariable, formatStringCases, parseStringCases, resizeTypes, typedVariableOptions } from '../src/blueprints/data-fields';

it('parses one string case on each line and rejects bad case lists', () => {
 expect(parseStringCases('happy\n\nsad, very\r\n a ')).toEqual(['happy', 'sad, very', ' a ']);
 expect(parseStringCases(formatStringCases(['a', 'b']))).toEqual(['a', 'b']);
 expect(parseStringCases('\n\n')).toBeNull();
 expect(parseStringCases('a\na')).toBeNull();
 expect(parseStringCases(Array.from({ length: 9 }, (_, i) => `c${i}`).join('\n'))).toBeNull();
 expect(parseStringCases('x'.repeat(1025))).toBeNull();
});

const variables: BlueprintVariable[] = [{ id: 'n', name: 'Score', type: 'number', default: 0 }, { id: 'l', name: 'Names', type: 'string[]', default: [] }];
it('lists variables for a typed variable field and writes the ID and type together', () => {
 expect(typedVariableOptions(variables, false)).toEqual([{ value: 'n', label: 'Score' }, { value: 'l', label: 'Names' }]);
 expect(typedVariableOptions(variables, true)).toEqual([{ value: 'l', label: 'Names' }]);
 expect(chooseTypedVariable({ variableId: 'n', type: 'number' }, 'variableId', 'type', variables, 'l')).toEqual({ variableId: 'l', type: 'string[]' });
 expect(chooseTypedVariable({ variableId: 'n', type: 'number' }, 'variableId', 'type', variables, 'gone')).toBeNull();
});

it('resizes a type list and keeps the entries that stay', () => {
 expect(resizeTypes(['integer', 'vector3'], 3, 'number')).toEqual(['integer', 'vector3', 'number']);
 expect(resizeTypes(['integer', 'vector3'], 1, 'number')).toEqual(['integer']);
});
