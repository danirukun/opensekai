import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName} from '@pixiv/three-vrm';
import {Texture, Vector3} from 'three';
import {createAvatarBinding} from '../src/avatar-pose';
import {evaluateHandPose} from '../../session/src/hand-poses';
import {eulerToQuat} from '../../session/src/bone-offsets';
import type {AvatarPose, HandPoseId} from '@opensekai/contracts';
import {FINGER_BONES} from '@opensekai/contracts';

// Real file boundary: local fixture VRMs (fixtures/local) or the developer asset library. Skip when neither exists.
const manifestPath = fileURLToPath(new URL('../../../fixtures/local/manifest.json', import.meta.url));
const fixturePath = (id: string): string | undefined => {
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {assets: {path: string; record: {id: string}}[]};
  const path = manifest.assets.find(asset => asset.record.id === id)?.path;
  return path && existsSync(path) ? path : undefined;
};

const library =
  process.env.OPENSEKAI_ASSET_LIBRARY ??
  `${process.env.HOME}/Library/Application Support/com.oshi-connect.opensekai/assets/library`;
const libraryPath = (hash: string) => {
  const path = `${library}/avatar_${hash}.vrm`;
  return existsSync(path) ? path : undefined;
};

const samples = [
  {
    label: 'rem',
    // Prefer the Rem library asset used for tip tuning; fixture_vrm_1 is a portable fallback.
    path:
      process.env.OPENSEKAI_HAND_POSE_REM ??
      libraryPath('e5475ed3ce2b4156ecf7066bf6e11baa2cf7d2a81f03ecfabb5b2225f0375654') ??
      fixturePath('fixture_vrm_1'),
  },
  {
    label: 'catboy',
    path:
      process.env.OPENSEKAI_HAND_POSE_CATBOY ??
      libraryPath('7b7c689e4e2ad3e6f6fe6cdb615ffad76d81ff788fcf61e7b9473fa73e024373') ??
      fixturePath('fixture_vrm0_arkit'),
  },
] as const;

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

const distance = (vrm: VRM, a: VRMHumanBoneName, b: VRMHumanBoneName) => {
  const pa = vrm.humanoid.getRawBoneNode(a)!.getWorldPosition(new Vector3());
  const pb = vrm.humanoid.getRawBoneNode(b)!.getWorldPosition(new Vector3());
  return pa.distanceTo(pb);
};

const tipGap = (vrm: VRM, side: 'left' | 'right') => {
  const pref = side === 'left' ? 'left' : 'right';
  return {
    indexToHand: distance(vrm, `${pref}IndexDistal` as VRMHumanBoneName, `${pref}Hand` as VRMHumanBoneName),
    thumbToIndex: distance(vrm, `${pref}ThumbDistal` as VRMHumanBoneName, `${pref}IndexDistal` as VRMHumanBoneName),
    thumbToMiddle: distance(vrm, `${pref}ThumbDistal` as VRMHumanBoneName, `${pref}MiddleIntermediate` as VRMHumanBoneName),
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

const applyHandPose = (binding: ReturnType<typeof createAvatarBinding>, side: 'left' | 'right', pose: HandPoseId) => {
  const bones: AvatarPose['bones'] = {};
  for (const [name, bone] of Object.entries(evaluateHandPose(side, pose))) bones[name] = bone;
  binding.apply({avatarId: 'a', bones, expressions: {}});
};

describe('hand pose curl axis', () => {
  for (const sample of samples) {
    it.skipIf(!sample.path)(`closes fist and pinch on both hands (${sample.label})`, async () => {
      const vrm = await loadVrm(sample.path!, sample.label);
      const binding = createAvatarBinding(vrm);
      binding.apply({avatarId: 'a', bones: {}, expressions: {}});
      const rest = {left: tipGap(vrm, 'left'), right: tipGap(vrm, 'right')};

      const gaps: Record<string, number> = {};
      for (const [name, axis] of [['x', 0], ['y', 1], ['z', 2]] as const) {
        applyAxisCurl(binding, axis, 80, 'right');
        gaps[name] = tipGap(vrm, 'right').indexToHand;
      }
      const best = Object.entries(gaps).sort((a, b) => a[1]! - b[1]!)[0]!;
      expect(best[0]).toBe('z');
      expect(gaps.z!).toBeLessThan(rest.right.indexToHand * 0.7);

      for (const side of ['left', 'right'] as const) {
        applyHandPose(binding, side, 'fist');
        const fist = tipGap(vrm, side);
        expect(fist.indexToHand).toBeLessThan(rest[side].indexToHand * 0.7);
        expect(fist.thumbToMiddle).toBeLessThan(rest[side].thumbToMiddle * 0.75);

        applyHandPose(binding, side, 'pinch2');
        const pinch = tipGap(vrm, side);
        expect(pinch.thumbToIndex).toBeLessThan(0.025);
        expect(pinch.thumbToIndex).toBeLessThan(rest[side].thumbToIndex * 0.45);
      }

      applyHandPose(binding, 'left', 'fist');
      const leftFist = tipGap(vrm, 'left');
      applyHandPose(binding, 'right', 'fist');
      const rightFist = tipGap(vrm, 'right');
      expect(Math.abs(leftFist.thumbToMiddle - rightFist.thumbToMiddle)).toBeLessThan(0.005);
    }, 60_000);
  }
});
