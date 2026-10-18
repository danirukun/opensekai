import { z } from 'zod';
import { DATA_TYPE_LABELS, DATA_TYPES, type DataType } from '../blueprint-values';
import type { BlueprintField } from './define';

// A setting that selects the data type of a node's ports (Select, Emit Event, On Event).
export const DataTypeSetting = z.enum(DATA_TYPES as [DataType, ...DataType[]]);
export const dataTypeField = (key: string, label: string): BlueprintField => ({ key, label, kind: 'choice', options: DATA_TYPES.map(value => ({ value, label: DATA_TYPE_LABELS[value] })) });
export const PayloadSetting = z.union([z.literal('none'), DataTypeSetting]);
export type Payload = z.infer<typeof PayloadSetting>;
export const payloadField: BlueprintField = { key: 'payload', label: 'Payload', kind: 'choice', options: [{ value: 'none', label: 'None' }, ...DATA_TYPES.map(value => ({ value, label: DATA_TYPE_LABELS[value] }))] };
// An event or timer name: case-sensitive, compared as stored.
export const NameSetting = z.string().trim().min(1).max(64);
export const nameField: BlueprintField = { key: 'name', label: 'Name', kind: 'string', maxLength: 64 };
