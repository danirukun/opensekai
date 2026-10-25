import { expect, it } from 'vitest';
import { makeSmokeScene, type AssetRecord, type AvatarPose, type AvatarRig, type Quat, type SceneEntity, type Vec3 } from '@opensekai/contracts';
import { multiplyQuat, slerpQuat } from '../src/bone-offsets';
import { vmcPosesFor, vmcSendPose } from '../src/vmc-send';
import { createSession } from '../src/session';

const yaw = (degrees: number): Quat => [0, Math.sin(degrees * Math.PI / 360), 0, Math.cos(degrees * Math.PI / 360)];
const pitch = (degrees: number): Quat => [Math.sin(degrees * Math.PI / 360), 0, 0, Math.cos(degrees * Math.PI / 360)];
const rig = (patch: Partial<AvatarRig> = {}): AvatarRig => ({ metaVersion: '1', identityRest: true, restPositions: { hips: [0, 1, 0], spine: [0, 0.1, 0], chest: [0, 0.15, 0], head: [0, 0.3, 0], leftUpperArm: [0.1, 0, 0] }, ...patch });
const pose = (extra: Partial<AvatarPose>): AvatarPose => ({ avatarId: 'performer', bones: {}, expressions: {}, ...extra });
const sameRotation = (actual: Quat, expected: Quat) => {
 const dot = Math.abs(actual.reduce((sum, value, i) => sum + value * expected[i]!, 0));
 expect(dot, `${actual} vs ${expected}`).toBeCloseTo(1, 9);
};
const close = (actual: Vec3, expected: Vec3) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 9));

it('sends the rest pose for each rig bone without a pose: identity rotations and rest positions', () => {
 const sent = vmcSendPose(undefined, rig());
 expect(Object.keys(sent.bones).sort()).toEqual(['chest', 'head', 'hips', 'leftUpperArm', 'spine']);
 expect(sent.bones.hips).toEqual({ position: [0, 1, 0], rotation: [0, 0, 0, 1] });
 expect(sent.root).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0, 1] });
 expect(sent.blends).toEqual({});
});
it('uses the base bones, then slerps normalized tracking by weight', () => {
 const sent = vmcSendPose(pose({ baseBones: { head: { rotation: yaw(10), space: 'normalized' } }, bones: { head: { rotation: yaw(30), space: 'normalized', weight: 0.5 }, spine: { rotation: pitch(20), space: 'normalized' } } }), rig());
 sameRotation(sent.bones.head!.rotation, yaw(20));
 sameRotation(sent.bones.spine!.rotation, pitch(20));
 close(sent.bones.head!.position, [0, 0.3, 0]);
});
it('keeps raw tracking values: from rest without base bones, from the base value with them', () => {
 const raw = { rotation: yaw(40), space: 'raw' as const, position: [0.2, 0.5, 0.1] as Vec3 };
 const alone = vmcSendPose(pose({ bones: { leftUpperArm: raw } }), rig());
 sameRotation(alone.bones.leftUpperArm!.rotation, yaw(40));
 close(alone.bones.leftUpperArm!.position, [0.2, 0.5, 0.1]);
 const half = vmcSendPose(pose({ baseBones: { leftUpperArm: { rotation: yaw(10), space: 'normalized' } }, bones: { leftUpperArm: { ...raw, weight: 0.5 } } }), rig());
 sameRotation(half.bones.leftUpperArm!.rotation, slerpQuat(yaw(10), yaw(40), 0.5));
 close(half.bones.leftUpperArm!.position, [0.15, 0.25, 0.05]);
 const heldBase = vmcSendPose(pose({ baseBones: { leftUpperArm: { rotation: yaw(10), space: 'normalized' } }, bones: { leftUpperArm: { rotation: yaw(40), space: 'raw', weight: 0 } } }), rig());
 sameRotation(heldBase.bones.leftUpperArm!.rotation, yaw(10));
});
it('applies the VRM 0 sign to base bones and offsets, not to tracking values', () => {
 const q: Quat = [0.1, 0.2, 0.3, Math.sqrt(1 - 0.14)];
 const signed: Quat = [-0.1, 0.2, -0.3, q[3]];
 const base = vmcSendPose(pose({ baseBones: { head: { rotation: q, space: 'normalized' }, hips: { rotation: [0, 0, 0, 1], space: 'normalized', position: [0.1, 0, 0.2] } } }), rig({ metaVersion: '0' }));
 sameRotation(base.bones.head!.rotation, signed);
 close(base.bones.hips!.position, [-0.1, 1, -0.2]);
 const tracked = vmcSendPose(pose({ bones: { head: { rotation: q, space: 'normalized' } } }), rig({ metaVersion: '0' }));
 sameRotation(tracked.bones.head!.rotation, q);
 const offset = vmcSendPose(pose({ boneOffsets: { head: q } }), rig({ metaVersion: '0' }));
 sameRotation(offset.bones.head!.rotation, signed);
});
it('multiplies offsets on the left of the normalized and the raw value', () => {
 const sent = vmcSendPose(pose({ bones: { head: { rotation: pitch(30), space: 'normalized' }, leftUpperArm: { rotation: pitch(15), space: 'raw' } }, boneOffsets: { head: yaw(90), leftUpperArm: yaw(45) } }), rig());
 sameRotation(sent.bones.head!.rotation, multiplyQuat(yaw(90), pitch(30)));
 sameRotation(sent.bones.leftUpperArm!.rotation, multiplyQuat(yaw(45), pitch(15)));
});
it('moves the hips: a normalized position adds to the rest position, a raw position replaces it', () => {
 const normalized = vmcSendPose(pose({ bones: { hips: { rotation: [0, 0, 0, 1], space: 'normalized', position: [0.2, -0.1, 0] } } }), rig());
 close(normalized.bones.hips!.position, [0.2, 0.9, 0]);
 const raw = vmcSendPose(pose({ bones: { hips: { rotation: [0, 0, 0, 1], space: 'raw', position: [0.2, 0.8, 0] } } }), rig());
 close(raw.bones.hips!.position, [0.2, 0.8, 0]);
 const root = vmcSendPose(pose({ root: { position: [1, 0, 2], rotation: yaw(90) } }), rig());
 expect(root.root.position).toEqual([1, 0, 2]);
 sameRotation(root.root.rotation, yaw(90));
});
it('folds the chest into the spine of a rig without a chest', () => {
 const chestless = rig({ restPositions: { hips: [0, 1, 0], spine: [0, 0.1, 0], head: [0, 0.5, 0] } });
 const sent = vmcSendPose(pose({ baseBones: { spine: { rotation: pitch(10), space: 'normalized' }, chest: { rotation: yaw(20), space: 'normalized' } }, boneOffsets: { chest: pitch(5) } }), chestless);
 expect(sent.bones.chest).toBeUndefined();
 sameRotation(sent.bones.spine!.rotation, multiplyQuat(pitch(5), multiplyQuat(pitch(10), yaw(20))));
 const tracked = vmcSendPose(pose({ bones: { chest: { rotation: yaw(30), space: 'normalized' } } }), chestless);
 sameRotation(tracked.bones.spine!.rotation, yaw(30));
});
it('maps the VRM 1 presets to the VRM 0 clip names and keeps other names', () => {
 const sent = vmcSendPose(pose({ expressions: { happy: 0.5, Joy: 0.7, aa: 0.25, blinkLeft: 1, jawOpen: 0.3, 'bad\0name': 1, ['x'.repeat(129)]: 1 } }), rig());
 expect(sent.blends).toEqual({ Joy: 0.7, A: 0.25, Blink_L: 1, jawOpen: 0.3 });
});

