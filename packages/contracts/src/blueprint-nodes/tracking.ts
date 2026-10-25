import { z } from 'zod';
import { ARKIT_NAMES } from '../expressions';
import { defineNode, IdSchema } from './define';

const blendShape = z.strictObject({ entityId: IdSchema, blendShape: z.enum(ARKIT_NAMES) });
export const TRACKING_NODES = [
 defineNode({ type: 'tracking.getBlendShape', label: 'Get Tracking Blend Shape', category: 'Tracking', keywords: ['tracking', 'blendshape', 'blend shape', 'face', 'arkit', 'blink', 'mouth', 'read'], settings: blendShape, ports: () => ({ inputs: {}, outputs: { value: 'number' } }),
  defaults: refs => refs.avatarId ? { entityId: refs.avatarId, blendShape: 'eyeBlinkLeft' as const } : null,
  fields: [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'blendShape', label: 'Blend shape', kind: 'choice', options: ARKIT_NAMES.map(name => ({ value: name, label: name })) }] }),
] as const;
