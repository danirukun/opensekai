import { z } from 'zod';
const IdSchema = z.string().min(1).max(256);

const finite = z.number().finite();
const base = {
 id: IdSchema,
 version: z.literal(1),
 position: z.strictObject({ x: finite, y: finite }),
};
const empty = z.strictObject({});

export const BlueprintNodeSchema = z.discriminatedUnion('type', [
 z.strictObject({ ...base, type: z.literal('event.manual'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('value.number'), settings: z.strictObject({ value: finite }) }),
 z.strictObject({ ...base, type: z.literal('value.boolean'), settings: z.strictObject({ value: z.boolean() }) }),
 z.strictObject({ ...base, type: z.literal('math.add'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('logic.greater'), settings: empty }),
 z.strictObject({ ...base, type: z.literal('scene.setVisibility'), settings: z.strictObject({ entityId: IdSchema }) }),
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
 nodes: z.array(BlueprintNodeSchema).max(128),
 connections: z.array(BlueprintConnectionSchema).max(256),
}).superRefine((graph, context) => {
 if (new Set(graph.nodes.map(node => node.id)).size !== graph.nodes.length)
  context.addIssue({ code: 'custom', message: 'Duplicate node ID', path: ['nodes'] });
 if (new Set(graph.connections.map(connection => connection.id)).size !== graph.connections.length)
  context.addIssue({ code: 'custom', message: 'Duplicate connection ID', path: ['connections'] });
});

export type BlueprintNode = z.infer<typeof BlueprintNodeSchema>;
export type BlueprintConnection = z.infer<typeof BlueprintConnectionSchema>;
export type BlueprintGraph = z.infer<typeof BlueprintGraphSchema>;
