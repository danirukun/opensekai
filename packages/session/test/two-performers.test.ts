import { expect, it } from 'vitest';
import { defaultTrackingConfig, makeSmokeScene, type Quat, type SceneEntity, type SceneView, type ScenePatch, type TrackingConfig, type TrackingSample } from '@opensekai/contracts';
import { createSession } from '../src/session';

const transform = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as Quat, scale: [1, 1, 1] as [number, number, number] };
const source = (id: string, kind: TrackingConfig['kind']): SceneEntity => {
 const config = defaultTrackingConfig(kind);
 config.enabled = true;
 return { id, kind: 'tracking', name: id, visible: true, transform, config, generation: 1 } as SceneEntity;
};
const tracking = (bodySourceId: string | null, faceSourceId: string | null) => ({ bodySourceId, faceSourceId });

// The smoke avatar `performer`, a second avatar `second`, two VMC bodies and two iFacialMocap faces.
function twoPerformers(shared = false): SceneView {
 const scene = makeSmokeScene();
 scene.entities.push(source('body-a', 'vmc'), source('body-b', 'vmc'), source('face-a', 'ifacialmocap'), source('face-b', 'ifacialmocap'));
 const performer = scene.entities.find(entity => entity.id === 'performer')!;
 if (performer.kind !== 'avatar') throw new Error('Avatar');
 performer.tracking = tracking('body-a', 'face-a');
 scene.entities.push({ ...structuredClone(performer), id: 'second', name: 'Second', tracking: tracking(shared ? 'body-a' : 'body-b', 'face-b') });
 return scene;
}

const patch = (scene: SceneView, operations: ScenePatch['operations']): ScenePatch => ({ sceneId: scene.sceneId, expectedRevision: scene.revision, operations });

it('rejects a patch that makes two avatars use one source, with the avatar IDs', () => {
 const session = createSession(twoPerformers(), 'r12');
 const before = session.inspect();
 const reply = session.applyPatch(patch(before, [{ kind: 'setAvatarTracking', entityId: 'second', tracking: tracking('body-a', 'face-b') }]));
 expect(reply).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 if (reply.ok) throw new Error('Expected failure');
 expect([...reply.error.ids].sort()).toEqual(['performer', 'second']);
 expect(session.inspect()).toEqual(before);
});

it('rejects a created avatar that uses a source of another avatar', () => {
 const session = createSession(twoPerformers(), 'r12');
 const scene = session.inspect();
 const performer = scene.entities.find(entity => entity.id === 'performer')!;
 if (performer.kind !== 'avatar') throw new Error('Avatar');
 const reply = session.applyPatch(patch(scene, [
  { kind: 'removeEntity', entityId: 'second' },
  { kind: 'createEntity', entity: { ...structuredClone(performer), id: 'third', tracking: tracking(null, 'face-a') } },
 ]));
 expect(reply).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: expect.arrayContaining(['performer', 'third']) } });
});

