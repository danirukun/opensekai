import { z } from 'zod';
import type { DataType, ScalarValue } from '../blueprint-values';
import type { KeystrokeSettings } from './events';

export type PortType = 'flow' | DataType;
export interface PortShape { inputs: Record<string, PortType>; outputs: Record<string, PortType> }
export type NodeCategory = 'Events' | 'Input' | 'Flow' | 'Switches' | 'Timer' | 'Values' | 'Text' | 'Lists' | 'Math' | 'Logic' | 'Variables' | 'Scene' | 'Camera' | 'Character' | 'Tracking' | 'YouTube' | 'Blueprints' | 'Debug';
// Palette order.
export const NODE_CATEGORIES: readonly NodeCategory[] = ['Events', 'Input', 'Flow', 'Switches', 'Timer', 'Values', 'Text', 'Lists', 'Math', 'Logic', 'Variables', 'Scene', 'Camera', 'Character', 'Tracking', 'YouTube', 'Blueprints', 'Debug'];
export interface DefaultRefs { entityId?: string; avatarId?: string; expression?: string; cameraId?: string; outputId?: string; trackingSourceId?: string; keystroke: KeystrokeSettings; variables?: readonly { id: string; type: DataType }[]; graphId?: string }
export type BlueprintField =
 | { key: string; label: string; kind: 'number'; min?: number; max?: number }
 | { key: string; label: string; kind: 'boolean' }
 | { key: string; label: string; kind: 'count'; min: number; max: number }
 | { key: string; label: string; kind: 'entity' | 'camera' | 'output' | 'avatar' | 'expression' | 'trackingSource' }
 | { key: string; label: string; kind: 'integer'; min?: number; max?: number }
 | { key: string; label: string; kind: 'string'; maxLength?: number }
 | { key: string; label: string; kind: 'vector3' }
 | { key: string; label: string; kind: 'variable'; variableType: DataType }
 | { key: string; label: string; kind: 'cases' }
 | { key: string; label: string; kind: 'keystroke' }
 | { key: string; label: string; kind: 'key' | 'property' | 'space' | 'bone' }
 | { key: string; label: string; kind: 'blendshape' | 'easing' }
 | { key: string; label: string; kind: 'choice'; options: readonly { value: string | number; label: string }[] }
 | { key: string; label: string; kind: 'types'; options: readonly DataType[]; max: number }
 | { key: string; label: string; kind: 'stringCases' }
 // A variable of any type (or any list type); a choice also writes the variable type to `typeKey`.
 | { key: string; label: string; kind: 'typedVariable'; typeKey: string; lists?: boolean }
 // A graph of the show, by ID (Blueprint control nodes).
 | { key: string; label: string; kind: 'graph' };
export interface NodeDefinition<T extends string = string, S extends z.ZodType = z.ZodType> {
 type: T; label: string; category: NodeCategory; keywords: readonly string[];
 settings: S;
 ports(settings: z.output<S>): PortShape;
 // Null when the scene or graph lacks something the node needs.
 defaults(refs: DefaultRefs): z.output<S> | null;
 fields: readonly BlueprintField[];
 dynamicPorts?: boolean;
 // The value that an unconnected input without an inline value reads, when the type default (0, false, '') does not fit the node.
 inputDefaults?: Readonly<Record<string, ScalarValue>>;
}
export const defineNode = <const T extends string, S extends z.ZodType>(definition: NodeDefinition<T, S>): NodeDefinition<T, S> => definition;

export const IdSchema = z.string().min(1).max(256);
export const finite = z.number().finite();
export const empty = z.strictObject({});
export const exit = { exit: 'flow' } as const;
export const numbered = (prefix: string, count: number, type: PortType = 'flow'): Record<string, PortType> =>
 Object.fromEntries(Array.from({ length: count }, (_, i) => [`${prefix}${i}`, type]));
export const MAX_SWITCH_CASES = 8;
// The integer cases of Switch On Number and Switch On Integer.
export const IntegerCasesSchema = z.array(z.number().int().min(-1e6).max(1e6)).min(1).max(MAX_SWITCH_CASES).refine(cases => new Set(cases).size === cases.length, 'Duplicate case');
// A factory for node types without settings: fixed ports, shared keywords, and optional input defaults.
export const plainNodes = (category: NodeCategory, sharedKeywords: readonly string[] = []) =>
 <const T extends string>(type: T, label: string, keywords: readonly string[], ports: () => PortShape, inputDefaults?: Readonly<Record<string, ScalarValue>>) =>
  defineNode({ type, label, category, keywords: [...sharedKeywords, ...keywords], settings: empty, ports, defaults: () => ({}), fields: [], ...(inputDefaults ? { inputDefaults } : {}) });
