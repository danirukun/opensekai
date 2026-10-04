import { expect, it } from 'vitest';
import { BlueprintGraphSchema } from '../src/blueprint';

const graph = () => ({ schemaVersion: 1, id: 'graph', name: 'Show', nodes: [
 { id: 'start', version: 1, type: 'event.manual', settings: {}, position: { x: 0, y: 0 } },
], connections: [] });

it('accepts a versioned graph document', () => {
 expect(BlueprintGraphSchema.safeParse(graph()).success).toBe(true);
});

it('rejects duplicate IDs and invalid node settings', () => {
 const duplicate = graph();
 duplicate.nodes.push({ ...duplicate.nodes[0]! });
 expect(BlueprintGraphSchema.safeParse(duplicate).success).toBe(false);
 expect(BlueprintGraphSchema.safeParse({ ...graph(), nodes: [{ ...graph().nodes[0], settings: { arbitrary: true } }] }).success).toBe(false);
});

it('rejects unknown versions and graphs beyond size limits', () => {
 expect(BlueprintGraphSchema.safeParse({ ...graph(), schemaVersion: 2 }).success).toBe(false);
 expect(BlueprintGraphSchema.safeParse({ ...graph(), nodes: Array.from({ length: 129 }, (_, index) => ({ ...graph().nodes[0], id: String(index) })) }).success).toBe(false);
});
