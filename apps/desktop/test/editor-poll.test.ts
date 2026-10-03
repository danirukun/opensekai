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
