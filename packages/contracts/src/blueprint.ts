import { z } from 'zod';
import { BlueprintNodeSchema, keystrokeHasModifier } from './blueprint-nodes';
import { blueprintValueSchema, DATA_TYPES, type DataType, type ValueOf } from './blueprint-values';
const IdSchema = z.string().min(1).max(256);
const VariableName = z.string().trim().min(1).max(64);
export type BlueprintVariable = { [T in DataType]: { id: string; name: string; type: T; default: ValueOf<T> } }[DataType];
const variableOptions = DATA_TYPES.map(type => z.strictObject({ id: IdSchema, name: VariableName, type: z.literal(type), default: blueprintValueSchema(type) }));
export const BlueprintVariableSchema = z.discriminatedUnion('type', variableOptions as unknown as [(typeof variableOptions)[number], ...(typeof variableOptions)[number][]]) as unknown as z.ZodType<BlueprintVariable>;

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
 variables: z.array(BlueprintVariableSchema).max(32).default([]),
}).superRefine((graph, context) => {
 if (new Set(graph.nodes.map(node => node.id)).size !== graph.nodes.length)
  context.addIssue({ code: 'custom', message: 'Duplicate node ID', path: ['nodes'] });
 if (new Set(graph.connections.map(connection => connection.id)).size !== graph.connections.length)
  context.addIssue({ code: 'custom', message: 'Duplicate connection ID', path: ['connections'] });
 if (new Set(graph.variables.map(variable => variable.id)).size !== graph.variables.length)
  context.addIssue({ code: 'custom', message: 'Duplicate variable ID', path: ['variables'] });
 if (new Set(graph.variables.map(variable => variable.name)).size !== graph.variables.length)
  context.addIssue({ code: 'custom', message: 'Duplicate variable name', path: ['variables'] });
 for (const node of graph.nodes)
  if (node.type === 'event.keystroke' && !keystrokeHasModifier(node.settings))
   context.addIssue({ code: 'custom', message: 'Keystroke needs Control, Alt, or Meta', path: ['nodes'] });
});

export const MAX_BLUEPRINT_SET_BYTES = 192 * 1024;
export const BlueprintSetSchema = z.array(BlueprintGraphSchema).max(8)
 .refine(graphs => new Set(graphs.map(graph => graph.id)).size === graphs.length, 'Duplicate graph ID');

export type BlueprintConnection = z.infer<typeof BlueprintConnectionSchema>;
export type BlueprintGraph = z.infer<typeof BlueprintGraphSchema>;
