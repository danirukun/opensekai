import { z } from 'zod';
import { canConnect, DATA_TYPES, defaultBlueprintValue, isBlueprintValue, isScalarType, MAX_INLINE_INPUTS, ScalarValueSchema, type BlueprintValue, type ScalarType, type ScalarValue } from '../blueprint-values';
import { finite, IdSchema, type DefaultRefs, type NodeDefinition, type PortShape, type PortType } from './define';
import { CHARACTER_NODES } from './character';
import { EVENT_NODES } from './events';
import { FLOW_NODES } from './flow';
import { INPUT_NODES } from './input';
import { INTEGER_NODES } from './integer';
import { LOGIC_NODES } from './logic';
import { MATH_NODES } from './math';
import { PROPERTY_NODES } from './properties';
import { SCENE_NODES } from './scene';
import { VALUE_NODES } from './values';
import { VARIABLE_NODES } from './variables';
import { VECTOR3_NODES } from './vector3';
import { DEVICE_NODES } from './devices';
import { LITERAL_NODES } from './literals';
import { TEXT_NODES } from './text';
import { LIST_NODES } from './lists';
import { SWITCH_NODES } from './switches';
import { TYPED_VARIABLE_NODES } from './typed-variables';
import { TIMER_NODES } from './timer';
import { GRAPH_CONTROL_NODES } from './graph-control';

export { defineNode, IntegerCasesSchema, MAX_SWITCH_CASES, NODE_CATEGORIES, type PortType, type PortShape, type NodeCategory, type DefaultRefs, type BlueprintField, type NodeDefinition } from './define';
export { KEYSTROKE_CODES, KeystrokeSettingsSchema, keystrokeAccelerator, keystrokeHasModifier, type KeystrokeSettings } from './events';

// Palette order inside a category follows this list.
export const NODE_DEFINITIONS = [...EVENT_NODES, ...INPUT_NODES, ...FLOW_NODES, ...VALUE_NODES, ...MATH_NODES, ...VECTOR3_NODES, ...LOGIC_NODES, ...VARIABLE_NODES, ...SCENE_NODES, ...PROPERTY_NODES, ...CHARACTER_NODES, ...DEVICE_NODES, ...INTEGER_NODES, ...LITERAL_NODES, ...TEXT_NODES, ...LIST_NODES, ...SWITCH_NODES, ...TYPED_VARIABLE_NODES, ...TIMER_NODES, ...GRAPH_CONTROL_NODES] as const;
type Definition = (typeof NODE_DEFINITIONS)[number];
export type BlueprintKind = Definition['type'];
export const BlueprintPositionSchema = z.strictObject({ x: finite, y: finite });
// Inline values of unconnected scalar data inputs, by port name.
export type InlineInputs = Partial<Record<string, ScalarValue>>;
type NodeOf<D extends Definition> = { id: string; version: 1; position: { x: number; y: number }; type: D['type']; settings: z.output<D['settings']>; inputs?: InlineInputs };
export type BlueprintNode = { [D in Definition as D['type']]: NodeOf<D> }[BlueprintKind];
export type BlueprintNodeOf<K extends BlueprintKind> = Extract<BlueprintNode, { type: K }>;

// A port name key; the pattern also keeps keys such as `__proto__` out of the parsed object.
const InlineInputsSchema = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}$/), ScalarValueSchema)
 .refine(inputs => Object.keys(inputs).length <= MAX_INLINE_INPUTS, 'Too many inline inputs');
const base = { id: IdSchema, version: z.literal(1), position: BlueprintPositionSchema, inputs: InlineInputsSchema.optional() };
const options = NODE_DEFINITIONS.map(d => z.strictObject({ ...base, type: z.literal(d.type), settings: d.settings }));
export const BlueprintNodeSchema = z.discriminatedUnion('type', options as unknown as [(typeof options)[number], ...(typeof options)[number][]])
 .superRefine((node, context) => {
  if (!inlineInputsFit(node as BlueprintNode)) context.addIssue({ code: 'custom', message: 'Invalid inline input', path: ['inputs'] });
 }) as unknown as z.ZodType<BlueprintNode>;

const byType = new Map<string, NodeDefinition>(NODE_DEFINITIONS.map(d => [d.type, d as unknown as NodeDefinition]));
export const nodeDefinition = (type: BlueprintKind): NodeDefinition => byType.get(type)!;
export const blueprintPorts = (node: BlueprintNode): PortShape => nodeDefinition(node.type).ports(node.settings);
export const BLUEPRINT_LABELS = Object.fromEntries(NODE_DEFINITIONS.map(d => [d.type, d.label])) as Record<BlueprintKind, string>;
export const defaultBlueprintSettings = (kind: BlueprintKind, refs: DefaultRefs): BlueprintNode['settings'] | null =>
 nodeDefinition(kind).defaults(refs) as BlueprintNode['settings'] | null;

