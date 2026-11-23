import { expect, it } from 'vitest';
import { BLUEPRINT_LABELS, BlueprintNodeSchema, NODE_DEFINITIONS, blueprintNodeCatalog, blueprintPorts, defaultBlueprintSettings, nodeDefinition, type BlueprintKind, type BlueprintNode, type DefaultRefs } from '../src';

const refs: DefaultRefs = { entityId: 'e', avatarId: 'a', expression: 'happy', mesh: 'Hair', material: 'Body', propId: 'p', propMaterial: 'Wall', cameraId: 'c', outputId: 'o', trackingSourceId: 's', keystroke: { code: 'KeyH', control: true, alt: true, shift: false, meta: false }, variables: [{ id: 'n', type: 'number' }, { id: 'b', type: 'boolean' }, { id: 'i', type: 'integer' }, { id: 'l', type: 'string[]' }], graphId: 'g' };
const nodeOf = (type: string, settings: unknown) => ({ id: 'x', version: 1, type, settings, position: { x: 0, y: 0 } });
const ports = (type: BlueprintKind) => blueprintPorts(nodeOf(type, defaultBlueprintSettings(type, refs)) as BlueprintNode);

it('gives each node type defaults that its own schema accepts', () => {
 for (const definition of NODE_DEFINITIONS)
  expect(BlueprintNodeSchema.safeParse(nodeOf(definition.type, definition.defaults(refs))).success, definition.type).toBe(true);
});

it('has one definition per type, its label, and one field per settings key', () => {
 expect(new Set(NODE_DEFINITIONS.map(d => d.type)).size).toBe(NODE_DEFINITIONS.length);
 for (const definition of NODE_DEFINITIONS) {
  expect(BLUEPRINT_LABELS[definition.type]).toBe(definition.label);
  // Optional settings (a transition) have a field but no default value.
  const keys = Object.keys((definition.settings as unknown as { shape: object }).shape).sort();
  expect(Object.keys(definition.defaults(refs) ?? {}).every(key => keys.includes(key)), definition.type).toBe(true);
  const fieldKeys = definition.fields.flatMap(field => field.kind === 'keystroke' ? ['alt', 'code', 'control', 'meta', 'shift'] : field.kind === 'typedVariable' ? [field.key, field.typeKey] : [field.key]).sort();
  expect(fieldKeys, definition.type).toEqual(keys);
 }
});

it('keeps the ports of the existing node types', () => {
 const trigger = { inputs: {}, outputs: { flow: 'flow' } };
 const exit = { exit: 'flow' };
 expect(ports('event.manual')).toEqual(trigger);
 expect(ports('event.keystroke')).toEqual(trigger);
 expect(ports('value.number')).toEqual({ inputs: {}, outputs: { value: 'number' } });
 expect(ports('value.boolean')).toEqual({ inputs: {}, outputs: { value: 'boolean' } });
 expect(ports('math.add')).toEqual({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'number' } });
 expect(ports('logic.greater')).toEqual({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'boolean' } });
 expect(ports('logic.not')).toEqual({ inputs: { value: 'boolean' }, outputs: { result: 'boolean' } });
 expect(ports('flow.branch')).toEqual({ inputs: { flow: 'flow', condition: 'boolean' }, outputs: { true: 'flow', false: 'flow' } });
 expect(ports('flow.sequence')).toEqual({ inputs: { flow: 'flow' }, outputs: { then0: 'flow', then1: 'flow' } });
 expect(ports('flow.flipFlop')).toEqual({ inputs: { flow: 'flow' }, outputs: { a: 'flow', b: 'flow', isA: 'boolean' } });
 expect(ports('flow.delay')).toEqual({ inputs: { flow: 'flow' }, outputs: exit });
 expect(ports('scene.setVisibility')).toEqual({ inputs: { flow: 'flow', visible: 'boolean' }, outputs: exit });
 expect(ports('scene.toggleVisibility')).toEqual({ inputs: { flow: 'flow' }, outputs: exit });
 expect(ports('camera.switch')).toEqual({ inputs: { flow: 'flow' }, outputs: exit });
});

