import { readProperty, type BlueprintNode, type ScalarValue, type SceneView } from '@opensekai/contracts';

// Use current value: the committed value of the target property of a Set Asset Property node, or null when the button is disabled.
export function currentPropertyValue(node: BlueprintNode, wired: boolean, scene: SceneView | null): ScalarValue | null {
 if (node.type !== 'property.set' || wired || !scene) return null;
 const entity = scene.entities.find(item => item.id === node.settings.entityId);
 const value = entity && readProperty(entity, node.settings.property);
 return value === undefined ? null : structuredClone(value) as ScalarValue;
}
