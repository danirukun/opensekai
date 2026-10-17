import { z } from 'zod';
import { finite, IdSchema, type DefaultRefs, type NodeDefinition, type PortShape, type PortType } from './define';
import { CHARACTER_NODES } from './character';
import { EVENT_NODES } from './events';
import { FLOW_NODES } from './flow';
import { INPUT_NODES } from './input';
import { LOGIC_NODES } from './logic';
import { MATH_NODES } from './math';
import { PROPERTY_NODES } from './properties';
import { SCENE_NODES } from './scene';
import { VALUE_NODES } from './values';
import { VARIABLE_NODES } from './variables';
import { VECTOR3_NODES } from './vector3';

export { defineNode, NODE_CATEGORIES, type PortType, type PortShape, type NodeCategory, type DefaultRefs, type BlueprintField, type NodeDefinition } from './define';
export { KEYSTROKE_CODES, KeystrokeSettingsSchema, keystrokeAccelerator, keystrokeHasModifier, type KeystrokeSettings } from './events';

// Palette order inside a category follows this list.
export const NODE_DEFINITIONS = [...EVENT_NODES, ...INPUT_NODES, ...FLOW_NODES, ...VALUE_NODES, ...MATH_NODES, ...VECTOR3_NODES, ...LOGIC_NODES, ...VARIABLE_NODES, ...SCENE_NODES, ...PROPERTY_NODES, ...CHARACTER_NODES] as const;
type Definition = (typeof NODE_DEFINITIONS)[number];
export type BlueprintKind = Definition['type'];
export const BlueprintPositionSchema = z.strictObject({ x: finite, y: finite });
type NodeOf<D extends Definition> = { id: string; version: 1; position: { x: number; y: number }; type: D['type']; settings: z.output<D['settings']> };
export type BlueprintNode = { [D in Definition as D['type']]: NodeOf<D> }[BlueprintKind];
export type BlueprintNodeOf<K extends BlueprintKind> = Extract<BlueprintNode, { type: K }>;

const base = { id: IdSchema, version: z.literal(1), position: BlueprintPositionSchema };
const options = NODE_DEFINITIONS.map(d => z.strictObject({ ...base, type: z.literal(d.type), settings: d.settings }));
export const BlueprintNodeSchema = z.discriminatedUnion('type', options as unknown as [(typeof options)[number], ...(typeof options)[number][]]) as unknown as z.ZodType<BlueprintNode>;

const byType = new Map<string, NodeDefinition>(NODE_DEFINITIONS.map(d => [d.type, d as unknown as NodeDefinition]));
export const nodeDefinition = (type: BlueprintKind): NodeDefinition => byType.get(type)!;
export const blueprintPorts = (node: BlueprintNode): PortShape => nodeDefinition(node.type).ports(node.settings);
export const BLUEPRINT_LABELS = Object.fromEntries(NODE_DEFINITIONS.map(d => [d.type, d.label])) as Record<BlueprintKind, string>;
export const defaultBlueprintSettings = (kind: BlueprintKind, refs: DefaultRefs): BlueprintNode['settings'] | null =>
 nodeDefinition(kind).defaults(refs) as BlueprintNode['settings'] | null;

export const ownPort = (ports: PortShape, side: 'inputs' | 'outputs', name: string): PortType | undefined =>
 Object.hasOwn(ports[side], name) ? ports[side][name] : undefined;
// The type shared by an output and an input, or null when either port is missing or their types differ.
export function connectionType(source: BlueprintNode, sourcePort: string, target: BlueprintNode, targetPort: string): PortType | null {
 const output = ownPort(blueprintPorts(source), 'outputs', sourcePort), input = ownPort(blueprintPorts(target), 'inputs', targetPort);
 return output && output === input ? output : null;
}

const SAMPLE: DefaultRefs = { entityId: 'entity', cameraId: 'camera', outputId: 'output', avatarId: 'avatar', expression: 'happy', keystroke: { code: 'KeyH', control: true, alt: true, shift: false, meta: false }, variables: [{ id: 'number', type: 'number' }, { id: 'boolean', type: 'boolean' }] };
// Ports are shown for the default settings; `portsDependOnSettings` marks nodes whose port list changes with them.
export const blueprintNodeCatalog = () => NODE_DEFINITIONS.map(definition => ({
 type: definition.type, label: definition.label, category: definition.category, keywords: [...definition.keywords],
 ports: definition.ports(definition.defaults(SAMPLE) as never),
 portsDependOnSettings: 'dynamicPorts' in definition && definition.dynamicPorts === true,
 settings: z.toJSONSchema(definition.settings),
}));
