import { expect, it } from 'vitest';
import template from '../src/blueprint-templates/upper-body-rotation.json';
import swayTemplate from '../src/blueprint-templates/camera-sway.json';
import faceTemplate from '../src/blueprint-templates/face-only-body-motion.json';
import { BlueprintFileSchema, blueprintPorts, cameraSwayTemplate, connectionType, exportBlueprint, faceOnlyBodyMotionTemplate, importBlueprint, makeSmokeScene, upperBodyRotationTemplate } from '../src';

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

it('builds Face-Only Body Motion for one character with the Warudo reference values', () => {
 const parsed = BlueprintFileSchema.safeParse(faceTemplate);
 expect(parsed.success).toBe(true);
 const file = faceOnlyBodyMotionTemplate({ id: 'performer', name: 'performer' });
 expect(BlueprintFileSchema.safeParse(file).success).toBe(true);
 const graph = file.graph;
 expect(graph).toMatchObject({ name: 'Face-Only Body Motion', enabled: true });
 expect(graph.nodes.length).toBeLessThanOrEqual(128);
 expect(graph.connections.length).toBeLessThanOrEqual(256);
 expect(file.references).toEqual([{ id: 'performer', kind: 'avatar', name: 'performer' }]);
 const targeted = graph.nodes.filter(node => 'entityId' in node.settings);
 expect(targeted.length).toBeGreaterThan(0);
 expect(targeted.every(node => (node.settings as { entityId: string }).entityId === 'performer')).toBe(true);
 const nodes = new Map(graph.nodes.map(node => [node.id, node]));
 for (const wire of graph.connections) expect(connectionType(nodes.get(wire.sourceNodeId)!, wire.sourcePort, nodes.get(wire.targetNodeId)!, wire.targetPort)).not.toBeNull();
 const offsets = graph.nodes.filter(node => node.type === 'character.offsetBones');
 // Every Offset Bones node runs on the one update chain and fades with the head.
 for (const node of offsets) {
  expect(graph.connections.filter(wire => wire.targetNodeId === node.id && wire.targetPort === 'flow')).toHaveLength(1);
  expect(graph.connections.find(wire => wire.targetNodeId === node.id && wire.targetPort === 'weight')?.sourceNodeId).toBe('fade');
 }
 expect(nodes.get('fade')?.inputs).toEqual({ smoothTime: 2 });
 const arm = { length: 10, mass: 0.25, drag: 0.25, spring: 0.5, damping: 0.5, gravity: 1 };
 const sway = { entityId: 'performer', inputSmoothing: 0.1, arms: [arm, arm, arm, arm], inputs: [
  { kind: 'headPitch', blendShape: null, weight: 0.33, scale: 20, absolute: false, clamp: [-100, 100] },
  { kind: 'headYaw', blendShape: null, weight: 0.33, scale: 20, absolute: true, clamp: [-100, 100] },
  { kind: 'headPositionZ', blendShape: null, weight: 0.5, scale: 20, absolute: false, clamp: [-100, 100] }] };
 expect(nodes.get('arms')?.settings).toEqual(sway);
 expect(nodes.get('fingers')?.settings).toEqual(sway);
 expect(nodes.get('lean')?.settings).toEqual({ entityId: 'performer', inputSmoothing: 0.4, arms: [], inputs: [{ kind: 'headPositionZ', blendShape: null, weight: 1, scale: 5, absolute: false, clamp: [0, 1.5] }] });
 const group = (source: string) => offsets.filter(node => graph.connections.some(wire => wire.targetNodeId === node.id && wire.targetPort === 'value' && wire.sourceNodeId === source))
  .map(node => { const { bones, axis, intensity, offset } = node.settings as { bones: string[]; axis: string; intensity: number; offset: number }; return [bones.join(' '), axis, intensity, offset]; });
 expect(group('lean')).toEqual([['spine', 'x', 45, 0], ['neck', 'x', -15, 0], ['head', 'x', -40, 0]]);
 expect(group('arms')).toEqual([['rightShoulder', 'z', 2, 5], ['leftShoulder', 'z', -2, -5], ['rightUpperArm rightLowerArm', 'z', 2, 0], ['leftUpperArm leftLowerArm', 'z', -2, 0], ['rightHand', 'z', 10, 0], ['leftHand', 'z', -10, 0]]);
 const fingers = (side: string) => ['Index', 'Middle', 'Ring', 'Little'].flatMap(finger => ['Proximal', 'Intermediate', 'Distal'].map(segment => side + finger + segment)).join(' ');
 expect(group('fingers')).toEqual([[fingers('right'), 'z', 10, 0], ['rightThumbMetacarpal rightThumbProximal rightThumbDistal', 'y', 10, 0], [fingers('left'), 'z', -10, 0], ['leftThumbMetacarpal leftThumbProximal leftThumbDistal', 'y', -10, 0]]);
 // Body follows head: direction (0.5, 1, 0.5) × intensity 0.5 × sign (+1, +1, -1) × share (spine 0.5, chest 0.25, neck -0.75), from graph variables.
 expect(graph.variables.map(variable => [variable.name, variable.type, variable.default])).toEqual([['Body Intensity', 'number', 0.5], ['Body Direction X', 'number', 0.5], ['Body Direction Y', 'number', 1], ['Body Direction Z', 'number', 0.5], ['Spine', 'number', 0.5], ['Chest', 'number', 0.25], ['Neck Compensation', 'number', 0.75]]);
 const defaults = new Map(graph.variables.map(variable => [variable.id, variable.default as number]));
 // The value of a data output for a head angle vector, from variable defaults, inline inputs, and products.
 const evaluate = (nodeId: string, port: string, head: number[]): number => {
  const node = nodes.get(nodeId)!;
  const input = (name: string) => { const wire = graph.connections.find(item => item.targetNodeId === nodeId && item.targetPort === name); return wire ? evaluate(wire.sourceNodeId, wire.sourcePort, head) : node.inputs![name] as number; };
  if (node.type === 'vector3.break') return head['xyz'.indexOf(port)]!;
  if (node.type === 'variable.getNumber') return defaults.get((node.settings as { variableId: string }).variableId)!;
  if (node.type === 'math.multiply') return input('a') * input('b');
  throw new Error(node.type);
 };
 const follow = offsets.filter(node => node.id.startsWith('follow-')).map(node => {
  const wire = graph.connections.find(item => item.targetNodeId === node.id && item.targetPort === 'value')!;
  const { bones, axis, intensity, offset } = node.settings as { bones: string[]; axis: string; intensity: number; offset: number };
  return [bones.join(' '), axis, intensity, offset, [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(head => evaluate(wire.sourceNodeId, wire.sourcePort, head) + 0)];
 });
 expect(follow).toEqual([['spine', 'x', 1, 0, [0.125, 0, 0]], ['spine', 'y', 1, 0, [0, 0.25, 0]], ['spine', 'z', 1, 0, [0, 0, -0.125]], ['chest', 'x', 1, 0, [0.0625, 0, 0]], ['chest', 'y', 1, 0, [0, 0.125, 0]], ['chest', 'z', 1, 0, [0, 0, -0.0625]], ['neck', 'x', 1, 0, [-0.1875, 0, 0]], ['neck', 'y', 1, 0, [0, -0.375, 0]], ['neck', 'z', 1, 0, [0, 0, 0.1875]]]);
 expect(offsets).toHaveLength(22);
 expect(faceTemplate.references[0]!.id).toBe('character');
 expect(importBlueprint(file, makeSmokeScene(), () => 'g1')).toMatchObject({ ok: true, data: { report: { enabled: true, missing: [], remapped: [] } } });
});
