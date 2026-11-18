import {expect,it,vi} from 'vitest';
import {LIGHT_BUDGET_MESSAGES as M,makeSmokeScene,type AppApi,type LightSettings,type Reply,type SceneEntity} from '@opensekai/contracts';
import {addLimitReached,makeAuthoringEntity} from '../src/editor/authoring';
import {AMBIENT_LIGHT,DIRECTIONAL_LIGHT,POINT_LIGHT,SPOT_LIGHT,affectAlert,lightCopyLimitReached,lightLimitReached,litLightLimitReached} from '../src/editor/lights';
import {createEditorModel} from '../src/editor/model';

const off={affectCharacters:false,affectProps:false,affectEnvironment:false};
const KINDS=[['directionalLight',DIRECTIONAL_LIGHT],['pointLight',POINT_LIGHT],['spotLight',SPOT_LIGHT],['ambientLight',AMBIENT_LIGHT]] as const;
const point=(id:string,patch:Partial<LightSettings>={},visible=true):SceneEntity=>{const e=makeAuthoringEntity('pointLight',id,[]);return e.kind==='light'?{...e,visible,light:{...e.light,...patch}}:e;};
const lit=(count:number)=>Array.from({length:count},(_,i)=>point(`lit${i}`));
const unlit=(count:number)=>Array.from({length:count},(_,i)=>point(`unlit${i}`,off));

it('reaches the lit light limit at 8 lit lights and the light limit at 32 lights (R7, R8)',()=>{
 expect(litLightLimitReached([...lit(7),...unlit(20)])).toBe(false);
 expect(litLightLimitReached([...lit(7),point('hidden',{},false)])).toBe(true);
 expect(lightLimitReached([...lit(8),...unlit(23)])).toBe(false);
 expect(lightLimitReached([...lit(8),...unlit(24)])).toBe(true);
});
it('disables the Add light items only at 32 lights (R7)',()=>{
 for(const [kind] of KINDS){
  expect(addLimitReached(kind,[...lit(8),...unlit(23)])).toBe(false);
  expect(addLimitReached(kind,[...lit(8),...unlit(24)])).toBe(true);
  expect(addLimitReached(kind,lit(8))).toBe(false);
 }
});
it('adds each light kind unlit at 8 lit lights, with its other Add defaults (R8)',()=>{
 for(const [kind,defaults] of KINDS){
  const added=makeAuthoringEntity(kind,'new',lit(8));
  expect(added.kind==='light'&&added.light).toEqual({...defaults,...off});
  const below=makeAuthoringEntity(kind,'new',[...lit(7),...unlit(10)]);
  expect(below.kind==='light'&&below.light).toEqual(defaults);
 }
 const spot=makeAuthoringEntity('spotLight','new',lit(8));
 expect(spot.kind==='light'&&'beam' in spot.light).toBe(false);
 expect(spot.kind==='light'&&spot.light.volumetric).toBe(true);
});
it('disables Duplicate when the copy would break a light limit (R9)',()=>{
 const scene=[...lit(8),...unlit(3)];
 expect(lightCopyLimitReached(scene[0]!,scene)).toBe(true);
 expect(lightCopyLimitReached(scene[8]!,scene)).toBe(false);
 const full=[...lit(2),...unlit(30)];
 expect(lightCopyLimitReached(full[0]!,full)).toBe(true);
 expect(lightCopyLimitReached(full[5]!,full)).toBe(true);
 const shadow=(id:string)=>point(id,{...off,shadow:{...POINT_LIGHT.shadow,enabled:true}});
 const shadows=[shadow('s1'),shadow('s2'),...unlit(2)];
 expect(lightCopyLimitReached(shadows[0]!,shadows)).toBe(true);
 expect(lightCopyLimitReached(shadows[2]!,shadows)).toBe(false);
});
it('keeps the light budget message of a refused patch for the Inspector alert (R10)',async()=>{
 const scene=makeSmokeScene();scene.entities.push(point('beam_only',off));
 const unsupported=async():Promise<Reply<never>>=>({ok:false,error:{code:'UNSUPPORTED',message:'Unsupported',ids:[]}});
 const refuse=(message:string):Reply<{revision:number}>=>({ok:false,error:{code:'INVALID_INPUT',message,ids:[]}});
 const scenePatch=vi.fn<AppApi['scenePatch']>();
 const api={appStatus:unsupported,sceneInspect:vi.fn(async()=>({ok:true as const,data:structuredClone(scene)})),scenePatch,cameraSelect:unsupported,sceneReplace:unsupported,blueprintRun:unsupported,captureFrame:unsupported,benchmarkStart:unsupported,benchmarkStatus:unsupported,benchmarkCancel:unsupported,evidenceRead:unsupported} as unknown as AppApi;
 const model=createEditorModel(api);
 await model.load();
 const flagOn={...POINT_LIGHT,affectProps:true,affectCharacters:false,affectEnvironment:false};
 scenePatch.mockResolvedValueOnce(refuse(M.litLights));
 expect((await model.setLight('beam_only',flagOn,0)).ok).toBe(false);
 expect(model.read()).toMatchObject({error:'INVALID_INPUT',errorMessage:M.litLights});
 expect(model.read().scene!.entities.find(e=>e.id==='beam_only')).toMatchObject({light:off});
 scenePatch.mockResolvedValueOnce(refuse('Invalid scene references or budget'));
 await model.setLight('beam_only',flagOn,0);
 expect(model.read()).toMatchObject({error:'INVALID_INPUT',errorMessage:null});
 scenePatch.mockResolvedValueOnce(refuse(M.lights));
 await model.setLight('beam_only',flagOn,0);
 expect(model.read().errorMessage).toBe(M.lights);
 scenePatch.mockResolvedValueOnce({ok:true,data:{revision:0}});
 expect((await model.setLight('beam_only',{...POINT_LIGHT,...off,color:'#ff0000'},0)).ok).toBe(true);
 expect(model.read()).toMatchObject({error:null,errorMessage:null});
});
it('shows M1 below the Affect checkboxes of the selected light when that section is open (R10)',()=>{
 const light=point('l1'),camera=makeSmokeScene().entities.find(e=>e.kind!=='light');
 expect(affectAlert(light,M.litLights,true)).toBe(true);
 expect(affectAlert(light,M.litLights,false)).toBe(false);
 expect(affectAlert(light,M.lights,true)).toBe(false);
 expect(affectAlert(light,null,true)).toBe(false);
 expect(affectAlert(camera,M.litLights,true)).toBe(false);
 expect(affectAlert(undefined,M.litLights,true)).toBe(false);
});
