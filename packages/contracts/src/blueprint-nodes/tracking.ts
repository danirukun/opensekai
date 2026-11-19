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
const HeadPose = z.strictObject({ entityId: IdSchema });
export const PENDULUM_INPUT_KINDS = ['headPitch', 'headYaw', 'headRoll', 'headPositionX', 'headPositionY', 'headPositionZ', 'blendShape'] as const;
const signed = z.number().finite().min(-100).max(100);
const physical = z.number().finite().min(0).max(100);
const PendulumInput = z.strictObject({ kind: z.enum(PENDULUM_INPUT_KINDS), blendShape: z.enum(ARKIT_NAMES).nullable(), weight: signed, scale: signed, absolute: z.boolean(), clamp: z.tuple([signed, signed]) })
 .refine(input => input.clamp[0] <= input.clamp[1], { message: 'Clamp minimum must not be above maximum', path: ['clamp'] })
 .refine(input => input.kind !== 'blendShape' || input.blendShape !== null, { message: 'Blend shape is required', path: ['blendShape'] });
const PendulumArm = z.strictObject({ length: physical, mass: physical, drag: physical, spring: physical, damping: physical, gravity: signed });
const Pendulum = z.strictObject({ entityId: IdSchema, inputs: z.array(PendulumInput).min(1).max(8), inputSmoothing: z.number().min(0).max(5), arms: z.array(PendulumArm).max(4) });
export const PENDULUM_DEFAULT_INPUT: Readonly<z.output<typeof PendulumInput>> = { kind: 'headYaw', blendShape: null, weight: 1, scale: 5, absolute: false, clamp: [-100, 100] };
const defaultInput = (): z.output<typeof PendulumInput> => ({ ...PENDULUM_DEFAULT_INPUT, clamp: [...PENDULUM_DEFAULT_INPUT.clamp] });
// The Warudo arm values.
export const PENDULUM_DEFAULT_ARM: Readonly<z.output<typeof PendulumArm>> = { length: 10, mass: 0.25, drag: 0.25, spring: 0.5, damping: 0.5, gravity: 1 };
const PENDULUM_INPUT_LABELS = { headPitch: 'Head pitch', headYaw: 'Head yaw', headRoll: 'Head roll', headPositionX: 'Head X', headPositionY: 'Head Y', headPositionZ: 'Head Z', blendShape: 'Blend shape' } as const;
const flowOut = (): PortShape => ({ inputs: {}, outputs: { flow: 'flow' } });
const sourceField = { key: 'sourceId', label: 'Source', kind: 'trackingSource' } as const;
export const TRACKING_NODES = [
 defineNode({ type: 'tracking.getBlendShape', label: 'Get Tracking Blend Shape', category: 'Tracking', keywords: ['tracking', 'blendshape', 'blend shape', 'face', 'arkit', 'blink', 'mouth', 'read'], settings: blendShape, ports: () => ({ inputs: {}, outputs: { value: 'number' } }),
  defaults: refs => refs.avatarId ? { entityId: refs.avatarId, blendShape: 'eyeBlinkLeft' as const } : null,
  fields: [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'blendShape', label: 'Blend shape', kind: 'choice', options: ARKIT_NAMES.map(name => ({ value: name, label: name })) }] }),
 defineNode({ type: 'tracking.getHeadPose', label: 'Get Head Pose', category: 'Tracking', keywords: ['tracking', 'head', 'pose', 'rotation', 'position', 'tracked', 'face', 'read'], settings: HeadPose, ports: () => ({ inputs: {}, outputs: { rotation: 'vector3', position: 'vector3', tracked: 'number' } }),
  defaults: refs => refs.avatarId ? { entityId: refs.avatarId } : null,
  fields: [{ key: 'entityId', label: 'Character', kind: 'avatar' }] }),
 defineNode({ type: 'tracking.pendulum', label: 'Pendulum', category: 'Tracking', keywords: ['tracking', 'pendulum', 'physics', 'sway', 'swing', 'spring', 'arm', 'head', 'body', 'motion'], settings: Pendulum, ports: () => ({ inputs: {}, outputs: { value: 'number' } }),
  defaults: refs => refs.avatarId ? { entityId: refs.avatarId, inputs: [defaultInput()], inputSmoothing: 0.1, arms: [] } : null,
  fields: [{ key: 'entityId', label: 'Character', kind: 'avatar' },
   { key: 'inputs', label: 'Inputs', kind: 'rows', min: 1, max: 8, newRow: PENDULUM_DEFAULT_INPUT, columns: [
    { key: 'kind', label: 'Input', kind: 'choice', options: PENDULUM_INPUT_KINDS.map(kind => ({ value: kind, label: PENDULUM_INPUT_LABELS[kind] })) },
    { key: 'blendShape', label: 'Blend shape', kind: 'choice', options: [{ value: null, label: 'None' }, ...ARKIT_NAMES.map(name => ({ value: name, label: name }))] },
    { key: 'weight', label: 'Weight', kind: 'number' }, { key: 'scale', label: 'Scale', kind: 'number' },
    { key: 'clamp', label: 'Clamp', kind: 'range' }, { key: 'absolute', label: 'Abs', kind: 'boolean' }] },
   { key: 'inputSmoothing', label: 'Input smoothing (s)', kind: 'number', min: 0, max: 5 },
   { key: 'arms', label: 'Arms', kind: 'rows', min: 0, max: 4, newRow: PENDULUM_DEFAULT_ARM, columns: (['length', 'mass', 'drag', 'spring', 'damping', 'gravity'] as const).map(key => ({ key, label: key[0]!.toUpperCase() + key.slice(1), kind: 'number' as const })) }] }),
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
