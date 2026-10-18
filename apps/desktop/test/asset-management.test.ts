import {expect,it} from 'vitest';
import {defaultTrackingConfig,makeSmokeScene,type SceneEntity} from '@opensekai/contracts';
import {makeEntityCopy} from '../src/editor/asset-management';
it('copies independent settings, unique names and stable supplied IDs',()=>{
 const original=makeSmokeScene().entities.find(e=>e.id==='camera_wide')!;
 const copies=[original,{...original,id:'a',name:original.name+' Copy'},{...original,id:'b',name:original.name+' Copy 2'}];
 const copy=makeEntityCopy(original,'new',copies);expect(copy).toMatchObject({id:'new',name:original.name+' Copy 3'});
 copy.transform.position[0]=42;expect(original.transform.position[0]).not.toBe(42);
 if(copy.kind==='camera')copy.lens.fovDegrees=99;if(original.kind==='camera')expect(original.lens.fovDegrees).not.toBe(99);
});
it('stops copied trackers and clears copied performer assignments without changing originals',()=>{
 const config=defaultTrackingConfig('vmc');config.enabled=true;
 const source={id:'source',name:'Source',visible:true,kind:'tracking',config,generation:25,transform:makeSmokeScene().entities[0].transform,smoothing:{enabled:false,minCutoff:12,beta:1,derivativeCutoff:2}} as SceneEntity;
 expect(makeEntityCopy(source,'copy',[source])).toMatchObject({config:{enabled:false},generation:0,smoothing:{minCutoff:12}});
 expect(source).toMatchObject({config:{enabled:true},generation:25});
 const avatar=makeSmokeScene().entities.find(e=>e.kind==='avatar')!;if(avatar.kind==='avatar')avatar.tracking={bodySourceId:'source',faceSourceId:'source'};
 expect(makeEntityCopy(avatar,'copy',[avatar])).toMatchObject({tracking:{bodySourceId:null,faceSourceId:null}});
 expect(avatar).toMatchObject({tracking:{bodySourceId:'source',faceSourceId:'source'}});
});

it('bounds long copy names without splitting Unicode pairs',()=>{
 const original=makeSmokeScene().entities.find(e=>e.id==='camera_wide')!;original.name='X'+'😀'.repeat(64);
 const copy=makeEntityCopy(original,'new',[original]);
 expect(copy.name.length).toBeLessThanOrEqual(128);
 expect(new TextDecoder().decode(new TextEncoder().encode(copy.name))).toBe(copy.name);
});

it('places a copied character by the next avatar rule and does not move a following camera',()=>{
 const scene=makeSmokeScene(),avatar=scene.entities.find(e=>e.kind==='avatar')!;
 avatar.transform={position:[.5,0,1],rotation:[0,.6,0,.8],scale:[1.1,1.1,1.1]};
 const camera=scene.entities.find(e=>e.id==='camera_wide')!;if(camera.kind==='camera')camera.navigation={mode:'orbitCharacter',targetId:avatar.id,sensitivity:1} as typeof camera.navigation;
 const before=structuredClone(camera.transform);
 const copy=makeEntityCopy(avatar,'copy',scene.entities);
 expect(copy.transform).toEqual({position:[1.5,0,1],rotation:[0,.6,0,.8],scale:[1.1,1.1,1.1]});
 expect(avatar.transform.position).toEqual([.5,0,1]);
 expect(camera.transform).toEqual(before);
});
