import {expect,it} from 'vitest';
import {SceneViewSchema,SceneEntitySchema} from '@opensekai/contracts';
import {makeEmptyScene,makeAuthoringEntity} from '../src/editor/authoring';
it('starts with a useful camera and creates all source kinds stopped without fixture assets',()=>{
 const scene=makeEmptyScene();expect(SceneViewSchema.safeParse(scene).success).toBe(true);expect(scene.entities.map(e=>e.kind)).toEqual(['camera']);expect(scene.outputs.map(o=>o.cameraId)).toEqual(['camera_main','camera_main']);
 for(const kind of ['camera','vmc','ifacialmocap','mediapipe'] as const){const entity=makeAuthoringEntity(kind,'new',scene.entities);expect(SceneEntitySchema.safeParse(entity).success).toBe(true);if(entity.kind==='tracking')expect(entity.config.enabled).toBe(false);}
 expect(makeAuthoringEntity('camera','new',scene.entities).name).toBe('Camera 2');
});
