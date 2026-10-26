import { expect, it } from 'vitest';
import { makeSmokeScene, SceneViewSchema, type SceneEntity, type VmcSenderSettings } from '@opensekai/contracts';
import { createSession } from '../src/session';

const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const settings = (patch: Partial<VmcSenderSettings> = {}): VmcSenderSettings => ({ enabled: false, address: '127.0.0.1', port: 39539, avatarId: 'performer', ...patch });
const sender = (id: string, patch: Partial<VmcSenderSettings> = {}): SceneEntity => ({ id, name: 'VMC Sender', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'vmcSender', vmcSender: settings(patch) });
const showScene = (entity: SceneEntity) => { const scene = makeSmokeScene(); scene.entities.push(entity); return scene; };

it('creates a sender and replaces its settings with setVmcSender (R2)', () => {
 const s = createSession(makeSmokeScene(), 'vmc-test');
 expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: sender('vmc') }])).ok).toBe(true);
 const next = settings({ enabled: true, address: '192.168.1.40', port: 40000 });
 expect(s.applyPatch(patch(1, [{ kind: 'setVmcSender', entityId: 'vmc', vmcSender: next }])).ok).toBe(true);
 expect(s.inspect().entities.find(e => e.id === 'vmc')).toMatchObject({ kind: 'vmcSender', vmcSender: next });
 expect(s.applyPatch(patch(2, [{ kind: 'setVisibility', entityId: 'vmc', visible: false }, { kind: 'renameEntity', entityId: 'vmc', name: 'Out' }])).ok).toBe(true);
 expect(s.inspect().entities.find(e => e.id === 'vmc')).toMatchObject({ visible: false, name: 'Out' });
 expect(s.applyPatch(patch(3, [{ kind: 'removeEntity', entityId: 'vmc' }])).ok).toBe(true);
 expect(s.inspect().entities.some(e => e.id === 'vmc')).toBe(false);
});
it('rejects setVmcSender on another kind, setTransform on a sender, and bad settings without a change (R1, R2)', () => {
 const s = createSession(makeSmokeScene(), 'vmc-test');
 expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: sender('vmc') }])).ok).toBe(true);
 const before = s.inspect();
 expect(s.applyPatch(patch(1, [{ kind: 'setVmcSender', entityId: 'performer', vmcSender: settings() }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['performer'] } });
 expect(s.applyPatch(patch(1, [{ kind: 'setTransform', entityId: 'vmc', transform: { position: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['vmc'] } });
 for (const bad of [{ port: 0 }, { port: 65536 }, { port: 1.5 }, { address: '0.0.0.0' }, { address: '::' }, { address: '239.0.0.1' }, { address: 'ff02::1' }, { address: '255.255.255.255' }, { address: 'localhost' }])
  expect(s.applyPatch(patch(1, [{ kind: 'setVmcSender', entityId: 'vmc', vmcSender: settings(bad) }])).ok, JSON.stringify(bad)).toBe(false);
 expect(s.applyPatch(patch(1, [{ kind: 'setVmcSender', entityId: 'vmc', vmcSender: settings({ avatarId: 'nobody' }) }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(s.inspect()).toEqual(before);
 expect(s.applyPatch(patch(1, [{ kind: 'setVmcSender', entityId: 'vmc', vmcSender: settings({ address: '::1', port: 65535 }) }])).ok).toBe(true);
});
it('allows four senders and rejects a fifth (R1)', () => {
 const s = createSession(makeSmokeScene(), 'vmc-test');
 expect(s.applyPatch(patch(0, [1, 2, 3, 4].map(i => ({ kind: 'createEntity', entity: sender(`vmc_${i}`) })))).ok).toBe(true);
 expect(s.applyPatch(patch(1, [{ kind: 'createEntity', entity: sender('vmc_5') }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});
it('clears the character of each sender when its avatar is removed, in the same patch (R2)', () => {
 const s = createSession(makeSmokeScene(), 'vmc-test');
 expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: sender('vmc_a') }, { kind: 'createEntity', entity: sender('vmc_b') }])).ok).toBe(true);
 expect(s.applyPatch(patch(1, [{ kind: 'removeEntity', entityId: 'performer' }])).ok).toBe(true);
 expect(s.inspect().entities.filter(e => e.kind === 'vmcSender').map(e => e.kind === 'vmcSender' && e.vmcSender.avatarId)).toEqual([null, null]);
});
it('stops each sender of a start scene and of an opened show before the first frame (R2)', () => {
 const start = createSession(showScene(sender('vmc', { enabled: true })), 'vmc-test');
 expect(start.inspect().entities.find(e => e.id === 'vmc')).toMatchObject({ vmcSender: { enabled: false } });
 expect(start.advance(0).scene.entities.find(e => e.id === 'vmc')).toMatchObject({ vmcSender: { enabled: false } });
 const s = createSession(makeSmokeScene(), 'vmc-test');
 const replaced = s.replaceScene(showScene(sender('vmc', { enabled: true, address: '10.0.0.2' })), 0);
 expect(replaced.ok && replaced.data.entities.find(e => e.id === 'vmc')).toMatchObject({ vmcSender: { enabled: false, address: '10.0.0.2' } });
 // A patch from the editor or MCP can start it.
 expect(s.applyPatch(patch(1, [{ kind: 'setVmcSender', entityId: 'vmc', vmcSender: settings({ enabled: true }) }])).ok).toBe(true);
 expect(SceneViewSchema.parse(s.inspect()).entities.find(e => e.id === 'vmc')).toMatchObject({ vmcSender: { enabled: true } });
});
