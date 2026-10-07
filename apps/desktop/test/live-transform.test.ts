import {afterEach,expect,it,vi} from 'vitest';
import {makeSmokeScene,type AppApi,type Reply,type Transform} from '@opensekai/contracts';
import {createSession} from '@opensekai/session';
import {createEditorModel} from '../src/editor/model';
import {createLiveTransform} from '../src/editor/live-transform';
const transform=(x:number):Transform=>({position:[x,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
async function fixture(){
 vi.useFakeTimers();const session=createSession(makeSmokeScene(),'live-test');
 const unsupported=async():Promise<Reply<never>>=>({ok:false,error:{code:'UNSUPPORTED',message:'Unsupported',ids:[]}});
 const api:AppApi={appStatus:unsupported,sceneInspect:async()=>({ok:true,data:session.inspect()}),scenePatch:vi.fn(async p=>session.applyPatch(p)),sceneReplace:vi.fn(async p=>session.replaceScene(p.scene,p.expectedRevision)),cameraSelect:unsupported,blueprintRun:unsupported,captureFrame:unsupported,benchmarkStart:unsupported,benchmarkStatus:unsupported,benchmarkCancel:unsupported,evidenceRead:unsupported};
 const model=createEditorModel(api);await model.load();model.select('marker');const error=vi.fn(),pending=vi.fn();const live=createLiveTransform(model,error,pending);return{api,model,session,live,error,pending};
}
afterEach(()=>vi.useRealTimers());
it('coalesces a burst and keeps the latest full transform while a commit is pending',async()=>{
 const {api,model,session,live}=await fixture();let finish!:()=>void;
 vi.mocked(api.scenePatch).mockImplementationOnce(p=>new Promise(resolve=>{finish=()=>resolve(session.applyPatch(p));}));
 live.offer('marker',transform(1));live.offer('marker',transform(2));live.offer('marker',transform(3));
 await vi.advanceTimersByTimeAsync(16);expect(api.scenePatch).toHaveBeenCalledTimes(1);expect(model.read()).toMatchObject({pending:true,transformPending:true});
 const last={...transform(5),position:[5,6,7] as [number,number,number],scale:[2,3,4] as [number,number,number]};
 live.offer('marker',transform(4));live.offer('marker',last);finish();await vi.advanceTimersByTimeAsync(16);
 expect(api.scenePatch).toHaveBeenCalledTimes(2);expect(api.scenePatch).toHaveBeenNthCalledWith(2,expect.objectContaining({expectedRevision:1,operations:[{kind:'setTransform',entityId:'marker',transform:last}]}));
 expect(model.read().scene?.entities.find(e=>e.id==='marker')?.transform).toEqual(last);expect(model.read().transformPending).toBe(false);live.close();
});
it('rejects invalid transforms before transport and cancels unsent edits when selection changes',async()=>{
 const {api,model,live}=await fixture();expect(live.offer('marker',{...transform(1),scale:[0,1,1]})).toBe(false);
 live.offer('marker',transform(2));model.select('performer');await vi.advanceTimersByTimeAsync(20);expect(api.scenePatch).not.toHaveBeenCalled();live.close();
});
it('never overwrites a newer external revision',async()=>{
 const {api,model,session,live,error}=await fixture();live.offer('marker',transform(2));
 session.applyPatch({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'setVisibility',entityId:'performer',visible:false}]});await model.load();await vi.advanceTimersByTimeAsync(20);
 expect(api.scenePatch).not.toHaveBeenCalled();expect(error).toHaveBeenCalledWith('CONFLICT');live.close();
});
it('discards queued values after a failed commit rather than retrying',async()=>{
 const {api,live,error}=await fixture();let finish!:(reply:Reply<{revision:number}>)=>void;
 vi.mocked(api.scenePatch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 live.offer('marker',transform(1));await vi.advanceTimersByTimeAsync(16);live.offer('marker',transform(2));
 finish({ok:false,error:{code:'CONFLICT',message:'Scene changed',ids:[]}});await vi.advanceTimersByTimeAsync(32);
 expect(api.scenePatch).toHaveBeenCalledTimes(1);expect(error).toHaveBeenCalledWith('CONFLICT');live.close();
});
it('close cancels unsent work and cannot send another value after an active command',async()=>{
 const {api,session,live}=await fixture();let finish!:()=>void;
 vi.mocked(api.scenePatch).mockImplementationOnce(p=>new Promise(resolve=>{finish=()=>resolve(session.applyPatch(p));}));
 live.offer('marker',transform(1));await vi.advanceTimersByTimeAsync(16);live.offer('marker',transform(2));live.close();finish();await vi.advanceTimersByTimeAsync(32);
 expect(api.scenePatch).toHaveBeenCalledTimes(1);expect(live.offer('marker',transform(3))).toBe(false);
});
it('does not queue transforms behind unrelated pending mutations',async()=>{
 const {api,model,live}=await fixture();let finish!:(reply:Reply<{revision:number}>)=>void;
 vi.mocked(api.scenePatch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=model.setVisibility('marker',false);
 expect(live.offer('marker',transform(2))).toBe(false);finish({ok:false,error:{code:'UNAVAILABLE',message:'Unavailable',ids:[]}});await pending;await vi.advanceTimersByTimeAsync(32);expect(api.scenePatch).toHaveBeenCalledTimes(1);live.close();
});
it('invalidates an ongoing input session when an external revision arrives between commits',async()=>{
 const {api,model,session,live,error}=await fixture();live.offer('marker',transform(1));await vi.advanceTimersByTimeAsync(16);
 session.applyPatch({sceneId:'scene_smoke',expectedRevision:1,operations:[{kind:'setTransform',entityId:'marker',transform:transform(9)}]});await model.load();
 expect(error).toHaveBeenCalledWith('CONFLICT');expect(model.read().scene?.entities.find(e=>e.id==='marker')?.transform.position[0]).toBe(9);expect(api.scenePatch).toHaveBeenCalledTimes(1);live.close();
});

it('keeps fields pending across an acknowledgement while a newer target waits to flush',async()=>{
 const {api,session,live,pending}=await fixture();let finish!:()=>void;
 vi.mocked(api.scenePatch).mockImplementationOnce(p=>new Promise(resolve=>{finish=()=>resolve(session.applyPatch(p));}));
 live.offer('marker',transform(1));await vi.advanceTimersByTimeAsync(16);live.offer('marker',transform(2));finish();await vi.advanceTimersByTimeAsync(0);
 expect(pending.mock.calls.map(call=>call[0])).toEqual([true]);
 await vi.advanceTimersByTimeAsync(16);expect(pending.mock.calls.map(call=>call[0])).toEqual([true,false]);live.close();
});
it('accepts authoritative normalized quaternion rounding and retains the next queued rotation',async()=>{
 const {api,session,live,error}=await fixture();let finish!:()=>void;
 vi.mocked(api.scenePatch).mockImplementationOnce(p=>new Promise(resolve=>{finish=()=>{const op=p.operations[0];if(op.kind==='setTransform'){const q=op.transform.rotation,n=Math.hypot(...q);op.transform.rotation=q.map(value=>value/n) as Transform['rotation'];}resolve(session.applyPatch(p));};}));
 const {eulerToQuaternion}=await import('../src/editor/interaction');
 live.offer('marker',{...transform(0),rotation:eulerToQuaternion([0,30,0])});await vi.advanceTimersByTimeAsync(16);
 const last={...transform(2),rotation:eulerToQuaternion([0,40,0])};live.offer('marker',last);finish();await vi.advanceTimersByTimeAsync(16);
 expect(error).not.toHaveBeenCalled();expect(api.scenePatch).toHaveBeenCalledTimes(2);expect(session.inspect().entities.find(e=>e.id==='marker')?.transform.position[0]).toBe(2);live.close();
});
it('ending field focus drains the latest target and permits later sidebar mutations',async()=>{
 const {api,model,session,live,error}=await fixture();let finish!:()=>void;
 vi.mocked(api.scenePatch).mockImplementationOnce(p=>new Promise(resolve=>{finish=()=>resolve(session.applyPatch(p));}));
 live.offer('marker',transform(1));await vi.advanceTimersByTimeAsync(16);live.offer('marker',transform(2));live.end();finish();await vi.advanceTimersByTimeAsync(16);
 expect(session.inspect().entities.find(e=>e.id==='marker')?.transform.position[0]).toBe(2);
 await model.setVisibility('marker',false);expect(error).not.toHaveBeenCalled();live.close();
});
