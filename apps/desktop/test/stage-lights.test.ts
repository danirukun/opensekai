import {expect,it,vi} from 'vitest';
import {makeSmokeScene,SceneEntitySchema,SceneViewSchema,rotateByQuaternion,type AppApi,type Reply} from '@opensekai/contracts';
import {createSession} from '@opensekai/session';
import {makeAuthoringEntity} from '../src/editor/authoring';
import {groupEntities} from '../src/editor/asset-groups';
import {createEditorModel} from '../src/editor/model';
import {AMBIENT_LIGHT,SPOT_LIGHT,hazeLimitReached,isLightType,lightForType} from '../src/editor/lights';

const close=(a:readonly number[],b:readonly number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i]!,4));
it('makes a spot light aimed from (0, 3, 2) at (0, 1, 0) with the stage defaults (B13 R11)',()=>{
 const spot=makeAuthoringEntity('spotLight','s',[]);
 expect(SceneEntitySchema.safeParse(spot).success).toBe(true);
 expect(spot).toMatchObject({kind:'light',name:'Spot Light',transform:{position:[0,3,2]},light:{type:'spot',intensity:60,range:15,cone:{angleDegrees:40,penumbra:0.3},volumetric:true,shadow:{enabled:false}}});
 close(rotateByQuaternion([0,0,-1],spot.transform.rotation),[0,-Math.SQRT1_2,-Math.SQRT1_2]);
});
it('makes an ambient light and a haze with the stage defaults (B13 R11)',()=>{
 const ambient=makeAuthoringEntity('ambientLight','a',[]),haze=makeAuthoringEntity('haze','h',[]);
 expect(SceneEntitySchema.safeParse(ambient).success).toBe(true);
 expect(ambient).toMatchObject({kind:'light',name:'Ambient Light',light:{type:'ambient',color:'#ffffff',intensity:0.3}});
 expect(SceneEntitySchema.safeParse(haze).success).toBe(true);
 expect(haze).toMatchObject({kind:'haze',name:'Haze',transform:{position:[0,4,0],scale:[20,8,20]},haze:{density:1,smoke:1,intensity:1,drift:0.2}});
});
it('limits a scene to one haze and shows it in the Lights group',()=>{
 const scene=makeSmokeScene();
 expect(hazeLimitReached(scene.entities)).toBe(false);
 scene.entities.push(makeAuthoringEntity('haze','h',scene.entities));
 expect(hazeLimitReached(scene.entities)).toBe(true);
 expect(SceneViewSchema.safeParse(scene).success).toBe(true);
 expect(groupEntities(scene.entities).find(group=>group.key==='light')?.entities.map(e=>e.id)).toEqual(['h']);
});
it('keeps color, flags, and shadow on a type change and takes the cone and defaults of the new type (B13 R12)',()=>{
 expect(isLightType('spot')).toBe(true);
 expect(isLightType('area')).toBe(false);
 const point=makeAuthoringEntity('pointLight','p',[]);
 if(point.kind!=='light')throw new Error('light expected');
 const lit={...point.light,color:'#ff0000',shadow:{...point.light.shadow,enabled:true}};
 const spot=lightForType('spot',lit);
 expect(spot).toMatchObject({type:'spot',color:'#ff0000',intensity:SPOT_LIGHT.intensity,range:SPOT_LIGHT.range,cone:SPOT_LIGHT.cone,volumetric:true,shadow:{enabled:true}});
 const ambient=lightForType('ambient',spot);
 expect(ambient).toMatchObject({type:'ambient',color:'#ff0000',intensity:AMBIENT_LIGHT.intensity,shadow:{enabled:false}});
 expect('cone' in ambient||'volumetric' in ambient).toBe(false);
 const back=lightForType('point',{...spot,volumetric:false});
 expect(back.volumetric).toBe(false);
 expect('cone' in back).toBe(false);
 for(const light of [spot,ambient,back,lightForType('directional',spot)])expect(SceneEntitySchema.safeParse({...point,light}).success).toBe(true);
});
it('sends setHaze through the model and rejects it for a light',async()=>{
 const session=createSession(makeSmokeScene(),'haze_session');
 const unsupported=async():Promise<Reply<never>>=>({ok:false,error:{code:'UNSUPPORTED',message:'Unsupported',ids:[]}});
 const api={appStatus:unsupported,sceneInspect:vi.fn(async()=>({ok:true as const,data:session.inspect()})),scenePatch:vi.fn(async params=>session.applyPatch(params)),cameraSelect:unsupported,sceneReplace:unsupported,blueprintRun:unsupported,captureFrame:unsupported,benchmarkStart:unsupported,benchmarkStatus:unsupported,benchmarkCancel:unsupported,evidenceRead:unsupported} as unknown as AppApi;
 const model=createEditorModel(api);await model.load();
 expect((await model.createEntity(makeAuthoringEntity('haze','h',session.inspect().entities))).ok).toBe(true);
 expect((await model.createEntity(makeAuthoringEntity('spotLight','s',session.inspect().entities))).ok).toBe(true);
 expect((await model.setHaze('h',{density:2,smoke:0,intensity:4,drift:0})).ok).toBe(true);
 expect(session.inspect().entities.find(e=>e.id==='h')).toMatchObject({haze:{density:2,smoke:0,intensity:4,drift:0}});
 expect((await model.setHaze('s',{density:1,smoke:1,intensity:1,drift:0})).ok).toBe(false);
 expect((await model.setHaze('h',{density:3,smoke:1,intensity:1,drift:0})).ok).toBe(false);
});
