import { expect, it } from 'vitest';
import { distance, focusCharacterId, headFallbackPosition, smoothFocusDistance } from '../src/autofocus';

it('moves the focus distance toward the target at a dt-scaled lerp rate', () => {
    // At exactly 60 Hz, the lerp rate equals focusSpeed (dt*60 === 1).
    expect(smoothFocusDistance(2, 5, 0.5, 1 / 60)).toBeCloseTo(3.5, 10);
    // Two 60 Hz steps at the same focusSpeed compound: 1-(1-0.5)^2 of the remaining gap.
    const afterOne = smoothFocusDistance(2, 5, 0.5, 1 / 60);
    const afterTwo = smoothFocusDistance(afterOne, 5, 0.5, 1 / 60);
    expect(afterTwo).toBeCloseTo(smoothFocusDistance(2, 5, 0.5, 2 / 60), 10);
    // focusSpeed 1 snaps to the target in one step.
    expect(smoothFocusDistance(2, 5, 1, 1 / 60)).toBeCloseTo(5, 10);
    // focusSpeed 0 never moves.
    expect(smoothFocusDistance(2, 5, 0, 1 / 60)).toBe(2);
    // No elapsed time leaves the value unchanged.
    expect(smoothFocusDistance(2, 5, 0.5, 0)).toBe(2);
});

it('falls back to the avatar root plus a 1.5 m head offset', () => {
    expect(headFallbackPosition([1, 0, -2])).toEqual([1, 1.5, -2]);
    expect(headFallbackPosition([0, 0, 0])).toEqual([0, 1.5, 0]);
});

it('measures the straight-line distance between two world points', () => {
    expect(distance([0, 0, 0], [3, 4, 0])).toBe(5);
    expect(distance([1, 1, 1], [1, 1, 1])).toBe(0);
});

it('resolves the Focus Character only from an Orbit Character navigation with a target', () => {
    expect(focusCharacterId({ mode: 'orbitCharacter', sensitivity: 1, targetId: 'performer', pivotOffset: [0, 1.3, 0] })).toBe('performer');
    expect(focusCharacterId({ mode: 'orbitCharacter', sensitivity: 1, targetId: null, pivotOffset: [0, 1.3, 0] })).toBeNull();
    expect(focusCharacterId({ mode: 'freeLook', sensitivity: 1 })).toBeNull();
    expect(focusCharacterId({ mode: 'none' })).toBeNull();
    expect(focusCharacterId(undefined)).toBeNull();
});
