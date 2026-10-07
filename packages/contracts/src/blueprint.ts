import { z } from 'zod';
import codes from '../../../fixtures/protocol/keystroke-codes.json';
const IdSchema = z.string().min(1).max(256);

const finite = z.number().finite();
export const BlueprintPositionSchema = z.strictObject({ x: finite, y: finite });
const base = { id: IdSchema, version: z.literal(1), position: BlueprintPositionSchema };
const empty = z.strictObject({});
const entity = z.strictObject({ entityId: IdSchema });

export const KEYSTROKE_CODES: readonly string[] = codes;
export const KeystrokeSettingsSchema = z.strictObject({
 code: z.enum(codes as [string, ...string[]]),
 control: z.boolean(), alt: z.boolean(), shift: z.boolean(), meta: z.boolean(),
});
export type KeystrokeSettings = z.infer<typeof KeystrokeSettingsSchema>;
export const keystrokeAccelerator = (s: KeystrokeSettings): string =>
 [s.control && 'Control', s.alt && 'Alt', s.shift && 'Shift', s.meta && 'Super', s.code].filter(Boolean).join('+');
export const keystrokeHasModifier = (s: KeystrokeSettings): boolean => s.control || s.alt || s.meta;

export const BlueprintNodeSchema = z.discriminatedUnion('type', [
 z.strictObject({ ...base, type: z.literal('event.manual'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('event.keystroke'), settings: KeystrokeSettingsSchema }),
 z.strictObject({ ...base, type: z.literal('value.number'), settings: z.strictObject({ value: finite }) }),
 z.strictObject({ ...base, type: z.literal('value.boolean'), settings: z.strictObject({ value: z.boolean() }) }),
 z.strictObject({ ...base, type: z.literal('math.add'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('logic.greater'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('logic.not'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('flow.branch'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('flow.sequence'), settings: z.strictObject({ outputs: z.number().int().min(2).max(8) }) }),
 z.strictObject({ ...base, type: z.literal('flow.flipFlop'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('flow.delay'), settings: z.strictObject({ seconds: finite.min(0).max(3600) }) }),
 z.strictObject({ ...base, type: z.literal('scene.setVisibility'), settings: entity }),
 z.strictObject({ ...base, type: z.literal('scene.toggleVisibility'), settings: entity }),
 z.strictObject({ ...base, type: z.literal('camera.switch'), settings: z.strictObject({ outputId: IdSchema, cameraId: IdSchema }) }),
]);

export const BlueprintConnectionSchema = z.strictObject({
 id: IdSchema,
 sourceNodeId: IdSchema,
 sourcePort: z.string().min(1).max(64),
 targetNodeId: IdSchema,
 targetPort: z.string().min(1).max(64),
});

export const BlueprintGraphSchema = z.strictObject({
 schemaVersion: z.literal(1),
 id: IdSchema,
 name: z.string().trim().min(1).max(128),
 enabled: z.boolean().default(true),
 nodes: z.array(BlueprintNodeSchema).max(128),
 connections: z.array(BlueprintConnectionSchema).max(256),
}).superRefine((graph, context) => {
 if (new Set(graph.nodes.map(node => node.id)).size !== graph.nodes.length)
  context.addIssue({ code: 'custom', message: 'Duplicate node ID', path: ['nodes'] });
 if (new Set(graph.connections.map(connection => connection.id)).size !== graph.connections.length)
  context.addIssue({ code: 'custom', message: 'Duplicate connection ID', path: ['connections'] });
 for (const node of graph.nodes)
  if (node.type === 'event.keystroke' && !keystrokeHasModifier(node.settings))
   context.addIssue({ code: 'custom', message: 'Keystroke needs Control, Alt, or Meta', path: ['nodes'] });
});

export const BlueprintSetSchema = z.array(BlueprintGraphSchema).max(8)
 .refine(graphs => new Set(graphs.map(graph => graph.id)).size === graphs.length, 'Duplicate graph ID');

export type BlueprintNode = z.infer<typeof BlueprintNodeSchema>;
export type BlueprintConnection = z.infer<typeof BlueprintConnectionSchema>;
export type BlueprintGraph = z.infer<typeof BlueprintGraphSchema>;
