import { expect, it } from 'vitest';
import { makeSmokeScene, type SceneEntity } from '@opensekai/contracts';
import { boneOptions } from '../src/blueprints/fields';
import { availableTemplates, cameraSway, templateAvatar, templateCamera, templatesEnabled, upperBodyRotation } from '../src/blueprints/templates';
import { currentPropertyValue } from '../src/blueprints/current-value';

const twoAvatars = () => {
 const scene = makeSmokeScene();
 const performer = scene.entities.find(entity => entity.id === 'performer')!;
 scene.entities.push({ ...structuredClone(performer), id: 'second', name: 'Second' } as SceneEntity);
 return scene;
};

it('targets the selected character, else the first avatar, and is unavailable with no avatar or 8 graphs', () => {
 const scene = twoAvatars();
 expect(templateAvatar(scene, 'second')).toEqual({ id: 'second', name: 'Second' });
 expect(templateAvatar(scene, 'marker')).toEqual({ id: 'performer', name: 'performer' });
 expect(templateAvatar(scene, null)).toEqual({ id: 'performer', name: 'performer' });
 const empty = { ...scene, entities: scene.entities.filter(entity => entity.kind !== 'avatar') };
 expect(templateAvatar(empty, null)).toBeNull();
 // A scene without an avatar still offers Camera Sway.
 expect(availableTemplates(empty).map(item => item.label)).toEqual(['Camera Sway']);
 expect(availableTemplates(scene).map(item => item.label)).toEqual(['Upper Body Rotation', 'Camera Sway']);
 expect(templatesEnabled(empty, 0)).toBe(true);
 expect(templatesEnabled({ ...empty, entities: [] }, 0)).toBe(false);
 expect(templatesEnabled(scene, 7)).toBe(true);
 expect(templatesEnabled(scene, 8)).toBe(false);
});

it('imports an enabled Upper Body Rotation graph for the target character', () => {
 const reply = upperBodyRotation(twoAvatars(), 'second', () => 'g');
 if (!reply.ok) throw new Error(reply.error.message);
 expect(reply.data.report).toEqual({ graphId: 'g', enabled: true, remapped: [], missing: [] });
 expect(reply.data.graph.nodes.filter(node => node.type.startsWith('character.')).map(node => (node.settings as { entityId: string }).entityId)).toEqual(['second', 'second', 'second', 'second']);
 expect(upperBodyRotation({ ...twoAvatars(), entities: [] }, null, () => 'g').ok).toBe(false);
});

it('labels humanoid bones for the bone picker', () => {
 expect(boneOptions().find(option => option.value === 'upperChest')).toEqual({ value: 'upperChest', label: 'Upper Chest' });
 expect(boneOptions()).toHaveLength(55);
});

it('imports Camera Sway for the selected camera, else the camera of the main output', () => {
 const scene = makeSmokeScene();
 const main = scene.outputs.find(output => output.id === 'output_main')!.cameraId;
 expect(templateCamera(scene, 'performer')?.id).toBe(main);
 const other = scene.entities.find(entity => entity.kind === 'camera' && entity.id !== main);
 if (other) expect(templateCamera(scene, other.id)?.id).toBe(other.id);
 const reply = cameraSway(scene, null, () => 'g');
 if (!reply.ok) throw new Error(reply.error.message);
 expect(reply.data.report).toEqual({ graphId: 'g', enabled: true, remapped: [], missing: [] });
 expect(reply.data.graph.name).toBe('Camera Sway');
 expect(reply.data.graph.nodes.filter(node => node.type === 'property.set').every(node => (node.settings as { entityId: string }).entityId === main)).toBe(true);
});

it('reads the committed value for Use current value, and is disabled for a wire, a missing entity, or no scene', () => {
 const scene = makeSmokeScene();
 const set = (property: string, entityId = 'camera_wide') => ({ id: 'n', version: 1 as const, type: 'property.set' as const, settings: { entityId, property }, position: { x: 0, y: 0 } }) as Parameters<typeof currentPropertyValue>[0];
 const camera = scene.entities.find(entity => entity.id === 'camera_wide')!;
 expect(currentPropertyValue(set('position'), false, scene)).toEqual(camera.transform.position);
 expect(currentPropertyValue(set('fovDegrees'), false, scene)).toBe(camera.kind === 'camera' ? camera.lens.fovDegrees : NaN);
 expect(currentPropertyValue(set('position'), true, scene)).toBeNull();
 expect(currentPropertyValue(set('position', 'gone'), false, scene)).toBeNull();
 expect(currentPropertyValue(set('position'), false, null)).toBeNull();
});
