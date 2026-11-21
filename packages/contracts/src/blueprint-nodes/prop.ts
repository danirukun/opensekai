import { z } from 'zod';
import { EasingSchema } from '../easing';
import { materialParameter, MaterialNameSchema, MaterialParameterSchema } from '../material-parameters';
import { defineNode, exit, finite, IdSchema, type DefaultRefs } from './define';

// Set and Reset Material Property (B38 R22–R23). A material transition is short, so its range is 0–3 s, and its easing
// default is OutCubic.
export const MAX_MATERIAL_TRANSITION_SECONDS = 3;
export const MATERIAL_EASING = 'OutCubic' as const;
const settings = z.strictObject({
 entityId: IdSchema,
 material: MaterialNameSchema,
 parameter: MaterialParameterSchema,
 transitionSeconds: finite.min(0).max(MAX_MATERIAL_TRANSITION_SECONDS).optional(),
 easing: EasingSchema.optional(),
});
type Settings = z.output<typeof settings>;
const transitionFields = [
 { key: 'transitionSeconds', label: 'Transition (s)', kind: 'number', min: 0, max: MAX_MATERIAL_TRANSITION_SECONDS },
 { key: 'easing', label: 'Easing', kind: 'easing', fallback: MATERIAL_EASING },
] as const;
const outputs = { ...exit, transitionEnd: 'flow' } as const;

// The two nodes of one target: `avatar` for a character, `prop` for a prop.
export const materialNodes = <const P extends string>(prefix: P, target: 'avatar' | 'prop', category: 'Character' | 'Scene', noun: 'Character' | 'Prop') => {
 const fields = [{ key: 'entityId', label: noun, kind: target }, { key: 'material', label: 'Material', kind: 'material' }, { key: 'parameter', label: 'Property', kind: 'materialParameter' }, ...transitionFields] as const;
 const keywords = ['material', 'color', 'colour', 'opacity', 'emission', 'glow', 'outline', 'rim', 'shade', 'tint', 'transition', 'fade'];
 const defaults = (refs: DefaultRefs): Settings | null => {
  const entityId = target === 'avatar' ? refs.avatarId : refs.propId, material = target === 'avatar' ? refs.material : refs.propMaterial;
  return entityId && material ? { entityId, material, parameter: 'baseColor', easing: MATERIAL_EASING } : null;
 };
 return [
  defineNode({ type: `${prefix}.setMaterialProperty`, label: `Set ${noun} Material Property`, category, keywords, settings, dynamicPorts: true, defaults, fields,
   ports: s => ({ inputs: { flow: 'flow', value: materialParameter(s.parameter).type }, outputs }),
   inputDefaultsFor: s => ({ value: materialParameter(s.parameter).defaultValue }) }),
  defineNode({ type: `${prefix}.resetMaterialProperty`, label: `Reset ${noun} Material Property`, category, keywords: [...keywords, 'reset', 'restore'], settings, defaults, fields,
   ports: () => ({ inputs: { flow: 'flow' }, outputs }) }),
 ] as const;
};
export const PROP_NODES = materialNodes('prop', 'prop', 'Scene', 'Prop');
