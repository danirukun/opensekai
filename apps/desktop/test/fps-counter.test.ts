import {expect,it,vi} from 'vitest';
import {makeSmokeScene,SceneEntitySchema,type AppApi} from '@opensekai/contracts';
import {createSession} from '@opensekai/session';
import {makeAuthoringEntity} from '../src/editor/authoring';
import {createEditorModel} from '../src/editor/model';
import {fpsCounterLimitReached} from '../src/editor/lights';
import {changedFields,defaultsFor,resetFieldIds} from '../src/editor/property-defaults';
import {sectionsFor} from '../src/editor/inspector-sections';

it('adds an FPS counter with the add defaults and no Transform section (B19 R4, R5)',()=>{
 const counter=makeAuthoringEntity('fpsCounter','fps',[]);
 expect(SceneEntitySchema.safeParse(counter).success).toBe(true);
 expect(counter).toEqual({id:'fps',name:'FPS Counter',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'fpsCounter',fpsCounter:{corner:'topRight',size:32,color:'#ffffff'}});
 expect(sectionsFor(counter,{expressions:false})).toEqual([{id:'fpsCounter',label:'FPS Counter'}]);
 expect(resetFieldIds(counter)).toEqual(['visible','corner','size','color']);
 expect(defaultsFor(counter)).toMatchObject({visible:true,corner:'topRight',size:32,color:'#ffffff'});
 expect(changedFields(counter).size).toBe(0);
 if(counter.kind!=='fpsCounter')return;
 expect([...changedFields({...counter,visible:false,fpsCounter:{corner:'bottomLeft',size:48,color:'#FFFFFF'}})]).toEqual(['visible','corner','size']);
});
it('reaches the limit at one FPS counter (B19 R4)',()=>{
 const scene=makeSmokeScene();
 expect(fpsCounterLimitReached(scene.entities)).toBe(false);
 expect(fpsCounterLimitReached([...scene.entities,makeAuthoringEntity('fpsCounter','fps',[])])).toBe(true);
});
it('sends setFpsCounter only for an FPS counter with valid settings (B19 R2, R5)',async()=>{
 const session=createSession(makeSmokeScene(),'fps-editor');
 session.applyPatch({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'createEntity',entity:makeAuthoringEntity('fpsCounter','fps',[])}]});
 const unsupported=vi.fn(async()=>({ok:false as const,error:{code:'UNSUPPORTED' as const,message:'',ids:[]}}));
 const api={appStatus:unsupported,sceneInspect:vi.fn(async()=>({ok:true as const,data:session.inspect()})),scenePatch:vi.fn(async params=>session.applyPatch(params))} as unknown as AppApi;
 const model=createEditorModel(api);await model.load();
 expect((await model.setFpsCounter('fps',{corner:'bottomRight',size:64,color:'#ff0000'})).ok).toBe(true);
 expect(session.inspect().entities.find(entity=>entity.id==='fps')).toMatchObject({fpsCounter:{corner:'bottomRight',size:64,color:'#ff0000'}});
 expect((await model.setFpsCounter('performer',{corner:'bottomRight',size:64,color:'#ff0000'})).ok).toBe(false);
 expect((await model.setFpsCounter('fps',{corner:'bottomRight',size:200,color:'#ff0000'})).ok).toBe(false);
 expect(api.scenePatch).toHaveBeenCalledTimes(1);
});
