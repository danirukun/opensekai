import { expect, it } from 'vitest';
import { blueprintNodeCatalog, blueprintPorts, nodeDefinition, unconnectedInputValue, withInlineInput, type BlueprintNode, type DefaultRefs } from '../src';

// B38 R22–R23: the four Set and Reset Material Property nodes.
const refs: DefaultRefs = { avatarId: 'a', material: 'Body', propId: 'p', propMaterial: 'Wall', keystroke: { code: 'KeyH', control: false, alt: false, shift: false, meta: false } };
const node = (type: string, settings: object) => ({ id: 'n', version: 1, type, settings, position: { x: 0, y: 0 } }) as BlueprintNode;

it('lists the four nodes with their labels, categories, ports, and defaults', () => {
 const catalog = blueprintNodeCatalog();
 const rows = ['character.setMaterialProperty', 'character.resetMaterialProperty', 'prop.setMaterialProperty', 'prop.resetMaterialProperty'].map(type => catalog.find(entry => entry.type === type)!);
 expect(rows.map(row => [row.label, row.category, row.portsDependOnSettings])).toEqual([
  ['Set Character Material Property', 'Character', true],
  ['Reset Character Material Property', 'Character', false],
  ['Set Prop Material Property', 'Scene', true],
  ['Reset Prop Material Property', 'Scene', false],
 ]);
 expect(rows[0]!.ports).toEqual({ inputs: { flow: 'flow', value: 'color' }, outputs: { exit: 'flow', transitionEnd: 'flow' } });
 expect(rows[1]!.ports).toEqual({ inputs: { flow: 'flow' }, outputs: { exit: 'flow', transitionEnd: 'flow' } });
 expect(rows[0]!.inputDefaults).toEqual({ value: '#ffffff' });
 expect(rows[0]!.settings).toMatchObject({ required: ['entityId', 'material', 'parameter'], properties: { transitionSeconds: { maximum: 3 } } });
 expect(nodeDefinition('character.setMaterialProperty').defaults(refs)).toEqual({ entityId: 'a', material: 'Body', parameter: 'baseColor', easing: 'OutCubic' });
 expect(nodeDefinition('prop.resetMaterialProperty').defaults(refs)).toEqual({ entityId: 'p', material: 'Wall', parameter: 'baseColor', easing: 'OutCubic' });
 expect(nodeDefinition('prop.setMaterialProperty').defaults({ ...refs, propMaterial: undefined })).toBeNull();
 expect(nodeDefinition('character.setMaterialProperty').fields.map(field => [field.key, field.label, field.kind])).toEqual([
  ['entityId', 'Character', 'avatar'], ['material', 'Material', 'material'], ['parameter', 'Property', 'materialParameter'], ['transitionSeconds', 'Transition (s)', 'number'], ['easing', 'Easing', 'easing'],
 ]);
 expect(nodeDefinition('prop.setMaterialProperty').fields[0]).toEqual({ key: 'entityId', label: 'Prop', kind: 'prop' });
});

it('types the value port by the parameter and reads the parameter default without an inline value', () => {
 const defaults: [string, string, string | number][] = [['baseColor', 'color', '#ffffff'], ['opacity', 'number', 1], ['emissionColor', 'color', '#000000'], ['emissionStrength', 'number', 1], ['shadeColor', 'color', '#ffffff'], ['rimColor', 'color', '#000000'], ['outlineColor', 'color', '#000000'], ['outlineWidth', 'number', 0]];
 for (const [parameter, type, value] of defaults) {
  const set = node('prop.setMaterialProperty', { entityId: 'p', material: 'Wall', parameter });
  expect(blueprintPorts(set).inputs.value).toBe(type);
  expect(unconnectedInputValue(set, 'value')).toBe(value);
 }
 const inline = withInlineInput(node('character.setMaterialProperty', { entityId: 'a', material: 'Body', parameter: 'opacity' }), 'value', 0.25);
 expect(unconnectedInputValue(inline, 'value')).toBe(0.25);
});

it('accepts a transition of 0 to 3 seconds and rejects an unknown parameter', () => {
 const settings = nodeDefinition('character.setMaterialProperty').settings;
 const base = { entityId: 'a', material: 'Body', parameter: 'baseColor' };
 expect(settings.safeParse(base).success).toBe(true);
 expect(settings.safeParse({ ...base, transitionSeconds: 3, easing: 'Linear' }).success).toBe(true);
 expect(settings.safeParse({ ...base, transitionSeconds: 3.5 }).success).toBe(false);
 expect(settings.safeParse({ ...base, parameter: 'metallic' }).success).toBe(false);
 expect(settings.safeParse({ ...base, material: '' }).success).toBe(false);
});
