import type { Id, SceneView, Vec3 } from '@opensekai/contracts';

// The Orbit Character cameras that follow `avatarId` (R6a). Each one moves by the same delta as its target.
export const followers = (scene: SceneView, avatarId: Id): Id[] =>
 scene.entities.flatMap(entity => entity.kind === 'camera' && entity.navigation?.mode === 'orbitCharacter' && entity.navigation.targetId === avatarId ? [entity.id] : []);
export const delta = (from: Vec3, to: Vec3): Vec3 => [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
export const shifted = (position: Vec3, by: Vec3): Vec3 => [position[0] + by[0], position[1] + by[1], position[2] + by[2]];
