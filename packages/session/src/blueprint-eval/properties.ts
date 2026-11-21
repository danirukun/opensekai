import { MATERIAL_EASING, readProperty, type Easing, type Id, type MaterialParameter, type PropertyValue, type Vec3 } from '@opensekai/contracts';
import type { MaterialWrite } from '../overrides';
import { withTransition } from '../tweens';
import type { EvaluatorTable } from './types';

// Set and Reset Material Property (B38 R22–R25). The session checks the material and clamps the value before the write.
type MaterialSettings = { entityId: Id; material: string; parameter: MaterialParameter; transitionSeconds?: number; easing?: Easing };
const materialWrite = (target: MaterialWrite['target'], settings: MaterialSettings, nodeId: Id, value: string | number | null): MaterialWrite =>
 ({ kind: 'setMaterial', entityId: settings.entityId, target, material: settings.material, parameter: settings.parameter, value, ...withTransition({ transitionSeconds: settings.transitionSeconds, easing: settings.easing ?? MATERIAL_EASING }), nodeId });

export const PROPERTY_EVALUATORS = {
 'property.get': { data: (node, _o, _r, _s, env) => {
  const entity = env.scene()?.entities.find(item => item.id === node.settings.entityId);
  const value = entity && readProperty(entity, node.settings.property);
  if (value === undefined) throw new RangeError('Property is unavailable');
  return value;
 } },
 'property.set': { flow: (node, c) => c.emit({ kind: 'setProperty', entityId: node.settings.entityId, property: node.settings.property, value: c.read('value') as PropertyValue, ...withTransition(node.settings), nodeId: node.id }) },
 'character.setMaterialProperty': { flow: (node, c) => c.emit(materialWrite('avatar', node.settings, node.id, c.read('value') as string | number)) },
 'character.resetMaterialProperty': { flow: (node, c) => c.emit(materialWrite('avatar', node.settings, node.id, null)) },
 'prop.setMaterialProperty': { flow: (node, c) => c.emit(materialWrite('mesh', node.settings, node.id, c.read('value') as string | number)) },
 'prop.resetMaterialProperty': { flow: (node, c) => c.emit(materialWrite('mesh', node.settings, node.id, null)) },
 'entity.move': { flow: (node, c) => c.emit({ kind: 'moveEntity', entityId: node.settings.entityId, space: node.settings.space, delta: c.read('delta') as Vec3 }) },
} satisfies Partial<EvaluatorTable>;
