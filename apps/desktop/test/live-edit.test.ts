import {afterEach,expect,it,vi} from 'vitest';
import {makeSmokeScene,type AppApi,type LightSettings,type Reply} from '@opensekai/contracts';
import {createSession} from '@opensekai/session';
import {createEditorModel} from '../src/editor/model';
import {createLiveEdit} from '../src/editor/live-edit';
import {makeAuthoringEntity} from '../src/editor/authoring';

async function fixture(){
 vi.useFakeTimers();const session=createSession(makeSmokeScene(),'live-edit-test');
 const unsupported=async():Promise<Reply<never>>=>({ok:false,error:{code:'UNSUPPORTED',message:'Unsupported',ids:[]}});
 const api:AppApi={appStatus:unsupported,sceneInspect:async()=>({ok:true,data:session.inspect()}),scenePatch:vi.fn(async p=>session.applyPatch(p)),sceneReplace:vi.fn(async p=>session.replaceScene(p.scene,p.expectedRevision)),cameraSelect:unsupported,blueprintRun:unsupported,captureFrame:unsupported,benchmarkStart:unsupported,benchmarkStatus:unsupported,benchmarkCancel:unsupported,evidenceRead:unsupported} as AppApi;
 const entity=makeAuthoringEntity('pointLight','lamp',session.inspect().entities);
 session.applyPatch({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'createEntity',entity}]});
 vi.mocked(api.scenePatch).mockClear();
 const model=createEditorModel(api);await model.load();model.select('lamp');const error=vi.fn(),pending=vi.fn();const live=createLiveEdit(model,error,pending);
 const light=():LightSettings=>{const e=session.inspect().entities.find(e=>e.id==='lamp');if(e?.kind!=='light')throw new Error('no light');return e.light;};
 const intensity=(value:number)=>({entityId:'lamp',send:(revision:number)=>model.setLight('lamp',{...light(),intensity:value},revision,true)});
 return{api,model,session,live,error,pending,light,intensity};
}
afterEach(()=>vi.useRealTimers());
it('sends only the latest value, one at a time, and follows its own revisions',async()=>{
 const {api,model,session,live,light,intensity}=await fixture();let finish!:()=>void;
 vi.mocked(api.scenePatch).mockImplementationOnce(p=>new Promise(resolve=>{finish=()=>resolve(session.applyPatch(p));}));
 live.offer(intensity(1));live.offer(intensity(2));
 await vi.advanceTimersByTimeAsync(16);expect(api.scenePatch).toHaveBeenCalledTimes(1);expect(model.read()).toMatchObject({pending:true,livePending:true});
 live.offer(intensity(3));live.offer(intensity(4));await vi.advanceTimersByTimeAsync(16);expect(api.scenePatch).toHaveBeenCalledTimes(1);
 finish();await vi.advanceTimersByTimeAsync(16);
 expect(api.scenePatch).toHaveBeenCalledTimes(2);expect(vi.mocked(api.scenePatch).mock.calls[1]![0].expectedRevision).toBe(2);
 expect(light().intensity).toBe(4);expect(model.read().livePending).toBe(false);live.close();
});
it('cancels unsent values when the selection changes',async()=>{
 const {api,model,live,intensity}=await fixture();live.offer(intensity(5));model.select('marker');await vi.advanceTimersByTimeAsync(20);
 expect(api.scenePatch).not.toHaveBeenCalled();live.close();
});
it('reports CONFLICT for a foreign revision and does not send',async()=>{
 const {api,model,session,live,error,intensity}=await fixture();live.offer(intensity(5));
 session.applyPatch({sceneId:'scene_smoke',expectedRevision:1,operations:[{kind:'setVisibility',entityId:'marker',visible:false}]});await model.load();
 await vi.advanceTimersByTimeAsync(20);expect(api.scenePatch).not.toHaveBeenCalled();expect(error).toHaveBeenCalledWith('CONFLICT');live.close();
});
it('stops after a failed send and reports its code',async()=>{
 const {api,live,error,intensity}=await fixture();
 live.offer({entityId:'lamp',send:async()=>({ok:false,error:{code:'INVALID_INPUT',message:'Invalid',ids:[]}})});await vi.advanceTimersByTimeAsync(16);
 live.offer(intensity(6));await vi.advanceTimersByTimeAsync(16);
 expect(error).toHaveBeenCalledWith('INVALID_INPUT');expect(api.scenePatch).toHaveBeenCalledTimes(1);live.close();
});
it('rejects an offer while an unrelated edit is pending',async()=>{
 const {api,model,live,intensity}=await fixture();let finish!:(reply:Reply<{revision:number}>)=>void;
 vi.mocked(api.scenePatch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const other=model.setVisibility('lamp',false);
 expect(live.offer(intensity(2))).toBe(false);finish({ok:false,error:{code:'UNAVAILABLE',message:'Unavailable',ids:[]}});await other;live.close();
});
