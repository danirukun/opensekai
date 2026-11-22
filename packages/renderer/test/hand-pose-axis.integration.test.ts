import {readFileSync, writeFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName} from '@pixiv/three-vrm';
import {Quaternion, Texture, Vector3} from 'three';
import {createAvatarBinding} from '../src/avatar-pose';
import {evaluateHandPose} from '../../session/src/hand-poses';
import {eulerToQuat} from '../../session/src/bone-offsets';
import type {AvatarPose} from '@opensekai/contracts';
import {FINGER_BONES} from '@opensekai/contracts';

const library =
  `${process.env.HOME}/Library/Application Support/com.oshi-connect.opensekai/assets/library/`;
const remPath = library + 'avatar_e5475ed3ce2b4156ecf7066bf6e11baa2cf7d2a81f03ecfabb5b2225f0375654.vrm';
const catboyPath = library + 'avatar_7b7c689e4e2ad3e6f6fe6cdb615ffad76d81ff788fcf61e7b9473fa73e024373.vrm';

const loadVrm = async (path: string, label: string): Promise<VRM> => {
  const bytes = readFileSync(path);
  const loader = new GLTFLoader();
  loader.register(() => ({name: 'test_no_images', loadTexture: () => Promise.resolve(new Texture())}) as never);
  loader.register(parser => new VRMLoaderPlugin(parser));
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(copy as ArrayBuffer, '');
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error(`${label} VRM failed to load`);
  VRMUtils.rotateVRM0(vrm);
  return vrm;
};

const tipGap = (vrm: VRM, side: 'left' | 'right') => {
  const hand = vrm.humanoid.getRawBoneNode(`${side}Hand` as VRMHumanBoneName)!;
  const index = vrm.humanoid.getRawBoneNode(`${side}IndexDistal` as VRMHumanBoneName)!;
  const thumb = vrm.humanoid.getRawBoneNode(`${side}ThumbDistal` as VRMHumanBoneName)!;
  const handPos = hand.getWorldPosition(new Vector3());
  const indexPos = index.getWorldPosition(new Vector3());
  const thumbPos = thumb.getWorldPosition(new Vector3());
  return {
    indexToHand: indexPos.distanceTo(handPos),
    thumbToIndex: thumbPos.distanceTo(indexPos),
  };
};

const applyAxisCurl = (binding: ReturnType<typeof createAvatarBinding>, axis: 0 | 1 | 2, degrees: number, side: 'left' | 'right') => {
  const sign = side === 'left' ? -1 : 1;
  const euler: [number, number, number] = [0, 0, 0];
  euler[axis] = degrees * sign;
  const q = eulerToQuat(euler);
  const bones: AvatarPose['bones'] = {};
  for (const name of FINGER_BONES.filter(n => n.startsWith(side) && !n.includes('Thumb'))) {
    bones[name] = {space: 'normalized', rotation: q};
  }
  binding.apply({avatarId: 'a', bones, expressions: {}});
};

const probe = async (path: string, label: string, reportPath: string) => {
  const vrm = await loadVrm(path, label);
  const binding = createAvatarBinding(vrm);
  binding.apply({avatarId: 'a', bones: {}, expressions: {}});
  const open = tipGap(vrm, 'left');

  const gaps: Record<string, number> = {};
  for (const [name, axis] of [['x', 0], ['y', 1], ['z', 2]] as const) {
    applyAxisCurl(binding, axis, 80, 'left');
    gaps[name] = tipGap(vrm, 'left').indexToHand;
  }

  const best = Object.entries(gaps).sort((a, b) => a[1]! - b[1]!)[0]!;

  const fist = evaluateHandPose('left', 'fist');
  const bones: AvatarPose['bones'] = {};
  for (const [name, bone] of Object.entries(fist)) bones[name] = bone;
  binding.apply({avatarId: 'a', bones, expressions: {}});
  const posed = tipGap(vrm, 'left');

  const report = {label, open: open.indexToHand, gaps, best: best[0], posed, meta: vrm.meta.metaVersion};
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return report;
};

describe('hand pose curl axis', () => {
  it('closes a fist on Rem (VRM 1) with Z curl', async () => {
    const report = await probe(remPath, 'rem', '/tmp/hand-axis-report-rem.json');
    expect(report.best).toBe('z');
    expect(report.gaps.z!).toBeLessThan(report.open * 0.7);
    expect(report.posed.indexToHand).toBeLessThan(report.open * 0.7);
    expect(report.posed.indexToHand).toBeLessThan(report.gaps.z! * 1.25);
  }, 60_000);

  it('reports curl axis and fist closure on Catboy (VRM 0, Lighting Demo)', async () => {
    const report = await probe(catboyPath, 'catboy', '/tmp/hand-axis-report-catboy.json');
    // Document whatever axis wins; fist must still close relative to open.
    expect(report.posed.indexToHand).toBeLessThan(report.open * 0.85);
  }, 60_000);
});
