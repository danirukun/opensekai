import { readProperty, type PropertyValue, type Vec3 } from '@opensekai/contracts';
import type { EvaluatorTable } from './types';

export const PROPERTY_EVALUATORS = {
 'property.get': { data: (node, _o, _r, _s, env) => {
  const entity = env.scene()?.entities.find(item => item.id === node.settings.entityId);
  const value = entity && readProperty(entity, node.settings.property);
  if (value === undefined) throw new RangeError('Property is unavailable');
  return value;
 } },
 'property.set': { flow: (node, c) => c.emit({ kind: 'setProperty', entityId: node.settings.entityId, property: node.settings.property, value: c.read('value') as PropertyValue }) },
 'entity.move': { flow: (node, c) => c.emit({ kind: 'moveEntity', entityId: node.settings.entityId, space: node.settings.space, delta: c.read('delta') as Vec3 }) },
} satisfies Partial<EvaluatorTable>;
