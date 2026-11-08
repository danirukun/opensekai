import type { Easing, HazeSettings, Vec3 } from '@opensekai/contracts';
import type { ColorWord, Direction, Duration, EasingWord, Framing, HazeDensity, Height, Intensity, Reflections, Wait } from './intents';

export type LightType = 'directional' | 'point' | 'spot' | 'ambient';

const s2 = Math.SQRT1_2;

// Direction vectors are unit offsets from the target, +Y up. Avatars face +Z, and the words are from the viewer's side,
// facing the avatar from its front: `left` is −X, left in the output image and the avatar's right.
export const WORDS = {
 // Light at the target in directional-light units; the compiler scales a spot or point light by its distance squared.
 // Calibrated on OBS frames of an MToon avatar, which shows its texture color near π in total.
 intensity: {
  dim: { directional: 0.5, point: 0.5, spot: 0.5, ambient: 0.15 },
  soft: { directional: 1, point: 1, spot: 1, ambient: 0.3 },
  normal: { directional: 2, point: 2, spot: 2, ambient: 0.5 },
  bright: { directional: 3, point: 3, spot: 3, ambient: 0.8 },
 } satisfies Record<Intensity, Record<LightType, number>>,
 color: {
  candle: '#ff9329', warm: '#ffc58f', neutral: '#fff1e0', daylight: '#ffffff', cool: '#c9e2ff', white: '#ffffff',
  red: '#ff2a2a', orange: '#ff8a1f', yellow: '#ffe01f', green: '#2aff5a', cyan: '#1fe5ff', blue: '#2a5aff',
  purple: '#a02aff', pink: '#ff5ac8',
 } satisfies Record<ColorWord, string>,
 framing: {
  wide: { distance: 5, fovDegrees: 50, aimHeight: 1 },
  medium: { distance: 2.8, fovDegrees: 40, aimHeight: 1.2 },
  closeUp: { distance: 1.5, fovDegrees: 32, aimHeight: 1.5 },
  extremeCloseUp: { distance: 0.8, fovDegrees: 26, aimHeight: 1.6 },
 } satisfies Record<Framing, { distance: number; fovDegrees: number; aimHeight: number }>,
 height: { low: 0.4, eye: 1.5, high: 2.6 } satisfies Record<Height, number>,
 duration: { quick: 2, normal: 4, slow: 8, verySlow: 16 } satisfies Record<Duration, number>,
 easing: { smooth: 'InOutSine', linear: 'Linear', easeIn: 'InQuad', easeOut: 'OutQuad' } satisfies Record<EasingWord, Easing>,
 haze: {
  off: { density: 0, smoke: 0, intensity: 0, drift: 0 },
  light: { density: 0.3, smoke: 0.5, intensity: 1, drift: 0.2 },
  medium: { density: 0.7, smoke: 1.2, intensity: 1.5, drift: 0.3 },
  thick: { density: 1.4, smoke: 2.2, intensity: 2.5, drift: 0.4 },
 } satisfies Record<HazeDensity, HazeSettings>,
 reflections: { off: 0, low: 0.4, normal: 1, high: 1.6 } satisfies Record<Reflections, number>,
 wait: { short: 0.5, medium: 1.5, long: 4 } satisfies Record<Wait, number>,
 direction: {
  front: [0, 0, 1], frontLeft: [-s2, 0, s2], left: [-1, 0, 0], backLeft: [-s2, 0, -s2], back: [0, 0, -1],
  backRight: [s2, 0, -s2], right: [1, 0, 0], frontRight: [s2, 0, s2], above: [0, 1, 0],
 } satisfies Record<Direction, Vec3>,
};
