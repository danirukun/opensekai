import {expect,it,vi} from 'vitest';
import {DEFAULT_SNOW,makeSmokeScene,SnowSettingsSchema,type AppApi,type SceneEntity,type SnowSettings} from '@opensekai/contracts';
import {createSession} from '@opensekai/session';
import {createEditorModel} from '../src/editor/model';
import {changedFields,defaultsFor,resetFieldIds,valuesFor} from '../src/editor/property-defaults';
import {sectionsFor} from '../src/editor/inspector-sections';
import {SNOW_FIELDS,snowLimitReached} from '../src/editor/snow-fields';

const snow=(settings:Partial<SnowSettings>={}):Extract<SceneEntity,{kind:'snow'}>=>({id:'snow',name:'Snow',visible:true,transform:{position:[0,2,0],rotation:[0,0,0,1],scale:[6,4,6]},kind:'snow',snow:{...DEFAULT_SNOW,...settings}});

it('gives a snow entity the Transform and Physics sections (R1)',()=>{
 expect(sectionsFor(snow(),{expressions:false}).map(section=>section.label)).toEqual(['Transform','Physics']);
});
it('has one slider for each number setting, with the contract limits (R2)',()=>{
 const numbers=Object.keys(DEFAULT_SNOW).filter(key=>typeof DEFAULT_SNOW[key as keyof SnowSettings]==='number');
 expect(SNOW_FIELDS.map(([key])=>key)).toEqual(numbers);
 for(const [key,,range] of SNOW_FIELDS){
  const accepts=(value:number)=>SnowSettingsSchema.safeParse({...DEFAULT_SNOW,[key]:value}).success;
  expect([key,accepts(range.min),accepts(range.max)]).toEqual([key,true,true]);
  expect([key,accepts(range.min-range.step),accepts(range.max+range.step)]).toEqual([key,false,false]);
 }
});
it('marks a changed snow field for reset to the DEFAULT_SNOW value (R6)',()=>{
 expect(resetFieldIds(snow())).toEqual(['visible','position','rotation','scale',...SNOW_FIELDS.map(([key])=>key),'settleOnCharacters']);
 expect([...changedFields(snow())]).toEqual(['position','scale']);
 const changed=snow({rate:1,thickness:0.03,settleOnCharacters:false,settleOnProps:false});
 expect([...changedFields(changed)]).toEqual(['position','scale','rate','thickness','settleOnCharacters']);
 expect(valuesFor(changed)).toMatchObject({rate:1,thickness:0.03,settleOnCharacters:false});
 expect(defaultsFor(changed)).toMatchObject({rate:DEFAULT_SNOW.rate,thickness:DEFAULT_SNOW.thickness,settleOnCharacters:true});
});
it('sends setSnow only for a snow entity with valid settings (R7)',async()=>{
 const session=createSession(makeSmokeScene(),'snow-editor');
 session.applyPatch({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'createEntity',entity:snow()}]});
 const unsupported=vi.fn(async()=>({ok:false as const,error:{code:'UNSUPPORTED' as const,message:'',ids:[]}}));
 const api={appStatus:unsupported,sceneInspect:vi.fn(async()=>({ok:true as const,data:session.inspect()})),scenePatch:vi.fn(async params=>session.applyPatch(params))} as unknown as AppApi;
 const model=createEditorModel(api);await model.load();
 expect((await model.setSnow('snow',{...DEFAULT_SNOW,rate:1,windSpeed:2})).ok).toBe(true);
 expect(session.inspect().entities.find(entity=>entity.id==='snow')).toMatchObject({snow:{...DEFAULT_SNOW,rate:1,windSpeed:2}});
 expect((await model.setSnow('camera_main',{...DEFAULT_SNOW})).ok).toBe(false);
 expect((await model.setSnow('snow',{...DEFAULT_SNOW,rate:2})).ok).toBe(false);
 expect(api.scenePatch).toHaveBeenCalledTimes(1);
});
it('reaches the snow limit with one snow entity, so Duplicate is off',()=>{
 expect(snowLimitReached(makeSmokeScene().entities)).toBe(false);
 expect(snowLimitReached([...makeSmokeScene().entities,snow()])).toBe(true);
});

