import {expect,it,vi} from 'vitest';
import {makeSmokeScene,SceneEntitySchema,type AppApi} from '@opensekai/contracts';
import {createSession} from '@opensekai/session';
import {makeAuthoringEntity} from '../src/editor/authoring';
import {makeEntityCopy} from '../src/editor/asset-management';
import {createEditorModel} from '../src/editor/model';
import {parseVmcSender,vmcSenderLimitReached} from '../src/editor/vmc-sender';
import {changedFields,defaultsFor,resetFieldIds} from '../src/editor/property-defaults';
import {sectionsFor} from '../src/editor/inspector-sections';

it('adds a stopped sender for the first avatar with no Transform section (B21 R4, R5)',()=>{
 const scene=makeSmokeScene();
 const sender=makeAuthoringEntity('vmcSender','out',scene.entities);
 expect(SceneEntitySchema.safeParse(sender).success).toBe(true);
 expect(sender).toEqual({id:'out',name:'VMC Sender',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'vmcSender',vmcSender:{enabled:false,address:'127.0.0.1',port:39539,avatarId:'performer'}});
 expect(makeAuthoringEntity('vmcSender','out',[])).toMatchObject({vmcSender:{avatarId:null}});
 expect(sectionsFor(sender,{expressions:false})).toEqual([{id:'sender',label:'Sender'}]);
 expect(resetFieldIds(sender)).toEqual(['address','port']);
 expect(defaultsFor(sender)).toEqual({address:'127.0.0.1',port:39539});
 expect(changedFields(sender).size).toBe(0);
 if(sender.kind!=='vmcSender')return;
 expect([...changedFields({...sender,visible:false,vmcSender:{...sender.vmcSender,enabled:true,port:40000,avatarId:null}})]).toEqual(['port']);
});
it('reaches the limit at four senders and duplicates a sender stopped (B21 R2, R4)',()=>{
 const scene=makeSmokeScene();
 const senders=[1,2,3,4].map(i=>makeAuthoringEntity('vmcSender',`out_${i}`,scene.entities));
 expect(vmcSenderLimitReached([...scene.entities,...senders.slice(0,3)])).toBe(false);
 expect(vmcSenderLimitReached([...scene.entities,...senders])).toBe(true);
 const running=senders[0]!;if(running.kind!=='vmcSender')return;
 const copy=makeEntityCopy({...running,vmcSender:{...running.vmcSender,enabled:true}},'copy',scene.entities);
 expect(copy).toMatchObject({id:'copy',name:'VMC Sender Copy',vmcSender:{enabled:false,address:'127.0.0.1',port:39539,avatarId:'performer'}});
});
it('parses the typed address and port over the current settings',()=>{
 const current={enabled:true,address:'127.0.0.1',port:39539,avatarId:'performer'};
 expect(parseVmcSender(current,{address:' 192.168.1.40 ',port:'40000'})).toEqual({...current,address:'192.168.1.40',port:40000});
 for(const draft of [{address:'0.0.0.0',port:'1'},{address:'239.1.1.1',port:'1'},{address:'host',port:'1'},{address:'::1',port:''},{address:'::1',port:'70000'},{address:'::1',port:'1.5'}])expect(parseVmcSender(current,draft),JSON.stringify(draft)).toBeNull();
});
it('sends setVmcSender only for a sender with valid settings (B21 R2)',async()=>{
 const session=createSession(makeSmokeScene(),'vmc-editor');
 session.applyPatch({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'createEntity',entity:makeAuthoringEntity('vmcSender','out',session.inspect().entities)}]});
 const unsupported=vi.fn(async()=>({ok:false as const,error:{code:'UNSUPPORTED' as const,message:'',ids:[]}}));
 const api={appStatus:unsupported,sceneInspect:vi.fn(async()=>({ok:true as const,data:session.inspect()})),scenePatch:vi.fn(async params=>session.applyPatch(params))} as unknown as AppApi;
 const model=createEditorModel(api);await model.load();
 const started={enabled:true,address:'10.0.0.2',port:39540,avatarId:'performer'};
 expect((await model.setVmcSender('out',started)).ok).toBe(true);
 expect(session.inspect().entities.find(entity=>entity.id==='out')).toMatchObject({vmcSender:started});
 expect((await model.setVmcSender('performer',started)).ok).toBe(false);
 expect((await model.setVmcSender('out',{...started,address:'255.255.255.255'})).ok).toBe(false);
 expect(api.scenePatch).toHaveBeenCalledTimes(1);
});