export const ownPort = (ports: PortShape, side: 'inputs' | 'outputs', name: string): PortType | undefined =>
 Object.hasOwn(ports[side], name) ? ports[side][name] : undefined;
// The input port type when a wire from the output can enter the input (`canConnect`), or null when either port is missing or the types do not connect.
export function connectionType(source: BlueprintNode, sourcePort: string, target: BlueprintNode, targetPort: string): PortType | null {
 const output = ownPort(blueprintPorts(source), 'outputs', sourcePort), input = ownPort(blueprintPorts(target), 'inputs', targetPort);
 return output && input && canConnect(output, input) ? input : null;
}

// The functions below take the node's ports when the caller has them (for example from a compile), so a hot path does not compute them again.
// The scalar type of an input that can hold an inline value, or null.
export const inlineInputType = (node: BlueprintNode, port: string, ports: PortShape = blueprintPorts(node)): ScalarType | null => {
 const type = ownPort(ports, 'inputs', port);
 return type && isScalarType(type) ? type : null;
};
const fits = (ports: PortShape, port: string, value: unknown) => { const type = ownPort(ports, 'inputs', port); return type !== undefined && isScalarType(type) && isBlueprintValue(type, value); };
export const inlineInputsFit = (node: BlueprintNode, ports: PortShape = blueprintPorts(node)): boolean => {
 const entries = Object.entries(node.inputs ?? {});
 return entries.length <= MAX_INLINE_INPUTS && entries.every(([port, value]) => fits(ports, port, value));
};
// The value that an input without a wire reads: its inline value, else the node's input default, else the default of its type.
export function unconnectedInputValue(node: BlueprintNode, port: string, ports: PortShape = blueprintPorts(node)): BlueprintValue {
 const type = ownPort(ports, 'inputs', port);
 if (!type || type === 'flow') throw new RangeError('Not a data input');
 const inline = node.inputs && Object.hasOwn(node.inputs, port) ? node.inputs[port] : undefined;
 if (!isScalarType(type)) return defaultBlueprintValue(type);
 const fallback = nodeDefinition(node.type).inputDefaults;
 return inline ?? (fallback && Object.hasOwn(fallback, port) ? fallback[port]! : defaultBlueprintValue(type));
}
// A copy of the node with one inline value set, or removed when `value` is null. It does not check the value.
export function withInlineInput<N extends BlueprintNode>(node: N, port: string, value: ScalarValue | null): N {
 const { [port]: _old, ...others } = node.inputs ?? {};
 const inputs = value === null ? others : { ...others, [port]: value };
 const { inputs: _inputs, ...rest } = node;
 return (Object.keys(inputs).length === 0 ? rest : { ...rest, inputs }) as N;
}
// A copy of the node without the inline values that no longer fit its ports, for example after a settings change.
export function pruneInlineInputs<N extends BlueprintNode>(node: N, ports: PortShape = blueprintPorts(node)): N {
 if (!node.inputs) return node;
 const kept = Object.entries(node.inputs).filter(([port, value]) => fits(ports, port, value));
 const { inputs: _inputs, ...rest } = node;
 return (kept.length === 0 ? rest : { ...rest, inputs: Object.fromEntries(kept) }) as N;
}

const SAMPLE: DefaultRefs = { entityId: 'entity', cameraId: 'camera', outputId: 'output', avatarId: 'avatar', expression: 'happy', keystroke: { code: 'KeyH', control: true, alt: true, shift: false, meta: false }, variables: DATA_TYPES.map(type => ({ id: type, type })), graphId: 'graph' };
// Ports are shown for the default settings; `portsDependOnSettings` marks nodes whose port list changes with them.
export const blueprintNodeCatalog = () => NODE_DEFINITIONS.map(definition => ({
 type: definition.type, label: definition.label, category: definition.category, keywords: [...definition.keywords],
 ports: definition.ports(definition.defaults(SAMPLE) as never),
 portsDependOnSettings: 'dynamicPorts' in definition && definition.dynamicPorts === true,
 settings: z.toJSONSchema(definition.settings),
 // The value of an unconnected input without an inline value, where it is not the type default.
 inputDefaults: { ...('inputDefaults' in definition ? definition.inputDefaults : {}) } as Record<string, ScalarValue>,
}));
