import { expect, it } from 'vitest';
import { makeSmokeScene, type SceneView, type Transform } from '@opensekai/contracts';
import { followOffset, followShift, persistentCamera, shiftTransform, type Follow } from '../src/orbit-follow';

const orbit = { mode: 'orbitCharacter' as const, sensitivity: 1, targetId: 'performer', pivotOffset: [0, 1.3, 0] as [number, number, number] };
const scene = (performer: [number, number, number], camera: Transform, navigation = orbit): SceneView => {
    const s = makeSmokeScene();
    for (const e of s.entities) {
        if (e.id === 'performer') e.transform.position = performer;
        if (e.id === 'camera_wide' && e.kind === 'camera') { e.transform = camera; e.navigation = navigation; }
    }
    return s;
};
const committed: Transform = { position: [1, 1.5, 3], rotation: [0, 0.1, 0, Math.sqrt(1 - 0.01)], scale: [1, 1, 1] };
const follow: Follow = { cameraId: 'camera_wide', targetId: 'performer', base: [0, 0, 0] };

it('gives the evaluated target offset from its persistent position', () => {
    expect(followOffset(scene([0.5, 0, -1], committed), follow)).toEqual([0.5, 0, -1]);
    expect(followOffset(null, follow)).toEqual([0, 0, 0]);
    expect(shiftTransform(committed, [1, 0, -1]).position).toEqual([2, 1.5, 2]);
});

it('accepts a change that moved the target and the camera by the same amount, and nothing else', () => {
    expect(followShift(scene([0.5, 0, -1], shiftTransform(committed, [0.5, 0, -1])), follow, committed)).toEqual([0.5, 0, -1]);
    // The camera moved by another amount, turned, or changed its mode or target: the other edit wins.
    expect(followShift(scene([0.5, 0, -1], shiftTransform(committed, [0.4, 0, -1])), follow, committed)).toBeNull();
    expect(followShift(scene([0.5, 0, -1], { ...shiftTransform(committed, [0.5, 0, -1]), rotation: [0, 0, 0, 1] }), follow, committed)).toBeNull();
    expect(followShift(scene([0.5, 0, -1], shiftTransform(committed, [0.5, 0, -1]), { ...orbit, targetId: null as never }), follow, committed)).toBeNull();
    // The target did not move: the change was another edit.
    expect(followShift(scene([0, 0, 0], committed), follow, committed)).toBeNull();
});

it('starts a gesture where the camera shows while a Blueprint moves it, and at the scene value otherwise', () => {
    const follow: Follow = { cameraId: 'camera_wide', targetId: 'performer', base: [0, 0, 0] };
    const tweened: Transform = { position: [-1.9, 1.5, 1.6], rotation: [0, -0.4, 0, Math.sqrt(1 - 0.16)], scale: [1, 1, 1] };
    // A Blueprint move in progress: the evaluated camera is away from the scene value, and the character does not move.
    expect(persistentCamera(scene([0, 0, 0], tweened), follow, tweened, committed)).toEqual(tweened);
    // The character walks 2 m along X through an override: the evaluated camera has the follow offset, and the persistent value does not.
    const walked = shiftTransform(tweened, [2, 0, 0]);
    expect(persistentCamera(scene([2, 0, 0], walked), follow, walked, committed).position).toEqual(tweened.position);
    expect(persistentCamera(scene([2, 0, 0], walked), follow, walked, committed).rotation).toEqual(tweened.rotation);
    // No move: the evaluated camera is the scene value, and a small motion of the evaluated character root does not shift the start.
    expect(persistentCamera(scene([0.03, -0.01, 0], committed), follow, committed, committed)).toBe(committed);
});
