import type {HandPoseId, Quat} from '@opensekai/contracts';
import {FINGER_BONES} from '@opensekai/contracts';
import {eulerToQuat} from './bone-offsets';

export type HandBone = {rotation: Quat; space: 'normalized'};

const curl = (amount: number): Quat => eulerToQuat([0, 0, amount]);
const thumb = (amount: number): Quat => eulerToQuat([0, amount, amount * 0.5]);

const SHAPES: Record<HandPoseId, {curl: number; thumb: number; splay?: number}> = {
  open: {curl: 5, thumb: 10},
  fist: {curl: 75, thumb: 45},
  grab: {curl: 55, thumb: 35},
  hangLoose: {curl: 70, thumb: 5},
  hold1: {curl: 45, thumb: 25},
  hold2: {curl: 50, thumb: 30},
  idle: {curl: 15, thumb: 12},
  okayDokey: {curl: 40, thumb: 50},
  peace: {curl: 65, thumb: 20},
  pinch1: {curl: 35, thumb: 40},
  pinch2: {curl: 40, thumb: 45},
  pistolGrip: {curl: 50, thumb: 15},
  point1: {curl: 70, thumb: 25},
  point2: {curl: 72, thumb: 28},
  rockOn: {curl: 70, thumb: 10},
  scoop: {curl: 30, thumb: 20},
  scratch: {curl: 25, thumb: 15},
  screwYou: {curl: 75, thumb: 20},
  splayedOut: {curl: 0, thumb: 5, splay: 12},
  thumbsUp: {curl: 70, thumb: -20},
};

const sideBones = (side: 'left' | 'right') =>
  FINGER_BONES.filter(name => name.startsWith(side));

export function evaluateHandPose(side: 'left' | 'right', pose: HandPoseId): Record<string, HandBone> {
  const shape = SHAPES[pose];
  const sign = side === 'left' ? -1 : 1;
  const out: Record<string, HandBone> = {};
  for (const bone of sideBones(side)) {
    const isThumb = bone.includes('Thumb');
    const rotation = isThumb
      ? thumb(shape.thumb * sign)
      : curl(shape.curl * sign + (shape.splay ?? 0) * sign * 0.2);
    out[bone] = {space: 'normalized', rotation};
  }
  return out;
}
