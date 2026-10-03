import {expect,it} from 'vitest';
import {SceneViewSchema,SceneEntitySchema} from '@opensekai/contracts';
import {makeEmptyScene,makeAuthoringEntity,makeImportedAvatar,importFailure} from '../src/editor/authoring';
it('starts with a useful camera and creates all source kinds stopped without fixture assets',()=>{
 const scene=makeEmptyScene();expect(SceneViewSchema.safeParse(scene).success).toBe(true);expect(scene.entities.map(e=>e.kind)).toEqual(['camera']);expect(scene.outputs.map(o=>o.cameraId)).toEqual(['camera_main','camera_main']);
 for(const kind of ['camera','vmc','ifacialmocap','mediapipe'] as const){const entity=makeAuthoringEntity(kind,'new',scene.entities);expect(SceneEntitySchema.safeParse(entity).success).toBe(true);if(entity.kind==='tracking')expect(entity.config.enabled).toBe(false);}
 expect(makeAuthoringEntity('camera','new',scene.entities).name).toBe('Camera 2');
});

it('shows structured native import errors and uses a safe fallback for arbitrary failures',()=>{
 expect(importFailure({code:'INVALID_INPUT',message:'Missing VRM humanoid',ids:[]})).toBe('Missing VRM humanoid');
 expect(importFailure(new Error('private internal details'))).toBe('Could not import avatar');
 expect(importFailure('private internal details')).toBe('Could not import avatar');
});

it('enables the built-in idle for each imported avatar without shared mutable config',()=>{
 const a=makeImportedAvatar('a','asset','Avatar'),b=makeImportedAvatar('b','asset','Other');
 expect(SceneEntitySchema.safeParse(a).success).toBe(true);expect(a).toMatchObject({idleAnimation:{kind:'builtin',enabled:true},tracking:{bodySourceId:null,faceSourceId:null}});
 a.idleAnimation!.enabled=false;a.transform.position[0]=5;expect(b.idleAnimation?.enabled).toBe(true);expect(b.transform.position[0]).toBe(0);
});
