import { dofFocalRangeWorld, type CameraLens } from '@opensekai/contracts';
import { fromSlider, roundToStep, SLIDERS, toSlider } from './slider';

export type LensDepthLayout = {
  coneHalfPx: number;
  focusX: number;
  dofHalfPx: number;
  axisY: number;
  padLeft: number;
  padRight: number;
  width: number;
  height: number;
};

const DEFAULT_HEIGHT = 72;
const PAD_LEFT = 16;
const PAD_RIGHT = 12;

type LensBits = Pick<CameraLens, 'fovDegrees' | 'fStop' | 'focusDistance'>;

const usable = (width: number) => Math.max(1, width - PAD_LEFT - PAD_RIGHT);

export function focusXFromDistance(focusDistance: number, width: number, _height = DEFAULT_HEIGHT): number {
  return PAD_LEFT + toSlider(focusDistance, SLIDERS.focusDistance) * usable(width);
}

export function focusDistanceFromX(x: number, width: number, _height = DEFAULT_HEIGHT): number {
  const t = (x - PAD_LEFT) / usable(width);
  return fromSlider(t, SLIDERS.focusDistance);
}

export function layoutLensDepth(lens: LensBits, width: number, height = DEFAULT_HEIGHT): LensDepthLayout {
  const axisY = height * 0.55;
  const focusX = focusXFromDistance(lens.focusDistance, width, height);
  // Half-angle in radians → vertical pixel span at the right edge of the strip
  const halfRad = (Math.min(179, Math.max(1, lens.fovDegrees)) * Math.PI) / 180 / 2;
  const coneHalfPx = Math.min(height * 0.42, Math.tan(halfRad) * usable(width) * 0.55);
  // Smaller world DoF range → thinner band (Portrait f/1.8 < Default f/4)
  const world = dofFocalRangeWorld(lens.focusDistance, lens.fStop, 'full');
  const dofHalfPx = Math.min(usable(width) * 0.25, Math.max(3, world * 14));
  return { coneHalfPx, focusX, dofHalfPx, axisY, padLeft: PAD_LEFT, padRight: PAD_RIGHT, width, height };
}

export const clampFocusDragX = (x: number, width: number): number =>
  Math.min(width - PAD_RIGHT, Math.max(PAD_LEFT, x));

export const commitFocusFromViewX = (viewX: number, width: number): number =>
  roundToStep(focusDistanceFromX(clampFocusDragX(viewX, width), width), SLIDERS.focusDistance);

export const viewXFromClientX = (clientX: number, rect: { left: number; width: number }, width: number): number =>
  rect.width > 0 ? ((clientX - rect.left) / rect.width) * width : 0;

export const commitFocusFromClientX = (clientX: number, rect: { left: number; width: number }, width: number): number =>
  commitFocusFromViewX(viewXFromClientX(clientX, rect, width), width);
