import { expect, it } from 'vitest';
import template from '../src/blueprint-templates/upper-body-rotation.json';
import swayTemplate from '../src/blueprint-templates/camera-sway.json';
import { BlueprintFileSchema, blueprintPorts, cameraSwayTemplate, connectionType, exportBlueprint, importBlueprint, makeSmokeScene, upperBodyRotationTemplate } from '../src';

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

it('builds Camera Sway from a camera pose: a loop along the camera right axis with a narrower Field of View', () => {
 const parsed = BlueprintFileSchema.safeParse(swayTemplate);
 expect(parsed.success).toBe(true);
 const graph = parsed.data!.graph;
 const nodes = new Map(graph.nodes.map(node => [node.id, node]));
 for (const wire of graph.connections) expect(connectionType(nodes.get(wire.sourceNodeId)!, wire.sourcePort, nodes.get(wire.targetNodeId)!, wire.targetPort)).toBe('flow');
 expect(parsed.data!.references).toEqual([{ id: 'camera', kind: 'camera', name: 'Camera' }]);
 // A camera turned 90° about Y looks along -X, so its right axis is -Z.
 const turn = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
 const file = cameraSwayTemplate({ id: 'camera_wide', name: 'Wide', position: [1, 1.5, 3], rotation: turn, fovDegrees: 3 });
 const values = Object.fromEntries(file.graph.nodes.flatMap(node => node.type === 'property.set' ? [[node.id, node.inputs?.value]] : []));
 expect(values).toEqual({ slide: [1, 1.5, 2.5], zoom: 1, back: [1, 1.5, 3], unzoom: 3 });
 expect(file.graph.nodes.every(node => node.type !== 'property.set' || (node.settings.entityId === 'camera_wide' && node.settings.transitionSeconds === 3 && node.settings.easing === 'InOutSine'))).toBe(true);
 expect(cameraSwayTemplate({ id: 'c', name: 'C', position: [0, 0, 0], rotation: [0, 0, 0, 1], fovDegrees: 45 }).graph.nodes.find(node => node.id === 'zoom')?.inputs).toEqual({ value: 40 });
});

it('imports Camera Sway enabled with no missing reference, and remaps the camera by name', () => {
 const scene = makeSmokeScene();
 const camera = scene.entities.find(entity => entity.id === 'camera_wide')!;
 if (camera.kind !== 'camera') throw new Error('camera');
 const file = cameraSwayTemplate({ id: camera.id, name: camera.name, position: camera.transform.position, rotation: camera.transform.rotation, fovDegrees: camera.lens.fovDegrees });
 const imported = importBlueprint(file, scene, () => 'g1');
 expect(imported).toMatchObject({ ok: true, data: { report: { enabled: true, missing: [], remapped: [] } } });
 if (!imported.ok) throw new Error(imported.error.message);
 const exported = exportBlueprint(imported.data.graph, scene);
 const renamed = { ...scene, entities: scene.entities.map(entity => entity.id === camera.id ? { ...entity, id: 'cam2' } : entity) };
 const again = importBlueprint(exported, renamed, () => 'g2');
 expect(again).toMatchObject({ ok: true, data: { report: { missing: [], remapped: [{ name: camera.name, kind: 'camera', from: camera.id, to: 'cam2' }] } } });
 expect(again.ok && again.data.graph.nodes.filter(node => node.type === 'property.set').every(node => (node.settings as { entityId: string }).entityId === 'cam2')).toBe(true);
});
