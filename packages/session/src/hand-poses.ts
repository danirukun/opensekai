import type {HandPoseId, Quat, Vec3} from '@opensekai/contracts';
import {FINGER_BONES} from '@opensekai/contracts';
import {eulerToQuat} from './bone-offsets';

export type HandBone = {rotation: Quat; space: 'normalized'};

type FingerCurl = readonly [proximal: number, intermediate: number, distal: number];
type FingerEuler = readonly [proximal: Vec3, intermediate: Vec3, distal: Vec3];
type ThumbEuler = readonly [metacarpal: Vec3, proximal: Vec3, distal: Vec3];
type HandShape = {
  thumb: ThumbEuler;
  index: FingerCurl | FingerEuler;
  middle: FingerCurl;
  ring: FingerCurl;
  little: FingerCurl;
};

// Degrees applied to each finger joint (proximal / intermediate / distal), not a chain total.
// Rem probe: Z curl of ~80° per joint closes the fist; a chain-total of 88° looks almost open.
const joints = (amount: number): FingerCurl => [amount * 0.85, amount, amount * 0.75];

// Thumb euler is [x, y, z] in degrees in the right-hand frame.
// X folds across the palm; Y opposes toward the index; Z curls the tip.
// Left mirrors YXZ across the sagittal plane as [x, -y, -z] (keep fold X).
const thumbShape = (fold: number, oppose: number, curl: number): ThumbEuler => [
  [fold, oppose, curl * 0.25],
  [fold * 0.55, oppose * 0.7, curl],
  [fold * 0.2, oppose * 0.25, curl * 0.75],
];

// Tip pinch index: light per-joint curl + Y adduction toward the thumb.
const pinchIndex = (curl: number, adduct: number): FingerEuler => [
  [0, adduct, curl * 0.7],
  [0, adduct * 0.45, curl],
  [0, adduct * 0.2, curl * 0.85],
];

const SHAPES: Record<HandPoseId, HandShape> = {
  open: {
    thumb: thumbShape(6, 10, 6),
    index: joints(8),
    middle: joints(8),
    ring: joints(10),
    little: joints(12),
  },
  idle: {
    thumb: thumbShape(10, 14, 12),
    index: joints(18),
    middle: joints(20),
    ring: joints(22),
    little: joints(24),
  },
  fist: {
    // Fold (X) across the knuckles; lighter oppose so the thumb does not stick out sideways.
    thumb: thumbShape(70, 28, 42),
    index: joints(95),
    middle: joints(98),
    ring: joints(100),
    little: joints(102),
  },
  grab: {
    thumb: thumbShape(26, 34, 42),
    index: joints(58),
    middle: joints(62),
    ring: joints(66),
    little: joints(68),
  },
  pinch1: {
    // Rem/Catboy tip sweep: light fold + oppose; index curls to meet the tip (~1.5–2 cm).
    thumb: thumbShape(16, -16, 8),
    index: pinchIndex(55, -8),
    middle: joints(78),
    ring: joints(82),
    little: joints(84),
  },
  pinch2: {
    thumb: thumbShape(20, -20, 10),
    index: pinchIndex(70, -10),
    middle: joints(82),
    ring: joints(86),
    little: joints(88),
  },
  hold1: {
    thumb: thumbShape(22, 28, 32),
    index: joints(48),
    middle: joints(50),
    ring: joints(52),
    little: joints(54),
  },
  hold2: {
    thumb: thumbShape(24, 30, 36),
    index: joints(52),
    middle: joints(56),
    ring: joints(58),
    little: joints(60),
  },
  okayDokey: {
    thumb: thumbShape(22, -18, 12),
    index: pinchIndex(58, -10),
    middle: joints(12),
    ring: joints(14),
    little: joints(16),
  },
  peace: {
    thumb: thumbShape(20, 28, 40),
    index: joints(8),
    middle: joints(8),
    ring: joints(78),
    little: joints(82),
  },
  point1: {
    thumb: thumbShape(18, 24, 30),
    index: joints(6),
    middle: joints(78),
    ring: joints(82),
    little: joints(84),
  },
  point2: {
    thumb: thumbShape(18, 24, 30),
    index: joints(4),
    middle: joints(80),
    ring: joints(84),
    little: joints(86),
  },
  hangLoose: {
    thumb: thumbShape(6, 8, 10),
    index: joints(78),
    middle: joints(82),
    ring: joints(84),
    little: joints(8),
  },
  rockOn: {
    thumb: thumbShape(14, 18, 24),
    index: joints(8),
    middle: joints(80),
    ring: joints(84),
    little: joints(8),
  },
  pistolGrip: {
    thumb: thumbShape(14, 18, 16),
    index: joints(10),
    middle: joints(70),
    ring: joints(74),
    little: joints(76),
  },
  scoop: {
    thumb: thumbShape(14, 18, 20),
    index: joints(34),
    middle: joints(36),
    ring: joints(38),
    little: joints(40),
  },
  scratch: {
    thumb: thumbShape(12, 16, 16),
    index: joints(28),
    middle: joints(30),
    ring: joints(32),
    little: joints(34),
  },
  screwYou: {
    thumb: thumbShape(18, 24, 32),
    index: joints(80),
    middle: joints(8),
    ring: joints(82),
    little: joints(84),
  },
  splayedOut: {
    thumb: thumbShape(4, 6, 4),
    index: joints(2),
    middle: joints(2),
    ring: joints(2),
    little: joints(2),
  },
  thumbsUp: {
    thumb: [[-8, -8, -12], [-10, -12, -18], [-4, -4, -10]],
    index: joints(78),
    middle: joints(82),
    ring: joints(84),
    little: joints(86),
  },
};

const DIGIT = /^(left|right)(Thumb|Index|Middle|Ring|Little)(Metacarpal|Proximal|Intermediate|Distal)$/;

const sideBones = (side: 'left' | 'right') =>
  FINGER_BONES.filter(name => name.startsWith(side));

const scaleEuler = (euler: Vec3, sign: number): Vec3 => [euler[0], euler[1] * sign, euler[2] * sign];

function boneRotation(shape: HandShape, bone: string, sign: number): Quat {
  const match = DIGIT.exec(bone);
  if (!match) return eulerToQuat([0, 0, 0]);
  const digit = match[2] as 'Thumb' | 'Index' | 'Middle' | 'Ring' | 'Little';
  const joint = match[3]!;
  if (digit === 'Thumb') {
    const index = joint === 'Metacarpal' ? 0 : joint === 'Proximal' ? 1 : 2;
    return eulerToQuat(scaleEuler(shape.thumb[index]!, sign));
  }
  const digitShape = shape[digit.toLowerCase() as 'index' | 'middle' | 'ring' | 'little'];
  const curlIndex = joint === 'Proximal' ? 0 : joint === 'Intermediate' ? 1 : 2;
  const sample = digitShape[curlIndex]!;
  const euler: Vec3 = typeof sample === 'number' ? [0, 0, sample] : sample;
  return eulerToQuat(scaleEuler(euler, sign));
}

export function evaluateHandPose(side: 'left' | 'right', pose: HandPoseId): Record<string, HandBone> {
  const shape = SHAPES[pose];
  const sign = side === 'left' ? -1 : 1;
  const out: Record<string, HandBone> = {};
  for (const bone of sideBones(side)) {
    out[bone] = {space: 'normalized', rotation: boneRotation(shape, bone, sign)};
  }
  return out;
}