it('defaults the bone nodes to the first avatar with head and chest, and needs an avatar', () => {
 expect(defaultBlueprintSettings('character.getBoneRotation', refs)).toEqual({ entityId: 'a', bone: 'head' });
 expect(defaultBlueprintSettings('character.offsetBoneRotation', refs)).toEqual({ entityId: 'a', bone: 'chest' });
 expect(defaultBlueprintSettings('character.offsetBoneRotation', { keystroke: refs.keystroke })).toBeNull();
});

it('returns null defaults when the scene lacks the entity, camera, or output', () => {
 const bare: DefaultRefs = { keystroke: refs.keystroke };
 expect(defaultBlueprintSettings('scene.setVisibility', bare)).toBeNull();
 expect(defaultBlueprintSettings('camera.switch', { ...bare, cameraId: 'c' })).toBeNull();
 expect(defaultBlueprintSettings('flow.sequence', bare)).toEqual({ outputs: 2 });
});

it('publishes a catalog of every node with its ports and settings schema', () => {
 const catalog = blueprintNodeCatalog();
 expect(catalog).toHaveLength(NODE_DEFINITIONS.length);
 expect(catalog).toHaveLength(205);
 expect(catalog.find(entry => entry.type === 'math.lerp')!.inputDefaults).toEqual({ b: 1, t: 0.5 });
 expect(catalog.find(entry => entry.type === 'vector3.scale')!.inputDefaults).toEqual({ factor: 1 });
 expect(catalog.find(entry => entry.type === 'math.add')!.inputDefaults).toEqual({});
 const sequence = catalog.find(entry => entry.type === 'flow.sequence')!;
 expect(sequence).toMatchObject({ label: 'Sequence', category: 'Flow', portsDependOnSettings: true, settings: { type: 'object', required: ['outputs'] } });
 expect(catalog.find(entry => entry.type === 'variable.setNumber')!.ports).toEqual({ inputs: { flow: 'flow', value: 'number' }, outputs: { exit: 'flow' } });
 expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
 expect(catalog.find(entry => entry.type === 'character.getBoneRotation')).toMatchObject({ label: 'Get Bone Rotation', category: 'Character', ports: { inputs: {}, outputs: { euler: 'vector3' } }, settings: { required: ['entityId', 'bone'] } });
 expect(catalog.find(entry => entry.type === 'character.offsetBoneRotation')).toMatchObject({ label: 'Offset Bone Rotation', category: 'Character', ports: { inputs: { flow: 'flow', euler: 'vector3' }, outputs: { exit: 'flow' } } });
 expect(catalog.find(entry => entry.type === 'character.offsetBones')).toMatchObject({ label: 'Offset Bones', category: 'Character', ports: { inputs: { flow: 'flow', value: 'number', weight: 'number' }, outputs: { exit: 'flow' } }, inputDefaults: { weight: 1 }, settings: { required: ['entityId', 'bones', 'axis', 'intensity', 'offset'] } });
 expect(defaultBlueprintSettings('character.offsetBones', { avatarId: 'a', keystroke: refs.keystroke })).toEqual({ entityId: 'a', bones: ['spine'], axis: 'y', intensity: 1, offset: 0 });
 expect(nodeDefinition('character.offsetBones').settings.safeParse({ entityId: 'a', bones: [], axis: 'y', intensity: 1, offset: 0 }).success).toBe(false);
 expect(nodeDefinition('character.offsetBones').settings.safeParse({ entityId: 'a', bones: ['spine', 'spine'], axis: 'y', intensity: 1, offset: 0 }).success).toBe(false);
 expect(nodeDefinition('character.offsetBones').settings.safeParse({ entityId: 'a', bones: ['spine'], axis: 'w', intensity: 1, offset: 0 }).success).toBe(false);
 expect(nodeDefinition('character.offsetBones').settings.safeParse({ entityId: 'a', bones: ['spine'], axis: 'y', intensity: 361, offset: 0 }).success).toBe(false);
 expect(catalog.find(entry => entry.type === 'tracking.pendulum')).toMatchObject({ label: 'Pendulum', category: 'Tracking', ports: { inputs: {}, outputs: { value: 'number' } }, settings: { required: ['entityId', 'inputs', 'inputSmoothing', 'arms'] } });
 expect(catalog.find(entry => entry.type === 'character.setExpression')).toMatchObject({ label: 'Set Expression', category: 'Character', ports: { inputs: { flow: 'flow', active: 'boolean' }, outputs: { exit: 'flow' } }, settings: { required: ['entityId', 'expression'] } });
});

