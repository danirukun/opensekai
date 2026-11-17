import { mount } from 'svelte';
import { makeSmokeScene } from '@opensekai/contracts';
import Hierarchy from '../src/components/Hierarchy.svelte';

type RenameCall = { id: string; name: string; revision: number };
const scene = makeSmokeScene();
const calls: RenameCall[] = [];
const target = document.getElementById('app');
if (!target) throw new Error('missing app root');

const ok = (revision: number) => ({ ok: true as const, data: { revision } });
const model = {
  select() {},
  read: () => ({ scene, selectedId: null, error: null, pending: false }),
  async renameEntity(id: string, name: string, revision: number) {
    calls.push({ id, name, revision });
    const entity = scene.entities.find(item => item.id === id);
    if (!name.trim()) return { ok: false as const, error: { code: 'INVALID_INPUT', message: 'INVALID_INPUT', ids: [] } };
    if (entity) entity.name = name.trim();
    scene.revision += 1;
    return ok(scene.revision);
  },
  async setVisibility() { return ok(scene.revision); },
  async duplicateEntity() { return ok(scene.revision); },
  async removeEntity() { return ok(scene.revision); },
  async selectCamera() { return ok(scene.revision); },
  async setTransform() { return ok(scene.revision); },
  async setVmcSender() { return ok(scene.revision); },
};

mount(Hierarchy, {
  target,
  props: { model, view: { scene, selectedId: null, error: null, pending: false } },
});

Object.assign(window, { __renames: calls });
