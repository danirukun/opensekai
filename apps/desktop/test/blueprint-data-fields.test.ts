import { expect, it } from 'vitest';
import { MAX_SWITCH_CASES, type BlueprintVariable } from '@opensekai/contracts';
import { chooseTypedVariable, formatStringCases, parseStringCases, resizeTypes, typedVariableOptions } from '../src/blueprints/data-fields';

it('keeps string cases as one JSON string on each line and rejects bad case lists', () => {
 for (const cases of [['happy', 'sad'], ['', 'two\nlines', ' a ', 'say "hi"']]) expect(parseStringCases(formatStringCases(cases))).toEqual(cases);
 expect(formatStringCases(['', 'a\nb'])).toBe('""\n"a\\nb"');
 expect(parseStringCases('"a"\n\n"b"')).toEqual(['a', 'b']);
 expect(parseStringCases('happy')).toBeNull();
 expect(parseStringCases('\n\n')).toBeNull();
 expect(parseStringCases('"a"\n"a"')).toBeNull();
 expect(parseStringCases(Array.from({ length: MAX_SWITCH_CASES + 1 }, (_, i) => `"c${i}"`).join('\n'))).toBeNull();
 expect(parseStringCases(JSON.stringify('x'.repeat(1025)))).toBeNull();
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
