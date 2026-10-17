import {expect,it} from 'vitest';
import {SceneViewSchema,SceneEntitySchema} from '@opensekai/contracts';
import {makeEmptyScene,makeAuthoringEntity,modelLabel,importFailure} from '../src/editor/authoring';
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

it('creates a character without a model and with its own idle settings',()=>{
 const scene=makeEmptyScene();
 const a=makeAuthoringEntity('character','a',scene.entities),b=makeAuthoringEntity('character','b',[...scene.entities,a]);
 expect(SceneEntitySchema.safeParse(a).success).toBe(true);
 expect(a).toMatchObject({kind:'avatar',name:'Character',assetId:null,idleAnimation:{kind:'builtin',enabled:true},tracking:{bodySourceId:null,faceSourceId:null}});
 expect(b.name).toBe('Character 2');
 if(a.kind!=='avatar'||b.kind!=='avatar')throw new Error('avatar expected');
 a.idleAnimation!.enabled=false;a.transform.position[0]=5;expect(b.idleAnimation?.enabled).toBe(true);expect(b.transform.position[0]).toBe(0);
});
it('names a new entity with the label or the smallest free number',()=>{
 const scene=makeEmptyScene();
 const named=(...names:string[])=>[...scene.entities,...names.map((name,i)=>({...makeAuthoringEntity('character',`c${i}`,[]),name}))];
 expect(makeAuthoringEntity('character','new',named('Character 2')).name).toBe('Character');
 expect(makeAuthoringEntity('character','new',named('Character','Character 2')).name).toBe('Character 3');
 const remaining=named('Character','Character 2').filter(entity=>entity.name!=='Character');
 expect(makeAuthoringEntity('character','new',remaining).name).toBe('Character');
});
it('labels the model control from the asset list',()=>{
 const assets=[{id:'avatar_a',format:'vrm',sha256:'a'.repeat(64),bytes:1,sourceUrl:null,licenseLabel:'User supplied',importerVersion:1,name:'Rem',expressions:[]}] as const;
 expect(modelLabel(null,assets)).toBe('Choose VRM…');
 expect(modelLabel('avatar_a',assets)).toBe('Rem');
 expect(modelLabel('avatar_gone',assets)).toBe('Missing model');
});
