import { expect, it } from 'vitest';
import { cameraSwayTemplate, importBlueprint, makeSmokeScene, type RuntimeFrame, type Vec3 } from '@opensekai/contracts';
import { createSession } from '../src/session';

// The Camera Sway template through the session: the evaluated frames move the camera to the offset and back in a loop.
const camera = (frame: RuntimeFrame) => { const entity = frame.scene.entities.find(item => item.id === 'camera_wide')!; if (entity.kind !== 'camera') throw new Error('camera'); return entity; };
const near = (a: readonly number[], b: readonly number[]) => a.every((value, i) => Math.abs(value - b[i]!) < 1e-6);

it('loops the camera between its pose and the sway pose on the session clock, with no commit, until a patch stops it', () => {
 const scene = makeSmokeScene();
 const start = scene.entities.find(entity => entity.id === 'camera_wide')!;
 if (start.kind !== 'camera') throw new Error('camera');
 const file = cameraSwayTemplate({ id: start.id, name: start.name, position: start.transform.position, rotation: start.transform.rotation, fovDegrees: start.lens.fovDegrees });
 const imported = importBlueprint(file, scene, () => 'sway');
 if (!imported.ok) throw new Error(imported.error.message);
 const session = createSession(scene, 's');
 expect(session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'createGraph', graph: imported.data.graph }] }).ok).toBe(true);
 const sway = imported.data.graph.nodes.find(node => node.id === 'slide')!.inputs!.value as Vec3;
 const frames = new Map<number, RuntimeFrame>();
 for (let ms = 0; ms <= 13000; ms += 20) frames.set(ms, session.advance(ms));
 // On Enable runs on the first step; each move takes 3 s, and the next starts on the step after the end, from the time of the previous step.
 expect(near(camera(frames.get(3000)!).transform.position, sway)).toBe(true);
 expect(camera(frames.get(3000)!).lens.fovDegrees).toBe(start.lens.fovDegrees - 5);
 expect(near(camera(frames.get(6000)!).transform.position, start.transform.position)).toBe(true);
 expect(camera(frames.get(6000)!).lens.fovDegrees).toBe(start.lens.fovDegrees);
 expect(near(camera(frames.get(9000)!).transform.position, sway)).toBe(true);
 const middle = camera(frames.get(1500)!).transform.position;
 expect(near(middle, start.transform.position) || near(middle, sway)).toBe(false);
 expect(session.inspect().revision).toBe(0);

 // A patch on the camera transform stops the loop: no end runs after it, and the patch value stays.
 const placed: Vec3 = [0, 2, 5];
 expect(session.applyPatch({ sceneId: scene.sceneId, expectedRevision: 0, operations: [{ kind: 'setTransform', entityId: 'camera_wide', transform: { ...start.transform, position: placed } }] }).ok).toBe(true);
 let last = frames.get(13000)!;
 for (let ms = 13020; ms <= 20000; ms += 20) last = session.advance(ms);
 // The ends are on the Position nodes, so the Field of View tween of that move ends with no next move.
 expect(camera(last).transform.position).toEqual(placed);
});
