import { expect, it } from 'vitest';
import template from '../src/blueprint-templates/upper-body-rotation.json';
import { BlueprintFileSchema, blueprintPorts, connectionType, importBlueprint, makeSmokeScene, upperBodyRotationTemplate } from '../src';

it('validates the Upper Body Rotation template against the current catalog', () => {
 const parsed = BlueprintFileSchema.safeParse(template);
 expect(parsed.success).toBe(true);
 const graph = parsed.data!.graph;
 expect(graph).toMatchObject({ name: 'Upper Body Rotation', enabled: true });
 const nodes = new Map(graph.nodes.map(node => [node.id, node]));
 for (const wire of graph.connections) expect(connectionType(nodes.get(wire.sourceNodeId)!, wire.sourcePort, nodes.get(wire.targetNodeId)!, wire.targetPort)).not.toBeNull();
 for (const node of graph.nodes)
  for (const [port, type] of Object.entries(blueprintPorts(node).inputs))
   if (type !== 'flow') expect(graph.connections.some(wire => wire.targetNodeId === node.id && wire.targetPort === port)).toBe(true);
 expect(graph.variables.map(variable => [variable.name, variable.default])).toEqual([['Chest Factor', 0.6], ['Spine Factor', 0.4], ['Hips Factor', 0.3]]);
 expect(graph.nodes.filter(node => node.type === 'character.offsetBoneRotation').map(node => node.settings)).toEqual(['chest', 'spine', 'hips'].map(bone => ({ entityId: 'character', bone })));
 expect(parsed.data!.references).toEqual([{ id: 'character', kind: 'avatar', name: 'Character' }]);
});

it('points the template at the given character and imports it enabled', () => {
 const file = upperBodyRotationTemplate({ id: 'performer', name: 'performer' });
 expect(file.references).toEqual([{ id: 'performer', kind: 'avatar', name: 'performer' }]);
 const imported = importBlueprint(file, makeSmokeScene(), () => 'g1');
 expect(imported).toMatchObject({ ok: true, data: { report: { enabled: true, missing: [], remapped: [] } } });
 expect(imported.ok && imported.data.graph.nodes.filter(node => 'entityId' in node.settings).every(node => (node.settings as { entityId: string }).entityId === 'performer')).toBe(true);
 expect(template.references[0]!.id).toBe('character');
});
