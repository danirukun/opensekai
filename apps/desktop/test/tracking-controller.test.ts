import {afterEach,it,expect,vi} from 'vitest';
import {createMediaPipeTracker,type TrackerDependencies} from '../src/tracking/mediapipe';
import type {WorkerRequest,WorkerReply} from '../src/tracking/mediapipe-worker';
import type {TrackingStatus} from '@opensekai/contracts';
const source={id:'camera',generation:1,config:{kind:'mediapipe' as const,enabled:true,deviceId:'camera-id',face:true,upperBody:true,hands:false,mirror:false}};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
it('does not request camera until explicitly enabled',async()=>{const getUserMedia=vi.fn();const statuses:TrackingStatus[]=[];const tracker=createMediaPipeTracker({now:()=>100,onSample:vi.fn(),onStatus:s=>statuses.push(s),dependencies:{getUserMedia}});tracker.reconcile([{...source,config:{...source.config,enabled:false}}]);await settle();expect(getUserMedia).not.toHaveBeenCalled();expect(statuses.at(-1)?.state).toBe('stopped');tracker.shutdown();});
it.each(['NotAllowedError','NotFoundError'])('keeps %s camera failures as errors without automatic retry',async name=>{const getUserMedia=vi.fn().mockRejectedValue(new DOMException('Camera unavailable',name));const statuses:TrackingStatus[]=[];const tracker=createMediaPipeTracker({now:()=>100,onSample:vi.fn(),onStatus:s=>statuses.push(s),dependencies:{getUserMedia}});tracker.reconcile([source]);await settle();tracker.reconcile([source]);await settle();expect(getUserMedia).toHaveBeenCalledTimes(1);expect(getUserMedia.mock.calls[0][0].audio).toBe(false);expect(getUserMedia.mock.calls[0][0].video.deviceId).toEqual({exact:'camera-id'});expect(statuses.at(-1)?.state).toBe('error');expect(statuses.at(-1)?.error).toContain(name);tracker.shutdown();});
it('closes tracks from late getUserMedia after Stop and never builds a worker',async()=>{let complete!:(stream:MediaStream)=>void;const stop=vi.fn(),createWorker=vi.fn(),statuses:TrackingStatus[]=[];const tracker=createMediaPipeTracker({now:()=>100,onSample:vi.fn(),onStatus:s=>statuses.push(s),dependencies:{getUserMedia:()=>new Promise(resolve=>complete=resolve),createWorker}});tracker.reconcile([source]);tracker.stop();complete({getTracks:()=>[{stop}]} as unknown as MediaStream);await settle();expect(stop).toHaveBeenCalledOnce();expect(createWorker).not.toHaveBeenCalled();expect(statuses.at(-1)?.state).toBe('stopped');tracker.shutdown();});
it('closes a superseded startup stream without changing the new generation status',async()=>{const completions:Array<(stream:MediaStream)=>void>=[],stop=vi.fn();const statuses:TrackingStatus[]=[];const tracker=createMediaPipeTracker({now:()=>100,onSample:vi.fn(),onStatus:s=>statuses.push(s),dependencies:{getUserMedia:()=>new Promise(resolve=>completions.push(resolve))}});tracker.reconcile([source]);tracker.reconcile([{...source,generation:2}]);completions[0]({getTracks:()=>[{stop}]} as unknown as MediaStream);await settle();expect(stop).toHaveBeenCalledOnce();expect(statuses.at(-1)).toMatchObject({generation:2,state:'waiting'});tracker.stop();completions[1]({getTracks:()=>[{stop}]} as unknown as MediaStream);await settle();});

