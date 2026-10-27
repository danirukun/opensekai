import { cameraSwayTemplate, importBlueprint, upperBodyRotationTemplate, type BlueprintImport, type Id, type Reply, type SceneView } from '@opensekai/contracts';

export const MAX_GRAPHS = 8;
// The selected character, or the first avatar when the selection is not a character.
export function templateAvatar(scene: SceneView | null, selectedId: Id | null): { id: Id; name: string } | null {
 const avatars = scene?.entities.filter(entity => entity.kind === 'avatar') ?? [];
 const avatar = avatars.find(entity => entity.id === selectedId) ?? avatars[0];
 return avatar ? { id: avatar.id, name: avatar.name } : null;
}
// The selected camera, else the camera of `output_main`, else the first camera.
export function templateCamera(scene: SceneView | null, selectedId: Id | null) {
 const cameras = scene?.entities.flatMap(entity => entity.kind === 'camera' ? [entity] : []) ?? [];
 const main = scene?.outputs.find(output => output.id === 'output_main')?.cameraId;
 const camera = cameras.find(entity => entity.id === selectedId) ?? cameras.find(entity => entity.id === main) ?? cameras[0];
 return camera ? { id: camera.id, name: camera.name, position: camera.transform.position, rotation: camera.transform.rotation, fovDegrees: camera.lens.fovDegrees } : null;
}
const noTarget = (message: string): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids: [] } });
export const TEMPLATES = [
 { value: 'upper-body-rotation', label: 'Upper Body Rotation', available: (scene: SceneView | null) => templateAvatar(scene, null) !== null,
  build(scene: SceneView, selectedId: Id | null, newId: () => Id): Reply<BlueprintImport> {
   const avatar = templateAvatar(scene, selectedId);
   return avatar ? importBlueprint(upperBodyRotationTemplate(avatar), scene, newId) : noTarget('No character');
  } },
 { value: 'camera-sway', label: 'Camera Sway', available: (scene: SceneView | null) => templateCamera(scene, null) !== null,
  build(scene: SceneView, selectedId: Id | null, newId: () => Id): Reply<BlueprintImport> {
   const camera = templateCamera(scene, selectedId);
   return camera ? importBlueprint(cameraSwayTemplate(camera), scene, newId) : noTarget('No camera');
  } },
] as const;
// The templates whose reference exists in the scene; the menu is enabled while the show has fewer than 8 graphs.
export const availableTemplates = (scene: SceneView | null) => TEMPLATES.filter(template => template.available(scene));
export const templatesEnabled = (scene: SceneView | null, graphCount: number) => availableTemplates(scene).length > 0 && graphCount < MAX_GRAPHS;
export const upperBodyRotation = TEMPLATES[0].build;
export const cameraSway = TEMPLATES[1].build;
