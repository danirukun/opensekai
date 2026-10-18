import { expect, it } from 'vitest';
import { importBlueprint, makeSmokeScene, upperBodyRotationTemplate, type BlueprintGraph, type Quat, type SceneEntity, type SceneView } from '@opensekai/contracts';
import { createSession } from '../src/session';
import { quatToEuler } from '../src/bone-offsets';

const yawQuat = (degrees: number): Quat => [0, Math.sin(degrees * Math.PI / 360), 0, Math.cos(degrees * Math.PI / 360)];
const faceSource = (id: string): SceneEntity => ({ id, name: id, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'tracking', generation: 0, config: { kind: 'ifacialmocap', enabled: true, bindAddress: '0.0.0.0', port: 49983, phoneAddress: null }, smoothing: { enabled: false, minCutoff: 5, beta: 0.5, derivativeCutoff: 1 } } as SceneEntity);
const performer = (scene: SceneView, id: string, faceSourceId: string) => {
 const base = scene.entities.find(item => item.id === 'performer')!;
 const avatar = { ...structuredClone(base), id, name: id, tracking: { bodySourceId: null, faceSourceId } } as SceneEntity;
 if (avatar.kind === 'avatar') delete avatar.idleAnimation;
 return avatar;
};
const template = (scene: SceneView, avatar: { id: string; name: string }, graphId: string): BlueprintGraph => {
 const imported = importBlueprint(upperBodyRotationTemplate(avatar), scene, () => graphId);
 if (!imported.ok) throw new Error(imported.error.message);
 expect(imported.data.report).toMatchObject({ enabled: true, missing: [] });
 return imported.data.graph;
};
const load = (s: ReturnType<typeof createSession>, ops: unknown[]) => { const reply = s.editBlueprints({ clientId: 't', batchId: crypto.randomUUID(), ops }); if (!reply.ok) throw new Error(reply.error.message); };
const head = (s: ReturnType<typeof createSession>, sourceId: string, degrees: number, at: number) =>
 s.ingestTracking({ samples: [{ sourceId, generation: 0, receivedAtMs: at, bones: { head: { rotation: yawQuat(degrees), space: 'normalized' } }, expressions: {} }], statuses: [] });
const yaw = (q: Quat | undefined) => q ? quatToEuler(q)[1] : Number.NaN;

it('turns chest, spine, and hips by 0.6, 0.4, and 0.3 of the head yaw, stops one tick after disable, and keeps the revision', () => {
 const scene = makeSmokeScene();
 scene.entities = [...scene.entities.filter(item => item.id !== 'performer'), performer(scene, 'performer', 'face'), faceSource('face')];
 const s = createSession(scene, 's');
 load(s, [{ kind: 'createGraph', graph: template(scene, { id: 'performer', name: 'performer' }, 'upper') }]);
 head(s, 'face', 20, 0);
 const first = s.advance(0, 0);
 expect(first.avatarPoses?.[0]?.boneOffsets?.chest).toEqual([0, 0, 0, 1]);
 head(s, 'face', 20, 16);
 const offsets = s.advance(16, 16).avatarPoses?.find(pose => pose.avatarId === 'performer')?.boneOffsets;
 expect(Object.keys(offsets ?? {})).toEqual(['chest', 'spine', 'hips']);
 expect(Math.abs(yaw(offsets?.chest) - 12)).toBeLessThan(0.01);
 expect(Math.abs(yaw(offsets?.spine) - 8)).toBeLessThan(0.01);
 expect(Math.abs(yaw(offsets?.hips) - 6)).toBeLessThan(0.01);
 expect(s.inspectBlueprints().errors).toEqual([]);
 load(s, [{ kind: 'updateGraph', graphId: 'upper', enabled: false }]);
 head(s, 'face', 20, 32);
 const after = s.advance(32, 32).avatarPoses?.find(pose => pose.avatarId === 'performer');
 expect(after).toBeDefined();
 expect(after).not.toHaveProperty('boneOffsets');
 expect(s.inspect().revision).toBe(0);
 expect(JSON.stringify(s.inspect())).not.toContain('boneOffsets');
});