function inferenceHarness(){
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 vi.stubGlobal('location',{href:'http://127.0.0.1:1420/'});
 const statuses:TrackingStatus[]=[],onSample=vi.fn(),onInference=vi.fn(),stopTrack=vi.fn(),messages:WorkerRequest[]=[];
 const cameraTrack={stop:stopTrack,onended:null as (()=>void)|null};
 const worker:ReturnType<TrackerDependencies['createWorker']>={onmessage:null,onerror:null,terminate:vi.fn(),postMessage(message){messages.push(message);if(message.kind==='init')queueMicrotask(()=>this.onmessage?.({data:{kind:'ready'}} as MessageEvent<WorkerReply>));}};
 const video={muted:false,playsInline:false,srcObject:null,readyState:2,currentTime:1,play:vi.fn().mockResolvedValue(undefined),pause:vi.fn()} as unknown as HTMLVideoElement;
 const bitmap={close:vi.fn()} as unknown as ImageBitmap;
 const tracker=createMediaPipeTracker({now:()=>4444,onSample,onInference,onStatus:s=>statuses.push(s),dependencies:{getUserMedia:async()=>({getTracks:()=>[cameraTrack],getVideoTracks:()=>[cameraTrack]}) as unknown as MediaStream,enumerateDevices:async()=>[],createWorker:()=>worker,createVideo:()=>video,createBitmap:async()=>bitmap}});
 const reply=(inferenceMs:number,expressions:Record<string,number>)=>worker.onmessage?.({data:{kind:'sample',inferenceMs,sample:{sourceId:source.id,generation:source.generation,receivedAtMs:4321.125,bones:{},expressions}}} as MessageEvent<WorkerReply>);
 return {tracker,statuses,onSample,onInference,worker,messages,reply,stopTrack,disconnect:()=>cameraTrack.onended?.()};
}
it.each([true,false])('exposes completed inference timing with landmarks=%s and clears timing on Stop',async landmarks=>{
 const h=inferenceHarness();h.tracker.reconcile([source]);await vi.advanceTimersByTimeAsync(0);
 expect(h.messages.map(m=>m.kind)).toEqual(['init','frame']);expect(h.statuses.at(-1)).not.toHaveProperty('inferenceMs');
 const frame=h.messages[1];expect(frame.kind).toBe('frame');if(frame.kind==='frame'){expect(frame.sourceId).toBe(source.id);expect(frame.generation).toBe(source.generation);expect(Math.abs(frame.nativeEpochOffsetMs+performance.timeOrigin+frame.timestamp-4444)).toBeLessThan(1);}
 h.reply(9.25,landmarks?{jawOpen:.5}:{});await vi.advanceTimersByTimeAsync(0);
 expect(h.onInference).toHaveBeenCalledWith(source.id,9.25);expect(h.statuses.at(-1)).toMatchObject({inferenceMs:9.25,state:landmarks?'receiving':'waiting',lastReceivedAtMs:landmarks?4321.125:null});
 if(landmarks)expect(h.onSample).toHaveBeenCalledWith(expect.objectContaining({receivedAtMs:4321.125,sourceId:source.id,generation:source.generation}));else expect(h.onSample).not.toHaveBeenCalled();
 h.tracker.stop();expect(h.statuses.at(-1)).toMatchObject({state:'stopped'});expect(h.statuses.at(-1)).not.toHaveProperty('inferenceMs');expect(h.stopTrack).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(100);h.tracker.shutdown();
});
it.each([NaN,Infinity,-1,60001])('rejects invalid measured worker inference duration %s',async duration=>{
 const h=inferenceHarness();h.tracker.reconcile([source]);await vi.advanceTimersByTimeAsync(0);h.reply(duration,{jawOpen:.5});await vi.advanceTimersByTimeAsync(0);
 expect(h.onInference).not.toHaveBeenCalled();expect(h.onSample).not.toHaveBeenCalled();expect(h.statuses.at(-1)?.state).toBe('error');expect(h.statuses.at(-1)).not.toHaveProperty('inferenceMs');h.tracker.shutdown();await vi.advanceTimersByTimeAsync(100);
});

it('clears completed inference timing when the active camera disconnects',async()=>{
 const h=inferenceHarness();h.tracker.reconcile([source]);await vi.advanceTimersByTimeAsync(0);h.reply(9.25,{jawOpen:.5});await vi.advanceTimersByTimeAsync(0);expect(h.statuses.at(-1)).toHaveProperty('inferenceMs',9.25);
 h.disconnect();expect(h.statuses.at(-1)).toMatchObject({state:'error',error:'Error: Camera device disconnected'});expect(h.statuses.at(-1)).not.toHaveProperty('inferenceMs');expect(h.stopTrack).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(100);h.tracker.shutdown();
});