it('checks the end state, so a swap is valid and a half swap is not', () => {
 const session = createSession(twoPerformers(), 'r12');
 const scene = session.inspect();
 expect(session.applyPatch(patch(scene, [
  { kind: 'setAvatarTracking', entityId: 'performer', tracking: tracking('body-b', 'face-b') },
 ])).ok).toBe(false);
 const swapped = session.applyPatch(patch(scene, [
  { kind: 'setAvatarTracking', entityId: 'performer', tracking: tracking('body-b', 'face-b') },
  { kind: 'setAvatarTracking', entityId: 'second', tracking: tracking('body-a', 'face-a') },
 ]));
 expect(swapped.ok).toBe(true);
 // A swap in one patch where both avatars end on the same source fails.
 const after = session.inspect();
 expect(session.applyPatch(patch(after, [
  { kind: 'setAvatarTracking', entityId: 'performer', tracking: tracking('body-a', 'face-a') },
  { kind: 'setAvatarTracking', entityId: 'second', tracking: tracking('body-a', 'face-b') },
 ]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('lets one avatar use one source for body and face', () => {
 const scene = makeSmokeScene();
 scene.entities.push(source('body-a', 'vmc'));
 const session = createSession(scene, 'r12');
 expect(session.applyPatch(patch(session.inspect(), [{ kind: 'setAvatarTracking', entityId: 'performer', tracking: tracking('body-a', 'body-a') }])).ok).toBe(true);
});

it('keeps a share from an old show valid on load and on a patch of other fields', () => {
 const session = createSession(makeSmokeScene(), 'r12');
 expect(session.replaceScene(twoPerformers(true), 0).ok).toBe(true);
 const scene = session.inspect();
 expect(session.applyPatch(patch(scene, [
  { kind: 'renameEntity', entityId: 'second', name: 'Renamed' },
  { kind: 'setAvatarTracking', entityId: 'second', tracking: tracking('body-a', 'face-a') },
 ])).ok).toBe(false);
 expect(session.applyPatch(patch(scene, [
  { kind: 'renameEntity', entityId: 'second', name: 'Renamed' },
  { kind: 'setAvatarIdle', entityId: 'second', idleAnimation: { kind: 'builtin', enabled: false } },
 ])).ok).toBe(true);
 // Removal of the share is always valid.
 expect(session.applyPatch(patch(session.inspect(), [{ kind: 'setAvatarTracking', entityId: 'second', tracking: tracking('body-b', 'face-b') }])).ok).toBe(true);
});

const yaw = (angle: number): Quat => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
const sample = (sourceId: string, receivedAtMs: number, angle: number, jaw: number, bone: 'hips' | 'head'): TrackingSample => ({
 sourceId, generation: 1, receivedAtMs,
 bones: { [bone]: { space: bone === 'hips' ? 'raw' : 'normalized', rotation: yaw(angle) } },
 expressions: bone === 'head' ? { jawOpen: jaw } : {},
});

it('composes two independent poses from four sources, and a stale source changes only its own avatar', () => {
 const scene = twoPerformers();
 for (const entity of scene.entities) if (entity.kind === 'tracking') entity.smoothing = { enabled: false, minCutoff: 1, beta: 0, derivativeCutoff: 1 };
 const session = createSession(scene, 'r15');
 const ingest = (samples: TrackingSample[]) => expect(session.ingestTracking({ samples, statuses: [] }).ok).toBe(true);
 ingest([sample('body-a', 0, .1, 0, 'hips'), sample('body-b', 0, .2, 0, 'hips'), sample('face-a', 0, .3, .4, 'head'), sample('face-b', 0, .5, .6, 'head')]);
 const poses = (now: number) => Object.fromEntries(session.advance(now, now).avatarPoses!.map(pose => [pose.avatarId, pose]));
 const first = poses(100);
 expect(first.performer).toMatchObject({ bones: { hips: { rotation: yaw(.1), weight: 1 }, head: { rotation: yaw(.3), weight: 1 } }, expressions: { jawOpen: .4 } });
 expect(first.second).toMatchObject({ bones: { hips: { rotation: yaw(.2), weight: 1 }, head: { rotation: yaw(.5), weight: 1 } }, expressions: { jawOpen: .6 } });
 // Only body-b and face-b keep sending, so body-a and face-a go stale and then fade out.
 ingest([sample('body-b', 900, .25, 0, 'hips'), sample('face-b', 900, .55, .7, 'head')]);
 const later = poses(1000);
 expect(later.performer.bones).toEqual({});
 expect(later.performer.expressions).toEqual({});
 expect(later.second).toMatchObject({ bones: { hips: { rotation: yaw(.25), weight: 1 }, head: { rotation: yaw(.55), weight: 1 } }, expressions: { jawOpen: .7 } });
 const states = Object.fromEntries(session.advance(1000, 1000).trackingStatus!.map(status => [status.sourceId, status.state]));
 expect(states).toMatchObject({ 'body-a': 'stale', 'face-a': 'stale', 'body-b': 'receiving', 'face-b': 'receiving' });
});

it('keeps the other pose when a source of one avatar stops', () => {
 const scene = twoPerformers();
 const session = createSession(scene, 'r15');
 session.ingestTracking({ samples: [sample('face-a', 0, .3, .4, 'head'), sample('face-b', 0, .5, .6, 'head')], statuses: [] });
 const before = session.advance(100, 100).avatarPoses!.find(pose => pose.avatarId === 'second');
 session.ingestTracking({ samples: [], statuses: [{ sourceId: 'face-a', generation: 1, state: 'stopped', packets: 1, invalidPackets: 0, lastReceivedAtMs: null, error: null }] });
 const poses = session.advance(100, 100).avatarPoses!;
 expect(poses.find(pose => pose.avatarId === 'performer')!.expressions).toEqual({});
 expect(poses.find(pose => pose.avatarId === 'second')).toEqual(before);
});
