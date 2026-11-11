import { expect, it } from 'vitest';
import { makeSmokeScene, orbitFromUser, transformFromOrbit, type SceneView, type Transform, type Vec3 } from '@opensekai/contracts';
import { createViewportNavigation } from '../src/viewport-navigation';

// An Orbit Character gesture that starts while a Blueprint orbit holds the camera away from its saved transform
// starts where the camera shows (B32 local QA finding 2c): a 10 px drag must not jump the camera back.
const orbit = { mode: 'orbitCharacter' as const, sensitivity: 1, targetId: 'performer', pivotOffset: [0, 1.3, 0] as Vec3 };
const withCamera = (scene: SceneView, camera: Transform, performer: Vec3): SceneView => ({
 ...scene,
 entities: scene.entities.map(entity => entity.id === 'camera_wide' && entity.kind === 'camera' ? { ...entity, transform: camera, navigation: orbit }
  : entity.id === 'performer' ? { ...entity, transform: { ...entity.transform, position: performer } } : entity),
});

it('starts an orbit gesture from the shown camera, not from the saved camera', () => {
 const base = makeSmokeScene();
 const saved = withCamera(base, { position: [0, 1.2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, [0, 0, 0]);
 // A Blueprint holds the performer 0.5 m to the side and the camera at Yaw 90 around it (the follow offset is on top).
 const offset: Vec3 = [0.5, 0, 0];
 const orbitPose = transformFromOrbit(orbitFromUser({ yawDegrees: 90, pitchDegrees: 10, distance: 2.5 }, [0, 1.3, 0]), [1, 1, 1]);
 const shown = withCamera(base, { ...orbitPose, position: orbitPose.position.map((value, i) => value + offset[i]!) as Vec3 }, offset);
 const canvas = Object.assign(new EventTarget(), { ownerDocument: { defaultView: null }, focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ height: 540 }) }) as unknown as HTMLCanvasElement;
 const navigation = createViewportNavigation({ canvas, allowed: () => true, gizmoHit: () => false, persistent: () => saved, inspect: async () => ({ ok: true, data: saved }), onNavigate: async () => ({ ok: true, data: { revision: 1 } }), onEnd() {}, onChange() {} });
 navigation.frame(shown);
 // A wheel step this small keeps the distance, so the drawn transform is the gesture start.
 canvas.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 1e-9, deltaMode: 0 }));
 const drawn = navigation.transform('camera_wide')!;
 const expected = shown.entities.find(entity => entity.id === 'camera_wide')!.transform.position;
 drawn.position.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6));
 navigation.dispose();
});
