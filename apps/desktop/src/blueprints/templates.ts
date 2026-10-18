import { importBlueprint, upperBodyRotationTemplate, type BlueprintImport, type Id, type Reply, type SceneView } from '@opensekai/contracts';

export const MAX_GRAPHS = 8;
// The selected character, or the first avatar when the selection is not a character.
export function templateAvatar(scene: SceneView | null, selectedId: Id | null): { id: Id; name: string } | null {
 const avatars = scene?.entities.filter(entity => entity.kind === 'avatar') ?? [];
 const avatar = avatars.find(entity => entity.id === selectedId) ?? avatars[0];
 return avatar ? { id: avatar.id, name: avatar.name } : null;
}
export const templatesEnabled = (scene: SceneView | null, graphCount: number) => templateAvatar(scene, null) !== null && graphCount < MAX_GRAPHS;
export function upperBodyRotation(scene: SceneView, selectedId: Id | null, newId: () => Id): Reply<BlueprintImport> {
 const avatar = templateAvatar(scene, selectedId);
 if (!avatar) return { ok: false, error: { code: 'INVALID_INPUT', message: 'No character', ids: [] } };
 return importBlueprint(upperBodyRotationTemplate(avatar), scene, newId);
}
