import { z } from 'zod';
import type { KeystrokeSettings } from './events';

export type PortType = 'flow' | 'number' | 'boolean' | 'vector3';
export interface PortShape { inputs: Record<string, PortType>; outputs: Record<string, PortType> }
export type NodeCategory = 'Events' | 'Input' | 'Flow' | 'Values' | 'Math' | 'Logic' | 'Variables' | 'Scene';
export const NODE_CATEGORIES: readonly NodeCategory[] = ['Events', 'Input', 'Flow', 'Values', 'Math', 'Logic', 'Variables', 'Scene'];
export interface DefaultRefs { entityId?: string; cameraId?: string; outputId?: string; keystroke: KeystrokeSettings; variables?: readonly { id: string; type: 'number' | 'boolean' }[] }
export type BlueprintField =
 | { key: string; label: string; kind: 'number'; min?: number; max?: number }
 | { key: string; label: string; kind: 'boolean' }
 | { key: string; label: string; kind: 'count'; min: number; max: number }
 | { key: string; label: string; kind: 'entity' | 'camera' | 'output' }
 | { key: string; label: string; kind: 'variable'; variableType: 'number' | 'boolean' }
 | { key: string; label: string; kind: 'cases' }
 | { key: string; label: string; kind: 'keystroke' }
 | { key: string; label: string; kind: 'key' | 'property' | 'space' };
export interface NodeDefinition<T extends string = string, S extends z.ZodType = z.ZodType> {
 type: T; label: string; category: NodeCategory; keywords: readonly string[];
 settings: S;
 ports(settings: z.output<S>): PortShape;
 // Null when the scene or graph lacks something the node needs.
 defaults(refs: DefaultRefs): z.output<S> | null;
 fields: readonly BlueprintField[];
 dynamicPorts?: boolean;
}
export const defineNode = <const T extends string, S extends z.ZodType>(definition: NodeDefinition<T, S>): NodeDefinition<T, S> => definition;

export const IdSchema = z.string().min(1).max(256);
export const finite = z.number().finite();
export const empty = z.strictObject({});
export const exit = { exit: 'flow' } as const;
export const numbered = (prefix: string, count: number): Record<string, PortType> =>
 Object.fromEntries(Array.from({ length: count }, (_, i) => [`${prefix}${i}`, 'flow' as const]));
