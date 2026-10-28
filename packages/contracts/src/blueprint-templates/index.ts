import type { BlueprintFile } from '../blueprint-file';
import type { Vec3 } from '../types';
import { rotateByQuaternion } from '../property-registry';
import upperBodyRotation from './upper-body-rotation.json';
import cameraSway from './camera-sway.json';

// The bundled template file with its one avatar reference set to the given character.
export const upperBodyRotationTemplate = (avatar: { id: string; name: string }): BlueprintFile => {
 const file = structuredClone(upperBodyRotation) as BlueprintFile;
 return { ...file, references: file.references.map(entry => entry.kind === 'avatar' ? { ...entry, id: avatar.id, name: avatar.name } : entry),
  graph: { ...file.graph, nodes: file.graph.nodes.map(node => 'entityId' in node.settings && node.settings.entityId === upperBodyRotation.references[0]!.id ? { ...node, settings: { ...node.settings, entityId: avatar.id } } as typeof node : node) } };
};

const SWAY_OFFSET: Vec3 = [0.5, 0, 0], SWAY_FOV_DEGREES = 5;
const round = (value: number) => Math.round(value * 1e4) / 1e4 + 0;
// Camera Sway for the given camera: a slide along its own right axis with a narrower Field of View, then back, in a loop.
export const cameraSwayTemplate = (camera: { id: string; name: string; position: Vec3; rotation: readonly number[]; fovDegrees: number }): BlueprintFile => {
 const file = structuredClone(cameraSway) as BlueprintFile;
 const offset = rotateByQuaternion(SWAY_OFFSET, camera.rotation);
 const values: Record<string, Vec3 | number> = {
  slide: camera.position.map((value, i) => round(value + offset[i]!)) as Vec3,
  zoom: Math.max(1, camera.fovDegrees - SWAY_FOV_DEGREES),
  back: camera.position.map(round) as Vec3,
  unzoom: camera.fovDegrees,
 };
 return { ...file, references: [{ id: camera.id, kind: 'camera', name: camera.name }],
  graph: { ...file.graph, nodes: file.graph.nodes.map(node => node.type === 'property.set' ? { ...node, settings: { ...node.settings, entityId: camera.id }, inputs: { value: values[node.id]! } } : node) } };
};
