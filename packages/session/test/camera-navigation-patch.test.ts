import { it, expect } from 'vitest';
import { makeSmokeScene, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '../src/session';
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const camera = (s: ReturnType<typeof createSession>, id: string) => s.inspect().entities.find(e => e.id === id) as Extract<SceneEntity, { kind: 'camera' }>;
const orbit = { mode: 'orbitCharacter', sensitivity: 1, targetId: 'performer', pivotOffset: [0, 1.3, 0] } as const;

it('sets each control mode on a camera and increases the revision', () => {
    const s = createSession(makeSmokeScene(), 'nav-test');
    expect(camera(s, 'camera_wide').navigation).toBeUndefined();
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraNavigation', entityId: 'camera_wide', navigation: { mode: 'freeLook', sensitivity: 2 } }]))).toEqual({ ok: true, data: { revision: 1 } });
    expect(camera(s, 'camera_wide').navigation).toEqual({ mode: 'freeLook', sensitivity: 2 });
    expect(s.applyPatch(patch(1, [{ kind: 'setCameraNavigation', entityId: 'camera_wide', navigation: orbit }])).ok).toBe(true);
    expect(camera(s, 'camera_wide').navigation).toEqual(orbit);
    expect(s.applyPatch(patch(2, [{ kind: 'setCameraNavigation', entityId: 'camera_wide', navigation: { mode: 'none' } }])).ok).toBe(true);
    expect(camera(s, 'camera_wide').navigation).toEqual({ mode: 'none' });
});

it('rejects another kind, an unknown entity, a bad target, and out-of-range values without a change', () => {
    const s = createSession(makeSmokeScene(), 'nav-test'); const before = s.inspect();
    const set = (entityId: string, navigation: unknown) => s.applyPatch(patch(0, [{ kind: 'setCameraNavigation', entityId, navigation }]));
    expect(set('performer', { mode: 'none' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(set('nobody', { mode: 'none' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(set('camera_wide', { ...orbit, targetId: 'missing' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(set('camera_wide', { ...orbit, targetId: 'marker' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
});

it('applies a transform and a pivot change in one revision', () => {
    const s = createSession(makeSmokeScene(), 'nav-test');
    const transform = { position: [1, 1.5, 2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
    expect(s.applyPatch(patch(0, [
        { kind: 'setTransform', entityId: 'camera_wide', transform },
        { kind: 'setCameraNavigation', entityId: 'camera_wide', navigation: { ...orbit, pivotOffset: [0.5, 1.3, 0] } },
    ]))).toEqual({ ok: true, data: { revision: 1 } });
    expect(camera(s, 'camera_wide')).toMatchObject({ transform, navigation: { pivotOffset: [0.5, 1.3, 0] } });
});

it('clears the Focus Character of each camera when the avatar is removed', () => {
    const s = createSession(makeSmokeScene(), 'nav-test');
    expect(s.applyPatch(patch(0, [
        { kind: 'setCameraNavigation', entityId: 'camera_wide', navigation: orbit },
        { kind: 'setCameraNavigation', entityId: 'camera_close', navigation: orbit },
    ])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'removeEntity', entityId: 'performer' }]))).toEqual({ ok: true, data: { revision: 2 } });
    for (const id of ['camera_wide', 'camera_close']) expect(camera(s, id).navigation).toEqual({ ...orbit, targetId: null });
});

it('creates a camera with its navigation and rejects a ninth camera', () => {
    const s = createSession(makeSmokeScene(), 'nav-test');
    const make = (id: string) => ({ kind: 'createEntity', entity: { id, name: id, visible: true, kind: 'camera', transform: { position: [0, 1.2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, lens: { fovDegrees: 40, near: 0.01, far: 100 }, navigation: { mode: 'freeLook', sensitivity: 1 } } });
    // The smoke scene has two cameras.
    expect(s.applyPatch(patch(0, [1, 2, 3, 4, 5, 6].map(i => make(`camera_${i}`)))).ok).toBe(true);
    expect(camera(s, 'camera_6').navigation).toEqual({ mode: 'freeLook', sensitivity: 1 });
    expect(s.applyPatch(patch(1, [make('camera_9')]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('cuts between two cameras on each output and keeps the tick running (R13)', () => {
    const s = createSession(makeSmokeScene(), 'nav-test');
    let frame = s.advance(0);
    const cameraOf = (outputId: string) => frame.scene.outputs.find(o => o.id === outputId)?.cameraId;
    let revision = 0;
    for (const cameraId of ['camera_close', 'camera_wide', 'camera_close']) {
        for (const outputId of ['output_main', 'preview_main']) {
            const reply = s.selectCamera({ outputId, cameraId, expectedRevision: revision });
            expect(reply.ok).toBe(true);
            if (reply.ok) revision = reply.data.revision;
        }
        const tick = frame.tick;
        frame = s.advance(frame.elapsedMs + 1000 / 60);
        expect(frame.tick).toBeGreaterThan(tick);
        expect(cameraOf('output_main')).toBe(cameraId);
        expect(cameraOf('preview_main')).toBe(cameraId);
    }
    expect(s.applyPatch(patch(revision, [{ kind: 'removeEntity', entityId: 'camera_close' }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('moves each Orbit Character camera with its target and keeps its own transform when the patch sets one (R6a)', () => {
    const s = createSession(makeSmokeScene(), 'nav-test');
    expect(s.applyPatch(patch(0, [
        { kind: 'setCameraNavigation', entityId: 'camera_wide', navigation: orbit },
        { kind: 'setCameraNavigation', entityId: 'camera_close', navigation: { mode: 'freeLook', sensitivity: 1 } },
    ])).ok).toBe(true);
    const before = s.inspect();
    const at = (id: string) => before.entities.find(e => e.id === id)!.transform;
    const performer = at('performer');
    const moved = { ...performer, position: [performer.position[0] + 1, performer.position[1], performer.position[2] - 2] };
    expect(s.applyPatch(patch(1, [{ kind: 'setTransform', entityId: 'performer', transform: moved }]))).toEqual({ ok: true, data: { revision: 2 } });
    const wide = at('camera_wide');
    expect(camera(s, 'camera_wide').transform).toEqual({ ...wide, position: [wide.position[0] + 1, wide.position[1], wide.position[2] - 2] });
    expect(camera(s, 'camera_close').transform).toEqual(at('camera_close'));
    const own = { position: [4, 1, 4], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
    expect(s.applyPatch(patch(2, [{ kind: 'setTransform', entityId: 'camera_wide', transform: own }, { kind: 'setTransform', entityId: 'performer', transform: performer }])).ok).toBe(true);
    expect(camera(s, 'camera_wide').transform).toEqual(own);
});
