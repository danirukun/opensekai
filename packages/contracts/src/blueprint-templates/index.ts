import type { BlueprintFile } from '../blueprint-file';
import upperBodyRotation from './upper-body-rotation.json';

// The bundled template file with its one avatar reference set to the given character.
export const upperBodyRotationTemplate = (avatar: { id: string; name: string }): BlueprintFile => {
 const file = structuredClone(upperBodyRotation) as BlueprintFile;
 return { ...file, references: file.references.map(entry => entry.kind === 'avatar' ? { ...entry, id: avatar.id, name: avatar.name } : entry),
  graph: { ...file.graph, nodes: file.graph.nodes.map(node => 'entityId' in node.settings && node.settings.entityId === upperBodyRotation.references[0]!.id ? { ...node, settings: { ...node.settings, entityId: avatar.id } } as typeof node : node) } };
};
