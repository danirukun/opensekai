import {expect,it,vi} from 'vitest';
import {makeSmokeScene,SceneEntitySchema,SceneViewSchema,type AppApi,type Reply,type SceneEntity} from '@opensekai/contracts';
import {createSession} from '@opensekai/session';
import {makeAuthoringEntity,makeEmptyScene} from '../src/editor/authoring';
import {groupEntities} from '../src/editor/asset-groups';
import {createEditorModel} from '../src/editor/model';
import {directionFromMainCamera,lightForType,lightLimitReached,parseLightColor,POINT_LIGHT} from '../src/editor/lights';

const close=(a:readonly number[],b:readonly number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i]!,4));
it('makes a directional light with the built-in light values (R10)',()=>{
 const light=makeAuthoringEntity('directionalLight','l',[]);
 expect(SceneEntitySchema.safeParse(light).success).toBe(true);
 expect(light).toMatchObject({kind:'light',name:'Directional Light',transform:{position:[2,4,3],scale:[1,1,1]},light:{type:'directional',color:'#ffffff',intensity:3,range:0,affectCharacters:true,affectProps:true,affectEnvironment:true,shadow:{enabled:false,intensity:1,soft:true,bias:-0.0005,normalBias:0.02}}});
 close(light.transform.rotation,[-0.3890,0.2648,0.1178,0.8745]);
});
it('makes a point light with intensity 20 and range 10 (R10)',()=>{
 const light=makeAuthoringEntity('pointLight','p',[]);
 expect(SceneEntitySchema.safeParse(light).success).toBe(true);
 expect(light).toMatchObject({kind:'light',name:'Point Light',transform:{position:[0,2,1],rotation:[0,0,0,1]},light:{type:'point',intensity:20,range:10}});
 const second=makeAuthoringEntity('pointLight','q',[light]);
 if(light.kind==='light'&&second.kind==='light'){light.light.shadow.enabled=true;expect(second.light.shadow.enabled).toBe(false);}
 expect(second.name).toBe('Point Light 2');
});
it('starts a new scene with one Directional Light (R11)',()=>{
 const scene=makeEmptyScene();
 expect(SceneViewSchema.safeParse(scene).success).toBe(true);
 expect(scene.entities.filter(e=>e.kind==='light').map(e=>e.name)).toEqual(['Directional Light']);
});
it('groups lights after the environment and before cameras (R12)',()=>{
 const entities=[...makeEmptyScene().entities,makeAuthoringEntity('environment','stage',[])];
 expect(groupEntities(entities).map(g=>g.label)).toEqual(['Environment','Lights','Cameras']);
});
it('reaches the light limit at 8 lights',()=>{
 const lights=Array.from({length:8},(_,i)=>makeAuthoringEntity('pointLight',`p${i}`,[]));
 expect(lightLimitReached(lights.slice(0,7))).toBe(false);
 expect(lightLimitReached(lights)).toBe(true);
});
it('parses a color for the Inspector (R13)',()=>{
 expect(parseLightColor(' #FFAA00 ')).toBe('#ffaa00');
 for(const bad of ['#fff','red','#gggggg',''])expect(parseLightColor(bad)).toBeNull();
});
it('keeps color, flags, and shadow on a type change and takes the type default intensity and range',()=>{
 const directional=makeAuthoringEntity('directionalLight','l',[]);
 if(directional.kind!=='light')throw new Error('light expected');
 const changed=lightForType('point',{...directional.light,color:'#00ff00',affectProps:false});
 expect(changed).toMatchObject({type:'point',color:'#00ff00',affectProps:false,intensity:POINT_LIGHT.intensity,range:POINT_LIGHT.range});
});
it('copies the output camera rotation and keeps the light position (R13)',()=>{
 const scene=makeSmokeScene();
 const light=makeAuthoringEntity('directionalLight','l',scene.entities);
 scene.entities.push(light);
 const camera=scene.entities.find(e=>e.id===scene.outputs.find(o=>o.id==='output_main')!.cameraId)!;
 camera.transform.rotation=[0,0.7071068,0,0.7071068];
 expect(directionFromMainCamera(scene,'l')).toEqual({...light.transform,rotation:[0,0.7071068,0,0.7071068]});
 expect(directionFromMainCamera(scene,'performer')).toBeNull();
});
function fixture(){
 const session=createSession(makeSmokeScene(),'light_session');
 const unsupported=async():Promise<Reply<never>>=>({ok:false,error:{code:'UNSUPPORTED',message:'Unsupported',ids:[]}});
 const api:AppApi={appStatus:unsupported,sceneInspect:vi.fn(async()=>({ok:true as const,data:session.inspect()})),scenePatch:vi.fn(async params=>session.applyPatch(params)),cameraSelect:vi.fn(async params=>session.selectCamera(params)),sceneReplace:vi.fn(async params=>session.replaceScene(params.scene,params.expectedRevision)),blueprintRun:unsupported,captureFrame:unsupported,benchmarkStart:unsupported,benchmarkStatus:unsupported,benchmarkCancel:unsupported,evidenceRead:unsupported};
 return {session,api,model:createEditorModel(api)};
}
it('sends setLight and setEnvironmentReflections through patches and rejects other kinds',async()=>{
 const {model,session,api}=fixture();
 await model.load();
 const light=makeAuthoringEntity('pointLight','lamp',session.inspect().entities);
 expect((await model.createEntity(light,model.read().scene!.revision)).ok).toBe(true);
 if(light.kind!=='light')throw new Error('light expected');
 expect((await model.setLight('lamp',{...light.light,color:'#ff0000'},model.read().scene!.revision)).ok).toBe(true);
 expect(session.inspect().entities.find(e=>e.id==='lamp')).toMatchObject({light:{color:'#ff0000'}});
 const calls=vi.mocked(api.scenePatch).mock.calls.length;
 expect((await model.setLight('performer',light.light)).ok).toBe(false);
 expect((await model.setLight('lamp',{...light.light,color:'red'})).ok).toBe(false);
 expect(vi.mocked(api.scenePatch).mock.calls.length).toBe(calls);
 const stage={id:'stage',name:'Environment',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'environment',assetId:null} as SceneEntity;
 expect((await model.createEntity(stage,model.read().scene!.revision)).ok).toBe(true);
 expect((await model.setEnvironmentReflections('stage',0.5,model.read().scene!.revision)).ok).toBe(true);
 expect(session.inspect().entities.find(e=>e.id==='stage')).toMatchObject({reflectionsIntensity:0.5});
 expect((await model.setEnvironmentReflections('stage',3)).ok).toBe(false);
 expect((await model.setEnvironmentReflections('lamp',1)).ok).toBe(false);
});
