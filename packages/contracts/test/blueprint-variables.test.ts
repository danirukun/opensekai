import { expect, it } from 'vitest';
import vectors from '../../../fixtures/protocol/blueprint-variables.json';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintGraphSchema, BlueprintSetSchema, type BlueprintGraph } from '../src';

const valid = () => structuredClone(vectors.valid);
const graphs = (): BlueprintGraph[] => [BlueprintGraphSchema.parse(valid())];

it('accepts typed variables and fills a missing key with an empty list', () => {
 expect(BlueprintGraphSchema.parse(valid()).variables).toHaveLength(2);
 expect(BlueprintSetSchema.parse(fixture.blueprints).every(graph => graph.variables.length === 0)).toBe(true);
});

it('rejects each invalid variable vector, duplicate names, and more than 32 variables', () => {
 for (const vector of vectors.invalid) expect(BlueprintGraphSchema.safeParse({ ...valid(), variables: vector.variables }).success, vector.name).toBe(false);
 expect(BlueprintGraphSchema.safeParse({ ...valid(), variables: [{ id: 'a', name: 'Same', type: 'number', default: 0 }, { id: 'b', name: 'Same', type: 'number', default: 0 }] }).success).toBe(false);
 const many = Array.from({ length: 33 }, (_, i) => ({ id: `v${i}`, name: `V${i}`, type: 'number', default: 0 }));
 expect(BlueprintGraphSchema.safeParse({ ...valid(), variables: many }).success).toBe(false);
});

it('adds, renames, retypes, and removes a variable', () => {
 const added = applyBlueprintOps(graphs(), [{ kind: 'addVariable', graphId: 'counter', variable: { id: 'speed', name: 'Speed', type: 'number', default: 2 } }]);
 expect(added.ok && added.data[0]!.variables.map(v => v.id)).toEqual(['count', 'armed', 'speed']);
 const renamed = applyBlueprintOps(graphs(), [{ kind: 'updateVariable', graphId: 'counter', variableId: 'count', name: 'Hits', default: 5 }]);
 expect(renamed.ok && renamed.data[0]!.variables[0]).toEqual({ id: 'count', name: 'Hits', type: 'number', default: 5 });
 const retyped = applyBlueprintOps(graphs(), [{ kind: 'updateVariable', graphId: 'counter', variableId: 'count', type: 'boolean' }]);
 expect(retyped.ok && retyped.data[0]!.variables[0]).toEqual({ id: 'count', name: 'Count', type: 'boolean', default: false });
 const removed = applyBlueprintOps(graphs(), [{ kind: 'removeVariable', graphId: 'counter', variableId: 'armed' }]);
 expect(removed.ok && removed.data[0]!.variables.map(v => v.id)).toEqual(['count']);
});

it('rejects variable operations that do not apply', () => {
 expect(applyBlueprintOps(graphs(), [{ kind: 'addVariable', graphId: 'counter', variable: { id: 'count', name: 'X', type: 'number', default: 0 } }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Duplicate variable ID' } });
 expect(applyBlueprintOps(graphs(), [{ kind: 'updateVariable', graphId: 'counter', variableId: 'gone', name: 'X' }])).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', message: 'Variable not found' } });
 expect(applyBlueprintOps(graphs(), [{ kind: 'removeVariable', graphId: 'counter', variableId: 'gone' }])).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(applyBlueprintOps(graphs(), [{ kind: 'updateVariable', graphId: 'counter', variableId: 'count', default: true }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid variable' } });
 expect(applyBlueprintOps(graphs(), [{ kind: 'updateVariable', graphId: 'counter', variableId: 'count', name: 'Armed' }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('treats a graph object without a variables key as having none', () => {
 const legacy = structuredClone(fixture.blueprints[0]) as unknown as BlueprintGraph;
 expect(applyBlueprintOps([legacy], [{ kind: 'addVariable', graphId: legacy.id, variable: { id: 'n', name: 'N', type: 'number', default: 0 } }]).ok).toBe(true);
});
