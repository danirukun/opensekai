import { expect, it } from 'vitest';
import { defaultBlueprintSettings, makeSmokeScene, nodeDefinition, type BlueprintField } from '@opensekai/contracts';
import { addRow, cellNumber, fitPropertySettings, formatCases, formatList, keyLabel, keyOptions, newVariable, parseCases, parseList, parseScalar, propertyOptions, rangePart, removeRow, setRowCell, vectorParts } from '../src/blueprints/fields';

type RowsField = Extract<BlueprintField, { kind: 'rows' }>;

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
 expect(parseList('string[]', '"a b"\n " c" ')).toEqual(['a b', ' c']);
 expect(parseList('string[]', 'a\n1')).toEqual(['a', '1']);
 expect(parseList('vector3[]', '0, 1, 0\n1,1,1')).toEqual([[0, 1, 0], [1, 1, 1]]);
 expect(parseList('number[]', '')).toEqual([]);
 expect(parseList('number[]', Array.from({ length: 257 }, () => '1').join('\n'))).toBeNull();
 expect(formatList([[0, 1, 0], [1, 1, 1]])).toBe('0, 1, 0\n1, 1, 1');
 expect(parseList('vector3[]', formatList([[0, 1.5, -2]]))).toEqual([[0, 1.5, -2]]);
});

it('keeps each string list item through format and parse, also an empty item and a line break', () => {
 const items = ['', 'a\nb', ' padded ', '"quoted"', 'back\\slash', 'plain', 'say "hi"', '“curly”', "'single'", '"', 'it’s'];
 expect(parseList('string[]', formatList(items))).toEqual(items);
 expect(formatList(items).split('\n')).toHaveLength(items.length);
});

it('writes safe string items as plain text and JSON only where needed', () => {
 expect(formatList(['Ann', 'say "hi"', 'a, b'])).toBe('Ann\nsay "hi"\na, b');
 expect(formatList(['', ' x', 'a\nb', '"q"', '“q”'])).toBe('""\n" x"\n"a\\nb"\n"\\"q\\""\n"“q”"');
});

it('reads smart quotes from macOS as straight quotes', () => {
 expect(parseList('string[]', '“Ann”\n‘Bo’\n“mixed"\n"x”')).toEqual(['Ann', 'Bo', 'mixed', 'x']);
 expect(parseList('string[]', '“”\n“ a ”\n“a\\nb”')).toEqual(['', ' a ', 'a\nb']);
 expect(parseList('string[]', '“say \\“hi\\””')).toEqual(['say "hi"']);
 // A wrapped line that is not a JSON string stays literal text.
 expect(parseList('string[]', '"a"b"\n“\\x”')).toEqual(['"a"b"', '“\\x”']);
});

it('adds a row up to the field maximum, removes one down to the minimum, and edits a cell', () => {
 const definition = nodeDefinition('tracking.pendulum');
 const settings = defaultBlueprintSettings('tracking.pendulum', { avatarId: 'a', keystroke: { code: 'KeyH', control: false, alt: false, shift: false, meta: false } }) as Record<string, unknown>;
 const field = (key: string) => definition.fields.find(item => item.key === key) as RowsField;
 const inputs = field('inputs'), arms = field('arms');
 expect([inputs.min, inputs.max, arms.min, arms.max]).toEqual([1, 8, 0, 4]);
 const armed = addRow(settings, arms);
 expect(armed.arms).toEqual([{ length: 10, mass: 0.25, drag: 0.25, spring: 0.5, damping: 0.5, gravity: 1 }]);
 const full = Array.from({ length: 4 }, () => 0).reduce<Record<string, unknown>>(next => addRow(next, arms), settings);
 expect((full.arms as unknown[]).length).toBe(4);
 expect(addRow(full, arms)).toBe(full);
 expect(removeRow(armed, arms, 0).arms).toEqual([]);
 expect(removeRow(settings, inputs, 0)).toBe(settings);
 const two = addRow(settings, inputs);
 expect(two.inputs).toEqual([settings.inputs, settings.inputs].flat());
 const edited = setRowCell(two, inputs, 1, 'weight', 0.5);
 expect((edited.inputs as Record<string, unknown>[]).map(row => row.weight)).toEqual([1, 0.5]);
 expect(definition.settings.safeParse(edited).success).toBe(true);
 expect(settings.inputs).toEqual([{ kind: 'headYaw', blendShape: null, weight: 1, scale: 1, absolute: false, clamp: [-1, 1] }]);
 expect(removeRow(two, inputs, 0).inputs).toEqual([(edited.inputs as unknown[])[0]]);
});

it('reads a number cell and one end of a range cell', () => {
 expect(cellNumber('0.25')).toBe(0.25);
 expect(cellNumber('')).toBeNull();
 expect(cellNumber('x')).toBeNull();
 expect(rangePart([-1, 1], 0, '-0.5')).toEqual([-0.5, 1]);
 expect(rangePart([-1, 1], 1, '')).toBeNull();
});

it('names a blend shape when an input turns into a blend shape input', () => {
 const definition = nodeDefinition('tracking.pendulum');
 const settings = defaultBlueprintSettings('tracking.pendulum', { avatarId: 'a', keystroke: { code: 'KeyH', control: false, alt: false, shift: false, meta: false } }) as Record<string, unknown>;
 const inputs = definition.fields.find(item => item.key === 'inputs') as RowsField;
 const next = setRowCell(settings, inputs, 0, 'kind', 'blendShape');
 expect((next.inputs as Record<string, unknown>[])[0]).toMatchObject({ kind: 'blendShape', blendShape: 'jawOpen' });
 expect(definition.settings.safeParse(next).success).toBe(true);
});
