import type {HandPin, Quat, Vec3} from '@opensekai/contracts';
import {eulerToQuat, IDENTITY, slerpQuat} from './bone-offsets';

export type PinSide = 'left' | 'right';
export type ArmBoneMap = Record<string, {rotation: Quat; space: 'normalized'}>;

export interface HandPinSideState {
  mode: HandPin['mode'];
  /** Euler degrees used as a stable wrist-aim stand-in until full IK (CHR-06). */
  holdEuler: Vec3;
  captured: boolean;
}

export type HandPinRuntime = Partial<Record<PinSide, HandPinSideState>>;

const arm = (side: PinSide) =>
  [`${side}Shoulder`, `${side}UpperArm`, `${side}LowerArm`, `${side}Hand`] as const;

/** Approximate wrist target from overlay arm bones as Euler for the hand bone. */
export function wristEulerFromArm(bones: ArmBoneMap, side: PinSide): Vec3 {
  const hand = bones[`${side}Hand`]?.rotation ?? IDENTITY;
  // Stable hash of quat into a small Euler — pin holds this snapshot.
  return [
    Math.atan2(2 * (hand[3]! * hand[0]! + hand[1]! * hand[2]!), 1 - 2 * (hand[0]! * hand[0]! + hand[1]! * hand[1]!)) * 180 / Math.PI,
    Math.asin(Math.min(1, Math.max(-1, 2 * (hand[3]! * hand[1]! - hand[2]! * hand[0]!)))) * 180 / Math.PI,
    Math.atan2(2 * (hand[3]! * hand[2]! + hand[0]! * hand[1]!), 1 - 2 * (hand[1]! * hand[1]! + hand[2]! * hand[2]!)) * 180 / Math.PI,
  ];
}

export function stepHandPin(
  prev: HandPinRuntime,
  pins: {left?: HandPin; right?: HandPin},
  overlayArms: ArmBoneMap,
  currentArms: ArmBoneMap,
  blend = 1,
): {runtime: HandPinRuntime; armBones: ArmBoneMap} {
  const runtime: HandPinRuntime = {};
  const armBones: ArmBoneMap = {...currentArms};
  const k = Math.min(1, Math.max(0, blend));

  for (const side of ['left', 'right'] as const) {
    const pin = pins[side];
    if (!pin?.enabled) continue;
    const previous = prev[side];
    let holdEuler: Vec3;
    if (pin.mode === 'hold' && previous?.captured && previous.mode === 'hold') {
      holdEuler = previous.holdEuler;
      runtime[side] = previous;
    } else {
      const source = pin.mode === 'preset' ? overlayArms : currentArms;
      holdEuler = wristEulerFromArm(Object.keys(source).length ? source : currentArms, side);
      runtime[side] = {mode: pin.mode, holdEuler, captured: true};
    }
    const targetHand = eulerToQuat(holdEuler);
    const names = arm(side);
    // Keep upper chain from overlay/current; blend only the hand toward the pin.
    for (const name of names) {
      if (!armBones[name] && overlayArms[name]) armBones[name] = overlayArms[name]!;
    }
    const from = armBones[`${side}Hand`]?.rotation ?? IDENTITY;
    armBones[`${side}Hand`] = {space: 'normalized', rotation: slerpQuat(from, targetHand, k)};
  }
  return {runtime, armBones};
}
