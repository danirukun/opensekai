import {it,expect,vi} from 'vitest';
import {stageLabel,createLoadStatusSender} from '../src/editor/load-status';
const entry=(stage:'download'|'textures'|'prepare'|'failed',progress:number|null=null,extra={})=>({entityId:'char',assetId:'a',stage,progress,...extra});
it('labels each stage with the specified copy',()=>{
 expect(stageLabel(entry('download',.4))).toBe('Downloading');
 expect(stageLabel(entry('textures',.5,{count:{done:12,total:24}}))).toBe('Textures 12 of 24');
 expect(stageLabel(entry('prepare'))).toBe('Preparing');
 expect(stageLabel(entry('failed',null,{message:'Asset unavailable'}))).toBe('Asset unavailable');
});
it('sends stage changes at once and throttles progress to the interval',async()=>{
 vi.useFakeTimers();
 const send=vi.fn(async()=>{});const sender=createLoadStatusSender(send,200);
 sender.offer([entry('download',.1)]);expect(send).toHaveBeenCalledTimes(1);
 sender.offer([entry('download',.2)]);sender.offer([entry('download',.3)]);
 expect(send).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(200);
 expect(send).toHaveBeenCalledTimes(2);expect(send).toHaveBeenLastCalledWith({kind:'loadStatus',entries:[entry('download',.3)]});
 sender.offer([entry('prepare')]);expect(send).toHaveBeenCalledTimes(3);
 sender.offer([]);expect(send).toHaveBeenLastCalledWith({kind:'loadStatus',entries:[]});
 sender.resend();expect(send).toHaveBeenCalledTimes(5);
 sender.close();sender.offer([entry('download')]);expect(send).toHaveBeenCalledTimes(5);
 vi.useRealTimers();
});
