import { expect, it } from 'vitest';
import { fingerprint, makeSmokeScene, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '../src/session';

const transform = { position: [0, 2, 1], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const light = (id: string): SceneEntity => ({ id, name: id, visible: true, transform, kind: 'light', light: { type: 'point', color: '#ffffff', intensity: 20, range: 10, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 } } } as SceneEntity);
const camera = (id: string) => ({ id, name: id, visible: true, kind: 'camera', transform, lens: { fovDegrees: 40, near: 0.01, far: 100 }, navigation: { mode: 'freeLook', sensitivity: 1 } });
const graph = (id: string) => ({ schemaVersion: 1, id, name: id, nodes: [{ id: 'play', version: 1, type: 'event.manual', settings: {}, position: { x: 0, y: 0 } }], connections: [] });
const batch = (ops: unknown[]) => ({ clientId: 't', batchId: crypto.randomUUID(), ops });
const apply = (over: Record<string, unknown>) => ({ sceneId: 'scene_smoke', expect: { entities: [], blueprints: [] }, sceneOps: [], blueprint: null, output: null, ...over });
const make = () => createSession(makeSmokeScene(), 'proposal-test');
const find = (s: ReturnType<typeof make>, id: string) => s.inspect().entities.find(e => e.id === id)!;
const move = (entityId: string) => ({ kind: 'setTransform', entityId, transform: { ...transform, position: [5, 5, 5] } });
const place = (s: ReturnType<typeof make>, entity: SceneEntity) => s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: s.inspect().revision, operations: [{ kind: 'createEntity', entity }] } as never);

it('applies scene ops, a Blueprint batch, and the output camera as one change', () => {
    const s = make(); const outputId = s.inspect().outputs[0]!.id; const before = s.inspect().revision;
    const reply = s.applyProposal(apply({ sceneOps: [{ kind: 'createEntity', entity: camera('cam2') }], blueprint: batch([{ kind: 'createGraph', graph: graph('g1') }]), output: { outputId, cameraId: 'cam2' } }));
    expect(reply).toMatchObject({ ok: true, data: { revision: before + 1, blueprint: { revision: 1 } } });
    expect(s.inspect().outputs[0]!.cameraId).toBe('cam2');
    const snapshot = s.inspectBlueprints();
    expect(snapshot.kind === 'snapshot' ? snapshot.blueprints.map(g => g.id) : null).toEqual(['g1']);
});
it('conflict is scoped to touched entities', () => {
    const s = make(); place(s, light('light')); const fp = fingerprint(find(s, 'light'));
    const params = apply({ expect: { entities: [{ id: 'light', fingerprint: fp }], blueprints: [] }, sceneOps: [move('light')] });
    s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: s.inspect().revision, operations: [move('performer')] } as never);
    expect(s.applyProposal(params).ok).toBe(true);
    s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: s.inspect().revision, operations: [{ ...move('light'), transform: { ...transform, position: [9, 9, 9] } }] } as never);
    const before = s.inspect();
    expect(s.applyProposal(params)).toEqual({ ok: false, error: { code: 'CONFLICT', message: 'Proposal target changed', ids: ['light'] } });
    expect(s.inspect()).toEqual(before);
});
it('fails when an expected-absent ID exists', () => {
    const s = make();
    expect(s.applyProposal(apply({ expect: { entities: [{ id: 'performer', fingerprint: null }], blueprints: [] }, sceneOps: [move('performer')] }))).toMatchObject({ ok: false, error: { code: 'CONFLICT', ids: ['performer'] } });
});
it('checks Blueprint fingerprints, reports each failed ID once in first-seen order, and applies nothing', () => {
    const s = make(); s.editBlueprints(batch([{ kind: 'createGraph', graph: graph('g1') }]));
    const bp = s.inspectBlueprints(); const before = s.inspect();
    const reply = s.applyProposal(apply({
        expect: { entities: [{ id: 'performer', fingerprint: null }, { id: 'performer', fingerprint: null }], blueprints: [{ id: 'g1', fingerprint: '0000000000000000' }] },
        sceneOps: [move('performer')], blueprint: batch([{ kind: 'createGraph', graph: graph('g2') }]),
    }));
    expect(reply).toMatchObject({ ok: false, error: { code: 'CONFLICT', ids: ['performer', 'g1'] } });
    expect(s.inspect()).toEqual(before); expect(s.inspectBlueprints()).toEqual(bp);
});
it('a failed batch leaves the scene unchanged', () => {
    const s = make(); s.editBlueprints(batch([{ kind: 'createGraph', graph: graph('g1') }]));
    const before = s.inspect(); const bp = s.inspectBlueprints();
    const reply = s.applyProposal(apply({ sceneOps: [{ kind: 'createEntity', entity: light('lamp') }], blueprint: batch([{ kind: 'createGraph', graph: graph('g1') }]) }));
    expect(reply.ok).toBe(false);
    expect(s.inspect()).toEqual(before); expect(s.inspectBlueprints()).toEqual(bp);
});
it('a failed scene op leaves the Blueprints unchanged', () => {
    const s = make(); s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: Array.from({ length: 8 }, (_, i) => ({ kind: 'createEntity', entity: light(`l${i}`) })) } as never);
    const bp = s.inspectBlueprints();
    expect(s.applyProposal(apply({ sceneOps: [{ kind: 'createEntity', entity: light('l8') }], blueprint: batch([{ kind: 'createGraph', graph: graph('g1') }]) }))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspectBlueprints()).toEqual(bp);
});
it('rejects an output camera that is not a camera or does not exist', () => {
    const s = make(); const outputId = s.inspect().outputs[0]!.id; const before = s.inspect();
    expect(s.applyProposal(apply({ output: { outputId, cameraId: 'performer' } }))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['performer'] } });
    expect(s.applyProposal(apply({ output: { outputId, cameraId: 'nobody' } }))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.applyProposal(apply({ output: { outputId: 'nope', cameraId: 'performer' } }))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.inspect()).toEqual(before);
});
it('rejects invalid params and another scene', () => {
    const s = make();
    expect(s.applyProposal({})).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyProposal(apply({ sceneId: 'other', sceneOps: [move('performer')] }))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', ids: ['other'] } });
});