it('drives two avatars from two template graphs, each from its own head', () => {
 const scene = makeSmokeScene();
 scene.entities = [...scene.entities.filter(item => item.id !== 'performer'), performer(scene, 'alice', 'face-a'), performer(scene, 'bob', 'face-b'), faceSource('face-a'), faceSource('face-b')];
 const s = createSession(scene, 's');
 load(s, [{ kind: 'createGraph', graph: template(scene, { id: 'alice', name: 'alice' }, 'upper-a') }, { kind: 'createGraph', graph: template(scene, { id: 'bob', name: 'bob' }, 'upper-b') }]);
 for (const at of [0, 16]) { head(s, 'face-a', 20, at); head(s, 'face-b', -40, at); }
 s.advance(0, 0);
 const poses = s.advance(16, 16).avatarPoses ?? [];
 const chest = (id: string) => yaw(poses.find(pose => pose.avatarId === id)?.boneOffsets?.chest);
 expect(chest('alice')).toBeCloseTo(12, 2);
 expect(chest('bob')).toBeCloseTo(-24, 2);
});

it('drops offsets at the next tick start, clears the previous pose on sceneReplace, and rolls back a failed run', () => {
 const scene = makeSmokeScene();
 scene.entities = [...scene.entities.filter(item => item.id !== 'performer'), performer(scene, 'performer', 'face'), faceSource('face')];
 const s = createSession(scene, 's');
 const at = { x: 0, y: 0 };
 const node = (id: string, type: string, settings: object = {}) => ({ id, version: 1, type, settings, position: at });
 const wire = (id: string, from: string, fromPort: string, to: string, toPort: string) => ({ id, sourceNodeId: from, sourcePort: fromPort, targetNodeId: to, targetPort: toPort });
 const offsetGraph = (id: string, start: string, angle: number, after?: object) => ({ schemaVersion: 1, id, name: id, enabled: true, variables: [],
  nodes: [node('start', start), node('angle', 'value.number', { value: angle }), node('make', 'vector3.make'), node('turn', 'character.offsetBoneRotation', { entityId: 'performer', bone: 'chest' }), ...(after ? [after] : [])],
  connections: [wire('w1', 'start', 'flow', 'turn', 'flow'), wire('w2', 'angle', 'value', 'make', 'x'), wire('w3', 'angle', 'value', 'make', 'y'), wire('w4', 'angle', 'value', 'make', 'z'), wire('w5', 'make', 'value', 'turn', 'euler'), ...(after ? [wire('w6', 'turn', 'exit', 'hide', 'flow')] : [])] });
 load(s, [{ kind: 'createGraph', graph: offsetGraph('manual', 'event.manual', 10) }]);
 expect(s.runBlueprint('manual', 'start').ok).toBe(true);
 expect((s.advance(0).avatarPoses ?? []).some(pose => pose.boneOffsets)).toBe(false);
 load(s, [{ kind: 'createGraph', graph: offsetGraph('ghost', 'event.update', 10, node('hide', 'scene.toggleVisibility', { entityId: 'ghost' })) }, { kind: 'createGraph', graph: offsetGraph('wide', 'event.update', 400) }]);
 const frame = s.advance(16);
 expect((frame.avatarPoses ?? []).some(pose => pose.boneOffsets)).toBe(false);
 expect(s.inspectBlueprints().errors.map(error => error.graphId).sort()).toEqual(['ghost', 'wide']);
 expect(s.inspect().revision).toBe(0);

 const reader = template(scene, { id: 'performer', name: 'performer' }, 'upper');
 load(s, [{ kind: 'replaceAll', graphs: [reader] }]);
 head(s, 'face', 20, 32);
 s.advance(32, 32);
 expect(s.replaceScene(s.inspect(), 0).ok).toBe(true);
 const replaced = s.advance(48, 48).avatarPoses?.find(pose => pose.avatarId === 'performer');
 expect(replaced?.boneOffsets?.chest).toEqual([0, 0, 0, 1]);
});
