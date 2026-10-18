import {expect,it} from 'vitest';
import {makeSmokeScene,SceneEntitySchema} from '@opensekai/contracts';
import {cameraLimitReached,cycleCamera,focusOptions,navigationForMode} from '../src/editor/cameras';
import {makeAuthoringEntity} from '../src/editor/authoring';

it('gives an added camera Free Look, the Warudo default (R11)',()=>{
 const camera=makeAuthoringEntity('camera','c',[]);
 expect(camera).toMatchObject({kind:'camera',navigation:{mode:'freeLook',sensitivity:1}});
 expect(SceneEntitySchema.safeParse(camera).success).toBe(true);
});
it('starts Orbit Character on the first character at chest height and keeps the sensitivity (R11)',()=>{
 const entities=makeSmokeScene().entities;
 expect(navigationForMode('orbitCharacter',{mode:'freeLook',sensitivity:2},entities)).toEqual({mode:'orbitCharacter',sensitivity:2,targetId:'performer',pivotOffset:[0,1.3,0]});
 expect(navigationForMode('orbitCharacter',undefined,entities.filter(e=>e.kind!=='avatar'))).toEqual({mode:'orbitCharacter',sensitivity:1,targetId:null,pivotOffset:[0,1.3,0]});
 const orbit={mode:'orbitCharacter',sensitivity:3,targetId:null,pivotOffset:[1,2,3]} as const;
 expect(navigationForMode('orbitCharacter',orbit,entities)).toBe(orbit);
 expect(navigationForMode('freeLook',orbit,entities)).toEqual({mode:'freeLook',sensitivity:3});
 expect(navigationForMode('none',orbit,entities)).toEqual({mode:'none'});
 expect(navigationForMode('freeLook',{mode:'none'},entities)).toEqual({mode:'freeLook',sensitivity:1});
});
it('lists the characters and None as Focus Character choices',()=>{
 expect(focusOptions(makeSmokeScene().entities)).toEqual([{value:'',label:'None'},{value:'performer',label:'performer'}]);
});
it('cycles the preview camera in scene order with wrap (R12)',()=>{
 const scene=makeSmokeScene();
 expect(scene.outputs.find(o=>o.id==='preview_main')?.cameraId).toBe('camera_wide');
 expect(cycleCamera(scene,1)).toBe('camera_close');
 expect(cycleCamera(scene,-1)).toBe('camera_close');
 scene.entities.push(makeAuthoringEntity('camera','camera_third',scene.entities));
 expect(cycleCamera(scene,1)).toBe('camera_close');
 expect(cycleCamera(scene,-1)).toBe('camera_third');
 scene.outputs.forEach(o=>{o.cameraId='camera_third';});
 expect(cycleCamera(scene,1)).toBe('camera_wide');
 expect(cycleCamera({...scene,entities:scene.entities.filter(e=>e.id!=='camera_close'&&e.id!=='camera_wide')},1)).toBeNull();
 expect(cycleCamera(null,1)).toBeNull();
});
it('reaches the camera limit at 8 (R12a)',()=>{
 const entities=[...Array(7)].map((_,i)=>makeAuthoringEntity('camera',`c${i}`,[]));
 expect(cameraLimitReached(entities)).toBe(false);
 expect(cameraLimitReached([...entities,makeAuthoringEntity('camera','c7',[])])).toBe(true);
});
