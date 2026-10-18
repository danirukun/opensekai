import { z } from 'zod';
import { DEBUG_LEVELS, DEBUG_VARIANTS, MAX_TOAST_SECONDS, MIN_TOAST_SECONDS } from '../blueprint-debug';
import { DATA_TYPE_LABELS, DATA_TYPES, type DataType } from '../blueprint-values';
import { defineNode, exit, finite } from './define';

const DataTypeSchema = z.enum(DATA_TYPES as [DataType, ...DataType[]]);
const capital = (name: string) => `${name[0]!.toUpperCase()}${name.slice(1)}`;
const typeOptions = DATA_TYPES.map(value => ({ value, label: DATA_TYPE_LABELS[value] }));

export const DEBUG_NODES = [
 defineNode({ type: 'debug.log', label: 'Log', category: 'Debug', keywords: ['debug', 'log', 'print', 'console', 'message', 'trace'],
  settings: z.strictObject({ level: z.enum(DEBUG_LEVELS) }),
  ports: () => ({ inputs: { flow: 'flow', message: 'string' }, outputs: { ...exit } }),
  defaults: () => ({ level: 'info' as const }),
  fields: [{ key: 'level', label: 'Level', kind: 'choice', options: DEBUG_LEVELS.map(value => ({ value, label: capital(value) })) }] }),
 defineNode({ type: 'debug.toast', label: 'Show Toast', category: 'Debug', keywords: ['debug', 'toast', 'notification', 'popup', 'alert', 'message'],
  settings: z.strictObject({ variant: z.enum(DEBUG_VARIANTS), durationSeconds: finite.min(MIN_TOAST_SECONDS).max(MAX_TOAST_SECONDS) }),
  ports: () => ({ inputs: { flow: 'flow', header: 'string', caption: 'string' }, outputs: { ...exit } }),
  defaults: () => ({ variant: 'info' as const, durationSeconds: 3 }),
  fields: [{ key: 'variant', label: 'Type', kind: 'choice', options: DEBUG_VARIANTS.map(value => ({ value, label: capital(value) })) }, { key: 'durationSeconds', label: 'Duration (s)', kind: 'number', min: MIN_TOAST_SECONDS, max: MAX_TOAST_SECONDS }] }),
 defineNode({ type: 'debug.value', label: 'Debug Value', category: 'Debug', keywords: ['debug', 'value', 'watch', 'inspect', 'probe', 'show'],
  settings: z.strictObject({ valueType: DataTypeSchema }),
  ports: settings => ({ inputs: { value: settings.valueType }, outputs: { value: settings.valueType } }),
  defaults: () => ({ valueType: 'number' as DataType }),
  fields: [{ key: 'valueType', label: 'Type', kind: 'choice', options: typeOptions }], dynamicPorts: true }),
 defineNode({ type: 'debug.event', label: 'Emit Debug Event', category: 'Debug', keywords: ['debug', 'event', 'emit', 'mcp', 'trace', 'signal'],
  settings: z.strictObject({ payloadType: z.union([z.literal('none'), DataTypeSchema]) }),
  ports: settings => ({ inputs: { flow: 'flow', name: 'string', ...(settings.payloadType === 'none' ? {} : { payload: settings.payloadType }) }, outputs: { ...exit } }),
  defaults: () => ({ payloadType: 'none' as DataType | 'none' }),
  fields: [{ key: 'payloadType', label: 'Payload', kind: 'choice', options: [{ value: 'none', label: 'None' }, ...typeOptions] }], dynamicPorts: true }),
] as const;
