import { expect, it } from 'vitest';
import { makeSmokeScene, type SceneEntity } from '@opensekai/contracts';
import { boneOptions } from '../src/blueprints/fields';
import { templateAvatar, templatesEnabled, upperBodyRotation } from '../src/blueprints/templates';

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
 expect(templatesEnabled(empty, 0)).toBe(false);
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
