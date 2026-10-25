import { LIMITS, vmcBlendNameOk, type AssetRecord, type AvatarPose, type AvatarRig, type Id, type Quat, type SceneView, type Vec3, type VmcSendPose } from '@opensekai/contracts';
import { IDENTITY, multiplyQuat, normalize, slerpQuat } from './bone-offsets';

type Bone = { rotation: Quat; position?: Vec3 };
// The reverse of the preset part of the renderer alias table: VMC applications use the VRM 0 clip names (B21 R7).
const VRM0_CLIPS: Readonly<Record<string, string>> = { happy: 'Joy', angry: 'Angry', sad: 'Sorrow', relaxed: 'Fun', aa: 'A', ih: 'I', ou: 'U', ee: 'E', oh: 'O', blink: 'Blink', blinkLeft: 'Blink_L', blinkRight: 'Blink_R' };
// three.js `Vector3.applyQuaternion`.
const rotate = ([x, y, z]: Vec3, [qx, qy, qz, qw]: Quat): Vec3 => {
 const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
 return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
};
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// The final raw pose of one character, in the OpenSekai (three.js) frame of the raw rig. It repeats the order of
// `apply` in renderer/src/avatar-pose.ts in data, with each rest rotation as identity (the Warudo rule, B21 R7).
export function vmcSendPose(pose: AvatarPose | undefined, rig: AvatarRig): Omit<VmcSendPose, 'senderId'> {
 const has = (name: string) => Object.hasOwn(rig.restPositions, name);
 const sign = rig.metaVersion === '0' ? -1 : 1;
 const signed = ([x, y, z, w]: Quat): Quat => [x * sign, y, z * sign, w];
 // A chestless rig carries the chest delta on the spine, as `resolveChest` does.
 const resolveChest = (normalized: Record<string, Bone>) => {
  const chest = normalized.chest;
  if (!chest || has('chest')) return;
  const spine = normalized.spine, rotation = spine?.rotation ?? IDENTITY;
  normalized.spine = { rotation: multiplyQuat(rotation, chest.rotation), position: add(rotate(chest.position ?? [0, 0, 0], rotation), spine?.position ?? [0, 0, 0]) };
  delete normalized.chest;
 };
 const normalized: Record<string, Bone> = {};
 for (const [name, bone] of Object.entries(pose?.baseBones ?? {})) {
  const [x, y, z] = bone.position ?? [0, 0, 0];
  normalized[name] = { rotation: signed(bone.rotation), ...(bone.position ? { position: [x * sign, y, z * sign] as Vec3 } : {}) };
 }
 resolveChest(normalized);
 for (const [name, bone] of Object.entries(pose?.bones ?? {})) {
  if (bone.space !== 'normalized') continue;
  const weight = bone.weight ?? 1;
  const target = name === 'chest' && !has('chest') && pose?.bones.spine?.space !== 'normalized' ? 'spine' : name;
  const baseline = normalized[target];
  const position = bone.position ? lerp(baseline?.position ?? [0, 0, 0], bone.position, weight) : baseline?.position;
  normalized[target] = { rotation: slerpQuat(baseline?.rotation ?? IDENTITY, bone.rotation, weight), ...(position ? { position } : {}) };
 }
 resolveChest(normalized);
 // Spine before chest, so a chestless rig composes them as `resolveChest` does.
 const offsets = Object.entries(pose?.boneOffsets ?? {}).sort(([a], [b]) => Number(a === 'chest') - Number(b === 'chest')).map(([name, offset]) => {
  const target = name === 'chest' && !has('chest') ? 'spine' : name;
  return { target, raw: pose?.bones[target]?.space === 'raw', offset: normalize(signed(offset)) };
 });
 for (const { target, raw, offset } of offsets) {
  if (raw || !has(target)) continue;
  const current = normalized[target];
  normalized[target] = { ...current, rotation: multiplyQuat(offset, current?.rotation ?? IDENTITY) };
 }
 // The normalized rig moves only the hips position: its delta adds to the rest position (three-vrm `update`).
 const raw: Record<string, { rotation: Quat; position: Vec3 }> = Object.fromEntries(Object.entries(rig.restPositions).map(([name, rest]) => {
  const delta = name === 'hips' ? normalized.hips?.position : undefined;
  return [name, { rotation: normalized[name]?.rotation ?? IDENTITY, position: delta ? add(rest, delta) : rest }];
 }));
 for (const [name, bone] of Object.entries(pose?.bones ?? {})) {
  const current = raw[name];
  if (bone.space !== 'raw' || !current) continue;
  const weight = bone.weight ?? 1;
  const start = pose?.baseBones ? current : { rotation: IDENTITY, position: bone.position ? rig.restPositions[name]! : current.position };
  raw[name] = { rotation: slerpQuat(start.rotation, bone.rotation, weight), position: bone.position ? lerp(start.position, bone.position, weight) : start.position };
 }
 for (const { target, raw: driven, offset } of offsets) {
  const current = raw[target];
  if (driven && current) raw[target] = { ...current, rotation: multiplyQuat(offset, current.rotation) };
 }
 const blends: Record<string, number> = {};
 for (const [name, weight] of Object.entries(pose?.expressions ?? {})) {
  const sent = Object.hasOwn(VRM0_CLIPS, name) ? VRM0_CLIPS[name]! : name;
  if (vmcBlendNameOk(sent)) blends[sent] = Math.max(blends[sent] ?? 0, weight);
 }
 return {
  root: { position: pose?.root?.position ?? [0, 0, 0], rotation: normalize(pose?.root?.rotation ?? IDENTITY) },
  bones: Object.fromEntries(Object.entries(raw).map(([name, bone]) => [name, { position: bone.position, rotation: normalize(bone.rotation) }])),
  blends,
 };
}

// One pose for each enabled sender whose character has a model with a supported rig (B21 R8). A character without
// a pose in the frame sends the rest pose. Empty when no sender qualifies.
export function vmcPosesFor(scene: SceneView, poses: readonly AvatarPose[], record: (assetId: Id) => AssetRecord | undefined): VmcSendPose[] {
 return scene.entities.flatMap(entity => {
  if (entity.kind !== 'vmcSender' || !entity.vmcSender.enabled || entity.vmcSender.avatarId === null) return [];
  const avatarId = entity.vmcSender.avatarId;
  const avatar = scene.entities.find(item => item.id === avatarId && item.kind === 'avatar');
  const rig = avatar?.kind === 'avatar' && avatar.assetId !== null ? record(avatar.assetId)?.rig : undefined;
  if (!rig?.identityRest) return [];
  return [{ senderId: entity.id, ...vmcSendPose(poses.find(pose => pose.avatarId === avatarId), rig) }];
 }).slice(0, LIMITS.vmcSenders);
}

// A show file never starts a send: each sender of a start scene or an opened show is disabled (B21 R2).
export const withSendersStopped = <T extends SceneView>(scene: T): T => scene.entities.some(entity => entity.kind === 'vmcSender' && entity.vmcSender.enabled)
 ? { ...scene, entities: scene.entities.map(entity => entity.kind === 'vmcSender' ? { ...entity, vmcSender: { ...entity.vmcSender, enabled: false } } : entity) }
 : scene;
