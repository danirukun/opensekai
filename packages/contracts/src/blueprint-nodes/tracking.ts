import { z } from 'zod';
import { ARKIT_NAMES } from '../expressions';
import { defineNode, IdSchema, type PortShape } from './define';

const blendShape = z.strictObject({ entityId: IdSchema, blendShape: z.enum(ARKIT_NAMES) });
// The On Tracking Lost default; On Tracking Found counts a source as lost after the same time.
export const TRACKING_LOST_AFTER_SECONDS = 2;
const unit = z.number().min(0).max(1);
const Threshold = z.strictObject({ entityId: IdSchema, blendShape: z.enum(ARKIT_NAMES), threshold: unit, release: unit }).refine(settings => settings.release < settings.threshold, { message: 'Release must be below threshold', path: ['release'] });
const Lost = z.strictObject({ sourceId: IdSchema, after: z.number().min(0.1).max(60) });
const Found = z.strictObject({ sourceId: IdSchema });
const flowOut = (): PortShape => ({ inputs: {}, outputs: { flow: 'flow' } });
const sourceField = { key: 'sourceId', label: 'Source', kind: 'trackingSource' } as const;
export const TRACKING_NODES = [
 defineNode({ type: 'tracking.getBlendShape', label: 'Get Tracking Blend Shape', category: 'Tracking', keywords: ['tracking', 'blendshape', 'blend shape', 'face', 'arkit', 'blink', 'mouth', 'read'], settings: blendShape, ports: () => ({ inputs: {}, outputs: { value: 'number' } }),
  defaults: refs => refs.avatarId ? { entityId: refs.avatarId, blendShape: 'eyeBlinkLeft' as const } : null,
  fields: [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'blendShape', label: 'Blend shape', kind: 'choice', options: ARKIT_NAMES.map(name => ({ value: name, label: name })) }] }),
 defineNode({ type: 'tracking.onBlendShapeThreshold', label: 'On Blend Shape Threshold', category: 'Tracking', keywords: ['tracking', 'blendshape', 'blend shape', 'threshold', 'trigger', 'face', 'arkit', 'blink', 'mouth', 'cross'], settings: Threshold, ports: (): PortShape => ({ inputs: {}, outputs: { rise: 'flow', fall: 'flow', value: 'number' } }),
  defaults: refs => refs.avatarId ? { entityId: refs.avatarId, blendShape: 'jawOpen' as const, threshold: 0.5, release: 0.4 } : null,
  fields: [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'blendShape', label: 'Blend shape', kind: 'choice', options: ARKIT_NAMES.map(name => ({ value: name, label: name })) }, { key: 'threshold', label: 'Threshold', kind: 'number', min: 0, max: 1 }, { key: 'release', label: 'Release', kind: 'number', min: 0, max: 1 }] }),
 defineNode({ type: 'tracking.onLost', label: 'On Tracking Lost', category: 'Tracking', keywords: ['tracking', 'lost', 'signal', 'stale', 'disconnect', 'face', 'source'], settings: Lost, ports: flowOut,
  defaults: refs => refs.trackingSourceId ? { sourceId: refs.trackingSourceId, after: TRACKING_LOST_AFTER_SECONDS } : null,
  fields: [sourceField, { key: 'after', label: 'After (s)', kind: 'number', min: 0.1, max: 60 }] }),
 defineNode({ type: 'tracking.onFound', label: 'On Tracking Found', category: 'Tracking', keywords: ['tracking', 'found', 'signal', 'receiving', 'reconnect', 'face', 'source'], settings: Found, ports: flowOut,
  defaults: refs => refs.trackingSourceId ? { sourceId: refs.trackingSourceId } : null,
  fields: [sourceField] }),
] as const;
