import { orbitFromTransform, orbitPivot, readProperty, userFromOrbit, type BlueprintNode, type ScalarValue, type SceneView } from '@opensekai/contracts';

// Use current value: the committed value of the target property of a Set Asset Property node, or null when the button is disabled.
export function currentPropertyValue(node: BlueprintNode, wired: boolean, scene: SceneView | null): ScalarValue | null {
 if (node.type !== 'property.set' || wired || !scene) return null;
 const entity = scene.entities.find(item => item.id === node.settings.entityId);
 const value = entity && readProperty(entity, node.settings.property);
 return value === undefined ? null : structuredClone(value) as ScalarValue;
}

const round = (value: number, step: number) => Math.round(value / step) * step;
// Use current value on Camera Orbit Character (B32 R9): the committed Yaw, Pitch, and Distance of the node camera around its
// pivot, for each input without a wire. Null when the camera is missing or not in Orbit Character mode.
export function currentOrbitValues(node: BlueprintNode, wired: ReadonlySet<string>, scene: SceneView | null): Record<string, number> | null {
 if (node.type !== 'camera.orbitCharacter' || !scene) return null;
 const camera = scene.entities.find(item => item.id === node.settings.cameraId);
 if (camera?.kind !== 'camera' || camera.navigation?.mode !== 'orbitCharacter') return null;
 const { targetId, pivotOffset } = camera.navigation;
 const target = targetId ? scene.entities.find(item => item.id === targetId) : undefined;
 const user = userFromOrbit(orbitFromTransform(camera.transform, orbitPivot(target?.transform.position ?? null, pivotOffset)));
 // `+ 0` turns -0 into 0.
 const values = Object.entries({ yaw: round(user.yawDegrees, 0.1), pitch: round(user.pitchDegrees, 0.1), distance: round(user.distance, 0.01) })
  .filter(([port]) => !wired.has(port)).map(([port, value]) => [port, Number(value.toFixed(2)) + 0] as const);
 return values.length ? Object.fromEntries(values) : null;
}

// The inline values that Use current value writes, by input port, or null when the button is disabled.
export function currentInputValues(node: BlueprintNode, wired: ReadonlySet<string>, scene: SceneView | null): Record<string, ScalarValue> | null {
 if (node.type === 'camera.orbitCharacter') return currentOrbitValues(node, wired, scene);
 const value = currentPropertyValue(node, wired.has('value'), scene);
 return value === null ? null : { value };
}