const sender = (id: string, enabled: boolean, avatarId: string | null = 'performer'): SceneEntity => ({ id, name: id, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'vmcSender', vmcSender: { enabled, address: '127.0.0.1', port: 39540, avatarId } });
const record = (rigValue?: AvatarRig): AssetRecord => ({ id: 'fixture_vrm_1', format: 'vrm', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: '', importerVersion: 1, name: 'Avatar', expressions: [], ...(rigValue ? { rig: rigValue } : {}) });
it('makes one pose for each enabled sender with a supported rig, and none otherwise (R8)', () => {
 const scene = makeSmokeScene();
 scene.entities.push(sender('on', true), sender('off', false), sender('nobody', true, null));
 const lookup = (value: AssetRecord) => (id: string) => id === value.id ? value : undefined;
 expect(vmcPosesFor(scene, [], lookup(record(rig()))).map(p => p.senderId)).toEqual(['on']);
 expect(vmcPosesFor(scene, [], lookup(record()))).toEqual([]);
 expect(vmcPosesFor(scene, [], lookup(record(rig({ identityRest: false }))))).toEqual([]);
 const moving = vmcPosesFor(scene, [pose({ bones: { head: { rotation: yaw(30), space: 'normalized' } } })], lookup(record(rig())));
 sameRotation(moving[0]!.bones.head!.rotation, yaw(30));
});
it('sends the envelope after the frame of a tick only when a sender qualifies (R8)', () => {
 const s = createSession(makeSmokeScene(), 'vmc-session', [record(rig())]);
 expect(s.vmcPoses(s.advance(0))).toBeNull();
 expect(s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'createEntity', entity: sender('vmc', true) }] }).ok).toBe(true);
 const frame = s.advance(1000 / 60);
 const envelope = s.vmcPoses(frame);
 expect(envelope).toMatchObject({ kind: 'vmcPoses', sessionId: 'vmc-session', tick: frame.tick, poses: [{ senderId: 'vmc' }] });
 expect(JSON.stringify(frame)).not.toContain('vmcPoses');
});