it('defines the bouncy spring and bone transform offset nodes', () => {
 const catalog = blueprintNodeCatalog();
 const bouncy = catalog.find(entry => entry.type === 'tracking.bouncySpring');
 expect(bouncy).toMatchObject({ category: 'Tracking', ports: { inputs: {}, outputs: { value: 'number' } }, settings: { required: ['entityId', 'pitchWeight', 'pitchScale', 'jawWeight', 'jawScale', 'spring', 'damping', 'inputSmoothing'] } });
 expect(defaultBlueprintSettings('tracking.bouncySpring', { avatarId: 'a', keystroke: refs.keystroke })).toEqual({ entityId: 'a', pitchWeight: 1, pitchScale: 1, jawWeight: 0.5, jawScale: 1, spring: 0.5, damping: 0.5, inputSmoothing: 0.05 });
 expect(defaultBlueprintSettings('tracking.bouncySpring', { keystroke: refs.keystroke })).toBeNull();
 const bouncySettings = nodeDefinition('tracking.bouncySpring').settings;
 const bouncyValid = { entityId: 'a', pitchWeight: 1, pitchScale: 1, jawWeight: 0.5, jawScale: 1, spring: 0.5, damping: 0.5, inputSmoothing: 0.05 };
 expect(bouncySettings.safeParse(bouncyValid).success).toBe(true);
 expect(bouncySettings.safeParse({ ...bouncyValid, spring: 101 }).success).toBe(false);
 expect(bouncySettings.safeParse({ ...bouncyValid, damping: -1 }).success).toBe(false);
 expect(bouncySettings.safeParse({ ...bouncyValid, inputSmoothing: 6 }).success).toBe(false);
 expect(nodeDefinition('tracking.bouncySpring').fields.map(field => field.label)).toEqual(['Character', 'Pitch weight', 'Pitch scale', 'Jaw weight', 'Jaw scale', 'Spring', 'Damping', 'Input smoothing (s)']);

 const translation = catalog.find(entry => entry.type === 'character.offsetBoneTranslation');
 expect(translation).toMatchObject({ category: 'Character', ports: { inputs: { flow: 'flow', value: 'number', weight: 'number' }, outputs: { exit: 'flow' } }, inputDefaults: { weight: 1 }, settings: { required: ['entityId', 'bones', 'axis', 'intensity', 'offset'] } });
 expect(translation?.keywords).toEqual(expect.arrayContaining(['translation', 'bounce', 'position']));
 const translationSettings = nodeDefinition('character.offsetBoneTranslation').settings;
 const translationValid = { entityId: 'a', bones: ['hips'], axis: 'y', intensity: 2, offset: -2 };
 expect(translationSettings.safeParse(translationValid).success).toBe(true);
 expect(translationSettings.safeParse({ ...translationValid, intensity: 2.1 }).success).toBe(false);
 expect(translationSettings.safeParse({ ...translationValid, offset: -2.1 }).success).toBe(false);
 expect(translationSettings.safeParse({ ...translationValid, bones: [] }).success).toBe(false);

 const scale = catalog.find(entry => entry.type === 'character.offsetBoneScale');
 expect(scale).toMatchObject({ category: 'Character', ports: { inputs: { flow: 'flow', value: 'number', weight: 'number' }, outputs: { exit: 'flow' } }, inputDefaults: { weight: 1 }, settings: { required: ['entityId', 'bones', 'intensity', 'offset'] } });
 const scaleSettings = nodeDefinition('character.offsetBoneScale').settings;
 const scaleValid = { entityId: 'a', bones: ['chest'], intensity: 1, offset: -1 };
 expect(scaleSettings.safeParse(scaleValid).success).toBe(true);
 expect(scaleSettings.safeParse({ ...scaleValid, axis: 'y' }).success).toBe(false);
 expect(scaleSettings.safeParse({ ...scaleValid, intensity: 1.1 }).success).toBe(false);
 expect(scaleSettings.safeParse({ ...scaleValid, offset: -1.1 }).success).toBe(false);
});
