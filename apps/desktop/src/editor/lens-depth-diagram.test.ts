import { describe, expect, it } from 'vitest';
import { commitFocusFromClientX, focusDistanceFromX, focusXFromDistance, layoutLensDepth } from './lens-depth-diagram';

const W = 280;
const defaultLens = { fovDegrees: 27, fStop: 4, focusDistance: 3 };
const portraitLens = { fovDegrees: 16.1, fStop: 1.8, focusDistance: 3 };

describe('layoutLensDepth', () => {
  it('narrows the cone when FOV is smaller', () => {
    const wide = layoutLensDepth(defaultLens, W);
    const tight = layoutLensDepth(portraitLens, W);
    expect(tight.coneHalfPx).toBeLessThan(wide.coneHalfPx);
  });
  it('thins the DoF band when f-stop is lower', () => {
    const deep = layoutLensDepth(defaultLens, W);
    const shallow = layoutLensDepth(portraitLens, W);
    expect(shallow.dofHalfPx).toBeLessThan(deep.dofHalfPx);
  });
  it('places focus farther right when focusDistance increases', () => {
    const near = layoutLensDepth({ ...defaultLens, focusDistance: 1 }, W);
    const far = layoutLensDepth({ ...defaultLens, focusDistance: 10 }, W);
    expect(far.focusX).toBeGreaterThan(near.focusX);
  });
});

describe('focus x ↔ distance', () => {
  it('round-trips inside the slider range', () => {
    for (const d of [0.01, 1, 3, 30, 100]) {
      const x = focusXFromDistance(d, W);
      expect(focusDistanceFromX(x, W)).toBeCloseTo(d, 1);
    }
  });
});

describe('commitFocusFromClientX', () => {
  const max = commitFocusFromClientX(W - 12, { left: 0, width: W }, W);
  it('maps the right edge of a stretched rect to the same distance as an unstretched one', () => {
    const rect = { left: 40, width: 560 };
    expect(commitFocusFromClientX(rect.left + rect.width - 12 * 2, rect, W)).toBeCloseTo(max, 1);
    expect(commitFocusFromClientX(rect.left + rect.width, rect, W)).toBeCloseTo(max, 1);
  });
  it('maps a rect midpoint like the viewBox midpoint', () => {
    const rect = { left: 10, width: 560 };
    expect(commitFocusFromClientX(10 + 280, rect, W)).toBeCloseTo(commitFocusFromClientX(140, { left: 0, width: W }, W), 1);
  });
});
