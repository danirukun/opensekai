import {expect,it} from 'vitest';
import {SceneViewSchema,SceneEntitySchema,isLitLight} from '@opensekai/contracts';
import {addLimitReached,makeEmptyScene,makeAuthoringEntity,modelLabel,importFailure,nextAvatarPosition} from '../src/editor/authoring';
import {BACK_LIGHT_ROTATION} from '../src/editor/lights';
it('starts with a useful camera and creates all source kinds stopped without fixture assets',()=>{
 const scene=makeEmptyScene();expect(SceneViewSchema.safeParse(scene).success).toBe(true);expect(scene.entities.map(e=>e.kind)).toEqual(['camera','light','light','light']);expect(scene.outputs.map(o=>o.cameraId)).toEqual(['camera_main','camera_main']);
 for(const kind of ['camera','vmc','ifacialmocap','openseeface','mediapipe'] as const){const entity=makeAuthoringEntity(kind,'new',scene.entities);expect(SceneEntitySchema.safeParse(entity).success).toBe(true);if(entity.kind==='tracking')expect(entity.config.enabled).toBe(false);}
 expect(makeAuthoringEntity('camera','new',scene.entities).name).toBe('Camera 2');
 expect(makeAuthoringEntity('openseeface','new',scene.entities).name).toBe('OpenSeeFace Receiver');
});
it('starts a new scene with a key, back, and fill light',()=>{
 const scene=makeEmptyScene(),lights=scene.entities.flatMap(e=>e.kind==='light'?[e]:[]);
 expect(scene.entities.map(e=>e.id)).toEqual(['camera_main','light_key','light_back','light_fill']);
 expect(lights.filter(e=>isLitLight(e.light))).toHaveLength(3);
 expect(lights.filter(e=>e.light.shadow.enabled).map(e=>e.id)).toEqual(['light_key']);
 expect(lights.find(e=>e.id==='light_key')?.light).toMatchObject({type:'directional',color:'#fff1e0',intensity:3,shadow:{enabled:true,soft:true}});
 expect(lights.find(e=>e.id==='light_back')?.light).toMatchObject({type:'directional',color:'#cfe0ff',intensity:2,shadow:{enabled:false}});
 expect(lights.find(e=>e.id==='light_fill')?.light).toMatchObject({type:'ambient',color:'#ffffff',intensity:0.4});
 const [x,y,z,w]=BACK_LIGHT_ROTATION,forward=[-2*(x*z+w*y),-2*(y*z-w*x),-(1-2*(x*x+y*y))],length=Math.hypot(1.5,1.8,3);
 [1.5/length,-1.8/length,3/length].forEach((axis,i)=>expect(Math.abs(forward[i]-axis)).toBeLessThan(1e-5));
 expect(lights.find(e=>e.id==='light_back')?.transform).toMatchObject({position:[-1.5,3,-3],rotation:BACK_LIGHT_ROTATION});
 expect(SceneViewSchema.safeParse(scene).success).toBe(true);
});
it('adds a stopped FaceKit tracker within the limit of 4 tracking entities',()=>{
 const facekit=makeAuthoringEntity('facekit','id',[]);
 expect(facekit).toMatchObject({name:'FaceKit Tracker',kind:'tracking',config:{kind:'facekit',enabled:false,deviceId:''}});
 expect(SceneEntitySchema.safeParse(facekit).success).toBe(true);
 const sources=(['vmc','openseeface','mediapipe','facekit'] as const).map((kind,index)=>makeAuthoringEntity(kind,`source_${index}`,[]));
 expect(addLimitReached('facekit',sources)).toBe(true);
 expect(addLimitReached('facekit',sources.slice(0,3))).toBe(false);
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
 a.idleAnimation!.enabled=false;a.transform.position[0]=5;expect(b.idleAnimation?.enabled).toBe(true);expect(b.transform.position[0]).toBe(1);
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

it('places a new character 1 m along +X from the last avatar with its rotation, or at the origin',()=>{
 const scene=makeEmptyScene();
 expect(nextAvatarPosition(scene.entities)).toEqual([0,0,0]);
 const a=makeAuthoringEntity('character','a',scene.entities);expect(a.transform).toEqual({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
 a.transform={position:[2,.5,-3],rotation:[0,.6,0,.8],scale:[1.2,1.2,1.2]};
 const b=makeAuthoringEntity('character','b',[...scene.entities,a]);
 expect(b.transform).toEqual({position:[3,.5,-3],rotation:[0,.6,0,.8],scale:[1,1,1]});
 expect(nextAvatarPosition([...scene.entities,b,a])).toEqual([3,.5,-3]);
 b.transform.rotation[1]=0;expect(a.transform.rotation[1]).toBe(.6);
});
