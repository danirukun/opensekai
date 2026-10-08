import { expect, it, vi } from 'vitest';
import type { AppApi, AppStatus } from '@opensekai/contracts';
import { createEditorModel } from '../src/editor/model';
import { createEditorPoll } from '../src/editor-poll';
import { makeSmokeScene } from '@opensekai/contracts';
const status = (revision: number): AppStatus => ({schemaVersion:1, sessionId:'session_smoke', ready:false, revision, capabilities:['read'], warnings:[], outputs:[]});
it('refreshes persistent scene once after an external revision and avoids overlapping polls', async () => {
 let finish!: (reply: unknown) => void;
 const inspect = vi.fn(async () => ({ok:true, data:makeSmokeScene()}));
 const readStatus = vi.fn().mockImplementationOnce(() => new Promise(resolve => {finish=resolve;})).mockResolvedValue({ok:true,data:status(0)});
 const api = {sceneInspect:inspect,appStatus:readStatus} as unknown as AppApi;
 const model = createEditorModel(api); const publish=vi.fn();
 const poll = createEditorPoll(api, model, publish, vi.fn());
 const first=poll.poll(); await poll.poll(); expect(readStatus).toHaveBeenCalledTimes(1);
 finish({ok:true,data:status(0)}); await first; expect(inspect).toHaveBeenCalledTimes(1);
 await poll.poll(); expect(inspect).toHaveBeenCalledTimes(1); expect(publish).toHaveBeenCalledTimes(2);
 poll.close();
});
it('reports unavailable status and suppresses late completions after close', async () => {
 let finish!: (reply: unknown) => void;
 const readStatus=vi.fn().mockResolvedValueOnce({ok:false,error:{code:'UNAVAILABLE',message:'Unavailable',ids:[]}}).mockImplementationOnce(() => new Promise(resolve=>{finish=resolve;}));
 const api={appStatus:readStatus} as unknown as AppApi;
 const publish=vi.fn(), fail=vi.fn(); const model=createEditorModel(api);
 const poll=createEditorPoll(api,model,publish,fail);
 await poll.poll(); expect(fail).toHaveBeenCalledWith('UNAVAILABLE');
 const late=poll.poll(); poll.close(); finish({ok:true,data:status(0)}); await late;
 expect(publish).not.toHaveBeenCalled(); await poll.poll(); expect(readStatus).toHaveBeenCalledTimes(2);
});
it('recovers lower authoritative owner revisions and clears removed selection',async()=>{
 const before=makeSmokeScene();before.revision=7;const after=makeSmokeScene();after.entities=after.entities.filter(e=>e.id!=='marker');
 const api={sceneInspect:vi.fn().mockResolvedValueOnce({ok:true,data:before}).mockResolvedValueOnce({ok:true,data:after}),appStatus:vi.fn().mockResolvedValue({ok:true,data:status(0)})} as unknown as AppApi;
 const model=createEditorModel(api);await model.load();model.select('marker');
 const poll=createEditorPoll(api,model,vi.fn(),vi.fn());await poll.poll();
 expect(model.read()).toMatchObject({scene:{revision:0},selectedId:null});
});
it('polls Blueprints on a revision change, on every tick while visible, and while unavailable',async()=>{
 const readStatus=vi.fn(async()=>({ok:true,data:{...status(0),blueprintRevision:3}}));
 const api={appStatus:readStatus,sceneInspect:vi.fn(async()=>({ok:true,data:makeSmokeScene()}))} as unknown as AppApi;
 let revision=3,issue:{kind:'unavailable'}|null=null,visible=false;const poll=vi.fn(async()=>{});
 const p=createEditorPoll(api,createEditorModel(api),vi.fn(),vi.fn(),{revision:()=>revision,issue:()=>issue,poll,reset:async()=>{}},()=>visible);
 await p.poll();expect(poll).not.toHaveBeenCalled();
 revision=2;await p.poll();expect(poll).toHaveBeenCalledTimes(1);
 revision=3;visible=true;await p.poll();expect(poll).toHaveBeenCalledTimes(2);
 visible=false;issue={kind:'unavailable'};await p.poll();expect(poll).toHaveBeenCalledTimes(3);
});
it('resets Blueprint sync when the session reports a lower revision than the editor holds',async()=>{
 const readStatus=vi.fn(async()=>({ok:true,data:{...status(0),blueprintRevision:0}}));
 const api={appStatus:readStatus,sceneInspect:vi.fn(async()=>({ok:true,data:makeSmokeScene()}))} as unknown as AppApi;
 const poll=vi.fn(async()=>{}),reset=vi.fn(async()=>{});
 const p=createEditorPoll(api,createEditorModel(api),vi.fn(),vi.fn(),{revision:()=>7,issue:()=>null,poll,reset},()=>true);
 await p.poll();expect(reset).toHaveBeenCalledTimes(1);expect(poll).not.toHaveBeenCalled();
});
